import { z } from 'zod';
import { rm } from 'node:fs/promises';
import { fail } from './security.mjs';
import { cacheFile } from './previews.mjs';
import { restricted } from './assignments.mjs';

// Album lifecycle and the studio's to-do overview.
// - Archived albums keep all data but are closed to customers and never scanned.
// - Deleting an (archived) album removes only the app's data and cache; photo files are never touched.
//   Its folder is remembered in ignored_roots so automatic discovery does not recreate it.
// - download_log records every ZIP a customer starts.
export function initializeLifecycle(db) {
  if(!db.all('PRAGMA table_info(projects)').some(c=>c.name==='archived_at'))db.raw.exec('ALTER TABLE projects ADD COLUMN archived_at TEXT');
  db.raw.exec(`CREATE TABLE IF NOT EXISTS ignored_roots (root TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS download_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id), link_id TEXT,
      client TEXT NOT NULL, original INTEGER NOT NULL, files INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS download_log_project ON download_log(project_id,id);`);
}

export function registerLifecycle(app,{db,config,authenticate,access,parse,scanner,nextScan}) {
  const now=()=>new Date().toISOString();
  const manager=req=>{const s=authenticate(req,true);if(restricted(s))fail(403,'Tài khoản chỉ xem album được giao');return s;};
  const audit=(s,action,target)=>db.run('INSERT INTO audit_log(id,actor_id,action,target) VALUES(lower(hex(randomblob(16))),?,?,?)',s.user_id,action,target);

  app.post('/api/admin/projects/:id/archive',async req=>{
    const s=manager(req),b=parse(z.object({archived:z.boolean()}).strict(),req.body);
    const p=db.get('SELECT * FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy album');
    if(b.archived)db.run('UPDATE projects SET archived_at=?,next_scan=NULL WHERE id=?',now(),p.id);
    else db.run('UPDATE projects SET archived_at=NULL,next_scan=? WHERE id=?',p.scan_interval_seconds?new Date(Date.now()+p.scan_interval_seconds*1000).toISOString():nextScan(p.cron,p.timezone),p.id);
    audit(s,b.archived?'album.archive':'album.restore',p.id);
    return {ok:true};
  });

  app.delete('/api/admin/projects/:id',async req=>{
    const s=authenticate(req,true);if(s.user.role!=='admin')fail(403,'Chỉ quản trị viên được xoá album');
    const b=parse(z.object({confirm:z.string()}).strict(),req.body||{});
    const p=db.get('SELECT * FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy album');
    if(!p.archived_at)fail(409,'Hãy lưu trữ album trước khi xoá');
    if(b.confirm.trim()!==p.name)fail(400,'Nhập đúng tên album để xác nhận xoá');
    const photos=db.all('SELECT id,version FROM photos WHERE project_id=?',p.id);
    const links=db.all('SELECT id FROM links WHERE project_id=?',p.id).map(l=>l.id);
    db.transaction(()=>{
      const inLinks=`(SELECT id FROM links WHERE project_id=?)`,inPhotos=`(SELECT id FROM photos WHERE project_id=?)`;
      const sessions=`(SELECT id FROM sessions WHERE link_id IN ${inLinks})`;
      for(const [sql,...args] of [
        [`DELETE FROM download_tickets WHERE session_id IN ${sessions}`,p.id],
        [`DELETE FROM photo_views WHERE link_id IN ${inLinks}`,p.id],
        ['DELETE FROM client_selections WHERE project_id=?',p.id],
        ['DELETE FROM selection_lists WHERE project_id=?',p.id],
        ['DELETE FROM messages WHERE project_id=?',p.id],
        ['DELETE FROM comments WHERE project_id=?',p.id],
        ['DELETE FROM chat_messages WHERE project_id=?',p.id],
        ['DELETE FROM read_cursors WHERE project_id=?',p.id],
        ['DELETE FROM notifications WHERE project_id=?',p.id],
        ['DELETE FROM download_log WHERE project_id=?',p.id],
        [`DELETE FROM jobs WHERE photo_id IN ${inPhotos}`,p.id],
        [`DELETE FROM preview_cache WHERE photo_id IN ${inPhotos}`,p.id],
        [`DELETE FROM sessions WHERE link_id IN ${inLinks}`,p.id],
        ['DELETE FROM link_folders WHERE project_id=?',p.id],
        ['DELETE FROM links WHERE project_id=?',p.id],
        ['DELETE FROM project_staff WHERE project_id=?',p.id],
        ['DELETE FROM scan_runs WHERE project_id=?',p.id],
        ['DELETE FROM photos WHERE project_id=?',p.id],
        ['DELETE FROM folders WHERE project_id=?',p.id],
        ['DELETE FROM projects WHERE id=?',p.id]
      ])db.run(sql,...args);
      db.run('INSERT OR REPLACE INTO ignored_roots(root,created_at) VALUES(?,?)',p.root,now());
      audit(s,'album.delete',`${p.id} ${p.name} (${links.length} link, ${photos.length} ảnh)`);
    });
    for(const photo of photos)for(const variant of ['thumb','preview','video'])void rm(cacheFile(config,photo,variant),{force:true}).catch(()=>{});
    return {ok:true};
  });

  app.get('/api/admin/projects/:id/downloads',async req=>{
    authenticate(req,true);
    return db.all('SELECT client,original,files,created_at FROM download_log WHERE project_id=? ORDER BY id DESC LIMIT 50',req.params.id);
  });

  // Everything that needs the studio's attention, across the albums this account may see.
  app.get('/api/admin/dashboard',async req=>{
    const s=authenticate(req,true),f=access.staffFilter(s,'p.id'),t=now(),soon=new Date(Date.now()+3*86400_000).toISOString();
    const albums=(where,...args)=>db.all(`SELECT p.id,p.name,p.status,p.due_at,p.submitted_at,p.max_edit,
        (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND edit_pick=1) AS edit_pick_count,
        (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND edit_pick=1 AND edit_done=1) AS edit_done_count
      FROM projects p WHERE p.archived_at IS NULL AND ${f.sql} AND ${where}`,...f.args,...args);
    return {
      submitted:albums("p.status='submitted' ORDER BY p.submitted_at"),
      editing:albums("p.status='editing' ORDER BY COALESCE(p.due_at,'9999')"),
      overdue:albums("p.status<>'delivered' AND p.due_at IS NOT NULL AND p.due_at<? ORDER BY p.due_at",t),
      due_soon:albums("p.status<>'delivered' AND p.due_at>=? AND p.due_at<? ORDER BY p.due_at",t,soon),
      unread:db.all(`SELECT p.id,p.name,count(*) AS n FROM messages m JOIN projects p ON p.id=m.project_id
        LEFT JOIN read_cursors rc ON rc.project_id=p.id AND rc.reader='staff'
        WHERE m.author_role='client' AND m.seq>COALESCE(rc.last_seq,0) AND p.archived_at IS NULL AND ${f.sql} GROUP BY p.id ORDER BY max(m.seq) DESC LIMIT 10`,...f.args),
      open_notes:db.all(`SELECT p.id,p.name,count(*) AS n FROM messages m JOIN projects p ON p.id=m.project_id
        WHERE m.author_role='client' AND m.photo_id IS NOT NULL AND m.resolved=0 AND p.archived_at IS NULL AND ${f.sql} GROUP BY p.id ORDER BY n DESC LIMIT 10`,...f.args),
      failed:db.all(`SELECT p.id,p.name,count(*) AS n FROM photos ph JOIN projects p ON p.id=ph.project_id
        WHERE ph.status='failed' AND ph.missing=0 AND ph.paired_with IS NULL AND p.archived_at IS NULL AND ${f.sql} GROUP BY p.id ORDER BY n DESC LIMIT 10`,...f.args),
      customers_without_pin:restricted(s)?0:db.get(`SELECT count(*) AS n FROM customers c WHERE c.pin_hash IS NULL AND c.disabled=0
        AND EXISTS(SELECT 1 FROM links l WHERE l.customer_id=c.id AND l.revoked=0)`).n,
      recent_downloads:db.all(`SELECT d.client,d.original,d.files,d.created_at,p.id,p.name FROM download_log d JOIN projects p ON p.id=d.project_id
        WHERE ${f.sql} ORDER BY d.id DESC LIMIT 8`,...f.args)
    };
  });

  return {
    logDownload:(link,session,original,files)=>db.run('INSERT INTO download_log(project_id,link_id,client,original,files,created_at) VALUES(?,?,?,?,?,?)',link.project_id,link.id,session.name,+original,files,now()),
    ignored:root=>!!db.get('SELECT 1 FROM ignored_roots WHERE root=?',root),
    unignore:root=>db.run('DELETE FROM ignored_roots WHERE root=?',root)
  };
}
