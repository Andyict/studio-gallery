import sharp from 'sharp';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { safePath, safeOpen } from './security.mjs';

sharp.cache({ memory:64, files:0, items:50 });
sharp.concurrency(1);
import {rawExtensions,isVideo,runMedia} from './media.mjs';
export const cacheFile = (config, photo, variant='preview') => path.join(config.cacheDir,`${photo.id}-${photo.version}-${variant}.${variant==='video'?'mp4':'webp'}`);

export function createWorker(db, config, logger) {
  let running = null;
  let cacheCleaned = false;
  db.run("UPDATE jobs SET status='pending' WHERE status='running'");
  async function cleanCache() {
    const expected=new Set();
    for(const photo of db.all("SELECT * FROM photos WHERE missing=0 AND status='ready'")) {
      expected.add(path.basename(cacheFile(config,photo,'preview')));
      expected.add(path.basename(cacheFile(config,photo,'thumb')));
      if(isVideo(photo))expected.add(path.basename(cacheFile(config,photo,'video')));
    }
    for(const name of await readdir(config.cacheDir))if(!expected.has(name))await rm(path.join(config.cacheDir,name),{force:true}).catch(()=>{});
  }
  async function render(photo) {
    const project = db.get('SELECT * FROM projects WHERE id=?',photo.project_id);
    const root = await safePath(config.photoRoot,project.root);
    const source = await safeOpen(root,photo.relative_path);
    const preview = cacheFile(config,photo);
    const temp = `${preview}.tmp`;
    try {
      const info = await source.stat();
      if (info.size !== photo.bytes || info.mtimeMs !== photo.mtime) throw new Error('Source changed; run sync again');
      const options = { limitInputPixels:120_000_000, failOn:'error', sequentialRead:true };
      if (isVideo(photo)) {
        await source.close();
        const filename=await safePath(root,photo.relative_path), video=cacheFile(config,photo,'video'), staging=video+'.tmp';
        try {
          await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-threads','1','-protocol_whitelist','file,pipe','-i',filename,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-c:v','libx264','-threads','1','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-b:a','128k','-map_metadata','-1','-movflags','+faststart','-f','mp4',staging]);
          await rename(staging,video);
          await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-i',video,'-frames:v','1','-c:v','libwebp','-threads','1','-f','image2',temp],60000);
        } finally { await rm(staging,{force:true}).catch(()=>{}); }
      } else if (rawExtensions.has(photo.extension)) {
        // Extract the camera's embedded JPEG. Never modify the source RAW or expose metadata/GPS.
        await source.close();
        const filename = await safePath(root,photo.relative_path);
        let success = false;
        for (const tag of ['JpgFromRaw','PreviewImage']) {
          const proc = spawn(config.exiftool, ['-b',`-${tag}`,filename], { windowsHide:true, stdio:['ignore','pipe','ignore'] });
          const timeout = setTimeout(() => proc.kill(),60_000);
          const exited = new Promise((resolve,reject) => { proc.on('error',reject); proc.on('close',code => code===0 ? resolve() : reject(new Error('RAW preview extractor failed'))); });
          try {
            await Promise.all([pipeline(proc.stdout,sharp(options).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:85}), (await import('node:fs')).createWriteStream(temp)),exited]);
            success=true; break;
          } catch { proc.kill(); await exited.catch(()=>{}); } finally { clearTimeout(timeout); }
        }
        if (!success) throw new Error('RAW has no readable embedded JPEG. Provide matching JPG or install a compatible RAW renderer.');
      } else {
        await source.close();
        const filename=await safePath(root,photo.relative_path);
        try {
          // Sharp/libvips is faster and preserves orientation for common photo formats.
          await sharp(filename,options).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toFile(temp);
        } catch(primaryError) {
          // FFmpeg covers many professional/legacy formats that the bundled libvips may omit.
          await rm(temp,{force:true}).catch(()=>{});
          try {
            await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-protocol_whitelist','file,pipe','-i',filename,'-frames:v','1','-vf',"scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease",'-c:v','libwebp','-threads','1','-f','image2',temp],60000);
          } catch(fallbackError) {
            throw new Error(`Unsupported image or codec: ${primaryError.message}; ${fallbackError.message}`);
          }
        }
      }
      await rename(temp,preview);
      await sharp(preview).resize({width:480,height:720,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toFile(`${cacheFile(config,photo,'thumb')}.tmp`);
      await rename(`${cacheFile(config,photo,'thumb')}.tmp`,cacheFile(config,photo,'thumb'));
      const meta = await sharp(preview).metadata();
      db.run("UPDATE photos SET status='ready',error=NULL,width=?,height=? WHERE id=? AND version=?",meta.width,meta.height,photo.id,photo.version);
    } finally { await source.close().catch(()=>{}); await rm(temp,{force:true}).catch(()=>{}); }
  }
  async function work() {
    await mkdir(config.cacheDir,{recursive:true});
    if(!cacheCleaned){await cleanCache();cacheCleaned=true;}
    const job = db.get("SELECT j.* FROM jobs j JOIN photos p ON p.id=j.photo_id WHERE j.status='pending' AND j.attempts<3 AND p.missing=0 AND j.version=p.version ORDER BY j.rowid LIMIT 1");
    if (!job) return;
    db.run("UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=?",job.id);
    try {
      await render(db.get('SELECT * FROM photos WHERE id=?',job.photo_id));
      db.run("UPDATE jobs SET status='completed',error=NULL WHERE id=?",job.id);
    } catch(e) {
      logger.warn({photo:job.photo_id,error:e.message},'Preview failed');
      db.run("UPDATE jobs SET status=CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END,error=? WHERE id=?",e.message,job.id);
      db.run("UPDATE photos SET status='failed',error=? WHERE id=? AND version=?",e.message,job.photo_id,job.version);
    }
  }
  return {
    tick() { if(!running) running=work().finally(()=>{running=null;}); return running; },
    async drain() { while(db.get("SELECT 1 FROM jobs j JOIN photos p ON p.id=j.photo_id WHERE j.status='pending' AND j.attempts<3 AND p.missing=0 AND j.version=p.version")) await this.tick(); },
    async stop() { await running; }
  };
}
