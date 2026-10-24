"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, Images, ListChecks, LogOut, MessageCircle, PanelLeftClose, PanelLeftOpen, Server, Settings, UserRound } from "lucide-react";
import { href, NavLink, type AdminRoute } from "@/lib/adminRoute";
import BrandMark from "../BrandMark";

type Props = {
  route: AdminRoute; brand: string; logoUrl: string | null; isAdmin: boolean; limited: boolean;
  unread: number; albums: number; collapsed: boolean; onCollapse: () => void;
};

// Main navigation. On phones the same links become a bottom tab bar (see manager.css).
export default function Sidebar({ route, brand, logoUrl, isAdmin, limited, unread, albums, collapsed, onCollapse }: Props) {
  const items: { to: string; icon: React.ReactNode; label: string; short: string; active: boolean; count?: number; hidden?: boolean }[] = [
    { to: href.home(), icon: <ListChecks size={18} />, label: "Việc cần làm", short: "Việc", active: route.view === "home" },
    { to: href.albums(), icon: <Images size={18} />, label: "Album", short: "Album", active: route.view === "albums" || route.view === "album", count: albums },
    { to: href.inbox(), icon: <MessageCircle size={18} />, label: "Tin nhắn", short: "Tin nhắn", active: route.view === "inbox", count: unread },
    { to: href.customers(), icon: <UserRound size={18} />, label: "Khách hàng", short: "Khách", active: route.view === "customers" },
    { to: href.folders(), icon: <FolderOpen size={18} />, label: "Thư mục NAS", short: "NAS", active: route.view === "folders", hidden: limited },
    { to: href.settings(), icon: <Settings size={18} />, label: isAdmin ? "Cài đặt & nhân viên" : "Tài khoản", short: isAdmin ? "Cài đặt" : "Tài khoản", active: route.view === "settings" },
  ];
  return (
    <aside className="sidebar">
      <NavLink className="brand" to={href.home()}><BrandMark logoUrl={logoUrl} />{brand}</NavLink>
      <nav className="sidebar-nav" aria-label="Điều hướng Studio">
        {items.filter((i) => !i.hidden).map((i) => (
          <NavLink key={i.to} to={i.to} className={`nav-item ${i.active ? "active" : ""}`} aria-current={i.active ? "page" : undefined} title={collapsed ? i.label : undefined}>
            {i.icon}
            <span className="nav-label">{i.label}</span>
            <span className="nav-short">{i.short}</span>
            {!!i.count && <span className="nav-count">{i.count > 99 ? "99+" : i.count}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="nas-status">
          <Server size={20} />
          <div><strong>Kho ảnh NAS</strong><small><span className="status-dot" />Ảnh gốc chỉ đọc</small></div>
        </div>
        <button className="nav-item sidebar-collapse" aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"} title={collapsed ? "Mở rộng" : "Thu gọn"} onClick={onCollapse}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          <span>{collapsed ? "Mở rộng menu" : "Thu gọn menu"}</span>
        </button>
      </div>
    </aside>
  );
}

// Account button in the top bar: who is signed in, their settings and sign-out.
export function AccountMenu({ name, role, onLogout }: { name: string; role: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="account-menu" ref={box}>
      <button type="button" className="account-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="muted small account-name">{name}</span>
        <span className="avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      </button>
      {open && (
        <div className="account-popover" role="menu">
          <div className="account-who"><strong>{name}</strong><small className="muted">{role === "admin" ? "Quản trị viên" : "Nhân viên"}</small></div>
          <NavLink role="menuitem" to={href.settings("account")} onClick={() => setOpen(false)}><UserRound size={15} />Tài khoản của tôi</NavLink>
          <button role="menuitem" type="button" onClick={onLogout}><LogOut size={15} />Đăng xuất</button>
        </div>
      )}
    </div>
  );
}
