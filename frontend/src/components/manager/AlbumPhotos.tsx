"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircle, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAdminRoute } from "@/lib/adminRoute";
import { isVideo } from "@/lib/media";
import { useStoredView, ViewSwitch, type Project } from "./context";
import { PhotoThumb } from "./PhotoLightbox";

const PAGE = 120;
const FILTERS: [string, string][] = [["", "Tất cả"], ["hearted", "Khách đã tim"], ["notes", "Có ghi chú"], ["edit", "Chọn edit"], ["failed", "Lỗi xem trước"], ["pending", "Đang xử lý"]];
type Page = { total: number; photos: any[] };

// Album photos, paged from the server (120 at a time, more on scroll) with folder, filename search
// and filter kept in the URL. Thumbnails load lazily, so a 5,000-photo album opens instantly.
export default function AlbumPhotos({ project, folders, revision, onOpen }: {
  project: Project; folders: any[]; revision: number; onOpen: (photos: any[], index: number) => void;
}) {
  const { params, setParam } = useAdminRoute();
  const folder = params.get("folder") || "", filter = params.get("filter") || "", search = params.get("q") || "";
  const [q, setQ] = useState(params.get("q") || "");
  const [view, setView] = useStoredView("photos");
  const [data, setData] = useState<Page | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const loaded = useRef(0);
  loaded.current = data?.photos.length || 0;
  const query = useCallback((offset: number, limit: number) => {
    const s = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (folder) s.set("folder_id", folder);
    if (filter) s.set("filter", filter);
    if (search) s.set("q", search);
    return `/admin/projects/${project.id}/photos?${s}`;
  }, [project.id, folder, filter, search]);
  useEffect(() => { const t = setTimeout(() => setParam("q", q.trim()), 300); return () => clearTimeout(t); }, [q, setParam]);
  // New folder/filter/search: start again from the first page.
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    api<Page>(query(0, PAGE), { signal: controller.signal }).then(setData).catch((e) => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [query]);
  // Realtime change in this album: refresh what is already on screen, keeping the scroll position.
  useEffect(() => {
    if (!revision) return;
    const controller = new AbortController();
    api<Page>(query(0, Math.min(500, Math.max(PAGE, loaded.current))), { signal: controller.signal }).then(setData).catch(() => {});
    return () => controller.abort();
  }, [revision, query]);
  const more = useCallback(async () => {
    if (!data || loadingMore || data.photos.length >= data.total) return;
    setLoadingMore(true);
    try { const next = await api<Page>(query(data.photos.length, PAGE)); setData((d) => d && { total: next.total, photos: [...d.photos, ...next.photos.filter((p) => !d.photos.some((x) => x.id === p.id))] }); }
    catch (e) { setError((e as Error).message); } finally { setLoadingMore(false); }
  }, [data, loadingMore, query]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) void more(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);
  const photos = data?.photos || [];
  const sub = folders.filter((f) => f.relative_path);
  return (
    <section className="panel album-photo-browser">
      <div className="photo-toolbar">
        {sub.length > 0 && (
          <select aria-label="Thư mục" value={folder} onChange={(e) => setParam("folder", e.target.value)}>
            <option value="">Tất cả thư mục</option>
            {sub.map((f) => <option key={f.id} value={f.id}>{f.relative_path}</option>)}
          </select>
        )}
        <label className="album-search"><Search /><input aria-label="Tìm theo tên file" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên file, ví dụ IMG_0123" /></label>
        <ViewSwitch value={view} onChange={setView} label="Kiểu xem ảnh" />
      </div>
      <div className="filter-chips" role="group" aria-label="Lọc ảnh">
        {FILTERS.map(([v, l]) => (
          (v === "edit" && !project.max_edit) || (v === "failed" && !project.failed_count && filter !== "failed") ? null
            : <button key={v} type="button" className={`chip ${filter === v ? "selected" : ""}`} aria-pressed={filter === v} onClick={() => setParam("filter", v)}>{l}</button>
        ))}
        <span className="album-results">{data ? `${data.total.toLocaleString("vi-VN")} ảnh` : "Đang tải…"}</span>
      </div>
      {error && <p className="alert" role="alert">{error}</p>}
      {photos.length ? (
        <div className={`favorite-files ${view}`}>
          {photos.map((photo, i) => (
            <button type="button" className="favorite-file" key={photo.id} onClick={() => onOpen(photos, i)} aria-label={`Xem ${photo.filename}`}>
              <PhotoThumb photo={photo} />
              <div>
                <strong>{isVideo(photo) && <span className="media-badge">▶ VIDEO </span>}{photo.filename}</strong>
                <small>
                  {photo.favorite_count ? `♥ ${photo.favorite_count}` : photo.status === "failed" ? "Lỗi xem trước" : photo.status === "ready" ? "Sẵn sàng" : "Đang xử lý"}
                  {photo.edit_pick ? ` · chọn edit${photo.edit_done ? " (xong)" : ""}` : ""}
                  {photo.open_comment_count ? ` · ${photo.open_comment_count} ghi chú` : ""}
                </small>
              </div>
              <span className="album-file-folder">{photo.relative_path}</span>
              <span className="favorite-detail-notes">{photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—"}</span>
            </button>
          ))}
        </div>
      ) : data && (
        <div className="empty">
          <ImageIcon size={38} />
          <h3>{filter || search ? "Không có ảnh phù hợp" : "Thư mục chưa có ảnh"}</h3>
          <p>{filter || search ? "Thử bỏ bộ lọc hoặc đổi từ khoá." : "Đồng bộ lại nếu bạn vừa thêm ảnh vào NAS."}</p>
        </div>
      )}
      <div ref={sentinel} className="load-more">
        {data && photos.length < data.total && <button type="button" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? <LoaderCircle className="spin" size={15} /> : null}Xem thêm ({(data.total - photos.length).toLocaleString("vi-VN")} ảnh)</button>}
      </div>
    </section>
  );
}
