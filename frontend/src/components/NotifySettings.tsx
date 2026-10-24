"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { api, json } from "@/lib/api";

// "Thông báo" settings tab: where the studio is alerted about customer activity.
export default function NotifySettings({ s, update, dirty }: { s: any; update: (k: string, v: any) => void; dirty: boolean }) {
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const field = (key: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    <label>{label}<input value={s[key] ?? ""} onChange={e => update(key, props.type === "number" ? Number(e.target.value) : e.target.value)} {...props} /></label>;
  async function test() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api("/admin/notify/test", json("POST", {}))); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <>
    <h2>Thông báo cho studio</h2>
    <p className="muted small">Khi khách nhắn tin, ghi chú ảnh hoặc gửi lựa chọn, studio nhận một bản tin gom theo album mỗi phút (gửi lựa chọn được báo ngay). Để trống để tắt kênh.</p>
    <h3>Email (SMTP)</h3>
    {field("notifyEmail", "Gửi tới email", { type: "email", placeholder: "studio@example.com" })}
    <div className="form-grid">
      {field("smtpHost", "Máy chủ SMTP", { placeholder: "smtp.gmail.com" })}
      {field("smtpPort", "Cổng", { type: "number", min: 1, max: 65535 })}
    </div>
    <div className="form-grid">
      {field("smtpUser", "Tài khoản SMTP", { autoComplete: "off" })}
      {field("smtpPass", "Mật khẩu SMTP", { type: "password", autoComplete: "new-password" })}
    </div>
    {field("smtpFrom", "Người gửi (tuỳ chọn)", { placeholder: "Studio Gallery <studio@example.com>" })}
    <label className="check-label"><input type="checkbox" checked={!!s.smtpSecure} onChange={e => update("smtpSecure", e.target.checked)} />Dùng SSL/TLS ngay từ đầu (cổng 465)</label>
    <small className="muted">Gmail: bật xác minh 2 bước rồi tạo "Mật khẩu ứng dụng", dùng smtp.gmail.com cổng 587.</small>
    <h3>Telegram</h3>
    <div className="form-grid">
      {field("telegramToken", "Bot token", { type: "password", autoComplete: "off", placeholder: "123456:ABC…" })}
      {field("telegramChat", "Chat ID", { placeholder: "-100123… hoặc ID cá nhân" })}
    </div>
    <small className="muted">Tạo bot với @BotFather, thêm bot vào nhóm của studio, lấy Chat ID qua @userinfobot hoặc @RawDataBot.</small>
    <h3>Webhook</h3>
    {field("webhookUrl", "Địa chỉ nhận (POST JSON)", { inputMode: "url", autoComplete: "off", placeholder: "https://…" })}
    <small className="muted">Dùng để nối Zalo OA, Make, n8n… Nội dung gồm album, danh sách hoạt động và đường dẫn Manager.</small>
    <div className="row notify-test">
      <button type="button" disabled={busy || dirty} onClick={() => void test()}><Send size={15} />Gửi thử</button>
      {dirty && <small className="muted">Lưu cài đặt trước khi gửi thử.</small>}
      {result && Object.entries(result).map(([k, v]) => <span key={k} className={`tag ${v === "ok" ? "green" : "warn"}`}>{k}: {v === "ok" ? "đã gửi" : v}</span>)}
    </div>
    {error && <p className="alert">{error}</p>}
  </>;
}
