import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';

async function setup(t,finalDir){
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-fixes-'));
  const album=path.join(root,'photos','album');
  await mkdir(path.join(album,'Day1'),{recursive:true});await mkdir(path.join(album,finalDir),{recursive:true});
  const jpg=await sharp({create:{width:20,height:20,channels:3,background:'#445566'}}).jpeg().toBuffer();
  await writeFile(path.join(album,'Day1','A.jpg'),jpg);await writeFile(path.join(album,finalDir,'A-final.jpg'),jpg);
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/admin/sources',{relative_path:'album',label:'Album'},admin);
  const pid=(await req('POST','/api/admin/projects',{name:'Album',root:'album'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();
  const link=(await req('POST',`/api/admin/projects/${pid}/links`,{label:'Lan'},admin)).json();
  const client=(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'})).headers['set-cookie'].split(';')[0];
  const photo=name=>app.services.db.get('SELECT id FROM photos WHERE filename=?',name).id;
  return {app,req,admin,pid,client,A:photo('A.jpg'),F:photo('A-final.jpg')};
}

test('Final folder with a Vietnamese name in another case or Unicode form stays hidden until delivery',async t=>{
  // Folder written in NFD upper case (as macOS clients do over SMB); setting typed in NFC lower case.
  const {req,admin,pid,client,F}=await setup(t,'HOÀN THIỆN'.normalize('NFD'));
  const settings=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  assert.equal((await req('PUT','/api/admin/settings',{...settings,finalFolder:'hoàn thiện'},admin)).statusCode,200);
  assert.deepEqual((await req('GET','/api/client/photos',undefined,client)).json().photos.map(p=>p.filename),['A.jpg']);
  assert.equal((await req('GET',`/api/client/photos/${F}/preview`,undefined,client)).statusCode,404);
  // A studio note on a deliverable is not shown to the customer before delivery either.
  await req('POST',`/api/admin/projects/${pid}/messages`,{photo_id:F,body:'Bản chỉnh đã xong'},admin);
  assert.equal((await req('GET','/api/client/messages',undefined,client)).json().length,0);
  assert.equal((await req('GET','/api/client/messages/unread',undefined,client)).json().total,0);
  await req('PATCH',`/api/admin/projects/${pid}/workflow`,{status:'delivered'},admin);
  assert.equal((await req('GET','/api/client/messages',undefined,client)).json().length,1);
  assert.equal((await req('GET','/api/client/gallery',undefined,client)).json().final_folder.relative_path.normalize('NFC'),'HOÀN THIỆN');
});

test('posting does not clear unread studio replies; album note locks after submit',async t=>{
  const {req,admin,pid,client,A}=await setup(t,'Final');
  await req('POST',`/api/admin/projects/${pid}/messages`,{body:'Chào chị'},admin);
  await req('POST','/api/client/messages',{photo_id:A,body:'Sáng hơn chút'},client);
  assert.equal((await req('GET','/api/client/messages/unread',undefined,client)).json().total,1);
  await req('PUT',`/api/client/lists/${(await req('GET','/api/client/gallery',undefined,client)).json().lists[0].id}/photos/${A}`,{selected:true},client);
  assert.equal((await req('POST','/api/client/album/submit',{},client)).statusCode,200);
  assert.equal((await req('PUT','/api/client/album/note',{text:'Đổi ý'},client)).statusCode,409);
});

test('SSE: a browser session cannot take every realtime slot',async t=>{
  const {app,client,admin}=await setup(t,'Final');
  await app.listen({port:0,host:'127.0.0.1'});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const open=[];
  t.after(()=>open.forEach(c=>c.abort()));
  const connect=async cookie=>{const c=new AbortController();open.push(c);return (await fetch(`${base}${cookie===admin?'/api/admin/events':'/api/client/events'}`,{headers:{cookie},signal:c.signal})).status;};
  for(let i=0;i<6;i++)assert.equal(await connect(client),200);
  assert.equal(await connect(client),429);
  assert.equal(await connect(admin),200,'staff still connect');
});
