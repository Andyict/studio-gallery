import sharp from 'sharp';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat, readFile } from 'node:fs/promises';
import { photoPath } from './shares.mjs';
import { safePath, safeOpen } from './security.mjs';
import { rawExtensions, isVideo, runMedia } from './media.mjs';

sharp.cache({ memory:64, files:0, items:50 });
sharp.concurrency(1);

export const cacheFile = (config, photo, variant='preview') => path.join(config.cacheDir,`${photo.id}-${photo.version}-${variant}.${variant==='video'?'mp4':'webp'}`);
const INPUT = { limitInputPixels:120_000_000, failOn:'error', sequentialRead:true };
const THUMB = { width:480, height:720, fit:'inside', withoutEnlargement:true };
const PREVIEW = { width:2048, height:2048, fit:'inside', withoutEnlargement:true };

// Synology Photos keeps ready-made, correctly oriented JPEG thumbnails next to indexed files:
// <dir>/@eaDir/<file>/SYNOPHOTO_THUMB_XL.jpg (about 1280 px). Using it is far cheaper than decoding
// a 50 MP JPEG or a RAW file, and it covers RAW/HEIC formats the bundled decoders may not.
// A thumbnail older than the source is stale (the file was replaced) and is ignored.
export async function synologyThumb(root, relative, sourceMtimeMs) {
  const dir = path.posix.dirname(relative), name = path.posix.basename(relative);
  for (const size of ['XL','B','M']) {
    const candidate = `${dir === '.' ? '' : `${dir}/`}@eaDir/${name}/SYNOPHOTO_THUMB_${size}.jpg`;
    let handle;
    try {
      handle = await safeOpen(root, candidate);
      const info = await handle.stat();
      if (info.mtimeMs + 1000 < sourceMtimeMs || info.size > 20 * 1024 * 1024) continue;
      return await handle.readFile();
    } catch { /* not indexed */ } finally { await handle?.close().catch(()=>{}); }
  }
  return null;
}

// The camera's embedded JPEG from a RAW file. The source is never modified and no metadata is kept.
export async function rawEmbedded(exiftool, filename) {
  for (const tag of ['JpgFromRaw','PreviewImage']) {
    const chunks = [];
    const ok = await new Promise(resolve => {
      const proc = spawn(exiftool, ['-b',`-${tag}`,filename], { windowsHide:true, stdio:['ignore','pipe','ignore'] });
      const timer = setTimeout(() => proc.kill(), 60_000);
      proc.stdout.on('data', c => chunks.push(c));
      proc.on('error', () => { clearTimeout(timer); resolve(false); });
      proc.on('close', code => { clearTimeout(timer); resolve(code === 0); });
    });
    const data = Buffer.concat(chunks);
    if (ok && data.length > 1024) return data;
  }
  throw new Error('RAW has no readable embedded JPEG. Provide matching JPG or install a compatible RAW renderer.');
}

// Writes `target` atomically from a sharp pipeline, falling back to FFmpeg for formats libvips lacks.
async function encode(config, input, target, box, quality) {
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    try { await sharp(input, INPUT).rotate().resize(box).webp({ quality }).toFile(temp); }
    catch (primary) {
      if (typeof input !== 'string') throw primary;
      await rm(temp, { force:true }).catch(()=>{});
      try {
        await runMedia(config.ffmpeg,['-nostdin','-y','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-frames:v','1','-vf',
          `scale=w='min(${box.width},iw)':h='min(${box.height},ih)':force_original_aspect_ratio=decrease`,'-c:v','libwebp','-threads','1','-f','image2',temp],60000);
      } catch (fallback) { throw new Error(`Unsupported image or codec: ${primary.message}; ${fallback.message}`); }
    }
    await rename(temp, target);
  } finally { await rm(temp, { force:true }).catch(()=>{}); }
}

// Studio logo stamped on 2048 px previews (and preview ZIPs). Thumbnails, originals and videos are
// never watermarked. Logo-based so no fonts are needed on the NAS.
async function stamp(config, file, quality) {
  const image = sharp(await readFile(file));
  const { width = 0, height = 0 } = await image.metadata();
  const mode = config.watermark, opacity = Math.min(0.9, Math.max(0.05, (config.watermarkOpacity || 25) / 100));
  const share = { center:0.42, corner:0.18, tile:0.2 }[mode] || 0.2;
  const size = Math.max(24, Math.round(Math.min(width, height) * share));
  let logo = await sharp(config.logoPath).resize({ width:size, height:size, fit:'inside' }).ensureAlpha().linear([1,1,1,opacity],[0,0,0,0]).png().toBuffer();
  const clear = { r:0, g:0, b:0, alpha:0 };
  if (mode === 'corner') { const m = Math.round(size * 0.18); logo = await sharp(logo).extend({ right:m, bottom:m, background:clear }).png().toBuffer(); }
  if (mode === 'tile') { const m = Math.round(size * 0.6); logo = await sharp(logo).extend({ top:m, bottom:m, left:m, right:m, background:clear }).png().toBuffer(); }
  const temp = `${file}.wm.tmp`;
  await image.composite([mode === 'tile' ? { input:logo, tile:true } : { input:logo, gravity: mode === 'corner' ? 'southeast' : 'centre' }]).webp({ quality }).toFile(temp);
  await rename(temp, file);
}

