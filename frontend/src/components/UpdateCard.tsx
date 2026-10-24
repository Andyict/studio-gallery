"use client";
import { useEffect, useState } from "react";
import { Copy, PackageCheck, RefreshCw } from "lucide-react";
import { api, copy } from "@/lib/api";

type Check = { current: string; latest: string | null; updateAvailable: boolean; configured: boolean; url?: string; notes?: string; published?: string; sourceUrl: string; error?: string; repo: string | null };

// Version and Package Center update source. Installing an update is done in DSM's Package Center.
export default function UpdateCard() {
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = (force = false) => { setBusy(true); api<Check>(`/admin/update/check${force ? "?force=1" : ""}`).then(setCheck).catch(() => {}).finally(() => setBusy(false)); };
  useEffect(() => load(), []);
  if (!check) return null;
  return <section className="panel update-card">
    <div className="panel-title"><h2><PackageCheck size={18} /> Phiên bản & cập nhật</h2>
      <button disabled={busy} onClick={() => load(true)}><RefreshCw size={15} />Kiểm tra</button></div>
    <p>Đang chạy <strong>{check.current}</strong>{check.latest && <> · Mới nhất <strong>{check.latest}</strong></>}
      {check.updateAvailable ? <span className="tag warn">Có bản cập nhật</span> : check.latest ? <span className="tag green">Đã mới nhất</span> : null}</p>
    {check.error && <p className="muted small">Không kiểm tra được: {check.error}</p>}
    {check.updateAvailable && check.notes && <pre className="update-notes">{check.notes}</pre>}
    <p className="muted small">Một lần duy nhất trên DSM: Package Center → Cài đặt → Nguồn gói → Thêm, nhập địa chỉ bên dưới. Từ đó bản mới hiện nút Cập nhật trong Package Center; dữ liệu album được giữ nguyên.</p>
    <div className="row"><code className="source-url">{check.sourceUrl}</code>
      <button onClick={() => void copy(check.sourceUrl).then(() => setCopied(true)).catch(() => {})}><Copy size={14} />{copied ? "Đã chép" : "Chép"}</button></div>
  </section>;
}
