"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Copy, Download, MessageCircle } from "lucide-react";
import { api, copy, json } from "@/lib/api";
import { isVideo } from "@/lib/media";

type Item = { id: string; filename: string; extension: string; relative_path: string; status: string; missing: number; edit_done: boolean; note_count: number; notes: string | null };
type Data = { mode: "edit" | "favorites"; max_edit: number; search_string: string; done: number; photos: Item[] };

// Editor's work screen: the customer's edit picks (or hearted photos when the album has no edit
// limit), their notes, a per-photo "done" flag and a Lightroom/Bridge filename filter.
export default function Worklist({ projectId, revision, onReply, onOpen }: {
  projectId: string; revision: number; onReply: () => void; onOpen: (photo: Item) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<Data>(`/admin/projects/${projectId}/worklist`, { signal: controller.signal }).then(setData)
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [projectId, revision]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 3000); return () => clearTimeout(t); }, [notice]);
  async function toggle(item: Item) {
    setError("");
    setData(d => d && { ...d, done: d.done + (item.edit_done ? -1 : 1), photos: d.photos.map(p => p.id === item.id ? { ...p, edit_done: !p.edit_done } : p) });
    try { await api(`/admin/photos/${item.id}/done`, json("PATCH", { done: !item.edit_done })); }
    catch (e) {
      setError((e as Error).message);
      setData(d => d && { ...d, done: d.done + (item.edit_done ? 1 : -1), photos: d.photos.map(p => p.id === item.id ? { ...p, edit_done: item.edit_done } : p) });
    }
  }
  if (!data) return <section className="panel"><p className="muted">{error || "Đang tải danh sách…"}</p></section>;
  const shown = onlyOpen ? data.photos.filter(p => !p.edit_done) : data.photos;
  const total = data.photos.length;
  return <section className="panel worklist">
    <div className="panel-title">
      <div><h2>Danh sách chỉnh sửa</h2>
        <p className="muted small">{data.mode === "edit" ? `Ảnh khách chọn chỉnh sửa (giới hạn ${data.max_edit} ảnh).` : "Album không giới hạn ảnh edit: danh sách gồm mọi ảnh khách đã thả tim."}</p></div>
      <span className="pill">{data.done}/{total} đã xong</span>
    </div>
    <div className="worklist-progress" aria-hidden="true"><span style={{ width: total ? `${(data.done / total) * 100}%` : 0 }} /></div>
    <div className="worklist-actions">
      <button disabled={!data.search_string} onClick={() => void copy(data.search_string).then(() => setNotice("Đã chép tên file cho Lightroom")).catch(e => setError(e.message))}><Copy size={15} />Chép tên file</button>
      <a className="button" href={`/api/admin/projects/${projectId}/worklist?format=csv`}><Download size={15} />Xuất CSV kèm ghi chú</a>
      <label className="check-inline"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />Chỉ ảnh chưa xong</label>
    </div>
    {!total ? <div className="empty"><p>Khách chưa chọn ảnh nào.</p></div> :
      <div className="worklist-grid">
        {shown.map(item => <article key={item.id} className={`worklist-item ${item.edit_done ? "done" : ""}`}>
          <button type="button" className="worklist-thumb" onClick={() => onOpen(item)} aria-label={`Xem ${item.filename}`}>
            {item.status === "ready" ? <img src={`/api/admin/photos/${item.id}/thumb`} alt="" loading="lazy" /> : <span className="photo-placeholder">Đang xử lý</span>}
            {isVideo(item) && <span className="media-badge">▶ VIDEO</span>}
          </button>
          <div className="worklist-body">
            <strong title={item.relative_path}>{item.filename}</strong>
            {item.missing ? <small className="alert-text">Mất file nguồn</small> : null}
            {item.notes && <p className="worklist-notes">{item.notes}</p>}
            <div className="worklist-row">
              <button type="button" className={`done-toggle ${item.edit_done ? "on" : ""}`} onClick={() => void toggle(item)} aria-pressed={item.edit_done}>
                {item.edit_done ? <CheckCircle2 size={16} /> : <Circle size={16} />}{item.edit_done ? "Đã xong" : "Đánh dấu xong"}</button>
              {item.note_count > 0 && <button type="button" className="text-button" onClick={onReply}><MessageCircle size={14} />{item.note_count}</button>}
            </div>
          </div>
        </article>)}
      </div>}
    {error && <p role="alert" className="alert">{error}</p>}
    {notice && <div role="status" className="toast">{notice}</div>}
  </section>;
}
