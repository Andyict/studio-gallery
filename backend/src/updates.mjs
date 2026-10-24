import { fail } from './security.mjs';

// Package Center source. In DSM: Package Center → Settings → Package Sources → Add
//   http://127.0.0.1:3215/api/pkg-source
// DSM then sees the newest GitHub release as a normal "Update". A release carries the .spk plus a
// release.json ({version,md5,size}) written by scripts/build-spk.mjs.
const CACHE_MS = 10 * 60_000; // the anonymous GitHub API allows 60 calls/hour

export function registerUpdates(app, { config, authenticate }) {
  let cached = { at: 0, info: null, error: null };
  async function latest(force = false) {
    if (!force && Date.now() - cached.at < CACHE_MS) { if (cached.error) throw cached.error; return cached.info; }
    try {
      if (!config.updateRepo) throw new Error('Chưa cấu hình kho cập nhật (UPDATE_REPO)');
      const headers = { accept: 'application/vnd.github+json', 'user-agent': 'studio-gallery' };
      const res = await fetch(`https://api.github.com/repos/${config.updateRepo}/releases/latest`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`GitHub: ${res.status}`);
      const release = await res.json();
      const spk = release.assets?.find(a => a.name.endsWith('.spk')), meta = release.assets?.find(a => a.name === 'release.json');
      if (!spk || !meta) throw new Error(`Bản phát hành ${release.tag_name} thiếu .spk hoặc release.json`);
      const m = await (await fetch(meta.browser_download_url, { headers, signal: AbortSignal.timeout(15_000) })).json();
      if (!m.version || !m.md5) throw new Error('release.json không hợp lệ');
      cached = { at: Date.now(), error: null, info: { version: m.version, md5: m.md5, size: m.size || spk.size, link: spk.browser_download_url, tag: release.tag_name, url: release.html_url, notes: release.body || '', published: release.published_at } };
    } catch (error) {
      cached = { at: Date.now(), info: null, error };
      app.log.warn({ err: error }, 'Update check failed');
      throw error;
    }
    return cached.info;
  }

  // Package Center POSTs form fields (arch, build, language…) and expects this JSON shape.
  const source = async () => {
    const packages = [];
    try {
      const info = await latest();
      const icon = `https://raw.githubusercontent.com/${config.updateRepo}/main/synology/icons/manager-256.png`;
      packages.push({
        package: 'StudioGallery', version: info.version, dname: 'Studio Gallery',
        desc: 'Photo proofing for studios: customers sign in with phone + PIN, heart and pick photos, leave notes, chat and download.',
        link: info.link, size: info.size, md5: info.md5, thumbnail: [icon, icon], thumbnail_retina: [icon, icon], snapshot: [],
        changelog: info.notes, maintainer: config.updateRepo, maintainer_url: `https://github.com/${config.updateRepo}`,
        distributor: config.updateRepo, distributor_url: `https://github.com/${config.updateRepo}`, support_url: `https://github.com/${config.updateRepo}/issues`,
        deppkgs: 'Node.js_v22', conflictpkgs: null, depsers: null,
        qinst: true, qstart: true, qupgrade: true, start: true, beta: false, silent_install: false, silent_uninstall: false, silent_upgrade: true,
        price: 0, download_count: 0, recent_download_count: 0, category: 0, subcategory: 0, type: 0
      });
    } catch { /* an empty list just means "no update offered" */ }
    return { packages, keyrings: [] };
  };
  app.get('/api/pkg-source', source);
  app.post('/api/pkg-source', source);

  app.get('/api/admin/update/check', async req => {
    authenticate(req, true);
    const base = { current: config.appVersion, repo: config.updateRepo || null, sourceUrl: 'http://127.0.0.1:3215/api/pkg-source' };
    try {
      const info = await latest(req.query.force === '1');
      return { ...base, configured: true, latest: info.version, updateAvailable: newer(info.version, config.appVersion), url: info.url, notes: info.notes, published: info.published };
    } catch (e) {
      return { ...base, configured: !!config.updateRepo, latest: null, updateAvailable: false, error: e.message };
    }
  });
  app.post('/api/admin/update', async req => {
    const session = authenticate(req, true);
    if (session.user.role !== 'admin') fail(403, 'Chỉ quản trị viên được cập nhật hệ thống');
    if (!config.updateCommand) fail(503, 'Bản cài trên DSM được cập nhật trong Package Center (nguồn gói Studio Gallery).');
    const { spawn } = await import('node:child_process');
    spawn(config.updateCommand, { shell: true, detached: true, stdio: 'ignore', env: { ...process.env, UPDATE_REQUESTED: '1' } }).unref();
    return { accepted: true, message: 'Đang cập nhật và khởi động lại dịch vụ.' };
  });
}

// DSM versions look like 0.3.0-0012: compare numerically, field by field.
export function newer(candidate, current) {
  const parts = v => String(v || '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return false;
}
