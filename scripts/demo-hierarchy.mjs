import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "../backend/src/db.mjs";
import { createScanner } from "../backend/src/scanner.mjs";
import { digest, id } from "../backend/src/security.mjs";

const photoRoot = path.resolve(".runtime/photos");
const database = path.resolve(".runtime/data/gallery.sqlite");
const seedRoot = path.join(photoRoot, "Demo_Wedding");
const seedFiles = [];
for (const folder of await readdir(seedRoot, { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;
  for (const file of await readdir(path.join(seedRoot, folder.name))) {
    if (/\.jpe?g$/i.test(file)) seedFiles.push(path.join(seedRoot, folder.name, file));
  }
}
if (!seedFiles.length) throw new Error("Hãy chạy npm run demo trước để tạo ảnh mẫu");

const albums = [
  ["Studio/Ảnh cưới/2026-09-20_Đám cưới An & Minh", ["01_Lễ gia tiên", "02_Tiệc nhà hàng"], true],
  ["Studio/Ảnh cưới/2026-08-12_Đám cưới Lan & Huy", ["01_Pre-wedding", "02_Ngày cưới"], true],
  ["Studio/Ảnh cưới/2026-05-02_Đám cưới Hà & Nam", ["Ảnh chung"], false],
  ["Studio/Du lịch/2026-07-15_Hạ Long", ["Ngày 1", "Ngày 2"], true],
  ["Studio/Du lịch/2026-06-03_Quảng Ninh", ["Biển", "Thành phố"], false],
  ["Studio/Gia đình/2026-09-05_Sinh nhật bé Mây", ["Trang trí", "Gia đình"], true],
];

let imageIndex = 0;
for (const [root, folders] of albums) {
  for (const folder of folders) {
    const target = path.join(photoRoot, ...root.split("/"), folder);
    await mkdir(target, { recursive: true });
    for (let n = 0; n < 3; n++) {
      const source = seedFiles[imageIndex++ % seedFiles.length];
      await copyFile(source, path.join(target, `IMG_${String(imageIndex).padStart(4, "0")}.jpg`));
    }
  }
}

const db = openDatabase(database);
db.run(
  "INSERT OR IGNORE INTO approved_sources(id,relative_path,label,enabled) VALUES(?,?,?,1)",
  id(),
  "Studio",
  "Studio Demo",
);
for (const [root, , shared] of albums) {
  let project = db.get("SELECT * FROM projects WHERE root=?", root);
  if (!project) {
    const projectID = id();
    const rawName = root.split("/").at(-1);
    const name = rawName.replace(/^\d{4}-\d{2}-\d{2}[._ -]*/, "").replaceAll("_", " ");
    db.run(
      "INSERT INTO projects(id,name,root,cron,timezone) VALUES(?,?,?,?,?)",
      projectID,
      name,
      root,
      "",
      "Asia/Ho_Chi_Minh",
    );
    project = db.get("SELECT * FROM projects WHERE id=?", projectID);
  }
  if (shared && !db.get("SELECT id FROM links WHERE project_id=? AND revoked=0", project.id)) {
    db.run(
      "INSERT INTO links(id,project_id,label,token_hash,scope,downloads,originals) VALUES(?,?,?,?,?,?,?)",
      id(),
      project.id,
      "Khách demo",
      digest(`demo-${project.id}`),
      "all",
      1,
      0,
    );
  }
}

const scanner = createScanner(db, { photoRoot }, { error: console.error });
for (const [root] of albums) {
  scanner.start(db.get("SELECT * FROM projects WHERE root=?", root));
  await scanner.wait();
}
db.close();
console.log(`Đã tạo ${albums.length} album nhiều tầng trong Studio.`);