export function createPreviews(db, config, logger) {
  db.raw.exec(`CREATE TABLE IF NOT EXISTS preview_cache (
    file TEXT PRIMARY KEY, photo_id TEXT NOT NULL, bytes INTEGER NOT NULL, last_access INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS preview_cache_access ON preview_cache(last_access);
    CREATE TABLE IF NOT EXISTS preview_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const watermarking = () => config.watermark && config.watermark !== 'off' && !!config.logoPath;
  const inflight = new Map(), waiters = [];
  let active = 0;
  const MAX_ACTIVE = 2;
  async function slot(fn) {
    if (active >= MAX_ACTIVE) await new Promise(r => waiters.push(r)); else active++;
    try { return await fn(); } finally { const next = waiters.shift(); if (next) next(); else active--; }
  }
  async function source(photo) {
    const project = db.get('SELECT root FROM projects WHERE id=?', photo.project_id);
    const root = await photoPath(config.photoRoot, project.root);
    const handle = await safeOpen(root, photo.relative_path);
    try {
      const info = await handle.stat();
      if (info.size !== photo.bytes || info.mtimeMs !== photo.mtime) throw new Error('Source changed; run sync again');
    } finally { await handle.close(); }
    return { root, filename: await safePath(root, photo.relative_path) };
  }
  // Input for an image decode: the RAW's embedded JPEG or the file itself.
  async function imageInput(photo, filename) {
    return rawExtensions.has(photo.extension) ? rawEmbedded(config.exiftool, filename) : filename;
  }

  const limitBytes = () => Math.max(0, Number(config.previewCacheMB || 0)) * 1024 * 1024;
  function evict(keep) {
    const limit = limitBytes();
    if (!limit) return;
    let total = db.get('SELECT COALESCE(sum(bytes),0) AS n FROM preview_cache').n;
    if (total <= limit) return;
    // Least recently viewed first, down to 90% so eviction does not run on every new preview.
    for (const row of db.all('SELECT * FROM preview_cache ORDER BY last_access')) {
      if (total <= limit * 0.9) break;
      if (row.file === keep) continue; // the preview being served right now always survives
      db.run('DELETE FROM preview_cache WHERE file=?', row.file);
      void rm(path.join(config.cacheDir, row.file), { force:true }).catch(()=>{});
      total -= row.bytes;
    }
  }
  function touch(file) {
    const now = Date.now();
    db.run('UPDATE preview_cache SET last_access=? WHERE file=? AND last_access<?', now, file, now - 10 * 60_000);
  }

  return {
    // Thumbnail + dimensions for a still image (background job). Prefers Synology's own thumbnail.
    async thumbnail(photo) {
      const { root, filename } = await source(photo);
      const target = cacheFile(config, photo, 'thumb');
      let width = null, height = null;
      if (!rawExtensions.has(photo.extension)) {
        try { const m = await sharp(filename, { limitInputPixels:false }).metadata(); [width, height] = (m.orientation || 1) >= 5 ? [m.height, m.width] : [m.width, m.height]; } catch { /* decoded below */ }
      }
      const syno = await synologyThumb(root, photo.relative_path, photo.mtime);
      const input = syno || await imageInput(photo, filename);
      await encode(config, input, target, THUMB, 78);
      if (!width || !height) { const m = await sharp(target).metadata(); width = m.width; height = m.height; }
      return { width, height, synology: !!syno };
    },
    // The 2048 px preview, created on first view and kept within the cache limit.
    async ensure(photo) {
      if (isVideo(photo)) return cacheFile(config, photo, 'preview');
      const target = cacheFile(config, photo, 'preview'), file = path.basename(target);
      try { await stat(target); touch(file); return target; } catch { /* render below */ }
      if (!inflight.has(file)) {
        inflight.set(file, slot(async () => {
          const { filename } = await source(photo);
          // Render and stamp off to the side; only a finished (watermarked) file is moved into place.
          const staging = `${target}.staging`;
          try {
            await encode(config, await imageInput(photo, filename), staging, PREVIEW, 85);
            if (watermarking()) await stamp(config, staging, 85);
            await rename(staging, target);
          } finally { await rm(staging, { force:true }).catch(()=>{}); }
          const { size } = await stat(target);
          db.run('INSERT OR REPLACE INTO preview_cache(file,photo_id,bytes,last_access) VALUES(?,?,?,?)', file, photo.id, size, Date.now());
          evict(file);
          return target;
        }).finally(() => inflight.delete(file)));
      }
      return inflight.get(file);
    },
    async read(photo) { return readFile(await this.ensure(photo)); },
    // Rows for files that no longer exist (deleted by cleanup or by hand) are dropped.
    adopt(file, photoID, bytes, lastAccess) { db.run('INSERT OR IGNORE INTO preview_cache(file,photo_id,bytes,last_access) VALUES(?,?,?,?)', file, photoID, bytes, Math.floor(lastAccess)); },
    forget(files) { for (const file of files) db.run('DELETE FROM preview_cache WHERE file=?', file); },
    // Previews must match the current watermark: when its mode, opacity or the logo changes, the
    // cached previews are dropped and re-rendered on next view.
    async syncWatermark() {
      const signature = watermarking() ? `${config.watermark}:${config.watermarkOpacity}:${createHash('md5').update(await readFile(config.logoPath)).digest('hex')}` : 'off';
      const stored = db.get("SELECT value FROM preview_meta WHERE key='watermark'")?.value;
      if (stored === signature) return false;
      for (const { file } of db.all('SELECT file FROM preview_cache')) await rm(path.join(config.cacheDir, file), { force:true }).catch(()=>{});
      db.run('DELETE FROM preview_cache');
      db.run("INSERT INTO preview_meta(key,value) VALUES('watermark',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", signature);
      return stored !== undefined;
    },
    stats() { return db.get('SELECT count(*) AS files,COALESCE(sum(bytes),0) AS bytes FROM preview_cache'); },
    evict
  };
}
