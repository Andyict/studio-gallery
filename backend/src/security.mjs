import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
export async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await scrypt(value, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(value, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const actual = Buffer.from(await scrypt(value, salt, 64));
  const expected = Buffer.from(hash || '', 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function cleanRelative(value = '') {
  if (typeof value !== 'string' || value.includes('\0') || value.includes('\\') || value.includes(':') || path.posix.isAbsolute(value)) fail(400, 'Đường dẫn không hợp lệ');
  if (value.split('/').some(p => p === '..' || p === '.')) fail(400, 'Đường dẫn không hợp lệ');
  return value.replace(/\/+$/, '');
}
export function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export async function safePath(root, relative = '') {
  cleanRelative(relative);
  const base = await realpath(root);
  let current = base;
  for (const segment of relative.split('/').filter(Boolean)) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) fail(403, 'Không cho phép symbolic link');
  }
  const resolved = await realpath(current);
  if (!within(base, resolved)) fail(403, 'Đường dẫn vượt ngoài nguồn ảnh');
  return resolved;
}
export async function safeOpen(root, relative) {
  const resolved = await safePath(root, relative);
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!(await handle.stat()).isFile()) fail(400, 'Nguồn không phải file');
    // Verify the opened descriptor on Linux: parent-directory replacement cannot escape the mount root.
    if (process.platform === 'linux') {
      const actual = await realpath(`/proc/self/fd/${handle.fd}`);
      if (!within(await realpath(root), actual)) fail(403, 'Nguồn nằm ngoài thư mục cho phép');
    }
    return handle;
  } catch (e) { await handle.close(); throw e; }
}
export const descendant = (target, scope) => scope === '' || target === scope || target.startsWith(`${scope}/`);
