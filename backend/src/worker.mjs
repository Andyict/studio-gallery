import {photoPath} from './shares.mjs';
import sharp from 'sharp';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { safePath, safeOpen } from './security.mjs';
import { isVideo, runMedia } from './media.mjs';
import { cacheFile } from './previews.mjs';
export { cacheFile };

// Background job per photo version. Stills only get a thumbnail here (the 2048 px preview is made
// on first view by previews.ensure); videos are transcoded up front because that takes minutes.
export function createWorker(db, config, logger, previews) {
  let running = null;
  // Files of replaced or removed photos are swept at start and then every few hours while idle.
  let lastClean = 0;
  const CLEAN_EVERY = 6 * 3600_000;
  db.run("UPDATE jobs SET status='pending' WHERE status='running'");
  async function cleanCache() {
    const expected=new Set();
    for(const photo of db.all("SELECT * FROM photos WHERE missing=0 AND status='ready'")) {
      expected.add(path.basename(cacheFile(config,photo,'preview')));
      expected.add(path.basename(cacheFile(config,photo,'thumb')));
      if(isVideo(photo))expected.add(path.basename(cacheFile(config,photo,'video')));
    }
    const present=new Set(),tracked=new Set(db.all('SELECT file FROM preview_cache').map(r=>r.file));
    for(const entry of await readdir(config.cacheDir,{withFileTypes:true})){
      if(!entry.isFile())continue;
      if(!expected.has(entry.name)){await rm(path.join(config.cacheDir,entry.name),{force:true}).catch(()=>{});continue;}
      present.add(entry.name);
      // Previews made before the cache budget existed (v0.2 rendered them all up front) are adopted,
      // with their file time as last access, so they count toward the limit and can be evicted.
      if(entry.name.endsWith('-preview.webp')&&!tracked.has(entry.name)){
        const photo=db.get('SELECT id,filename,extension FROM photos WHERE id=?',entry.name.slice(0,36));
        if(photo&&!isVideo(photo)){const info=await stat(path.join(config.cacheDir,entry.name));previews.adopt(entry.name,photo.id,info.size,info.mtimeMs);}
      }
    }
    previews.forget([...tracked].filter(file=>!present.has(file)));
    previews.evict();
  }
  async function renderVideo(photo) {
    const project = db.get('SELECT * FROM projects WHERE id=?',photo.project_id);
    const root = await photoPath(config.photoRoot,project.root);
    const source = await safeOpen(root,photo.relative_path);
    const info = await source.stat();await source.close();
    if (info.size !== photo.bytes || info.mtimeMs !== photo.mtime) throw new Error('Source changed; run sync again');
    const filename=await safePath(root,photo.relative_path), video=cacheFile(config,photo,'video'), staging=video+'.tmp', poster=cacheFile(config,photo,'preview'), posterTemp=poster+'.tmp';
    try {
      await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-threads','1','-protocol_whitelist','file,pipe','-i',filename,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-c:v','libx264','-threads','1','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-b:a','128k','-map_metadata','-1','-movflags','+faststart','-f','mp4',staging]);
      await rename(staging,video);
      await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-i',video,'-frames:v','1','-c:v','libwebp','-threads','1','-f','image2',posterTemp],60000);
      await rename(posterTemp,poster);
      await sharp(poster).resize({width:480,height:720,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toFile(`${cacheFile(config,photo,'thumb')}.tmp`);
      await rename(`${cacheFile(config,photo,'thumb')}.tmp`,cacheFile(config,photo,'thumb'));
      const meta = await sharp(poster).metadata();
      return {width:meta.width,height:meta.height};
    } finally { for(const f of [staging,posterTemp])await rm(f,{force:true}).catch(()=>{}); }
  }
  async function work() {
    await mkdir(config.cacheDir,{recursive:true});
    if(!lastClean){await cleanCache();lastClean=Date.now();}
    const job = db.get("SELECT j.* FROM jobs j JOIN photos p ON p.id=j.photo_id WHERE j.status='pending' AND j.attempts<3 AND p.missing=0 AND p.paired_with IS NULL AND j.version=p.version ORDER BY j.rowid LIMIT 1");
    if (!job) { if(Date.now()-lastClean>CLEAN_EVERY){lastClean=Date.now();await cleanCache().catch(e=>logger.warn({err:e},'Cache cleanup failed'));} return; }
    db.run("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?",job.id);
    const photo=db.get('SELECT * FROM photos WHERE id=?',job.photo_id);
    try {
      const {width,height}=isVideo(photo)?await renderVideo(photo):await previews.thumbnail(photo);
      db.run("UPDATE photos SET status='ready',error=NULL,width=?,height=? WHERE id=? AND version=?",width,height,photo.id,photo.version);
      db.run("UPDATE jobs SET status='completed',error=NULL WHERE id=?",job.id);
    } catch(e) {
      logger.warn({photo:job.photo_id,error:e.message},'Preview failed');
      const permanent=/Unrecognized option|Unknown encoder|Encoder .* not found|Unsupported image or codec|RAW has no readable/i.test(e.message);
      db.run("UPDATE jobs SET status=CASE WHEN attempts<3 AND ?=0 THEN 'pending' ELSE 'failed' END,error=? WHERE id=?",+permanent,e.message,job.id);
      db.run("UPDATE photos SET status='failed',error=? WHERE id=? AND version=?",e.message,job.photo_id,job.version);
    }
  }
  return {
    tick() { if(!running) running=work().finally(()=>{running=null;}); return running; },
    async drain() { while(db.get("SELECT 1 FROM jobs j JOIN photos p ON p.id=j.photo_id WHERE j.status='pending' AND j.attempts<3 AND p.missing=0 AND p.paired_with IS NULL AND j.version=p.version")) await this.tick(); },
    async stop() { await running; }
  };
}
