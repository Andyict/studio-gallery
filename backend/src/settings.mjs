import { z } from 'zod';
import { stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { id, hashPassword, verifyPassword, fail } from './security.mjs';
import { nextScan } from './scanner.mjs';
import { SECRET_MASK } from './outbound.mjs';

const username=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/);
const password=z.string().min(8).max(256);
const name=z.string().trim().min(1).max(100);
const parse=(schema,value)=>{const r=schema.safeParse(value);if(!r.success)fail(400,r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));return r.data;};
export const settingsSchema=z.object({
  brand:name, studioName:z.string().trim().max(120), contactEmail:z.union([z.literal(''),z.email()]),
  welcomeMessage:z.string().trim().max(300), sourceLabel:name,
  defaultCron:z.string().max(80), defaultTimezone:z.string().min(1).max(80),
  defaultDownloads:z.boolean(), defaultOriginals:z.boolean(), defaultExpiryDays:z.number().int().min(0).max(365),
  maxZipFiles:z.number().int().min(1).max(10000),maxDownloads:z.number().int().min(1).max(4),
  adminSessionHours:z.number().int().min(1).max(72),
  // Older saved settings predate the theme; default keeps them parseable.
  theme:z.enum(['sage','sand','midnight']).default('sage'),
  // Album subfolder holding finished photos for delivery ("Ảnh hoàn thiện").
  // Disk budget for on-demand 2048 px previews (thumbnails and videos are not counted). 0 = no limit.
  previewCacheMB:z.number().int().min(0).max(10_000_000).default(20480),
  // Studio logo stamped on previews: off, centre, bottom-right corner or tiled; opacity in percent.
  // Show RAW+JPG with the same name in one folder as one photo (RAW added to original downloads).
  pairRawJpg:z.boolean().default(true),
  // Studio alerts: e-mail via SMTP, Telegram bot, JSON webhook. Empty = channel off.
  notifyEmail:z.union([z.literal(''),z.email()]).default(''),
  smtpHost:z.string().trim().max(200).default(''),smtpPort:z.number().int().min(1).max(65535).default(587),smtpSecure:z.boolean().default(false),
  smtpUser:z.string().trim().max(200).default(''),smtpPass:z.string().max(500).default(''),smtpFrom:z.string().trim().max(200).default(''),
  telegramToken:z.string().trim().max(200).default(''),telegramChat:z.string().trim().max(100).default(''),
  webhookUrl:z.union([z.literal(''),z.url({protocol:/^https?$/})]).default(''),
  watermark:z.enum(['off','center','corner','tile']).default('off'),
  watermarkOpacity:z.number().int().min(5).max(80).default(25),
  finalFolder:z.string().trim().min(1).max(80).regex(/^[^/\:*?"<>|.][^/\:*?"<>|]*$/).default('Final')
}).strict();

const SECRETS=['smtpPass','telegramToken','webhookUrl'];

export async function initializeSettings(db,config) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','staff')), disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS system_settings (id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,target TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS approved_sources (
      id TEXT PRIMARY KEY,relative_path TEXT NOT NULL UNIQUE,label TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  for(const [column,type] of [['auto_scan','INTEGER NOT NULL DEFAULT 1'],['scan_depth','INTEGER NOT NULL DEFAULT 2'],['last_discovered_at','TEXT']])
    if(!db.all('PRAGMA table_info(approved_sources)').some(c=>c.name===column))db.raw.exec(`ALTER TABLE approved_sources ADD COLUMN ${column} ${type}`);
  if(!db.all('PRAGMA table_info(sessions)').some(c=>c.name==='user_id')) {
    db.transaction(()=>{
      db.raw.exec('ALTER TABLE sessions ADD COLUMN user_id TEXT REFERENCES staff_users(id)');
      // Old shared-password sessions must sign in to a named account once.
      db.run("UPDATE sessions SET expires_at=? WHERE role='admin'",new Date().toISOString());
    });
  }
  // Keep environment-based bootstrap for existing/headless deployments. When no
  // password is supplied the browser onboarding flow creates the first owner.
  if(!db.get('SELECT id FROM staff_users LIMIT 1')&&config.adminPassword)db.run('INSERT INTO staff_users(id,username,name,password_hash,role) VALUES(?,?,?,?,?)',id(),'admin','Chủ studio',await hashPassword(config.adminPassword),'admin');
  for(const project of db.all('SELECT root,name FROM projects')){
    const approved=db.all('SELECT relative_path FROM approved_sources');
    if(!approved.some(source=>project.root===source.relative_path||project.root.startsWith(source.relative_path+'/')))
      db.run('INSERT OR IGNORE INTO approved_sources(id,relative_path,label) VALUES(?,?,?)',id(),project.root,project.name);
  }
  const defaults={brand:config.brand,studioName:'',contactEmail:'',welcomeMessage:'Những khoảnh khắc của bạn. Những lựa chọn của bạn.',sourceLabel:'Nguồn ảnh NAS',defaultCron:'*/10 * * * *',defaultTimezone:'Asia/Ho_Chi_Minh',defaultDownloads:true,defaultOriginals:false,defaultExpiryDays:30,maxZipFiles:config.maxZipFiles,maxDownloads:config.maxDownloads,adminSessionHours:12,theme:'sage',finalFolder:'Final',previewCacheMB:20480,watermark:'off',watermarkOpacity:25,pairRawJpg:true,notifyEmail:'',smtpHost:'',smtpPort:587,smtpSecure:false,smtpUser:'',smtpPass:'',smtpFrom:'',telegramToken:'',telegramChat:'',webhookUrl:''};
  const saved=db.get('SELECT value FROM system_settings WHERE id=1');
  Object.assign(config,defaults,saved?settingsSchema.parse(JSON.parse(saved.value)):{});
  for(const [filename,mime] of [['studio-logo.png','image/png'],['studio-logo.jpg','image/jpeg'],['studio-logo.webp','image/webp']]){
    try{await stat(path.join(config.dataDir,filename));config.logoPath=path.join(config.dataDir,filename);config.logoMime=mime;config.logoVersion=Date.now();break;}catch{}
  }
  db.raw.exec('PRAGMA user_version=2');
}

