import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';

test('album workflow: edit picks with a limit, submit lock, editor worklist, Final delivery',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-workflow-'));
  const album=path.join(root,'photos','album');
  await mkdir(path.join(album,'Day1'),{recursive:true});await mkdir(path.join(album,'Final'),{recursive:true});
  const jpg=await sharp({create:{width:30,height:20,channels:3,background:'#556677'}}).jpeg().toBuffer();
  for(const n of ['A','B','C'])await writeFile(path.join(album,'Day1',`${n}.jpg`),jpg);
  await writeFile(path.join(album,'Final','A-edit.jpg'),jpg);
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const {db}=app.services;
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/admin/sources',{relative_path:'album',label:'Album'},admin);
  const pid=(await req('POST','/api/admin/projects',{name:'Lan & Minh',root:'album'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();
  const link=(await req('POST',`/api/admin/projects/${pid}/links`,{label:'Lan'},admin)).json();
  const client=(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'})).headers['set-cookie'].split(';')[0];
  const photo=name=>db.get('SELECT id FROM photos WHERE filename=?',name).id;
  const [A,B,C,F]=['A.jpg','B.jpg','C.jpg','A-edit.jpg'].map(photo);
  const edit=(id,selected)=>req('PUT',`/api/client/photos/${id}/edit`,{selected},client);
  const gallery=async()=>(await req('GET','/api/client/gallery',undefined,client)).json();

  // Deliverables are hidden while proofing.
  let g=await gallery();
  assert.equal(g.project.status,'selecting');assert.equal(g.final_folder,null);
  assert.equal(g.folders.some(f=>f.name==='Final'),false);
  assert.deepEqual((await req('GET','/api/client/photos',undefined,client)).json().photos.map(p=>p.filename).sort(),['A.jpg','B.jpg','C.jpg']);
  assert.equal((await req('GET',`/api/client/photos/${F}/preview`,undefined,client)).statusCode,404);
  assert.equal((await req('PUT',`/api/client/lists/${g.lists[0].id}/photos/${F}`,{selected:true},client)).statusCode,404);

  // Edit picks are off until the studio sets a limit, then capped at N.
  assert.equal((await edit(A,true)).statusCode,400);
  assert.equal((await req('PATCH',`/api/admin/projects/${pid}/workflow`,{max_edit:2,due_at:'2026-11-01T10:00:00.000Z',client_message:'Chọn 2 ảnh đẹp nhất nhé'},admin)).statusCode,200);
  assert.equal((await edit(A,true)).json().edit_count,1);
  assert.equal((await edit(B,true)).statusCode,200);
  const over=await edit(C,true);assert.equal(over.statusCode,409);assert.match(over.json().error,/tối đa 2/);
  await edit(B,false);assert.equal((await edit(C,true)).statusCode,200);
  assert.deepEqual((await req('GET','/api/client/photos?edit=1',undefined,client)).json().photos.map(p=>p.filename),['A.jpg','C.jpg']);
  g=await gallery();assert.equal(g.project.edit_count,2);assert.equal(g.project.client_message,'Chọn 2 ảnh đẹp nhất nhé');assert.equal(g.project.due_at,'2026-11-01T10:00:00.000Z');

  // "Unseen" filter is per share link.
  await req('POST',`/api/client/photos/${A}/viewed`,{},client);
  assert.deepEqual((await req('GET','/api/client/photos?unseen=1',undefined,client)).json().photos.map(p=>p.filename),['B.jpg','C.jpg']);
  assert.equal((await req('GET','/api/client/photos',undefined,client)).json().photos.find(p=>p.id===A).viewed,true);

  // Album note from the customer reaches the studio.
  await req('PUT','/api/client/album/note',{text:'Tông màu ấm, da sáng'},client);
  assert.equal((await req('GET','/api/admin/projects',undefined,admin)).json()[0].customer_note,'Tông màu ấm, da sáng');

  // Submitting locks hearts, edit picks and list reopening; the studio is notified.
  assert.equal((await req('POST','/api/client/album/submit',{},client)).statusCode,200);
  assert.equal((await req('POST','/api/client/album/submit',{},client)).statusCode,409);
  assert.equal((await edit(B,true)).statusCode,409);
  assert.equal((await req('PUT',`/api/client/lists/${g.lists[0].id}/photos/${B}`,{selected:true},client)).statusCode,409);
  assert.equal((await req('POST',`/api/client/lists/${g.lists[0].id}/submit`,{submitted:false},client)).statusCode,409);
  const feed=(await req('GET','/api/admin/notifications',undefined,admin)).json().items.map(n=>n.kind);
  assert.deepEqual(feed.slice(0,2),['submitted','note']);
  const summary=(await req('GET','/api/admin/projects',undefined,admin)).json()[0];
  assert.equal(summary.status,'submitted');assert.equal(summary.edit_pick_count,2);assert.equal(summary.submitted_count,1);

  // Editor worklist with per-photo done flags and a Lightroom search string.
  let work=(await req('GET',`/api/admin/projects/${pid}/worklist`,undefined,admin)).json();
  assert.equal(work.mode,'edit');assert.deepEqual(work.photos.map(p=>p.filename),['A.jpg','C.jpg']);assert.equal(work.search_string,'A, C');
  await req('PATCH',`/api/admin/photos/${A}/done`,{done:true},admin);
  work=(await req('GET',`/api/admin/projects/${pid}/worklist`,undefined,admin)).json();
  assert.equal(work.done,1);assert.equal(work.photos[0].edit_done,true);
  assert.match((await req('GET',`/api/admin/projects/${pid}/worklist?format=csv`,undefined,admin)).body,/A\.jpg.*"1"/);
  assert.equal((await req('PATCH',`/api/admin/photos/${A}/done`,{done:true},client)).statusCode,401);

  // Studio unlock reopens lists; delivery reveals the Final folder to the customer.
  await req('PATCH',`/api/admin/projects/${pid}/workflow`,{status:'selecting'},admin);
  assert.equal((await edit(B,false)).statusCode,200);
  assert.equal(db.get('SELECT count(*) AS n FROM selection_lists WHERE submitted_at IS NOT NULL').n,0);
  assert.equal((await req('PATCH',`/api/admin/projects/${pid}/workflow`,{status:'shipped'},admin)).statusCode,400);
  await req('PATCH',`/api/admin/projects/${pid}/workflow`,{status:'delivered'},admin);
  g=await gallery();
  assert.equal(g.final_folder.name,'Final');
  assert.deepEqual((await req('GET',`/api/client/photos?folder_id=${g.final_folder.id}`,undefined,client)).json().photos.map(p=>p.filename),['A-edit.jpg']);
  assert.equal((await req('GET','/api/client/photos',undefined,client)).json().photos.some(p=>p.id===F),false,'still not mixed into proofing views');
  assert.equal((await req('GET',`/api/client/photos/${F}/preview`,undefined,client)).statusCode,200);
  assert.equal((await edit(F,true)).statusCode,409);
});
