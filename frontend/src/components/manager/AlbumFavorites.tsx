"use client";
import { useEffect, useState } from "react";
import { CheckCheck, Copy, Download, Heart } from "lucide-react";
import { api, copy, json } from "@/lib/api";
import { isVideo } from "@/lib/media";
import { Modal } from "../Gallery";
import { timeVN, useManager, useStoredView, ViewSwitch, type Project } from "./context";
import type { Detail } from "./AlbumView";
import { PhotoThumb } from "./PhotoLightbox";

// The customer's favourite lists: which photos they hearted, their notes per photo (resolve one or
// all), and exports for the editor (file names for Lightroom, CSV of picks, CSV of notes).
export default function AlbumFavorites({ project, detail, reload, onOpen }: {
  project: Project; detail: Detail; reload: () => Promise<void>; onOpen: (photos: any[], index: number) => void;
}) {
  const { notify, fail, confirm } = useManager();
  const { lists, comments } = detail;
  const [listId, setListId] = useState(lists[0]?.id || "");
  const [photos, setPhotos] = useState<any[] | null>(null);
  const [view, setView] = useStoredView("favorites");
  const [exportText, setExportText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = lists.find((l) => l.id === listId) || lists[0];
  useEffect(() => {
    if (!list) { setPhotos([]); return; }
    const controller = new AbortController();
    api(`/admin/lists/${list.id}/photos`, { signal: controller.signal }).then(setPhotos).catch((e) => { if (!controller.signal.aborted) fail((e as Error).message); });
    return () => controller.abort();
  }, [list?.id, list?.count, fail]);
  const notesFor = (id: string) => comments.filter((c) => c.photo_id === id);
  const open = comments.filter((c) => !c.resolved);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { fail((e as Error).message); } finally { setBusy(false); }
  }
  async function resolveAll() {
    if (!(await confirm({ title: "Đánh dấu đã xử lý", body: <p>Đánh dấu {open.length} ghi chú của khách là đã xử lý. Bạn vẫn mở lại từng ghi chú được.</p>, confirm: "Đã xử lý hết" }))) return;
    await run(async () => {
      const results = await Promise.allSettled(open.map((c) => api(`/admin/messages/${c.id}`, json("PATCH", { resolved: true }))));
      await reload();
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) fail(`${failed} ghi chú chưa cập nhật được`); else notify(`Đã xử lý ${open.length} ghi chú`);
    });
  }
  return (
    <section className="panel favorite-explorer favorite-single">
      <div className="favorite-main">
        <div className="favorite-toolbar">
          <div className="grow">
            <strong>Ảnh khách yêu thích</strong>
            <small>{list ? <>{list.client || list.name} · {photos?.length ?? list.count} ảnh · {list.submitted_at ? `đã gửi ${timeVN(list.submitted_at)}` : "đang chọn"}{list.missing_count ? ` · ${list.missing_count} ảnh mất nguồn` : ""}</> : "Khách chưa thả tim ảnh nào"}</small>
          </div>
          {lists.length > 1 && (
            <select aria-label="Danh sách yêu thích" value={list?.id} onChange={(e) => setListId(e.target.value)}>
              {lists.map((l) => <option value={l.id} key={l.id}>{l.client || l.name} ({l.count}){l.submitted_at ? " · đã gửi" : ""}</option>)}
            </select>
          )}
          {list && <>
            <button disabled={busy} onClick={() => void run(async () => { const d = await api(`/admin/lists/${list.id}/export`); setExportText(d.search_string || "(Chưa có ảnh)"); })}><Copy size={15} />Tên file</button>
            <a className="button" href={`/api/admin/lists/${list.id}/export?format=csv`}><Download size={15} />CSV ảnh chọn</a>
          </>}
          {comments.length > 0 && <a className="button" href={`/api/admin/projects/${project.id}/comments?format=csv`}><Download size={15} />CSV ghi chú</a>}
          {open.length > 0 && <button disabled={busy} onClick={() => void resolveAll()}><CheckCheck size={15} />Xử lý hết ({open.length})</button>}
          <ViewSwitch value={view} onChange={setView} label="Kiểu xem ảnh yêu thích" />
        </div>
        {photos?.length ? (
          <div className={`favorite-files ${view}`}>
            {photos.map((photo, i) => {
              const notes = notesFor(photo.id), waiting = notes.filter((n) => !n.resolved).length;
              return (
                <button type="button" className="favorite-file" key={photo.id} onClick={() => onOpen(photos, i)} aria-label={`Xem ${photo.filename}`}>
                  <PhotoThumb photo={photo} />
                  <div>
                    <strong>{isVideo(photo) && <span className="media-badge">▶ VIDEO </span>}{photo.filename}</strong>
                    <small>{photo.missing ? "Mất nguồn" : notes.length ? `${waiting ? `${waiting} ghi chú chờ xử lý` : "Ghi chú đã xử lý hết"}` : "Không có ghi chú"}</small>
                    {notes[0] && <small className="favorite-note-summary">“{notes[0].body.slice(0, 90)}{notes[0].body.length > 90 ? "…" : ""}”</small>}
                  </div>
                  <span className="favorite-detail-notes">{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—"}</span>
                </button>
              );
            })}
          </div>
        ) : photos && (
          <div className="empty"><Heart size={38} /><h3>Chưa có ảnh yêu thích</h3><p>Ảnh khách thả tim sẽ xuất hiện tại đây.</p></div>
        )}
      </div>
      {!!exportText && (
        <Modal title="Tên file cho editor" close={() => setExportText("")}>
          <p className="muted small">Dán vào ô tìm kiếm của Lightroom / Bridge để lọc đúng các ảnh khách chọn.</p>
          <textarea readOnly value={exportText} rows={6} />
          <button className="primary" onClick={() => void copy(exportText).then(() => notify("Đã sao chép")).catch((e) => fail(e.message))}><Copy size={16} />Sao chép</button>
        </Modal>
      )}
    </section>
  );
}
