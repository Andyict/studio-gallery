"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Copy, Link as LinkIcon } from "lucide-react";
import { api, copy, json } from "@/lib/api";
import { inviteMessage } from "@/lib/invite";
import PasswordField from "./PasswordField";
import { Modal } from "./Gallery";

type Folder = { id: string; relative_path: string };
type Created = { url: string; portal: string | null; pin: string | null; phone: string | null; customer: { name: string; phone_last4: string; has_pin: boolean } | null };

// Create a share link for an album. Always starts from the studio defaults; after creation it shows
// the link once, plus the customer's new PIN and a ready-to-send message when a phone was given.
export default function ShareDialog({ projectId, projectName, folders, brand, onClose, onCreated, onNotice }: {
  projectId: string; projectName: string; folders: Folder[]; brand: string;
  onClose: () => void; onCreated: () => Promise<void>; onNotice: (message: string) => void;
}) {
  const [label, setLabel] = useState("Khách hàng");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [expires, setExpires] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [downloads, setDownloads] = useState(true);
  const [originals, setOriginals] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/admin/defaults").then(d => {
      setDownloads(d.downloads); setOriginals(d.originals);
      const t = new Date(Date.now() + d.expiryDays * 86400000);
      setExpires(d.expiryDays ? new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
    }).catch(e => setError((e as Error).message)).finally(() => setBusy(false));
  }, []);
  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }

  if (created) {
    const message = created.customer && inviteMessage({ customer: created.customer.name, album: projectName, origin: created.portal || window.location.origin, phone: created.phone, pin: created.pin, url: created.url, studio: brand });
    return <Modal title="Link đã sẵn sàng" close={onClose}>
      <p className="muted">Lưu link này trước khi đóng. Bạn có thể thu hồi quyền bất cứ lúc nào.</p>
      <textarea readOnly value={created.url} rows={3} />
      {created.customer && <div className="share-customer">
        <p className="small">Tài khoản khách: <strong>{created.customer.name}</strong> • SĐT …{created.customer.phone_last4}
          {!created.pin && (created.customer.has_pin ? " — dùng mã PIN khách đã có." : " — chưa có PIN, cấp trong mục Khách hàng.")}</p>
        {created.pin && <><span className="tiny-label">MÃ PIN (CHỈ HIỂN THỊ LẦN NÀY)</span><div className="pin-display">{created.pin}</div></>}
        <label>Tin nhắn gửi khách<textarea readOnly rows={7} value={message!} /></label>
        <button onClick={() => void run(async () => { await copy(message!); onNotice("Đã chép tin nhắn gửi khách"); })}><Copy size={16} />Chép tin nhắn</button>
      </div>}
      <div className="row">
        <button className="primary" onClick={() => void run(async () => { await copy(created.url); onNotice("Đã sao chép link"); })}><Copy size={16} />Sao chép</button>
        <a className="button" href={created.url} target="_blank" rel="noreferrer">Mở gallery <ArrowUpRight size={16} /></a>
      </div>
      {error && <p className="alert">{error}</p>}
    </Modal>;
  }

  return <Modal title="Cấp quyền truy cập album" close={onClose}>
    <form onSubmit={e => {
      e.preventDefault();
      void run(async () => {
        const d = await api(`/admin/projects/${projectId}/links`, json("POST", {
          label, password, phone, folder_ids: scope, downloads, originals, expires_at: expires ? new Date(expires).toISOString() : null
        }));
        setCreated(d);
        await onCreated();
      });
    }}>
      <label>Tên khách hàng / nhóm khách<input required value={label} maxLength={160} onChange={e => setLabel(e.target.value)} /></label>
      <label>Số điện thoại khách (tạo / dùng tài khoản khách)<input inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="090 123 4567" /></label>
      <p className="muted small">Khách đăng nhập trang chủ studio bằng số điện thoại này và mã PIN. Số mới sẽ được tạo tài khoản kèm mã PIN 6 số (hiển thị sau khi tạo link). Để trống nếu chỉ gửi link trực tiếp.</p>
      <div className="form-grid">
        <label>Mật khẩu cho link trực tiếp<PasswordField type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Không bắt buộc" /></label>
        <label>Hết hạn lúc<input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} /></label>
      </div>
      <label>Thư mục được xem <small className="muted">Không chọn = toàn bộ bộ ảnh</small></label>
      <div className="scope-list">{folders.map(f => <label className="check-label" key={f.id}>
        <input type="checkbox" checked={scope.includes(f.id)} onChange={e => setScope(v => e.target.checked ? [...v, f.id] : v.filter(x => x !== f.id))} />
        {f.relative_path || "Toàn bộ cây thư mục"}</label>)}</div>
      <label className="check-label"><input type="checkbox" checked={downloads} onChange={e => setDownloads(e.target.checked)} />Cho tải preview</label>
      <label className="check-label"><input type="checkbox" checked={originals} disabled={!downloads} onChange={e => setOriginals(e.target.checked)} />Cho tải file gốc JPG / RAW</label>
      <button className="primary wide" disabled={busy}>Tạo quyền truy cập <LinkIcon size={16} /></button>
    </form>
    {error && <p className="alert">{error}</p>}
  </Modal>;
}