export function registerSettings(app,{db,config,authenticate}) {
  const audit=(actor,action,target='')=>db.run('INSERT INTO audit_log(id,actor_id,action,target) VALUES(?,?,?,?)',id(),actor.user_id,action,target);
  const owner=req=>{const s=authenticate(req,true);if(s.user.role!=='admin')fail(403,'Chỉ quản trị viên được sử dụng chức năng này');return s;};
  const publicUser=u=>({id:u.id,username:u.username,name:u.name,role:u.role,album_scope:u.album_scope||'all',disabled:!!u.disabled,created_at:u.created_at});
  app.get('/api/admin/settings',async req=>{
    owner(req);let connected=false;try{connected=(await stat(config.photoRoot)).isDirectory();}catch{}
    return {settings:Object.fromEntries(Object.keys(settingsSchema.shape).map(k=>[k,SECRETS.includes(k)&&config[k]?SECRET_MASK:config[k]])),logoUrl:config.logoPath?`/api/logo?v=${config.logoVersion}`:null,source:{label:config.sourceLabel,path:config.photoRoot,hostPath:process.env.PHOTO_SOURCE_LABEL||null,connected,readOnly:true},system:{origin:config.origin,version:config.appVersion},cache:config.cacheStats?.()||null};
  });
  app.put('/api/admin/settings',async req=>{
    const s=owner(req),body={...req.body};
    if(body.smtpPass===SECRET_MASK&&body.smtpHost!==config.smtpHost)fail(400,'Nhập lại mật khẩu SMTP khi đổi máy chủ SMTP');
    for(const k of SECRETS)if(body[k]===SECRET_MASK)body[k]=config[k];
    const value=parse(settingsSchema,body);nextScan(value.defaultCron,value.defaultTimezone);
    try{new Intl.DateTimeFormat('en',{timeZone:value.defaultTimezone});}catch{fail(400,'Múi giờ không hợp lệ');}
    if(value.defaultOriginals&&!value.defaultDownloads)fail(400,'Bật tải ảnh trước khi bật tải file gốc');
    db.transaction(()=>{db.run('INSERT INTO system_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(value));audit(s,'settings.update');});
    Object.assign(config,value);config.onSettingsChanged?.();return {ok:true};
  });
  app.put('/api/admin/logo',{bodyLimit:3*1024*1024},async req=>{
    const s=owner(req),b=parse(z.object({dataUrl:z.string().max(2800000)}).strict(),req.body);
    const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl);if(!match)fail(400,'Logo phải là PNG, JPG hoặc WebP');
    const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>2*1024*1024)fail(400,'Logo tối đa 2 MB');
    const valid=match[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)fail(400,'Nội dung file logo không hợp lệ');
    await mkdir(config.dataDir,{recursive:true});const ext=match[1]==='image/png'?'png':match[1]==='image/jpeg'?'jpg':'webp',target=path.join(config.dataDir,`studio-logo.${ext}`),temp=`${target}.tmp`;
    await writeFile(temp,bytes,{flag:'w'});await rename(temp,target);for(const other of ['png','jpg','webp'])if(other!==ext)await unlink(path.join(config.dataDir,`studio-logo.${other}`)).catch(()=>{});
    config.logoPath=target;config.logoMime=match[1];config.logoVersion=Date.now();config.onSettingsChanged?.();audit(s,'settings.logo_update');return {logoUrl:`/api/logo?v=${config.logoVersion}`};
  });
  app.delete('/api/admin/logo',async req=>{const s=owner(req);for(const ext of ['png','jpg','webp'])await unlink(path.join(config.dataDir,`studio-logo.${ext}`)).catch(()=>{});config.logoPath=null;config.logoMime=null;config.logoVersion=Date.now();config.onSettingsChanged?.();audit(s,'settings.logo_remove');return {ok:true};});
  app.get('/api/admin/defaults',async req=>{authenticate(req,true);return {cron:config.defaultCron,timezone:config.defaultTimezone,downloads:config.defaultDownloads,originals:config.defaultOriginals,expiryDays:config.defaultExpiryDays,finalFolder:config.finalFolder};});
  app.get('/api/admin/users',async req=>{owner(req);return db.all('SELECT * FROM staff_users ORDER BY created_at,username').map(publicUser);});
  app.post('/api/admin/users',async(req,reply)=>{
    const s=owner(req),b=parse(z.object({username,name,password,role:z.enum(['admin','staff']),album_scope:z.enum(['all','assigned']).default('all')}).strict(),req.body);
    const hash=await hashPassword(b.password);owner(req);
    if(db.get('SELECT id FROM staff_users WHERE username=?',b.username))fail(409,'Tên đăng nhập đã tồn tại');
    const uid=id();db.transaction(()=>{db.run('INSERT INTO staff_users(id,username,name,password_hash,role,album_scope) VALUES(?,?,?,?,?,?)',uid,b.username,b.name,hash,b.role,b.album_scope);audit(s,'user.create',uid);});
    return reply.code(201).send({id:uid});
  });
  app.patch('/api/admin/users/:id',async req=>{
    const s=owner(req),b=parse(z.object({name,role:z.enum(['admin','staff']),disabled:z.boolean(),album_scope:z.enum(['all','assigned']).optional()}).strict(),req.body);
    const target=db.get('SELECT * FROM staff_users WHERE id=?',req.params.id);if(!target)fail(404,'Không tìm thấy tài khoản');
    if(target.id===s.user_id&&(b.disabled||b.role!=='admin'))fail(400,'Không thể khóa hoặc hạ quyền tài khoản đang sử dụng');
    db.transaction(()=>{
      if(target.role==='admin'&&!target.disabled&&(b.disabled||b.role!=='admin')&&db.get("SELECT count(*) AS n FROM staff_users WHERE role='admin' AND disabled=0").n<=1)fail(400,'Cần giữ ít nhất một quản trị viên hoạt động');
      db.run('UPDATE staff_users SET name=?,role=?,disabled=?,album_scope=COALESCE(?,album_scope) WHERE id=?',b.name,b.role,+b.disabled,b.album_scope??null,target.id);
      if(b.disabled||target.role!==b.role||(b.album_scope&&b.album_scope!==(target.album_scope||'all')))db.run('UPDATE sessions SET expires_at=? WHERE user_id=?',new Date().toISOString(),target.id);
      audit(s,'user.update',target.id);
    });return {ok:true};
  });
  app.post('/api/admin/users/:id/password',async req=>{
    const s=owner(req),b=parse(z.object({password}).strict(),req.body);if(req.params.id===s.user_id)fail(400,'Dùng mục Tài khoản của tôi để đổi mật khẩu cá nhân');
    if(!db.get('SELECT id FROM staff_users WHERE id=?',req.params.id))fail(404,'Không tìm thấy tài khoản');
    const hash=await hashPassword(b.password);owner(req);
    db.transaction(()=>{db.run('UPDATE staff_users SET password_hash=? WHERE id=?',hash,req.params.id);db.run('UPDATE sessions SET expires_at=? WHERE user_id=?',new Date().toISOString(),req.params.id);audit(s,'user.password_reset',req.params.id);});return {ok:true};
  });
  app.post('/api/admin/account/password',async req=>{
    const s=authenticate(req,true),b=parse(z.object({currentPassword:z.string().max(256),password}).strict(),req.body);
    if(!await verifyPassword(b.currentPassword,s.user.password_hash))fail(400,'Mật khẩu hiện tại không đúng');
    const hash=await hashPassword(b.password);authenticate(req,true);
    db.transaction(()=>{db.run('UPDATE staff_users SET password_hash=? WHERE id=?',hash,s.user_id);db.run('UPDATE sessions SET expires_at=? WHERE user_id=? AND id<>?',new Date().toISOString(),s.user_id,s.id);audit(s,'account.password_change',s.user_id);});return {ok:true};
  });
  app.get('/api/admin/audit',async req=>{owner(req);return db.all('SELECT a.*,u.username FROM audit_log a LEFT JOIN staff_users u ON u.id=a.actor_id ORDER BY a.rowid DESC LIMIT 100');});
}
