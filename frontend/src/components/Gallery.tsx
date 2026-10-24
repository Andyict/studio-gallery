'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Aperture, ArrowDownToLine, ArrowLeft, ArrowRight, CalendarClock, Check, CheckCheck, CheckSquare, ChevronDown, Copy, Eye,
  Heart, Image as ImageIcon, LoaderCircle, MessageCircle, NotebookPen, PenLine, Plus, Search, Send, Sparkles, Square, X
} from 'lucide-react';
import { api, json, copy } from '@/lib/api';
import BrandMark from './BrandMark';
import { isVideo } from '@/lib/media';
import { useLiveEvents, LiveEvent } from '@/lib/live';
import { Message, Unread, messageTime, pinNumbers } from '@/lib/messages';
import { useI18n, LangSwitch } from '@/lib/i18n';
import ClientChat from './ClientChat';

type Photo = { extension: string; id: string; filename: string; status: string; width: number; height: number; selected_in: string[]; comments: number; edit_pick: boolean; viewed: boolean; raw_pair?: boolean };
type List = { id: string; name: string; count: number; submitted_at: string | null };
type Project = { id: string; name: string; status: 'selecting' | 'submitted' | 'editing' | 'delivered'; max_edit: number; edit_count: number; due_at: string | null; submitted_at: string | null; client_message: string; customer_note: string };
type GalleryData = { project: Project; final_folder: { id: string; name: string } | null; client: string; downloads: boolean; originals: boolean; folders: { id: string; name: string; relative_path: string }[]; lists: List[] };
type View = 'all' | 'favorites' | 'edit' | 'unseen';

export const STATUS_TEXT: Record<Project['status'], string> = { selecting: 'Đang chọn ảnh', submitted: 'Đã gửi studio', editing: 'Studio đang chỉnh sửa', delivered: 'Đã trả ảnh' };

