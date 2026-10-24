"use client";
import { useEffect, useState } from "react";
import { Check, UsersRound } from "lucide-react";
import { api, json } from "@/lib/api";

type Member = { id: string; name: string; username: string; role: string; album_scope?: string };

// Staff assigned to an album. Staff accounts limited to "assigned albums" only see albums listed here.
export default function AlbumStaff({ projectId, canEdit, onSaved }: { projectId: string; canEdit: boolean; onSaved: (message: string) => Promise<void> }) {
  const [team, setTeam] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<Member[]>("/admin/team"), api<Member[]>(`/admin/projects/${projectId}/staff`)])
      .then(([t, a]) => { setTeam(t); setSelected(new Set(a.map(m => m.id))); })
      .catch(e => setError((e as Error).message));
  }, [projectId]);
  const toggle = (id: string) => setSelected(v => { const n = new Set(v); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function save() {
    setBusy(true); setError("");
    try { await api(`/admin/projects/${projectId}/staff`, json("PUT", { user_ids: [...selected] })); await onSaved("Đã lưu nhân viên phụ trách"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const assigned = team.filter(m => selected.has(m.id));
  return <div className="album-staff">
    <span className="tiny-label"><UsersRound size={13} /> NHÂN VIÊN PHỤ TRÁCH</span>
    {canEdit ? <>
      <div className="staff-options">{team.map(m => <label key={m.id} className="check-inline">
        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />{m.name}
        {m.role !== "admin" && m.album_scope === "assigned" && <small className="muted">(chỉ album được giao)</small>}
      </label>)}</div>
      <button className="wide" disabled={busy} onClick={() => void save()}><Check size={16} /> Lưu phân công</button>
    </> : <p className="small">{assigned.length ? assigned.map(m => m.name).join(", ") : "Chưa phân công"}</p>}
    {error && <p role="alert" className="alert">{error}</p>}
  </div>;
}
