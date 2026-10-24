import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { id, token, digest, fail, hashPassword, verifyPassword } from './security.mjs';
import { cacheFile } from './worker.mjs';

// Customer accounts, modelled on Studio Album: a customer signs in with phone + PIN and sees every
// album shared with them. Each album is still reached through a share link (its folder scope and
// download rights stay per link); links carry customer_id. Only a hash and the last four digits
// of the phone number are stored, as before.
export const normalizePhone=value=>String(value||'').replace(/[^0-9]/g,'').replace(/^84(?=\d{9}$)/,'0');
const LOCK_AFTER=5, LOCK_MINUTES=15;
export const newPin=()=>String(randomInt(0,1_000_000)).padStart(6,'0');

export function initializeCustomers(db) {
  db.transaction(()=>{
    db.raw.exec(`CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, phone_hash TEXT NOT NULL UNIQUE, phone_last4 TEXT NOT NULL,
        pin_hash TEXT, note TEXT NOT NULL DEFAULT '', disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, last_login_at TEXT);
      CREATE TABLE IF NOT EXISTS login_failures (key TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, locked_until TEXT);`);
    const links=db.all('PRAGMA table_info(links)').map(c=>c.name);
    for(const column of ['phone_hash','phone_last4'])if(!links.includes(column))db.raw.exec(`ALTER TABLE links ADD COLUMN ${column} TEXT`);
    if(!links.includes('customer_id'))db.raw.exec('ALTER TABLE links ADD COLUMN customer_id TEXT REFERENCES customers(id)');
    if(!db.all('PRAGMA table_info(sessions)').some(c=>c.name==='customer_id'))db.raw.exec('ALTER TABLE sessions ADD COLUMN customer_id TEXT REFERENCES customers(id)');
    // v0.2 phone links become customer accounts without a PIN: the studio issues one before the
    // customer can sign in again (phone-only access is no longer accepted).
    for(const l of db.all('SELECT phone_hash,phone_last4,label FROM links WHERE phone_hash IS NOT NULL AND customer_id IS NULL ORDER BY rowid')){
      let customer=db.get('SELECT id FROM customers WHERE phone_hash=?',l.phone_hash);
      if(!customer){customer={id:id()};db.run('INSERT INTO customers(id,name,phone_hash,phone_last4,created_at) VALUES(?,?,?,?,?)',customer.id,l.label,l.phone_hash,l.phone_last4||'',new Date().toISOString());}
      db.run('UPDATE links SET customer_id=? WHERE phone_hash=? AND customer_id IS NULL',customer.id,l.phone_hash);
    }
  });
}

