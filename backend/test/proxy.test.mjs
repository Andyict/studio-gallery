import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/app.mjs';
import {createGateway,clientAddress} from '../../synology/gateway.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));

test('login rate limit is per client address, not per proxy',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'proofing-proxy-'));await mkdir(path.join(root,'photos'));
 const options={photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'initial-admin-pass',origin:'http://localhost:3210',background:false,logger:false};
 const app=await createApp(options);
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const login=ip=>app.inject({method:'POST',url:'/api/admin/login',remoteAddress:'127.0.0.1',headers:{origin:options.origin,'x-forwarded-for':ip},payload:{username:'admin',password:'wrong-password'}});
 for(let i=0;i<10;i++)assert.equal((await login('203.0.113.1')).statusCode,401);
 assert.equal((await login('203.0.113.1')).statusCode,429);
 assert.equal((await login('203.0.113.2')).statusCode,401,'another customer behind the same proxy is not locked out');
 const direct=await app.inject({method:'POST',url:'/api/admin/login',remoteAddress:'198.51.100.7',headers:{origin:options.origin,'x-forwarded-for':'203.0.113.3'},payload:{username:'admin',password:'wrong-password'}});
 assert.equal(direct.statusCode,401);
});

test('DSM gateway routes /api to the backend and overwrites spoofed X-Forwarded-For',async t=>{
 const seen=[];
 const upstream=name=>http.createServer((req,res)=>{seen.push({name,url:req.url,xff:req.headers['x-forwarded-for'],host:req.headers.host});res.setHeader('set-cookie',['a=1','b=2']);res.end(name);});
 const api=upstream('api'),web=upstream('web');
 const apiPort=await listen(api),webPort=await listen(web);
 const gateway=createGateway({api:{host:'127.0.0.1',port:apiPort},web:{host:'127.0.0.1',port:webPort}});
 const port=await listen(gateway);
 t.after(()=>{for(const s of [api,web,gateway])s.close();});
 const get=(url,headers={})=>fetch(`http://127.0.0.1:${port}${url}`,{headers});
 const a=await get('/api/health',{'x-forwarded-for':'10.9.9.9'});
 assert.equal(await a.text(),'api');assert.deepEqual(a.headers.getSetCookie(),['a=1','b=2']);
 assert.equal(await (await get('/apiary')).text(),'web');
 assert.equal(await (await get('/manager')).text(),'web');
 assert.equal(seen[0].url,'/api/health');
 // The test client connects from loopback, so it is treated like DSM Reverse Proxy: last hop wins.
 assert.equal(seen[0].xff,'10.9.9.9');
 assert.equal(seen[1].xff,'127.0.0.1');
 assert.equal(seen[0].host,`127.0.0.1:${port}`);
});

test('gateway ignores X-Forwarded-For from non-loopback peers',()=>{
 const req=(remoteAddress,xff)=>({socket:{remoteAddress},headers:xff?{'x-forwarded-for':xff}:{}});
 assert.equal(clientAddress(req('192.168.1.20','1.2.3.4')),'192.168.1.20');
 assert.equal(clientAddress(req('::ffff:192.168.1.20','1.2.3.4')),'::ffff:192.168.1.20');
 assert.equal(clientAddress(req('127.0.0.1','1.2.3.4, 203.0.113.9')),'203.0.113.9');
 assert.equal(clientAddress(req('::1')),'::1');
});

test('gateway ends the client response when the backend drops mid-stream',async t=>{
 const api=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: 1\n\n');setTimeout(()=>res.socket.destroy(),50);});
 const web=http.createServer((req,res)=>res.end());
 const apiPort=await listen(api),webPort=await listen(web);
 const gateway=createGateway({api:{host:'127.0.0.1',port:apiPort},web:{host:'127.0.0.1',port:webPort}});
 const port=await listen(gateway);
 t.after(()=>{for(const s of [api,web,gateway])s.close();});
 const res=await fetch(`http://127.0.0.1:${port}/api/events`);
 const reader=res.body.getReader();
 const outcome=await Promise.race([
  (async()=>{try{for(;;){const {done}=await reader.read();if(done)return 'closed';}}catch{return 'closed';}})(),
  new Promise(r=>setTimeout(()=>r('hung'),3000))
 ]);
 assert.equal(outcome,'closed');
});
