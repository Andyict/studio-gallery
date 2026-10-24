// End-to-end: the real backend, the production Next.js build and the DSM gateway, driven in
// Chromium. Run `npm run build` first, then `npm run e2e`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, cp, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { createApp } from '../backend/src/app.mjs';
import { createGateway } from '../synology/gateway.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'backend/package.json'))('sharp');
const listen = (server, port = 0) => new Promise(r => server.listen(port, '127.0.0.1', () => r(server.address().port)));
const free = async () => { const s = (await import('node:net')).createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; };

async function startStack(t) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'studio-e2e-'));
  const album = path.join(tmp, 'photos', 'Weddings', 'Lan_Minh');
  await mkdir(path.join(album, 'Ceremony'), { recursive: true });
  const colors = ['#3c6e57', '#8a5a44', '#4a6a8a', '#7a6a4a'];
  for (const [i, c] of colors.entries())
    await writeFile(path.join(album, 'Ceremony', `IMG_00${i + 1}.jpg`), await sharp({ create: { width: 900, height: 600, channels: 3, background: c } }).jpeg().toBuffer());
  // Next standalone needs its static assets next to server.js (the SPK build does the same).
  const standalone = path.join(root, 'frontend/.next/standalone/frontend');
  await access(path.join(standalone, 'server.js'));
  await cp(path.join(root, 'frontend/.next/static'), path.join(standalone, '.next/static'), { recursive: true });
  await cp(path.join(root, 'frontend/public'), path.join(standalone, 'public'), { recursive: true });

  const webPort = await free(), apiPort = await free();
  const gateway = createGateway({ api: { host: '127.0.0.1', port: apiPort }, web: { host: '127.0.0.1', port: webPort } });
  const gatewayPort = await listen(gateway);
  const origin = `http://127.0.0.1:${gatewayPort}`;
  const app = await createApp({ photoRoot: path.join(tmp, 'photos'), dataDir: path.join(tmp, 'data'), cacheDir: path.join(tmp, 'cache'), adminPassword: 'e2e-admin-password', origin, background: true, logger: false });
  await app.listen({ host: '127.0.0.1', port: apiPort });
  const web = spawn(process.execPath, ['server.js'], { cwd: standalone, env: { ...process.env, PORT: String(webPort), HOSTNAME: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; ; i++) { try { if ((await fetch(`${origin}/`)).ok) break; } catch { /* starting */ } if (i > 100) throw new Error('web did not start'); await new Promise(r => setTimeout(r, 200)); }
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); web.kill(); gateway.closeAllConnections(); gateway.close(); await app.close(); await rm(tmp, { recursive: true, force: true }); });

  // Studio setup through the API, like Manager does.
  const api = async (method, url, body, cookie) => {
    const res = await fetch(`${origin}/api${url}`, { method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(`${url}: ${data.error}`);
    return { data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const admin = (await api('POST', '/admin/login', { password: 'e2e-admin-password' })).cookie;
  await api('POST', '/admin/sources', { relative_path: 'Weddings', label: 'Weddings' }, admin);
  const project = (await api('POST', '/admin/projects', { name: 'Lan & Minh', root: 'Weddings/Lan_Minh' }, admin)).data.id;
  await app.services.scanner.wait(); await app.services.worker.drain();
  await api('PATCH', `/admin/projects/${project}/workflow`, { max_edit: 2, client_message: 'Chọn 2 ảnh để chỉnh sửa nhé', due_at: new Date(Date.now() + 2 * 86400_000).toISOString() }, admin);
  const link = (await api('POST', `/admin/projects/${project}/links`, { label: 'Lan', phone: '0901234567', customer_name: 'Lan Nguyễn' }, admin)).data;
  return { origin, browser, pin: link.pin };
}

test('customer picks, notes, chats and submits; studio sees it and replies live', { timeout: 120_000 }, async t => {
  const { origin, browser, pin } = await startStack(t);
  const errors = [];
  const customer = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  customer.on('pageerror', e => errors.push(e.message));

  // Portal in English, then back to Vietnamese; sign in with phone + PIN.
  await customer.goto(`${origin}/`);
  await customer.getByRole('button', { name: 'EN', exact: true }).click();
  await customer.getByRole('heading', { name: /Your memories/ }).waitFor();
  await customer.getByRole('button', { name: 'VI', exact: true }).click();
  await customer.getByLabel('Số điện thoại').fill('090 123 4567');
  await customer.getByLabel('Mã PIN').fill('000000');
  await customer.getByRole('button', { name: /Xem album/ }).click();
  await customer.getByText('Số điện thoại hoặc PIN không đúng').waitFor();
  await customer.getByLabel('Mã PIN').fill(pin);
  await customer.getByRole('button', { name: /Xem album/ }).click();
  await customer.getByRole('heading', { name: 'Xin chào, Lan Nguyễn.' }).waitFor();
  await Promise.all([customer.waitForURL('**/album'), customer.getByRole('button', { name: /Lan & Minh/ }).click()]);

  // Gallery: studio message, heart, edit picks with the limit.
  await customer.getByText('Chọn 2 ảnh để chỉnh sửa nhé').waitFor();
  await customer.getByRole('button', { name: 'Yêu thích IMG_001.jpg' }).click();
  await assert.doesNotReject(customer.getByRole('button', { name: 'Yêu thích IMG_001.jpg', pressed: true }).waitFor());
  await customer.getByRole('button', { name: 'Chọn chỉnh sửa IMG_001.jpg' }).click();
  await customer.getByRole('button', { name: 'Chọn chỉnh sửa IMG_002.jpg' }).click();
  await customer.getByRole('button', { name: /Chọn edit 2\/2/ }).waitFor();
  await customer.getByRole('button', { name: 'Chọn chỉnh sửa IMG_003.jpg' }).click();
  await customer.getByText(/chỉ được chọn tối đa 2 ảnh/).waitFor();

  // Lightbox: pin a note on the photo.
  await customer.getByRole('button', { name: 'Xem IMG_001.jpg' }).click();
  const stage = customer.locator('.annotated-image');
  await stage.waitFor();
  await stage.click({ position: { x: 60, y: 40 } });
  await customer.getByPlaceholder('Ví dụ: Làm sáng vùng mặt một chút…').fill('Làm sáng góc trái');
  await customer.getByRole('button', { name: 'Gửi ghi chú' }).click();
  await customer.locator('.pin:not(.draft)').first().waitFor();
  await customer.getByRole('button', { name: 'Đóng ảnh' }).click();

  // Album chat, then submit to the studio.
  await customer.getByRole('button', { name: 'Trò chuyện với studio' }).click();
  await customer.getByLabel('Tin nhắn gửi studio').fill('Khi nào có ảnh ạ?');
  await customer.getByRole('button', { name: 'Gửi', exact: true }).click();
  await customer.locator('.client-chat').getByText('Khi nào có ảnh ạ?').waitFor();
  await customer.getByRole('button', { name: 'Đóng trò chuyện' }).click();
  await customer.getByRole('button', { name: 'Gửi studio' }).click();
  await customer.getByRole('button', { name: 'Xác nhận gửi studio' }).click();
  await customer.getByText('Đã gửi lựa chọn cho studio').waitFor();
  assert.equal(await customer.getByRole('button', { name: 'Yêu thích IMG_002.jpg' }).isDisabled(), true, 'hearts lock after submit');

  // Studio: dashboard shows the submitted album; reply from the inbox.
  const studio = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  studio.on('pageerror', e => errors.push(e.message));
  await studio.goto(`${origin}/manager`);
  await studio.getByLabel('Mật khẩu', { exact: true }).fill('e2e-admin-password');
  await studio.getByRole('button', { name: /Vào studio/ }).click();
  await studio.locator('.dashboard-card', { hasText: 'Khách đã gửi' }).getByText('Lan & Minh').waitFor();
  await studio.getByRole('link', { name: /Tin nhắn/ }).click();
  await studio.getByRole('button', { name: /Lan & Minh/ }).click();
  await studio.getByText('Làm sáng góc trái').waitFor();
  await studio.getByLabel('Tin nhắn gửi khách').fill('Thứ 6 studio gửi ảnh nhé');
  await studio.getByRole('button', { name: 'Gửi', exact: true }).click();

  // The customer's chat button shows the reply without reloading.
  await customer.getByRole('button', { name: /Trò chuyện với studio, 1 tin mới/ }).waitFor({ timeout: 15_000 });
  await customer.getByRole('button', { name: /Trò chuyện với studio/ }).click();
  await customer.locator('.client-chat').getByText('Thứ 6 studio gửi ảnh nhé').waitFor();

  // Manager: filter the album list, review the noted photo in the lightbox and resolve the note.
  await studio.getByRole('link', { name: /^Album/ }).first().click();
  await studio.getByRole('button', { name: /Khách đã gửi/ }).click();
  await studio.waitForURL('**/manager/albums?status=submitted');
  await studio.locator('.album-grid').getByRole('link', { name: /Lan & Minh/ }).click();
  await studio.getByRole('link', { name: 'Ảnh', exact: true }).click();
  await studio.getByRole('button', { name: 'Có ghi chú' }).click();
  await studio.waitForURL('**/photos?filter=notes');
  await studio.getByRole('button', { name: 'Xem IMG_001.jpg' }).click();
  await studio.locator('.mgr-lightbox').getByText('Làm sáng góc trái').waitFor();
  await studio.getByRole('button', { name: 'Đánh dấu đã xử lý' }).click();
  await studio.locator('.mgr-lightbox').getByText(/Đã xử lý ·/).waitFor();
  await studio.keyboard.press('Escape');
  // The page lives in the URL: a reload comes back to the same album tab and filter.
  const albumUrl = studio.url();
  await studio.reload();
  await studio.getByRole('heading', { name: 'Lan & Minh' }).waitFor();
  assert.equal(studio.url(), albumUrl);
  const studioPhone = await (await browser.newContext({ viewport: { width: 375, height: 812 }, storageState: await studio.context().storageState() })).newPage();
  studioPhone.on('pageerror', e => errors.push(e.message));
  await studioPhone.goto(`${origin}/manager/albums`);
  await studioPhone.locator('.album-grid').getByText('Lan & Minh').waitFor();
  assert.equal(await studioPhone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Manager fits 375 px');

  // Phone layout: no horizontal scrolling on the gallery.
  const phone = await (await browser.newContext({ viewport: { width: 375, height: 812 }, storageState: await customer.context().storageState() })).newPage();
  await phone.goto(`${origin}/album`);
  await phone.getByText('Lan & Minh').first().waitFor();
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal overflow at 375 px');
  assert.deepEqual(errors, []);
});