// The customer's gallery: opened by a share link (token) or from "My albums" (client session).
export default function Gallery({ token }: { token?: string }) {
  const { t, locale } = useI18n();
  const [publicConfig, setPublicConfig] = useState<any>({});
  const [brand, setBrand] = useState('Studio Gallery');
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [share, setShare] = useState<any>(null);
  const [name, setName] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [folder, setFolder] = useState(''), [listID, setListID] = useState(''), [view, setView] = useState<View>('all');
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false), [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Photo | null>(null);
  const [notes, setNotes] = useState<Message[]>([]);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null), [body, setBody] = useState('');
  const [newList, setNewList] = useState(false), [listName, setListName] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false), [exportText, setExportText] = useState('');
  const [downloadSelection, setDownloadSelection] = useState<Set<string>>(new Set());
  const [unread, setUnread] = useState<Unread>({ total: 0, chat: 0, photos: {} });
  const [chatOpen, setChatOpen] = useState(false), [chatRevision, setChatRevision] = useState(0), [noteRevision, setNoteRevision] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false), [noteOpen, setNoteOpen] = useState(false), [albumNote, setAlbumNote] = useState('');
  const [editing, setEditing] = useState<Set<string>>(new Set()), [hearting, setHearting] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState(false);
  const generation = useRef(0), pendingNext = useRef(false);

  const selected = gallery?.lists.find(l => l.id === listID);
  const project = gallery?.project;
  const favorites = view === 'favorites', editOnly = view === 'edit', unseenOnly = view === 'unseen';
  const locked = !!project && project.status !== 'selecting';
  const editMode = !!project?.max_edit;
  const filterList = favorites ? listID : '';
  // Finished photos are for viewing and download only: no hearts or edit picks.
  const inFinal = !!gallery?.final_folder && folder === gallery.final_folder.id;
  const date = (v: string) => new Date(v).toLocaleDateString(locale);

  const refresh = useCallback(async () => {
    const data = await api<GalleryData>(`/client/gallery${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    setGallery(data);
    setListID(v => v || data.lists[0]?.id || '');
    return data;
  }, [token]);
  useEffect(() => {
    api('/config').then(d => { setBrand(d.name); setPublicConfig(d); }).catch(() => {});
    refresh()
      .catch(() => token ? api(`/share/${token}`).then(setShare).catch(e => setError(e.message)) : setError(t('Phiên truy cập đã hết hạn. Hãy mở lại album từ trang studio.')))
      .finally(() => setLoading(false));
  }, [refresh, token]); // eslint-disable-line react-hooks/exhaustive-deps
  // Customers signed in with phone + PIN get a way back to their album list.
  useEffect(() => { if (!token) api('/customer/me').then(() => setCustomer(true)).catch(() => {}); }, [token]);
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);

  const load = useCallback(async (offset = 0) => {
    const epoch = ++generation.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({ offset: String(offset), limit: '60', search: query });
      if (folder) q.set('folder_id', folder);
      if (filterList) q.set('list_id', filterList);
      if (editOnly) q.set('edit', '1');
      if (unseenOnly) q.set('unseen', '1');
      const data = await api(`/client/photos?${q}`);
      if (epoch !== generation.current) return;
      setPhotos(v => offset ? [...v, ...data.photos] : data.photos);
      setMore(data.more);
    } catch (e: any) { setError(e.message); }
    finally { if (epoch === generation.current) setLoading(false); }
  }, [folder, filterList, editOnly, unseenOnly, query]);
  useEffect(() => { if (gallery) void load(); }, [!!gallery, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUnread = useCallback(() => api<Unread>('/client/messages/unread').then(setUnread).catch(() => {}), []);
  useEffect(() => { if (gallery) void loadUnread(); }, [!!gallery, loadUnread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPoint(null); setBody(''); }, [active?.id]);
  useEffect(() => {
    if (!active) { setNotes([]); return; }
    let cancelled = false;
    api<Message[]>(`/client/messages?photo_id=${active.id}`).then(async d => {
      if (cancelled) return;
      setNotes(d);
      // Seeing the studio's replies here counts as reading them.
      if (d.some(m => m.author_role === 'staff')) {
        await api('/client/messages/read', json('POST', { photo_id: active.id })).catch(() => {});
        if (!cancelled) void loadUnread();
      }
    }).catch(e => setError(e.message));
    return () => { cancelled = true; };
  }, [active?.id, noteRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || active.viewed) return;
    const photoID = active.id;
    api(`/client/photos/${photoID}/viewed`, json('POST', {})).then(() => setPhotos(v => v.map(p => p.id === photoID ? { ...p, viewed: true } : p))).catch(() => {});
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeID = active?.id;
  useLiveEvents(gallery ? '/client/events' : null, (e: LiveEvent) => {
    if (e.type === 'resync') { void loadUnread(); setChatRevision(v => v + 1); setNoteRevision(v => v + 1); void refresh().catch(() => {}); return; }
    if (e.type === 'message' || e.type === 'resolved') {
      if (e.author_role === 'staff') void loadUnread();
      if (chatOpen) setChatRevision(v => v + 1);
      if (e.photo_id && e.photo_id === activeID) setNoteRevision(v => v + 1);
    }
    if (e.type === 'list' || e.type === 'album' || e.type === 'edit') void refresh().catch(() => {});
    if (e.type === 'status') { void refresh().catch(() => {}); void load(); }
  });

  function openPhoto(photoID: string) {
    const photo = photos.find(p => p.id === photoID);
    if (!photo) { setNotice(t('Ảnh này chưa được tải trong danh sách hiện tại. Hãy chọn đúng thư mục hoặc tải thêm ảnh.')); return; }
    setChatOpen(false);
    setActive(photo);
  }
  const move = useCallback((delta: number) => {
    if (!active) return;
    const i = photos.findIndex(p => p.id === active.id);
    if (photos[i + delta]) { setActive(photos[i + delta]); return; }
    // Past the last loaded photo: load the next page and continue there.
    if (delta > 0 && more && !loading) { pendingNext.current = true; void load(photos.length); }
  }, [active, photos, more, loading, load]);
  useEffect(() => {
    if (!pendingNext.current || !active) return;
    const i = photos.findIndex(p => p.id === active.id);
    if (photos[i + 1]) { pendingNext.current = false; setActive(photos[i + 1]); }
  }, [photos, active]);
  useEffect(() => {
    if (!active) return;
    const handle = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') setActive(null);
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    document.addEventListener('keydown', handle);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = old; };
  }, [active, move]);

  async function action(fn: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  // Hearts update optimistically and only lock the photo being changed, so fast tapping through a grid stays smooth.
  async function heart(photo: Photo) {
    if (!listID || hearting.has(photo.id)) return;
    const list = listID, value = !photo.selected_in.includes(list);
    const apply = (on: boolean) => {
      const update = (p: Photo) => p.id === photo.id ? { ...p, selected_in: on ? [...p.selected_in.filter(i => i !== list), list] : p.selected_in.filter(i => i !== list) } : p;
      setPhotos(v => v.map(update)); setActive(v => v ? update(v) : v);
      setGallery(g => g && { ...g, lists: g.lists.map(l => l.id === list ? { ...l, count: Math.max(0, l.count + (on ? 1 : -1)) } : l) });
    };
    setHearting(v => new Set(v).add(photo.id)); apply(value); setError('');
    try { await api(`/client/lists/${list}/photos/${photo.id}`, json('PUT', { selected: value })); }
    catch (e: any) { apply(!value); setError(e.message); }
    finally { setHearting(v => { const n = new Set(v); n.delete(photo.id); return n; }); }
  }
  // Second tier: up to max_edit photos chosen for retouching. Optimistic like hearts.
  async function editPick(photo: Photo) {
    if (!project || editing.has(photo.id)) return;
    const value = !photo.edit_pick;
    if (value && project.edit_count >= project.max_edit) { setError(t('Bạn chỉ được chọn tối đa {n} ảnh để chỉnh sửa. Bỏ chọn một ảnh khác trước.', { n: project.max_edit })); return; }
    const apply = (on: boolean) => {
      const update = (p: Photo) => p.id === photo.id ? { ...p, edit_pick: on } : p;
      setPhotos(v => v.map(update)); setActive(v => v ? update(v) : v);
      setGallery(g => g && { ...g, project: { ...g.project, edit_count: Math.max(0, g.project.edit_count + (on ? 1 : -1)) } });
    };
    setEditing(v => new Set(v).add(photo.id)); apply(value); setError('');
    try { const r = await api(`/client/photos/${photo.id}/edit`, json('PUT', { selected: value })); setGallery(g => g && { ...g, project: { ...g.project, edit_count: r.edit_count } }); }
    catch (e: any) { apply(!value); setError(e.message); }
    finally { setEditing(v => { const n = new Set(v); n.delete(photo.id); return n; }); }
  }
  function toggleDownload(photoID: string) {
    setDownloadSelection(current => { const next = new Set(current); next.has(photoID) ? next.delete(photoID) : next.add(photoID); return next; });
  }
  async function download(kind: 'selected' | 'folder' | 'all', original: boolean) {
    await action(async () => {
      const payload: any = { original };
      if (kind === 'selected') payload.photo_ids = [...downloadSelection];
      if (kind === 'folder' && folder) payload.folder_id = folder;
      const data = await api('/client/downloads', json('POST', payload));
      window.location.assign(data.url);
      setDownloadOpen(false);
      setNotice(t('Đang bắt đầu tải ZIP…'));
    });
  }

  const tabs = gallery?.folders.filter(f => !f.relative_path || !gallery.folders.some(p => p.relative_path && p.id !== f.id && f.relative_path.startsWith(`${p.relative_path}/`))) || [];
  const pins = pinNumbers(notes);

  if (!gallery) return <main className="entry gallery-entry">
    <div className="entry-art"><Aperture size={48} /><p>THE MOMENTS THAT MATTER</p><h1>{t('Mỗi khoảnh khắc,')}<br />{t('một câu chuyện.')}</h1><div className="art-orbit" /><small>PRIVATE PHOTO COLLECTION</small></div>
    <section className="entry-form">
      <div className="brand"><BrandMark logoUrl={publicConfig.logoUrl} />{brand}<LangSwitch className="entry-lang" /></div>
      <span className="eyebrow">{t('DÀNH RIÊNG CHO BẠN')}</span>
      <h2>{share?.name || t('Bộ ảnh của bạn')}</h2>
      <p className="muted">{t('Xem lại những khoảnh khắc đẹp, chọn ảnh yêu thích và gửi lời nhắn cho studio.')}</p>
      {error && <p role="alert" className="alert">{error}</p>}
      {loading ? <LoaderCircle className="spin" /> : share && <form onSubmit={e => { e.preventDefault(); void action(async () => { await api(`/share/${token}/unlock`, json('POST', { name, password })); await refresh(); }); }}>
        <label>{t('Tên của bạn')}<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder={t('Để studio biết ai đang chọn ảnh')} /></label>
        {share.password_required && <label>{t('PIN / Mật khẩu')}<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>}
        <button className="primary wide" disabled={busy}>{t('Mở bộ ảnh')} <ArrowRight size={18} /></button>
      </form>}
      <a className="entry-back" href="/">{t('← Về trang studio')}</a>
      <small className="muted">{t('Ảnh được lưu trữ riêng tại studio.')}</small>
    </section>
  </main>;

  return <div className="gallery-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={t('Về trang studio')}><BrandMark logoUrl={publicConfig.logoUrl} />{brand}</a>
      {customer && <a className="gallery-back" href="/"><ArrowLeft size={14} />{t('Album của tôi')}</a>}
      <span className="private-label"><span className="status-dot" /> {t('BỘ ẢNH RIÊNG TƯ')}</span>
      <LangSwitch />
      <div className="avatar" title={gallery.client}>{gallery.client.slice(0, 1).toUpperCase()}</div>
    </header>

    <section className="collection-intro">
      <div>
        <span className="eyebrow">{t('BỘ SƯU TẬP CỦA BẠN')}</span>
        <h1>{gallery.project.name}</h1>
        <p>{t(publicConfig.welcomeMessage || 'Những khoảnh khắc của bạn. Những lựa chọn của bạn.')}</p>
        {publicConfig.studioName && <small className="muted">{publicConfig.studioName}</small>}
        <div className="album-status-row">
          <span className={`album-status ${gallery.project.status}`}>{t(STATUS_TEXT[gallery.project.status])}</span>
          {gallery.project.due_at && <span className="pill"><CalendarClock size={14} />{t('Dự kiến trả ảnh {date}', { date: date(gallery.project.due_at) })}</span>}
        </div>
        {gallery.project.client_message && <p className="studio-message"><Sparkles size={15} />{gallery.project.client_message}</p>}
        {publicConfig.contactEmail && <a className="contact-link" href={`mailto:${publicConfig.contactEmail}`}>{t('Liên hệ studio')}</a>}
      </div>
      <div className="intro-actions">
        <span className="pill"><Heart size={15} />{t('{n} yêu thích', { n: selected?.count || 0 })}</span>
        <span className="pill"><CheckSquare size={15} />{t('{n} chọn tải', { n: downloadSelection.size })}</span>
        {gallery.downloads && <button className="primary" onClick={() => setDownloadOpen(true)}><ArrowDownToLine size={17} />{t('Tải xuống')}</button>}
      </div>
    </section>

    <div className="gallery-toolbar">
      <nav className="tabs" aria-label={t('Thư mục ảnh')}>
        {gallery.final_folder && <button className={`final-tab ${folder === gallery.final_folder.id ? 'active' : ''}`} onClick={() => { setFolder(gallery.final_folder!.id); setView('all'); }}><Sparkles size={14} />{t('Ảnh hoàn thiện')}</button>}
        <button className={!folder ? 'active' : ''} onClick={() => setFolder('')}>{t('Tất cả ảnh')}</button>
        {tabs.map(f => <button className={folder === f.id ? 'active' : ''} key={f.id} onClick={() => setFolder(f.id)}>{f.name.replace(/^\d+[_ ]*/, '').replaceAll('_', ' ')}</button>)}
      </nav>
      <div className="selection-controls">
        <div className="select-wrap"><Heart size={15} />
          <select aria-label={t('Danh sách chọn ảnh')} value={listID} onChange={e => setListID(e.target.value)}>{gallery.lists.map(l => <option value={l.id} key={l.id}>{t(l.name)} ({l.count})</option>)}</select>
          <ChevronDown size={14} /></div>
        <button className="icon-button" title={t('Tạo danh sách')} aria-label={t('Tạo danh sách')} onClick={() => setNewList(true)}><Plus size={19} /></button>
      </div>
    </div>

    <div className="filter-row">
      <div className="filter-left">
        <button className={`chip ${favorites ? 'selected' : ''}`} onClick={() => setView(favorites ? 'all' : 'favorites')}><Heart size={14} fill={favorites ? 'currentColor' : 'none'} />{t('Ảnh yêu thích')}</button>
        {editMode && <button className={`chip ${editOnly ? 'selected' : ''}`} onClick={() => setView(editOnly ? 'all' : 'edit')}><PenLine size={14} />{t('Chọn edit {n}/{max}', { n: project!.edit_count, max: project!.max_edit })}</button>}
        <button className={`chip ${unseenOnly ? 'selected' : ''}`} onClick={() => setView(unseenOnly ? 'all' : 'unseen')}><Eye size={14} />{t('Chưa xem')}</button>
        <span className="muted small">{t('{n} ảnh', { n: `${photos.length}${more ? '+' : ''}` })}</span>
        {locked && <span className="submitted"><CheckCheck size={14} />{t(STATUS_TEXT[project!.status])}</span>}
      </div>
      <label className="search-box"><Search size={17} /><input aria-label={t('Tìm tên file')} placeholder={t('Tìm tên file…')} value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>

    {error && <div role="alert" className="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label={t('Đóng thông báo')}><X size={16} /></button></div>}

    <main className="photo-area">
      {photos.length === 0 && !loading ? <div className="empty">
        <ImageIcon size={36} />
        <h3>{t(favorites ? 'Chưa có ảnh trong danh sách' : editOnly ? 'Chưa chọn ảnh chỉnh sửa' : unseenOnly ? 'Bạn đã xem hết ảnh' : 'Chưa có ảnh để hiển thị')}</h3>
        <p>{t(favorites ? 'Chạm trái tim trên ảnh bạn yêu thích.' : editOnly ? 'Chạm biểu tượng bút trên ảnh để chọn ảnh cần chỉnh sửa.' : unseenOnly ? 'Mọi ảnh trong mục này đều đã được mở.' : 'Studio có thể đang đồng bộ ảnh. Hãy thử tải lại.')}</p>
        <button onClick={() => void load()}>{t('Tải lại')}</button>
      </div> : <div className="masonry">{photos.map((photo, index) => <article className={`photo-card ${downloadSelection.has(photo.id) ? 'download-selected' : ''}`} key={photo.id}>
        <button className="photo-open" onClick={() => setActive(photo)} aria-label={t('Xem {name}', { name: photo.filename })}>
          {photo.status === 'ready'
            ? <img src={`/api/client/photos/${photo.id}/thumb`} alt={photo.filename} loading={index < 8 ? 'eager' : 'lazy'} width={photo.width} height={photo.height} />
            : <div className="photo-placeholder"><ImageIcon /><span>{t(photo.status === 'failed' ? 'Preview chưa hỗ trợ' : 'Đang xử lý…')}</span></div>}
        </button>
        <button className={`download-check ${downloadSelection.has(photo.id) ? 'checked' : ''}`} aria-label={t('Chọn {name} để tải', { name: photo.filename })} aria-pressed={downloadSelection.has(photo.id)} onClick={() => toggleDownload(photo.id)}>
          {downloadSelection.has(photo.id) ? <CheckSquare size={19} /> : <Square size={19} />}</button>
        {editMode && !inFinal && <button disabled={editing.has(photo.id) || locked} className={`edit-button ${photo.edit_pick ? 'picked' : ''}`} aria-label={t('Chọn chỉnh sửa {name}', { name: photo.filename })} aria-pressed={photo.edit_pick} onClick={() => void editPick(photo)}><PenLine size={17} /></button>}
        {!inFinal && <button disabled={hearting.has(photo.id) || locked || !!selected?.submitted_at} className={`heart-button ${photo.selected_in.includes(listID) ? 'hearted' : ''}`} aria-label={t('Yêu thích {name}', { name: photo.filename })} aria-pressed={photo.selected_in.includes(listID)} onClick={() => void heart(photo)}>
          <Heart size={19} fill={photo.selected_in.includes(listID) ? 'currentColor' : 'none'} /></button>}
        <div className="photo-caption">
          <span>
            {!photo.viewed && <i className="unseen-dot" title={t('Chưa xem')} />}
            {isVideo(photo) && <span className="media-badge">▶ VIDEO</span>}
            {photo.raw_pair && <span className="media-badge raw" title={t('Có kèm file RAW')}>RAW</span>}
            {photo.filename}
          </span>
          {photo.comments > 0 && <span className={unread.photos[photo.id] ? 'has-reply' : ''} title={unread.photos[photo.id] ? t('Studio vừa trả lời') : undefined}><MessageCircle size={12} />{photo.comments}</span>}
        </div>
      </article>)}</div>}
      {loading && <div className="loading"><LoaderCircle className="spin" />{t('Đang tải bộ ảnh…')}</div>}
      {more && !loading && <button className="load-more" onClick={() => void load(photos.length)}>{t('Xem thêm ảnh')} <ArrowDownToLine size={16} /></button>}
    </main>

    <footer className="proof-bar">
      <div>
        <span className="tiny-label">{t(editMode ? 'ẢNH CHỌN CHỈNH SỬA' : 'YÊU THÍCH GỬI STUDIO')}</span>
        <strong>{editMode
          ? <>{t('Chọn edit')} <span className="count-badge">{project!.edit_count}/{project!.max_edit}</span></>
          : <>{t(selected?.name || '')} <span className="count-badge">{selected?.count || 0}</span></>}</strong>
      </div>
      <div className="proof-actions">
        <button className="text-button" onClick={() => void action(async () => { const d = await api(`/client/lists/${listID}/export`); setExportText(d.search_string); })}><Copy size={16} /><span>{t('Export tên ảnh')}</span></button>
        <button className="text-button" onClick={() => { setAlbumNote(project!.customer_note || ''); setNoteOpen(true); }}><NotebookPen size={16} /><span>{t('Ghi chú chung')}</span></button>
        {locked
          ? <span className={`album-status ${project!.status}`}>{t(STATUS_TEXT[project!.status])}</span>
          : <button className="primary" disabled={busy} onClick={() => setSubmitOpen(true)}><Send size={16} />{t('Gửi studio')}</button>}
      </div>
    </footer>

    <ClientChat open={chatOpen} unread={unread.total} revision={chatRevision} onOpen={() => setChatOpen(true)} onClose={() => setChatOpen(false)} onRead={() => setUnread(u => ({ ...u, total: 0, chat: 0, photos: {} }))} onOpenPhoto={openPhoto} />
    {notice && <div role="status" className="toast"><Check size={16} />{notice}</div>}

    {active && <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('Xem ảnh và ghi chú')}>
      <header>
        <div><strong>{active.filename}</strong><span className="muted small">{t(isVideo(active) ? 'Phát video và gửi ghi chú cho studio' : 'Chạm vào ảnh để ghim ghi chú')}</span></div>
        <div className="row">
          <button className="icon-button" onClick={() => move(-1)} aria-label={t('Ảnh trước')}><ArrowLeft /></button>
          <button className="icon-button" onClick={() => move(1)} aria-label={t('Ảnh tiếp')}><ArrowRight /></button>
          <button className="icon-button" onClick={() => setActive(null)} aria-label={t('Đóng ảnh')}><X /></button>
        </div>
      </header>
      <div className="lightbox-main">
        <section className="lightbox-stage">
          {active.status === 'ready' && isVideo(active)
            ? <video key={active.id} className="media-player" controls playsInline preload="metadata" poster={`/api/client/photos/${active.id}/preview`} src={`/api/client/photos/${active.id}/video`} />
            : active.status === 'ready'
              ? <div className="annotated-image" style={{ aspectRatio: `${active.width}/${active.height}` }} onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setPoint({ x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) });
                }}>
                  <img src={`/api/client/photos/${active.id}/preview`} alt={active.filename} />
                  {notes.filter(n => pins.has(n.id)).map(n => <span className={`pin ${n.resolved ? 'resolved' : ''}`} key={n.id} style={{ left: `${n.x! * 100}%`, top: `${n.y! * 100}%` }} title={n.body}>{pins.get(n.id)}</span>)}
                  {point && <span className="pin draft" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}>+</span>}
                </div>
              : <div className="empty"><ImageIcon /><p>{t('Ảnh này chưa có preview.')}</p></div>}
        </section>
        <aside className="notes-panel">
          <span className="eyebrow">{t('GHI CHÚ & TRAO ĐỔI')}</span>
          <h3>{t('Một chút hoàn thiện')}</h3>
          <p className="muted small">{t(isVideo(active) ? 'Nhập mốc thời gian và yêu cầu chỉnh sửa vào ghi chú.' : 'Chọn vị trí trên ảnh và nhắn điều bạn muốn studio chỉnh sửa.')}</p>
          {notes.map(n => n.author_role === 'staff'
            ? <div className="note studio-reply" key={n.id}><span className="note-number"><MessageCircle size={11} /></span><div><small className="note-author">{n.author_name}</small><p>{n.body}</p><small>{messageTime(n.created_at)}</small></div></div>
            : <div className="note" key={n.id}><span className="note-number">{pins.get(n.id) ?? '•'}</span><div><small className="note-author">{n.mine ? t('Bạn') : n.author_name}</small><p>{n.body}</p><small>{t(n.resolved ? 'Studio đã xử lý' : 'Đang chờ studio')} · {messageTime(n.created_at)}</small></div></div>)}
          <form onSubmit={e => {
            e.preventDefault();
            void action(async () => {
              const sent = await api<Message>('/client/messages', json('POST', { photo_id: active.id, body, ...(point && !isVideo(active) ? point : {}) }));
              setNotes(v => v.some(n => n.seq === sent.seq) ? v : [...v, sent]);
              setPhotos(v => v.map(p => p.id === active.id ? { ...p, comments: p.comments + 1 } : p));
              setPoint(null); setBody(''); setNotice(t('Đã gửi ghi chú cho studio'));
            });
          }}>
            <label>{t(isVideo(active) ? 'Ghi chú cho video (có thể ghi mốc thời gian)' : point ? 'Đã ghim vị trí trên ảnh' : 'Ghi chú cho ảnh (có thể chạm để ghim vị trí)')}
              <textarea placeholder={t('Ví dụ: Làm sáng vùng mặt một chút…')} value={body} onChange={e => setBody(e.target.value)} maxLength={2000} /></label>
            <button className="primary wide" disabled={!body.trim() || busy}><MessageCircle size={16} />{t('Gửi ghi chú')}</button>
          </form>
          <button className={`wide ${active.selected_in.includes(listID) ? 'selected' : ''}`} disabled={hearting.has(active.id) || locked || !!selected?.submitted_at} onClick={() => void heart(active)}>
            <Heart size={16} fill={active.selected_in.includes(listID) ? 'currentColor' : 'none'} />{t(active.selected_in.includes(listID) ? 'Đã yêu thích' : 'Thêm vào yêu thích')}</button>
          {editMode && <button className={`wide ${active.edit_pick ? 'selected' : ''}`} disabled={editing.has(active.id) || locked} onClick={() => void editPick(active)}>
            <PenLine size={16} />{t(active.edit_pick ? 'Đã chọn chỉnh sửa ({n}/{max})' : 'Chọn để chỉnh sửa ({n}/{max})', { n: project!.edit_count, max: project!.max_edit })}</button>}
          {error && <p className="alert">{error}</p>}
        </aside>
      </div>
    </div>}

    {submitOpen && project && <Modal title={t('Gửi lựa chọn cho studio?')} closeLabel={t('Đóng')} close={() => setSubmitOpen(false)}>
      <p>{editMode ? t('Bạn đã chọn {n}/{max} ảnh để chỉnh sửa.', { n: project.edit_count, max: project.max_edit }) : t('Danh sách "{name}" có {n} ảnh yêu thích.', { name: selected?.name || '', n: selected?.count || 0 })} {t('Sau khi gửi, lựa chọn sẽ được khoá để studio bắt đầu chỉnh sửa. Nếu cần đổi, hãy nhắn studio mở lại.')}</p>
      {editMode && project.edit_count < project.max_edit && <p className="muted small">{t('Bạn vẫn có thể chọn thêm {n} ảnh.', { n: project.max_edit - project.edit_count })}</p>}
      <button className="primary wide" disabled={busy} onClick={() => void action(async () => { await api('/client/album/submit', json('POST', {})); setSubmitOpen(false); await refresh(); setNotice(t('Đã gửi lựa chọn cho studio')); })}><Send size={16} />{t('Xác nhận gửi studio')}</button>
      {error && <p className="alert">{error}</p>}
    </Modal>}
    {noteOpen && <Modal title={t('Ghi chú chung cho cả album')} closeLabel={t('Đóng')} close={() => setNoteOpen(false)}>
      <form onSubmit={e => { e.preventDefault(); void action(async () => { await api('/client/album/note', json('PUT', { text: albumNote })); setNoteOpen(false); await refresh(); setNotice(t('Đã lưu ghi chú cho studio')); }); }}>
        <label>{t('Mong muốn chung (tông màu, phong cách, ảnh ưu tiên…)')}<textarea rows={6} maxLength={2000} value={albumNote} onChange={e => setAlbumNote(e.target.value)} placeholder={t('Ví dụ: tông màu ấm, da sáng tự nhiên, ưu tiên ảnh gia đình…')} /></label>
        <button className="primary wide" disabled={busy}>{t('Lưu ghi chú')}</button>
      </form>
      {error && <p className="alert">{error}</p>}
    </Modal>}
    {newList && <Modal title={t('Thêm danh sách chọn ảnh')} closeLabel={t('Đóng')} close={() => setNewList(false)}>
      <form onSubmit={e => { e.preventDefault(); void action(async () => { const d = await api('/client/lists', json('POST', { name: listName })); await refresh(); setListID(d.id); setNewList(false); setListName(''); }); }}>
        <label>{t('Tên danh sách')}<input autoFocus required value={listName} maxLength={160} onChange={e => setListName(e.target.value)} placeholder={t('Ảnh rửa, Ảnh đăng mạng xã hội…')} /></label>
        <button className="primary wide" disabled={busy}>{t('Tạo danh sách')}</button>
      </form>
      {error && <p className="alert">{error}</p>}
    </Modal>}
    {downloadOpen && <Modal title={t('Tải ảnh & video về thiết bị')} closeLabel={t('Đóng')} close={() => setDownloadOpen(false)}>
      <p className="muted">{t('Dấu tích chỉ dùng cho lượt tải hiện tại. Trái tim vẫn là danh sách yêu thích gửi cho studio.')}</p>
      <div className="download-options">
        <button disabled={busy || !downloadSelection.size} onClick={() => void download('selected', false)}><CheckSquare />{t('Tải {n} ảnh đang tích chọn · Bản xem (ảnh WebP / video MP4)', { n: downloadSelection.size })}</button>
        {folder && <button disabled={busy} onClick={() => void download('folder', false)}><ArrowDownToLine />{t('Tải toàn bộ tab hiện tại · Bản xem (ảnh WebP / video MP4)')}</button>}
        <button disabled={busy} onClick={() => void download('all', false)}><ImageIcon />{t('Tải tất cả ảnh được cấp quyền · Bản xem (ảnh WebP / video MP4)')}</button>
        {gallery.originals && <>
          <button disabled={busy || !downloadSelection.size} onClick={() => void download('selected', true)}><CheckSquare />{t('Tải {n} ảnh đang tích chọn · File gốc', { n: downloadSelection.size })}</button>
          {folder && <button disabled={busy} onClick={() => void download('folder', true)}><ArrowDownToLine />{t('Tải toàn bộ tab hiện tại · File gốc')}</button>}
          <button disabled={busy} onClick={() => void download('all', true)}><ImageIcon />{t('Tải tất cả · File gốc')}</button>
        </>}
      </div>
      {error && <p className="alert">{error}</p>}
    </Modal>}
    {!!exportText && <Modal title={t('Tên ảnh cho Lightroom / Bridge')} closeLabel={t('Đóng')} close={() => setExportText('')}>
      <textarea readOnly rows={6} value={exportText} />
      <button className="primary wide" onClick={() => void action(async () => { await copy(exportText); setNotice(t('Đã sao chép tên ảnh')); })}><Copy size={16} />{t('Sao chép')}</button>
      {error && <p className="alert">{error}</p>}
    </Modal>}
  </div>;
}

export function Modal({ title, children, close, wide = false, closeLabel = 'Đóng' }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean; closeLabel?: string }) {
  return <div className="modal-backdrop" onClick={close}>
    <section className={`modal ${wide ? 'modal-image-preview' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label={closeLabel}><X /></button></div>
      {children}
    </section>
  </div>;
}
