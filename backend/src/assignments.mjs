import { z } from 'zod';
import { fail } from './security.mjs';

// Staff assignment to albums. Admins and staff with album_scope 'all' see every album (the v0.2
// behaviour). Staff with album_scope 'assigned' only see albums they are assigned to: every
// album-specific admin route is checked centrally in a preHandler hook, and list endpoints
// filter through staffFilter().
export function initializeAssignments(db) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS project_staff (
    project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES staff_users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,user_id));
    CREATE INDEX IF NOT EXISTS project_staff_user ON project_staff(user_id);`);
  if(!db.all('PRAGMA table_info(staff_users)').some(c=>c.name==='album_scope'))
    db.raw.exec("ALTER TABLE staff_users ADD COLUMN album_scope TEXT NOT NULL DEFAULT 'all'");
}

export const restricted=session=>session.user.role!=='admin'&&session.user.album_scope==='assigned';

export function createAccess(db) {
  const assigned=(userID,projectID)=>!!db.get('SELECT 1 FROM project_staff WHERE user_id=? AND project_id=?',userID,projectID);
  return {
    assigned,
    // SQL predicate on a project-id column; always true for unrestricted staff.
    staffFilter(session,column){
      return restricted(session)?{sql:`${column} IN (SELECT project_id FROM project_staff WHERE user_id=?)`,args:[session.user_id]}:{sql:'1=1',args:[]};
    },
    canSeeProject:(session,projectID)=>!restricted(session)||assigned(session.user_id,projectID)
  };
}

// Maps an admin route + params to the album it touches; undefined for routes that are not album-specific.
function projectOf(db,url,params){
  if(/^\/api\/admin\/projects\/:id(\/|$)/.test(url))return params.id;
  const lookup={lists:'selection_lists',photos:'photos',messages:'messages',links:'links'}[url.match(/^\/api\/admin\/(lists|photos|messages|links)\/:id/)?.[1]];
  if(lookup)return db.get(`SELECT project_id FROM ${lookup} WHERE id=?`,params.id)?.project_id||null;
  return undefined;
}

// Whole-NAS views and album creation are only for staff who see every album.
const UNRESTRICTED_ONLY=[/^\/api\/admin\/browse/,/^\/api\/admin\/directories/,/^\/api\/admin\/sources\/:id\/discover/];

export function registerAssignments(app,{db,authenticate,access,parse}) {
  app.addHook('preHandler',async req=>{
    const url=req.routeOptions?.url||'';
    if(!url.startsWith('/api/admin/'))return;
    let session;try{session=authenticate(req,true);}catch{return;}// the route itself answers 401
    if(!restricted(session))return;
    if(UNRESTRICTED_ONLY.some(r=>r.test(url))||(url==='/api/admin/projects'&&req.method==='POST'))fail(403,'Tài khoản chỉ xem album được giao');
    const projectID=projectOf(db,url,req.params||{});
    if(projectID===undefined)return;
    if(!projectID||!access.assigned(session.user_id,projectID))fail(404,'Không tìm thấy album');
  });
  app.get('/api/admin/team',async req=>{
    authenticate(req,true);
    return db.all("SELECT id,username,name,role,album_scope FROM staff_users WHERE disabled=0 ORDER BY role,name");
  });
  app.get('/api/admin/projects/:id/staff',async req=>{
    authenticate(req,true);
    return db.all('SELECT u.id,u.name,u.username,u.role FROM project_staff ps JOIN staff_users u ON u.id=ps.user_id WHERE ps.project_id=? ORDER BY u.name',req.params.id);
  });
  app.put('/api/admin/projects/:id/staff',async req=>{
    const s=authenticate(req,true);
    if(restricted(s))fail(403,'Chỉ quản trị viên hoặc nhân viên xem mọi album được phân công');
    const b=parse(z.object({user_ids:z.array(z.string().uuid()).max(100)}).strict(),req.body);
    if(!db.get('SELECT 1 FROM projects WHERE id=?',req.params.id))fail(404,'Không tìm thấy album');
    for(const uid of b.user_ids)if(!db.get('SELECT 1 FROM staff_users WHERE id=? AND disabled=0',uid))fail(400,'Nhân viên không hợp lệ');
    db.transaction(()=>{
      db.run('DELETE FROM project_staff WHERE project_id=?',req.params.id);
      for(const uid of new Set(b.user_ids))db.run('INSERT INTO project_staff(project_id,user_id) VALUES(?,?)',req.params.id,uid);
      db.run("INSERT INTO audit_log(id,actor_id,action,target) VALUES(lower(hex(randomblob(16))),?,?,?)",s.user_id,'album.assign',req.params.id);
    });
    return {ok:true};
  });
}
