"use client";
import { useState } from "react";
import { ArrowRight, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { api, json } from "@/lib/api";
import BrandMark from "../BrandMark";
import PasswordField from "../PasswordField";
import type { Me } from "./context";

// Sign-in, or the one-time creation of the first admin account. `expired` explains why a signed-in
// user is back here (session timed out) instead of silently failing every action.
export default function AdminLogin({ brand, logoUrl, checking, setupRequired, expired, onSignedIn }: {
  brand: string; logoUrl: string | null; checking: boolean; setupRequired: boolean; expired: boolean; onSignedIn: (me: Me) => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState({ name: "Chủ studio", username: "admin", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <main className="entry manager-login">
      <section className="entry-form manager-login-card">
        <div className="brand"><BrandMark logoUrl={logoUrl} />{brand}</div>
        <span className="eyebrow">{setupRequired ? "THIẾT LẬP LẦN ĐẦU" : "KHÔNG GIAN STUDIO"}</span>
        <h1>Ảnh ở studio.<br />Cảm xúc ở mọi nơi.</h1>
        <p className="muted">Một không gian riêng để gửi ảnh, nhận lựa chọn và hoàn thiện từng câu chuyện.</p>
        <div className="login-divider" />
        <h2>{setupRequired ? "Tạo tài khoản quản trị" : "Đăng nhập Studio"}</h2>
        {expired && !setupRequired && <p className="alert" role="status">Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục đúng trang bạn đang mở.</p>}
        {checking ? <LoaderCircle className="spin" /> : setupRequired ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (setup.password !== setup.confirm) throw new Error("Hai mật khẩu chưa khớp");
              await api("/setup", json("POST", { name: setup.name, username: setup.username, password: setup.password }));
              onSignedIn(await api("/admin/me"));
            });
          }}>
            <div className="setup-intro"><ShieldCheck size={18} /><span>Tài khoản này có toàn quyền quản lý studio và chỉ được tạo một lần.</span></div>
            <label>Tên hiển thị<input required autoFocus autoComplete="name" maxLength={100} value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></label>
            <label>Tên đăng nhập<input required autoComplete="username" minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9._-]{2,39}" title="Dùng chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới" value={setup.username} onChange={(e) => setSetup({ ...setup, username: e.target.value.toLowerCase() })} /></label>
            <label>Mật khẩu<PasswordField type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} /><small>Dùng ít nhất 8 ký tự.</small></label>
            <label>Nhập lại mật khẩu<PasswordField type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={setup.confirm} onChange={(e) => setSetup({ ...setup, confirm: e.target.value })} /></label>
            <button className="primary wide" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}Tạo tài khoản & vào Studio</button>
          </form>
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/admin/login", json("POST", { username, password }));
              onSignedIn(await api("/admin/me"));
            });
          }}>
            <label>Tên đăng nhập<input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label>Mật khẩu<PasswordField autoFocus type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="primary wide" disabled={busy}>Vào studio <ArrowRight size={18} /></button>
          </form>
        )}
        {error && <p role="alert" className="alert">{error}</p>}
        <div className="entry-security"><ShieldCheck size={16} />{setupRequired ? "Cửa sổ này tự khoá sau khi tạo tài khoản." : "Lưu trữ trên NAS của bạn. Không qua cloud."}</div>
      </section>
    </main>
  );
}
