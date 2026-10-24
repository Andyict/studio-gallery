"use client";
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, MessageCircle, Send, X } from "lucide-react";
import { api, json } from "@/lib/api";
import { Message, mergeMessages, messageTime } from "@/lib/messages";
import { useI18n } from "@/lib/i18n";

const PAGE = 100;

// Customer side of the album conversation: chat with the studio plus every photo note in the
// album, in one timeline. Opening the panel marks everything read for this share link.
export default function ClientChat({ open, unread, revision, onOpen, onClose, onRead, onOpenPhoto }: {
  open: boolean; unread: number; revision: number;
  onOpen: () => void; onClose: () => void; onRead: () => void; onOpenPhoto: (photoID: string) => void;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [hasOlder, setHasOlder] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastSeq = useRef(0);
  lastSeq.current = messages.at(-1)?.seq ?? 0;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  // Opening loads the latest page; while open, realtime revisions only append newer messages.
  useEffect(() => {
    if (!open) { setMessages([]); return; }
    const controller = new AbortController();
    (async () => {
      try {
        const after = lastSeq.current;
        const rows = await api<Message[]>(`/client/messages?${after ? `after=${after}` : `limit=${PAGE}`}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (after) setMessages(v => mergeMessages(v, rows));
        else { setMessages(rows); setHasOlder(rows.length === PAGE); }
        await api("/client/messages/read", { ...json("POST", {}), signal: controller.signal });
        onReadRef.current();
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    })();
    return () => controller.abort();
  }, [open, revision]);
  useEffect(() => { if (open) bottom.current?.scrollIntoView({ block: "nearest" }); }, [open, lastSeq.current]);
  async function loadOlder() {
    try {
      const rows = await api<Message[]>(`/client/messages?limit=${PAGE}&before=${messages[0].seq}`);
      setMessages(v => [...rows, ...v]); setHasOlder(rows.length === PAGE);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError("");
    try { const m = await api<Message>("/client/messages", json("POST", { body })); setMessages(v => mergeMessages(v, [m])); setDraft(""); }
    catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  }
  return <>
    <button className="chat-launcher" onClick={open ? onClose : onOpen} aria-expanded={open} aria-label={unread ? t("Trò chuyện với studio, {n} tin mới", { n: unread }) : t("Trò chuyện với studio")}>
      <MessageCircle size={22} />{unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
    </button>
    {open && <section className="client-chat" role="dialog" aria-label={t("Trò chuyện với studio")}>
      <header><div><span className="eyebrow">{t("TRÒ CHUYỆN")}</span><strong>{t("Nhắn với studio")}</strong></div>
        <button className="icon-button" onClick={onClose} aria-label={t("Đóng trò chuyện")}><X size={18} /></button></header>
      <div className="client-chat-history" role="log" aria-live="polite">
        {hasOlder && <button type="button" className="load-older" onClick={() => void loadOlder()}>{t("Xem tin cũ hơn")}</button>}
        {!messages.length && <p className="muted small client-chat-empty">{t("Hỏi studio về lịch giao ảnh, yêu cầu chỉnh sửa hay bất cứ điều gì. Ghi chú trên từng ảnh cũng hiện ở đây.")}</p>}
        {messages.map(m => <article key={m.id} className={`album-message ${m.author_role === "staff" ? "studio" : "client"} ${m.mine ? "mine" : ""}`}>
          <small>{m.author_role === "staff" ? m.author_name : m.mine ? t("Bạn") : m.author_name}</small>
          {m.photo_id && <button type="button" className="message-photo" onClick={() => onOpenPhoto(m.photo_id!)}>
            <img src={`/api/client/photos/${m.photo_id}/thumb`} alt="" onError={e => { e.currentTarget.style.display = "none"; }} />
            <span><ImageIcon size={12} />{m.filename}</span></button>}
          <p>{m.body}</p><time>{messageTime(m.created_at)}</time>
        </article>)}
        <div ref={bottom} />
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      <form className="album-message-compose" onSubmit={send}>
        <textarea aria-label={t("Tin nhắn gửi studio")} placeholder={t("Nhắn cho studio…")} rows={2} maxLength={2000} value={draft} disabled={sending}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <button className="primary" disabled={sending || !draft.trim()} aria-label={t("Gửi")}><Send size={16} /></button>
      </form>
    </section>}
  </>;
}
