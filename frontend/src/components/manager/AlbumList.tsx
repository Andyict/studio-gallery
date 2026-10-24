"use client";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, CheckSquare, FolderOpen, Search, X } from "lucide-react";
import { api, json } from "@/lib/api";
import { useAdminRoute } from "@/lib/adminRoute";
import { AlbumCard, displayProjectPath } from "../AdminParts";
import { STATUS_OPTIONS, statusLabel } from "../WorkflowCard";
import { useManager, useStoredView, ViewSwitch, type Project } from "./context";

const FILTERS: [string, string][] = [["", "Tất cả"], ...STATUS_OPTIONS.map(([v, l]) => [v, l] as [string, string]), ["overdue", "Quá hạn"], ["unread", "Có tin mới"], ["notes", "Có ghi chú"]];
const SORTS: [string, string][] = [["", "Mới tạo"], ["activity", "Khách hoạt động gần nhất"], ["due", "Hạn trả ảnh"], ["name", "Tên A–Z"]];
const overdue = (p: Project) => !!p.due_at && p.status !== "delivered" && new Date(p.due_at) < new Date();

// Every album this account can see, with filters and sorting kept in the URL
// (?q=&status=&mine=1&sort=&archived=1) and a selection mode for bulk actions.
export default function AlbumList() {
  const { me, isAdmin, limited, projects, projectsLoaded, refresh, notify, fail, confirm } = useManager();
  const { params, setParam } = useAdminRoute();
  const status = params.get("status") || "", sort = params.get("sort") || "", mine = params.get("mine") === "1", archived = params.get("archived") === "1";
  const [q, setQ] = useState(params.get("q") || "");
  const [view, setView] = useStoredView("albums");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setParam("q", q.trim()), 250); return () => clearTimeout(t); }, [q, setParam]);
  useEffect(() => { setPicked(new Set()); }, [archived]);
  const active = projects.filter((p) => !p.archived_at), archivedCount = projects.length - active.length;
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase("vi");
    const rows = projects.filter((p) => (archived ? !!p.archived_at : !p.archived_at)
      && (!needle || `${p.name} ${displayProjectPath(String(p.root))} ${p.assigned_names || ""}`.toLocaleLowerCase("vi").includes(needle))
      && (!mine || String(p.assigned_ids || "").split(",").includes(me.id))
      && (!status || (status === "overdue" ? overdue(p) : status === "unread" ? p.unread_message_count > 0 : status === "notes" ? p.open_comment_count > 0 : p.status === status)));
    const by: Record<string, (a: Project, b: Project) => number> = {
      activity: (a, b) => String(b.last_client_activity || "").localeCompare(String(a.last_client_activity || "")),
      due: (a, b) => (a.due_at ? 0 : 1) - (b.due_at ? 0 : 1) || String(a.due_at || "").localeCompare(String(b.due_at || "")),
      name: (a, b) => a.name.localeCompare(b.name, "vi"),
    };
    return by[sort] ? [...rows].sort(by[sort]) : rows;
  }, [projects, q, archived, mine, status, sort, me.id]);
  const count = (key: string) => key ? active.filter((p) => key === "overdue" ? overdue(p) : key === "unread" ? p.unread_message_count > 0 : key === "notes" ? p.open_comment_count > 0 : p.status === key).length : active.length;
  const toggle = (id: string) => setPicked((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = shown.filter((p) => picked.has(p.id));

  async function bulk(label: string, run: (p: Project) => Promise<unknown>) {
    setBusy(true);
    const results = await Promise.allSettled(chosen.map(run));
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    await refresh().catch(() => {});
    setBusy(false); setPicked(new Set()); setSelecting(false);
    if (failed.length) fail(`${failed.length}/${chosen.length} album chưa ${label}: ${failed[0].reason?.message || ""}`);
    else notify(`Đã ${label} ${chosen.length} album`);
  }
  async function archiveChosen() {
    const ok = await confirm({
      title: archived ? "Khôi phục album" : "Lưu trữ album",
      body: archived ? <p>Khôi phục {chosen.length} album: khách mở lại được và album được quét như cũ.</p>
        : <p>Lưu trữ {chosen.length} album: khách không còn mở được (cả link và tài khoản) và album ngừng quét. Dữ liệu vẫn được giữ.</p>,
      confirm: archived ? "Khôi phục" : "Lưu trữ",
    });
    if (ok) await bulk(archived ? "khôi phục" : "lưu trữ", (p) => api(`/admin/projects/${p.id}/archive`, json("POST", { archived: !archived })));
  }
  async function statusChosen(next: string) {
    if (!next) return;
    const ok = await confirm({
      title: `Chuyển sang “${statusLabel(next)}”`,
      body: <><p>Đổi trạng thái của {chosen.length} album.</p>
        {next === "selecting" && <p className="small">Khách được chọn lại: danh sách đã gửi sẽ mở khoá.</p>}
        {next === "delivered" && <p className="small">Khách sẽ thấy ảnh trong thư mục Final của từng album.</p>}</>,
      confirm: "Đổi trạng thái",
    });
    if (ok) await bulk("đổi trạng thái", (p) => api(`/admin/projects/${p.id}/workflow`, json("PATCH", { status: next })));
  }

  return (
    <>
      <section className="panel album-dashboard-panel">
        <div className="panel-title album-browser-toolbar">
          <div>
            <h2>{archived ? "Album đã lưu trữ" : "Album đang dùng"}</h2>
            <p className="album-results">
              {shown.length} / {archived ? archivedCount : active.length} album
              {(archivedCount > 0 || archived) && <button type="button" className="text-button archived-toggle" onClick={() => setParam("archived", archived ? "" : "1", { push: true })}>{archived ? "← Album đang dùng" : `Album đã lưu trữ (${archivedCount})`}</button>}
            </p>
          </div>
          <div className="album-dashboard-tools">
            <label className="album-search"><Search /><input aria-label="Tìm album" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên album, đường dẫn, nhân viên…" /></label>
            <select aria-label="Sắp xếp album" value={sort} onChange={(e) => setParam("sort", e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <ViewSwitch value={view} onChange={setView} label="Kiểu xem album" />
          </div>
        </div>
        {!archived && (
          <div className="filter-chips" role="group" aria-label="Lọc theo trạng thái">
            {FILTERS.map(([v, l]) => {
              const n = count(v);
              if (v && !n && status !== v) return null;
              return <button key={v} type="button" className={`chip ${status === v ? "selected" : ""}`} aria-pressed={status === v} onClick={() => setParam("status", v)}>{l}<span className="chip-count">{n}</span></button>;
            })}
            {!isAdmin || projects.some((p) => String(p.assigned_ids || "").split(",").includes(me.id))
              ? <button type="button" className={`chip ${mine ? "selected" : ""}`} aria-pressed={mine} onClick={() => setParam("mine", mine ? "" : "1")}>Album của tôi</button> : null}
          </div>
        )}
        {!limited && shown.length > 0 && (
          <div className={`bulk-bar ${selecting ? "on" : ""}`}>
            {selecting ? <>
              <strong>{chosen.length} album đã chọn</strong>
              <button type="button" className="text-button" onClick={() => setPicked(chosen.length === shown.length ? new Set() : new Set(shown.map((p) => p.id)))}>{chosen.length === shown.length ? "Bỏ chọn" : "Chọn tất cả"}</button>
              <span className="grow" />
              {!archived && <select aria-label="Đổi trạng thái album đã chọn" disabled={!chosen.length || busy} value="" onChange={(e) => void statusChosen(e.target.value)}>
                <option value="">Đổi trạng thái…</option>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
              <button type="button" disabled={!chosen.length || busy} onClick={() => void archiveChosen()}>{archived ? <><ArchiveRestore size={15} />Khôi phục</> : <><Archive size={15} />Lưu trữ</>}</button>
              <button type="button" className="icon-button" aria-label="Thoát chế độ chọn" onClick={() => { setSelecting(false); setPicked(new Set()); }}><X size={16} /></button>
            </> : <button type="button" className="text-button" onClick={() => setSelecting(true)}><CheckSquare size={15} />Chọn nhiều album</button>}
          </div>
        )}
        {shown.length ? (
          <div className={`album-grid ${view}`}>
            {shown.map((p) => <AlbumCard key={p.id} album={p} selecting={selecting} selected={picked.has(p.id)} onToggle={() => toggle(p.id)} />)}
          </div>
        ) : (
          <div className="empty">
            <FolderOpen size={44} />
            <h2>{!projectsLoaded ? "Đang tải…" : projects.length === 0 ? (limited ? "Bạn chưa được giao album nào" : "Chưa có album") : "Không có album phù hợp"}</h2>
            <p>{projects.length === 0
              ? limited ? "Quản trị viên sẽ giao album cho bạn trong phần Phân công của từng album." : "Album được tạo tự động khi quét nguồn ảnh trên NAS, hoặc từ mục Thư mục NAS."
              : "Thử bỏ bớt bộ lọc hoặc từ khoá tìm kiếm."}</p>
          </div>
        )}
      </section>
    </>
  );
}
