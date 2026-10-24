"use client";
import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, ArrowLeft, Image as ImageIcon, Link as LinkIcon } from "lucide-react";
import { api, json } from "@/lib/api";
import { go, href, NavLink, type AlbumTab } from "@/lib/adminRoute";
import { displayProjectPath } from "../AdminParts";
import { statusLabel } from "../WorkflowCard";
import Worklist from "../Worklist";
import ShareDialog from "../ShareDialog";
import { dateVN, useManager } from "./context";
import AlbumOverview from "./AlbumOverview";
import AlbumPhotos from "./AlbumPhotos";
import AlbumFavorites from "./AlbumFavorites";
import AlbumLinks from "./AlbumLinks";
import AlbumSettings from "./AlbumSettings";
import PhotoLightbox, { type LightboxPhoto } from "./PhotoLightbox";

export type Detail = { folders: any[]; links: any[]; lists: any[]; comments: any[] };
const TABS: [AlbumTab, string][] = [["overview", "Tổng quan"], ["photos", "Ảnh"], ["selections", "Khách yêu thích"], ["worklist", "Danh sách edit"], ["links", "Link chia sẻ"], ["settings", "Cài đặt"]];

// One album. Mounted with key={id}, so switching albums starts from empty state and a slow
// response for the previous album can never land in this one.
export default function AlbumView({ id, tab }: { id: string; tab: AlbumTab }) {
  const { projects, projectsLoaded, live, limited, refresh, notify, fail, confirm, brand } = useManager();
  const project = projects.find((p) => p.id === id);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const [folders, links, lists, comments] = await Promise.all(["folders", "links", "selections", "comments"].map((p) => api(`/admin/projects/${id}/${p}`, { signal })));
    if (!signal?.aborted) setDetail({ folders, links, lists, comments });
  }, [id]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((e) => { if (!controller.signal.aborted) fail((e as Error).message); });
    const t = setInterval(() => { if (!document.hidden) load(controller.signal).catch(() => {}); }, 60000);
    return () => { controller.abort(); clearInterval(t); };
  }, [load, fail]);
  // Realtime: only events about this album (or a reconnect) bump its revision and refetch it.
  const [revision, setRevision] = useState(0);
  const event = live.event;
  useEffect(() => {
    if (!live.n || !event || !(event.type === "resync" || !event.project_id || event.project_id === id)) return;
    const t = setTimeout(() => { setRevision((v) => v + 1); void load().catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [live.n, event, id, load]);

  if (!project) return (
    <div className="empty album-missing">
      <ImageIcon size={40} />
      <h2>{projectsLoaded ? "Không tìm thấy album" : "Đang tải album…"}</h2>
      {projectsLoaded && <p>Album đã bị xoá, hoặc tài khoản của bạn không được giao album này.</p>}
      <NavLink className="button" to={href.albums()}><ArrowLeft size={15} />Về danh sách album</NavLink>
    </div>
  );
  const archived = !!project.archived_at;
  const openShare = () => (archived ? fail("Album đang lưu trữ; khôi phục album để chia sẻ") : setShareOpen(true));
  async function restore() {
    if (!(await confirm({ title: "Khôi phục album", body: <p>Khách mở lại được album và album được quét lại theo lịch.</p>, confirm: "Khôi phục" }))) return;
    try { await api(`/admin/projects/${id}/archive`, json("POST", { archived: false })); await refresh(); notify("Đã khôi phục album"); }
    catch (e) { fail((e as Error).message); }
  }
  const reload = async () => { await Promise.all([load(), refresh()]); };
  const d = detail;
  return (
    <>
      <section className="admin-heading album-heading">
        <div>
          <NavLink className="back-link" to={href.albums()}><ArrowLeft size={14} />Album</NavLink>
          <h1>{project.name}</h1>
          <p className="muted album-heading-meta">
            <span className={`album-status ${archived ? "archived" : project.status}`}>{archived ? "Đã lưu trữ" : statusLabel(project.status)}</span>
            <span>/{displayProjectPath(String(project.root))}</span>
            {project.due_at && <span>Hạn trả {dateVN(project.due_at)}</span>}
          </p>
        </div>
        <button className="primary" disabled={archived} title={archived ? "Album đang lưu trữ" : undefined} onClick={openShare}><LinkIcon size={16} />Tạo link chia sẻ</button>
      </section>
      {archived && (
        <div className="archived-banner" role="status">
          <span><strong>Album đã lưu trữ</strong> từ {dateVN(project.archived_at)}. Khách không mở được, album không được quét; mọi dữ liệu vẫn còn.</span>
          {!limited && <button onClick={() => void restore()}><ArchiveRestore size={15} />Khôi phục</button>}
        </div>
      )}
      <nav className="tabs admin-tabs" aria-label="Mục của album">
        {TABS.map(([key, label]) => (
          <NavLink key={key} to={href.album(id, key)} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined}>
            {label}
            {key === "selections" && project.submitted_count > 0 && <span className="tab-dot" title="Khách đã gửi lựa chọn" />}
            {key === "worklist" && project.open_comment_count > 0 && <span className="tab-count">{project.open_comment_count}</span>}
          </NavLink>
        ))}
      </nav>
      {!d ? <section className="panel"><p className="muted">Đang tải album…</p></section> : <>
        {tab === "overview" && <AlbumOverview project={project} detail={d} archived={archived} onShare={openShare} reload={reload} />}
        {tab === "photos" && <AlbumPhotos project={project} folders={d.folders} revision={revision} onOpen={(photos, index) => setLightbox({ photos, index })} />}
        {tab === "selections" && <AlbumFavorites project={project} detail={d} reload={reload} onOpen={(photos, index) => setLightbox({ photos, index })} />}
        {tab === "worklist" && <Worklist projectId={id} revision={revision} onReply={() => go(href.inbox(id))} onOpen={(photo, all) => setLightbox({ photos: all, index: all.findIndex((p) => p.id === photo.id) })} />}
        {tab === "links" && <AlbumLinks project={project} links={d.links} archived={archived} onShare={openShare} reload={reload} />}
        {tab === "settings" && <AlbumSettings project={project} />}
      </>}
      {shareOpen && <ShareDialog projectId={id} projectName={project.name} folders={d?.folders || []} brand={brand} onClose={() => setShareOpen(false)} onCreated={reload} onNotice={notify} />}
      {lightbox && lightbox.photos.length > 0 && (
        <PhotoLightbox projectId={id} photos={lightbox.photos} index={Math.max(0, lightbox.index)} revision={revision}
          onIndex={(index) => setLightbox((l) => l && { ...l, index })} onClose={() => setLightbox(null)} onChanged={() => void reload()} />
      )}
    </>
  );
}
