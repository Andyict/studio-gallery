import {photoPath} from './shares.mjs';
import { readdir, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { id, digest, safePath, cleanRelative, fail } from './security.mjs';

import {extensions} from './media.mjs';
import {isFinalPath} from './workflow.mjs';
import {pairProject} from './pairing.mjs';
const excluded = new Set(['@eaDir','#recycle','.snapshot']);
export function nextScan(cron, timezone) {
  if (!cron) return null;
  try { return CronExpressionParser.parse(cron, { tz: timezone }).next().toISOString(); }
  catch { fail(400, 'Lịch cron hoặc múi giờ không hợp lệ'); }
}
export function createScanner(db, config, logger) {
  let stopped = false;
  const active = new Map();
  let batchRunning = false;
  db.run("UPDATE scan_runs SET status='failed',error='Server restarted during scan',finished_at=? WHERE status='running'", new Date().toISOString());
  async function scan(project) {
    const scanID = id();
    db.run("INSERT INTO scan_runs(id,project_id,status) VALUES(?,?,'running')", scanID, project.id);
    let count = 0;
    // Albums may be rescanned every few minutes, so unchanged rows are not rewritten: paths seen in
    // this pass are collected in memory and everything else is tombstoned at the end.
    const seenPhotos = new Set(), seenFolders = new Set();
    const knownPhotos = new Map(db.all('SELECT id,relative_path,version,missing,folder_id FROM photos WHERE project_id=?', project.id).map(p => [p.relative_path, p]));
    const knownFolders = new Map(db.all('SELECT id,relative_path,missing FROM folders WHERE project_id=?', project.id).map(f => [f.relative_path, f]));
    try {
      const root = await photoPath(config.photoRoot, project.root);
      if (!(await stat(root)).isDirectory()) fail(400, 'Nguồn ảnh không phải thư mục');
      async function walk(relative) {
        if (stopped) throw new Error('Server stopping');
        const directory = await safePath(root, relative);
        const knownFolder = knownFolders.get(relative), folderID = knownFolder?.id || id();
        seenFolders.add(relative);
        if (!knownFolder || knownFolder.missing) db.run(`INSERT INTO folders(id,project_id,relative_path,name,seen,is_final) VALUES(?,?,?,?,?,?)
          ON CONFLICT(project_id,relative_path) DO UPDATE SET seen=excluded.seen,missing=0,is_final=excluded.is_final`, folderID, project.id, relative, relative ? path.posix.basename(relative) : 'Ảnh chung', scanID, +isFinalPath(config, relative));
        const entries = await readdir(directory, { withFileTypes:true });
        for (const entry of entries) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || excluded.has(entry.name)) continue;
          const rel = relative ? `${relative}/${entry.name}` : entry.name;
          cleanRelative(rel);
          if (entry.isDirectory()) { await walk(rel); continue; }
          const ext = path.extname(entry.name).toLowerCase();
          if (!entry.isFile() || !extensions.has(ext)) continue;
          // `directory` is already resolved inside the root and the entry is not a symlink; lstat never
          // follows one even if it was swapped in after readdir. Files are only ever opened via safeOpen.
          const info = await lstat(path.join(directory, entry.name));
          if (!info.isFile()) continue;
          const version = digest(`${info.size}:${info.mtimeMs}`).slice(0,24);
          const old = knownPhotos.get(rel);
          const photoID = old?.id || id();
          seenPhotos.add(rel);
          count++;
          if (old && old.version === version && !old.missing && old.folder_id === folderID) continue;
          db.transaction(() => {
            db.run(`INSERT INTO photos(id,project_id,folder_id,relative_path,filename,stem,extension,bytes,mtime,version,seen)
              VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,relative_path) DO UPDATE SET
              folder_id=excluded.folder_id,bytes=excluded.bytes,mtime=excluded.mtime,version=excluded.version,seen=excluded.seen,missing=0,
              status=CASE WHEN photos.version<>excluded.version THEN 'pending' ELSE photos.status END,
              error=CASE WHEN photos.version<>excluded.version THEN NULL ELSE photos.error END`,
              photoID, project.id, folderID, rel, entry.name, path.parse(entry.name).name, ext, info.size, info.mtimeMs, version, scanID);
            db.run('INSERT OR IGNORE INTO jobs(id,photo_id,version) VALUES(?,?,?)', id(), photoID, version);
          });
          if (count % 50 === 0) { db.run('UPDATE scan_runs SET count=? WHERE id=?',count,scanID); await new Promise(r => setImmediate(r)); }
        }
      }
      await walk('');
      // Do not tombstone unseen rows unless every directory was read successfully.
      await stat(root);
      db.transaction(() => {
        for (const [rel, p] of knownPhotos) if (!seenPhotos.has(rel) && !p.missing) db.run('UPDATE photos SET missing=1 WHERE id=?', p.id);
        for (const [rel, f] of knownFolders) if (!seenFolders.has(rel) && !f.missing) db.run('UPDATE folders SET missing=1 WHERE id=?', f.id);
        db.run("UPDATE scan_runs SET status='completed',count=?,finished_at=? WHERE id=?",count,new Date().toISOString(),scanID);
      });
      pairProject(db, config, project.id);
    } catch(e) {
      logger.error({ err:e, project:project.id }, 'Scan failed');
      db.run("UPDATE scan_runs SET status='failed',count=?,error=?,finished_at=? WHERE id=?",count,e.message,new Date().toISOString(),scanID);
    }
  }
  return {
    start(project) {
      if (active.has(project.id)) return false;
      const work = scan(project).finally(() => active.delete(project.id));
      active.set(project.id,work); return true;
    },
    async stop() { stopped=true; await Promise.all(active.values()); },
    async wait() { await Promise.all(active.values()); },
    batch(projects) {
      if (batchRunning) return false;
      batchRunning = true;
      void (async () => {
        try {
          for (const project of projects) {
            if (stopped) break;
            this.start(project);
            await active.get(project.id);
          }
        } finally { batchRunning = false; }
      })();
      return true;
    },
    tick() {
      for (const p of db.all('SELECT * FROM projects WHERE next_scan IS NOT NULL AND next_scan<=? AND archived_at IS NULL',new Date().toISOString())) {
        if (active.size >= 1) break;
        this.start(p); db.run('UPDATE projects SET next_scan=? WHERE id=?',p.scan_interval_seconds?new Date(Date.now()+p.scan_interval_seconds*1000).toISOString():nextScan(p.cron,p.timezone),p.id);
      }
    }
  };
}
