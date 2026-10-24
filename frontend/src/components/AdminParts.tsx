"use client";
import { ChevronRight, Folder } from "lucide-react";
import { statusLabel } from "./WorkflowCard";

export function displayProjectPath(root: string) {
  const prefix = "__nas_shares__/";
  if (!root.startsWith(prefix)) return root;
  const parts = root.slice(prefix.length).split("/");
  try { parts[0] = decodeURIComponent(parts[0]); } catch { /* Keep the NAS name as-is. */ }
  return parts.join("/");
}

export function AlbumCard({ album, open }: { album: any; open: () => void }) {
  return (
    <button className="album-card" onClick={open}>
      <div className="album-card-top">
        <span className="folder-icon">
          <Folder size={21} />
        </span>
        <span
          className={`tag ${album.scan?.status === "completed" ? "green" : ""}`}
        >
          {album.scan?.status === "running"
            ? "Đang quét"
            : album.scan?.status === "failed"
              ? "Lỗi nguồn"
              : "Đã đồng bộ"}
        </span>
      </div>
      <h3>{album.name}</h3>
      <small>/{displayProjectPath(String(album.root))}</small>
      <div className="album-card-status">
        {album.archived_at ? <span className="album-status archived">Đã lưu trữ</span> : <span className={`album-status ${album.status}`}>{statusLabel(album.status)}</span>}
        {album.due_at && <span className={album.status !== "delivered" && new Date(album.due_at) < new Date() ? "needs-work" : "muted"}>Hạn {new Date(album.due_at).toLocaleDateString("vi-VN")}</span>}
      </div>
      <div className="album-metrics">
        <span>
          <strong>{album.photo_count}</strong> ảnh
        </span>
        <span>
          <strong>{album.max_edit ? `${album.edit_pick_count}/${album.max_edit}` : album.favorite_count}</strong> {album.max_edit ? "chọn edit" : "đã tim"}
        </span>
        <span className={album.open_comment_count ? "needs-work" : ""}>
          <strong>{album.open_comment_count}</strong> ghi chú
        </span>
      </div>
      <div className="album-open">
        Mở album <ChevronRight size={15} />
      </div>
    </button>
  );
}
export function Stat({
  label,
  value,
  icon,
  detail,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  detail: string;
}) {
  return (
    <article className="stat-card">
      <div>
        <span className="tiny-label">{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value.toLocaleString("vi-VN")}</strong>
      <small>{detail}</small>
    </article>
  );
}
