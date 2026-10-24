import { z } from 'zod';
import { id, fail } from './security.mjs';

// One table for album chat (photo_id NULL) and photo notes (photo_id set, optionally pinned at x/y),
// written by both the customer and the studio. `seq` is monotonic and drives read cursors:
// staff share one team cursor per album ("staff"), each share link has its own ("link:<id>").
export function initializeMessages(db) {
  const exists=name=>!!db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",name);
  const fresh=!exists('messages');
  // Table creation and the legacy copy share one transaction: if the copy fails, the table is
  // rolled back too and the migration runs again on the next start instead of being skipped.
  db.transaction(()=>{
    db.raw.exec(`CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id), photo_id TEXT REFERENCES photos(id),
      x REAL CHECK(x IS NULL OR x BETWEEN 0 AND 1), y REAL CHECK(y IS NULL OR y BETWEEN 0 AND 1),
      author_role TEXT NOT NULL CHECK(author_role IN ('client','staff')),
      session_id TEXT REFERENCES sessions(id), user_id TEXT, author_name TEXT NOT NULL,
      body TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id,seq);
    CREATE INDEX IF NOT EXISTS messages_photo ON messages(photo_id,seq);
    CREATE TABLE IF NOT EXISTS read_cursors (
      project_id TEXT NOT NULL REFERENCES projects(id), reader TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_id,reader));
    CREATE TABLE IF NOT EXISTS notifications (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, project_id TEXT REFERENCES projects(id),
      text TEXT NOT NULL, created_at TEXT NOT NULL);`);
    if(!db.all('PRAGMA table_info(staff_users)').some(c=>c.name==='notif_seen_seq'))
      db.raw.exec('ALTER TABLE staff_users ADD COLUMN notif_seen_seq INTEGER NOT NULL DEFAULT 0');
    if(!fresh)return;
    // Carry over the v0.2 tables once. They are left in place, unused, as a fallback.
    const iso=value=>value&&!value.includes('T')?`${value.replace(' ','T')}.000Z`:value||new Date().toISOString();
    const legacy=[
      ...db.all(`SELECT c.id,c.project_id,c.photo_id,c.x,c.y,'client' AS author_role,c.session_id,s.name AS author_name,c.body,c.resolved,c.created_at,NULL AS read_at,c.rowid AS r,0 AS kind
        FROM comments c LEFT JOIN sessions s ON s.id=c.session_id`),
      ...db.all(`SELECT id,project_id,NULL AS photo_id,NULL AS x,NULL AS y,CASE sender_role WHEN 'admin' THEN 'staff' ELSE 'client' END AS author_role,
        session_id,sender_name AS author_name,body,0 AS resolved,created_at,read_at,rowid AS r,1 AS kind FROM chat_messages`)
    ].sort((a,b)=>iso(a.created_at).localeCompare(iso(b.created_at))||a.kind-b.kind||a.r-b.r);
    const unread=new Map();
    for(const m of legacy){
      const {lastInsertRowid}=db.run(`INSERT INTO messages(id,project_id,photo_id,x,y,author_role,session_id,author_name,body,resolved,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,m.id,m.project_id,m.photo_id,m.x,m.y,m.author_role,m.session_id,m.author_name||'Khách',m.body,m.resolved,iso(m.created_at));
      if(m.kind===1&&m.author_role==='client'&&!m.read_at&&!unread.has(m.project_id))unread.set(m.project_id,Number(lastInsertRowid));
    }
    // Staff had read everything except chat messages still marked unread.
    for(const {project_id,last} of db.all('SELECT project_id,max(seq) AS last FROM messages GROUP BY project_id'))
      db.run('INSERT INTO read_cursors(project_id,reader,last_seq) VALUES(?,?,?)',project_id,'staff',unread.has(project_id)?unread.get(project_id)-1:last);
  });
}

// Server-Sent Events fan-out. Events only say *what* changed; browsers refetch through the
// normal, permission-checked endpoints, so nothing outside a link's scope is ever pushed.
export function createHub(logger) {
  const subscribers=new Set();
  const send=(sub,event)=>{try{sub.res.write(`data: ${JSON.stringify(event)}\n\n`);}catch(err){logger.warn({err},'SSE write failed');}};
  return {
    add(sub){subscribers.add(sub);return ()=>subscribers.delete(sub);},
    size:()=>subscribers.size,
    // Customers only hear about photos their link may see (scope, Final folder before delivery).
    album(projectID,event){for(const sub of subscribers){
      if(sub.role!=='staff'&&(sub.projectID!==projectID||(event.photo_id&&!sub.canSee(event.photo_id))))continue;
      if(sub.role==='staff'&&!sub.canSeeProject(projectID))continue;
      send(sub,{...event,project_id:projectID});}},
    count:key=>[...subscribers].filter(s=>s.key===key).length,
    clients:()=>[...subscribers].filter(s=>s.role!=='staff').length,
    staff(event){for(const sub of subscribers)if(sub.role==='staff'&&(!event.project_id||sub.canSeeProject(event.project_id)))send(sub,event);},
    close(){for(const sub of subscribers){sub.stop();}subscribers.clear();}
  };
}

const body=z.string().trim().min(1).max(2000);
const point=z.number().min(0).max(1);
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return r.data;};
// `before` pages backwards through history (newest page first); `after` fetches only newer messages.
const listQuery=z.object({photo_id:z.string().uuid().optional(),scope:z.enum(['all','chat','photos']).default('all'),after:z.coerce.number().int().min(0).default(0),
  before:z.coerce.number().int().min(1).optional(),limit:z.coerce.number().int().min(1).max(500).default(200)});

export function registerMessages(app,{db,config,csv,authenticate,activeLink,photoAllowed,scopeSql,access}) {
  const hub=createHub(app.log);
  const now=()=>new Date().toISOString();
  const linkReader=link=>`link:${link.id}`;
  // Opening a photo thread marks just that photo read; the album-wide cursor moves when the chat panel is opened.
  const photoReader=(link,photoID)=>`link:${link.id}:photo:${photoID}`;
  const cursor=(projectID,reader)=>db.get('SELECT last_seq FROM read_cursors WHERE project_id=? AND reader=?',projectID,reader)?.last_seq||0;
  // Returns true only when the cursor actually moved, so callers never broadcast no-op reads
  // (a client reacting to its own "read" event would otherwise loop).
  const advance=(projectID,reader,seq)=>db.run(`INSERT INTO read_cursors(project_id,reader,last_seq) VALUES(?,?,?)
    ON CONFLICT(project_id,reader) DO UPDATE SET last_seq=excluded.last_seq WHERE excluded.last_seq>last_seq`,projectID,reader,seq).changes>0;
  const shape=(m,mine)=>({id:m.id,seq:m.seq,photo_id:m.photo_id,filename:m.filename||null,x:m.x,y:m.y,author_role:m.author_role,author_name:m.author_name,
    body:m.body,resolved:!!m.resolved,created_at:m.created_at,mine});
  function notify(kind,projectID,text){
    config.outbound?.notify(kind,projectID,text);
    const {lastInsertRowid}=db.run('INSERT INTO notifications(kind,project_id,text,created_at) VALUES(?,?,?,?)',kind,projectID,text,now());
    hub.staff({type:'notification',seq:Number(lastInsertRowid),kind,project_id:projectID});
  }
  // Messages a share link may see: album chat plus notes on photos inside its folder scope.
  function visible(link,{photo_id,scope='all',after=0,before}={}) {
    const scoped=scopeSql(link);
    // Notes on deliverables stay hidden until the album is delivered, like the photos themselves.
    const delivered=db.get('SELECT status FROM projects WHERE id=?',link.project_id)?.status==='delivered';
    const clauses=['m.project_id=?','m.seq>?',`(m.photo_id IS NULL OR (p.missing=0 AND ${scoped.sql}${delivered?'':' AND f.is_final=0'}))`],args=[link.project_id,after,...scoped.args];
    if(before){clauses.push('m.seq<?');args.push(before);}
    if(photo_id){clauses.push('m.photo_id=?');args.push(photo_id);}
    else if(scope==='chat')clauses.push('m.photo_id IS NULL');
    else if(scope==='photos')clauses.push('m.photo_id IS NOT NULL');
    return {sql:`FROM messages m LEFT JOIN photos p ON p.id=m.photo_id LEFT JOIN folders f ON f.id=p.folder_id WHERE ${clauses.join(' AND ')}`,args};
  }
  function adminRows(projectID,{photo_id,scope='all',after=0,before,limit=200}={}) {
    const clauses=['m.project_id=?','m.seq>?'],args=[projectID,after];
    if(before){clauses.push('m.seq<?');args.push(before);}
    if(photo_id){clauses.push('m.photo_id=?');args.push(photo_id);}
    else if(scope==='chat')clauses.push('m.photo_id IS NULL');
    else if(scope==='photos')clauses.push('m.photo_id IS NOT NULL');
    return db.all(`SELECT * FROM (SELECT m.*,p.filename FROM messages m LEFT JOIN photos p ON p.id=m.photo_id WHERE ${clauses.join(' AND ')} ORDER BY m.seq DESC LIMIT ?) ORDER BY seq`,...args,limit);
  }
  function project(projectID){const p=db.get('SELECT id,name FROM projects WHERE id=?',projectID);if(!p)fail(404,'Không tìm thấy album');return p;}
  function insert({project_id,photo_id=null,x=null,y=null,author_role,session_id=null,user_id=null,author_name,text}){
    const mid=id();
    const {lastInsertRowid}=db.run(`INSERT INTO messages(id,project_id,photo_id,x,y,author_role,session_id,user_id,author_name,body,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,mid,project_id,photo_id,x,y,author_role,session_id,user_id,author_name,text,now());
    const seq=Number(lastInsertRowid);
    hub.album(project_id,{type:'message',seq,photo_id,author_role});
    return db.get('SELECT m.*,p.filename FROM messages m LEFT JOIN photos p ON p.id=m.photo_id WHERE m.seq=?',seq);
  }

  // ---------- customer ----------
  app.get('/api/client/messages',async req=>{
    const s=authenticate(req),link=activeLink(s),q=parse(listQuery,req.query);
    if(q.photo_id)photoAllowed(s,q.photo_id);
    const v=visible(link,q);
    const rows=db.all(`SELECT * FROM (SELECT m.*,p.filename ${v.sql} ORDER BY m.seq DESC LIMIT ?) ORDER BY seq`,...v.args,q.limit);
    return rows.map(m=>shape(m,m.author_role==='client'&&m.session_id===s.id));
  });
  // Studio messages a share link has not read yet (album-wide cursor plus per-photo cursors).
  function unread(link){
    const v=visible(link,{after:cursor(link.project_id,linkReader(link))});
    const rows=db.all(`SELECT m.photo_id,count(*) AS n ${v.sql} AND m.author_role='staff'
      AND (m.photo_id IS NULL OR m.seq>COALESCE((SELECT last_seq FROM read_cursors WHERE project_id=m.project_id AND reader=?||m.photo_id),0))
      GROUP BY m.photo_id`,...v.args,`link:${link.id}:photo:`);
    return {total:rows.reduce((n,r)=>n+r.n,0),chat:rows.find(r=>!r.photo_id)?.n||0,photos:Object.fromEntries(rows.filter(r=>r.photo_id).map(r=>[r.photo_id,r.n]))};
  }
  app.get('/api/client/messages/unread',async req=>{const s=authenticate(req);return unread(activeLink(s));});
  app.post('/api/client/messages',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
    const s=authenticate(req),link=activeLink(s);
    const b=parse(z.object({body,photo_id:z.string().uuid().optional(),x:point.nullable().optional(),y:point.nullable().optional()}).strict(),req.body);
    if((b.x==null)!==(b.y==null)||(b.x!=null&&!b.photo_id))fail(400,'Vị trí ghim không hợp lệ');
    const photo=b.photo_id?photoAllowed(s,b.photo_id):null;
    // Posting does not move the read cursor: unread studio replies elsewhere stay unread.
    const m=insert({project_id:link.project_id,photo_id:photo?.id,x:b.x??null,y:b.y??null,author_role:'client',session_id:s.id,author_name:s.name,text:b.body});
    notify(photo?'note':'message',link.project_id,`${s.name} (${photo?`ảnh ${photo.filename}`:'tin nhắn'}): ${b.body.length>80?b.body.slice(0,80)+'…':b.body}`);
    return shape(m,true);
  });
  app.post('/api/client/messages/read',async req=>{
    const s=authenticate(req),link=activeLink(s),b=parse(z.object({photo_id:z.string().uuid().optional()}).strict(),req.body||{});
    if(b.photo_id)photoAllowed(s,b.photo_id);
    const v=visible(link,{photo_id:b.photo_id});
    const last=db.get(`SELECT max(m.seq) AS n ${v.sql}`,...v.args)?.n||0;
    advance(link.project_id,b.photo_id?photoReader(link,b.photo_id):linkReader(link),last);return {ok:true,last_seq:last};
  });
  app.get('/api/client/events',async(req,reply)=>{
    const s=authenticate(req),link=activeLink(s);
    const canSee=photoID=>{try{photoAllowed(s,photoID);return true;}catch{return false;}};
    return stream(req,reply,{role:'client',key:`session:${s.id}`,projectID:link.project_id,canSee},()=>authenticate(req));
  });

  // ---------- studio ----------
  app.get('/api/admin/projects/:id/messages',async req=>{
    const s=authenticate(req,true);project(req.params.id);const q=parse(listQuery,req.query);
    return adminRows(req.params.id,q).map(m=>shape(m,m.author_role==='staff'&&m.user_id===s.user_id));
  });
  app.post('/api/admin/projects/:id/messages',async req=>{
    const s=authenticate(req,true),p=project(req.params.id);
    const b=parse(z.object({body,photo_id:z.string().uuid().optional()}).strict(),req.body);
    if(b.photo_id&&!db.get('SELECT id FROM photos WHERE id=? AND project_id=?',b.photo_id,p.id))fail(404,'Không tìm thấy ảnh');
    const m=insert({project_id:p.id,photo_id:b.photo_id||null,author_role:'staff',user_id:s.user_id,author_name:`${config.studioName||config.brand} · ${s.user.name}`,text:b.body});
    // Replying means the studio has seen the conversation up to this point.
    if(advance(p.id,'staff',m.seq))hub.staff({type:'read',project_id:p.id});
    return shape(m,true);
  });
  app.post('/api/admin/projects/:id/messages/read',async req=>{
    authenticate(req,true);const p=project(req.params.id);
    const b=parse(z.object({upto:z.number().int().min(0).optional()}).strict(),req.body||{});
    const last=db.get('SELECT max(seq) AS n FROM messages WHERE project_id=?',p.id)?.n||0;
    if(advance(p.id,'staff',Math.min(b.upto??last,last)))hub.staff({type:'read',project_id:p.id});return {ok:true};
  });
  app.patch('/api/admin/messages/:id',async req=>{
    authenticate(req,true);const b=parse(z.object({resolved:z.boolean()}).strict(),req.body);
    const m=db.get("SELECT * FROM messages WHERE id=? AND photo_id IS NOT NULL AND author_role='client'",req.params.id);if(!m)fail(404,'Không tìm thấy ghi chú');
    db.run('UPDATE messages SET resolved=? WHERE seq=?',+b.resolved,m.seq);
    hub.album(m.project_id,{type:'resolved',photo_id:m.photo_id});return {ok:true};
  });
  app.get('/api/admin/chats',async req=>{
    const f=access.staffFilter(authenticate(req,true),'m.project_id');
    return db.all(`SELECT m.project_id,p.name AS project_name,count(*) AS message_count,max(m.created_at) AS last_message,
      sum(CASE WHEN m.author_role='client' AND m.seq>COALESCE(rc.last_seq,0) THEN 1 ELSE 0 END) AS unread_count,
      (SELECT CASE WHEN l.photo_id IS NULL THEN l.body ELSE '[' || COALESCE(ph.filename,'ảnh') || '] ' || l.body END
        FROM messages l LEFT JOIN photos ph ON ph.id=l.photo_id WHERE l.project_id=m.project_id ORDER BY l.seq DESC LIMIT 1) AS last_body
      FROM messages m JOIN projects p ON p.id=m.project_id LEFT JOIN read_cursors rc ON rc.project_id=m.project_id AND rc.reader='staff'
      WHERE ${f.sql} GROUP BY m.project_id ORDER BY max(m.seq) DESC`,...f.args);
  });
  app.get('/api/admin/inbox',async req=>{
    const f=access.staffFilter(authenticate(req,true),'m.project_id');
    return db.all(`SELECT m.id,m.project_id,p.name AS project_name,m.photo_id,ph.filename,m.body,m.created_at,m.author_name AS sender_name,
      CASE WHEN m.photo_id IS NULL THEN 'message' ELSE 'comment' END AS kind
      FROM messages m JOIN projects p ON p.id=m.project_id LEFT JOIN photos ph ON ph.id=m.photo_id
      LEFT JOIN read_cursors rc ON rc.project_id=m.project_id AND rc.reader='staff'
      WHERE m.author_role='client' AND ((m.photo_id IS NOT NULL AND m.resolved=0) OR (m.photo_id IS NULL AND m.seq>COALESCE(rc.last_seq,0))) AND ${f.sql}
      ORDER BY m.seq DESC LIMIT 400`,...f.args);
  });
  app.get('/api/admin/projects/:id/comments',async(req,reply)=>{
    authenticate(req,true);project(req.params.id);
    const rows=db.all(`SELECT m.id,m.seq,m.photo_id,m.x,m.y,m.body,m.resolved,m.created_at,m.author_name AS client,p.filename,p.relative_path
      FROM messages m JOIN photos p ON p.id=m.photo_id WHERE m.project_id=? AND m.author_role='client' ORDER BY m.seq DESC`,req.params.id);
    if(req.query.format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="annotations.csv"')
      .send(csv([['File','Path','Client','X','Y','Comment','Resolved'],...rows.map(c=>[c.filename,c.relative_path,c.client,c.x??'',c.y??'',c.body,c.resolved])]));
    return rows;
  });
  app.get('/api/admin/notifications',async req=>{
    const s=authenticate(req,true),seen=s.user.notif_seen_seq||0,f=access.staffFilter(s,'n.project_id');
    const items=db.all(`SELECT n.*,p.name AS project_name FROM notifications n LEFT JOIN projects p ON p.id=n.project_id WHERE ${f.sql} ORDER BY n.seq DESC LIMIT 50`,...f.args)
      .map(n=>({...n,new:n.seq>seen}));
    return {items,unseen:db.get(`SELECT count(*) AS n FROM notifications n WHERE n.seq>? AND ${f.sql}`,seen,...f.args).n};
  });
  app.post('/api/admin/notifications/seen',async req=>{
    const s=authenticate(req,true);
    db.run('UPDATE staff_users SET notif_seen_seq=(SELECT COALESCE(max(seq),0) FROM notifications) WHERE id=?',s.user_id);return {ok:true};
  });
  app.get('/api/admin/events',async(req,reply)=>{
    const s=authenticate(req,true);
    // Re-read the account per event: a scope change or lock takes effect on open streams at once.
    const canSeeProject=projectID=>{const user=db.get('SELECT * FROM staff_users WHERE id=? AND disabled=0',s.user_id);return !!user&&access.canSeeProject({...s,user},projectID);};
    return stream(req,reply,{role:'staff',key:`user:${s.user_id}`,canSeeProject},()=>authenticate(req,true));
  });

  function stream(req,reply,sub,check){
    // A few tabs per browser session; customers can never take the slots staff need.
    if(hub.count(sub.key)>=6)fail(429,'Quá nhiều tab đang mở cùng lúc; hãy đóng bớt rồi tải lại trang');
    if(hub.size()>=500||(sub.role!=='staff'&&hub.clients()>=450))fail(503,'Quá nhiều kết nối realtime');
    reply.hijack();
    const res=reply.raw;
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff',Connection:'keep-alive'});
    res.write('retry: 5000\n\n');
    let remove=()=>{};
    // Heartbeats keep proxies from timing out idle streams and re-check that the
    // session/link is still valid, so a revoked link stops receiving events.
    const timer=setInterval(()=>{try{check();res.write(': ping\n\n');}catch{entry.stop();}},25_000);
    const entry={...sub,res,stop(){clearInterval(timer);remove();res.end();}};
    remove=hub.add(entry);
    req.raw.on('close',()=>{clearInterval(timer);remove();});
  }

  app.addHook('preClose',async()=>hub.close());
  return {notify,hub,unread};
}
