import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/app.mjs';
import {SECRET_MASK} from '../src/outbound.mjs';

const origin='http://localhost:3210';

test('studio alerts go to e-mail, Telegram and webhook, batched per album; secrets never reach the browser',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-outbound-'));await mkdir(path.join(root,'photos','album'),{recursive:true});
  const hooks=[],telegram=[],mails=[];
  const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    if(req.url.startsWith('/bot'))telegram.push({url:req.url,body:JSON.parse(body)});else hooks.push(JSON.parse(body));res.end('{"ok":true}');});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const mailTransport={sendMail:async m=>{mails.push(m);return {};}};
  const app=await createApp({photoRoot:path.join(root,'photos'),dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false,
    mailTransport,telegramApi:base,notifyDigestMs:100});
  t.after(async()=>{server.close();await app.close();await rm(root,{recursive:true,force:true});});
  const req=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const admin=(await req('POST','/api/admin/login',{password:'test-password-1234'})).headers['set-cookie'].split(';')[0];
  assert.equal((await req('POST','/api/admin/notify/test',{},admin)).statusCode,400,'nothing configured');
  const settings=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  const configured={...settings,notifyEmail:'studio@example.test',smtpHost:'smtp.example.test',smtpUser:'mailer',smtpPass:'s3cret-pass',telegramToken:'123:ABC',telegramChat:'-1001',webhookUrl:`${base}/hook`};
  assert.equal((await req('PUT','/api/admin/settings',configured,admin)).statusCode,200);
  const shown=(await req('GET','/api/admin/settings',undefined,admin)).json().settings;
  assert.equal(shown.smtpPass,SECRET_MASK);assert.equal(shown.telegramToken,SECRET_MASK);
  // Saving the masked form keeps the stored secrets.
  assert.equal((await req('PUT','/api/admin/settings',{...shown,studioName:'Lumière'},admin)).statusCode,200);
  assert.equal(app.services.config.smtpPass,'s3cret-pass');assert.equal(app.services.config.telegramToken,'123:ABC');
  assert.deepEqual((await req('POST','/api/admin/notify/test',{},admin)).json(),{email:'ok',telegram:'ok',webhook:'ok'});
  assert.equal(telegram[0].url,'/bot123:ABC/sendMessage');assert.equal(telegram[0].body.chat_id,'-1001');
  assert.equal(mails[0].to,'studio@example.test');
  hooks.length=0;telegram.length=0;mails.length=0;

  // Two quick customer messages become one digest.
  await req('POST','/api/admin/sources',{relative_path:'album',label:'A'},admin);
  const pid=(await req('POST','/api/admin/projects',{name:'Lan & Minh',root:'album'},admin)).json().id;
  const link=(await req('POST',`/api/admin/projects/${pid}/links`,{label:'Lan'},admin)).json();
  const client=(await req('POST',`/api/share/${link.url.split('/').pop()}/unlock`,{name:'Lan'})).headers['set-cookie'].split(';')[0];
  await req('POST','/api/client/messages',{body:'Chào studio'},client);
  await req('POST','/api/client/messages',{body:'Khi nào có ảnh?'},client);
  await new Promise(r=>setTimeout(r,300));
  assert.equal(hooks.length,1);assert.equal(hooks[0].items.length,2);assert.equal(hooks[0].album.name,'Lan & Minh');
  assert.match(mails[0].subject,/\[Lumière\] Lan & Minh: 2 hoạt động mới/);
  assert.match(telegram[0].body.text,/Khi nào có ảnh\?/);
  assert.match(hooks[0].url,/\/manager$/);
  // Bad webhook URLs are refused.
  assert.equal((await req('PUT','/api/admin/settings',{...shown,webhookUrl:'file:///etc/passwd'},admin)).statusCode,400);
});
