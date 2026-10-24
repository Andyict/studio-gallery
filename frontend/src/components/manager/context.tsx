"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Grid3X3, LayoutList, List } from "lucide-react";
import type { LiveEvent } from "@/lib/live";
import { Modal } from "../Gallery";

export type Me = { id: string; name: string; username: string; role: string; album_scope?: string };
export type Project = Record<string, any> & { id: string; name: string; root: string; status: string; archived_at: string | null };
export type Live = { n: number; event: LiveEvent | null };

type Confirm = { title: string; body: React.ReactNode; confirm: string; danger?: boolean };
type Ctx = {
  me: Me; brand: string; isAdmin: boolean; limited: boolean;
  projects: Project[]; projectsLoaded: boolean; refresh: () => Promise<void>;
  live: Live; notify: (message: string) => void; fail: (message: string) => void;
  confirm: (options: Confirm) => Promise<boolean>;
};
const ManagerContext = createContext<Ctx | null>(null);
export function useManager() {
  const ctx = useContext(ManagerContext);
  if (!ctx) throw new Error("useManager outside the Manager");
  return ctx;
}

// Shared services for every Manager page: who is signed in, the album list, realtime revision,
// toasts and a confirmation dialog that resolves to true/false.
export function ManagerProvider({ value, children }: { value: Omit<Ctx, "confirm">; children: React.ReactNode }) {
  const [ask, setAsk] = useState<(Confirm & { resolve: (ok: boolean) => void }) | null>(null);
  const pending = useRef(ask);
  pending.current = ask;
  const confirm = useCallback((options: Confirm) => new Promise<boolean>((resolve) => {
    pending.current?.resolve(false);
    setAsk({ ...options, resolve });
  }), []);
  const answer = (ok: boolean) => { ask?.resolve(ok); setAsk(null); };
  return (
    <ManagerContext.Provider value={{ ...value, confirm }}>
      {children}
      {ask && (
        <Modal title={ask.title} close={() => answer(false)} closeLabel="Huỷ">
          <div className="confirm-body">{ask.body}</div>
          <div className="row confirm-actions">
            <button type="button" onClick={() => answer(false)}>Huỷ</button>
            <button type="button" autoFocus className={ask.danger ? "danger" : "primary"} onClick={() => answer(true)}>{ask.confirm}</button>
          </div>
        </Modal>
      )}
    </ManagerContext.Provider>
  );
}

export type View = "grid" | "list" | "details";
export function ViewSwitch({ value, onChange, label = "Kiểu xem" }: { value: View; onChange: (v: View) => void; label?: string }) {
  const options: [View, string, React.ReactNode][] = [["grid", "Lưới ảnh", <Grid3X3 key="g" size={16} />], ["list", "Danh sách", <List key="l" size={16} />], ["details", "Chi tiết", <LayoutList key="d" size={16} />]];
  return (
    <div className="view-switch" role="group" aria-label={label}>
      {options.map(([v, name, icon]) => (
        <button key={v} type="button" className={value === v ? "active" : ""} title={name} aria-label={name} aria-pressed={value === v} onClick={() => onChange(v)}>{icon}</button>
      ))}
    </div>
  );
}

// Remembers a per-viewer display preference (grid/list) across visits.
export function useStoredView(key: string): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try { const v = localStorage.getItem(`studio-view-${key}`); return v === "list" || v === "details" ? v : "grid"; } catch { return "grid"; }
  });
  return [view, (v) => { setView(v); try { localStorage.setItem(`studio-view-${key}`, v); } catch { /* private mode */ } }];
}

export const dateVN = (v?: string | null) => (v ? new Date(v).toLocaleDateString("vi-VN") : "");
export const timeVN = (v?: string | null) => (v ? new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "");
export function ago(v?: string | null) {
  if (!v) return "";
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} ngày trước`;
  return dateVN(v);
}
