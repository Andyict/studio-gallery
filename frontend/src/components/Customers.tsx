"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Lock, LockOpen, Plus, Search, UserRound } from "lucide-react";
import { api, copy, json } from "@/lib/api";
import { inviteMessage } from "@/lib/invite";
import { Modal } from "./Gallery";

type Customer = {
  id: string; name: string; phone_last4: string; note: string; disabled: boolean; has_pin: boolean; locked: boolean;
  created_at: string; last_login_at: string | null; albums: { link_id: string; id: string; name: string; status: string; revoked: number; expires_at: string | null }[];
};
type Issued = { customer: string; phone?: string; pin: string };

// Customer accounts (phone + PIN). Staff create accounts, issue or reset PINs, unlock after too many
// wrong attempts and disable accounts. A new PIN is shown once, with a ready-to-send message.
export default function Customers({ onOpenAlbum }: { onOpenAlbum: (id: string) => void }) {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<{ name: string; phone: string; note: string } | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [origin, setOrigin] = useState("");
  const [studio, setStudio] = useState("");
  const load = useCallback(async (q = "") => setRows(await api<Customer[]>(`/admin/customers?search=${encodeURIComponent(q)}`)), []);
  useEffect(() => { setOrigin(window.location.origin); api("/config").then(c => setStudio(c.studioName || c.name)).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => void load(search).catch(e => setError(e.message)), 250); return () => clearTimeout(t); }, [search, load]);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const resetPin = (c: Customer) => run(async () => { const d = await api(`/admin/customers/${c.id}/pin`, json("POST", {})); setIssued({ customer: c.name, pin: d.pin }); await load(search); });
  return <section className="panel customers-panel">
    <div className="panel-title">
      <div><h2>Khách hàng</h2><p className="muted small">Khách đăng nhập bằng số điện thoại + mã PIN và thấy mọi album được chia sẻ cho mình.</p></div>
      <button className="primary" onClick={() => setCreating({ name: "", phone: "", note: "" })}><Plus size={16} />Thêm khách</button>
    </div>
    <label className="search-box customers-search"><Search size={16} /><input aria-label="Tìm khách" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tên, 4 số cuối hoặc số điện thoại đầy đủ" /></label>
    {error && <p role="alert" className="alert">{error}</p>}
    <div className="table-scroll"><table>
      <thead><tr><th>Khách</th><th>Album</th><th>Đăng nhập</th><th /></tr></thead>
      <tbody>{(rows || []).map(c => <tr key={c.id} className={c.disabled ? "muted-row" : ""}>
        <td><strong>{c.name}</strong><small className="muted"> • SĐT …{c.phone_last4}</small>
          <div className="customer-flags">
            {!c.has_pin && <span className="tag warn">Chưa có PIN</span>}
            {c.locked && <span className="tag warn">Đang tạm khoá do nhập sai</span>}
            {c.disabled && <span className="tag">Đã khoá tài khoản</span>}
          </div>
          {c.note && <small className="muted">{c.note}</small>}</td>
        <td><div className="customer-albums">{c.albums.length ? c.albums.map(a => <button key={a.link_id} type="button" className={`text-button ${a.revoked ? "revoked" : ""}`} onClick={() => onOpenAlbum(a.id)}>{a.name}{a.revoked ? " (đã thu hồi)" : ""}</button>) : <span className="muted small">Chưa có album</span>}</div></td>
        <td className="small">{c.last_login_at ? new Date(c.last_login_at).toLocaleString("vi-VN") : <span className="muted">Chưa đăng nhập</span>}</td>
        <td><div className="row">
          <button disabled={busy} onClick={() => void resetPin(c)}><KeyRound size={14} />{c.has_pin ? "Cấp PIN mới" : "Cấp PIN"}</button>
          {c.locked && <button disabled={busy} onClick={() => void run(async () => { await api(`/admin/customers/${c.id}/unlock`, json("POST", {})); await load(search); })}><LockOpen size={14} />Mở khoá</button>}
          <button disabled={busy} onClick={() => setEditing({ ...c })}>Sửa</button>
        </div></td>
      </tr>)}</tbody>
    </table></div>
    {rows === null ? <p className="muted">Đang tải…</p> : !rows.length && <div className="empty"><UserRound /><p>{search ? "Không tìm thấy khách phù hợp." : "Chưa có khách. Khách được tạo khi bạn tạo link có số điện thoại, hoặc thêm tại đây."}</p></div>}

    {creating && <Modal title="Thêm khách hàng" close={() => setCreating(null)}><form onSubmit={e => { e.preventDefault(); void run(async () => {
      const d = await api("/admin/customers", json("POST", creating)); setIssued({ customer: d.customer.name, phone: creating.phone, pin: d.pin }); setCreating(null); await load(search);
    }); }}>
      <label>Tên khách<input required maxLength={120} value={creating.name} onChange={e => setCreating({ ...creating, name: e.target.value })} placeholder="Ví dụ: Lan & Minh" /></label>
      <label>Số điện thoại<input required inputMode="tel" value={creating.phone} onChange={e => setCreating({ ...creating, phone: e.target.value })} placeholder="090 123 4567" /></label>
      <label>Ghi chú nội bộ<textarea rows={3} maxLength={2000} value={creating.note} onChange={e => setCreating({ ...creating, note: e.target.value })} /></label>
      <p className="muted small">Studio Gallery tạo mã PIN 6 số và chỉ hiển thị một lần.</p>
      <button className="primary wide" disabled={busy}>Tạo tài khoản</button>{error && <p className="alert">{error}</p>}
    </form></Modal>}

    {editing && <Modal title="Sửa thông tin khách" close={() => setEditing(null)}><form onSubmit={e => { e.preventDefault(); void run(async () => {
      await api(`/admin/customers/${editing.id}`, json("PATCH", { name: editing.name, note: editing.note, disabled: editing.disabled })); setEditing(null); await load(search);
    }); }}>
      <label>Tên khách<input required maxLength={120} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>Ghi chú nội bộ<textarea rows={3} maxLength={2000} value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })} /></label>
      <label className="check-label"><input type="checkbox" checked={editing.disabled} onChange={e => setEditing({ ...editing, disabled: e.target.checked })} /><Lock size={14} />Khoá tài khoản (đăng xuất mọi phiên của khách)</label>
      <button className="primary wide" disabled={busy}>Lưu</button>{error && <p className="alert">{error}</p>}
    </form></Modal>}

    {issued && <PinIssued issued={issued} origin={origin} studio={studio} close={() => setIssued(null)} />}
  </section>;
}

export function PinIssued({ issued, origin, studio, album, url, close }: { issued: Issued; origin: string; studio?: string; album?: string; url?: string; close: () => void }) {
  const [copied, setCopied] = useState("");
  const message = inviteMessage({ customer: issued.customer, album, origin, phone: issued.phone, pin: issued.pin, url, studio });
  const copyText = (text: string, what: string) => void copy(text).then(() => setCopied(what)).catch(() => setCopied(""));
  return <Modal title="Mã PIN của khách" close={close}>
    <p className="muted">Mã PIN chỉ hiển thị lần này. Gửi cho khách qua Zalo hoặc SMS; nếu mất, hãy cấp PIN mới.</p>
    <div className="pin-display" aria-label="Mã PIN">{issued.pin}</div>
    <label>Tin nhắn gửi khách<textarea readOnly rows={8} value={message} /></label>
    <div className="row">
      <button className="primary" onClick={() => copyText(message, "message")}><Copy size={16} />{copied === "message" ? "Đã chép tin nhắn" : "Chép tin nhắn"}</button>
      <button onClick={() => copyText(issued.pin, "pin")}><Copy size={16} />{copied === "pin" ? "Đã chép PIN" : "Chép PIN"}</button>
    </div>
  </Modal>;
}
