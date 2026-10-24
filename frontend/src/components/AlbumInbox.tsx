"use client";
import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, Image as ImageIcon, RotateCcw, X } from "lucide-react";
import { api, json } from "@/lib/api";
import { Message, mergeMessages, messageTime } from "@/lib/messages";

const PAGE = 100;
type Conversation = { project_id: string; project_name: string; unread_count: number; last_body: string; last_message: string };

// One conversation per album: chat messages and photo notes from both sides on one timeline.
// `revision` bumps on realtime events; a slow poll covers a dropped event stream.
export default function AlbumInbox({ revision, initialProject = "", onRead, onOpenAlbum }: {
  revision: number; initialProject?: string; onRead: () => Promise<void>; onOpenAlbum: (id: string) => void;
}) {
  const [threads, setThreads] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState(initialProject);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [hasOlder, setHasOlder] = useState(false);
  const shown = useRef("");
  const bottom = useRef<HTMLDivElement>(null);
  const latestSeq = useRef(0);
  latestSeq.current = messages.at(-1)?.seq ?? 0;
  const readUpTo = useRef<Record<string, number>>({});
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) setTick(v => v + 1); }, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<Conversation[]>("/admin/chats", { signal: controller.signal })
      .then(rows => { setThreads(rows); setLoading(false); })
      .catch(e => { if (!controller.signal.aborted) { setError((e as Error).message); setLoading(false); } });
    return () => controller.abort();
  }, [revision, tick]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    (async () => {
      try {
        // First open of a thread loads the latest page; later revisions append only newer messages.
        const known = shown.current === selected ? latestSeq.current : 0;
        const rows = await api<Message[]>(`/admin/projects/${selected}/messages?${known ? `after=${known}` : `limit=${PAGE}`}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (known) setMessages(v => mergeMessages(v, rows));
        else { setMessages(rows); setHasOlder(rows.length === PAGE); shown.current = selected; }
        const last = rows.at(-1)?.seq ?? known;
        if (document.hidden || last <= (readUpTo.current[selected] ?? 0)) return;
        readUpTo.current[selected] = last;
        await api(`/admin/projects/${selected}/messages/read`, { ...json("POST", { upto: last }), signal: controller.signal });
        setThreads(items => items.map(t => t.project_id === selected ? { ...t, unread_count: 0 } : t));
        await onReadRef.current();
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    })();
    return () => controller.abort();
  }, [selected, revision, tick]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [latestSeq.current, selected]);
  async function loadOlder() {
    try {
      const rows = await api<Message[]>(`/admin/projects/${selected}/messages?limit=${PAGE}&before=${messages[0].seq}`);
      setMessages(v => [...rows, ...v]); setHasOlder(rows.length === PAGE);
    } catch (e) { setError((e as Error).message); }
  }
  const active = threads.find(t => t.project_id === selected);
  async function resolve(m: Message) {
    setError("");
    try {
      await api(`/admin/messages/${m.id}`, json("PATCH", { resolved: !m.resolved }));
      setMessages(v => v.map(x => x.id === m.id ? { ...x, resolved: !m.resolved } : x));
    } catch (e) { setError((e as Error).message); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = (drafts[selected] || "").trim();
    if (!body || sending) return;
    const projectId = selected;
    setSending(true); setError("");
    try {
      const m = await api<Message>(`/admin/projects/${projectId}/messages`, json("POST", { body, ...(replyTo?.photo_id ? { photo_id: replyTo.photo_id } : {}) }));
      setMessages(v => mergeMessages(v, [m])); setDrafts(d => ({ ...d, [projectId]: "" })); setReplyTo(null);
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  }
  return <section className="panel album-inbox">
    <aside className="album-conversations"><h2>Tin nhắn album</h2>
      {threads.map(t => <button key={t.project_id} className={`album-conversation ${selected === t.project_id ? "active" : ""}`} onClick={() => { if (selected !== t.project_id) { setMessages([]); setHasOlder(false); shown.current = ""; setError(""); setReplyTo(null); setSelected(t.project_id); } }}>
        <strong>{t.project_name}</strong>{t.unread_count > 0 && <b className="nav-count">{t.unread_count}</b>}
        <span>{t.last_body}</span><time>{messageTime(t.last_message)}</time>
      </button>)}
      {!threads.length && <p className="muted">{loading ? "Đang tải…" : "Chưa có cuộc trò chuyện."}</p>}
    </aside>
    <div className="album-conversation-content">
      {active ? <><header><strong>{active.project_name}</strong><button onClick={() => onOpenAlbum(selected)}>Mở album</button></header>
        <div className="album-message-history" role="log" aria-label={`Hội thoại ${active.project_name}`}>
          {hasOlder && <button type="button" className="load-older" onClick={() => void loadOlder()}>Xem tin cũ hơn</button>}
          {messages.map(m => <article key={m.id} className={`album-message ${m.author_role === "staff" ? "studio" : "client"} ${m.resolved ? "resolved" : ""}`}>
            <small>{m.author_name}</small>
            {m.photo_id && <div className="message-photo"><img src={`/api/admin/photos/${m.photo_id}/thumb`} alt="" onError={e => { e.currentTarget.style.display = "none"; }} />
              <span><ImageIcon size={12} />{m.filename}{m.x != null && " · đã ghim vị trí"}</span></div>}
            <p>{m.body}</p>
            <div className="album-message-meta"><time>{messageTime(m.created_at)}</time>
              {m.photo_id && <button type="button" className="text-button" onClick={() => setReplyTo(m)}><CornerDownRight size={13} />Trả lời trên ảnh</button>}
              {m.photo_id && m.author_role === "client" && <button type="button" className="text-button" onClick={() => void resolve(m)}>
                {m.resolved ? <><RotateCcw size={13} />Mở lại</> : <><Check size={13} />Đã xử lý</>}</button>}
            </div>
          </article>)}<div ref={bottom}/>
        </div>
        <form className="album-message-compose" onSubmit={send}>
          {replyTo && <div className="reply-chip"><ImageIcon size={13} />Trả lời trên ảnh <strong>{replyTo.filename}</strong>
            <button type="button" className="icon-button" aria-label="Bỏ trả lời trên ảnh" onClick={() => setReplyTo(null)}><X size={14} /></button></div>}
          <textarea aria-label="Tin nhắn gửi khách" placeholder={replyTo ? "Trả lời ghi chú trên ảnh…" : "Nhắn cho khách…"} maxLength={2000} rows={2} value={drafts[selected] || ""} disabled={sending}
            onChange={e => setDrafts(d => ({ ...d, [selected]: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
          <button className="primary" disabled={sending || !(drafts[selected] || "").trim()}>{sending ? "Đang gửi…" : "Gửi"}</button>
        </form>
      </> : <div className="album-chat-empty">Chọn album để xem hội thoại</div>}
      {error && <p role="alert" className="alert">{error}</p>}
    </div>
  </section>;
}
