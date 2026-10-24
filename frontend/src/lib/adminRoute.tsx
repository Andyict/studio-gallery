"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

// Manager pages live in the URL so F5, the browser's Back button, new tabs and shared links work.
// Navigation uses history.pushState, which Next.js syncs into usePathname/useSearchParams without
// a server round trip; app/manager/[[...path]] makes every one of these URLs load directly.
export const ALBUM_TABS = ["overview", "photos", "selections", "worklist", "links", "settings"] as const;
export type AlbumTab = (typeof ALBUM_TABS)[number];
export type AdminRoute =
  | { view: "home" }
  | { view: "folders" }
  | { view: "albums" }
  | { view: "album"; id: string; tab: AlbumTab }
  | { view: "inbox"; project: string }
  | { view: "customers" }
  | { view: "settings"; tab: string };

export function parseRoute(pathname: string): AdminRoute {
  const [, , section = "", a = "", b = ""] = pathname.replace(/\/+$/, "").split("/");
  if (section === "folders") return { view: "folders" };
  if (section === "albums" && a) return { view: "album", id: a, tab: (ALBUM_TABS as readonly string[]).includes(b) ? (b as AlbumTab) : "overview" };
  if (section === "albums") return { view: "albums" };
  if (section === "inbox") return { view: "inbox", project: a };
  if (section === "customers") return { view: "customers" };
  if (section === "settings") return { view: "settings", tab: a };
  return { view: "home" };
}

export const href = {
  home: () => "/manager",
  folders: (path = "") => `/manager/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  albums: (query = "") => `/manager/albums${query ? `?${query}` : ""}`,
  album: (id: string, tab: AlbumTab = "overview", query = "") => `/manager/albums/${id}${tab === "overview" ? "" : `/${tab}`}${query ? `?${query}` : ""}`,
  inbox: (project = "") => `/manager/inbox${project ? `/${project}` : ""}`,
  customers: () => "/manager/customers",
  settings: (tab = "") => `/manager/settings${tab ? `/${tab}` : ""}`,
};

export function go(url: string, { replace = false } = {}) {
  if (url === window.location.pathname + window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  if (!replace) window.scrollTo(0, 0);
}

export function useAdminRoute() {
  const pathname = usePathname();
  const params = useSearchParams();
  // Rewrites one query parameter of the current page (filters, search) without a new history entry.
  const setParam = useCallback((key: string, value: string, { push = false } = {}) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value); else next.delete(key);
    const query = next.toString();
    go(`${window.location.pathname}${query ? `?${query}` : ""}`, { replace: !push });
  }, []);
  return { route: parseRoute(pathname || "/manager"), params, setParam };
}

// A real link (middle-click and "open in new tab" work) that navigates in place on a plain click.
export function NavLink({ to, className, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
