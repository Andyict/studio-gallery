"use client";
import { CheckSquare, ChevronRight, Folder, MessageCircle, Square, UsersRound } from "lucide-react";
import { href, NavLink } from "@/lib/adminRoute";
import { statusLabel } from "./WorkflowCard";
import { ago } from "./manager/context";

export function displayProjectPath(root: string) {
  const prefix = "__nas_shares__/";
  if (!root.startsWith(prefix)) return root;
  const parts = root.slice(prefix.length).split("/");
  try { parts[0] = decodeURIComponent(parts[0]); } catch { /* Keep the NAS name as-is. */ }
  return parts.join("/");
}

export const scanLabel = (scan: { status?: string } | null) =>
  scan?.status === "running" ? "Đang quét" : scan?.status === "failed" ? "Lỗi nguồn" : scan?.status === "completed" ? "Đã đồng bộ" : "Chưa quét";

// One album in the album list. In selection mode a click toggles it instead of opening it.
export function AlbumCard({ album, selecting = false, selected = false, onToggle }: { album: any; selecting?: boolean; selected?: boolean; onToggle?: () => void }) {
  const overdue = album.due_at && album.status !== "delivered" && new Date(album.due_at) < new Date();
  const body = <>
    <div className="album-card-top">
      <span className="folder-icon">{selecting ? (selected ? <CheckSquare size={21} /> : <Square size={21} />) : <Folder size={21} />}</span>
      <span className={`tag ${album.scan?.status === "completed" ? "green" : album.scan?.status === "failed" ? "warn" : ""}`}>{scanLabel(album.scan)}</span>
    </div>
    <h3>{album.name}</h3>
    <small>/{displayProjectPath(String(album.root))}</small>
    <div className="album-card-status">
      {album.archived_at ? <span className="album-status archived">Đã lưu trữ</span> : <span className={`album-status ${album.status}`}>{statusLabel(album.status)}</span>}
      {album.due_at && <span className={overdue ? "needs-work" : "muted"}>Hạn {new Date(album.due_at).toLocaleDateString("vi-VN")}</span>}
      {album.unread_message_count > 0 && <span className="needs-work"><MessageCircle size={12} /> {album.unread_message_count} tin mới</span>}
    </div>
    <div className="album-metrics">
      <span><strong>{album.photo_count}</strong> ảnh</span>
      <span><strong>{album.max_edit ? `${album.edit_pick_count}/${album.max_edit}` : album.favorite_count}</strong> {album.max_edit ? "chọn edit" : "đã tim"}</span>
      <span className={album.open_comment_count ? "needs-work" : ""}><strong>{album.open_comment_count}</strong> ghi chú</span>
    </div>
    <div className="album-card-meta">
      <span title="Nhân viên phụ trách"><UsersRound size={12} /> {album.assigned_names || "Chưa phân công"}</span>
      <span>{album.last_client_activity ? `Khách: ${ago(album.last_client_activity)}` : `${album.access_count || 0} link còn hiệu lực`}</span>
    </div>
    {!selecting && <div className="album-open">Mở album <ChevronRight size={15} /></div>}
  </>;
  return selecting
    ? <button type="button" className={`album-card ${selected ? "is-selected" : ""}`} aria-pressed={selected} onClick={onToggle}>{body}</button>
    : <NavLink className="album-card" to={href.album(album.id)}>{body}</NavLink>;
}
