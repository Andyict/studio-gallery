import {photoPath,sharedFolders} from './shares.mjs';
import {supportedFile,isVideo,serveVideo} from './media.mjs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { readdir, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from './db.mjs';
import { id,token,digest,fail,hashPassword,verifyPassword,safePath,safeOpen,cleanRelative,descendant } from './security.mjs';
import { createScanner,nextScan } from './scanner.mjs';
import { createWorker,cacheFile } from './worker.mjs';
import { createPreviews,synologyThumb } from './previews.mjs';
import { registerUpdates } from './updates.mjs';
import { initializeLifecycle,registerLifecycle } from './lifecycle.mjs';
import { initializePairing,pairAll } from './pairing.mjs';
import { createOutbound,registerOutbound } from './outbound.mjs';
import { registerDownloads } from './downloads.mjs';
import { initializeSettings,registerSettings } from './settings.mjs';
import { initializeMessages,registerMessages } from './messages.mjs';
import { initializeWorkflow,registerWorkflow,finalSql,isFinalPath,markFinals } from './workflow.mjs';
import { initializeCustomers,registerCustomers,normalizePhone } from './customers.mjs';
import { initializeAssignments,registerAssignments,createAccess } from './assignments.mjs';

const text=z.string().trim().min(1).max(160);
const uuid=z.string().uuid();
const setupUsername=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/,'Tên đăng nhập gồm 3–40 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới');
const parse=(schema,value)=>{const r=schema.safeParse(value); if(!r.success)fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return r.data;};
const csv=rows=>'\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');

