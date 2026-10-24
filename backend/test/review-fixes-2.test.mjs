import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';
import {SECRET_MASK} from '../src/outbound.mjs';

const origin='http://localhost:3210';
const jpg=()=>sharp({create:{width:300,height:200,channels:3,background:'#ffffff'}}).jpeg().toBuffer();

async function setup(t,extra={}){
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-fixes2-'));
  for(const album of ['A','B']){await mkdir(path.join(root,'photos','shoots',album),{recursive:true});await writeFile(path.join(root,'photos','shoots',album,'P1.jpg'),await jpg());}
  const options={photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false,...extra};
  const app=await createApp(options);
  let closed=false;
  t.after(async()=>{if(!closed)await app.close();await rm(root,{recursive:true,force:true});});
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const cookieOf=r=>r.headers['set-cookie'].split(';')[0];
  const admin=cookieOf(await req('POST','/api/admin/login',{password:'test-password-1234'}));
  await req('POST','/api/admin/sources',{relative_path:'shoots',label:'S'},admin);
  const a=(await req('POST','/api/admin/projects',{name:'A',root:'shoots/A'},admin)).json().id;
  const b=(await req('POST','/api/admin/projects',{name:'B',root:'shoots/B'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();
  return {root,app,req,cookieOf,admin,a,b,close:async()=>{closed=true;await app.close();}};
}

test('assigned-only staff cannot reach customers who also have other albums',async t=>{
  const {req,cookieOf,admin,a,b}=await setup(t);
  const editor=(await req('POST','/api/admin/users',{username:'editor',name:'Ed',password:'editor-pass-1',role:'staff',album_scope:'assigned'},admin)).json().id;
  await req('PUT',`/api/admin/projects/${a}/staff`,{user_ids:[editor]},admin);
  const ed=cookieOf(await req('POST','/api/admin/login',{username:'editor',password:'editor-pass-1'}));
  const other=(await req('POST',`/api/admin/projects/${b}/links`,{label:'Lan',phone:'0901234567'},admin)).json();
  // Linking that customer into the editor's album, by phone or by id, is refused.
  assert.equal((await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan',phone:'0901234567'},ed)).statusCode,403);
  assert.equal((await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan',customer_id:other.customer.id},ed)).statusCode,403);
  // Even once linked by an admin into both albums, the editor cannot reset that customer's PIN.
  await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan',customer_id:other.customer.id},admin);
  assert.equal((await req('POST',`/api/admin/customers/${other.customer.id}/pin`,{},ed)).statusCode,404);
  assert.equal((await req('GET','/api/admin/customers',undefined,ed)).json().length,0);
  // A brand-new customer in the editor's album is theirs to manage.
  const mine=(await req('POST',`/api/admin/projects/${a}/links`,{label:'Hà',phone:'0912000000'},ed)).json();
  assert.equal((await req('POST',`/api/admin/customers/${mine.customer.id}/pin`,{},ed)).statusCode,200);
  // Changing an account's album scope signs it out (open realtime streams included).
  await req('PATCH',`/api/admin/users/${editor}`,{name:'Ed',role:'staff',disabled:false,album_scope:'all'},admin);
  assert.equal((await req('GET','/api/admin/me',undefined,ed)).statusCode,401);
});

test('parallel wrong PINs cannot exceed the per-phone limit',async t=>{
  const {req,admin,a}=await setup(t);
  const link=(await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan',phone:'0901234567'},admin)).json();
  const results=await Promise.all(Array.from({length:12},()=>req('POST','/api/customer/login',{phone:'0901234567',pin:'999999'})));
  assert.equal(results.filter(r=>r.statusCode===401).length,5,'only five attempts are evaluated');
  assert.equal(results.filter(r=>r.statusCode===429).length,7);
  assert.equal((await req('POST','/api/customer/login',{phone:'0901234567',pin:link.pin})).statusCode,429);
});

test('watermark failure never leaves an unstamped preview; archived albums are not synced',async t=>{
  const {app,req,admin,a}=await setup(t);
  const logo=await sharp({create:{width:50,height:50,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
  await req('PUT','/api/admin/logo',{dataUrl:`data:image/png;base64,${logo.toString('base64')}`},admin);
  const settings=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  await req('PUT','/api/admin/settings',{...settings,watermark:'center'},admin);
  await new Promise(r=>setTimeout(r,50));
  await unlink(app.services.config.logoPath);// logo vanishes mid-life: stamping fails
  const photo=app.services.db.get('SELECT id FROM photos WHERE project_id=?',a).id;
  assert.equal((await req('GET',`/api/admin/photos/${photo}/preview`,undefined,admin)).statusCode,415);
  assert.equal((await readdir(app.services.config.cacheDir)).some(n=>n.includes('-preview')),false,'no unwatermarked preview left behind');
  await req('POST',`/api/admin/projects/${a}/archive`,{archived:true},admin);
  assert.equal((await req('POST',`/api/admin/projects/${a}/sync`,{},admin)).statusCode,409);
  const p=(await req('GET','/api/admin/projects',undefined,admin)).json().find(x=>x.id===a);
  await req('PATCH',`/api/admin/projects/${a}`,{name:p.name,cron:'*/5 * * * *',timezone:p.timezone},admin);
  assert.equal(app.services.db.get('SELECT next_scan FROM projects WHERE id=?',a).next_scan,null);
});

test('a RAW picked before its JPG arrives hands the pick to the JPG',async t=>{
  const {root,app,req,cookieOf,admin,a}=await setup(t,{exiftool:'none'});
  const dir=path.join(root,'photos','shoots','A');
  await writeFile(path.join(dir,'SHOT.CR2'),Buffer.from('raw'));
  await mkdir(path.join(dir,'@eaDir','SHOT.CR2'),{recursive:true});await writeFile(path.join(dir,'@eaDir','SHOT.CR2','SYNOPHOTO_THUMB_XL.jpg'),await jpg());
  const {db,scanner,worker}=app.services;
  const rescan=async()=>{scanner.start(db.get('SELECT * FROM projects WHERE id=?',a));await scanner.wait();await worker.drain();};
  await rescan();
  await req('PATCH',`/api/admin/projects/${a}/workflow`,{max_edit:1},admin);
  const link=(await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan'},admin)).json();
  const client=cookieOf(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'}));
  const raw=db.get("SELECT id FROM photos WHERE filename='SHOT.CR2'").id;
  assert.equal((await req('PUT',`/api/client/photos/${raw}/edit`,{selected:true},client)).statusCode,200);
  await writeFile(path.join(dir,'SHOT.jpg'),await jpg());
  await rescan();
  const g=(await req('GET','/api/client/gallery',undefined,client)).json();
  assert.equal(g.project.edit_count,1);
  assert.deepEqual((await req('GET','/api/client/photos?edit=1',undefined,client)).json().photos.map(p=>p.filename),['SHOT.jpg']);
});

test('pending notification digests are sent on shutdown; webhook URL is masked; SMTP password is tied to its server',async t=>{
  const mails=[];
  const {req,cookieOf,admin,a,close}=await setup(t,{mailTransport:{sendMail:async m=>{mails.push(m);}},notifyDigestMs:60_000});
  const s=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  await req('PUT','/api/admin/settings',{...s,notifyEmail:'s@example.test',smtpHost:'smtp.one.test',smtpPass:'pw',webhookUrl:'https://hooks.example.test/abc?token=x'},admin);
  const shown=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  assert.equal(shown.webhookUrl,SECRET_MASK);
  assert.equal((await req('PUT','/api/admin/settings',{...shown,smtpHost:'smtp.evil.test'},admin)).statusCode,400);
  assert.equal((await req('PUT','/api/admin/settings',{...shown,studioName:'X'},admin)).statusCode,200,'unchanged host keeps the stored password');
  const link=(await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan'},admin)).json();
  const client=cookieOf(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'}));
  await req('POST','/api/client/messages',{body:'Xin chào'},client);
  assert.equal(mails.length,0,'still waiting for the digest window');
  await close();
  assert.equal(mails.length,1);assert.match(mails[0].text,/Xin chào/);
});
