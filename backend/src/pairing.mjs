import { rawExtensions } from './media.mjs';

// RAW + JPG shot together (IMG_001.CR2 + IMG_001.JPG in one folder) are one photo for the customer:
// the RAW row gets paired_with = the viewable sibling and is hidden from every listing and count,
// skipped by the thumbnail worker, and added back as an extra file when originals are downloaded.
const VIEWABLE = ['.jpg','.jpeg','.jfif','.jpe','.heic','.heif','.tif','.tiff','.png','.webp','.avif'];

export function initializePairing(db) {
  if(!db.all('PRAGMA table_info(photos)').some(c=>c.name==='paired_with'))db.raw.exec('ALTER TABLE photos ADD COLUMN paired_with TEXT');
  db.raw.exec('CREATE INDEX IF NOT EXISTS photos_paired ON photos(paired_with)');
}

export function pairProject(db, config, projectID) {
  const raws = [...rawExtensions].map(() => '?').join(','), views = VIEWABLE.map(() => '?').join(',');
  db.transaction(() => {
    db.run('UPDATE photos SET paired_with=NULL WHERE project_id=? AND paired_with IS NOT NULL', projectID);
    if (config.pairRawJpg === false) return;
    db.run(`UPDATE photos AS r SET paired_with=(
        SELECT v.id FROM photos v WHERE v.project_id=r.project_id AND v.folder_id=r.folder_id AND v.missing=0
          AND lower(v.stem)=lower(r.stem) AND v.extension IN (${views}) ORDER BY v.extension LIMIT 1)
      WHERE r.project_id=? AND r.missing=0 AND r.extension IN (${raws})`, ...VIEWABLE, projectID, ...rawExtensions);
    // What the customer did on a RAW before its JPG arrived carries over to the JPG they now see.
    for (const r of db.all('SELECT id,paired_with,edit_pick FROM photos WHERE project_id=? AND paired_with IS NOT NULL', projectID)) {
      if (r.edit_pick) { db.run('UPDATE photos SET edit_pick=1 WHERE id=?', r.paired_with); db.run('UPDATE photos SET edit_pick=0 WHERE id=?', r.id); }
      db.run('INSERT OR IGNORE INTO client_selections(project_id,list_id,photo_id,created_at) SELECT project_id,list_id,?,created_at FROM client_selections WHERE photo_id=?', r.paired_with, r.id);
      db.run('DELETE FROM client_selections WHERE photo_id=?', r.id);
      db.run('UPDATE messages SET photo_id=? WHERE photo_id=?', r.paired_with, r.id);
    }
  });
}

export const pairAll = (db, config) => { for (const { id } of db.all('SELECT id FROM projects')) pairProject(db, config, id); };
