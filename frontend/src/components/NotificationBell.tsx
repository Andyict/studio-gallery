"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, MessageCircle, StickyNote } from "lucide-react";
import { api, json } from "@/lib/api";
import { messageTime } from "@/lib/messages";

type Item = { seq: number; kind: string; project_id: string | null; project_name: string | null; text: string; created_at: string; new: boolean };
const icon = (kind: string) => kind === "submitted" || kind === "reopened" ? <CheckCheck size={15} /> : kind === "note" ? <StickyNote size={15} /> : <MessageCircle size={15} />;

// Studio-side activity feed: customer messages, photo notes and submitted favourite lists.
// A new item plays a short tone and, when the tab is hidden, shows a browser notification.
export default function NotificationBell({ revision, onOpenAlbum }: { revision: number; onOpenAlbum: (id: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [open, setOpen] = useState(false);
  const latest = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ items: Item[]; unseen: number }>("/admin/notifications", { signal: controller.signal }).then(d => {
      const newest = d.items[0]?.seq ?? 0;
      if (latest.current !== null && newest > latest.current) announce(d.items[0]);
      latest.current = newest;
      setItems(d.items); setUnseen(d.unseen);
    }).catch(() => {});
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  function toggle() {
    const next = !open;
    setOpen(next);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    if (next && unseen) api("/admin/notifications/seen", json("POST", {})).then(() => setUnseen(0)).catch(() => {});
    if (!next) setItems(v => v.map(i => ({ ...i, new: false })));
  }
  return <div className="notification-bell" ref={box}>
    <button className="icon-button" onClick={toggle} aria-expanded={open} aria-label={unseen ? `Thông báo, ${unseen} mới` : "Thông báo"}>
      <Bell size={18} />{unseen > 0 && <b>{unseen > 99 ? "99+" : unseen}</b>}
    </button>
    {open && <div className="notification-menu" role="menu">
      <strong>Thông báo</strong>
      {!items.length && <p className="muted small">Chưa có hoạt động nào từ khách.</p>}
      {items.map(i => <button key={i.seq} role="menuitem" className={i.new ? "new" : ""} onClick={() => { setOpen(false); if (i.project_id) onOpenAlbum(i.project_id); }}>
        {icon(i.kind)}<span><span className="notification-text">{i.text}</span><time>{messageTime(i.created_at)}</time></span>
      </button>)}
    </div>}
  </div>;
}

function announce(item: Item) {
  try {
    const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.35); osc.onended = () => void ctx.close();
  } catch { /* audio blocked until the user interacts with the page */ }
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(item.project_name || "Studio Gallery", { body: item.text, tag: `studio-${item.seq}` }); } catch { /* unsupported */ }
  }
}
