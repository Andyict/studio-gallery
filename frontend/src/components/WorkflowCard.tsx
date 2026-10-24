"use client";
import { useEffect, useState } from "react";
import { Check, ClipboardList } from "lucide-react";
import { api, json } from "@/lib/api";
import { useManager } from "./manager/context";

export const STATUS_OPTIONS = [
  ["selecting", "Khách đang chọn"],
  ["submitted", "Khách đã gửi (khoá)"],
  ["editing", "Đang chỉnh sửa"],
  ["delivered", "Đã trả ảnh"],
] as const;
export const statusLabel = (status: string) => STATUS_OPTIONS.find(([v]) => v === status)?.[1] || status;

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// Album workflow controls on the Overview tab: status, edit-pick limit, due date and the message
// shown to the customer. Changing the status back to "selecting" unlocks the customer's choices.
export default function WorkflowCard({ project, finalFolder, disabled = false, onSaved }: { project: any; finalFolder: string; disabled?: boolean; onSaved: (message: string) => Promise<void> }) {
  const { confirm } = useManager();
  const [status, setStatus] = useState(project.status);
  const [maxEdit, setMaxEdit] = useState(String(project.max_edit || 0));
  const [due, setDue] = useState(toLocal(project.due_at));
  const [message, setMessage] = useState(project.client_message || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setStatus(project.status); setMaxEdit(String(project.max_edit || 0)); setDue(toLocal(project.due_at)); setMessage(project.client_message || "");
  }, [project.id, project.status, project.max_edit, project.due_at, project.client_message]);
  async function save() {
    // Two status changes are visible to the customer at once, so they are confirmed first.
    if (status !== project.status && (status === "selecting" || status === "delivered") && !(await confirm({
      title: `Chuyển sang “${statusLabel(status)}”`,
      body: status === "selecting"
        ? <p>Khách được chọn lại ảnh: danh sách khách đã gửi sẽ mở khoá để sửa.</p>
        : <p>Khách sẽ thấy ảnh trong thư mục “{finalFolder}” ở tab Ảnh hoàn thiện và được thông báo album đã trả.</p>,
      confirm: "Đổi trạng thái",
    }))) return;
    setBusy(true); setError("");
    try {
      await api(`/admin/projects/${project.id}/workflow`, json("PATCH", {
        status, max_edit: Math.max(0, Number(maxEdit) || 0), due_at: due ? new Date(due).toISOString() : null, client_message: message,
      }));
      await onSaved(status !== project.status && status === "selecting" ? "Đã mở khoá cho khách chọn lại" : "Đã lưu quy trình album");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const overdue = project.due_at && project.status !== "delivered" && new Date(project.due_at) < new Date();
  return <section className="album-work-card workflow-card">
    <div className="row">
      <span className="icon-tile"><ClipboardList size={19} /></span>
      <div><span className="tiny-label">QUY TRÌNH ALBUM</span><h3>{statusLabel(project.status)}</h3></div>
    </div>
    <div className="workflow-metrics">
      <span><strong>{project.max_edit ? `${project.edit_pick_count}/${project.max_edit}` : project.favorite_count}</strong>{project.max_edit ? "ảnh chọn edit" : "ảnh đã tim"}</span>
      {project.max_edit > 0 && <span><strong>{project.edit_done_count}</strong>đã chỉnh xong</span>}
      {project.due_at && <span className={overdue ? "needs-work" : ""}><strong>{new Date(project.due_at).toLocaleDateString("vi-VN")}</strong>{overdue ? "quá hạn trả" : "hạn trả ảnh"}</span>}
    </div>
    {project.customer_note && <p className="customer-note"><span className="tiny-label">GHI CHÚ CHUNG CỦA KHÁCH</span>{project.customer_note}</p>}
    <label>Trạng thái
      <select value={status} onChange={e => setStatus(e.target.value)}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    <div className="form-grid">
      <label>Số ảnh edit tối đa
        <input type="number" min={0} max={10000} value={maxEdit} onChange={e => setMaxEdit(e.target.value)} /></label>
      <label>Hạn trả ảnh
        <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
    </div>
    <small className="muted">0 = khách chỉ thả tim, không giới hạn. Ảnh trong thư mục “{finalFolder}” hiện cho khách ở tab Ảnh hoàn thiện khi trạng thái là Đã trả ảnh.</small>
    <label>Lời nhắn hiển thị cho khách
      <textarea rows={3} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ví dụ: Anh chị chọn 40 ảnh để studio chỉnh sửa nhé." /></label>
    <button className="wide" disabled={busy || disabled} title={disabled ? "Album đang lưu trữ" : undefined} onClick={() => void save()}><Check size={16} /> Lưu quy trình</button>
    {error && <p role="alert" className="alert">{error}</p>}
  </section>;
}
