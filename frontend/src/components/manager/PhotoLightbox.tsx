"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Heart, Image as ImageIcon, ImageOff, MessageCircle, RotateCcw, X } from "lucide-react";
import { api, json } from "@/lib/api";
import { isVideo } from "@/lib/media";
import { messageTime, type Message } from "@/lib/messages";
import { useManager } from "./context";

export type LightboxPhoto = { id: string; filename: string; extension?: string; status: string; width?: number; height?: number; relative_path?: string; missing?: number; favorite_count?: number; edit_pick?: number | boolean; edit_done?: number | boolean };

// Thumbnail with honest states: ready, still processing, or failed (with the reason to retry).
export function PhotoThumb({ photo }: { photo: LightboxPhoto }) {
  if (photo.status === "ready") return <img src={`/api/admin/photos/${photo.id}/thumb`} alt="" loading="lazy" decoding="async" />;
  if (photo.status === "failed") return <div className="photo-placeholder failed"><ImageOff size={18} />Lỗi xem trước</div>;
  return <div className="photo-placeholder">Đang xử lý</div>;
}

// Full-size review for the studio: the preview image, the customer's pinned notes with
// resolve/reopen, a quick reply on the photo, and ←/→ to move through the current list.
export default function PhotoLightbox({ projectId, photos, index, revision, onIndex, onClose, onChanged }: {
  projectId: string; photos: LightboxPhoto[]; index: number; revision: number;
  onIndex: (index: number) => void; onClose: () => void; onChanged: () => void;
}) {
  const { notify, fail } = useManager();
  const photo = photos[Math.min(index, photos.length - 1)];
  const [notes, setNotes] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<Message[]>(`/admin/projects/${projectId}/messages?photo_id=${photo.id}`, { signal: controller.signal }).then(setNotes).catch(() => setNotes([]));
    return () => controller.abort();
  }, [projectId, photo.id, revision]);
  useEffect(() => { setNotes(null); setReply(""); }, [photo.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("textarea,input,select")) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [index, photos.length, onIndex, onClose]);
  const clientNotes = (notes || []).filter((n) => n.author_role === "client");
  const pins = new Map(clientNotes.filter((n) => n.x != null && n.y != null).map((n, i) => [n.id, i + 1]));
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { fail((e as Error).message); } finally { setBusy(false); }
  }
  const toggle = (n: Message) => run(async () => {
    await api(`/admin/messages/${n.id}`, json("PATCH", { resolved: !n.resolved }));
    setNotes((v) => v && v.map((x) => (x.id === n.id ? { ...x, resolved: !n.resolved } : x)));
    onChanged();
  });
  return (
    <div className="lightbox mgr-lightbox" role="dialog" aria-modal="true" aria-label={`Xem ${photo.filename}`}>
      <header>
        <div>
          <strong>{photo.filename}</strong>
          <span className="muted small">{index + 1} / {photos.length}{photo.relative_path ? ` · ${photo.relative_path}` : ""}{photo.width && photo.height ? ` · ${photo.width} × ${photo.height}` : ""}</span>
        </div>
        <div className="row">
          <button className="icon-button" disabled={index <= 0} onClick={() => onIndex(index - 1)} aria-label="Ảnh trước (←)" title="Ảnh trước (←)"><ArrowLeft /></button>
          <button className="icon-button" disabled={index >= photos.length - 1} onClick={() => onIndex(index + 1)} aria-label="Ảnh tiếp (→)" title="Ảnh tiếp (→)"><ArrowRight /></button>
          <button className="icon-button" onClick={onClose} aria-label="Đóng (Esc)" title="Đóng (Esc)"><X /></button>
        </div>
      </header>
      <div className="lightbox-main">
        <section className="lightbox-stage">
          {photo.status === "ready" && isVideo(photo)
            ? <video key={photo.id} className="media-player" controls playsInline preload="metadata" poster={`/api/admin/photos/${photo.id}/preview`} src={`/api/admin/photos/${photo.id}/video`} />
            : photo.status === "ready"
              ? <div className="annotated-image" style={{ aspectRatio: photo.width && photo.height ? `${photo.width}/${photo.height}` : undefined, cursor: "default" }}>
                  <img key={photo.id} src={`/api/admin/photos/${photo.id}/preview`} alt={photo.filename} />
                  {clientNotes.filter((n) => pins.has(n.id)).map((n) => <span key={n.id} className={`pin ${n.resolved ? "resolved" : ""}`} style={{ left: `${n.x! * 100}%`, top: `${n.y! * 100}%` }} title={n.body}>{pins.get(n.id)}</span>)}
                </div>
              : <div className="empty"><ImageIcon /><p>{photo.status === "failed" ? "Không tạo được ảnh xem trước cho file này. Dùng “Tạo lại ảnh xem bị lỗi” ở Tổng quan." : "Ảnh đang được xử lý."}</p></div>}
        </section>
        <aside className="notes-panel">
          <div className="lightbox-facts">
            {!!photo.favorite_count && <span className="tag"><Heart size={12} /> {photo.favorite_count} khách tim</span>}
            {!!photo.edit_pick && <span className={`tag ${photo.edit_done ? "green" : ""}`}>{photo.edit_done ? "Đã chỉnh xong" : "Khách chọn edit"}</span>}
            {!!photo.missing && <span className="tag warn">Mất file nguồn</span>}
          </div>
          <span className="eyebrow">GHI CHÚ CỦA KHÁCH</span>
          {notes === null ? <p className="muted small">Đang tải…</p> : !notes.length ? <p className="muted small">Ảnh này chưa có ghi chú.</p> : notes.map((n) => n.author_role === "staff"
            ? <div className="note studio-reply" key={n.id}><span className="note-number"><MessageCircle size={11} /></span><div><small className="note-author">{n.author_name}</small><p>{n.body}</p><small>{messageTime(n.created_at)}</small></div></div>
            : <div className={`note ${n.resolved ? "resolved" : ""}`} key={n.id}>
                <span className="note-number">{pins.get(n.id) ?? "•"}</span>
                <div>
                  <small className="note-author">{n.author_name}</small><p>{n.body}</p>
                  <small>{n.resolved ? "Đã xử lý" : "Chờ xử lý"} · {messageTime(n.created_at)}</small>
                  <button type="button" className="text-button" disabled={busy} onClick={() => void toggle(n)}>{n.resolved ? <><RotateCcw size={13} />Mở lại</> : <><Check size={13} />Đánh dấu đã xử lý</>}</button>
                </div>
              </div>)}
          <form onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const sent = await api<Message>(`/admin/projects/${projectId}/messages`, json("POST", { photo_id: photo.id, body: reply.trim() }));
              setNotes((v) => [...(v || []), sent]); setReply(""); notify("Đã gửi trả lời cho khách");
            });
          }}>
            <label>Trả lời khách về ảnh này<textarea value={reply} maxLength={2000} rows={3} onChange={(e) => setReply(e.target.value)} placeholder="Ví dụ: Studio đã làm sáng vùng mặt, anh chị xem lại nhé." /></label>
            <button className="primary wide" disabled={busy || !reply.trim()}><MessageCircle size={16} />Gửi trả lời</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
