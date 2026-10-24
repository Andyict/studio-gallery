import { z } from 'zod';
import { fail } from './security.mjs';

// Album workflow, modelled on Studio Album:
//   selecting → submitted (customer locked) → editing → delivered
// Hearts (selection lists) are the unlimited first tier. When an album sets max_edit > 0 the
// customer also picks up to N photos to edit ("edit picks"), and submits the album to the studio.
// Photos under the album's Final folder are deliverables: hidden from proofing and shown as
// "Ảnh hoàn thiện" once the album is delivered.
export const STATUSES=['selecting','submitted','editing','delivered'];

export function initializeWorkflow(db,config) {
  const add=(table,column,type)=>{if(!db.all(`PRAGMA table_info(${table})`).some(c=>c.name===column))db.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);};
  add('projects','status',"TEXT NOT NULL DEFAULT 'selecting'");
  add('projects','max_edit','INTEGER NOT NULL DEFAULT 0');
  add('projects','due_at','TEXT');
  add('projects','submitted_at','TEXT');
  add('projects','client_message',"TEXT NOT NULL DEFAULT ''");
  add('projects','customer_note',"TEXT NOT NULL DEFAULT ''");
  add('photos','edit_pick','INTEGER NOT NULL DEFAULT 0');
  add('photos','edit_done','INTEGER NOT NULL DEFAULT 0');
  add('folders','is_final','INTEGER NOT NULL DEFAULT 0');
  db.raw.exec(`CREATE TABLE IF NOT EXISTS photo_views (
      link_id TEXT NOT NULL REFERENCES links(id), photo_id TEXT NOT NULL REFERENCES photos(id),
      viewed_at TEXT NOT NULL, PRIMARY KEY(link_id,photo_id));
    CREATE INDEX IF NOT EXISTS photos_edit_pick ON photos(project_id,edit_pick);`);
  markFinals(db,config);
}

// Final-folder matching happens only here, in JS, with Unicode normalisation and case folding
// (SQLite's lower() folds ASCII only, and macOS clients often write NFD names over SMB). The result
// is stored as folders.is_final so SQL never re-derives it.
const fold=value=>String(value||'').normalize('NFC').toLocaleLowerCase('vi');
export const isFinalPath=(config,relative)=>{const name=fold(config.finalFolder||'Final'),r=fold(relative);return r===name||r.startsWith(`${name}/`);};
export function markFinals(db,config){
  db.transaction(()=>{for(const f of db.all('SELECT id,relative_path,is_final FROM folders'))if(+isFinalPath(config,f.relative_path)!==f.is_final)db.run('UPDATE folders SET is_final=? WHERE id=?',+isFinalPath(config,f.relative_path),f.id);});
}
// SQL predicate (folder alias `f`) matching the album's Final folder and everything below it.
export const finalSql=()=>({sql:'f.is_final=1',args:[]});

