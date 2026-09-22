import {isVideo} from './media.mjs';
import yazl from 'yazl';
import { open } from 'node:fs/promises';
import { digest, fail, safePath, safeOpen } from './security.mjs';
import { cacheFile } from './worker.mjs';

export function registerDownloads(app, {db,config,authenticate,photoAllowed,listOwned,photosFor,activeLink}) {
  let active=0;
  app.post('/api/client/downloads',async(req,reply)=>{
    const session=authenticate(req); const link=activeLink(session);
    if(!link.downloads) fail(403,'Link không cho phép tải ảnh');
    const {list_id,folder_id,photo_ids,original=false}=req.body || {};
    if(typeof original!=='boolean') fail(400,'Định dạng tải không hợp lệ');
    if(original && !link.originals) fail(403,'Không được tải file gốc');
    if(list_id) listOwned(session,list_id);
    if(photo_ids!==undefined&&(!Array.isArray(photo_ids)||photo_ids.length>config.maxZipFiles||photo_ids.some(id=>typeof id!=='string')))fail(400,'Danh sách ảnh tải không hợp lệ');
    const photos=photo_ids?[...new Set(photo_ids)].map(photoID=>photoAllowed(session,photoID)):photosFor(session,{list_id,folder_id});
    if(!photos.length) fail(400,'Không có ảnh để tải');
    if(photos.length>config.maxZipFiles) fail(400,`Tối đa ${config.maxZipFiles} ảnh mỗi lượt; hãy tải từng thư mục`);
    const manifest=[];
    for(const p of photos) {
      photoAllowed(session,p.id);
      if(!original && p.status!=='ready') fail(409,`Preview chưa sẵn sàng: ${p.filename}`);
      manifest.push({id:p.id,version:p.version,original});
    }
    const ticket=(await import('./security.mjs')).token();
    db.run('INSERT INTO download_tickets(hash,session_id,manifest,expires_at) VALUES(?,?,?,?)',digest(ticket),session.id,JSON.stringify(manifest),new Date(Date.now()+120_000).toISOString());
    return {url:`/api/client/downloads/${ticket}`};
  });
  app.get('/api/client/downloads/:ticket',async(req,reply)=>{
    const session=authenticate(req); const link=activeLink(session);
    if(!link.downloads) fail(403,'Link không cho phép tải ảnh');
    const ticket=db.get('SELECT * FROM download_tickets WHERE hash=? AND session_id=? AND used=0 AND expires_at>?',digest(req.params.ticket),session.id,new Date().toISOString());
    if(!ticket) fail(404,'Lượt tải đã hết hạn hoặc đã sử dụng');
    if(active>=config.maxDownloads) fail(429,'NAS đang phục vụ lượt tải khác. Vui lòng thử lại');
    const manifest=JSON.parse(ticket.manifest);
    const entries=manifest.map(item=>{
      const photo=photoAllowed(session,item.id);
      if(photo.version!==item.version) fail(409,'Ảnh đã thay đổi; vui lòng tạo lượt tải mới');
      if(item.original && !link.originals) fail(403,'Không được tải file gốc');
      const project=db.get('SELECT * FROM projects WHERE id=?',photo.project_id);
      const name=item.original ? photo.relative_path : `${photo.relative_path.slice(0,-photo.extension.length)}-${photo.id.slice(0,8)}.${isVideo(photo)?'mp4':'webp'}`;
      return {photo,project,name,original:item.original};
    });
    // Preflight before sending headers; file handles are closed immediately, not held per entry.
    async function source(entry) {
      if(entry.original) {
        const handle=await safeOpen(await safePath(config.photoRoot,entry.project.root),entry.photo.relative_path);
        const info=await handle.stat();
        if(info.size!==entry.photo.bytes || info.mtimeMs!==entry.photo.mtime) { await handle.close(); fail(409,'Nguồn ảnh thay đổi; hãy đồng bộ lại'); }
        return handle;
      }
      return open(cacheFile(config,entry.photo,isVideo(entry.photo)?'video':'preview'),'r');
    }
    active++;
    let zip; let current; let finished=false;
    const cleanup=()=>{ if(finished)return; finished=true; active--; current?.destroy(); zip?.outputStream.destroy(); };
    try {
      for(const entry of entries) { const handle=await source(entry); await handle.close(); }
      db.run('UPDATE download_tickets SET used=1 WHERE hash=?',ticket.hash);
      zip=new yazl.ZipFile();
      zip.on('error',err=>{app.log.error({err},'ZIP stream failed'); reply.raw.destroy(err); cleanup();});
      for(const entry of entries) {
        zip.addReadStreamLazy(entry.name,{compress:false},callback=>{
          source(entry).then(async handle=>{
            if(finished) {await handle.close(); return callback(new Error('Download cancelled'));}
            current=handle.createReadStream(); callback(null,current);
          }).catch(callback);
        });
      }
      zip.end();
      reply.header('Content-Type','application/zip').header('Content-Disposition','attachment; filename="photos.zip"').header('Cache-Control','no-store').header('X-Accel-Buffering','no');
      reply.raw.on('close',cleanup);
      return reply.send(zip.outputStream);
    } catch(e) {cleanup(); throw e;}
  });
}
