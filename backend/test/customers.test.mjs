import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';
import {digest} from '../src/security.mjs';

const origin='http://localhost:3210';

async function setup(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-customers-'));
  const jpg=await sharp({create:{width:20,height:20,channels:3,background:'#335577'}}).jpeg().toBuffer();
  for(const album of ['Wedding','Prewedding']){await mkdir(path.join(root,'photos','shoots',album),{recursive:true});await writeFile(path.join(root,'photos','shoots',album,'A.jpg'),jpg);}
  const options={photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false};
  const ctx={root,options};
  ctx.start=async()=>{ctx.app=await createApp(options);ctx.db=ctx.app.services.db;};
  await ctx.start();
  t.after(async()=>{await ctx.app.close();await rm(root,{recursive:true,force:true});});
  ctx.req=(method,url,payload,cookie)=>ctx.app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const cookieOf=r=>r.headers['set-cookie']?.split(';')[0];
  ctx.cookieOf=cookieOf;
  ctx.admin=cookieOf(await ctx.req('POST','/api/admin/login',{password:options.adminPassword}));
  await ctx.req('POST','/api/admin/sources',{relative_path:'shoots',label:'Shoots'},ctx.admin);
  ctx.wedding=(await ctx.req('POST','/api/admin/projects',{name:'Cưới',root:'shoots/Wedding'},ctx.admin)).json().id;
  ctx.pre=(await ctx.req('POST','/api/admin/projects',{name:'Pre-wedding',root:'shoots/Prewedding'},ctx.admin)).json().id;
  await ctx.app.services.scanner.wait();await ctx.app.services.worker.drain();
  ctx.link=(pid,body)=>ctx.req('POST',`/api/admin/projects/${pid}/links`,{label:'Lan',...body},ctx.admin).then(r=>r.json());
  ctx.login=(phone,pin)=>ctx.req('POST','/api/customer/login',{phone,pin});
  return ctx;
}

