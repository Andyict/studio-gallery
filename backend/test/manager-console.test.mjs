import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';
const jpg=()=>sharp({create:{width:120,height:80,channels:3,background:'#ffffff'}}).jpeg().toBuffer();

test('album photos page with search and filters; archived albums refuse new links',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-console-'));
  const dir=path.join(root,'photos','shoots','A');
  await mkdir(path.join(dir,'Final'),{recursive:true});
  for(let i=1;i<=7;i++)await writeFile(path.join(dir,`IMG_${String(i).padStart(3,'0')}.jpg`),await jpg());
  await writeFile(path.join(dir,'Final','DONE_100%.jpg'),await jpg());
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const cookieOf=r=>r.headers['set-cookie'].split(';')[0];
  const admin=cookieOf(await req('POST','/api/admin/login',{password:'test-password-1234'}));
  await req('POST','/api/admin/sources',{relative_path:'shoots',label:'S'},admin);
  const a=(await req('POST','/api/admin/projects',{name:'A',root:'shoots/A'},admin)).json().id;
  await app.services.scanner.wait();await app.services.worker.drain();

  // Without `limit` the old array shape stays; with it, pages carry the total.
  assert.equal((await req('GET',`/api/admin/projects/${a}/photos`,undefined,admin)).json().length,8);
  const first=(await req('GET',`/api/admin/projects/${a}/photos?limit=3&offset=0`,undefined,admin)).json();
  assert.equal(first.total,8);assert.equal(first.photos.length,3);
  const rest=(await req('GET',`/api/admin/projects/${a}/photos?limit=10&offset=3`,undefined,admin)).json();
  assert.equal(rest.photos.length,5);
  assert.equal(new Set([...first.photos,...rest.photos].map(p=>p.id)).size,8);
  // Filename search treats % and _ literally.
  const found=await req('GET',`/api/admin/projects/${a}/photos?limit=50&q=${encodeURIComponent('100%')}`,undefined,admin);assert.equal(found.statusCode,200,found.body);
  assert.deepEqual(found.json().photos.map(p=>p.filename),['DONE_100%.jpg']);
  assert.equal((await req('GET',`/api/admin/projects/${a}/photos?limit=50&q=_00`,undefined,admin)).json().total,7);
  // Filters: hearted photos only.
  const link=(await req('POST',`/api/admin/projects/${a}/links`,{label:'Lan'},admin)).json();
  const client=cookieOf(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'}));
  const pid=[...first.photos,...rest.photos].find(p=>p.filename.startsWith('IMG')).id;// Final/ is hidden from customers until delivery
  const list=(await req('GET','/api/client/gallery',undefined,client)).json().lists[0].id;
  assert.equal((await req('PUT',`/api/client/lists/${list}/photos/${pid}`,{selected:true},client)).statusCode,200);
  const hearted=(await req('GET',`/api/admin/projects/${a}/photos?limit=50&filter=hearted`,undefined,admin)).json();
  assert.deepEqual(hearted.photos.map(p=>p.id),[pid]);
  assert.equal((await req('GET',`/api/admin/projects/${a}/photos?limit=50&filter=bogus`,undefined,admin)).statusCode,400);
  // Album list says who works on it.
  const row=(await req('GET','/api/admin/projects',undefined,admin)).json().find(p=>p.id===a);
  assert.ok('assigned_ids' in row);
  // Archived albums cannot be shared.
  await req('POST',`/api/admin/projects/${a}/archive`,{archived:true},admin);
  assert.equal((await req('POST',`/api/admin/projects/${a}/links`,{label:'Hà'},admin)).statusCode,409);
});
