import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/app.mjs';

test('rescans leave unchanged rows alone, requeue changed files and tombstone removed ones',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-scan-'));
  const album=path.join(root,'photos','album');await mkdir(path.join(album,'Day1'),{recursive:true});
  for(const name of ['A.jpg','B.jpg','C.jpg'])await writeFile(path.join(album,'Day1',name),'x');
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin:'http://localhost:3210',background:false,logger:false});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const {db,scanner}=app.services;
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin:'http://localhost:3210',...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/admin/sources',{relative_path:'album',label:'Album'},admin);
  const pid=(await req('POST','/api/admin/projects',{name:'Album',root:'album'},admin)).json().id;
  await scanner.wait();
  const rescan=async()=>{scanner.start(db.get('SELECT * FROM projects WHERE id=?',pid));await scanner.wait();return db.get('SELECT * FROM scan_runs ORDER BY rowid DESC LIMIT 1');};
  const firstSeen=db.get("SELECT seen FROM photos WHERE filename='A.jpg'").seen;
  const run=await rescan();
  assert.equal(run.status,'completed');assert.equal(run.count,3);
  assert.equal(db.get("SELECT seen FROM photos WHERE filename='A.jpg'").seen,firstSeen,'unchanged photo row is not rewritten');
  await writeFile(path.join(album,'Day1','B.jpg'),'changed');await utimes(path.join(album,'Day1','B.jpg'),new Date(),new Date(Date.now()+5000));
  await rm(path.join(album,'Day1','C.jpg'));
  await writeFile(path.join(album,'Day1','D.jpg'),'new');
  await rescan();
  const rows=Object.fromEntries(db.all('SELECT filename,status,missing,version FROM photos').map(p=>[p.filename,p]));
  assert.equal(rows['B.jpg'].status,'pending','changed file is reprocessed');
  assert.equal(rows['C.jpg'].missing,1);assert.equal(rows['D.jpg'].missing,0);assert.equal(rows['A.jpg'].missing,0);
  assert.equal(db.get('SELECT count(*) AS n FROM jobs WHERE photo_id=(SELECT id FROM photos WHERE filename=?) AND version=?','B.jpg',rows['B.jpg'].version).n,1);
  // A file that comes back is restored rather than duplicated.
  await writeFile(path.join(album,'Day1','C.jpg'),'x');
  await rescan();
  assert.equal(db.get("SELECT missing FROM photos WHERE filename='C.jpg'").missing,0);
  assert.equal(db.get("SELECT count(*) AS n FROM photos WHERE filename='C.jpg'").n,1);
  // Removing the whole folder tombstones it too.
  await rm(path.join(album,'Day1'),{recursive:true});
  await rescan();
  assert.equal(db.get("SELECT missing FROM folders WHERE relative_path='Day1'").missing,1);
  assert.equal(db.get('SELECT count(*) AS n FROM photos WHERE missing=0').n,0);
});
