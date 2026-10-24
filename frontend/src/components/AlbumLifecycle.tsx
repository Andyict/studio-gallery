"use client";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowDownToLine, Trash2 } from "lucide-react";
import { api, json } from "@/lib/api";

// Recent customer downloads for an album (shown on its overview).
export function DownloadLog({ projectId, revision }: { projectId: string; revision: number }) {
  const [rows, setRows] = useState<{ client: string; original: number; files: number; created_at: string }[]>([]);
  useEffect(() => { api(`/admin/projects/${projectId}/downloads`).then(setRows).catch(() => {}); }, [projectId, revision]);
  if (!rows.length) return null;
  return <section className="album-work-card download-log">
    <span className="tiny-label"><ArrowDownToLine size={13} /> KHÁCH ĐÃ TẢI</span>
    <ul>{rows.slice(0, 8).map((r, i) => <li key={i}><strong>{r.client}</strong> · {r.files} {r.original ? "file gốc" : "ảnh xem"}<small>{new Date(r.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</small></li>)}</ul>
  </section>;
}

// Archive / restore and permanent deletion (album settings tab). Deleting needs an archived album
// and the exact album name; photo files on the NAS are never touched.
export function AlbumLifecycle({ project, isAdmin, canManage, onChanged, onDeleted }: {
  project: { id: string; name: string; archived_at: string | null }; isAdmin: boolean; canManage: boolean;
  onChanged: (message: string) => Promise<void>; onDeleted: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!canManage) return null;
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const archived = !!project.archived_at;
  return <section className="panel danger-zone">
    <h2>Lưu trữ & xoá album</h2>
    {archived
      ? <p className="small">Album đã lưu trữ từ {new Date(project.archived_at!).toLocaleDateString("vi-VN")}: khách không mở được, album không được quét. Khôi phục để mở lại như cũ.</p>
      : <p className="small">Lưu trữ khi đã giao xong: khách không còn mở được album (cả link và tài khoản), album ngừng quét; mọi dữ liệu được giữ.</p>}
    <button disabled={busy} onClick={() => void run(async () => {
      await api(`/admin/projects/${project.id}/archive`, json("POST", { archived: !archived }));
      await onChanged(archived ? "Đã khôi phục album" : "Đã lưu trữ album");
    })}>{archived ? <><ArchiveRestore size={16} />Khôi phục album</> : <><Archive size={16} />Lưu trữ album</>}</button>
    {archived && isAdmin && <div className="danger-delete">
      <p className="small"><strong>Xoá vĩnh viễn</strong> danh sách chọn, tin nhắn, link và cache của album này. File ảnh trên NAS không bị xoá; album không tự tạo lại khi quét nguồn. Nhập <strong>{project.name}</strong> để xác nhận.</p>
      <input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={project.name} aria-label="Nhập tên album để xác nhận xoá" />
      <button className="danger" disabled={busy || confirm.trim() !== project.name} onClick={() => void run(async () => {
        await api(`/admin/projects/${project.id}`, json("DELETE", { confirm }));
        await onDeleted();
      })}><Trash2 size={16} />Xoá album khỏi Studio Gallery</button>
    </div>}
    {error && <p role="alert" className="alert">{error}</p>}
  </section>;
}