test('customer accounts: PIN login, one account across albums, per-phone lockout, staff reset',async t=>{
  const ctx=await setup(t),{req,admin}=ctx;
  const first=await ctx.link(ctx.wedding,{phone:'0901 234 567',customer_name:'Lan Nguyễn'});
  assert.match(first.pin,/^\d{6}$/);assert.equal(first.customer.name,'Lan Nguyễn');
  // A second album for the same phone reuses the account and does not issue a new PIN.
  const second=await ctx.link(ctx.pre,{phone:'+84 901 234 567'});
  assert.equal(second.customer.id,first.customer.id);assert.equal(second.pin,null);
  assert.equal(ctx.db.get('SELECT count(*) AS n FROM customers').n,1);
  assert.equal(ctx.db.get("SELECT count(*) AS n FROM customers WHERE phone_hash LIKE '%0901234567%'").n,0,'phone stored hashed only');

  const ok=await ctx.login('0901234567',first.pin);assert.equal(ok.statusCode,200);
  const customer=ctx.cookieOf(ok);
  let albums=(await req('GET','/api/customer/albums',undefined,customer)).json();
  assert.deepEqual(albums.map(a=>a.project.name).sort(),['Cưới','Pre-wedding']);
  assert.equal((await req('GET',`/api/customer/albums/${albums[0].link_id}/cover`,undefined,customer)).statusCode,200);
  const opened=await req('POST',`/api/customer/albums/${albums[0].link_id}/open`,{},customer);
  const client=ctx.cookieOf(opened);
  assert.equal((await req('GET','/api/client/gallery',undefined,client)).json().client,'Lan Nguyễn');
  // Revoked links disappear from the list; someone else's link cannot be opened.
  await req('POST',`/api/admin/links/${second.id}/revoke`,{},admin);
  albums=(await req('GET','/api/customer/albums',undefined,customer)).json();assert.equal(albums.length,1);
  const other=await ctx.link(ctx.pre,{phone:'0911111111'});
  assert.equal((await req('POST',`/api/customer/albums/${other.id}/open`,{},customer)).statusCode,404);

  // Lockout is per phone, also for numbers without an account, and uses one generic error.
  for(let i=0;i<5;i++){const r=await ctx.login('0901234567','999999');assert.equal(r.statusCode,401);assert.equal(r.json().error,'Số điện thoại hoặc PIN không đúng');}
  assert.equal((await ctx.login('0901234567',first.pin)).statusCode,429,'locked even with the right PIN');
  assert.equal((await ctx.login('0999999999','123456')).json().error,'Số điện thoại hoặc PIN không đúng');
  const listed=(await req('GET','/api/admin/customers?search=0901234567',undefined,admin)).json();
  assert.equal(listed.length,1);assert.equal(listed[0].locked,true);assert.equal(listed[0].albums.length,2);
  // Reset issues a new PIN, unlocks, and signs out existing sessions.
  const reset=(await req('POST',`/api/admin/customers/${first.customer.id}/pin`,{},admin)).json();
  assert.equal((await req('GET','/api/customer/albums',undefined,customer)).statusCode,401);
  assert.equal((await req('GET','/api/client/gallery',undefined,client)).statusCode,401);
  const again=ctx.cookieOf(await ctx.login('0901234567',reset.pin));
  // Customer changes their own PIN.
  assert.equal((await req('POST','/api/customer/pin',{currentPin:'000000',pin:'246810'},again)).statusCode,400);
  assert.equal((await req('POST','/api/customer/pin',{currentPin:reset.pin,pin:'12'},again)).statusCode,400);
  assert.equal((await req('POST','/api/customer/pin',{currentPin:reset.pin,pin:'246810'},again)).statusCode,200);
  assert.equal((await ctx.login('0901234567','246810')).statusCode,200);
  // Disabling the account blocks sign-in.
  await req('PATCH',`/api/admin/customers/${first.customer.id}`,{name:'Lan Nguyễn',note:'',disabled:true},admin);
  assert.equal((await ctx.login('0901234567','246810')).statusCode,401);
  assert.equal((await req('GET','/api/admin/customers',undefined,customer)).statusCode,401);
});

test('v0.2 phone links become accounts that need a PIN from the studio',async t=>{
  const ctx=await setup(t),{req,admin}=ctx;
  await ctx.app.close();
  const raw=new DatabaseSync(path.join(ctx.options.dataDir,'gallery.sqlite'));
  raw.prepare("INSERT INTO links(id,project_id,label,token_hash,scope,phone_hash,phone_last4) VALUES('legacy',?,'Khách cũ','tok','all',?,'4567')").run(ctx.wedding,digest('0901234567'));
  raw.close();
  await ctx.start();
  const [legacy]=(await ctx.req('GET','/api/admin/customers',undefined,admin)).json();
  assert.equal(legacy.name,'Khách cũ');assert.equal(legacy.has_pin,false);assert.equal(legacy.phone_last4,'4567');
  assert.equal((await ctx.login('0901234567','')).statusCode,401,'phone alone is not enough');
  const {pin}=(await ctx.req('POST',`/api/admin/customers/${legacy.id}/pin`,{pin:'135790'},admin)).json();
  assert.equal(pin,'135790');
  const customer=ctx.cookieOf(await ctx.login('0901234567','135790'));
  assert.equal((await ctx.req('GET','/api/customer/albums',undefined,customer)).json()[0].link_id,'legacy');
});