export function registerCustomers(app,{db,config,authenticate,activeLink,createSession,scopeSql,messaging,parse,access}) {
  const now=()=>new Date().toISOString();
  const dummyPin=hashPassword(token());
  const publicCustomer=c=>({id:c.id,name:c.name,phone_last4:c.phone_last4,note:c.note,disabled:!!c.disabled,has_pin:!!c.pin_hash,created_at:c.created_at,last_login_at:c.last_login_at,
    locked:!!db.get('SELECT 1 FROM login_failures WHERE key=? AND locked_until>?',`phone:${c.phone_hash}`,now())});
  const pin=z.string().trim().regex(/^\d{6,12}$/,'PIN gồm 6–12 chữ số');
  const activeLinks=customerID=>db.all(`SELECT l.* FROM links l JOIN projects p ON p.id=l.project_id WHERE l.customer_id=? AND l.revoked=0 AND (l.expires_at IS NULL OR l.expires_at>?) AND p.archived_at IS NULL ORDER BY l.rowid DESC`,customerID,now());

  // Failed attempts are counted per phone (known or not), so one number cannot be guessed at from
  // many IPs; the per-IP rate limit on the route still applies on top.
  // Every attempt is counted before the (slow) PIN check, synchronously, so parallel requests cannot
  // all slip past the limit. The 5th attempt in a window sets the lock; a successful sign-in clears it.
  function claimAttempt(key){
    const t=now(),r=db.get('SELECT count,locked_until FROM login_failures WHERE key=?',key);
    if(r?.locked_until&&r.locked_until>t)return r.locked_until;
    const count=(r?.locked_until?0:r?.count||0)+1;
    const until=count>=LOCK_AFTER?new Date(Date.now()+LOCK_MINUTES*60_000).toISOString():null;
    db.run(`INSERT INTO login_failures(key,count,locked_until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,locked_until=excluded.locked_until`,key,count,until);
    return null;
  }
  function customerSession(req){
    const raw=req.cookies.proof_customer;
    const session=raw&&db.get("SELECT * FROM sessions WHERE token_hash=? AND role='customer' AND expires_at>?",digest(raw),now());
    if(!session)fail(401,'Vui lòng đăng nhập');
    const customer=db.get('SELECT * FROM customers WHERE id=? AND disabled=0',session.customer_id);
    if(!customer)fail(401,'Tài khoản đã bị khóa. Vui lòng liên hệ studio.');
    session.customer=customer;return session;
  }
  const revokeSessions=customerID=>db.run("UPDATE sessions SET expires_at=? WHERE customer_id=? AND role IN ('customer','client')",now(),customerID);

  // ---------- customer ----------
  app.post('/api/customer/login',{config:{rateLimit:{max:15,timeWindow:'5 minutes'}}},async(req,reply)=>{
    const b=parse(z.object({phone:z.string().max(30),pin:z.string().max(40)}).strict(),req.body);
    const phone=normalizePhone(b.phone);if(phone.length<9)fail(400,'Số điện thoại không hợp lệ');
    const key=`phone:${digest(phone)}`,until=claimAttempt(key);
    if(until)fail(429,`Nhập sai quá nhiều lần. Vui lòng thử lại sau ${new Date(until).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone:config.defaultTimezone})}.`);
    const customer=db.get('SELECT * FROM customers WHERE phone_hash=?',digest(phone));
    // Same work and the same message whether the phone exists, has no PIN, or the PIN is wrong.
    const valid=await verifyPassword(b.pin.trim(),customer?.pin_hash||await dummyPin);
    if(!valid||!customer||customer.disabled)fail(401,'Số điện thoại hoặc PIN không đúng');
    db.run('DELETE FROM login_failures WHERE key=?',key);
    db.run('UPDATE customers SET last_login_at=? WHERE id=?',now(),customer.id);
    createSession(reply,{role:'customer',name:customer.name,customer_id:customer.id});
    return {ok:true};
  });
  app.get('/api/customer/me',async req=>{const s=customerSession(req);return {name:s.customer.name,phone_last4:s.customer.phone_last4};});
  app.get('/api/customer/albums',async req=>{
    const s=customerSession(req);
    return activeLinks(s.customer.id).map(link=>{
      const p=db.get('SELECT id,name,status,due_at,max_edit FROM projects WHERE id=?',link.project_id);
      const scoped=scopeSql(link);
      const cover=db.get(`SELECT p.id FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.project_id=? AND p.missing=0 AND p.paired_with IS NULL AND p.status='ready' AND f.is_final=0 AND ${scoped.sql} ORDER BY p.relative_path COLLATE NOCASE LIMIT 1`,p.id,...scoped.args);
      const count=db.get(`SELECT count(*) AS n FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.project_id=? AND p.missing=0 AND p.paired_with IS NULL AND f.is_final=0 AND ${scoped.sql}`,p.id,...scoped.args).n;
      return {link_id:link.id,label:link.label,project:p,photo_count:count,cover:!!cover,unread:messaging.unread(link).total,expires_at:link.expires_at};
    });
  });
  app.get('/api/customer/albums/:link/cover',async(req,reply)=>{
    const s=customerSession(req),link=activeLinks(s.customer.id).find(l=>l.id===req.params.link);if(!link)fail(404,'Không tìm thấy album');
    const scoped=scopeSql(link);
    const photo=db.get(`SELECT p.* FROM photos p JOIN folders f ON f.id=p.folder_id WHERE p.project_id=? AND p.missing=0 AND p.paired_with IS NULL AND p.status='ready' AND f.is_final=0 AND ${scoped.sql} ORDER BY p.relative_path COLLATE NOCASE LIMIT 1`,link.project_id,...scoped.args);
    if(!photo)fail(404,'Album chưa có ảnh');
    const file=cacheFile(config,photo,'thumb');await stat(file);
    return reply.type('image/webp').header('Cache-Control','private, max-age=300').send(createReadStream(file));
  });
  // Opening an album issues the normal per-link client session the gallery already uses.
  app.post('/api/customer/albums/:link/open',async(req,reply)=>{
    const s=customerSession(req),link=activeLinks(s.customer.id).find(l=>l.id===req.params.link);if(!link)fail(404,'Không tìm thấy album');
    const sid=createSession(reply,{role:'client',link_id:link.id,name:s.customer.name,customer_id:s.customer.id});
    if(!db.get('SELECT id FROM selection_lists WHERE project_id=? AND name=?',link.project_id,'Ảnh làm album'))
      db.run('INSERT INTO selection_lists(id,project_id,session_id,name) VALUES(?,?,?,?)',id(),link.project_id,sid,'Ảnh làm album');
    return {ok:true,url:'/album'};
  });
  app.post('/api/customer/pin',{config:{rateLimit:{max:10,timeWindow:'5 minutes'}}},async req=>{
    const s=customerSession(req),b=parse(z.object({currentPin:z.string().max(40),pin}).strict(),req.body);
    if(!await verifyPassword(b.currentPin.trim(),s.customer.pin_hash))fail(400,'PIN hiện tại không đúng');
    const hash=await hashPassword(b.pin);
    db.run('UPDATE customers SET pin_hash=? WHERE id=?',hash,s.customer.id);
    db.run("UPDATE sessions SET expires_at=? WHERE customer_id=? AND role='customer' AND id<>?",now(),s.customer.id,s.id);
    return {ok:true};
  });

  // ---------- studio ----------
  // Staff limited to assigned albums only see and manage customers of those albums.
  // A restricted account may act on a customer only if none of the customer's links lie outside its
  // albums; otherwise a PIN reset or a new link would open albums the account cannot see.
  const manageable=(session,customerID)=>{
    const f=access.staffFilter(session,'l.project_id');
    return f.sql==='1=1'||!db.get(`SELECT 1 FROM links l WHERE l.customer_id=? AND NOT (${f.sql})`,customerID,...f.args);
  };
  const managed=(req,customerID)=>{const s=authenticate(req,true);const c=db.get('SELECT * FROM customers WHERE id=?',customerID);if(!c||!manageable(s,c.id))fail(404,'Không tìm thấy khách');return c;};
  app.get('/api/admin/customers',async req=>{
    const s=authenticate(req,true),f=access.staffFilter(s,'l.project_id');
    const q=String(req.query.search||'').trim(),phone=normalizePhone(q);
    const rows=phone.length>=9?db.all('SELECT * FROM customers WHERE phone_hash=?',digest(phone))
      :db.all(`SELECT * FROM customers WHERE ?='' OR instr(lower(name),lower(?))>0 OR phone_last4=? ORDER BY created_at DESC LIMIT 500`,q,q,q);
    return rows.filter(c=>manageable(s,c.id)).map(c=>({...publicCustomer(c),albums:db.all(`SELECT l.id AS link_id,p.id,p.name,p.status,l.revoked,l.expires_at FROM links l JOIN projects p ON p.id=l.project_id WHERE l.customer_id=? AND ${f.sql} ORDER BY l.rowid DESC`,c.id,...f.args)}));
  });
  // Find-or-create by phone. A new account (or one without a PIN) gets a generated PIN, returned once.
  async function upsertCustomer({name,phone,pin:chosen,note=''}){
    const n=normalizePhone(phone);if(n.length<9)fail(400,'Số điện thoại không hợp lệ');
    const existing=db.get('SELECT * FROM customers WHERE phone_hash=?',digest(n));
    if(existing&&existing.pin_hash&&!chosen)return {customer:existing,pin:null,created:false};
    const issued=chosen||newPin(),hash=await hashPassword(issued);
    if(existing){db.run('UPDATE customers SET pin_hash=? WHERE id=?',hash,existing.id);return {customer:{...existing,pin_hash:hash},pin:issued,created:false};}
    const cid=id();
    db.run('INSERT INTO customers(id,name,phone_hash,phone_last4,pin_hash,note,created_at) VALUES(?,?,?,?,?,?,?)',cid,name,digest(n),n.slice(-4),hash,note,now());
    return {customer:db.get('SELECT * FROM customers WHERE id=?',cid),pin:issued,created:true};
  }
  app.post('/api/admin/customers',async(req,reply)=>{
    authenticate(req,true);
    const b=parse(z.object({name:z.string().trim().min(1).max(120),phone:z.string().max(30),pin:pin.optional(),note:z.string().trim().max(2000).default('')}).strict(),req.body);
    if(db.get('SELECT 1 FROM customers WHERE phone_hash=?',digest(normalizePhone(b.phone))))fail(409,'Số điện thoại đã có tài khoản khách');
    const r=await upsertCustomer(b);
    return reply.code(201).send({customer:publicCustomer(r.customer),pin:r.pin});
  });
  app.patch('/api/admin/customers/:id',async req=>{
    const c=managed(req,req.params.id);
    const b=parse(z.object({name:z.string().trim().min(1).max(120),note:z.string().trim().max(2000),disabled:z.boolean()}).strict(),req.body);
    db.run('UPDATE customers SET name=?,note=?,disabled=? WHERE id=?',b.name,b.note,+b.disabled,c.id);
    if(b.disabled)revokeSessions(c.id);
    return {ok:true};
  });
  app.post('/api/admin/customers/:id/pin',async req=>{
    const c=managed(req,req.params.id);
    const b=parse(z.object({pin:pin.optional()}).strict(),req.body||{});
    const issued=b.pin||newPin();
    db.run('UPDATE customers SET pin_hash=? WHERE id=?',await hashPassword(issued),c.id);
    db.run('DELETE FROM login_failures WHERE key=?',`phone:${c.phone_hash}`);
    revokeSessions(c.id);
    return {pin:issued};
  });
  app.post('/api/admin/customers/:id/unlock',async req=>{
    const c=managed(req,req.params.id);
    db.run('DELETE FROM login_failures WHERE key=?',`phone:${c.phone_hash}`);return {ok:true};
  });

  return {upsertCustomer,publicCustomer,customerSession,manageable};
}
