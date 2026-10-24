import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../src/app.mjs';

const origin='http://localhost:3210';

async function setup(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'proofing-messages-'));
  const photoRoot=path.join(root,'photos');
  await mkdir(path.join(photoRoot,'album','Public'),{recursive:true});await mkdir(path.join(photoRoot,'album','Private'),{recursive:true});
  const jpg=await sharp({create:{width:40,height:30,channels:3,background:'#335544'}}).jpeg().toBuffer();
  await writeFile(path.join(photoRoot,'album','Public','A.jpg'),jpg);await writeFile(path.join(photoRoot,'album','Private','B.jpg'),jpg);
  const options={photoRoot,dataDir:path.join(root,'data'),cacheDir:path.join(root,'cache'),adminPassword:'test-password-1234',origin,background:false,logger:false};
  const ctx={root,options};
  ctx.start=async()=>{ctx.app=await createApp(options);ctx.db=ctx.app.services.db;return ctx.app;};
  await ctx.start();
  t.after(async()=>{await ctx.app.close();await rm(root,{recursive:true,force:true});});
  ctx.request=(method,url,payload,cookie)=>ctx.app.inject({method,url,payload,headers:{origin,...(cookie?{cookie}:{})}});
  const login=await ctx.request('POST','/api/admin/login',{password:options.adminPassword});
  ctx.admin=login.headers['set-cookie'].split(';')[0];
  await ctx.request('POST','/api/admin/sources',{relative_path:'album',label:'Album'},ctx.admin);
  ctx.pid=(await ctx.request('POST','/api/admin/projects',{name:'Lan & Minh',root:'album'},ctx.admin)).json().id;
  await ctx.app.services.scanner.wait();
  const folders=(await ctx.request('GET',`/api/admin/projects/${ctx.pid}/folders`,undefined,ctx.admin)).json();
  ctx.publicPhoto=ctx.db.get("SELECT id FROM photos WHERE filename='A.jpg'").id;
  ctx.privatePhoto=ctx.db.get("SELECT id FROM photos WHERE filename='B.jpg'").id;
  ctx.client=async(label,folderNames)=>{
    const folder_ids=folders.filter(f=>folderNames?.includes(f.name)).map(f=>f.id);
    const link=(await ctx.request('POST',`/api/admin/projects/${ctx.pid}/links`,{label,folder_ids},ctx.admin)).json();
    const token=link.url.split('/').pop();
    const join=async name=>(await ctx.request('POST',`/api/share/${token}/unlock`,{name})).headers['set-cookie'].split(';')[0];
    return {cookie:await join(label),link,join};
  };
  return ctx;
}

test('two-way album chat and photo threads with per-reader unread cursors',async t=>{
  const ctx=await setup(t),{request,admin,pid}=ctx;
  const bride=await ctx.client('Lan',['Public']),groom={cookie:await bride.join('Minh')},family=await ctx.client('Gia đình');
  // Customer pins a note on a photo inside their scope; a photo outside the scope is refused.
  const note=await request('POST','/api/client/messages',{photo_id:ctx.publicPhoto,x:0.2,y:0.4,body:'Làm sáng mặt'},bride.cookie);
  assert.equal(note.statusCode,200,note.body);assert.equal(note.json().mine,true);
  assert.equal((await request('POST','/api/client/messages',{photo_id:ctx.privatePhoto,body:'x'},bride.cookie)).statusCode,404);
  assert.equal((await request('POST','/api/client/messages',{body:'x',x:0.5,y:0.5},bride.cookie)).statusCode,400,'a pin needs a photo');
  assert.equal((await request('POST','/api/client/messages',{photo_id:ctx.publicPhoto,body:'unpinned note'},bride.cookie)).statusCode,200);
  // Studio replies on the photo thread and in the album chat, signed with the staff member's name.
  await request('POST',`/api/admin/projects/${pid}/messages`,{photo_id:ctx.privatePhoto,body:'Ghi chú nội bộ ảnh riêng'},admin);
  const reply=(await request('POST',`/api/admin/projects/${pid}/messages`,{photo_id:ctx.publicPhoto,body:'Studio đã nhận'},admin)).json();
  assert.match(reply.author_name,/Chủ studio$/);
  await request('POST',`/api/admin/projects/${pid}/messages`,{body:'Chào Lan & Minh'},admin);
  const thread=(await request('GET',`/api/client/messages?photo_id=${ctx.publicPhoto}`,undefined,groom.cookie)).json();
  assert.deepEqual(thread.map(m=>m.author_role),['client','client','staff']);
  assert.equal(thread[0].mine,false,'another device of the album sees the note but does not own it');
  // A link scoped to Public never sees messages about Private photos; an unscoped link does.
  const brideAll=(await request('GET','/api/client/messages',undefined,bride.cookie)).json();
  assert.equal(brideAll.some(m=>m.photo_id===ctx.privatePhoto),false);
  assert.equal((await request('GET',`/api/client/messages?photo_id=${ctx.privatePhoto}`,undefined,bride.cookie)).statusCode,404);
  assert.equal((await request('GET','/api/client/messages',undefined,family.cookie)).json().some(m=>m.photo_id===ctx.privatePhoto),true);
  // Customer unread counts only studio messages they are allowed to see, per link.
  assert.deepEqual((await request('GET','/api/client/messages/unread',undefined,bride.cookie)).json(),{total:2,chat:1,photos:{[ctx.publicPhoto]:1}});
  assert.equal((await request('GET','/api/client/messages/unread',undefined,family.cookie)).json().total,3);
  await request('POST','/api/client/messages/read',{},bride.cookie);
  assert.equal((await request('GET','/api/client/messages/unread',undefined,bride.cookie)).json().total,0);
  assert.equal((await request('GET','/api/client/messages/unread',undefined,groom.cookie)).json().total,0,'same link shares the cursor');
  assert.equal((await request('GET','/api/client/messages/unread',undefined,family.cookie)).json().total,3);
  // Staff: replying marks the conversation read; a later customer message is unread again.
  assert.equal((await request('GET','/api/admin/chats',undefined,admin)).json()[0].unread_count,0);
  await request('POST','/api/client/messages',{body:'Cảm ơn studio'},family.cookie);
  const chats=(await request('GET','/api/admin/chats',undefined,admin)).json();
  assert.equal(chats[0].unread_count,1);assert.equal(chats[0].last_body,'Cảm ơn studio');
  // Resolving a note is staff-only and only applies to customer photo notes.
  const notes=(await request('GET',`/api/admin/projects/${pid}/comments`,undefined,admin)).json();
  assert.equal(notes.length,2);
  assert.equal((await request('PATCH',`/api/admin/messages/${notes[0].id}`,{resolved:true},admin)).statusCode,200);
  assert.equal((await request('PATCH',`/api/admin/messages/${reply.id}`,{resolved:true},admin)).statusCode,404);
  assert.equal((await request('PATCH',`/api/admin/messages/${notes[0].id}`,{resolved:true},bride.cookie)).statusCode,401);
  const project=(await request('GET','/api/admin/projects',undefined,admin)).json()[0];
  assert.equal(project.open_comment_count,1);assert.equal(project.unread_message_count,1);
});