test('staff limited to assigned albums cannot reach other albums by any route',async t=>{
  const ctx=await setup(t),{req,admin,wedding,pre}=ctx;
  const editor=(await req('POST','/api/admin/users',{username:'editor',name:'Minh Editor',password:'editor-pass-1',role:'staff',album_scope:'assigned'},admin)).json().id;
  const all=(await req('POST','/api/admin/users',{username:'manager',name:'Hà',password:'manager-pass-1',role:'staff'},admin)).json().id;
  const login=async u=>ctx.cookieOf(await req('POST','/api/admin/login',{username:u,password:`${u}-pass-1`}));
  const ed=await login('editor'),mgr=await login('manager');
  assert.equal((await req('PUT',`/api/admin/projects/${wedding}/staff`,{user_ids:[editor]},ed)).statusCode,404,'not assigned yet: the album is invisible');
  assert.equal((await req('PUT',`/api/admin/projects/${wedding}/staff`,{user_ids:[editor]},mgr)).statusCode,200);
  assert.deepEqual((await req('GET',`/api/admin/projects/${wedding}/staff`,undefined,admin)).json().map(u=>u.name),['Minh Editor']);
  assert.deepEqual((await req('GET','/api/admin/projects',undefined,ed)).json().map(p=>p.name),['Cưới']);
  assert.equal((await req('GET','/api/admin/projects',undefined,mgr)).json().length,2,'unrestricted staff see everything');
  assert.equal((await req('GET','/api/admin/projects',undefined,admin)).json().find(p=>p.id===wedding).assigned_names,'Minh Editor');
  // Activity on the other album never reaches the restricted editor.
  const link=await ctx.link(pre,{});
  const client=ctx.cookieOf(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Khách'}));
  await req('POST','/api/client/messages',{body:'Xin chào'},client);
  assert.equal((await req('GET','/api/admin/chats',undefined,ed)).json().length,0);
  assert.equal((await req('GET','/api/admin/inbox',undefined,ed)).json().length,0);
  assert.equal((await req('GET','/api/admin/notifications',undefined,ed)).json().unseen,0);
  assert.equal((await req('GET','/api/admin/notifications',undefined,mgr)).json().unseen,1);
  // Every album-specific route is closed, whichever id it is keyed on.
  const photo=ctx.db.get('SELECT id FROM photos WHERE project_id=?',pre).id;
  const message=ctx.db.get('SELECT id FROM messages WHERE project_id=?',pre).id;
  const list=ctx.db.get('SELECT id FROM selection_lists WHERE project_id=?',pre).id;
  for(const [method,url,body] of [['GET',`/api/admin/projects/${pre}/messages`],['PATCH',`/api/admin/projects/${pre}/workflow`,{max_edit:1}],['GET',`/api/admin/projects/${pre}/links`],
    ['GET',`/api/admin/photos/${photo}/thumb`],['PATCH',`/api/admin/photos/${photo}/done`,{done:true}],['PATCH',`/api/admin/messages/${message}`,{resolved:true}],
    ['GET',`/api/admin/lists/${list}/photos`],['POST',`/api/admin/links/${link.id}/revoke`,{}],['GET',`/api/admin/projects/${'00000000-0000-4000-8000-000000000000'}/folders`]])
    assert.equal((await req(method,url,body,ed)).statusCode,404,`${method} ${url}`);
  assert.equal((await req('GET',`/api/admin/projects/${wedding}/folders`,undefined,ed)).statusCode,200);
  assert.equal((await req('GET','/api/admin/browse',undefined,ed)).statusCode,403);
  assert.equal((await req('POST','/api/admin/projects',{name:'X',root:'shoots/Wedding'},ed)).statusCode,403);
  assert.equal((await req('GET',`/api/admin/projects/${pre}/messages`,undefined,mgr)).statusCode,200);
  assert.equal((await req('GET','/api/admin/me',undefined,ed)).json().album_scope,'assigned');
  assert.equal((await req('GET','/api/admin/team',undefined,ed)).json().some(u=>u.id===all),true);
  // Customers of other albums are invisible to the restricted editor.
  const outsider=(await ctx.link(pre,{phone:'0922222222'})).customer.id;
  assert.equal((await req('GET','/api/admin/customers',undefined,ed)).json().some(c=>c.id===outsider),false);
  assert.equal((await req('POST',`/api/admin/customers/${outsider}/pin`,{},ed)).statusCode,404);
  assert.equal((await req('GET','/api/admin/customers',undefined,mgr)).json().some(c=>c.id===outsider),true);
});