export async function createApp(options={}) {
  const config={photoRoot:process.env.PHOTO_ROOT||'./.runtime/photos',dataDir:process.env.DATA_DIR||'./.runtime/data',cacheDir:process.env.CACHE_DIR||'./.runtime/cache',origin:process.env.PUBLIC_ORIGIN||'http://localhost:3210',adminPassword:process.env.ADMIN_PASSWORD||'',brand:process.env.APP_NAME||'Studio Gallery',maxZipFiles:2000,maxDownloads:2,ffmpeg:process.env.FFMPEG||'ffmpeg',exiftool:process.env.EXIFTOOL||'exiftool',appVersion:process.env.APP_VERSION||'dev',updateRepo:process.env.UPDATE_REPO||'',updateCommand:process.env.UPDATE_COMMAND||'',trustProxy:process.env.TRUST_PROXY||'loopback',background:true,...options};
  if(config.adminPassword&&config.adminPassword.length<8)throw new Error('ADMIN_PASSWORD must contain at least 8 characters');
  config.origin=new URL(config.origin).origin;
  await mkdir(config.dataDir,{recursive:true}); await mkdir(config.cacheDir,{recursive:true});
  const db=openDatabase(path.join(config.dataDir,'gallery.sqlite'));
  const app=Fastify({logger:options.logger??true,bodyLimit:64*1024,trustProxy:config.trustProxy,disableRequestLogging:true});
  await app.register(cookie);
  // Package Center sends form-encoded POSTs to /api/pkg-source; the body is not used.
  app.addContentTypeParser('application/x-www-form-urlencoded',{parseAs:'string',bodyLimit:8192},(req,body,done)=>done(null,{}));
  await app.register(rateLimit,{max:3000,timeWindow:'1 minute'});
  await initializeSettings(db,config);
  initializeMessages(db);
  initializeWorkflow(db,config);
  initializeCustomers(db);
  initializeAssignments(db);
  initializeLifecycle(db);
  initializePairing(db);
  const access=createAccess(db);
  for(const [column,type] of [['access_code_hash','TEXT'],['phone_hash','TEXT'],['phone_last4','TEXT']])if(!db.all('PRAGMA table_info(links)').some(c=>c.name===column))db.raw.exec(`ALTER TABLE links ADD COLUMN ${column} ${type}`);
  const dummyHash=await hashPassword(token());
  const scanner=createScanner(db,config,app.log);
  const previews=createPreviews(db,config,app.log);
  const worker=createWorker(db,config,app.log,previews);
  config.cacheStats=()=>previews.stats();
  // Settings or logo changes re-evaluate Final folders and the preview watermark.
  config.onSettingsChanged=()=>{markFinals(db,config);pairAll(db,config);void previews.syncWatermark().catch(e=>app.log.warn({err:e},'Watermark sync failed'));};
  await previews.syncWatermark().catch(e=>app.log.warn({err:e},'Watermark sync failed'));
  const secure=config.origin.startsWith('https:');
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer').header('Cache-Control','no-store');
    // Package Center polls the read-only package source with a plain form POST (no Origin).
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin!==config.origin && !req.url.startsWith('/api/pkg-source'))fail(403,'Origin không hợp lệ');
  });
  app.setErrorHandler((error,req,reply)=>{
    const status=error.statusCode|| (error.code==='ENOENT'?404:500);
    if(status>=500)app.log.error({err:error},'Request failed');
    reply.code(status).send({error:status>=500?'Lỗi máy chủ. Xem log để biết chi tiết.':error.message});
  });
  // A link opens its album only while it is not revoked or expired and the album is not archived.
  const usableLink=link=>!!link&&!(link.expires_at&&link.expires_at<=new Date().toISOString())&&!db.get('SELECT archived_at FROM projects WHERE id=?',link.project_id)?.archived_at;
  function activeLink(session) {
    const link=db.get('SELECT * FROM links WHERE id=? AND revoked=0',session.link_id);
    if(!usableLink(link))fail(403,'Link đã hết hạn hoặc bị thu hồi');
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
    // Deliverables stay hidden until the studio marks the album delivered.
    if(isFinalPath(config,photo.folder_path)&&db.get('SELECT status FROM projects WHERE id=?',link.project_id).status!=='delivered')fail(404,'Không tìm thấy ảnh');
    return photo;
  }
  function listOwned(session,listID) {
    const link=activeLink(session),list=db.get('SELECT * FROM selection_lists WHERE id=? AND project_id=?',listID,link.project_id);
    if(!list)fail(404,'Không tìm thấy danh sách'); return list;
  }
  // SQL predicate on folder alias `f` limiting rows to a link's folder scope. Paths are compared
  // literally (no LIKE) so folder names containing SQL wildcards stay safe.
  function scopeSql(link) {
    const allowed=scopes(link);
    if(!allowed.length)return {sql:'0=1',args:[]};
    const args=[];
    const sql='('+allowed.map(s=>{
      if(s==='')return '1=1';
      args.push(s,s.length+1,`${s}/`);return '(f.relative_path=? OR substr(f.relative_path,1,?)=?)';
    }).join(' OR ')+')';
    return {sql,args};
  }
  function photosFor(session,{folder_id,list_id,search='',edit=false,unseen=false,limit=config.maxZipFiles+1,offset=0}={}) {
    const link=activeLink(session); const allowed=scopes(link);
    if(!allowed.length)return [];
    const scoped=scopeSql(link);
    const args=[link.project_id,...scoped.args];
    const clauses=['p.project_id=?','p.missing=0','p.paired_with IS NULL',scoped.sql];
    if(folder_id) {
      const folder=db.get('SELECT * FROM folders WHERE id=? AND project_id=? AND missing=0',folder_id,link.project_id);
      if(!folder || !allowed.some(s=>descendant(folder.relative_path,s)))fail(404,'Không tìm thấy thư mục');
      const finalFolder=isFinalPath(config,folder.relative_path);
      if(finalFolder&&db.get('SELECT status FROM projects WHERE id=?',link.project_id).status!=='delivered')fail(404,'Không tìm thấy thư mục');
      if(folder.relative_path===''){clauses.push('p.folder_id=?');args.push(folder.id);}
      else {clauses.push('(f.relative_path=? OR substr(f.relative_path,1,?)=?)');args.push(folder.relative_path,folder.relative_path.length+1,`${folder.relative_path}/`);}
      if(!finalFolder){const fin=finalSql(config);clauses.push(`NOT ${fin.sql}`);args.push(...fin.args);}
    } else {
      // Proofing views never include deliverables; they are browsed through their own tab.
      const fin=finalSql(config);clauses.push(`NOT ${fin.sql}`);args.push(...fin.args);
    }
    if(edit)clauses.push('p.edit_pick=1');
    if(unseen){clauses.push('NOT EXISTS(SELECT 1 FROM photo_views v WHERE v.photo_id=p.id AND v.link_id=?)');args.push(link.id);}
    if(list_id){listOwned(session,list_id);clauses.push('EXISTS(SELECT 1 FROM client_selections cs WHERE cs.photo_id=p.id AND cs.list_id=?)');args.push(list_id);}
    if(search){clauses.push('instr(lower(p.filename),lower(?))>0');args.push(search);}
    return db.all(`SELECT p.* FROM photos p JOIN folders f ON f.id=p.folder_id WHERE ${clauses.join(' AND ')} ORDER BY p.relative_path COLLATE NOCASE,p.id LIMIT ? OFFSET ?`,...args,limit,offset);
  }
  const COOKIES={admin:'proof_admin',client:'proof_client',customer:'proof_customer'};
  // On-demand 2048 px preview; a decode failure is reported as unsupported rather than a 500.
  async function renderPreview(photo){
    try{return await previews.ensure(photo);}
    catch(e){app.log.warn({photo:photo.id,error:e.message},'Preview render failed');fail(415,'Ảnh này chưa xem trước được');}
  }
  function createSession(reply,{role,link_id=null,name,user_id=null,customer_id=null}) {
    const raw=token(), sid=id(), seconds=role==='admin'?config.adminSessionHours*3600:30*86400;
    db.run('INSERT INTO sessions(id,token_hash,role,link_id,name,expires_at,user_id,customer_id) VALUES(?,?,?,?,?,?,?,?)',sid,digest(raw),role,link_id,name,new Date(Date.now()+seconds*1000).toISOString(),user_id,customer_id);
    reply.setCookie(COOKIES[role],raw,{path:'/',httpOnly:true,secure,sameSite:'strict',maxAge:seconds});
    return sid;
  }
  app.get('/api/health',async()=>{db.get('SELECT 1');return {ok:true};});
  app.get('/api/config',async()=>({name:config.brand,studioName:config.studioName,contactEmail:config.contactEmail,welcomeMessage:config.welcomeMessage,theme:config.theme,logoUrl:config.logoPath?`/api/logo?v=${config.logoVersion}`:null}));
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
  app.post('/api/admin/login',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const body=parse(z.object({username:z.string().trim().toLowerCase().max(40).default('admin'),password:z.string().max(256)}),req.body);
    const user=db.get('SELECT * FROM staff_users WHERE username=?',body.username);
    const valid=await verifyPassword(body.password,user?.password_hash||dummyHash);
    const current=user&&db.get('SELECT * FROM staff_users WHERE id=?',user.id);
    if(!valid||!current||current.disabled||current.password_hash!==user.password_hash)fail(401,'Tên đăng nhập hoặc mật khẩu không đúng');
    createSession(reply,{role:'admin',name:user.name,user_id:user.id});return {ok:true};
  });
  app.get('/api/admin/me',async req=>{const s=authenticate(req,true);return {id:s.user.id,username:s.user.username,name:s.user.name,role:s.user.role,album_scope:s.user.album_scope||'all'};});
  registerSettings(app,{db,config,authenticate});
  app.post('/api/logout',async(req,reply)=>{
    for(const key of Object.values(COOKIES)) {if(req.cookies[key])db.run('UPDATE sessions SET expires_at=? WHERE token_hash=?',new Date().toISOString(),digest(req.cookies[key]));reply.clearCookie(key,{path:'/'});}
    return {ok:true};
  });
  app.get('/api/admin/shares',async req=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được xem shared folder');
    const sources=db.all('SELECT * FROM approved_sources');
    return (await sharedFolders()).map(s=>{const saved=sources.find(a=>a.relative_path===s.relative_path);return {...s,id:saved?.id,label:s.name,enabled:!!saved?.enabled,auto_scan:saved?!!saved.auto_scan:true,scan_depth:saved?.scan_depth||2,last_discovered_at:saved?.last_discovered_at||null};});
  });
  app.get('/api/admin/directories',async req=>{
    authenticate(req,true); const relative=cleanRelative(req.query.path||'');
    let entries;try{entries=await readdir(await photoPath(config.photoRoot,relative),{withFileTypes:true});}catch(e){if(e.code==='EACCES')fail(403,'Studio Gallery chưa có quyền đọc thư mục. Trong DSM: Shared Folder → Edit → Permissions → System internal user → StudioGallery: Read only.');throw e;}
    return {path:relative,folders:entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['@eaDir','#recycle'].includes(e.name)).map(e=>({name:e.name,path:relative?`${relative}/${e.name}`:e.name}))};
  });
  app.get('/api/admin/sources',async req=>{authenticate(req,true);return db.all('SELECT * FROM approved_sources ORDER BY label,relative_path').map(s=>({...s,enabled:!!s.enabled}));});
  function topLevelSources(){
    const sources=db.all('SELECT * FROM approved_sources WHERE enabled=1 ORDER BY label,relative_path');
    return sources.filter(source=>!sources.some(other=>other.id!==source.id&&descendant(source.relative_path,other.relative_path)));
  }
  function browseTarget(value){
    const parts=cleanRelative(value).split('/');
    if(parts[0]!=='@source'||!parts[1])fail(400,'Đường dẫn thư mục không hợp lệ');
    const source=db.get('SELECT * FROM approved_sources WHERE id=? AND enabled=1',parts[1]);
    if(!source)fail(404,'Nguồn ảnh chưa được bật');
    const subpath=parts.slice(2).join('/');
    return {source,subpath,relative:source.relative_path+(subpath?'/'+subpath:'')};
  }
  app.get('/api/admin/browse',async req=>{
    authenticate(req,true);const value=cleanRelative(req.query.path||'');
    if(!value)return {path:'',folders:topLevelSources().map(s=>({name:s.label,path:'@source/'+s.id})),files:[],album:null,breadcrumbs:[{name:'Ảnh',path:''}]};
    const {source,relative,subpath}=browseTarget(value),directory=await photoPath(config.photoRoot,relative);
    const entries=await readdir(directory,{withFileTypes:true});
    const visible=e=>!e.name.startsWith('.')&&!['@eaDir','#recycle','.snapshot'].includes(e.name)&&!e.isSymbolicLink();
    const folders=entries.filter(e=>visible(e)&&e.isDirectory()).map(e=>({name:e.name,path:value+'/'+e.name})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    const files=entries.filter(e=>visible(e)&&e.isFile()&&supportedFile(e.name)).map(e=>({name:e.name,path:value+'/'+e.name,type:isVideo({filename:e.name})?'video':'image',thumbnail:/\.(jpe?g|jfif|png|webp|avif|heic|heif|gif|bmp|tiff?)$/i.test(e.name)})).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
    const breadcrumbs=[{name:'Ảnh',path:''},{name:source.label,path:'@source/'+source.id}];
    let current='@source/'+source.id;for(const part of subpath.split('/').filter(Boolean)){current+='/'+part;breadcrumbs.push({name:part,path:current});}
    return {path:value,root:relative,folders,files,album:db.get('SELECT id,name FROM projects WHERE root=?',relative)||null,breadcrumbs};
  });
  const thumbnailJobs=new Map();
  let thumbnailActive=0;const thumbnailWaiters=[];
  app.get('/api/admin/browse/thumb',{config:{rateLimit:{max:3000,timeWindow:'1 minute'}}},async(req,reply)=>{
    authenticate(req,true);const {source,subpath,relative}=browseTarget(req.query.path||'');
    if(!subpath)fail(415,'Không có ảnh xem trước');
    const preview=req.query.size==='preview',variant=preview?'preview':'thumb';
    const root=await photoPath(config.photoRoot,source.relative_path),handle=await safeOpen(root,subpath);
    try{
      const info=await handle.stat();
      const key=digest(relative+':'+info.size+':'+info.mtimeMs+':'+variant);
      reply.header('Cache-Control','private, no-cache').header('ETag','"'+key+'"');
      if(req.headers['if-none-match']==='"'+key+'"')return reply.code(304).send();
      // Reuse thumbnails produced by the background scanner, including RAW and video posters.
      const photo=db.get("SELECT photos.* FROM photos JOIN projects ON projects.id=photos.project_id WHERE projects.root || '/' || photos.relative_path=? AND photos.missing=0 AND photos.status='ready' AND photos.bytes=? AND photos.mtime=? LIMIT 1",relative,info.size,info.mtimeMs);
      if(photo){try{return reply.type('image/webp').send(await readFile(cacheFile(config,photo,variant)));}catch{}}
      const directory=path.join(config.cacheDir,'browser'),cached=path.join(directory,key+'.webp');
      try{return reply.type('image/webp').send(await readFile(cached));}catch{}
      if(info.size>100*1024*1024)fail(413,'Ảnh quá lớn để xem trước');
      if(!thumbnailJobs.has(key)){
        const job=(async()=>{
          if(thumbnailActive>=2)await new Promise(resolve=>thumbnailWaiters.push(resolve));
          else thumbnailActive++;
          try{
            const input=await synologyThumb(root,subpath,info.mtimeMs)||await handle.readFile();
            const image=await sharp(input,{limitInputPixels:100_000_000,sequentialRead:true}).rotate().resize({width:preview?1600:320,height:preview?1600:240,fit:'inside',withoutEnlargement:true}).webp({quality:preview?82:72}).toBuffer();
            await mkdir(directory,{recursive:true});await writeFile(cached,image);return image;
          }finally{const next=thumbnailWaiters.shift();if(next)next();else thumbnailActive--;}
        })();
        thumbnailJobs.set(key,job);
      }
      try{return reply.type('image/webp').send(await thumbnailJobs.get(key));}
      catch(e){if(e.statusCode)throw e;fail(415,'Định dạng này chưa có ảnh xem trước');}
      finally{thumbnailJobs.delete(key);}
    }finally{await handle.close();}
  });
  app.post('/api/admin/sources',async(req,reply)=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được quản lý nguồn ảnh');
    const b=parse(z.object({relative_path:z.string().max(1024),label:text}),req.body),relative=cleanRelative(b.relative_path);
    if(!(await stat(await photoPath(config.photoRoot,relative))).isDirectory())fail(400,'Nguồn ảnh không phải thư mục');
    const existing=db.get('SELECT * FROM approved_sources WHERE relative_path=?',relative);
    if(existing){db.run('UPDATE approved_sources SET label=?,enabled=1 WHERE id=?',b.label,existing.id);if(existing.auto_scan)queueDiscovery(existing.id);return {id:existing.id};}
    const sid=id();db.run('INSERT INTO approved_sources(id,relative_path,label) VALUES(?,?,?)',sid,relative,b.label);queueDiscovery(sid);return reply.code(201).send({id:sid});
  });
  app.patch('/api/admin/sources/:id',async req=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được quản lý nguồn ảnh');
    const b=parse(z.object({label:text,enabled:z.boolean()}),req.body),source=db.get('SELECT * FROM approved_sources WHERE id=?',req.params.id);if(!source)fail(404,'Không tìm thấy nguồn ảnh');
    if(!b.enabled&&db.get("SELECT 1 FROM projects WHERE root=? OR substr(root,1,?)=? LIMIT 1",source.relative_path,source.relative_path.length+1,`${source.relative_path}/`))fail(409,'Nguồn đang được một bộ ảnh sử dụng');
    db.run('UPDATE approved_sources SET label=?,enabled=? WHERE id=?',b.label,+b.enabled,source.id);if(b.enabled&&!source.enabled&&source.auto_scan)queueDiscovery(source.id);return {ok:true};
  });
  async function discoverSource(source,startScan=true){
    const root=await photoPath(config.photoRoot,source.relative_path);
    const visible=e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')&&!['@eaDir','#recycle','.snapshot'].includes(e.name);
    const candidates=[];
    const pending=[''];
    while(pending.length){
      const candidate=pending.pop();
      const relative=source.relative_path+(candidate?'/'+candidate:'');
      // Existing albums already scan their complete subtree; preserve their IDs and links.
      if(lifecycle.ignored(relative))continue;// deleted album: never recreated automatically
      if(db.get('SELECT id FROM projects WHERE root=?',relative)){candidates.push(candidate);continue;}
      const children=await readdir(path.join(root,candidate),{withFileTypes:true});
      if(children.some(e=>e.isFile()&&supportedFile(e.name))){candidates.push(candidate);continue;}
      for(const child of children.filter(visible))pending.push(candidate?candidate+'/'+child.name:child.name);
    }
    const created=[];const existing=[];
    for(const candidate of candidates){
      const relative=candidate?(source.relative_path?`${source.relative_path}/${candidate}`:candidate):source.relative_path;
      const found=db.get('SELECT * FROM projects WHERE root=?',relative);
      if(found){existing.push(found);continue;}
      if(db.get("SELECT id FROM projects WHERE substr(?,1,length(root)+1)=root||'/' OR substr(root,1,length(?)+1)=?||'/' LIMIT 1",relative,relative,relative))continue;
      const folderName=path.posix.basename(candidate)||source.label,name=folderName.replace(/^\d{4}-\d{2}-\d{2}[._ -]*/,'').replace(/^\d+[._ -]*/,'').replaceAll('_',' ').replace(/\s+/g,' ').trim()||folderName;
      const pid=id();db.run('INSERT INTO projects(id,name,root,cron,timezone,next_scan) VALUES(?,?,?,?,?,?)',pid,name,relative,config.defaultCron,config.defaultTimezone,nextScan(config.defaultCron,config.defaultTimezone));
      created.push(db.get('SELECT * FROM projects WHERE id=?',pid));
    }
    db.run('UPDATE approved_sources SET last_discovered_at=? WHERE id=?',new Date().toISOString(),source.id);
    const scanProjects=[...created,...existing.filter(p=>!p.archived_at)];
    const scanStarted=startScan&&scanProjects.length?scanner.batch(scanProjects):false;
    return {source:{id:source.id,label:source.label,path:source.relative_path},found:candidates.length,created:created.length,existing:existing.length,scanStarted,albums:created.map(p=>({id:p.id,name:p.name,root:p.root})),scanProjects};
  }
  function queueDiscovery(sourceId){
    if(!config.background)return;
    setImmediate(async()=>{try{const source=topLevelSources().find(s=>s.id===sourceId&&s.auto_scan);if(source)await discoverSource(source);}catch(e){app.log.error({err:e,sourceId},'Automatic source scan failed');}});
  }
  app.patch('/api/admin/sources/:id/options',async req=>{
    const session=authenticate(req,true);if(session.user.role!=='admin')fail(403,'Chỉ quản trị viên được quản lý nguồn ảnh');
    const options=parse(z.object({auto_scan:z.boolean()}),req.body);
    const source=db.get('SELECT * FROM approved_sources WHERE id=?',req.params.id);if(!source)fail(404,'Không tìm thấy nguồn ảnh');
    db.run('UPDATE approved_sources SET auto_scan=? WHERE id=?',+options.auto_scan,source.id);
    if(options.auto_scan&&source.enabled)queueDiscovery(source.id);
    return {ok:true};
  });
  app.post('/api/admin/sources/:id/discover',async(req,reply)=>{
    authenticate(req,true);const source=db.get('SELECT * FROM approved_sources WHERE id=? AND enabled=1',req.params.id);if(!source)fail(404,'Nguồn ảnh chưa được bật');
    const {scanProjects,...result}=await discoverSource(source);return reply.code(202).send(result);
  });
  app.get('/api/admin/projects',async req=>{
    const session=authenticate(req,true),visible=access.staffFilter(session,'p.id');
    return db.all(`SELECT p.*,(SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL) AS photo_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND status='ready') AS ready_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND status='failed') AS failed_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=1) AS missing_count,
      (SELECT count(*) FROM links WHERE project_id=p.id AND revoked=0 AND (expires_at IS NULL OR expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) AS access_count,
      (SELECT count(*) FROM client_selections WHERE project_id=p.id) AS favorite_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND edit_pick=1) AS edit_pick_count,
      (SELECT count(*) FROM photos WHERE project_id=p.id AND missing=0 AND paired_with IS NULL AND edit_pick=1 AND edit_done=1) AS edit_done_count,
      (SELECT count(*) FROM selection_lists WHERE project_id=p.id AND submitted_at IS NOT NULL) AS submitted_count,
      (SELECT count(*) FROM messages WHERE project_id=p.id AND photo_id IS NOT NULL AND author_role='client' AND resolved=0) AS open_comment_count,
      (SELECT count(*) FROM messages WHERE project_id=p.id AND author_role='client' AND seq>COALESCE((SELECT last_seq FROM read_cursors WHERE project_id=p.id AND reader='staff'),0)) AS unread_message_count,
      (SELECT max(created_at) FROM messages WHERE project_id=p.id AND author_role='client') AS last_client_activity,
      (SELECT group_concat(u.name,', ') FROM project_staff ps JOIN staff_users u ON u.id=ps.user_id WHERE ps.project_id=p.id) AS assigned_names,
      (SELECT group_concat(ps.user_id) FROM project_staff ps WHERE ps.project_id=p.id) AS assigned_ids
      FROM projects p WHERE ${visible.sql} ORDER BY created_at DESC`,...visible.args)
      .map(p=>({...p,scan:db.get('SELECT * FROM scan_runs WHERE project_id=? ORDER BY rowid DESC LIMIT 1',p.id)||null}));
  });
  app.post('/api/admin/projects',async(req,reply)=>{
    authenticate(req,true);
    const p=parse(z.object({name:text,root:z.string().max(1024),cron:z.string().max(80).default(config.defaultCron),timezone:z.string().max(80).default(config.defaultTimezone)}),req.body);
    const root=cleanRelative(p.root);
    if(!(await stat(await photoPath(config.photoRoot,root))).isDirectory())fail(400,'Chọn một thư mục');
    const approved=db.all('SELECT relative_path FROM approved_sources WHERE enabled=1');
    if(!approved.some(s=>descendant(root,s.relative_path)))fail(403,'Hãy bật quyền truy cập nguồn ảnh này trong Cài đặt trước');
    if(db.get('SELECT id FROM projects WHERE root=?',root))fail(409,'Thư mục đã có trong project');
    lifecycle.unignore(root);
    const pid=id();db.run('INSERT INTO projects(id,name,root,cron,timezone,next_scan) VALUES(?,?,?,?,?,?)',pid,p.name,root,p.cron,p.timezone,nextScan(p.cron,p.timezone));
    scanner.start(db.get('SELECT * FROM projects WHERE id=?',pid));
    return reply.code(201).send({id:pid});
  });
  app.patch('/api/admin/projects/:id',async req=>{
    authenticate(req,true);const p=parse(z.object({name:text,cron:z.string().max(80),timezone:z.string().max(80),editor:z.string().trim().max(120).optional(),internal_note:z.string().trim().max(2000).optional(),scan_interval_seconds:z.number().int().min(10).max(86400).nullable().optional()}),req.body);
    const current=db.get('SELECT * FROM projects WHERE id=?',req.params.id);if(!current)fail(404,'Không tìm thấy project');
    const interval=p.scan_interval_seconds===undefined?current.scan_interval_seconds:p.scan_interval_seconds;
    db.run('UPDATE projects SET name=?,cron=?,timezone=?,scan_interval_seconds=?,next_scan=?,editor=COALESCE(?,editor),internal_note=COALESCE(?,internal_note) WHERE id=?',p.name,p.cron,p.timezone,interval,current.archived_at?null:interval?new Date(Date.now()+interval*1000).toISOString():nextScan(p.cron,p.timezone),p.editor,p.internal_note,req.params.id);return {ok:true};
  });
  app.post('/api/admin/projects/:id/sync',async(req,reply)=>{
    authenticate(req,true);const p=db.get('SELECT * FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy project');
    if(p.archived_at)fail(409,'Album đang lưu trữ; khôi phục để quét lại');
    const started=scanner.start(p); return reply.code(202).send({started});
  });
  app.post('/api/admin/projects/:id/retry',async req=>{
    authenticate(req,true);db.run("UPDATE jobs SET status='pending',attempts=0 WHERE status='failed' AND photo_id IN(SELECT id FROM photos WHERE project_id=?)",req.params.id);return {ok:true};
  });
  app.get('/api/admin/projects/:id/folders',async req=>{authenticate(req,true);return db.all('SELECT * FROM folders WHERE project_id=? AND missing=0 ORDER BY relative_path',req.params.id);});
  // Photos of an album for the Manager. With `limit` it pages ({photos,total}) and accepts a filename
  // search and a filter; without it, the whole album comes back as a plain array (older callers).
  const PHOTO_FILTERS={hearted:' AND EXISTS(SELECT 1 FROM client_selections cs WHERE cs.photo_id=p.id)',
    notes:" AND EXISTS(SELECT 1 FROM messages c WHERE c.photo_id=p.id AND c.author_role='client' AND c.resolved=0)",
    edit:' AND p.edit_pick=1',failed:" AND p.status='failed'",pending:" AND p.status NOT IN ('ready','failed')"};
  app.get('/api/admin/projects/:id/photos',async req=>{
    authenticate(req,true);
    const q=parse(z.object({folder_id:z.string().max(64).optional(),q:z.string().trim().max(200).optional(),filter:z.enum(['all',...Object.keys(PHOTO_FILTERS)]).optional(),
      limit:z.coerce.number().int().min(1).max(500).optional(),offset:z.coerce.number().int().min(0).default(0)}),req.query||{});
    const args=[req.params.id];let where='';
    if(q.folder_id){const folder=db.get('SELECT * FROM folders WHERE id=? AND project_id=? AND missing=0',q.folder_id,req.params.id);if(!folder)fail(404,'Không tìm thấy thư mục');
      if(folder.relative_path){where+=' AND (f.relative_path=? OR substr(f.relative_path,1,?)=?)';args.push(folder.relative_path,folder.relative_path.length+1,`${folder.relative_path}/`);}}
    if(q.q){where+=" AND p.filename LIKE ? ESCAPE '!'";args.push(`%${q.q.replace(/[!%_]/g,m=>`!${m}`)}%`);}
    if(q.filter&&q.filter!=='all')where+=PHOTO_FILTERS[q.filter];
    const from=`FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.project_id=? AND p.missing=0 AND p.paired_with IS NULL${where}`;
    const select=`SELECT p.id,p.filename,p.extension,p.relative_path,p.width,p.height,p.bytes,p.status,p.missing,p.folder_id,p.edit_pick,p.edit_done,
      (SELECT count(*) FROM client_selections cs WHERE cs.photo_id=p.id) AS favorite_count,
      (SELECT count(*) FROM messages c WHERE c.photo_id=p.id AND c.author_role='client' AND c.resolved=0) AS open_comment_count
      ${from} ORDER BY p.relative_path COLLATE NOCASE`;
    if(!q.limit)return db.all(`${select} LIMIT 10000`,...args);
    return {total:db.get(`SELECT count(*) AS n ${from}`,...args).n,offset:q.offset,photos:db.all(`${select} LIMIT ? OFFSET ?`,...args,q.limit,q.offset)};
  });
  app.get('/api/admin/projects/:id/links',async req=>{authenticate(req,true);return db.all('SELECT l.id,l.label,l.scope,l.downloads,l.originals,l.expires_at,l.revoked,l.created_at,COALESCE(c.phone_last4,l.phone_last4) AS phone_last4,l.customer_id,c.name AS customer_name,c.pin_hash IS NOT NULL AS customer_has_pin FROM links l LEFT JOIN customers c ON c.id=l.customer_id WHERE l.project_id=? ORDER BY l.rowid DESC',req.params.id);});
  app.post('/api/admin/projects/:id/links',async(req,reply)=>{
    const session=authenticate(req,true);const p=db.get('SELECT id,archived_at FROM projects WHERE id=?',req.params.id);if(!p)fail(404,'Không tìm thấy album');
    if(p.archived_at)fail(409,'Album đang lưu trữ; khôi phục album để chia sẻ');
    const b=parse(z.object({label:text,password:z.string().max(256).default(''),phone:z.string().max(30).default(''),customer_id:z.string().uuid().optional(),customer_name:z.string().trim().max(120).optional(),folder_ids:z.array(uuid).max(100).default([]),downloads:z.boolean().default(config.defaultDownloads),originals:z.boolean().default(config.defaultOriginals),expires_at:z.string().datetime().nullable().default(null)}),req.body);
    if(b.expires_at&&b.expires_at<=new Date().toISOString())fail(400,'Hạn dùng phải ở tương lai');
    for(const fid of b.folder_ids)if(!db.get('SELECT id FROM folders WHERE id=? AND project_id=? AND missing=0',fid,p.id))fail(400,'Thư mục không thuộc project');
    const phone=normalizePhone(b.phone);if(b.phone&&phone.length<9)fail(400,'Số điện thoại không hợp lệ');
    // A link for a phone number belongs to that customer's account (created with a fresh PIN if new).
    let customer=null,issuedPin=null;
    if(b.customer_id){customer=db.get('SELECT * FROM customers WHERE id=?',b.customer_id);if(!customer)fail(400,'Khách hàng không tồn tại');}
    else if(phone){const known=db.get('SELECT id FROM customers WHERE phone_hash=?',digest(phone));if(known&&!customers.manageable(session,known.id))fail(403,'Khách này đã có album khác; nhờ quản trị viên tạo link');
      const r=await customers.upsertCustomer({name:b.customer_name||b.label,phone});customer=r.customer;issuedPin=r.pin;}
    if(customer&&!customers.manageable(session,customer.id))fail(403,'Khách này đã có album khác; nhờ quản trị viên tạo link');
    const raw=token(),lid=id(),hash=b.password?await hashPassword(b.password):null;
    db.transaction(()=>{
      db.run('INSERT INTO links(id,project_id,label,token_hash,password_hash,scope,downloads,originals,expires_at,access_code_hash,phone_hash,phone_last4,customer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',lid,p.id,b.label,digest(raw),hash,b.folder_ids.length?'folders':'all',+b.downloads,+b.originals,b.expires_at,null,customer?.phone_hash||null,customer?.phone_last4||null,customer?.id||null);
      for(const fid of new Set(b.folder_ids))db.run('INSERT INTO link_folders(project_id,link_id,folder_id) VALUES(?,?,?)',p.id,lid,fid);
    });
    return reply.code(201).send({id:lid,url:`${config.origin}/g/${raw}`,portal:customer?config.origin:null,customer:customer&&{id:customer.id,name:customer.name,phone_last4:customer.phone_last4,has_pin:!!(customer.pin_hash||issuedPin)},pin:issuedPin,phone:issuedPin?phone:null});
  });
  app.post('/api/admin/links/:id/revoke',async req=>{authenticate(req,true);db.run('UPDATE links SET revoked=1 WHERE id=?',req.params.id);return {ok:true};});
  app.get('/api/share/:token',async req=>{
    const link=db.get('SELECT * FROM links WHERE token_hash=? AND revoked=0',digest(req.params.token));
    if(!usableLink(link))fail(404,'Link không tồn tại hoặc đã hết hạn');
    return {name:db.get('SELECT name FROM projects WHERE id=?',link.project_id).name,password_required:!!link.password_hash};
  });
  app.post('/api/share/:token/unlock',{config:{rateLimit:{max:15,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const b=parse(z.object({name:text,password:z.string().max(256).default('')}),req.body);
    const link=db.get('SELECT * FROM links WHERE token_hash=? AND revoked=0',digest(req.params.token));
    if(!usableLink(link))fail(404,'Link không tồn tại hoặc đã hết hạn');
    if(link.password_hash&&!await verifyPassword(b.password,link.password_hash))fail(401,'PIN / mật khẩu không đúng');
    const existing=req.cookies.proof_client&&db.get('SELECT * FROM sessions WHERE token_hash=? AND link_id=? AND expires_at>?',digest(req.cookies.proof_client),link.id,new Date().toISOString());
    if(existing)return {ok:true};
    const sid=createSession(reply,{role:'client',link_id:link.id,name:b.name});
    if(!db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,'Ảnh làm album'))db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',id(),link.project_id,sid,'Ảnh làm album');return {ok:true};
  });
  app.get('/api/client/gallery',async req=>{
    const s=authenticate(req),link=activeLink(s),allowed=scopes(link);
    if(req.query.token&&digest(req.query.token)!==link.token_hash)fail(401,'Vui lòng mở link này');
    const p=db.get('SELECT * FROM projects WHERE id=?',link.project_id);
    const visibleFolders=db.all('SELECT id,relative_path,name FROM folders WHERE project_id=? AND missing=0 ORDER BY relative_path',link.project_id).filter(f=>allowed.some(scope=>descendant(f.relative_path,scope)));
    const folders=visibleFolders.filter(f=>!isFinalPath(config,f.relative_path));
    const finalFolder=p.status==='delivered'?visibleFolders.find(f=>isFinalPath(config,f.relative_path)&&!f.relative_path.includes('/'))||null:null;
    const edit_count=db.get('SELECT count(*) AS n FROM photos WHERE project_id=? AND edit_pick=1 AND missing=0',p.id).n;
    return {project:{id:p.id,name:p.name,status:p.status,max_edit:p.max_edit,edit_count,due_at:p.due_at,submitted_at:p.submitted_at,client_message:p.client_message,customer_note:p.customer_note},
      final_folder:finalFolder,client:s.name,downloads:!!link.downloads,originals:!!link.originals,folders,lists:db.all('SELECT l.*, (SELECT count(*) FROM client_selections WHERE list_id=l.id) AS count FROM selection_lists l WHERE project_id=? ORDER BY rowid',link.project_id)};
  });
  app.get('/api/client/photos',async req=>{
    const s=authenticate(req);
    const q=parse(z.object({folder_id:uuid.optional(),list_id:uuid.optional(),edit:z.enum(['0','1']).default('0').transform(v=>v==='1'),unseen:z.enum(['0','1']).default('0').transform(v=>v==='1'),search:z.string().max(160).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(120).default(60)}),req.query);
    const photos=photosFor(s,{...q,limit:q.limit+1}); const more=photos.length>q.limit;
    const link=activeLink(s),page=photos.slice(0,q.limit),ids=page.map(p=>p.id),marks=ids.map(()=>'?').join(',');
    // Two grouped queries for the whole page instead of two queries per photo.
    const selections=new Map(),counts=new Map(),viewed=new Set(),raws=new Set();
    if(ids.length){
      for(const r of db.all(`SELECT c.photo_id,c.list_id FROM client_selections c JOIN selection_lists l ON l.id=c.list_id WHERE l.project_id=? AND c.photo_id IN (${marks})`,link.project_id,...ids))selections.set(r.photo_id,[...(selections.get(r.photo_id)||[]),r.list_id]);
      for(const r of db.all(`SELECT photo_id,count(*) AS n FROM messages WHERE project_id=? AND photo_id IN (${marks}) GROUP BY photo_id`,link.project_id,...ids))counts.set(r.photo_id,r.n);
      for(const r of db.all(`SELECT photo_id FROM photo_views WHERE link_id=? AND photo_id IN (${marks})`,link.id,...ids))viewed.add(r.photo_id);
      for(const r of db.all(`SELECT DISTINCT paired_with FROM photos WHERE paired_with IN (${marks}) AND missing=0`,...ids))raws.add(r.paired_with);
    }
    return {more,photos:page.map(p=>({id:p.id,filename:p.filename,width:p.width,height:p.height,status:p.status,extension:p.extension,folder_id:p.folder_id,selected_in:selections.get(p.id)||[],comments:counts.get(p.id)||0,edit_pick:!!p.edit_pick,viewed:viewed.has(p.id),raw_pair:raws.has(p.id)}))};
  });
  app.get('/api/client/photos/:id/:variant',{config:{rateLimit:{max:6000,timeWindow:'1 minute'}}},async(req,reply)=>{
    const s=authenticate(req),photo=photoAllowed(s,req.params.id);
    if(req.params.variant==='video'&&isVideo(photo)){if(photo.status!=='ready')fail(409,'Video đang xử lý');return serveVideo(req,reply,cacheFile(config,photo,'video'));}
    if(!['thumb','preview'].includes(req.params.variant))fail(404,'Không tìm thấy ảnh');
    if(photo.status!=='ready')fail(409,'Preview chưa sẵn sàng');
    const file=req.params.variant==='preview'?await renderPreview(photo):cacheFile(config,photo,'thumb');await stat(file);
    return reply.type('image/webp').header('Cache-Control','private, no-store').send(createReadStream(file));
  });
  app.post('/api/client/lists',async req=>{const s=authenticate(req),link=activeLink(s),b=parse(z.object({name:text}),req.body);if(db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,b.name))fail(409,'Tên danh sách đã có');const lid=id();db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',lid,link.project_id,s.id,b.name);return {id:lid};});
  app.put('/api/client/lists/:id/photos/:photo',async req=>{
    const s=authenticate(req),list=listOwned(s,req.params.id),photo=photoAllowed(s,req.params.photo),b=parse(z.object({selected:z.boolean()}),req.body);
    if(list.submitted_at)fail(409,'Danh sách đã chốt; mở lại trước khi thay đổi');
    if(db.get('SELECT status FROM projects WHERE id=?',list.project_id).status!=='selecting')fail(409,'Album đã gửi cho studio, không thể thay đổi lựa chọn');
    if(isFinalPath(config,photo.folder_path))fail(400,'Ảnh hoàn thiện không thể chọn');
    if(b.selected)db.run('INSERT OR IGNORE INTO client_selections(project_id,list_id,photo_id) VALUES(?,?,?)',photo.project_id,list.id,photo.id);
    else db.run('DELETE FROM client_selections WHERE list_id=? AND photo_id=?',list.id,photo.id);return {ok:true};
  });
  app.post('/api/client/lists/:id/submit',async req=>{const s=authenticate(req),list=listOwned(s,req.params.id),b=parse(z.object({submitted:z.boolean()}),req.body);
    if(db.get('SELECT status FROM projects WHERE id=?',list.project_id).status!=='selecting')fail(409,'Album đã gửi cho studio; liên hệ studio để mở lại');
    db.run('UPDATE selection_lists SET submitted_at=? WHERE id=?',b.submitted?new Date().toISOString():null,list.id);
    const count=db.get('SELECT count(*) AS n FROM client_selections WHERE list_id=?',list.id).n,album=db.get('SELECT name FROM projects WHERE id=?',list.project_id).name;
    messaging.notify(b.submitted?'submitted':'reopened',list.project_id,b.submitted?`${s.name} đã chốt "${list.name}" (${count} ảnh) — ${album}`:`${s.name} mở lại "${list.name}" — ${album}`);
    messaging.hub.album(list.project_id,{type:'list',list_id:list.id});return {ok:true};
  });
  app.get('/api/client/lists/:id/export',async req=>{
    const s=authenticate(req);listOwned(s,req.params.id);const photos=photosFor(s,{list_id:req.params.id,limit:100001});if(photos.length>100000)fail(400,'Danh sách quá lớn');return {search_string:[...new Set(photos.map(p=>p.stem))].join(', '),count:photos.length};
  });
  app.get('/api/admin/projects/:id/selections',async req=>{authenticate(req,true);return db.all(`SELECT l.*,s.name AS client,(SELECT count(*) FROM client_selections WHERE list_id=l.id) AS count,
    (SELECT count(*) FROM client_selections cs JOIN photos p ON p.id=cs.photo_id WHERE cs.list_id=l.id AND p.missing=1) AS missing_count FROM selection_lists l JOIN sessions s ON s.id=l.session_id WHERE l.project_id=? ORDER BY l.created_at DESC`,req.params.id);});
  app.get('/api/admin/lists/:id/export',async(req,reply)=>{
    authenticate(req,true);const rows=db.all('SELECT p.filename,p.stem,p.relative_path,p.missing FROM client_selections c JOIN photos p ON p.id=c.photo_id WHERE c.list_id=? ORDER BY p.relative_path',req.params.id);
    if(req.query.format==='csv')return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="selections.csv"').send(csv([['Filename','Path','Missing'],...rows.map(p=>[p.filename,p.relative_path,p.missing])]));
    return {search_string:[...new Set(rows.filter(p=>!p.missing).map(p=>p.stem))].join(', '),count:rows.length,missing_count:rows.filter(p=>p.missing).length};
  });
  app.get('/api/admin/lists/:id/photos',async req=>{
    authenticate(req,true);if(!db.get('SELECT id FROM selection_lists WHERE id=?',req.params.id))fail(404,'Không tìm thấy danh sách');
    return db.all(`SELECT p.id,p.filename,p.extension,p.relative_path,p.width,p.height,p.status,p.missing,
      (SELECT count(*) FROM messages c WHERE c.photo_id=p.id AND c.project_id=p.project_id) AS comment_count
      FROM client_selections cs JOIN photos p ON p.id=cs.photo_id JOIN selection_lists l ON l.id=cs.list_id
      WHERE cs.list_id=? ORDER BY cs.created_at`,req.params.id);
  });
  app.get('/api/admin/photos/:id/:variant',async(req,reply)=>{
    authenticate(req,true);const photo=db.get('SELECT * FROM photos WHERE id=?',req.params.id);if(!photo)fail(404,'Không tìm thấy ảnh');
    if(req.params.variant==='video'&&isVideo(photo)){if(photo.status!=='ready')fail(409,'Video đang xử lý');return serveVideo(req,reply,cacheFile(config,photo,'video'));}
    if(!['thumb','preview'].includes(req.params.variant))fail(404,'Không tìm thấy ảnh');if(photo.status!=='ready')fail(409,'Preview chưa sẵn sàng');
    const file=req.params.variant==='preview'?await renderPreview(photo):cacheFile(config,photo,'thumb');await stat(file);return reply.type('image/webp').header('Cache-Control','private, no-store').send(createReadStream(file));
  });
  const messaging=registerMessages(app,{db,config,csv,authenticate,activeLink,photoAllowed,scopeSql,access});
  const customers=registerCustomers(app,{db,config,authenticate,activeLink,createSession,scopeSql,messaging,parse,access});
  registerAssignments(app,{db,authenticate,access,parse});
  registerUpdates(app,{config,authenticate});
  const outbound=createOutbound(app,{db,config});config.outbound=outbound;
  registerOutbound(app,{config,authenticate,outbound,parse});
  const lifecycle=registerLifecycle(app,{db,config,authenticate,access,parse,scanner,nextScan});
  registerWorkflow(app,{db,config,csv,authenticate,activeLink,photoAllowed,messaging});
  registerDownloads(app,{db,config,authenticate,photoAllowed,listOwned,photosFor,activeLink,previews,logDownload:(...a)=>lifecycle.logDownload(...a)});
  const timers=[];
  if(config.background){
    timers.push(setInterval(()=>scanner.tick(),5000));
    timers.push(setInterval(()=>worker.tick()?.catch(e=>app.log.error(e)),500));
    let discovering=false;
    const autoDiscover=async()=>{
      if(discovering)return;discovering=true;
      try{
        const projects=new Map();
        for(const source of topLevelSources().filter(s=>s.auto_scan)){
          try{const result=await discoverSource(source,false);for(const album of result.albums){const project=db.get('SELECT * FROM projects WHERE id=?',album.id);if(project)projects.set(project.id,project);}}
          catch(e){app.log.error({err:e,source:source.id},'Automatic source scan failed');}
        }
        if(projects.size)scanner.batch([...projects.values()]);
      }finally{discovering=false;}
    };
    timers.push(setInterval(()=>void autoDiscover(),10*60_000));
    const initial=setTimeout(()=>void autoDiscover(),2000);initial.unref();timers.push(initial);
  }
  timers.push(setInterval(()=>db.run('DELETE FROM download_tickets WHERE expires_at<?',new Date().toISOString()),60_000));
  for(const t of timers)t.unref();
  app.addHook('onClose',async()=>{timers.forEach(clearInterval);await scanner.stop();await worker.stop();db.close();});
  app.decorate('services',{db,config,scanner,worker,previews});
  return app;
}