test('history pages backwards, and opening a photo thread marks only that photo read',async t=>{
  const ctx=await setup(t),{request,admin,pid}=ctx;
  const bride=await ctx.client('Lan');
  for(let i=1;i<=7;i++)await request('POST',`/api/admin/projects/${pid}/messages`,{body:`Tin ${i}`},admin);
  await request('POST',`/api/admin/projects/${pid}/messages`,{photo_id:ctx.publicPhoto,body:'Trả lời ảnh'},admin);
  const latest=(await request('GET','/api/client/messages?limit=3',undefined,bride.cookie)).json();
  assert.deepEqual(latest.map(m=>m.body),['Tin 6','Tin 7','Trả lời ảnh']);
  const older=(await request('GET',`/api/client/messages?limit=3&before=${latest[0].seq}`,undefined,bride.cookie)).json();
  assert.deepEqual(older.map(m=>m.body),['Tin 3','Tin 4','Tin 5']);
  const adminOlder=(await request('GET',`/api/admin/projects/${pid}/messages?limit=2&before=${latest[0].seq}`,undefined,admin)).json();
  assert.deepEqual(adminOlder.map(m=>m.body),['Tin 4','Tin 5']);
  assert.deepEqual((await request('GET','/api/client/messages/unread',undefined,bride.cookie)).json(),{total:8,chat:7,photos:{[ctx.publicPhoto]:1}});
  await request('POST','/api/client/messages/read',{photo_id:ctx.publicPhoto},bride.cookie);
  assert.deepEqual((await request('GET','/api/client/messages/unread',undefined,bride.cookie)).json(),{total:7,chat:7,photos:{}});
  assert.equal((await request('POST','/api/client/messages/read',{photo_id:ctx.privatePhoto},(await ctx.client('Scoped',['Public'])).cookie)).statusCode,404);
});

test('staff notifications for messages and submitted lists, seen per staff account',async t=>{
  const ctx=await setup(t),{request,admin}=ctx;
  const bride=await ctx.client('Lan');
  await request('POST','/api/client/messages',{body:'Khi nào có ảnh?'},bride.cookie);
  const gallery=(await request('GET','/api/client/gallery',undefined,bride.cookie)).json();
  await request('PUT',`/api/client/lists/${gallery.lists[0].id}/photos/${ctx.publicPhoto}`,{selected:true},bride.cookie);
  await request('POST',`/api/client/lists/${gallery.lists[0].id}/submit`,{submitted:true},bride.cookie);
  let feed=(await request('GET','/api/admin/notifications',undefined,admin)).json();
  assert.equal(feed.unseen,2);assert.deepEqual(feed.items.map(n=>n.kind),['submitted','message']);
  assert.match(feed.items[0].text,/Lan đã chốt "Ảnh làm album" \(1 ảnh\) — Lan & Minh/);
  await request('POST','/api/admin/notifications/seen',{},admin);
  feed=(await request('GET','/api/admin/notifications',undefined,admin)).json();
  assert.equal(feed.unseen,0);assert.equal(feed.items.every(n=>!n.new),true);
  assert.equal((await request('GET','/api/admin/notifications',undefined,bride.cookie)).statusCode,401);
});

