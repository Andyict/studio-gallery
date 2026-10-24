"use client";

// Scan schedules are stored as 5-field cron strings. This control covers the common studio
// cases (every N minutes/hours, daily at a time) and falls back to raw cron for anything else.
const MINUTES = [2, 5, 10, 15, 20, 30];
const HOURS = [1, 2, 3, 4, 6, 12];
type Mode = "manual" | "minutes" | "hours" | "daily" | "custom";

function parse(cron: string): { mode: Mode; n: number; time: string } {
  const c = cron.trim().replace(/\s+/g, " ");
  if (!c) return { mode: "manual", n: 10, time: "03:00" };
  let m = c.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (m && MINUTES.includes(Number(m[1]))) return { mode: "minutes", n: Number(m[1]), time: "03:00" };
  if (c === "* * * * *") return { mode: "custom", n: 1, time: "03:00" };
  m = c.match(/^0 \*\/(\d{1,2}) \* \* \*$/);
  if (m && HOURS.includes(Number(m[1]))) return { mode: "hours", n: Number(m[1]), time: "03:00" };
  if (c === "0 * * * *") return { mode: "hours", n: 1, time: "03:00" };
  m = c.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (m && Number(m[1]) < 60 && Number(m[2]) < 24) return { mode: "daily", n: 10, time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}` };
  return { mode: "custom", n: 10, time: "03:00" };
}

function build(mode: Mode, n: number, time: string, custom: string) {
  if (mode === "manual") return "";
  if (mode === "minutes") return `*/${n} * * * *`;
  if (mode === "hours") return n === 1 ? "0 * * * *" : `0 */${n} * * *`;
  if (mode === "daily") { const [h, m] = (time || "03:00").split(":"); return `${Number(m) || 0} ${Number(h) || 0} * * *`; }
  return custom;
}

export function describeCron(cron: string | null | undefined) {
  const p = parse(cron || "");
  if (p.mode === "manual") return "Thủ công";
  if (p.mode === "minutes") return `Mỗi ${p.n} phút`;
  if (p.mode === "hours") return p.n === 1 ? "Mỗi giờ" : `Mỗi ${p.n} giờ`;
  if (p.mode === "daily") return `Hằng ngày lúc ${p.time}`;
  return `Cron: ${cron}`;
}

// Legacy per-album interval (seconds) expressed as cron, so the album form edits one schedule.
export function intervalToCron(seconds: number | null | undefined) {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (seconds < 3600) return `*/${MINUTES.find(m => m >= minutes) ?? 30} * * * *`;
  const hours = Math.round(seconds / 3600);
  return hours <= 1 ? "0 * * * *" : `0 */${HOURS.find(h => h >= hours) ?? 12} * * *`;
}

export default function ScanSchedule({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const p = parse(value);
  const set = (mode: Mode, n = p.n, time = p.time) => onChange(build(mode, n, time, mode === "custom" ? value || "*/10 * * * *" : value));
  return <div className="scan-schedule">
    <label>
      Lịch quét tự động
      <select value={p.mode} onChange={e => {
        const mode = e.target.value as Mode;
        set(mode, mode === "minutes" ? (MINUTES.includes(p.n) ? p.n : 10) : mode === "hours" ? (HOURS.includes(p.n) ? p.n : 1) : p.n);
      }}>
        <option value="minutes">Theo phút</option>
        <option value="hours">Theo giờ</option>
        <option value="daily">Hằng ngày</option>
        <option value="manual">Thủ công (chỉ quét khi bấm)</option>
        <option value="custom">Tùy chỉnh (cron)</option>
      </select>
    </label>
    {p.mode === "minutes" && <label>Quét mỗi
      <select value={p.n} onChange={e => set("minutes", Number(e.target.value))}>{MINUTES.map(m => <option key={m} value={m}>{m} phút</option>)}</select></label>}
    {p.mode === "hours" && <label>Quét mỗi
      <select value={p.n} onChange={e => set("hours", Number(e.target.value))}>{HOURS.map(h => <option key={h} value={h}>{h} giờ</option>)}</select></label>}
    {p.mode === "daily" && <label>Giờ quét
      <input type="time" required value={p.time} onChange={e => e.target.value && set("daily", p.n, e.target.value)} /></label>}
    {p.mode === "custom" && <label>Biểu thức cron
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="*/10 * * * *" /></label>}
    <small className="muted">
      {p.mode === "minutes" ? "Phù hợp khi ảnh được chép vào hằng ngày; ảnh mới hiện cho khách sau tối đa một chu kỳ. Chu kỳ ngắn làm ổ NAS hoạt động thường xuyên hơn."
        : p.mode === "manual" ? "Album chỉ cập nhật khi bấm Đồng bộ ngay."
        : p.mode === "custom" ? "5 trường: phút giờ ngày tháng thứ. Ví dụ */10 * * * * = mỗi 10 phút."
        : describeCron(value) + "."}
    </small>
  </div>;
}
