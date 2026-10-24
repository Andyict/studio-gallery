"use client";
import { useEffect, useState } from "react";
import { ArrowUp, ChevronRight, Folder, FolderOpen, House, Image as ImageIcon, Link as LinkIcon, Plus, Search, Server } from "lucide-react";
import { api, json } from "@/lib/api";
import { go, href, NavLink, useAdminRoute } from "@/lib/adminRoute";
import ImagePreview from "../ImagePreview";
import { Modal } from "../Gallery";
import { useManager, useStoredView, ViewSwitch } from "./context";

type Entry = { name: string; path: string; type?: string; thumbnail?: boolean };
type Browse = { root: string; breadcrumbs: { name: string; path: string }[]; folders: Entry[]; files: Entry[]; album: { id: string; name: string } | null };

// The NAS folder tree (admins and staff who see every album). The folder path is in the URL, so
// the browser's Back/Forward buttons walk the history and a folder can be bookmarked.
export default function FolderBrowser() {
  const { isAdmin, refresh, notify, fail } = useManager();
  const { params } = useAdminRoute();
  const path = params.get("path") || "";
  const [data, setData] = useState<Browse | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useStoredView("folders");
  useEffect(() => {
    let active = true, loading = false;
    const controller = new AbortController();
    setData(null); setError(""); setSearch("");
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try { const d = await api<Browse>(`/admin/browse?path=${encodeURIComponent(path)}`, { signal: controller.signal }); if (active) { setData(d); setError(""); } }
      catch (e) { if (active) setError((e as Error).message); } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [path]);
  const match = (e: Entry) => e.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"));
  const folders = (data?.folders || []).filter(match), files = (data?.files || []).filter(match);
  async function createAlbum() {
    if (!data) return;
    setBusy(true);
    try {
      const created = await api<{ id: string }>("/admin/projects", json("POST", { name: data.breadcrumbs.at(-1)?.name || "Album mới", root: data.root }));
      await refresh();
      notify("Đã tạo album. Ảnh đang được quét; tạo link chia sẻ để gửi khách.");
      go(href.album(created.id));
    } catch (e) { fail((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <section className="admin-heading">
        <div><span className="eyebrow">KHO ẢNH</span><h1>Thư mục NAS</h1><p className="muted">Duyệt nguồn ảnh đã bật và tạo album từ một thư mục.</p></div>
        {isAdmin && <NavLink className="button" to={href.settings("source")}><Server size={16} />Quản lý nguồn ảnh</NavLink>}
      </section>
      <section className="panel album-dashboard-panel">
        <div className="folder-path">
          <button className="icon-button" title="Lên thư mục cha" aria-label="Lên thư mục cha" disabled={!path} onClick={() => go(href.folders(path.split("/").slice(0, -1).join("/")))}><ArrowUp size={17} /></button>
          <nav className="crumbs" aria-label="Đường dẫn thư mục">
            <NavLink to={href.folders()}><House size={14} />NAS</NavLink>
            {(data?.breadcrumbs || []).slice(1).map((c, i, all) => (
              <span key={c.path}><ChevronRight size={13} />{i === all.length - 1 ? <strong>{c.name}</strong> : <NavLink to={href.folders(c.path)}>{c.name}</NavLink>}</span>
            ))}
          </nav>
        </div>
        <div className="panel-title album-browser-toolbar">
          <p className="album-results">{data ? [folders.length && `${folders.length} thư mục`, files.length && `${files.length} tệp`].filter(Boolean).join(" · ") || "Trống" : "Đang tải…"}</p>
          <div className="album-dashboard-tools">
            <label className="album-search"><Search /><input aria-label="Lọc trong thư mục" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Lọc theo tên…" /></label>
            <ViewSwitch value={view} onChange={setView} />
          </div>
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
        {path && data && (
          <div className="album-browser-open">
            {data.album ? <>
              <NavLink className="button primary" to={href.album(data.album.id, "links")}><LinkIcon size={15} />Mở album · link chia sẻ</NavLink>
              <NavLink className="button" to={href.album(data.album.id)}>Mở album “{data.album.name}”</NavLink>
            </> : <button className="primary" disabled={busy} onClick={() => void createAlbum()}><Plus size={15} />Tạo album từ thư mục này</button>}
          </div>
        )}
        {folders.length || files.length ? (
          <div className={`album-grid ${view} file-browser-grid`}>
            {folders.map((f) => (
              <NavLink className="album-card explorer-folder" key={f.path} to={href.folders(f.path)}>
                <div className="album-card-top"><span className="folder-icon"><Folder size={21} /></span></div>
                <h3>{f.name}</h3>
              </NavLink>
            ))}
            {files.map((f) => (
              <button className="album-card browser-file" key={f.path} onClick={() => setPreview(f)}>
                <div className="browser-file-image">{f.thumbnail ? <img src={`/api/admin/browse/thumb?path=${encodeURIComponent(f.path)}`} alt="" loading="lazy" decoding="async" width={320} height={240} onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement?.classList.add("thumbnail-unavailable"); }} /> : <ImageIcon size={26} />}</div>
                <h3>{f.name}</h3><small>{f.type === "video" ? "Video" : "Ảnh"}</small>
              </button>
            ))}
          </div>
        ) : data && (
          <div className="empty">
            <FolderOpen size={44} />
            <h2>{search.trim() ? "Không tìm thấy tệp hoặc thư mục" : path ? "Thư mục này đang trống" : "Chưa bật nguồn ảnh"}</h2>
            <p>{search.trim() ? "Thử tên khác." : path ? "Ảnh và thư mục mới sẽ tự xuất hiện khi được thêm vào NAS." : "Bật một thư mục chia sẻ của NAS làm nguồn ảnh để bắt đầu."}</p>
            {!path && isAdmin && <NavLink className="button primary" to={href.settings("source")}>Thiết lập nguồn ảnh</NavLink>}
          </div>
        )}
      </section>
      {preview && (
        <Modal wide title={preview.name} close={() => setPreview(null)}>
          {preview.thumbnail ? <ImagePreview key={preview.path} src={`/api/admin/browse/thumb?size=preview&path=${encodeURIComponent(preview.path)}`} name={preview.name} /> : <p className="muted">Định dạng này chưa xem trước được trong trình duyệt. Tệp vẫn nằm trong thư mục nguồn trên NAS.</p>}
        </Modal>
      )}
    </>
  );
}
