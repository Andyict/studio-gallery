"use client";
import { useState } from "react";
import { api, json } from "@/lib/api";
import { go, href } from "@/lib/adminRoute";
import ScanSchedule, { intervalToCron } from "../ScanSchedule";
import { AlbumLifecycle } from "../AlbumLifecycle";
import { useManager, type Project } from "./context";

// Album name, scan schedule and time zone, then archive / delete. Staff assignment and the internal
// note live on the overview only, so there is one place to edit each.
export default function AlbumSettings({ project }: { project: Project }) {
  const { me, isAdmin, limited, refresh, notify, fail } = useManager();
  const [name, setName] = useState(project.name);
  const [cron, setCron] = useState(intervalToCron(project.scan_interval_seconds) ?? project.cron);
  const [timezone, setTimezone] = useState(project.timezone);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <section className="panel settings-panel">
        <h2>Cài đặt album</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          api(`/admin/projects/${project.id}`, json("PATCH", { name, cron, timezone, scan_interval_seconds: null }))
            .then(async () => { await refresh(); notify("Đã lưu cài đặt album"); })
            .catch((err) => fail(err.message)).finally(() => setBusy(false));
        }}>
          <label>Tên album<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <ScanSchedule value={cron} onChange={setCron} />
          <label>Múi giờ<input required value={timezone} onChange={(e) => setTimezone(e.target.value)} /></label>
          <button className="primary" disabled={busy}>Lưu cài đặt</button>
        </form>
      </section>
      <AlbumLifecycle project={project} isAdmin={isAdmin} canManage={!limited && !!me}
        onChanged={async (message) => { await refresh(); notify(message); }}
        onDeleted={async () => { await refresh(); notify("Đã xoá album"); go(href.albums(), { replace: true }); }} />
    </>
  );
}
