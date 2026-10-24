"use client";
import { useEffect, useState } from "react";
import { AlarmClock, ArrowDownToLine, CalendarClock, CheckCheck, ImageOff, KeyRound, MessageCircle, PenLine, StickyNote } from "lucide-react";
import { api } from "@/lib/api";

type Album = { id: string; name: string; status: string; due_at: string | null; submitted_at: string | null; max_edit: number; edit_pick_count: number; edit_done_count: number };
type Count = { id: string; name: string; n: number };
type Data = {
  submitted: Album[]; editing: Album[]; overdue: Album[]; due_soon: Album[]; unread: Count[]; open_notes: Count[]; failed: Count[];
  customers_without_pin: number; recent_downloads: { id: string; name: string; client: string; original: number; files: number; created_at: string }[];
};
const date = (v: string | null) => v ? new Date(v).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "";
const ago = (v: string) => new Date(v).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

// Studio home: what needs doing now, across the albums this account can see.
export default function Dashboard({ revision, onOpenAlbum, onOpenInbox, onOpenCustomers }: {
  revision: number; onOpenAlbum: (id: string, tab?: string) => void; onOpenInbox: (id?: string) => void; onOpenCustomers: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Data>("/admin/dashboard").then(setData).catch(e => setError((e as Error).message)); }, [revision]);
  if (!data) return <section className="panel"><p className="muted">{error || "Đang tải…"}</p></section>;
  const progress = (a: Album) => a.max_edit ? `${a.edit_done_count}/${a.edit_pick_count} ảnh đã chỉnh` : "";
  const empty = !data.submitted.length && !data.editing.length && !data.overdue.length && !data.due_soon.length && !data.unread.length && !data.open_notes.length && !data.failed.length && !data.customers_without_pin;
  return <div className="dashboard">
    {empty && <section className="panel dashboard-calm"><CheckCheck size={28} /><div><h2>Mọi việc đã xong</h2><p className="muted">Không có album chờ xử lý, tin nhắn hay ghi chú mới.</p></div></section>}
    <div className="dashboard-grid">
      <Card icon={<AlarmClock size={17} />} title="Quá hạn trả ảnh" tone="danger" items={data.overdue.map(a => ({ key: a.id, label: a.name, meta: `Hạn ${date(a.due_at)} · ${progress(a) || a.status}`, open: () => onOpenAlbum(a.id) }))} />
      <Card icon={<PenLine size={17} />} title="Khách đã gửi, chờ chỉnh sửa" tone="warn" items={data.submitted.map(a => ({ key: a.id, label: a.name, meta: `Gửi ${date(a.submitted_at)}${a.max_edit ? ` · ${a.edit_pick_count} ảnh chọn edit` : ""}${a.due_at ? ` · hạn ${date(a.due_at)}` : ""}`, open: () => onOpenAlbum(a.id, "worklist") }))} />
      <Card icon={<CalendarClock size={17} />} title="Sắp đến hạn (3 ngày)" items={data.due_soon.map(a => ({ key: a.id, label: a.name, meta: `Hạn ${date(a.due_at)}${progress(a) ? ` · ${progress(a)}` : ""}`, open: () => onOpenAlbum(a.id) }))} />
      <Card icon={<PenLine size={17} />} title="Đang chỉnh sửa" items={data.editing.map(a => ({ key: a.id, label: a.name, meta: [progress(a), a.due_at && `hạn ${date(a.due_at)}`].filter(Boolean).join(" · "), open: () => onOpenAlbum(a.id, "worklist") }))} />
      <Card icon={<MessageCircle size={17} />} title="Tin nhắn chưa đọc" items={data.unread.map(c => ({ key: c.id, label: c.name, meta: `${c.n} tin mới`, open: () => onOpenInbox(c.id) }))} />
      <Card icon={<StickyNote size={17} />} title="Ghi chú ảnh chưa xử lý" items={data.open_notes.map(c => ({ key: c.id, label: c.name, meta: `${c.n} ghi chú`, open: () => onOpenAlbum(c.id, "worklist") }))} />
      <Card icon={<ImageOff size={17} />} title="Ảnh chưa tạo được ảnh xem" items={data.failed.map(c => ({ key: c.id, label: c.name, meta: `${c.n} ảnh lỗi`, open: () => onOpenAlbum(c.id, "overview") }))} />
      {data.customers_without_pin > 0 && <section className="panel dashboard-card warn"><h3><KeyRound size={17} />Khách chưa có PIN</h3>
        <p className="small">{data.customers_without_pin} khách có link nhưng chưa đăng nhập được trang chủ.</p>
        <button className="text-button" onClick={onOpenCustomers}>Cấp PIN trong mục Khách hàng</button></section>}
      <Card icon={<ArrowDownToLine size={17} />} title="Khách vừa tải ảnh" items={data.recent_downloads.map((d, i) => ({ key: `${d.id}-${i}`, label: d.name, meta: `${d.client} · ${d.files} ${d.original ? "file gốc" : "ảnh xem"} · ${ago(d.created_at)}`, open: () => onOpenAlbum(d.id) }))} />
    </div>
  </div>;
}

function Card({ icon, title, items, tone }: { icon: React.ReactNode; title: string; tone?: "warn" | "danger"; items: { key: string; label: string; meta: string; open: () => void }[] }) {
  if (!items.length) return null;
  return <section className={`panel dashboard-card ${tone || ""}`}>
    <h3>{icon}{title}<span className="pill">{items.length}</span></h3>
    <ul>{items.map(i => <li key={i.key}><button type="button" onClick={i.open}><strong>{i.label}</strong><small>{i.meta}</small></button></li>)}</ul>
  </section>;
}
