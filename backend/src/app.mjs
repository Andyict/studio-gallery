import {supportedFile,isVideo,serveVideo} from './media.mjs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { openDatabase } from './db.mjs';
import { id,token,digest,fail,hashPassword,verifyPassword,safePath,cleanRelative,descendant } from './security.mjs';
import { createScanner,nextScan } from './scanner.mjs';
import { createWorker,cacheFile } from './worker.mjs';
import { registerDownloads } from './downloads.mjs';
import { initializeSettings,registerSettings } from './settings.mjs';

const text=z.string().trim().min(1).max(160);
const uuid=z.string().uuid();
const setupUsername=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/,'Tên đăng nhập gồm 3–40 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới');
const parse=(schema,value)=>{const r=schema.safeParse(value); if(!r.success)fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return r.data;};
const csv=rows=>'\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');
const normalizePhone=value=>String(value||'').replace(/[^0-9]/g,'').replace(/^84(?=\d{9}$)/,'0');

export async function createApp(options={}) {
  const config={photoRoot:process.env.PHOTO_ROOT||'./.runtime/photos',dataDir:process.env.DATA_DIR||'./.runtime/data',cacheDir:process.env.CACHE_DIR||'./.runtime/cache',origin:process.env.PUBLIC_ORIGIN||'http://localhost:3210',adminPassword:process.env.ADMIN_PASSWORD||'',brand:process.env.APP_NAME||'Studio Gallery',maxZipFiles:2000,maxDownloads:2,ffmpeg:process.env.FFMPEG||'ffmpeg',exiftool:process.env.EXIFTOOL||'exiftool',appVersion:process.env.APP_VERSION||'0.1.0',updateRepo:process.env.UPDATE_REPO||'',updateCommand:process.env.UPDATE_COMMAND||'',background:true,...options};
  if(config.adminPassword&&config.adminPassword.length<8)throw new Error('ADMIN_PASSWORD must contain at least 8 characters');
  config.origin=new URL(config.origin).origin;
  await mkdir(config.dataDir,{recursive:true}); await mkdir(config.cacheDir,{recursive:true});
  const db=openDatabase(path.join(config.dataDir,'gallery.sqlite'));
  const app=Fastify({logger:options.logger??true,bodyLimit:64*1024,trustProxy:false,disableRequestLogging:true});
  await app.register(cookie);
  await app.register(rateLimit,{max:300,timeWindow:'1 minute'});
  await initializeSettings(db,config);
  for(const [column,type] of [['access_code_hash','TEXT'],['phone_hash','TEXT'],['phone_last4','TEXT']])if(!db.all('PRAGMA table_info(links)').some(c=>c.name===column))db.raw.exec(`ALTER TABLE links ADD COLUMN ${column} ${type}`);
  const dummyHash=await hashPassword(token());
  const scanner=createScanner(db,config,app.log);
  const worker=createWorker(db,config,app.log);
  const secure=config.origin.startsWith('https:');
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin!==config.origin)fail(403,'Origin không hợp lệ');
  });
  app.setErrorHandler((error,req,reply)=>{
    const status=error.statusCode|| (error.code==='ENOENT'?404:500);
    if(status>=500)app.log.error({err:error},'Request failed');
    reply.code(status).send({error:status>=500?'Lỗi máy chủ. Xem log để biết chi tiết.':error.message});
  });
  function activeLink(session) {
    const link=db.get('SELECT * FROM links WHERE id=? AND revoked=0',session.link_id);
    if(!link || (link.expires_at && link.expires_at<=new Date().toISOString()))fail(403,'Link đã hết hạn hoặc bị thu hồi');
    return link;
  }
  function authenticate(req,admin=false) {
    const raw=req.cookies[admin?'proof_admin':'proof_client'];
    const session=raw&&db.get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',digest(raw),new Date().toISOString());
    if(!session || session.role!==(admin?'admin':'client'))fail(401,'Vui lòng đăng nhập');
    if(admin){
      const user=db.get('SELECT * FROM staff_users WHERE id=? AND disabled=0',session.user_id||'');
      if(!user)fail(401,'Tài khoản đã bị khóa hoặc phiên đã hết hạn');
      session.user=user;
    }else activeLink(session);
    return session;
  }
  function scopes(link) {return link.scope==='all'?['']:db.all('SELECT f.relative_path FROM link_folders lf JOIN folders f ON f.id=lf.folder_id WHERE lf.link_id=?',link.id).map(f=>f.relative_path);}
  function photoAllowed(session,photoID) {
    const link=activeLink(session);
    const photo=db.get('SELECT p.*,f.relative_path AS folder_path FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.id=? AND p.project_id=? AND p.missing=0',photoID,link.project_id);
    if(!photo || !scopes(link).some(s=>descendant(photo.folder_path,s)))fail(404,'Không tìm thấy ảnh');
    return photo;
  }
  function listOwned(session,listID) {
    const link=activeLink(session),list=db.get('SELECT * FROM selection_lists WHERE id=? AND project_id=?',listID,link.project_id);
    if(!list)fail(404,'Không tìm thấy danh sách'); return list;
  }
  function photosFor(session,{folder_id,list_id,search='',limit=config.maxZipFiles+1,offset=0}={}) {
    const link=activeLink(session); const allowed=scopes(link);
    if(!allowed.length)return [];
    const args=[link.project_id];
    const clauses=['p.project_id=?','p.missing=0'];
    clauses.push('('+allowed.map(s=>{args.push(s,s,s.length+1);return "(f.relative_path=? OR substr(f.relative_path,1,?)=?)";}).join(' OR ')+')');
    // Build scope predicates explicitly so paths containing SQL wildcard characters stay literal.
    args.length=1;
    clauses[2]='('+allowed.map(s=>{
      if(s==='')return '1=1';
      args.push(s,s.length+1,`${s}/`);return '(f.relative_path=? OR substr(f.relative_path,1,?)=?)';
    }).join(' OR ')+')';
    if(folder_id) {
      const folder=db.get('SELECT * FROM folders WHERE id=? AND project_id=? AND missing=0',folder_id,link.project_id);
      if(!folder || !allowed.some(s=>descendant(folder.relative_path,s)))fail(404,'Không tìm thấy thư mục');
      if(folder.relative_path===''){clauses.push('p.folder_id=?');args.push(folder.id);}
      else {clauses.push('(f.relative_path=? OR substr(f.relative_path,1,?)=?)');args.push(folder.relative_path,folder.relative_path.length+1,`${folder.relative_path}/`);}
    }
    if(list_id){listOwned(session,list_id);clauses.push('EXISTS(SELECT 1 FROM client_selections cs WHERE cs.photo_id=p.id AND cs.list_id=?)');args.push(list_id);}
    if(search){clauses.push('instr(lower(p.filename),lower(?))>0');args.push(search);}
    return db.all(`SELECT p.* FROM photos p JOIN folders f ON f.id=p.folder_id WHERE ${clauses.join(' AND ')} ORDER BY p.relative_path COLLATE NOCASE,p.id LIMIT ? OFFSET ?`,...args,limit,offset);
  }
  function createSession(reply,{role,link_id=null,name,user_id=null}) {
    const raw=token(), sid=id();
    db.run('INSERT INTO sessions(id,token_hash,role,link_id,name,expires_at,user_id) VALUES(?,?,?,?,?,?,?)',sid,digest(raw),role,link_id,name,new Date(Date.now()+(role==='admin'?config.adminSessionHours*3600:30*86400)*1000).toISOString(),user_id);
    reply.setCookie(role==='admin'?'proof_admin':'proof_client',raw,{path:'/',httpOnly:true,secure,sameSite:'strict',maxAge:role==='admin'?config.adminSessionHours*3600:30*86400});
    return sid;
  }
  app.get('/api/health',async()=>{db.get('SELECT 1');return {ok:true};});
  app.get('/api/config',async()=>({name:config.brand,studioName:config.studioName,contactEmail:config.contactEmail,welcomeMessage:config.welcomeMessage,logoUrl:config.logoPath?`/api/logo?v=${config.logoVersion}`:null}));
  app.get('/api/logo',async(req,reply)=>{if(!config.logoPath)fail(404,'Chưa có logo');await stat(config.logoPath);return reply.type(config.logoMime).header('Cache-Control','public, max-age=86400, immutable').send(createReadStream(config.logoPath));});
  app.get('/api/setup/status',async()=>({required:!db.get('SELECT id FROM staff_users LIMIT 1')}));
  app.post('/api/setup',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async(req,reply)=>{
    const body=parse(z.object({username:setupUsername,name:z.string().trim().min(1).max(100),password:z.string().min(8).max(256)}).strict(),req.body);
    if(db.get('SELECT id FROM staff_users LIMIT 1'))fail(409,'Studio đã được thiết lập');
    const passwordHash=await hashPassword(body.password),userId=id();
    db.transaction(()=>{
      // Recheck in the write transaction so two first-run requests cannot both win.
      if(db.get('SELECT id FROM staff_users LIMIT 1'))fail(409,'Studio đã được thiết lập');
      db.run('INSERT INTO staff_users(id,username,name,password_hash,role) VALUES(?,?,?,?,?)',userId,body.username,body.name,passwordHash,'admin');
      db.run('INSERT INTO audit_log(id,actor_id,action,target) VALUES(?,?,?,?)',id(),userId,'setup.complete',userId);
    });
    createSession(reply,{role:'admin',name:body.name,user_id:userId});
    return reply.code(201).send({ok:true});
  });
  app.post('/api/access',{config:{rateLimit:{max:15,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const b=parse(z.object({phone:z.string().max(30)}).strict(),req.body);
    const phone=normalizePhone(b.phone);if(phone.length<9)fail(400,'Số điện thoại không hợp lệ');
    const link=db.get('SELECT * FROM links WHERE phone_hash=? AND revoked=0 AND (expires_at IS NULL OR expires_at>?) ORDER BY rowid DESC LIMIT 1',digest(phone),new Date().toISOString());
    if(!link)fail(401,'Không tìm thấy album đang hoạt động cho số điện thoại này');
    const sid=createSession(reply,{role:'client',link_id:link.id,name:`Khách • ${phone.slice(-4)}`});
    if(!db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,'Ảnh làm album'))db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',id(),link.project_id,sid,'Ảnh làm album');
    return {ok:true,url:'/album'};
  });
  app.post('/api/admin/login',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const body=parse(z.object({username:z.string().trim().toLowerCase().max(40).default('admin'),password:z.string().max(256)}),req.body);
    const user=db.get('SELECT * FROM staff_users WHERE username=?',body.username);
    const valid=await verifyPassword(body.password,user?.password_hash||dummyHash);
    const current=user&&db.get('SELECT * FROM staff_users WHERE id=?',user.id);
    if(!valid||!current||current.disabled||current.password_hash!==user.password_hash)fail(401,'Tên đăng nhập hoặc mật khẩu không đúng');
    createSession(reply,{role:'admin',name:user.name,user_id:user.id});return {ok:true};
  });
  app.get('/api/admin/me',async req=>{const s=authenticate(req,true);return {id:s.user.id,username:s.user.username,name:s.user.name,role:s.user.role};});
  registerSettings(app,{db,config,authenticate});
  app.post('/api/logout',async(req,reply)=>{
    for(const key of ['proof_admin','proof_client']) {if(req.cookies[key])db.run('UPDATE sessions SET expires_at=? WHERE token_hash=?',new Date().toISOString(),digest(req.cookies[key]));reply.clearCookie(key,{path:'/'});}
    return {ok:true};
  });
  app.get('/api/admin/directories',async req=>{
    authenticate(req,true); const relative=cleanRelative(req.query.path||'');
    const entries=await readdir(await safePath(config.photoRoot,relative),{withFileTypes:true});
    return {path:relative,folders:entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['@eaDir','#recycle'].includes(e.name)).map(e=>({name:e.name,path:relative?`${relative}/${e.name}`:e.name}))};
  });
  app.get('/api/admin/sources',async req=>{authenticate(req,true);return db.all('SELECT * FROM approved_sources ORDER BY label,relative_path').map(s=>({...s,enabled:!!s.enabled}));});
  app.post('/api/admin/sources',async(req,reply)=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được quản lý nguồn ảnh');
    const b=parse(z.object({relative_path:z.string().max(1024),label:text}),req.body),relative=cleanRelative(b.relative_path);
    if(!(await stat(await safePath(config.photoRoot,relative))).isDirectory())fail(400,'Nguồn ảnh không phải thư mục');
    const existing=db.get('SELECT * FROM approved_sources WHERE relative_path=?',relative);
    if(existing){db.run('UPDATE approved_sources SET label=?,enabled=1 WHERE id=?',b.label,existing.id);return {id:existing.id};}
    const sid=id();db.run('INSERT INTO approved_sources(id,relative_path,label) VALUES(?,?,?)',sid,relative,b.label);return reply.code(201).send({id:sid});
  });
  app.patch('/api/admin/sources/:id',async req=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được quản lý nguồn ảnh');
    const b=parse(z.object({label:text,enabled:z.boolean()}),req.body),source=db.get('SELECT * FROM approved_sources WHERE id=?',req.params.id);if(!source)fail(404,'Không tìm thấy nguồn ảnh');
    if(!b.enabled&&db.get("SELECT 1 FROM projects WHERE root=? OR substr(root,1,?)=? LIMIT 1",source.relative_path,source.relative_path.length+1,`${source.relative_path}/`))fail(409,'Nguồn đang được một bộ ảnh sử dụng');
    db.run('UPDATE approved_sources SET label=?,enabled=? WHERE id=?',b.label,+b.enabled,source.id);return {ok:true};
  });
  app.post('/api/admin/sources/:id/discover',async(req,reply)=>{
    authenticate(req,true);const source=db.get('SELECT * FROM approved_sources WHERE id=? AND enabled=1',req.params.id);if(!source)fail(404,'Nguồn ảnh chưa được bật');
    const root=await safePath(config.photoRoot,source.relative_path),entries=await readdir(root,{withFileTypes:true});
    const folders=entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['@eaDir','#recycle','.snapshot'].includes(e.name));
    const candidates=[];
    for(const folder of folders){
      const children=await readdir(path.join(root,folder.name),{withFileTypes:true});
      const nested=children.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['@eaDir','#recycle','.snapshot'].includes(e.name));
      const hasDirectPhotos=children.some(e=>e.isFile()&&supportedFile(e.name));
      if(nested.length&&!hasDirectPhotos){
        for(const child of nested)candidates.push(`${folder.name}/${child.name}`);
      }else candidates.push(folder.name);
    }
    const created=[];const existing=[];
    for(const candidate of candidates){
      const relative=source.relative_path?`${source.relative_path}/${candidate}`:candidate;
      const found=db.get('SELECT * FROM projects WHERE root=?',relative);
      if(found){existing.push(found);continue;}
      const folderName=path.posix.basename(candidate),name=folderName.replace(/^\d{4}-\d{2}-\d{2}[._ -]*/,'').replace(/^\d+[._ -]*/,'').replaceAll('_',' ').replace(/\s+/g,' ').trim()||folderName;
      const pid=id();db.run('INSERT INTO projects(id,name,root,cron,timezone,next_scan) VALUES(?,?,?,?,?,?)',pid,name,relative,config.defaultCron,config.defaultTimezone,nextScan(config.defaultCron,config.defaultTimezone));
      created.push(db.get('SELECT * FROM projects WHERE id=?',pid));
    }
    const scanStarted=created.length?scanner.batch(created):false;
    return reply.code(202).send({source:{id:source.id,label:source.label,path:source.relative_path},found:candidates.length,created:created.length,existing:existing.length,scanStarted,albums:created.map(p=>({id:p.id,name:p.name,root:p.root}))});
  });
  app.get('/api/admin/update/check',async req=>{
    authenticate(req,true);
    if(!config.updateRepo)return {configured:false,current:config.appVersion,latest:null,updateAvailable:false};
    const response=await fetch(`https://api.github.com/repos/${config.updateRepo}/releases/latest`,{headers:{accept:'application/vnd.github+json','user-agent':'studio-gallery'}});
    if(!response.ok)fail(502,'Không kiểm tra được bản cập nhật GitHub');
    const release=await response.json();
    return {configured:true,current:config.appVersion,latest:release.tag_name||release.name||null,updateAvailable:Boolean(release.tag_name&&release.tag_name!==config.appVersion),url:release.html_url||null,notes:release.body||''};
  });
  app.post('/api/admin/update',async req=>{
    authenticate(req,true);
    if(!config.updateCommand)fail(503,'Chưa cấu hình UPDATE_COMMAND trên máy chủ');
    const {spawn}=await import('node:child_process');
    spawn(config.updateCommand,{shell:true,detached:true,stdio:'ignore',env:{...process.env,UPDATE_REQUESTED:'1'}}).unref();
    return {accepted:true,message:'Đang cập nhật và khởi động lại dịch vụ.'};
  });
  app.get('/api/admin/projects',async req=>{
    authenticate(req,true);
    return db.all(`SELECT p.*,(SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0) AS photo_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND status='ready') AS ready_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND status='failed') AS failed_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=1) AS missing_count,
      (SELECT count(*) FROM links WHERE project_id=p.id AND revoked=0 AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)) AS access_count,
      (SELECT count(*) FROM client_selections WHERE project_id=p.id) AS favorite_count,
      (SELECT count(*) FROM selection_lists WHERE project_id=p.id AND submitted_at IS NOT NULL) AS submitted_count,
      (SELECT count(*) FROM comments WHERE project_id=p.id AND resolved=0) AS open_comment_count,
      (SELECT max(created_at) FROM comments WHERE project_id=p.id) AS last_client_activity
      FROM projects p ORDER BY created_at DESC`)
      .map(p=>({...p,scan:db.get('SELECT * FROM scan_runs WHERE project_id=? ORDER BY rowid DESC LIMIT 1',p.id)||null}));
  });
  app.post('/api/admin/projects',async(req,reply)=>{
    authenticate(req,true);
    const p=parse(z.object({name:text,root:z.string().max(1024),cron:z.string().max(80).default(config.defaultCron),timezone:z.string().max(80).default(config.defaultTimezone)}),req.body);
    const root=cleanRelative(p.root);
    if(!(await stat(await safePath(config.photoRoot,root))).isDirectory())fail(400,'Chọn một thư mục');
    const approved=db.all('SELECT relative_path FROM approved_sources WHERE enabled=1');
    if(!approved.some(s=>descendant(root,s.relative_path)))fail(403,'Hãy bật quyền truy cập nguồn ảnh này trong Cài đặt trước');
    if(db.get('SELECT id FROM projects WHERE root=?',root))fail(409,'Thư mục đã có trong project');
    const pid=id();db.run('INSERT INTO projects(id,name,root,cron,timezone,next_scan) VALUES(?,?,?,?,?,?)',pid,p.name,root,p.cron,p.timezone,nextScan(p.cron,p.timezone));
    scanner.start(db.get('SELECT * FROM projects WHERE id=?',pid));
    return reply.code(201).send({id:pid});
  });
  app.patch('/api/admin/projects/:id',async req=>{
    authenticate(req,true);const p=parse(z.object({name:text,cron:z.string().max(80),timezone:z.string().max(80),editor:z.string().trim().max(120).optional(),internal_note:z.string().trim().max(2000).optional()}),req.body);
    if(!db.get('SELECT id FROM projects WHERE id=?',req.params.id))fail(404,'Không tìm thấy project');
    db.run('UPDATE projects SET name=?,cron=?,timezone=?,next_scan=?,editor=COALESCE(?,editor),internal_note=COALESCE(?,internal_note) WHERE id=?',p.name,p.cron,p.timezone,nextScan(p.cron,p.timezone),p.editor,p.internal_note,req.params.id);return {ok:true};
  });
  app.post('/api/admin/projects/:id/sync',async(req,reply)=>{
    authenticate(req,true);const p=db.get('SELECT * FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy project');
    const started=scanner.start(p); return reply.code(202).send({started});
  });
  app.post('/api/admin/projects/:id/retry',async req=>{
    authenticate(req,true);db.run("UPDATE jobs SET status='pending',attempts=0 WHERE status='failed' AND photo_id IN(SELECT id FROM photos WHERE project_id=?)",req.params.id);return {ok:true};
  });
  app.get('/api/admin/projects/:id/folders',async req=>{authenticate(req,true);return db.all('SELECT * FROM folders WHERE project_id=? AND missing=0 ORDER BY relative_path',req.params.id);});
  app.get('/api/admin/projects/:id/photos',async req=>{
    authenticate(req,true);const folderID=req.query.folder_id||'',args=[req.params.id];let folderClause='';
    if(folderID){const folder=db.get('SELECT * FROM folders WHERE id=? AND project_id=? AND missing=0',folderID,req.params.id);if(!folder)fail(404,'Không tìm thấy thư mục');folderClause=folder.relative_path?' AND (f.relative_path=? OR substr(f.relative_path,1,?)=?)':' ';if(folder.relative_path)args.push(folder.relative_path,folder.relative_path.length+1,`${folder.relative_path}/`);}
    return db.all(`SELECT p.id,p.filename,p.extension,p.relative_path,p.width,p.height,p.bytes,p.status,p.missing,p.folder_id,
      (SELECT count(*) FROM client_selections cs WHERE cs.photo_id=p.id) AS favorite_count,
      (SELECT count(*) FROM comments c WHERE c.photo_id=p.id AND c.resolved=0) AS open_comment_count
      FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.project_id=? AND p.missing=0${folderClause}
      ORDER BY p.relative_path COLLATE NOCASE LIMIT 10000`,...args);
  });
  app.get('/api/admin/projects/:id/links',async req=>{authenticate(req,true);return db.all('SELECT id,label,scope,downloads,originals,expires_at,revoked,created_at,phone_last4 FROM links WHERE project_id=? ORDER BY rowid DESC',req.params.id);});
  app.post('/api/admin/projects/:id/links',async(req,reply)=>{
    authenticate(req,true);const p=db.get('SELECT id FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy project');
    const b=parse(z.object({label:text,password:z.string().max(256).default(''),phone:z.string().max(30).default(''),folder_ids:z.array(uuid).max(100).default([]),downloads:z.boolean().default(config.defaultDownloads),originals:z.boolean().default(config.defaultOriginals),expires_at:z.string().datetime().nullable().default(null)}),req.body);
    if(b.expires_at&&b.expires_at<=new Date().toISOString())fail(400,'Hạn dùng phải ở tương lai');
    for(const fid of b.folder_ids)if(!db.get('SELECT id FROM folders WHERE id=? AND project_id=? AND missing=0',fid,p.id))fail(400,'Thư mục không thuộc project');
    const phone=normalizePhone(b.phone);if(b.phone&&phone.length<9)fail(400,'Số điện thoại không hợp lệ');
    const raw=token(),lid=id(),hash=b.password?await hashPassword(b.password):null;
    db.transaction(()=>{
      db.run('INSERT INTO links(id,project_id,label,token_hash,password_hash,scope,downloads,originals,expires_at,access_code_hash,phone_hash,phone_last4) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',lid,p.id,b.label,digest(raw),hash,b.folder_ids.length?'folders':'all',+b.downloads,+b.originals,b.expires_at,null,phone?digest(phone):null,phone?phone.slice(-4):null);
      for(const fid of new Set(b.folder_ids))db.run('INSERT INTO link_folders(project_id,link_id,folder_id) VALUES(?,?,?)',p.id,lid,fid);
    });
    return reply.code(201).send({id:lid,url:`${config.origin}/g/${raw}`,portal:phone?config.origin:null});
  });
  app.post('/api/admin/links/:id/revoke',async req=>{authenticate(req,true);db.run('UPDATE links SET revoked=1 WHERE id=?',req.params.id);return {ok:true};});
  app.get('/api/share/:token',async req=>{
    const link=db.get('SELECT * FROM links WHERE token_hash=? AND revoked=0',digest(req.params.token));
    if(!link || (link.expires_at&&link.expires_at<=new Date().toISOString()))fail(404,'Link không tồn tại hoặc đã hết hạn');
    return {name:db.get('SELECT name FROM projects WHERE id=?',link.project_id).name,password_required:!!link.password_hash};
  });
  app.post('/api/share/:token/unlock',{config:{rateLimit:{max:15,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const b=parse(z.object({name:text,password:z.string().max(256).default('')}),req.body);
    const link=db.get('SELECT * FROM links WHERE token_hash=? AND revoked=0',digest(req.params.token));
    if(!link || (link.expires_at&&link.expires_at<=new Date().toISOString()))fail(404,'Link không tồn tại hoặc đã hết hạn');
    if(link.password_hash&&!await verifyPassword(b.password,link.password_hash))fail(401,'PIN / mật khẩu không đúng');
    const existing=req.cookies.proof_client&&db.get('SELECT * FROM sessions WHERE token_hash=? AND link_id=? AND expires_at>?',digest(req.cookies.proof_client),link.id,new Date().toISOString());
    if(existing)return {ok:true};
    const sid=createSession(reply,{role:'client',link_id:link.id,name:b.name});
    if(!db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,'Ảnh làm album'))db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',id(),link.project_id,sid,'Ảnh làm album');return {ok:true};
  });
  app.get('/api/client/gallery',async req=>{
    const s=authenticate(req),link=activeLink(s),allowed=scopes(link);
    if(req.query.token&&digest(req.query.token)!==link.token_hash)fail(401,'Vui lòng mở link này');
    const folders=db.all('SELECT id,relative_path,name FROM folders WHERE project_id=? AND missing=0 ORDER BY relative_path',link.project_id).filter(f=>allowed.some(scope=>descendant(f.relative_path,scope)));
    return {project:db.get('SELECT id,name FROM projects WHERE id=?',link.project_id),client:s.name,downloads:!!link.downloads,originals:!!link.originals,folders,lists:db.all('SELECT l.*, (SELECT count(*) FROM client_selections WHERE list_id=l.id) AS count FROM selection_lists l WHERE project_id=? ORDER BY rowid',link.project_id)};
  });
  app.get('/api/client/photos',async req=>{
    const s=authenticate(req);
    const q=parse(z.object({folder_id:uuid.optional(),list_id:uuid.optional(),search:z.string().max(160).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(120).default(60)}),req.query);
    const photos=photosFor(s,{...q,limit:q.limit+1}); const more=photos.length>q.limit;
    const link=activeLink(s);return {more,photos:photos.slice(0,q.limit).map(p=>({id:p.id,filename:p.filename,width:p.width,height:p.height,status:p.status,extension:p.extension,folder_id:p.folder_id,selected_in:db.all('SELECT c.list_id FROM client_selections c JOIN selection_lists l ON l.id=c.list_id WHERE c.photo_id=? AND l.project_id=?',p.id,link.project_id).map(x=>x.list_id),comments:db.get('SELECT count(*) AS n FROM comments WHERE photo_id=? AND project_id=?',p.id,link.project_id).n}))};
  });
  app.get('/api/client/photos/:id/:variant',async(req,reply)=>{
    const s=authenticate(req),photo=photoAllowed(s,req.params.id);
    if(req.params.variant==='video'&&isVideo(photo)){if(photo.status!=='ready')fail(409,'Video đang xử lý');return serveVideo(req,reply,cacheFile(config,photo,'video'));}
    if(!['thumb','preview'].includes(req.params.variant))fail(404,'Không tìm thấy ảnh');
    if(photo.status!=='ready')fail(409,'Preview chưa sẵn sàng');
    const file=cacheFile(config,photo,req.params.variant);await stat(file);
    return reply.type('image/webp').header('Cache-Control','private, no-store').send(createReadStream(file));
  });
  app.post('/api/client/lists',async req=>{const s=authenticate(req),link=activeLink(s),b=parse(z.object({name:text}),req.body);if(db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,b.name))fail(409,'Tên danh sách đã có');const lid=id();db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',lid,link.project_id,s.id,b.name);return {id:lid};});
  app.put('/api/client/lists/:id/photos/:photo',async req=>{
    const s=authenticate(req),list=listOwned(s,req.params.id),photo=photoAllowed(s,req.params.photo),b=parse(z.object({selected:z.boolean()}),req.body);
    if(list.submitted_at)fail(409,'Danh sách đã chốt; mở lại trước khi thay đổi');
    if(b.selected)db.run('INSERT OR IGNORE INTO client_selections(project_id,list_id,photo_id) VALUES(?,?,?)',photo.project_id,list.id,photo.id);
    else db.run('DELETE FROM client_selections WHERE list_id=? AND photo_id=?',list.id,photo.id);return {ok:true};
  });
  app.post('/api/client/lists/:id/submit',async req=>{const s=authenticate(req),list=listOwned(s,req.params.id),b=parse(z.object({submitted:z.boolean()}),req.body);db.run('UPDATE selection_lists SET submitted_at=? WHERE id=?',b.submitted?new Date().toISOString():null,list.id);return {ok:true};});
  app.get('/api/client/lists/:id/export',async req=>{
    const s=authenticate(req);listOwned(s,req.params.id);const photos=photosFor(s,{list_id:req.params.id,limit:100001});if(photos.length>100000)fail(400,'Danh sách quá lớn');return {search_string:[...new Set(photos.map(p=>p.stem))].join(', '),count:photos.length};
  });
  app.get('/api/client/photos/:id/comments',async req=>{const s=authenticate(req),photo=photoAllowed(s,req.params.id);return db.all('SELECT id,x,y,body,resolved,created_at FROM comments WHERE photo_id=? AND project_id=? ORDER BY rowid',req.params.id,photo.project_id);});
  app.post('/api/client/photos/:id/comments',async req=>{
    const s=authenticate(req),p=photoAllowed(s,req.params.id),b=parse(z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),body:z.string().trim().min(1).max(2000)}),req.body);
    const cid=id();db.run('INSERT INTO comments(id,project_id,photo_id,session_id,x,y,body) VALUES(?,?,?,?,?,?,?)',cid,p.project_id,p.id,s.id,b.x,b.y,b.body);return {id:cid};
  });
  app.get('/api/admin/projects/:id/selections',async req=>{authenticate(req,true);return db.all(`SELECT l.*,s.name AS client,(SELECT count(*) FROM client_selections WHERE list_id=l.id) AS count,
    (SELECT count(*) FROM client_selections cs JOIN photos p ON p.id=cs.photo_id WHERE cs.list_id=l.id AND p.missing=1) AS missing_count FROM selection_lists l JOIN sessions s ON s.id=l.session_id WHERE l.project_id=? ORDER BY l.created_at DESC`,req.params.id);});
  app.get('/api/admin/lists/:id/export',async(req,reply)=>{
    authenticate(req,true);const rows=db.all('SELECT p.filename,p.stem,p.relative_path,p.missing FROM client_selections c JOIN photos p ON p.id=c.photo_id WHERE c.list_id=? ORDER BY p.relative_path',req.params.id);
    if(req.query.format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="selections.csv"').send(csv([['Filename','Path','Missing'],...rows.map(p=>[p.filename,p.relative_path,p.missing])]));
    return {search_string:[...new Set(rows.filter(p=>!p.missing).map(p=>p.stem))].join(', '),count:rows.length,missing_count:rows.filter(p=>p.missing).length};
  });
  app.get('/api/client/chat',async req=>{const s=authenticate(req),link=activeLink(s);return db.all('SELECT id,sender_role,sender_name,body,created_at FROM chat_messages WHERE project_id=? ORDER BY created_at,id',link.project_id);});
  app.post('/api/client/chat',async req=>{const s=authenticate(req),link=activeLink(s),b=parse(z.object({body:z.string().trim().min(1).max(2000)}),req.body),mid=id();db.run('INSERT INTO chat_messages(id,project_id,session_id,sender_role,sender_name,body) VALUES(?,?,?,?,?,?)',mid,link.project_id,s.id,'client',s.name,b.body);return {id:mid};});
  app.get('/api/admin/lists/:id/photos',async req=>{
    authenticate(req,true);if(!db.get('SELECT id FROM selection_lists WHERE id=?',req.params.id))fail(404,'Không tìm thấy danh sách');
    return db.all(`SELECT p.id,p.filename,p.extension,p.relative_path,p.width,p.height,p.status,p.missing,
      (SELECT count(*) FROM comments c WHERE c.photo_id=p.id AND c.project_id=p.project_id) AS comment_count
      FROM client_selections cs JOIN photos p ON p.id=cs.photo_id JOIN selection_lists l ON l.id=cs.list_id
      WHERE cs.list_id=? ORDER BY cs.created_at`,req.params.id);
  });
  app.get('/api/admin/photos/:id/:variant',async(req,reply)=>{
    authenticate(req,true);const photo=db.get('SELECT * FROM photos WHERE id=?',req.params.id);if(!photo)fail(404,'Không tìm thấy ảnh');
    if(req.params.variant==='video'&&isVideo(photo)){if(photo.status!=='ready')fail(409,'Video đang xử lý');return serveVideo(req,reply,cacheFile(config,photo,'video'));}
    if(!['thumb','preview'].includes(req.params.variant))fail(404,'Không tìm thấy ảnh');if(photo.status!=='ready')fail(409,'Preview chưa sẵn sàng');
    const file=cacheFile(config,photo,req.params.variant);await stat(file);return reply.type('image/webp').header('Cache-Control','private, no-store').send(createReadStream(file));
  });
  app.get('/api/admin/projects/:id/comments',async(req,reply)=>{
    authenticate(req,true);const rows=db.all('SELECT c.*,p.filename,p.relative_path,s.name AS client FROM comments c JOIN photos p ON p.id=c.photo_id JOIN sessions s ON s.id=c.session_id WHERE c.project_id=? ORDER BY c.created_at DESC',req.params.id);
    if(req.query.format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="annotations.csv"').send(csv([['File','Path','Client','X','Y','Comment','Resolved'],...rows.map(c=>[c.filename,c.relative_path,c.client,c.x,c.y,c.body,c.resolved])]));return rows;
  });
  app.get('/api/admin/chats',async req=>{authenticate(req,true);return db.all(`SELECT project_id,p.name AS project_name,count(*) AS message_count,max(c.created_at) AS last_message,
    sum(CASE WHEN c.sender_role='client' AND c.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
    FROM chat_messages c JOIN projects p ON p.id=c.project_id GROUP BY project_id ORDER BY last_message DESC`);});
  app.get('/api/admin/projects/:id/chat',async req=>{authenticate(req,true);return db.all('SELECT id,sender_role,sender_name,body,created_at FROM chat_messages WHERE project_id=? ORDER BY created_at,id',req.params.id);});
  app.post('/api/admin/projects/:id/chat',async req=>{authenticate(req,true);const b=parse(z.object({body:z.string().trim().min(1).max(2000)}),req.body),mid=id();db.run('INSERT INTO chat_messages(id,project_id,sender_role,sender_name,body) VALUES(?,?,?,?,?)',mid,req.params.id,'admin','Studio',b.body);return {id:mid};});
  app.patch('/api/admin/projects/:id/chat/read',async req=>{authenticate(req,true);db.run("UPDATE chat_messages SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE project_id=? AND sender_role='client'",req.params.id);return {ok:true};});
  app.patch('/api/admin/comments/:id',async req=>{authenticate(req,true);const b=parse(z.object({resolved:z.boolean()}),req.body);db.run('UPDATE comments SET resolved=? WHERE id=?',+b.resolved,req.params.id);return {ok:true};});
  registerDownloads(app,{db,config,authenticate,photoAllowed,listOwned,photosFor,activeLink});
  const timers=[];
  if(config.background){timers.push(setInterval(()=>scanner.tick(),30_000));timers.push(setInterval(()=>worker.tick()?.catch(e=>app.log.error(e)),500));}
  timers.push(setInterval(()=>db.run('DELETE FROM download_tickets WHERE expires_at<?',new Date().toISOString()),60_000));
  for(const t of timers)t.unref();
  app.addHook('onClose',async()=>{timers.forEach(clearInterval);await scanner.stop();await worker.stop();db.close();});
  app.decorate('services',{db,config,scanner,worker});
  return app;
}
