import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';

test('RAW+JPG with the same name are one photo; original downloads include the RAW',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-pairing-'));
  const album=path.join(root,'photos','album');await mkdir(path.join(album,'Day1'),{recursive:true});
  const jpg=await sharp({create:{width:40,height:30,channels:3,background:'#778899'}}).jpeg().toBuffer();
  await writeFile(path.join(album,'Day1','IMG_001.JPG'),jpg);
  await writeFile(path.join(album,'Day1','IMG_001.CR2'),Buffer.from('raw-bytes-001'));
  await writeFile(path.join(album,'Day1','IMG_002.CR2'),Buffer.from('raw-bytes-002'));// no JPG: stays its own photo
  for(const name of ['IMG_002.CR2']){await mkdir(path.join(album,'Day1','@eaDir',name),{recursive:true});await writeFile(path.join(album,'Day1','@eaDir',name,'SYNOPHOTO_THUMB_XL.jpg'),jpg);}
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false,exiftool:'exiftool-not-installed'});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const {db}=app.services;
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/admin/sources',{relative_path:'album',label:'Album'},admin);
  const pid=(await req('POST','/api/admin/projects',{name:'Album',root:'album'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();
  assert.equal(db.get("SELECT status FROM photos WHERE filename='IMG_001.CR2'").status,'pending','paired RAW is not processed');
  const link=(await req('POST',`/api/admin/projects/${pid}/links`,{label:'Lan',originals:true},admin)).json();
  const client=(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'})).headers['set-cookie'].split(';')[0];
  const photos=(await req('GET','/api/client/photos',undefined,client)).json().photos;
  assert.deepEqual(photos.map(p=>[p.filename,p.raw_pair]),[['IMG_001.JPG',true],['IMG_002.CR2',false]]);
  const project=(await req('GET','/api/admin/projects',undefined,admin)).json()[0];
  assert.equal(project.photo_count,2);assert.equal(project.failed_count,0);
  assert.deepEqual((await req('GET',`/api/admin/projects/${pid}/photos`,undefined,admin)).json().map(p=>p.filename),['IMG_001.JPG','IMG_002.CR2']);
  // Originals ZIP of the JPG carries its RAW; the preview ZIP does not.
  const zipOf=async original=>{const t=(await req('POST','/api/client/downloads',{photo_ids:[photos[0].id],original},client)).json();return (await req('GET',t.url,undefined,client)).rawPayload;};
  const originals=await zipOf(true);
  assert.ok(originals.includes(Buffer.from('raw-bytes-001')));assert.ok(originals.includes(Buffer.from('IMG_001.JPG')));
  assert.ok(!(await zipOf(false)).includes(Buffer.from('IMG_001.CR2')));
  // The RAW file follows its JPG when the JPG is removed, and pairing can be switched off.
  const settings=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  await req('PUT','/api/admin/settings',{...settings,pairRawJpg:false},admin);
  assert.equal((await req('GET','/api/client/photos',undefined,client)).json().photos.length,3);
  await req('PUT','/api/admin/settings',{...settings,pairRawJpg:true},admin);
  await rm(path.join(album,'Day1','IMG_001.JPG'));
  app.services.scanner.start(db.get('SELECT * FROM projects WHERE id=?',pid));await app.services.scanner.wait();
  assert.deepEqual((await req('GET','/api/client/photos',undefined,client)).json().photos.map(p=>p.filename),['IMG_001.CR2','IMG_002.CR2']);
});
