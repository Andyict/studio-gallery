import { z } from 'zod';
import nodemailer from 'nodemailer';
import { fail } from './security.mjs';

// Outbound alerts for the studio: e-mail (SMTP), Telegram bot and a generic JSON webhook (for Zalo
// or automation tools). Customer activity is batched per album into one digest per minute so a
// chatty customer does not flood the studio; a submitted selection is sent right away.
export const SECRET_MASK = '••••••••';
const DIGEST_MS = 60_000;
const LABEL = { message:'Tin nhắn', note:'Ghi chú ảnh', submitted:'Đã gửi lựa chọn', reopened:'Mở lại danh sách' };

export function createOutbound(app, { db, config }) {
  const pending = new Map(); // projectID -> { items, timer }
  const channels = () => ({
    email: !!(config.smtpHost && config.notifyEmail),
    telegram: !!(config.telegramToken && config.telegramChat),
    webhook: !!config.webhookUrl
  });
  const transport = () => config.mailTransport || nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort || 587, secure: !!config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000
  });
  async function deliver({ subject, text, payload }) {
    const on = channels(), results = {};
    const attempt = async (name, fn) => {
      if (!on[name]) return;
      try { await fn(); results[name] = 'ok'; }
      catch (e) { results[name] = e.message; app.log.warn({ err: e, channel: name }, 'Notification delivery failed'); }
    };
    await Promise.all([
      attempt('email', () => transport().sendMail({ from: config.smtpFrom || config.smtpUser || config.notifyEmail, to: config.notifyEmail, subject, text })),
      attempt('telegram', async () => {
        const res = await fetch(`${config.telegramApi || 'https://api.telegram.org'}/bot${config.telegramToken}/sendMessage`, {
          method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ chat_id: config.telegramChat, text: `${subject}\n\n${text}`, disable_web_page_preview: true })
        });
        if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }),
      attempt('webhook', async () => {
        // No redirects: the configured URL is the only host that receives the payload.
        const res = await fetch(config.webhookUrl, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', 'user-agent': 'studio-gallery' }, signal: AbortSignal.timeout(15_000), body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Webhook ${res.status}`);
      })
    ]);
    return results;
  }
  async function flush(projectID) {
    const batch = pending.get(projectID);
    if (!batch) return;
    pending.delete(projectID); clearTimeout(batch.timer);
    const album = db.get('SELECT id,name FROM projects WHERE id=?', projectID);
    const studio = config.studioName || config.brand;
    const subject = `[${studio}] ${album?.name || 'Album'}: ${batch.items.length === 1 ? LABEL[batch.items[0].kind] || 'Hoạt động mới' : `${batch.items.length} hoạt động mới`}`;
    const link = `${config.origin}/manager`;
    const text = `${batch.items.map(i => `• ${i.text}`).join('\n')}\n\nMở Studio Manager: ${link}`;
    await deliver({ subject, text, payload: { event: 'studio-gallery.activity', album: album && { id: album.id, name: album.name }, items: batch.items, subject, text, url: link } });
  }
  return {
    channels,
    deliver,
    // Called for every studio notification (see messages.notify).
    notify(kind, projectID, text) {
      const on = channels();
      if (!on.email && !on.telegram && !on.webhook) return;
      const batch = pending.get(projectID) || { items: [], timer: null };
      batch.items.push({ kind, text, at: new Date().toISOString() });
      pending.set(projectID, batch);
      const send = () => flush(projectID).catch(e => app.log.warn({ err: e }, 'Notification digest failed'));
      if (kind === 'submitted') { void send(); return; }
      if (!batch.timer) { batch.timer = setTimeout(() => void send(), config.notifyDigestMs ?? DIGEST_MS); batch.timer.unref?.(); }
    },
    async flushAll() { await Promise.all([...pending.keys()].map(flush)); }
  };
}

export function registerOutbound(app, { config, authenticate, outbound, parse }) {
  app.post('/api/admin/notify/test', async req => {
    const s = authenticate(req, true); if (s.user.role !== 'admin') fail(403, 'Chỉ quản trị viên được gửi thử');
    parse(z.object({}).strict(), req.body || {});
    const on = outbound.channels();
    if (!on.email && !on.telegram && !on.webhook) fail(400, 'Chưa cấu hình kênh thông báo nào');
    const subject = `[${config.studioName || config.brand}] Thông báo thử`;
    return outbound.deliver({ subject, text: `Studio Gallery đã gửi được thông báo tới kênh này.\nMở Studio Manager: ${config.origin}/manager`, payload: { event: 'studio-gallery.test', subject, url: `${config.origin}/manager` } });
  });
  // preClose runs before the database is closed (onClose), so pending digests still go out.
  app.addHook('preClose', async () => { await outbound.flushAll().catch(e => app.log.warn({ err: e }, 'Notification flush failed')); });
}