export function registerWorkflow(app,{db,config,csv,authenticate,activeLink,photoAllowed,messaging}) {
  const now=()=>new Date().toISOString();
  const project=id=>{const p=db.get('SELECT * FROM projects WHERE id=?',id);if(!p)fail(404,'Không tìm thấy album');return p;};
  const editCount=projectID=>db.get('SELECT count(*) AS n FROM photos WHERE project_id=? AND edit_pick=1 AND missing=0 AND paired_with IS NULL',projectID).n;
  const publish=(projectID,type,extra={})=>messaging.hub.album(projectID,{type,...extra});

  // ---------- customer ----------
  app.put('/api/client/photos/:id/edit',async req=>{
    const s=authenticate(req),link=activeLink(s),p=project(link.project_id),photo=photoAllowed(s,req.params.id);
    const b=z.object({selected:z.boolean()}).strict().safeParse(req.body);if(!b.success)fail(400,'Dữ liệu không hợp lệ');
    if(p.status!=='selecting')fail(409,'Album đã gửi cho studio, không thể thay đổi lựa chọn');
    if(!p.max_edit)fail(400,'Album này không giới hạn ảnh chỉnh sửa; hãy dùng trái tim');
    if(isFinalPath(config,photo.folder_path))fail(400,'Ảnh hoàn thiện không thể chọn');
    db.transaction(()=>{
      if(b.data.selected&&!photo.edit_pick&&editCount(p.id)>=p.max_edit)fail(409,`Bạn chỉ được chọn tối đa ${p.max_edit} ảnh để chỉnh sửa`);
      db.run('UPDATE photos SET edit_pick=? WHERE id=?',+b.data.selected,photo.id);
    });
    publish(p.id,'edit',{photo_id:photo.id});
    return {ok:true,edit_count:editCount(p.id),max_edit:p.max_edit};
  });
  app.post('/api/client/album/submit',async req=>{
    const s=authenticate(req),link=activeLink(s),p=project(link.project_id);
    if(p.status!=='selecting')fail(409,'Album đã được gửi cho studio');
    const picks=p.max_edit?editCount(p.id):db.get('SELECT count(DISTINCT cs.photo_id) AS n FROM client_selections cs JOIN photos ph ON ph.id=cs.photo_id WHERE cs.project_id=? AND ph.missing=0 AND ph.paired_with IS NULL',p.id).n;
    if(!picks)fail(400,p.max_edit?'Bạn chưa chọn ảnh nào để chỉnh sửa':'Bạn chưa thả tim ảnh nào');
    const at=now();
    db.transaction(()=>{
      db.run("UPDATE projects SET status='submitted',submitted_at=? WHERE id=?",at,p.id);
      db.run('UPDATE selection_lists SET submitted_at=COALESCE(submitted_at,?) WHERE project_id=?',at,p.id);
    });
    messaging.notify('submitted',p.id,`${s.name} đã gửi ${picks} ảnh ${p.max_edit?'chọn chỉnh sửa':'yêu thích'} — ${p.name}`);
    publish(p.id,'status',{status:'submitted'});
    return {ok:true,status:'submitted'};
  });
  app.put('/api/client/album/note',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async req=>{
    const s=authenticate(req),link=activeLink(s),p=project(link.project_id);
    if(p.status!=='selecting')fail(409,'Album đã gửi cho studio; hãy nhắn tin nếu cần bổ sung');
    const b=z.object({text:z.string().max(2000)}).strict().safeParse(req.body);if(!b.success)fail(400,'Ghi chú tối đa 2000 ký tự');
    const text=b.data.text.trim();
    db.run('UPDATE projects SET customer_note=? WHERE id=?',text,p.id);
    if(text&&text!==p.customer_note)messaging.notify('note',p.id,`${s.name} cập nhật ghi chú chung — ${p.name}`);
    publish(p.id,'album');
    return {ok:true};
  });
  app.post('/api/client/photos/:id/viewed',async req=>{
    const s=authenticate(req),link=activeLink(s),photo=photoAllowed(s,req.params.id);
    db.run('INSERT OR IGNORE INTO photo_views(link_id,photo_id,viewed_at) VALUES(?,?,?)',link.id,photo.id,now());
    return {ok:true};
  });

  // ---------- studio ----------
  const workflowBody=z.object({
    status:z.enum(STATUSES).optional(),max_edit:z.number().int().min(0).max(10000).optional(),
    due_at:z.string().datetime().nullable().optional(),client_message:z.string().trim().max(2000).optional()
  }).strict();
  app.patch('/api/admin/projects/:id/workflow',async req=>{
    authenticate(req,true);const p=project(req.params.id);
    const r=workflowBody.safeParse(req.body);if(!r.success)fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
    const b=r.data;
    db.transaction(()=>{
      if(b.status&&b.status!==p.status){
        db.run('UPDATE projects SET status=?,submitted_at=? WHERE id=?',b.status,b.status==='selecting'?null:(p.submitted_at||now()),p.id);
        // Unlocking for the customer also reopens their favourite lists.
        if(b.status==='selecting')db.run('UPDATE selection_lists SET submitted_at=NULL WHERE project_id=?',p.id);
      }
      if(b.max_edit!==undefined)db.run('UPDATE projects SET max_edit=? WHERE id=?',b.max_edit,p.id);
      if(b.due_at!==undefined)db.run('UPDATE projects SET due_at=? WHERE id=?',b.due_at,p.id);
      if(b.client_message!==undefined)db.run('UPDATE projects SET client_message=? WHERE id=?',b.client_message,p.id);
    });
    publish(p.id,b.status&&b.status!==p.status?'status':'album',b.status?{status:b.status}:{});
    return {ok:true};
  });
  app.patch('/api/admin/photos/:id/done',async req=>{
    authenticate(req,true);
    const b=z.object({done:z.boolean()}).strict().safeParse(req.body);if(!b.success)fail(400,'Dữ liệu không hợp lệ');
    const photo=db.get('SELECT id,project_id FROM photos WHERE id=?',req.params.id);if(!photo)fail(404,'Không tìm thấy ảnh');
    db.run('UPDATE photos SET edit_done=? WHERE id=?',+b.data.done,photo.id);
    messaging.hub.staff({type:'done',project_id:photo.project_id,photo_id:photo.id});
    return {ok:true};
  });
  // Editor worklist: edit picks (or every hearted photo when the album has no edit limit), with notes.
  function worklist(projectID){
    const p=project(projectID);
    const where=(p.max_edit?'p.edit_pick=1':'EXISTS(SELECT 1 FROM client_selections cs WHERE cs.photo_id=p.id)')+' AND p.paired_with IS NULL';
    return {project:p,photos:db.all(`SELECT p.id,p.filename,p.stem,p.extension,p.relative_path,p.width,p.height,p.status,p.missing,p.edit_pick,p.edit_done,
      (SELECT count(*) FROM messages m WHERE m.photo_id=p.id AND m.author_role='client') AS note_count,
      (SELECT group_concat(m.body,' | ') FROM messages m WHERE m.photo_id=p.id AND m.author_role='client') AS notes
      FROM photos p WHERE p.project_id=? AND ${where} ORDER BY p.relative_path COLLATE NOCASE`,projectID)};
  }
  app.get('/api/admin/projects/:id/worklist',async(req,reply)=>{
    authenticate(req,true);const {project:p,photos}=worklist(req.params.id);
    if(req.query.format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="edit-list.csv"')
      .send(csv([['Filename','Path','Done','Missing','Customer notes'],...photos.map(x=>[x.filename,x.relative_path,x.edit_done,x.missing,x.notes||''])]));
    return {mode:p.max_edit?'edit':'favorites',max_edit:p.max_edit,search_string:[...new Set(photos.filter(x=>!x.missing).map(x=>x.stem))].join(', '),
      done:photos.filter(x=>x.edit_done).length,photos:photos.map(x=>({...x,edit_pick:!!x.edit_pick,edit_done:!!x.edit_done}))};
  });
}
