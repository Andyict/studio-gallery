"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Grid3X3,
  Heart,
  House,
  Image as ImageIcon,
  LayoutList,
  Link as LinkIcon,
  List,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, json, copy } from "@/lib/api";
import PasswordField from "./PasswordField";
import { Modal } from "./Gallery";
import SystemSettings from "./SystemSettings";
import BrandMark from "./BrandMark";
import {isVideo} from "@/lib/media";

export default function Admin() {
  const [me, setMe] = useState<any>(null),
    [username, setUsername] = useState("admin"),
    [systemOpen, setSystemOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [brand, setBrand] = useState("Studio Gallery"),
    [auth, setAuth] = useState(false),
    [checking, setChecking] = useState(true),
    [password, setPassword] = useState("");
  const [setupRequired, setSetupRequired] = useState(false),
    [setupName, setSetupName] = useState("Chủ studio"),
    [setupUsername, setSetupUsername] = useState("admin"),
    [setupPassword, setSetupPassword] = useState(""),
    [setupConfirm, setSetupConfirm] = useState("");
  const [projects, setProjects] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState("overview"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [folders, setFolders] = useState<any[]>([]),
    [links, setLinks] = useState<any[]>([]),
    [lists, setLists] = useState<any[]>([]),
    [comments, setComments] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false),
    [newName, setNewName] = useState(""),
    [directory, setDirectory] = useState(""),
    [directories, setDirectories] = useState<any[]>([]),
    [source, setSource] = useState("");
  const [shareOpen, setShareOpen] = useState(false),
    [label, setLabel] = useState("Khách hàng"),
    [pin, setPin] = useState(""),
    [customerPhone, setCustomerPhone] = useState(""),
    [expires, setExpires] = useState(""),
    [scope, setScope] = useState<string[]>([]),
    [downloads, setDownloads] = useState(true),
    [originals, setOriginals] = useState(false),
    [shareURL, setShareURL] = useState("");
  const [exportText, setExportText] = useState(""),
    [editName, setEditName] = useState(""),
    [editEditor, setEditEditor] = useState(""),
    [editNote, setEditNote] = useState(""),
    [cron, setCron] = useState(""),
    [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [selectionPhotos, setSelectionPhotos] = useState<any[] | null>(null),
    [selectionTitle, setSelectionTitle] = useState("");
  const [albumSearch, setAlbumSearch] = useState("");
  const [dashboardTab, setDashboardTab] = useState<"folders" | "shared">(
    "shared",
  );
  const [browseOnly, setBrowseOnly] = useState(false);
  const [browserPath, setBrowserPath] = useState("");
  const [folderHistory, setFolderHistory] = useState<string[]>([""]);
  const [folderHistoryIndex, setFolderHistoryIndex] = useState(0);
  const [dashboardView, setDashboardView] = useState<
    "grid" | "list" | "details"
  >("list");
  const [favoriteListId, setFavoriteListId] = useState(""),
    [favoriteView, setFavoriteView] = useState<"grid" | "list" | "details">(
      "grid",
    ),
    [favoritePhotos, setFavoritePhotos] = useState<any[]>([]);
  const [albumView, setAlbumView] = useState<"grid" | "list" | "details">(
      "grid",
    ),
    [albumPhotos, setAlbumPhotos] = useState<any[]>([]),
    [photoFolder, setPhotoFolder] = useState<any>(null);
  const project = projects.find((p) => p.id === selected);
  const visibleProjects = projects.filter((p) =>
    `${p.name} ${p.root}`
      .toLocaleLowerCase("vi")
      .includes(albumSearch.trim().toLocaleLowerCase("vi")),
  );
  const browserParts = browserPath ? browserPath.split("/") : [];
  const browserChildren = new Map<string, any>();
  if (!albumSearch.trim() && dashboardTab === "folders") {
    for (const album of projects) {
      const parts = String(album.root).split("/").filter(Boolean);
      if (
        browserParts.some((part, index) => parts[index] !== part) ||
        parts.length <= browserParts.length
      )
        continue;
      const next = parts[browserParts.length];
      const path = [...browserParts, next].join("/");
      const directAlbum = parts.length === browserParts.length + 1;
      const current = browserChildren.get(path);
      if (!current || directAlbum)
        browserChildren.set(path, {
          type: directAlbum ? "album" : "folder",
          path,
          name: next.replace(/^\d+[._ -]*/, "").replaceAll("_", " "),
          album: directAlbum ? album : null,
        });
    }
  }
  const folderEntries = [...browserChildren.values()].filter(
    (entry) => entry.type === "folder",
  );
  const dashboardAlbums =
    dashboardTab === "shared"
      ? visibleProjects.filter((p) => p.access_count > 0)
      : albumSearch.trim()
        ? visibleProjects
        : [...browserChildren.values()]
            .filter((entry) => entry.type === "album")
            .map((entry) => entry.album);
  function navigateFolder(path: string) {
    if (path === browserPath) return;
    setFolderHistory((history) => {
      const next = history.slice(0, folderHistoryIndex + 1);
      if (next[next.length - 1] !== path) next.push(path);
      setFolderHistoryIndex(next.length - 1);
      return next;
    });
    setBrowserPath(path);
  }
  function folderBack() {
    if (folderHistoryIndex <= 0) return;
    const index = folderHistoryIndex - 1;
    setFolderHistoryIndex(index);
    setBrowserPath(folderHistory[index]);
  }
  function folderForward() {
    if (folderHistoryIndex >= folderHistory.length - 1) return;
    const index = folderHistoryIndex + 1;
    setFolderHistoryIndex(index);
    setBrowserPath(folderHistory[index]);
  }
  const refresh = useCallback(async () => {
    const data = await api("/admin/projects");
    setProjects(data);
  }, []);
  const detail = useCallback(async () => {
    if (!selected) return;
    const [f, l, s, c] = await Promise.all([
      api(`/admin/projects/${selected}/folders`),
      api(`/admin/projects/${selected}/links`),
      api(`/admin/projects/${selected}/selections`),
      api(`/admin/projects/${selected}/comments`),
    ]);
    setFolders(f);
    setLinks(l);
    setLists(s);
    setComments(c);
  }, [selected]);
  useEffect(() => {
    api("/config")
      .then((d) => { setBrand(d.name); setLogoUrl(d.logoUrl); })
      .catch(() => {});
    Promise.all([
      api("/setup/status"),
      api("/admin/me").catch(() => null),
    ])
      .then(([setup, current]) => {
        setSetupRequired(Boolean(setup.required));
        if (current) {
          setMe(current);
          setAuth(true);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!auth) return;
    void refresh().catch((e) => setError(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [auth, refresh]);
  useEffect(() => {
    if (!auth || !selected) return;
    void detail().catch((e) => setError(e.message));
    const t = setInterval(() => detail().catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [auth, selected, detail]);
  useEffect(() => {
    if (project) {
      setEditName(project.name);
      setEditEditor(project.editor || "");
      setEditNote(project.internal_note || "");
      setCron(project.cron);
      setTimezone(project.timezone);
    }
  }, [project?.id]);
  useEffect(() => {
    if (tab !== "selections" || !lists.length) return;
    const target = lists.find((l) => l.id === favoriteListId) || lists[0];
    if (target.id !== favoriteListId) setFavoriteListId(target.id);
    api(`/admin/lists/${target.id}/photos`)
      .then(setFavoritePhotos)
      .catch((e) => setError(e.message));
  }, [tab, lists, favoriteListId]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function browse(value: string) {
    const data = await api(
      `/admin/directories?path=${encodeURIComponent(value)}`,
    );
    setDirectory(data.path);
    setDirectories(data.folders);
    setSource(data.path);
  }
  function notesFor(photoId: string) {
    return comments.filter((c) => c.photo_id === photoId);
  }
  async function openFolder(folder: any) {
    setPhotoFolder(folder);
    setAlbumPhotos(
      await api(
        `/admin/projects/${selected}/photos?folder_id=${encodeURIComponent(folder.id)}`,
      ),
    );
    setTab("photos");
  }
  if (!auth)
    return (
      <main className="entry manager-login">
        <section className="entry-form manager-login-card">
          <div className="brand">
            <BrandMark logoUrl={logoUrl} />
            {brand}
          </div>
          <span className="eyebrow">
            {setupRequired ? "THIẾT LẬP LẦN ĐẦU" : "STUDIO WORKSPACE"}
          </span>
          <h1>Ảnh ở studio.<br />Cảm xúc ở mọi nơi.</h1>
          <p className="muted">
            Một không gian riêng để gửi ảnh, nhận lựa chọn và hoàn thiện từng
            câu chuyện.
          </p>
          <div className="login-divider" />
          <h2>
            {setupRequired ? "Tạo tài khoản quản trị" : "Đăng nhập Studio"}
          </h2>
          {checking ? (
            <LoaderCircle className="spin" />
          ) : setupRequired ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  if (setupPassword !== setupConfirm)
                    throw new Error("Hai mật khẩu chưa khớp");
                  await api(
                    "/setup",
                    json("POST", {
                      name: setupName,
                      username: setupUsername,
                      password: setupPassword,
                    }),
                  );
                  setMe(await api("/admin/me"));
                  setSetupRequired(false);
                  setAuth(true);
                  setSetupPassword("");
                  setSetupConfirm("");
                });
              }}
            >
              <div className="setup-intro">
                <ShieldCheck size={18} />
                <span>
                  Tài khoản này có toàn quyền quản lý studio và chỉ được tạo
                  một lần.
                </span>
              </div>
              <label>
                Tên hiển thị
                <input
                  required
                  autoFocus
                  autoComplete="name"
                  maxLength={100}
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                />
              </label>
              <label>
                Tên đăng nhập
                <input
                  required
                  autoComplete="username"
                  minLength={3}
                  maxLength={40}
                  pattern="[a-z0-9][a-z0-9._-]{2,39}"
                  title="Dùng chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value.toLowerCase())}
                />
              </label>
              <label>
                Mật khẩu
                <PasswordField
                  type="password"
                  required
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                />
                <small>Dùng ít nhất 8 ký tự.</small>
              </label>
              <label>
                Nhập lại mật khẩu
                <PasswordField
                  type="password"
                  required
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                />
              </label>
              <button className="primary wide" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}
                Tạo tài khoản & vào Studio
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await api(
                    "/admin/login",
                    json("POST", { username, password }),
                  );
                  setMe(await api("/admin/me"));
                  setAuth(true);
                  setPassword("");
                });
              }}
            >
              <label>
                Tên đăng nhập
                <input
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label>
                Mật khẩu
                <PasswordField
                  autoFocus
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button className="primary wide" disabled={busy}>
                Vào studio <ArrowRight size={18} />
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          <div className="entry-security">
            <ShieldCheck size={16} />
            {setupRequired
              ? "Cửa sổ này tự khóa sau khi tạo tài khoản."
              : "Lưu trữ trên NAS của bạn. Không qua cloud."}
          </div>
        </section>
      </main>
    );
  return (
    <div
      className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside className="sidebar">
        <a className="brand" href="/manager">
          <BrandMark logoUrl={logoUrl} />
          {brand}
        </a>
        <span className="tiny-label">WORKSPACE</span>
        <button
          className={`nav-item ${!systemOpen && !selected && dashboardTab === "folders" ? "active" : ""}`}
          onClick={() => {
            setSystemOpen(false);
            setDashboardTab("folders");
            setBrowseOnly(true);
            setAlbumSearch("");
            setSelected("");
          }}
        >
          <FolderOpen size={18} />
          Duyệt thư mục
        </button>
        <button
          className={`nav-item ${!systemOpen && !selected && dashboardTab === "shared" ? "active" : ""}`}
          onClick={() => {
            setSystemOpen(false);
            setDashboardTab("shared");
            setBrowseOnly(false);
            setBrowserPath("");
            setAlbumSearch("");
            setSelected("");
          }}
        >
          <LinkIcon size={18} />
          Quản lý album
          <span className="nav-count">
            {projects.filter((p) => p.access_count > 0).length}
          </span>
        </button>
        <button
          className={`nav-item ${systemOpen && settingsTab === "source" ? "active" : ""}`}
          onClick={() => {
            setSettingsTab("source");
            setSystemOpen(true);
          }}
        >
          <Server size={18} />
          Quản lý nguồn ảnh
        </button>
        <button
          className={`nav-item ${systemOpen && settingsTab !== "source" ? "active" : ""}`}
          onClick={() => {
            setSettingsTab("general");
            setSystemOpen(true);
          }}
        >
          <Settings size={18} />
          Cài đặt & nhân viên
        </button>
        <div className="sidebar-bottom">
          <div className="nas-status">
            <Server size={20} />
            <div>
              <strong>NAS Storage</strong>
              <small>
                <span className="status-dot" />
                Ảnh gốc chỉ đọc
              </small>
            </div>
          </div>
          <button
            className="nav-item sidebar-collapse"
            aria-label={
              sidebarCollapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"
            }
            title={sidebarCollapsed ? "Mở rộng" : "Thu gọn"}
            onClick={() => setSidebarCollapsed((v) => !v)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
            <span>{sidebarCollapsed ? "Mở rộng menu" : "Thu gọn menu"}</span>
          </button>
          <button
            className="nav-item"
            onClick={() =>
              void action(async () => {
                await api("/logout", json("POST", {}));
                setAuth(false);
              })
            }
          >
            <LogOut size={17} />
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-top">
          <span>
            Studio <ChevronRight size={14} />{" "}
            {systemOpen
              ? "Cài đặt"
              : project?.name ||
                (dashboardTab === "folders" ? "Duyệt thư mục" : "Quản lý album")}
          </span>
          <div className="row">
            <span className="muted small">{me?.name || "Studio"}</span>
            <div className="avatar" aria-hidden="true">{(me?.name || "Studio").slice(0, 1).toUpperCase()}</div>
          </div>
        </header>
        <button
          className="mobile-settings button"
          onClick={() => setSystemOpen(!systemOpen)}
        >
          <Settings size={16} />
          {systemOpen ? "Quay lại bộ ảnh" : "Cài đặt & tài khoản"}
        </button>
        {systemOpen && me ? (
          <>
            <div className="album-explorer-nav dashboard-explorer-nav settings-explorer-nav">
              <div className="explorer-actions">
                <button title="Quay lại" aria-label="Quay lại" onClick={() => setSystemOpen(false)}><ArrowLeft size={17} /></button>
                <button title="Tiến tới" aria-label="Tiến tới" disabled><ArrowRight size={17} /></button>
                <button title="Lên một cấp" aria-label="Lên một cấp" onClick={() => setSystemOpen(false)}><ArrowUp size={17} /></button>
                <button
                  title="Trang chủ"
                  aria-label="Trang chủ"
                  onClick={() => {
                    setSystemOpen(false);
                    setSelected("");
                    setDashboardTab("shared");
                    setBrowseOnly(false);
                  }}
                ><House size={17} /></button>
              </div>
              <div className="explorer-address" aria-label="Đường dẫn hiện tại">
                <Settings size={15} />
                <button onClick={() => setSystemOpen(false)}>Studio</button>
                <span><ChevronRight size={13} /><button>Cài đặt</button></span>
                <span><ChevronRight size={13} /><button className="current">{settingsTab === "source" ? "Quản lý nguồn ảnh" : "Cài đặt & nhân viên"}</button></span>
              </div>
            </div>
            <section className="admin-heading">
              <div>
                <span className="eyebrow">STUDIO SETTINGS</span>
                <h1>
                  {settingsTab === "source"
                    ? "Quản lý nguồn ảnh"
                    : "Cài đặt & nhân viên"}
                </h1>
                <p className="muted">
                  {settingsTab === "source"
                    ? "Thêm hoặc thay đổi thư mục gốc; album sẽ tự tạo khi quét."
                    : "Thiết lập không gian làm việc và quyền truy cập cho đội ngũ."}
                </p>
              </div>
              <button onClick={() => setSystemOpen(false)}>Về bộ ảnh</button>
            </section>
            <SystemSettings
              me={me}
              initialTab={settingsTab}
              onSaved={() => {
                api("/config").then((d) => setBrand(d.name));
              }}
            />
          </>
        ) : (
          <>
            <section
              className={`admin-heading ${!project ? "dashboard-heading" : "album-heading"}`}
            >
              <div>
                <span className="eyebrow">STUDIO COLLECTIONS</span>
                <h1>{project?.name || "Tổng quan Studio"}</h1>
                <p className="muted">
                  Theo dõi toàn bộ album, khách hàng, lựa chọn và công việc cần
                  xử lý.
                </p>
              </div>
              <button
                className="primary"
                onClick={() => {
                  setSettingsTab("source");
                  setSystemOpen(true);
                }}
              >
                <Server size={17} />
                Quản lý nguồn ảnh
              </button>
            </section>
            {error && (
              <div role="alert" className="alert">
                {error}
                <button
                  className="icon-button"
                  aria-label="Đóng thông báo"
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {project && (
              <section className="stat-grid album-stats">
                <Stat
                  label="ẢNH TRONG ALBUM"
                  value={project.photo_count || 0}
                  icon={<ImageIcon />}
                  detail={`${project.ready_count || 0} preview sẵn sàng`}
                />
                <Stat
                  label="ẢNH YÊU THÍCH"
                  value={lists.reduce((n, l) => n + l.count, 0)}
                  icon={<Heart />}
                  detail={`${lists.length} danh sách từ khách`}
                />
                <Stat
                  label="KHÁCH ĐƯỢC CẤP QUYỀN"
                  value={
                    links.filter(
                      (l) =>
                        !l.revoked &&
                        (!l.expires_at || new Date(l.expires_at) > new Date()),
                    ).length
                  }
                  icon={<LinkIcon />}
                  detail="Quyền còn hiệu lực"
                />
                <Stat
                  label="GHI CHÚ CHƯA XỬ LÝ"
                  value={comments.filter((c) => !c.resolved).length}
                  icon={<MessageCircle />}
                  detail={`${comments.filter((c) => c.resolved).length} đã hoàn tất`}
                />
              </section>
            )}
            {!project ? (
              <>
                <section className="manager-summary">
                  <Stat
                    label="TỔNG ALBUM"
                    value={projects.length}
                    icon={<FolderOpen />}
                    detail="Được tạo từ thư mục Studio"
                  />
                  <Stat
                    label="TỔNG ẢNH"
                    value={projects.reduce((n, p) => n + p.photo_count, 0)}
                    icon={<ImageIcon />}
                    detail="Ảnh đang có trên NAS"
                  />
                  <Stat
                    label="ẢNH KHÁCH ĐÃ TIM"
                    value={projects.reduce((n, p) => n + p.favorite_count, 0)}
                    icon={<Heart />}
                    detail={`${projects.reduce((n, p) => n + p.submitted_count, 0)} danh sách đã chốt`}
                  />
                  <Stat
                    label="GHI CHÚ CẦN XỬ LÝ"
                    value={projects.reduce(
                      (n, p) => n + p.open_comment_count,
                      0,
                    )}
                    icon={<MessageCircle />}
                    detail="Trên tất cả album"
                  />
                </section>
                <section className="panel album-dashboard-panel">
                  <div className="album-explorer-nav dashboard-explorer-nav">
                    <div className="explorer-actions">
                      <button title="Quay lại" aria-label="Quay lại" disabled={dashboardTab !== "folders" || folderHistoryIndex <= 0} onClick={folderBack}><ArrowLeft size={17} /></button>
                      <button title="Tiến tới" aria-label="Tiến tới" disabled={dashboardTab !== "folders" || folderHistoryIndex >= folderHistory.length - 1} onClick={folderForward}><ArrowRight size={17} /></button>
                      <button
                        title="Lên thư mục cha"
                        aria-label="Lên thư mục cha"
                        disabled={dashboardTab !== "folders" || !browserPath}
                        onClick={() => navigateFolder(browserPath.split("/").slice(0, -1).join("/"))}
                      >
                        <ArrowUp size={17} />
                      </button>
                      <button
                        title="Trang chủ"
                        aria-label="Trang chủ"
                        onClick={() => {
                          if (dashboardTab === "folders") navigateFolder("");
                          else {
                            setAlbumSearch("");
                            setBrowserPath("");
                          }
                        }}
                      >
                        <House size={17} />
                      </button>
                    </div>
                    <div className="explorer-address" aria-label="Đường dẫn hiện tại">
                      {dashboardTab === "folders" ? <FolderOpen size={15} /> : <LinkIcon size={15} />}
                      {dashboardTab === "shared" ? (
                        <button className="current">Quản lý album</button>
                      ) : (
                        <>
                          <button onClick={() => navigateFolder("")}>Ảnh</button>
                          {browserParts.map((part, index) => (
                            <span key={`${part}-${index}`}>
                              <ChevronRight size={13} />
                              <button
                                className={index === browserParts.length - 1 ? "current" : ""}
                                onClick={() => navigateFolder(browserParts.slice(0, index + 1).join("/"))}
                              >
                                {part.replace(/^\d+[._ -]*/, "").replaceAll("_", " ")}
                              </button>
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="panel-title album-browser-toolbar">
                    <div>
                      <h2>
                        {dashboardTab === "folders"
                          ? "Thư mục Studio"
                          : "Album đã tạo link cho khách"}
                      </h2>
                      <p className="album-results">
                        {dashboardTab === "folders" && !albumSearch.trim()
                          ? `${folderEntries.length + dashboardAlbums.length} mục`
                          : `${dashboardAlbums.length} / ${projects.length} album`}
                      </p>
                    </div>
                    <div className="album-dashboard-tools">
                      <div className="album-search">
                        <Search />
                        <input
                          aria-label="Tìm album"
                          value={albumSearch}
                          onChange={(e) => setAlbumSearch(e.target.value)}
                          placeholder="Tìm tên album hoặc đường dẫn..."
                        />
                      </div>
                      <div className="view-switch" aria-label="Kiểu xem album">
                        <button className={dashboardView === "grid" ? "active" : ""} title="Biểu tượng" aria-label="Xem album dạng biểu tượng" onClick={() => setDashboardView("grid")}><Grid3X3 size={16} /></button>
                        <button className={dashboardView === "list" ? "active" : ""} title="Danh sách" aria-label="Xem album dạng danh sách" onClick={() => setDashboardView("list")}><List size={16} /></button>
                        <button className={dashboardView === "details" ? "active" : ""} title="Chi tiết" aria-label="Xem album dạng chi tiết" onClick={() => setDashboardView("details")}><LayoutList size={16} /></button>
                      </div>
                    </div>
                  </div>
                  {folderEntries.length || dashboardAlbums.length ? (
                    <div className={`album-grid ${dashboardView}`}>
                      {dashboardTab === "folders" &&
                        !albumSearch.trim() &&
                        folderEntries.map((entry) => (
                          <button
                            className="album-card explorer-folder"
                            key={entry.path}
                            onClick={() => navigateFolder(entry.path)}
                          >
                            <div className="album-card-top"><span className="folder-icon"><Folder size={21} /></span><span className="tag">Thư mục</span></div>
                            <h3>{entry.name}</h3>
                            <small>/{entry.path}</small>
                            <div className="album-metrics"><span>{projects.filter((p) => String(p.root).startsWith(`${entry.path}/`)).length} album bên trong</span></div>
                            <div className="album-open">Mở thư mục <ChevronRight size={15} /></div>
                          </button>
                        ))}
                      {dashboardAlbums.map((p) => (
                        <AlbumCard
                          album={p}
                          key={p.id}
                          open={() => {
                            setBrowseOnly(dashboardTab === "folders");
                            setSelected(p.id);
                            setTab("overview");
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty">
                      <FolderOpen size={44} />
                      <h2>
                        {dashboardTab === "shared"
                          ? "Chưa có album được chia sẻ"
                          : projects.length
                          ? "Không tìm thấy album"
                          : "Chưa có album"}
                      </h2>
                      <p>
                        {dashboardTab === "shared"
                          ? "Album sẽ xuất hiện tại đây sau khi bạn tạo link hoặc cấp số điện thoại cho khách."
                          : projects.length
                          ? "Thử tên hoặc từ khóa khác."
                          : "Vào Quản lý nguồn ảnh, bật thư mục Studio rồi quét nguồn."}
                      </p>
                      {!projects.length && (
                        <button
                          className="primary"
                          onClick={() => {
                            setSettingsTab("source");
                            setSystemOpen(true);
                          }}
                        >
                          Thiết lập nguồn ảnh <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <>
                <div className="album-explorer-nav">
                  <div className="explorer-actions">
                    <button
                      title="Quay lại"
                      aria-label="Quay lại màn trước"
                      onClick={() => setSelected("")}
                    >
                      <ArrowLeft size={17} />
                    </button>
                    <button title="Tiến tới" aria-label="Tiến tới" disabled>
                      <ArrowRight size={17} />
                    </button>
                    <button
                      title="Lên thư mục cha"
                      aria-label="Lên thư mục cha"
                      onClick={() => {
                        const parent = String(project.root)
                          .split("/")
                          .slice(0, -1)
                          .join("/");
                        setBrowserPath(parent);
                        setDashboardTab("folders");
                        setAlbumSearch("");
                        setSelected("");
                      }}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      title="Trang chủ"
                      aria-label="Về trang chủ album"
                      onClick={() => {
                        setDashboardTab(browseOnly ? "folders" : "shared");
                        setBrowserPath("");
                        setAlbumSearch("");
                        setSelected("");
                      }}
                    >
                      <House size={17} />
                    </button>
                  </div>
                  <div className="explorer-address" aria-label="Đường dẫn album">
                    <FolderOpen size={15} />
                    <button
                      onClick={() => {
                        setDashboardTab("folders");
                        setBrowserPath("");
                        setSelected("");
                      }}
                    >
                      Ảnh
                    </button>
                    {String(project.root)
                      .split("/")
                      .filter(Boolean)
                      .map((part, index, parts) => (
                        <span key={`${part}-${index}`}>
                          <ChevronRight size={13} />
                          <button
                            className={index === parts.length - 1 ? "current" : ""}
                            onClick={() => {
                              if (index === parts.length - 1) return;
                              setBrowserPath(parts.slice(0, index + 1).join("/"));
                              setDashboardTab("folders");
                              setSelected("");
                            }}
                          >
                            {part.replace(/^\d{4}-\d{2}-\d{2}[._ -]*/, "").replaceAll("_", " ")}
                          </button>
                        </span>
                      ))}
                  </div>
                </div>
                {!browseOnly && <nav className="tabs admin-tabs">
                  {[
                    ["overview", "Tổng quan"],
                    ["photos", "Ảnh trong album"],
                    ["selections", "Ảnh khách yêu thích"],
                    ["settings", "Cài đặt album"],
                  ].map(([id, name]) => (
                    <button
                      className={tab === id ? "active" : ""}
                      onClick={() => {
                        if (id === "photos") {
                          const root =
                            folders.find((f) => !f.relative_path) || folders[0];
                          if (root) void action(() => openFolder(root));
                          else setTab(id);
                        } else setTab(id);
                      }}
                      key={id}
                    >
                      {name}
                    </button>
                  ))}
                </nav>}
                {tab === "overview" && (
                  <div className={`overview-grid ${browseOnly ? "browse-only" : ""}`}>
                    <section className="panel">
                      <div className="panel-title">
                        <h2>Thư mục trong bộ ảnh</h2>
                        <span className="pill">{folders.length} thư mục</span>
                      </div>
                      <div className="folder-list">
                        {folders.map((f) => (
                          <button
                            className="folder-row"
                            key={f.id}
                            onClick={() => void action(() => openFolder(f))}
                          >
                            <div className="folder-icon">
                              <Folder size={23} />
                            </div>
                            <div>
                              <strong>{f.name.replaceAll("_", " ")}</strong>
                              <small>{f.relative_path || "Thư mục gốc"}</small>
                            </div>
                            <span className="tag">
                              {f.relative_path ? "Mở ảnh" : "Tất cả ảnh"}
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                        {!folders.length && (
                          <p className="muted">
                            Chưa có thư mục. Đồng bộ để đọc nguồn ảnh.
                          </p>
                        )}
                      </div>
                    </section>
                    {!browseOnly && <div className="overview-side">
                      <section className="sync-card">
                        <div className="row">
                          <span className="icon-tile">
                            <RefreshCw size={20} />
                          </span>
                          <span className="tiny-label">ĐỒNG BỘ NGUỒN ẢNH</span>
                        </div>
                        <h2>
                          {project.scan?.status === "running"
                            ? "Đang đọc ảnh từ NAS"
                            : project.scan?.status === "failed"
                              ? "Cần kiểm tra nguồn ảnh"
                              : "Bộ ảnh luôn sẵn sàng"}
                        </h2>
                        <p>
                          Thêm ảnh vào thư mục trên NAS, studio sẽ tự cập nhật
                          theo lịch bạn đặt.
                        </p>
                        <div className="source-path">/{project.root}</div>
                        <div className="sync-meta">
                          <span>Trạng thái</span>
                          <strong>
                            {(
                              {
                                running: "Đang quét",
                                completed: "Đã đồng bộ",
                                failed: "Có lỗi",
                              } as any
                            )[project.scan?.status] || "Chưa quét"}
                          </strong>
                        </div>
                        <div className="sync-meta">
                          <span>Lịch quét</span>
                          <strong>{project.cron || "Thủ công"}</strong>
                        </div>
                        {project.scan?.error && (
                          <p className="alert">{project.scan.error}</p>
                        )}
                        <button
                          className="wide"
                          disabled={busy || project.scan?.status === "running"}
                          onClick={() =>
                            void action(async () => {
                              await api(
                                `/admin/projects/${selected}/sync`,
                                json("POST", {}),
                              );
                              await refresh();
                              setNotice("Đã yêu cầu đồng bộ");
                            })
                          }
                        >
                          <RefreshCw size={16} />
                          Đồng bộ ngay
                        </button>
                        {project.failed_count > 0 && (
                          <button
                            className="text-button"
                            onClick={() =>
                              void action(async () => {
                                await api(
                                  `/admin/projects/${selected}/retry`,
                                  json("POST", {}),
                                );
                                setNotice("Đã đưa preview lỗi vào hàng đợi");
                              })
                            }
                          >
                            Thử lại {project.failed_count} preview lỗi
                          </button>
                        )}
                        {project.missing_count > 0 && (
                          <p className="muted small">
                            {project.missing_count} ảnh mất nguồn; lựa chọn và
                            ghi chú vẫn được giữ.
                          </p>
                        )}
                      </section>
                      <section className="album-work-card">
                        <div className="row">
                          <span className="icon-tile"><CheckCheck size={19} /></span>
                          <div>
                            <span className="tiny-label">PHÂN CÔNG XỬ LÝ</span>
                            <h3>Editor & ghi chú</h3>
                          </div>
                        </div>
                        <label>
                          Editor phụ trách
                          <input
                            value={editEditor}
                            maxLength={120}
                            onChange={(e) => setEditEditor(e.target.value)}
                            placeholder="Ví dụ: Minh, Huyền..."
                          />
                        </label>
                        <label>
                          Ghi chú nội bộ
                          <textarea
                            value={editNote}
                            maxLength={2000}
                            rows={4}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Yêu cầu chỉnh sửa, ngày bàn giao hoặc lưu ý cho editor..."
                          />
                        </label>
                        <button
                          className="wide"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await api(
                                `/admin/projects/${selected}`,
                                json("PATCH", {
                                  name: project.name,
                                  cron: project.cron,
                                  timezone: project.timezone,
                                  editor: editEditor,
                                  internal_note: editNote,
                                }),
                              );
                              await refresh();
                              setNotice("Đã lưu editor và ghi chú nội bộ");
                            })
                          }
                        >
                          <Check size={16} /> Lưu thông tin
                        </button>
                      </section>
                      <section className="share-card">
                        <LinkIcon />
                        <h3>Sẵn sàng gửi cho khách?</h3>
                        <p>
                          Tạo một link riêng, chọn thư mục và đặt quyền tải ảnh.
                        </p>
                        <button
                          className="text-button"
                          onClick={() =>
                            void action(async () => {
                              const d = await api("/admin/defaults");
                              setDownloads(d.downloads);
                              setOriginals(d.originals);
                              setScope([]);
                              const t = new Date(
                                Date.now() + d.expiryDays * 86400000,
                              );
                              setExpires(
                                d.expiryDays
                                  ? new Date(
                                      t.getTime() -
                                        t.getTimezoneOffset() * 60000,
                                    )
                                      .toISOString()
                                      .slice(0, 16)
                                  : "",
                              );
                              setShareOpen(true);
                            })
                          }
                        >
                          Tạo link chia sẻ <ArrowUpRight size={17} />
                        </button>
                      </section>
                    </div>}
                  </div>
                )}
                {tab === "links" && (
                  <section className="panel">
                    <div className="panel-title">
                      <h2>Link chia sẻ</h2>
                      <button
                        className="primary"
                        onClick={() =>
                          void action(async () => {
                            const d = await api("/admin/defaults");
                            setDownloads(d.downloads);
                            setOriginals(d.originals);
                            setScope([]);
                            const t = new Date(
                              Date.now() + d.expiryDays * 86400000,
                            );
                            setExpires(
                              d.expiryDays
                                ? new Date(
                                    t.getTime() - t.getTimezoneOffset() * 60000,
                                  )
                                    .toISOString()
                                    .slice(0, 16)
                                : "",
                            );
                            setShareOpen(true);
                          })
                        }
                      >
                        <Plus size={16} />
                        Tạo link
                      </button>
                    </div>
                    {links.length === 0 ? (
                      <div className="empty">
                        <LinkIcon />
                        <p>
                          Chưa có link chia sẻ. Tạo link đầu tiên cho bộ ảnh.
                        </p>
                      </div>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Tên link</th>
                              <th>Phạm vi</th>
                              <th>Tải ảnh</th>
                              <th>Hạn dùng</th>
                              <th>Trạng thái</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {links.map((l) => (
                              <tr key={l.id}>
                                <td>
                                  <strong>{l.label}</strong>
                                </td>
                                <td>
                                  {l.scope === "all"
                                    ? "Toàn bộ"
                                    : "Thư mục chọn"}
                                </td>
                                <td>
                                  {l.downloads
                                    ? l.originals
                                      ? "Preview + Gốc"
                                      : "Preview"
                                    : "Không"}
                                </td>
                                <td>
                                  {l.expires_at
                                    ? new Date(l.expires_at).toLocaleDateString(
                                        "vi-VN",
                                      )
                                    : "Không giới hạn"}
                                </td>
                                <td>
                                  <span className="tag">
                                    {l.revoked
                                      ? "Đã thu hồi"
                                      : l.expires_at &&
                                          new Date(l.expires_at) < new Date()
                                        ? "Hết hạn"
                                        : "Đang hoạt động"}
                                  </span>
                                </td>
                                <td>
                                  {!l.revoked && (
                                    <button
                                      className="danger-text"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api(
                                            `/admin/links/${l.id}/revoke`,
                                            json("POST", {}),
                                          );
                                          await detail();
                                        })
                                      }
                                    >
                                      Thu hồi
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="muted small">
                      Đường dẫn bí mật chỉ hiển thị lúc tạo. Nếu mất link, hãy
                      tạo link mới.
                    </p>
                  </section>
                )}
                {tab === "photos" && (
                  <section className="panel album-photo-browser">
                    <div className="favorite-toolbar">
                      <button
                        className="icon-button"
                        title="Về thư mục"
                        onClick={() => setTab("overview")}
                      >
                        <ArrowLeft size={17} />
                      </button>
                      <div className="grow">
                        <strong>
                          {photoFolder?.name?.replaceAll("_", " ") ||
                            "Ảnh trong album"}
                        </strong>
                        <small>
                          {albumPhotos.length} ảnh · /
                          {photoFolder?.relative_path || project.root}
                        </small>
                      </div>
                      <div className="view-switch" aria-label="Chế độ xem">
                        <button
                          className={albumView === "grid" ? "active" : ""}
                          title="Biểu tượng"
                          onClick={() => setAlbumView("grid")}
                        >
                          <Grid3X3 size={16} />
                        </button>
                        <button
                          className={albumView === "list" ? "active" : ""}
                          title="Danh sách"
                          onClick={() => setAlbumView("list")}
                        >
                          <List size={16} />
                        </button>
                        <button
                          className={albumView === "details" ? "active" : ""}
                          title="Chi tiết"
                          onClick={() => setAlbumView("details")}
                        >
                          <LayoutList size={16} />
                        </button>
                      </div>
                    </div>
                    {albumPhotos.length ? (
                      <div className={`favorite-files ${albumView}`}>
                        {albumPhotos.map((photo) => (
                          <div
                            className="favorite-file"
                            key={photo.id}
                            onDoubleClick={() => {
                              setSelectionTitle(photo.filename);
                              setSelectionPhotos([photo]);
                            }}
                          >
                            {photo.status === "ready" ? (
                              <img
                                src={`/api/admin/photos/${photo.id}/thumb`}
                                alt={photo.filename}
                              />
                            ) : (
                              <div className="photo-placeholder">
                                Đang xử lý
                              </div>
                            )}
                            <div>
                              <strong>{isVideo(photo) && <span className="media-badge">▶ VIDEO </span>}{photo.filename}</strong>
                              <small>
                                {photo.favorite_count
                                  ? `♥ ${photo.favorite_count} yêu thích`
                                  : photo.status === "ready"
                                    ? "Sẵn sàng"
                                    : "Đang xử lý"}
                                {photo.open_comment_count
                                  ? ` · ${photo.open_comment_count} ghi chú`
                                  : ""}
                              </small>
                            </div>
                            <span className="album-file-folder">
                              {photo.relative_path}
                            </span>
                            <span className="favorite-detail-notes">
                              {photo.width && photo.height
                                ? `${photo.width} × ${photo.height}`
                                : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty">
                        <ImageIcon size={38} />
                        <h3>Thư mục chưa có ảnh</h3>
                        <p>Đồng bộ lại nếu bạn vừa thêm ảnh vào NAS.</p>
                      </div>
                    )}
                  </section>
                )}{" "}
                {tab === "selections" && (
                  <section className="panel favorite-explorer favorite-single">
                    <div className="favorite-main">
                      <div className="favorite-toolbar">
                        <div className="grow">
                          <strong>Ảnh yêu thích của khách</strong>
                          <small>
                            {favoritePhotos.length} ảnh ·{" "}
                            {lists.find((l) => l.id === favoriteListId)
                              ?.submitted_at
                              ? "Khách đã chốt"
                              : "Đang chọn"}
                          </small>
                        </div>
                        {lists.length > 1 && (
                          <select
                            aria-label="Danh sách yêu thích"
                            value={favoriteListId}
                            onChange={(e) => {
                              const id = e.target.value;
                              setFavoriteListId(id);
                              void action(async () =>
                                setFavoritePhotos(
                                  await api(`/admin/lists/${id}/photos`),
                                ),
                              );
                            }}
                          >
                            {lists.map((l) => (
                              <option value={l.id} key={l.id}>
                                {l.name} ({l.count})
                              </option>
                            ))}
                          </select>
                        )}
                        {favoriteListId && (
                          <>
                            <button
                              onClick={() =>
                                void action(async () => {
                                  const d = await api(
                                    `/admin/lists/${favoriteListId}/export`,
                                  );
                                  setExportText(
                                    d.search_string || "(Chưa có ảnh)",
                                  );
                                })
                              }
                            >
                              <Copy size={15} />
                              Tên ảnh
                            </button>
                            <a
                              className="button"
                              href={`/api/admin/lists/${favoriteListId}/export?format=csv`}
                            >
                              CSV
                            </a>
                          </>
                        )}
                        <div className="view-switch" aria-label="Chế độ xem">
                          <button
                            className={favoriteView === "grid" ? "active" : ""}
                            title="Biểu tượng"
                            onClick={() => setFavoriteView("grid")}
                          >
                            <Grid3X3 size={16} />
                          </button>
                          <button
                            className={favoriteView === "list" ? "active" : ""}
                            title="Danh sách"
                            onClick={() => setFavoriteView("list")}
                          >
                            <List size={16} />
                          </button>
                          <button
                            className={
                              favoriteView === "details" ? "active" : ""
                            }
                            title="Chi tiết"
                            onClick={() => setFavoriteView("details")}
                          >
                            <LayoutList size={16} />
                          </button>
                        </div>
                      </div>
                      {favoritePhotos.length ? (
                        <div className={`favorite-files ${favoriteView}`}>
                          {favoritePhotos.map((photo) => (
                            <div
                              className="favorite-file"
                              key={photo.id}
                              onDoubleClick={() => {
                                setSelectionTitle(photo.filename);
                                setSelectionPhotos([photo]);
                              }}
                            >
                              {photo.status === "ready" ? (
                                <img
                                  src={`/api/admin/photos/${photo.id}/thumb`}
                                  alt={photo.filename}
                                />
                              ) : (
                                <div className="photo-placeholder">
                                  Đang xử lý
                                </div>
                              )}
                              <div>
                                <strong>{isVideo(photo) && <span className="media-badge">▶ VIDEO </span>}{photo.filename}</strong>
                                <small>
                                  {photo.missing ? "Mất nguồn" : "Sẵn sàng"}
                                </small>
                                {notesFor(photo.id).length > 0 && (
                                  <small className="favorite-note-summary">
                                    <span className="note-count">
                                      {
                                        notesFor(photo.id).filter(
                                          (n) => !n.resolved,
                                        ).length
                                      }
                                    </span>{" "}
                                    ghi chú chưa xử lý
                                  </small>
                                )}
                              </div>
                              <div className="favorite-notes">
                                {notesFor(photo.id).length ? (
                                  notesFor(photo.id).map((note) => (
                                    <div
                                      className={`favorite-note ${note.resolved ? "resolved" : ""}`}
                                      key={note.id}
                                    >
                                      <span>{note.body}</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void action(async () => {
                                            await api(
                                              `/admin/comments/${note.id}`,
                                              json("PATCH", {
                                                resolved: !note.resolved,
                                              }),
                                            );
                                            await detail();
                                          });
                                        }}
                                      >
                                        {note.resolved ? "Mở lại" : "Xong"}
                                      </button>
                                    </div>
                                  ))
                                ) : (
                                  <span className="muted small">
                                    Không có ghi chú
                                  </span>
                                )}
                              </div>
                              <span className="favorite-detail-notes">
                                {photo.width && photo.height
                                  ? `${photo.width} × ${photo.height}`
                                  : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty">
                          <Heart size={38} />
                          <h3>Chưa có ảnh yêu thích</h3>
                          <p>Ảnh khách thả tim sẽ xuất hiện tại đây.</p>
                        </div>
                      )}
                    </div>
                  </section>
                )}{" "}
                {tab === "settings" && (
                  <section className="panel settings-panel">
                    <h2>Cài đặt bộ ảnh</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action(async () => {
                          await api(
                            `/admin/projects/${selected}`,
                            json("PATCH", { name: editName, cron, timezone }),
                          );
                          await refresh();
                          setNotice("Đã lưu cài đặt");
                        });
                      }}
                    >
                      <label>
                        Tên bộ ảnh
                        <input
                          required
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </label>
                      <label>
                        Lịch quét cron
                        <input
                          value={cron}
                          onChange={(e) => setCron(e.target.value)}
                          placeholder="0 3 * * *"
                        />
                        <small className="muted">
                          Ví dụ: 0 3 * * * = 03:00 mỗi ngày. Để trống nếu chỉ
                          quét thủ công.
                        </small>
                      </label>
                      <label>
                        Múi giờ
                        <input
                          required
                          value={timezone}
                          onChange={(e) => setTimezone(e.target.value)}
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        Lưu cài đặt
                      </button>
                    </form>
                  </section>
                )}
              </>
            )}
          </>
        )}
        <footer className="admin-footer">
          <Aperture size={15} />
          {brand}
          <span>Lưu giữ riêng tư. Chia sẻ có chọn lọc.</span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {createOpen && (
        <Modal title="Thêm bộ ảnh từ NAS" close={() => setCreateOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const d = await api(
                  "/admin/projects",
                  json("POST", { name: newName, root: source }),
                );
                await refresh();
                setSelected(d.id);
                setCreateOpen(false);
                setNewName("");
                setTab("overview");
                setSystemOpen(false);
              });
            }}
          >
            <label>
              Tên bộ ảnh
              <input
                autoFocus
                required
                value={newName}
                maxLength={160}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Tuấn & An · Ngày chung đôi"
              />
            </label>
            <label>Thư mục nguồn</label>
            <div className="directory-browser">
              <div className="directory-path">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Thư mục cha"
                  disabled={!directory}
                  onClick={() =>
                    void action(() =>
                      browse(directory.split("/").slice(0, -1).join("/")),
                    )
                  }
                >
                  <ArrowLeft size={16} />
                </button>
                <code>/{directory}</code>
              </div>
              {directories.map((d) => (
                <button
                  type="button"
                  className="directory-item"
                  key={d.path}
                  onClick={() => void action(() => browse(d.path))}
                >
                  <Folder size={17} />
                  {d.name}
                  <ChevronRight size={15} />
                </button>
              ))}
              {!directories.length && (
                <p className="muted small">Không có thư mục con.</p>
              )}
            </div>
            <p className="muted small">Sẽ dùng thư mục đang mở: /{source}</p>
            <button className="primary wide" disabled={busy}>
              Tạo bộ ảnh & đồng bộ
            </button>
          </form>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
      {shareOpen && (
        <Modal
          title="Cấp quyền truy cập album"
          close={() => setShareOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const d = await api(
                  `/admin/projects/${selected}/links`,
                  json("POST", {
                    label,
                    password: pin,
                    phone: customerPhone,
                    folder_ids: scope,
                    downloads,
                    originals,
                    expires_at: expires
                      ? new Date(expires).toISOString()
                      : null,
                  }),
                );
                setShareURL(d.url);
                setShareOpen(false);
                setPin("");
                await detail();
              });
            }}
          >
            <label>
              Tên khách hàng / nhóm khách
              <input
                required
                value={label}
                maxLength={160}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Số điện thoại khách
              <input
                required
                inputMode="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="090 123 4567"
              />
            </label>
            <p className="muted small">
              Khách chỉ cần nhập số điện thoại này tại trang chủ studio.
            </p>
            <div className="form-grid">
              <label>
                PIN cho link trực tiếp
                <PasswordField
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Không bắt buộc"
                />
              </label>
              <label>
                Hết hạn lúc
                <input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </label>
            </div>
            <label>
              Thư mục được xem{" "}
              <small className="muted">Không chọn = toàn bộ bộ ảnh</small>
            </label>
            <div className="scope-list">
              {folders.map((f) => (
                <label className="check-label" key={f.id}>
                  <input
                    type="checkbox"
                    checked={scope.includes(f.id)}
                    onChange={(e) =>
                      setScope((v) =>
                        e.target.checked
                          ? [...v, f.id]
                          : v.filter((x) => x !== f.id),
                      )
                    }
                  />
                  {f.relative_path || "Toàn bộ cây thư mục"}
                </label>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={downloads}
                onChange={(e) => setDownloads(e.target.checked)}
              />
              Cho tải preview
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={originals}
                disabled={!downloads}
                onChange={(e) => setOriginals(e.target.checked)}
              />
              Cho tải file gốc JPG / RAW
            </label>
            <button className="primary wide" disabled={busy}>
              Tạo quyền truy cập <LinkIcon size={16} />
            </button>
          </form>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
      {!!shareURL && (
        <Modal title="Link đã sẵn sàng" close={() => setShareURL("")}>
          <p className="muted">
            Lưu link này trước khi đóng. Bạn có thể thu hồi quyền bất cứ lúc
            nào.
          </p>
          <textarea readOnly value={shareURL} rows={3} />
          <div className="row">
            <button
              className="primary"
              onClick={() =>
                void action(async () => {
                  await copy(shareURL);
                  setNotice("Đã sao chép link");
                })
              }
            >
              <Copy size={16} />
              Sao chép
            </button>
            <a
              className="button"
              href={shareURL}
              target="_blank"
              rel="noreferrer"
            >
              Mở gallery <ArrowUpRight size={16} />
            </a>
          </div>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
      {!!exportText && (
        <Modal title="Tên ảnh cho editor" close={() => setExportText("")}>
          <textarea readOnly value={exportText} rows={6} />
          <button
            className="primary"
            onClick={() =>
              void action(async () => {
                await copy(exportText);
                setNotice("Đã sao chép");
              })
            }
          >
            <Copy size={16} />
            Sao chép
          </button>
          {error && <p className="alert">{error}</p>}
        </Modal>
      )}
      {selectionPhotos && (
        <Modal title={selectionTitle} close={() => setSelectionPhotos(null)}>
          <p className="muted small">
            {selectionPhotos.length} tệp trong bộ ảnh. Mỗi tệp hiển thị các ghi
            chú liên quan của khách.
          </p>
          <div className="selected-photo-grid">
            {selectionPhotos.map((photo) => (
              <div className="selected-photo" key={photo.id}>
                {photo.status === "ready" && isVideo(photo) ? (<video className="media-player" controls playsInline preload="metadata" poster={`/api/admin/photos/${photo.id}/preview`} src={`/api/admin/photos/${photo.id}/video`} />) : photo.status === "ready" ? (
                  <img
                    src={`/api/admin/photos/${photo.id}/thumb`}
                    alt={photo.filename}
                  />
                ) : (
                  <div className="photo-placeholder">Đang tạo preview</div>
                )}
                <strong>{isVideo(photo) && <span className="media-badge">▶ VIDEO </span>}{photo.filename}</strong>
                <small>
                  {photo.comment_count
                    ? `${photo.comment_count} ghi chú`
                    : photo.missing
                      ? "Mất file nguồn"
                      : "Không có ghi chú"}
                </small>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function AlbumCard({ album, open }: { album: any; open: () => void }) {
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
      <small>/{album.root}</small>
      <div className="album-metrics">
        <span>
          <strong>{album.photo_count}</strong> ảnh
        </span>
        <span>
          <strong>{album.favorite_count}</strong> đã tim
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
function Stat({
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
