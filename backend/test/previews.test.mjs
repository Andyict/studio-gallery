import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';
const solid=(r,g,b,w=600,h=400)=>sharp({create:{width:w,height:h,channels:3,background:{r,g,b}}}).jpeg().toBuffer();
const centre=async file=>{const {data}=await sharp(file).resize(1,1).raw().toBuffer({resolveWithObject:true});return [...data];};

test('thumbnails reuse Synology Photos @eaDir, previews are made on first view and kept within the cache limit',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-previews-'));
  const album=path.join(root,'photos','album');
  await mkdir(album,{recursive:true});
  // GREEN.jpg has a fresh Synology thumbnail painted red; STALE.jpg's thumbnail predates the file.
  await writeFile(path.join(album,'GREEN.jpg'),await solid(0,200,0));
  await writeFile(path.join(album,'STALE.jpg'),await solid(0,0,200));
  await writeFile(path.join(album,'SHOT.CR2'),Buffer.alloc(4096,1)); // not decodable; only Synology's thumbnail can help
  for(const [name,color] of [['GREEN.jpg',[220,0,0]],['STALE.jpg',[220,0,0]],['SHOT.CR2',[0,0,0]]]){
    await mkdir(path.join(album,'@eaDir',name),{recursive:true});
    await writeFile(path.join(album,'@eaDir',name,'SYNOPHOTO_THUMB_XL.jpg'),await solid(...color,320,240));
  }
  const old=new Date(Date.now()-86400_000);
  await utimes(path.join(album,'@eaDir','STALE.jpg','SYNOPHOTO_THUMB_XL.jpg'),old,old);
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false,exiftool:'exiftool-not-installed'});
  t.after(async()=>{await app.close().catch(()=>{});await rm(root,{recursive:true,force:true});});
  const {db,config}=app.services;
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/admin/sources',{relative_path:'album',label:'Album'},admin);
  await req('POST','/api/admin/projects',{name:'Album',root:'album'},admin);
  await app.services.scanner.wait();await app.services.worker.drain();
  const photo=name=>db.get('SELECT * FROM photos WHERE filename=?',name);
  assert.equal(db.get("SELECT count(*) AS n FROM photos WHERE relative_path LIKE '%@eaDir%'").n,0,'@eaDir is never scanned as photos');
  const thumb=p=>path.join(config.cacheDir,`${p.id}-${p.version}-thumb.webp`);
  const [r,g]=await centre(thumb(photo('GREEN.jpg')));assert.ok(r>150&&g<60,'fresh Synology thumbnail used');
  const [,,b]=await centre(thumb(photo('STALE.jpg')));assert.ok(b>150,'stale Synology thumbnail ignored');
  assert.equal(photo('GREEN.jpg').width,600,'dimensions come from the source, not the thumbnail');
  assert.equal(photo('SHOT.CR2').status,'ready','RAW without ExifTool still gets a thumbnail from Synology Photos');
  // No 2048 px previews were made in the background.
  assert.equal((await readdir(config.cacheDir)).filter(n=>n.endsWith('-preview.webp')).length,0);
  const preview=async name=>req('GET',`/api/admin/photos/${photo(name).id}/preview`,undefined,admin);
  const first=await preview('GREEN.jpg');assert.equal(first.statusCode,200);assert.match(first.headers['content-type'],/webp/);
  assert.equal(app.services.previews.stats().files,1);
  // With a tiny budget, the least recently viewed preview is evicted, never the one being served.
  config.previewCacheMB=0.000001;
  assert.equal((await preview('STALE.jpg')).statusCode,200);
  const files=(await readdir(config.cacheDir)).filter(n=>n.endsWith('-preview.webp'));
  assert.deepEqual(files,[`${photo('STALE.jpg').id}-${photo('STALE.jpg').version}-preview.webp`]);
  assert.equal(app.services.previews.stats().files,1);
  // A RAW the server cannot decode answers 415 instead of failing.
  assert.equal((await preview('SHOT.CR2')).statusCode,415);
  assert.ok((await stat(thumb(photo('GREEN.jpg')))).size>0,'thumbnails are never evicted');
  // Previews rendered up front by v0.2 are adopted into the budget on the next cleanup.
  const legacy=path.join(config.cacheDir,`${photo('GREEN.jpg').id}-${photo('GREEN.jpg').version}-preview.webp`);
  await sharp({create:{width:8,height:8,channels:3,background:'#000'}}).webp().toFile(legacy);
  config.previewCacheMB=0;
  await app.close();
  const again=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false});
  again.services.config.previewCacheMB=0;
  await again.services.worker.tick();
  assert.equal(again.services.previews.stats().files,2);
  await again.close();
});
