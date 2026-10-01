"use client";
import { useEffect, useRef, useState } from "react";
import { api, json } from "@/lib/api";

type Conversation = { project_id: string; project_name: string; unread_count: number; last_body: string; last_message: string };
type Message = { id: string; sender_role: string; sender_name: string; body: string; created_at: string; read_at?: string };
const time = (value: string) => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z").toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
export default function AlbumInbox({ onRead, onOpenAlbum }: { onRead: () => Promise<void>; onOpenAlbum: (id: string) => void }) {
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [revision, setRevision] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const rows = await api<Conversation[]>("/admin/chats", { signal: controller.signal });
        if (!controller.signal.aborted) { setThreads(rows); setLoading(false); }
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); setLoading(false); } }
      if (!controller.signal.aborted) timer = setTimeout(load, 10000);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const rows = await api<Message[]>(`/admin/projects/${selected}/chat`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setMessages(rows);
        const unread = rows.filter(m => m.sender_role === "client" && !m.read_at);
        if (unread.length) await api(`/admin/projects/${selected}/chat/read`, { ...json("PATCH", { ids: unread.map(m => m.id) }), signal: controller.signal });
        if (controller.signal.aborted) return;
        setThreads(items => items.map(t => t.project_id === selected ? { ...t, unread_count: 0 } : t));
        if (unread.length) await onReadRef.current();
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      if (!controller.signal.aborted) timer = setTimeout(load, 5000);
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selected, revision]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [messages.length, selected]);
  const active = threads.find(t => t.project_id === selected);
  return <section className="panel album-inbox">
    <aside className="album-conversations"><h2>Tin nhắn album</h2>
      {threads.map(t => <button key={t.project_id} className={`album-conversation ${selected === t.project_id ? "active" : ""}`} onClick={() => { if (selected !== t.project_id) { setMessages([]); setError(""); setSelected(t.project_id); } }}>
        <strong>{t.project_name}</strong>{t.unread_count > 0 && <b className="nav-count">{t.unread_count}</b>}
        <span>{t.last_body}</span><time>{time(t.last_message)}</time>
      </button>)}
      {!threads.length && <p className="muted">{loading ? "Đang tải…" : "Chưa có cuộc trò chuyện."}</p>}
    </aside>
    <div className="album-conversation-content">
      {active ? <><header><strong>{active.project_name}</strong><button onClick={() => onOpenAlbum(selected)}>Mở album</button></header>
        <div className="album-message-history" role="log" aria-label={`Hội thoại ${active.project_name}`}>
          {messages.map(m => <article key={m.id} className={`album-message ${m.sender_role === "admin" ? "studio" : "client"}`}><small>{m.sender_role === "admin" ? "Studio" : m.sender_name || "Khách"}</small><p>{m.body}</p><time>{time(m.created_at)}</time></article>)}<div ref={bottom}/>
        </div>
        <form className="album-message-compose" onSubmit={async e => {
          e.preventDefault(); const body = (drafts[selected] || "").trim(); if (!body || sending) return;
          const projectId = selected; setSending(true); setError("");
          try { await api(`/admin/projects/${projectId}/chat`, json("POST", { body })); setDrafts(d => ({ ...d, [projectId]: "" })); setRevision(v => v + 1); }
          catch (e) { setError((e as Error).message); } finally { setSending(false); }
        }}><textarea aria-label="Tin nhắn gửi khách" placeholder="Nhắn cho khách…" maxLength={2000} rows={2} value={drafts[selected] || ""} disabled={sending} onChange={e => setDrafts(d => ({ ...d, [selected]: e.target.value }))}/><button className="primary" disabled={sending || !(drafts[selected] || "").trim()}>{sending ? "Đang gửi…" : "Gửi"}</button></form>
      </> : <div className="album-chat-empty">Chọn album để xem hội thoại</div>}
      {error && <p role="alert" className="alert">{error}</p>}
    </div>
  </section>;
}
