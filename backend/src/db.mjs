import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL UNIQUE,
    cron TEXT NOT NULL DEFAULT '0 3 * * *', timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    next_scan TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    relative_path TEXT NOT NULL, name TEXT NOT NULL, seen TEXT, missing INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id,relative_path), UNIQUE(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), folder_id TEXT NOT NULL,
    relative_path TEXT NOT NULL, filename TEXT NOT NULL, stem TEXT NOT NULL, extension TEXT NOT NULL,
    bytes INTEGER NOT NULL, mtime REAL NOT NULL, version TEXT NOT NULL, width INTEGER, height INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', error TEXT, seen TEXT, missing INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id,relative_path), UNIQUE(project_id,id),
    FOREIGN KEY(project_id,folder_id) REFERENCES folders(project_id,id)
  );
  CREATE INDEX IF NOT EXISTS photos_folder ON photos(project_id,folder_id,missing,id);
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE, password_hash TEXT, scope TEXT NOT NULL DEFAULT 'all',
    downloads INTEGER NOT NULL DEFAULT 1, originals INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS link_folders (
    project_id TEXT NOT NULL, link_id TEXT NOT NULL, folder_id TEXT NOT NULL,
    PRIMARY KEY(link_id,folder_id), FOREIGN KEY(project_id,link_id) REFERENCES links(project_id,id),
    FOREIGN KEY(project_id,folder_id) REFERENCES folders(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
    link_id TEXT REFERENCES links(id), name TEXT NOT NULL, expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS selection_lists (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT NOT NULL REFERENCES sessions(id),
    name TEXT NOT NULL, submitted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id,name), UNIQUE(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS client_selections (
    project_id TEXT NOT NULL, list_id TEXT NOT NULL, photo_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(list_id,photo_id),
    FOREIGN KEY(project_id,list_id) REFERENCES selection_lists(project_id,id),
    FOREIGN KEY(project_id,photo_id) REFERENCES photos(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, photo_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id), x REAL NOT NULL CHECK(x BETWEEN 0 AND 1),
    y REAL NOT NULL CHECK(y BETWEEN 0 AND 1), body TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id,photo_id) REFERENCES photos(project_id,id)
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT REFERENCES sessions(id),
    sender_role TEXT NOT NULL CHECK(sender_role IN ('client','admin')), sender_name TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS chat_messages_project ON chat_messages(project_id,created_at);
  CREATE TABLE IF NOT EXISTS scan_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), status TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id), version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
    UNIQUE(photo_id,version)
  );
  CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(status,attempts);
  CREATE TABLE IF NOT EXISTS download_tickets (
    hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), manifest TEXT NOT NULL,
    expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
  );
  PRAGMA user_version=1;`);
  const projectColumns=db.prepare('PRAGMA table_info(projects)').all().map(column=>column.name);
  if(!projectColumns.includes('editor'))db.exec("ALTER TABLE projects ADD COLUMN editor TEXT NOT NULL DEFAULT ''");
  if(!projectColumns.includes('internal_note'))db.exec("ALTER TABLE projects ADD COLUMN internal_note TEXT NOT NULL DEFAULT ''");
  // One project represents one customer's album. Merge legacy lists that were
  // accidentally created once per login session, preserving every selection.
  const duplicates=db.prepare(`SELECT project_id,name,group_concat(id) AS ids,max(submitted_at) AS submitted_at,count(*) AS n
    FROM selection_lists GROUP BY project_id,name HAVING count(*)>1`).all();
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const group of duplicates){
      const ids=group.ids.split(','),keep=ids.shift();
      for(const duplicate of ids){
        db.prepare('INSERT OR IGNORE INTO client_selections(project_id,list_id,photo_id,created_at) SELECT project_id,?,photo_id,created_at FROM client_selections WHERE list_id=?').run(keep,duplicate);
        db.prepare('DELETE FROM client_selections WHERE list_id=?').run(duplicate);
        db.prepare('DELETE FROM selection_lists WHERE id=?').run(duplicate);
      }
      if(group.submitted_at)db.prepare('UPDATE selection_lists SET submitted_at=? WHERE id=?').run(group.submitted_at,keep);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS selection_lists_project_name ON selection_lists(project_id,name);COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}
  return {
    raw: db,
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => db.prepare(sql).run(...args),
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close: () => db.close()
  };
}
