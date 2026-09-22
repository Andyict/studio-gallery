import {DatabaseSync,backup} from 'node:sqlite';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
const data=process.env.DATA_DIR||'./.runtime/data';
await mkdir(path.join(data,'backups'),{recursive:true});
const destination=path.join(data,'backups',`gallery-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db=new DatabaseSync(path.join(data,'gallery.sqlite'),{readOnly:true});
await backup(db,destination);db.close();console.log(destination);