test('SSE pushes change events to the album room and staff, and stops after revocation',async t=>{
  const ctx=await setup(t),{request,admin,pid}=ctx;
  const bride=await ctx.client('Lan',['Public']);
  await ctx.app.listen({port:0,host:'127.0.0.1'});
  const base=`http://127.0.0.1:${ctx.app.server.address().port}`;
  const open=async cookie=>{
    const res=await fetch(`${base}${cookie===admin?'/api/admin/events':'/api/client/events'}`,{headers:{cookie}});
    assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);
    const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
    const next=async()=>{for(;;){const event=buffer.match(/data: (.*)\n\n/);if(event){buffer=buffer.slice(event.index+event[0].length);return JSON.parse(event[1]);}
      const {value,done}=await reader.read();if(done)return null;buffer+=decoder.decode(value);}};
    return {next,close:()=>reader.cancel()};
  };
  assert.equal((await fetch(`${base}/api/admin/events`)).status,401);
  const staff=await open(admin),client=await open(bride.cookie);
  t.after(()=>{staff.close();client.close();});
  await request('POST',`/api/admin/projects/${pid}/messages`,{body:'Xin chào'},admin);
  const pushed=await client.next();
  assert.equal(pushed.type,'message');assert.equal(pushed.author_role,'staff');assert.equal(pushed.project_id,pid);assert.equal('body' in pushed,false);
  await request('POST','/api/client/messages',{body:'Chào studio'},bride.cookie);
  const kinds=[];for(let i=0;i<4;i++)kinds.push((await staff.next()).type);
  assert.deepEqual(kinds.sort(),['message','message','notification','read']);
  // Re-marking an already-read thread must not broadcast: a client refetching on "read" would loop.
  await request('POST',`/api/admin/projects/${pid}/messages/read`,{},admin);
  assert.equal((await staff.next()).type,'read');
  await request('POST',`/api/admin/projects/${pid}/messages/read`,{},admin);
  await request('POST',`/api/admin/projects/${pid}/messages/read`,{},admin);
  await request('POST','/api/client/messages',{body:'Tin tiếp'},bride.cookie);
  assert.equal((await staff.next()).type,'message');
  const links=(await request('GET',`/api/admin/projects/${pid}/links`,undefined,admin)).json();
  await request('POST',`/api/admin/links/${links[0].id}/revoke`,{},admin);
  assert.equal((await fetch(`${base}/api/client/events`,{headers:{cookie:bride.cookie}})).status,403);
});

test('v0.2 comments and chat_messages are migrated once, keeping read state',async t=>{
  const ctx=await setup(t),{request,admin,pid}=ctx;
  const bride=await ctx.client('Lan');
  const session=ctx.db.get("SELECT id FROM sessions WHERE role='client'").id;
  await ctx.app.close();
  const raw=new DatabaseSync(path.join(ctx.options.dataDir,'gallery.sqlite'));
  raw.exec('DROP TABLE messages;DROP TABLE read_cursors;');
  const ins=raw.prepare('INSERT INTO comments(id,project_id,photo_id,session_id,x,y,body,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  ins.run('c1',pid,ctx.publicPhoto,session,0.1,0.2,'Ghi chú cũ',1,'2026-09-01 08:00:00');
  const chat=raw.prepare('INSERT INTO chat_messages(id,project_id,session_id,sender_role,sender_name,body,created_at,read_at) VALUES(?,?,?,?,?,?,?,?)');
  chat.run('m1',pid,session,'client','Lan','Tin đã đọc','2026-09-01 09:00:00','2026-09-01 09:30:00');
  chat.run('m2',pid,null,'admin','Studio','Studio trả lời','2026-09-01 10:00:00',null);
  chat.run('m3',pid,session,'client','Lan','Tin chưa đọc','2026-09-02 10:00:00',null);
  raw.close();
  await ctx.start();
  const thread=(await request('GET',`/api/admin/projects/${pid}/messages`,undefined,admin)).json();
  assert.deepEqual(thread.map(m=>m.body),['Ghi chú cũ','Tin đã đọc','Studio trả lời','Tin chưa đọc']);
  assert.deepEqual(thread.map(m=>m.author_role),['client','client','staff','client']);
  assert.equal(thread[0].x,0.1);assert.equal(thread[0].resolved,true);assert.equal(thread[0].author_name,'Lan');
  assert.equal(thread[1].created_at,'2026-09-01T09:00:00.000Z');
  assert.equal((await request('GET','/api/admin/chats',undefined,admin)).json()[0].unread_count,1);
  assert.equal((await request('GET','/api/client/messages/unread',undefined,bride.cookie)).json().total,1,'the old studio reply was never shown to the customer');
  await ctx.app.close();await ctx.start();
  assert.equal(ctx.db.get('SELECT count(*) AS n FROM messages').n,4,'migration runs only once');
});
