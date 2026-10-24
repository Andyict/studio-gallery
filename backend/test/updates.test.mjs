import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/app.mjs';
import {newer} from '../src/updates.mjs';

test('DSM version comparison',()=>{
  assert.equal(newer('0.3.0-0012','0.3.0-0009'),true);
  assert.equal(newer('0.3.0-0009','0.3.0-0012'),false);
  assert.equal(newer('0.10.0-0001','0.9.9-9999'),true);
  assert.equal(newer('0.3.0-0001','0.3.0-0001'),false);
  assert.equal(newer('0.3.0-0001','dev'),true);
});

test('Package Center source offers the latest GitHub release; form POST without Origin is accepted',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-updates-'));await mkdir(path.join(root,'photos'));
  const realFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    if(String(url).endsWith('/releases/latest'))return Response.json({tag_name:'v0.3.1',html_url:'https://github.com/o/r/releases/v0.3.1',body:'Changes',published_at:'2026-10-20T00:00:00Z',
      assets:[{name:'StudioGallery-x86_64-0.3.1-0007.spk',browser_download_url:'https://example.test/a.spk',size:123},{name:'release.json',browser_download_url:'https://example.test/release.json'}]});
    if(String(url).endsWith('/release.json'))return Response.json({version:'0.3.1-0007',md5:'abc',size:456});
    return new Response('nope',{status:404});
  };
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin:'http://localhost:3210',background:false,logger:false,updateRepo:'o/r',appVersion:'0.3.0-0005'});
  t.after(async()=>{globalThis.fetch=realFetch;await app.close();await rm(root,{recursive:true,force:true});});
  const source=await app.inject({method:'POST',url:'/api/pkg-source',payload:'arch=x86_64&build=72806&language=vie',headers:{'content-type':'application/x-www-form-urlencoded'}});
  assert.equal(source.statusCode,200,source.body);
  const [pkg]=source.json().packages;
  assert.equal(pkg.package,'StudioGallery');assert.equal(pkg.version,'0.3.1-0007');assert.equal(pkg.md5,'abc');assert.equal(pkg.size,456);assert.equal(pkg.link,'https://example.test/a.spk');
  assert.equal((await app.inject({method:'GET',url:'/api/pkg-source'})).json().packages.length,1);
  assert.equal(calls,2,'GitHub is asked once per cache window');
  const admin=(await app.inject({method:'POST',url:'/api/admin/login',payload:{password:'test-password-1234'},headers:{origin:'http://localhost:3210'}})).headers['set-cookie'].split(';')[0];
  const check=(await app.inject({method:'GET',url:'/api/admin/update/check',headers:{cookie:admin}})).json();
  assert.equal(check.updateAvailable,true);assert.equal(check.latest,'0.3.1-0007');assert.equal(check.current,'0.3.0-0005');
  // Other routes still refuse cross-site form posts.
  assert.equal((await app.inject({method:'POST',url:'/api/admin/login',payload:'password=x',headers:{'content-type':'application/x-www-form-urlencoded'}})).statusCode,403);
});
