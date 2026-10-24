import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';

async function setup(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-lifecycle-'));
  const jpg=await sharp({create:{width:800,height:600,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
  for(const album of ['Wedding','Family']){await mkdir(path.join(root,'photos','shoots',album),{recursive:true});await writeFile(path.join(root,'photos','shoots',album,'A.jpg'),jpg);}
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const cookieOf=r=>r.headers['set-cookie'].split(';')[0];
  const admin=cookieOf(await req('POST','/api/admin/login',{password:'test-password-1234'}));
  await req('POST','/api/admin/sources',{relative_path:'shoots',label:'Shoots'},admin);
  const wedding=(await req('POST','/api/admin/projects',{name:'Cưới',root:'shoots/Wedding'},admin)).json().id;
  const family=(await req('POST','/api/admin/projects',{name:'Gia đình',root:'shoots/Family'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();
  return {root,app,req,cookieOf,admin,wedding,family};
}

test('archive closes an album to customers and scans; delete removes app data but never photo files',async t=>{
  const {root,app,req,cookieOf,admin,wedding}=await setup(t);
  const {db,config}=app.services;
  const link=(await req('POST',`/api/admin/projects/${wedding}/links`,{label:'Lan',phone:'0901234567'},admin)).json();
  const token=link.url.split('/').pop();
  const client=cookieOf(await req('POST',`/api/share/${token}/unlock`,{name:'Lan'}));
  const customer=cookieOf(await req('POST','/api/customer/login',{phone:'0901234567',pin:link.pin}));
  await req('POST','/api/client/messages',{body:'Xin chào'},client);
  const ticket=(await req('POST','/api/client/downloads',{original:false},client)).json();
  assert.equal((await req('GET',ticket.url,undefined,client)).statusCode,200);
  assert.deepEqual((await req('GET',`/api/admin/projects/${wedding}/downloads`,undefined,admin)).json().map(d=>[d.client,d.original,d.files]),[['Lan',0,1]]);

  assert.equal((await req('DELETE',`/api/admin/projects/${wedding}`,{confirm:'Cưới'},admin)).statusCode,409,'must be archived first');
  await req('POST',`/api/admin/projects/${wedding}/archive`,{archived:true},admin);
  assert.equal((await req('GET','/api/client/gallery',undefined,client)).statusCode,403);
  assert.equal((await req('GET',`/api/share/${token}`)).statusCode,404);
  assert.equal((await req('GET','/api/customer/albums',undefined,customer)).json().length,0);
  assert.equal(db.get('SELECT next_scan FROM projects WHERE id=?',wedding).next_scan,null);
  assert.equal((await req('GET','/api/admin/projects',undefined,admin)).json().find(p=>p.id===wedding).archived_at!==null,true);
  // Restoring reopens everything.
  await req('POST',`/api/admin/projects/${wedding}/archive`,{archived:false},admin);
  assert.equal((await req('GET','/api/client/gallery',undefined,client)).statusCode,200);
  assert.ok(db.get('SELECT next_scan FROM projects WHERE id=?',wedding).next_scan);

  await req('POST',`/api/admin/projects/${wedding}/archive`,{archived:true},admin);
  const staff=(await req('POST','/api/admin/users',{username:'staffer',name:'Staff',password:'staffer-pass-1',role:'staff'},admin)).json();
  const staffCookie=cookieOf(await req('POST','/api/admin/login',{username:'staffer',password:'staffer-pass-1'}));
  assert.equal((await req('DELETE',`/api/admin/projects/${wedding}`,{confirm:'Cưới'},staffCookie)).statusCode,403,'admins only');
  assert.equal((await req('DELETE',`/api/admin/projects/${wedding}`,{confirm:'cưới'},admin)).statusCode,400,'exact name required');
  const weddingPhotos=db.all('SELECT id FROM photos WHERE project_id=?',wedding).map(p=>p.id);
  assert.ok((await readdir(config.cacheDir)).some(n=>weddingPhotos.some(id=>n.startsWith(id))));
  assert.equal((await req('DELETE',`/api/admin/projects/${wedding}`,{confirm:'Cưới'},admin)).statusCode,200);
  await new Promise(r=>setTimeout(r,50));
  for(const table of ['photos','folders','links','messages','selection_lists','download_log'])
    assert.equal(db.get(`SELECT count(*) AS n FROM ${table} WHERE project_id=?`,wedding).n,0,table);
  assert.ok((await stat(path.join(root,'photos','shoots','Wedding','A.jpg'))).size>0,'photo files untouched');
  assert.equal((await readdir(config.cacheDir)).some(n=>weddingPhotos.some(id=>n.startsWith(id))),false,'cache files removed');
  assert.equal(db.get('SELECT count(*) AS n FROM customers').n,1,'customer account kept');
  assert.equal(staff.id.length>0,true);
  // Automatic discovery does not bring the deleted album back; creating it by hand does.
  const source=db.get('SELECT id FROM approved_sources').id;
  const found=(await req('POST',`/api/admin/sources/${source}/discover`,{},admin)).json();
  assert.equal(found.created,0);
  assert.equal(db.get("SELECT count(*) AS n FROM projects WHERE root='shoots/Wedding'").n,0);
  assert.equal((await req('POST','/api/admin/projects',{name:'Cưới lại',root:'shoots/Wedding'},admin)).statusCode,201);
});

test('dashboard lists what needs attention; studio logo watermark is applied to previews only',async t=>{
  const {app,req,cookieOf,admin,wedding,family}=await setup(t);
  const {db,config}=app.services;
  await req('PATCH',`/api/admin/projects/${wedding}/workflow`,{status:'submitted',due_at:new Date(Date.now()-86400_000).toISOString()},admin);
  await req('PATCH',`/api/admin/projects/${family}/workflow`,{due_at:new Date(Date.now()+86400_000).toISOString()},admin);
  const link=(await req('POST',`/api/admin/projects/${family}/links`,{label:'Hà'},admin)).json();
  const client=cookieOf(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Hà'}));
  await req('POST','/api/client/messages',{body:'Có ảnh chưa?'},client);
  const photo=db.get('SELECT id FROM photos WHERE project_id=?',family).id;
  await req('POST','/api/client/messages',{photo_id:photo,body:'Sáng hơn'},client);
  const d=(await req('GET','/api/admin/dashboard',undefined,admin)).json();
  assert.deepEqual(d.submitted.map(p=>p.name),['Cưới']);
  assert.deepEqual(d.overdue.map(p=>p.name),['Cưới']);
  assert.deepEqual(d.due_soon.map(p=>p.name),['Gia đình']);
  assert.deepEqual(d.unread.map(p=>[p.name,p.n]),[['Gia đình',2]]);
  assert.deepEqual(d.open_notes.map(p=>[p.name,p.n]),[['Gia đình',1]]);
  // Archived albums drop out of the dashboard.
  await req('POST',`/api/admin/projects/${wedding}/archive`,{archived:true},admin);
  assert.equal((await req('GET','/api/admin/dashboard',undefined,admin)).json().submitted.length,0);

  // Watermark: needs a logo; changing it re-renders cached previews; thumbnails stay clean.
  // sharp tiles from the centre, so the centre pixel lies on a logo.
  const preview=async()=>{const r=await req('GET',`/api/admin/photos/${photo}/preview`,undefined,admin);assert.equal(r.statusCode,200);const {data}=await sharp(r.rawPayload).extract({left:400,top:300,width:1,height:1}).raw().toBuffer({resolveWithObject:true});return data[0];};
  assert.ok(await preview()>240,'plain white preview without watermark');
  const logo=await sharp({create:{width:200,height:200,channels:4,background:{r:0,g:0,b:0,alpha:1}}}).png().toBuffer();
  assert.equal((await req('PUT','/api/admin/logo',{dataUrl:`data:image/png;base64,${logo.toString('base64')}`},admin)).statusCode,200);
  const settings=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  assert.equal((await req('PUT','/api/admin/settings',{...settings,watermark:'tile',watermarkOpacity:60},admin)).statusCode,200);
  await new Promise(r=>setTimeout(r,50));
  assert.ok(await preview()<200,'tiled logo darkens the preview');
  const thumb=await req('GET',`/api/admin/photos/${photo}/thumb`,undefined,admin);
  const {data}=await sharp(thumb.rawPayload).resize(1,1).raw().toBuffer({resolveWithObject:true});
  assert.ok(data[0]>240,'thumbnails are never watermarked');
  assert.equal((await req('PUT','/api/admin/settings',{...settings,watermark:'off'},admin)).statusCode,200);
  await new Promise(r=>setTimeout(r,50));
  assert.ok(await preview()>240,'turning it off re-renders clean previews');
  assert.equal(config.watermark,'off');
});
