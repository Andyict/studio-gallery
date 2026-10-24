"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Aperture, Check, X } from "lucide-react";
import { api, json } from "@/lib/api";
import { useLiveEvents } from "@/lib/live";
import { go, href, NavLink, useAdminRoute } from "@/lib/adminRoute";
import AlbumInbox from "./AlbumInbox";
import NotificationBell from "./NotificationBell";
import Customers from "./Customers";
import Dashboard from "./Dashboard";
import SystemSettings from "./SystemSettings";
import AdminLogin from "./manager/AdminLogin";
import Sidebar, { AccountMenu } from "./manager/Sidebar";
import FolderBrowser from "./manager/FolderBrowser";
import AlbumList from "./manager/AlbumList";
import AlbumView from "./manager/AlbumView";
import { ManagerProvider, type Live, type Me, type Project } from "./manager/context";

// Studio Manager shell: sign-in, navigation, the shared album list and realtime events. Each page
// lives in components/manager and is chosen from the URL (lib/adminRoute).
export default function Admin() {
  const { route } = useAdminRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [expired, setExpired] = useState(false);
  const [brand, setBrand] = useState("Studio Gallery");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [live, setLive] = useState<Live>({ n: 0, event: null });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const auth = !!me;

  const loadBrand = useCallback(() => api("/config").then((d) => { setBrand(d.name); setLogoUrl(d.logoUrl); }).catch(() => {}), []);
  useEffect(() => {
    void loadBrand();
    try { setCollapsed(localStorage.getItem("studio-sidebar") === "collapsed"); } catch { /* private mode */ }
    Promise.all([api("/setup/status"), api<Me>("/admin/me").catch(() => null)])
      .then(([setup, current]) => { setSetupRequired(Boolean(setup.required)); if (current) setMe(current); })
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
  }, [loadBrand]);
  // Any 401 from the API means the session ended: show the sign-in form over the same URL.
  useEffect(() => {
    const expire = () => setMe((current) => { if (current) setExpired(true); return null; });
    window.addEventListener("studio:unauthorized", expire);
    return () => window.removeEventListener("studio:unauthorized", expire);
  }, []);

  const refresh = useCallback(async () => { setProjects(await api<Project[]>("/admin/projects")); setProjectsLoaded(true); }, []);
  useEffect(() => {
    if (!auth) return;
    void refresh().catch((e) => setError(e.message));
    // Realtime events keep the list current; this slow poll only covers a stream that dropped silently.
    const t = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 60000);
    return () => clearInterval(t);
  }, [auth, refresh]);
  useLiveEvents(auth ? "/admin/events" : null, (event) => setLive((v) => ({ n: v.n + 1, event })));
  // Bursts of events (message + notification + read) collapse into one refresh of the album list.
  useEffect(() => {
    if (!live.n) return;
    const t = setTimeout(() => refresh().catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [live.n, refresh]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(t); }, [notice]);
  // Errors belong to the page they happened on.
  const routeKey = JSON.stringify(route);
  useEffect(() => { setError(""); }, [routeKey]);

  const isAdmin = me?.role === "admin";
  const limited = !!me && !isAdmin && me.album_scope === "assigned";
  // Pages this account cannot use send it somewhere it can.
  useEffect(() => { if (limited && route.view === "folders") go(href.albums(), { replace: true }); }, [limited, route.view]);

  // "/" jumps to the search box of the current page, as in most web apps.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      const box = document.querySelector<HTMLInputElement>(".admin-main .album-search input, .admin-main .search-box input");
      if (box) { e.preventDefault(); box.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const notify = useCallback((m: string) => { setError(""); setNotice(m); }, []);
  const fail = useCallback((m: string) => setError(m), []);

  if (!me) return (
    <AdminLogin brand={brand} logoUrl={logoUrl} checking={checking} setupRequired={setupRequired} expired={expired}
      onSignedIn={(user) => {
        // After an expired session the page keeps its URL; a reload drops any data of the previous session.
        if (expired) { window.location.reload(); return; }
        setSetupRequired(false); setMe(user);
      }} />
  );

  async function logout() {
    try { await api("/logout", json("POST", {})); } catch { /* signed out anyway */ }
    window.location.assign("/manager");
  }
  const unread = projects.reduce((n, p) => n + (p.unread_message_count || 0), 0);
  const settingsTab = route.view === "settings" ? route.tab || (isAdmin ? "general" : "account") : "";
  return (
    <ManagerProvider value={{ me, brand, isAdmin, limited, projects, projectsLoaded, refresh, live, notify, fail }}>
      <div className={`admin-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
        <Sidebar route={route} brand={brand} logoUrl={logoUrl} isAdmin={isAdmin} limited={limited} unread={unread}
          albums={projects.filter((p) => !p.archived_at).length} collapsed={collapsed}
          onCollapse={() => setCollapsed((v) => { try { localStorage.setItem("studio-sidebar", v ? "open" : "collapsed"); } catch { /* private mode */ } return !v; })} />
        <main className="admin-main">
          <header className="admin-top">
            <div className="row">
              <NotificationBell revision={live.n} onOpenAlbum={(id) => go(href.album(id))} />
              <AccountMenu name={me.name || "Studio"} role={me.role} onLogout={() => void logout()} />
            </div>
          </header>
          {error && (
            <div role="alert" className="alert page-alert">
              <span>{error}</span>
              <button className="icon-button" aria-label="Đóng thông báo" onClick={() => setError("")}><X size={16} /></button>
            </div>
          )}
          {route.view === "home" && <>
            <section className="admin-heading"><div><h1>Việc cần làm</h1></div></section>
            <Dashboard revision={live.n} onOpenAlbum={(id, tab) => go(href.album(id, (tab as any) || "overview"))} onOpenInbox={(id) => go(href.inbox(id || ""))} onOpenCustomers={() => go(href.customers())} />
          </>}
          {route.view === "albums" && <AlbumList />}
          {route.view === "album" && <AlbumView key={route.id} id={route.id} tab={route.tab} />}
          {route.view === "folders" && !limited && <FolderBrowser />}
          {route.view === "inbox" && <>
            <section className="admin-heading"><div><h1>Tin nhắn</h1></div></section>
            <AlbumInbox key={route.project} revision={live.n} initialProject={route.project} onRead={refresh} onOpenAlbum={(id) => go(href.album(id))} />
          </>}
          {route.view === "customers" && <>
            <section className="admin-heading"><div><h1>Khách hàng</h1></div></section>
            <Customers onOpenAlbum={(id) => go(href.album(id))} />
          </>}
          {route.view === "settings" && <>
            <section className="admin-heading">
              <div>
                <h1>{isAdmin ? "Cài đặt & nhân viên" : "Tài khoản của tôi"}</h1>
              </div>
              <NavLink className="button" to={href.albums()}>Về album</NavLink>
            </section>
            <SystemSettings me={me} initialTab={settingsTab} onTabChange={(tab) => go(href.settings(tab), { replace: true })} onSaved={() => void loadBrand()} />
          </>}
          <footer className="admin-footer"><Aperture size={15} />{brand}<span>Lưu giữ riêng tư. Chia sẻ có chọn lọc.</span></footer>
        </main>
        {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
      </div>
    </ManagerProvider>
  );
}
