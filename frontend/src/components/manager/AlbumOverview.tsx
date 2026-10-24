"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, CheckCheck, ChevronRight, Folder, Link as LinkIcon, RefreshCw } from "lucide-react";
import { api, json } from "@/lib/api";
import { href, NavLink } from "@/lib/adminRoute";
import { displayProjectPath, scanLabel } from "../AdminParts";
import { describeCron, intervalToCron } from "../ScanSchedule";
import WorkflowCard from "../WorkflowCard";
import AlbumStaff from "../AlbumStaff";
import { DownloadLog } from "../AlbumLifecycle";
import { timeVN, useManager, type Project } from "./context";
import type { Detail } from "./AlbumView";

export default function AlbumOverview({ project, detail, archived, onShare, reload }: {
  project: Project; detail: Detail; archived: boolean; onShare: () => void; reload: () => Promise<void>;
}) {
  const { limited, live, refresh, notify, fail } = useManager();
  const [finalFolder, setFinalFolder] = useState("Final");
  const [note, setNote] = useState(project.internal_note || "");
  const [noteDirty, setNoteDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/admin/defaults").then((d) => setFinalFolder(d.finalFolder || "Final")).catch(() => {}); }, []);
  // A colleague's saved note shows up here unless this person is in the middle of editing it.
  useEffect(() => { if (!noteDirty) setNote(project.internal_note || ""); }, [project.internal_note, noteDirty]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { fail((e as Error).message); } finally { setBusy(false); }
  }
  const scan = project.scan;
  return (
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-title"><h2>Thư mục trong album</h2><span className="pill">{detail.folders.length} thư mục</span></div>
        <div className="folder-list">
          {detail.folders.map((f) => (
            <NavLink className="folder-row" key={f.id} to={href.album(project.id, "photos", f.relative_path ? `folder=${f.id}` : "")}>
              <div className="folder-icon"><Folder size={23} /></div>
              <div><strong>{f.name.replaceAll("_", " ")}</strong><small>{f.relative_path || "Thư mục gốc"}</small></div>
              <span className="tag">{f.relative_path ? "Mở ảnh" : "Tất cả ảnh"}</span>
              <ChevronRight size={16} />
            </NavLink>
          ))}
          {!detail.folders.length && <p className="muted">Chưa có thư mục. Đồng bộ để đọc nguồn ảnh.</p>}
        </div>
      </section>
      <div className="overview-side">
        <section className="sync-card">
          <div className="row"><span className="icon-tile"><RefreshCw size={20} /></span><span className="tiny-label">ĐỒNG BỘ NGUỒN ẢNH</span></div>
          <h2>{scan?.status === "running" ? "Đang đọc ảnh từ NAS" : scan?.status === "failed" ? "Cần kiểm tra nguồn ảnh" : archived ? "Album đang lưu trữ" : "Bộ ảnh luôn sẵn sàng"}</h2>
          <p>{archived ? "Album đang lưu trữ nên không được quét. Khôi phục album để quét lại." : "Thêm ảnh vào thư mục trên NAS, studio sẽ tự cập nhật theo lịch bạn đặt."}</p>
          <div className="source-path">/{displayProjectPath(String(project.root))}</div>
          <div className="sync-meta"><span>Trạng thái</span><strong>{scanLabel(scan)}</strong></div>
          {scan?.finished_at && <div className="sync-meta"><span>Lần quét cuối</span><strong>{timeVN(scan.finished_at)}</strong></div>}
          <div className="sync-meta"><span>Lịch quét</span><strong>{archived ? "Tạm dừng" : describeCron(intervalToCron(project.scan_interval_seconds) ?? project.cron)}</strong></div>
          {scan?.error && <p className="alert">{scan.error}</p>}
          <button className="wide" disabled={busy || archived || scan?.status === "running"} onClick={() => void run(async () => {
            await api(`/admin/projects/${project.id}/sync`, json("POST", {})); await refresh(); notify("Đã yêu cầu đồng bộ");
          })}><RefreshCw size={16} />Đồng bộ ngay</button>
          {project.failed_count > 0 && (
            <button className="text-button" disabled={busy} onClick={() => void run(async () => {
              await api(`/admin/projects/${project.id}/retry`, json("POST", {})); await refresh(); notify("Đã đưa ảnh lỗi vào hàng đợi tạo lại");
            })}>Tạo lại {project.failed_count} ảnh xem bị lỗi</button>
          )}
          {project.missing_count > 0 && <p className="muted small">{project.missing_count} ảnh mất nguồn; lựa chọn và ghi chú vẫn được giữ.</p>}
        </section>
        <WorkflowCard project={project} finalFolder={finalFolder} disabled={archived} onSaved={async (message) => { await reload(); notify(message); }} />
        <DownloadLog projectId={project.id} revision={live.n} />
        <section className="album-work-card">
          <div className="row">
            <span className="icon-tile"><CheckCheck size={19} /></span>
            <div><span className="tiny-label">PHÂN CÔNG XỬ LÝ</span><h3>Nhân viên & ghi chú nội bộ</h3></div>
          </div>
          <AlbumStaff key={project.id} projectId={project.id} canEdit={!limited} onSaved={async (message) => { await refresh(); notify(message); }} />
          <label>Ghi chú nội bộ
            <textarea value={note} maxLength={2000} rows={4} onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }} placeholder="Yêu cầu chỉnh sửa, ngày bàn giao hoặc lưu ý cho editor… (khách không thấy)" />
          </label>
          <button className="wide" disabled={busy || !noteDirty} onClick={() => void run(async () => {
            await api(`/admin/projects/${project.id}`, json("PATCH", { name: project.name, cron: project.cron, timezone: project.timezone, internal_note: note }));
            setNoteDirty(false); await refresh(); notify("Đã lưu ghi chú nội bộ");
          })}><Check size={16} />Lưu ghi chú</button>
        </section>
        {!archived && (
          <section className="share-card">
            <LinkIcon />
            <h3>Sẵn sàng gửi cho khách?</h3>
            <p>Tạo một link riêng, chọn thư mục và đặt quyền tải ảnh.</p>
            <button className="text-button" onClick={onShare}>Tạo link chia sẻ <ArrowUpRight size={17} /></button>
          </section>
        )}
      </div>
    </div>
  );
}
