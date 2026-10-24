"use client";
import { useState } from "react";
import { Link as LinkIcon, Plus } from "lucide-react";
import { api, json } from "@/lib/api";
import { href, NavLink } from "@/lib/adminRoute";
import { dateVN, useManager, type Project } from "./context";

const state = (l: any) => (l.revoked ? "revoked" : l.expires_at && new Date(l.expires_at) < new Date() ? "expired" : "active");
const STATE_LABEL: Record<string, string> = { revoked: "Đã thu hồi", expired: "Hết hạn", active: "Đang hoạt động" };

// Share links of an album: who each one is for (customer account and PIN state), what it allows,
// and revoking one or several at once (always confirmed: a revoked link cannot be restored).
export default function AlbumLinks({ project, links, archived, onShare, reload }: {
  project: Project; links: any[]; archived: boolean; onShare: () => void; reload: () => Promise<void>;
}) {
  const { notify, fail, confirm } = useManager();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const live = links.filter((l) => state(l) === "active");
  const chosen = live.filter((l) => picked.has(l.id));
  async function revoke(rows: any[]) {
    const ok = await confirm({
      title: rows.length === 1 ? "Thu hồi link" : `Thu hồi ${rows.length} link`,
      body: <><p>{rows.length === 1 ? <>Link “<strong>{rows[0].label}</strong>” sẽ ngừng hoạt động ngay.</> : <>Các link: {rows.map((r) => r.label).join(", ")} sẽ ngừng hoạt động ngay.</>}</p>
        <p className="small muted">Không thể mở lại link đã thu hồi; nếu cần, hãy tạo link mới. Tài khoản khách (SĐT + PIN) vẫn giữ các album khác.</p></>,
      confirm: "Thu hồi", danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const results = await Promise.allSettled(rows.map((l) => api(`/admin/links/${l.id}/revoke`, json("POST", {}))));
    await reload().catch(() => {});
    setBusy(false); setPicked(new Set());
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) fail(`${failed} link chưa thu hồi được`); else notify(rows.length === 1 ? "Đã thu hồi link" : `Đã thu hồi ${rows.length} link`);
  }
  const toggle = (id: string) => setPicked((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section className="panel">
      <div className="panel-title">
        <div><h2>Link chia sẻ</h2><p className="muted small">Đường dẫn bí mật chỉ hiện lúc tạo. Nếu khách mất link, tạo link mới hoặc cấp PIN để khách đăng nhập bằng số điện thoại.</p></div>
        <div className="row">
          {chosen.length > 0 && <button className="danger-text" disabled={busy} onClick={() => void revoke(chosen)}>Thu hồi {chosen.length} link</button>}
          <button className="primary" disabled={archived} onClick={onShare}><Plus size={16} />Tạo link</button>
        </div>
      </div>
      {links.length === 0 ? (
        <div className="empty"><LinkIcon /><p>{archived ? "Album đang lưu trữ nên không tạo link mới." : "Chưa có link chia sẻ. Tạo link đầu tiên cho album."}</p></div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="check-col">{live.length > 1 && <input type="checkbox" aria-label="Chọn mọi link đang hoạt động" checked={chosen.length === live.length} onChange={(e) => setPicked(e.target.checked ? new Set(live.map((l) => l.id)) : new Set())} />}</th>
                <th>Khách / link</th><th>Phạm vi</th><th>Tải ảnh</th><th>Hạn dùng</th><th>Trạng thái</th><th />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => {
                const s = state(l);
                return (
                  <tr key={l.id} className={s !== "active" ? "muted-row" : ""}>
                    <td className="check-col">{s === "active" && <input type="checkbox" aria-label={`Chọn link ${l.label}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} />}</td>
                    <td>
                      <strong>{l.label}</strong>
                      {l.customer_id ? (
                        <div className="small">
                          <NavLink to={href.customers()} className="text-button">{l.customer_name || "Tài khoản khách"}</NavLink>
                          {l.phone_last4 && <span className="muted"> • SĐT …{l.phone_last4}</span>}
                          {!l.customer_has_pin && <span className="tag warn">Chưa có PIN</span>}
                        </div>
                      ) : <div className="small muted">Chỉ link trực tiếp · tạo {dateVN(l.created_at)}</div>}
                    </td>
                    <td>{l.scope === "all" ? "Toàn bộ" : "Thư mục chọn"}</td>
                    <td>{l.downloads ? (l.originals ? "Ảnh xem + file gốc" : "Ảnh xem") : "Không"}</td>
                    <td>{l.expires_at ? dateVN(l.expires_at) : "Không giới hạn"}</td>
                    <td><span className={`tag ${s === "active" ? "green" : ""}`}>{STATE_LABEL[s]}</span></td>
                    <td>{s === "active" && <button className="danger-text" disabled={busy} onClick={() => void revoke([l])}>Thu hồi</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {project.access_count === 0 && links.length > 0 && !archived && <p className="muted small">Album chưa có link nào còn hiệu lực: khách đang không mở được album.</p>}
    </section>
  );
}
