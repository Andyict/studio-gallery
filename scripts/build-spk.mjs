#!/usr/bin/env node
// Builds the DSM 7 package for x86_64 NAS models (e.g. DS923+), on Linux CI or a Windows/macOS dev box.
//
//   node scripts/build-spk.mjs [--build 12] [--skip-web]
//
// Output: dist/StudioGallery-x86_64-<version>-<build>.spk and dist/release.json ({version,md5,size}),
// which the Package Center source (/api/pkg-source) reads from the GitHub release.
//
// - Backend dependencies are installed for linux-x64/glibc whatever the build host is, so sharp ships
//   its Linux binary (never the host's).
// - A static Linux FFmpeg and ExifTool (Perl) are bundled under bin/; DSM provides Node.js v22.
// - Archives are classic USTAR written here with explicit modes: Package Center rejects pax archives,
//   and Windows tar cannot set the executable bit on scripts.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, lstatSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const build = String(option('--build', process.env.GITHUB_RUN_NUMBER || '1'));
const version = `${pkg.version}-${build.padStart(4, '0')}`;
const dist = path.join(root, 'dist'), stage = path.join(dist, 'spk-stage'), payload = path.join(stage, 'package');
const TOOLS = { ffmpeg: 'ffmpeg-static@5.2.0', exiftool: 'exiftool-vendored.pl@13.56.0' };

function run(cmd, cmdArgs, opts = {}) {
  const npm = cmd === 'npm' && process.platform === 'win32';
  const r = spawnSync(npm ? 'npm.cmd' : cmd, cmdArgs, { stdio: 'inherit', shell: npm, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`);
}
const copy = (from, to) => cpSync(path.join(root, from), to, { recursive: true });
const lf = file => writeFileSync(file, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const step = text => console.log(`\n▸ ${text}`);

step(`Studio Gallery ${version} (x86_64)`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });

if (!flag('--skip-web')) { step('Building web UI'); run('npm', ['run', 'build'], { cwd: root }); }
if (!existsSync(path.join(root, 'frontend/.next/standalone'))) throw new Error('frontend/.next/standalone missing: run npm run build');

step('Backend (linux-x64 dependencies)');
mkdirSync(path.join(payload, 'backend'));
copy('backend/src', path.join(payload, 'backend/src'));
for (const f of ['package.json', 'package-lock.json']) copy(`backend/${f}`, path.join(payload, 'backend', f));
run('npm', ['ci', '--omit=dev', '--no-bin-links', '--ignore-scripts', '--os=linux', '--cpu=x64', '--libc=glibc', '--no-audit', '--no-fund'], { cwd: path.join(payload, 'backend') });
const sharpBinaries = readdirSync(path.join(payload, 'backend/node_modules/@img'));
if (!sharpBinaries.some(n => n === 'sharp-linux-x64') || sharpBinaries.some(n => /win32|darwin/.test(n))) throw new Error(`unexpected sharp binaries: ${sharpBinaries}`);

step('Web server');
cpSync(path.join(root, 'frontend/.next/standalone'), path.join(payload, 'frontend'), { recursive: true });
cpSync(path.join(root, 'frontend/.next/static'), path.join(payload, 'frontend/frontend/.next/static'), { recursive: true });
if (existsSync(path.join(root, 'frontend/public'))) cpSync(path.join(root, 'frontend/public'), path.join(payload, 'frontend/frontend/public'), { recursive: true });
// The UI uses plain <img>, so Next's optional image binaries for the build host are not needed.
for (const dir of [path.join(payload, 'frontend/node_modules/@img'), path.join(payload, 'frontend/frontend/node_modules/@img')])
  if (existsSync(dir)) for (const n of readdirSync(dir)) if (/win32|darwin|wasm/.test(n)) rmSync(path.join(dir, n), { recursive: true, force: true });
rmSync(path.join(payload, 'frontend/frontend/.env'), { force: true });

step('Media tools (FFmpeg, ExifTool)');
const tools = path.join(stage, 'tools');
mkdirSync(tools);
writeFileSync(path.join(tools, 'package.json'), '{"private":true}');
// ffmpeg-static's install script downloads the binary for npm_config_platform/arch, not the build host.
// --force: the Perl ExifTool package declares os "!win32", but it is plain Perl and fine to fetch on Windows.
run('npm', ['install', TOOLS.ffmpeg, TOOLS.exiftool, '--force', '--no-bin-links', '--no-audit', '--no-fund'], {
  cwd: tools, env: { ...process.env, npm_config_platform: 'linux', npm_config_arch: 'x64' }
});
mkdirSync(path.join(payload, 'bin'));
const ffmpeg = path.join(tools, 'node_modules/ffmpeg-static/ffmpeg');
if (readFileSync(ffmpeg).subarray(0, 4).toString('latin1') !== '\x7fELF') throw new Error('ffmpeg-static did not fetch the Linux binary');
renameSync(ffmpeg, path.join(payload, 'bin/ffmpeg'));
cpSync(path.join(tools, 'node_modules/exiftool-vendored.pl/bin'), path.join(payload, 'exiftool'), { recursive: true });
writeFileSync(path.join(payload, 'bin/exiftool'), `#!/bin/sh
# ExifTool is a Perl program; DSM ships Perl as the "Perl" package in Package Center.
DIR="$(cd "$(dirname "$0")/../exiftool" && pwd)"
for p in /usr/bin/perl /usr/local/bin/perl /var/packages/Perl/target/usr/local/bin/perl /var/packages/Perl/target/usr/bin/perl; do
  [ -x "$p" ] && exec "$p" "$DIR/exiftool" "$@"
done
command -v perl >/dev/null 2>&1 && exec perl "$DIR/exiftool" "$@"
echo "ExifTool needs Perl: install the Perl package in Package Center" >&2
exit 127
`);
rmSync(tools, { recursive: true, force: true });

step('DSM files');
copy('synology/gateway.mjs', path.join(payload, 'gateway.mjs'));
mkdirSync(path.join(payload, 'ui/images'), { recursive: true });
for (const f of ['StudioGallery.js', 'api.cgi', 'index.html']) copy(`synology/ui/${f}`, path.join(payload, 'ui', f));
writeFileSync(path.join(payload, 'ui/config'), readFileSync(path.join(root, 'synology/ui/config'), 'utf8').replace(/"version":"[^"]*"/, `"version":"${version}"`));
for (const [from, to] of [['manager-72.png', 'icon_72.png'], ['manager-256.png', 'icon_256.png'], ['console-72.png', 'console_72.png'], ['console-256.png', 'console_256.png']])
  copy(`synology/icons/${from}`, path.join(payload, 'ui/images', to));
lf(path.join(payload, 'ui/api.cgi'));
mkdirSync(path.join(stage, 'conf'));
for (const f of ['privilege', 'resource']) copy(`synology/conf/${f}`, path.join(stage, 'conf', f));
copy('synology/scripts', path.join(stage, 'scripts'));
for (const f of readdirSync(path.join(stage, 'scripts'))) lf(path.join(stage, 'scripts', f));
copy('synology/icons/manager-72.png', path.join(stage, 'PACKAGE_ICON.PNG'));
copy('synology/icons/manager-256.png', path.join(stage, 'PACKAGE_ICON_256.PNG'));

// ---- USTAR writer (no pax headers: Package Center rejects them) ----
const executable = rel => /^(scripts\/|bin\/)/.test(rel) || rel === 'ui/api.cgi' || rel === 'exiftool/exiftool' || /^(scripts|conf)$/.test(rel);
function header(name, size, mode, type) {
  let prefix = '', base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`path too long for ustar: ${name}`);
    prefix = name.slice(0, cut); base = name.slice(cut + 1);
  }
  const h = Buffer.alloc(512);
  const put = (value, offset, length) => h.write(value, offset, length, 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  put(base, 0, 100); put(octal(mode, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12); put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  h.fill(' ', 148, 156); put(type, 156, 1); put('ustar\0', 257, 6); put('00', 263, 2);
  put('root', 265, 32); put('root', 297, 32); put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
function tar(base, entries) {
  const chunks = []; let bytes = 0;
  const walk = rel => {
    const full = path.join(base, rel), info = lstatSync(full);
    if (info.isSymbolicLink()) throw new Error(`symlink in package: ${rel}`);
    if (info.isDirectory()) {
      chunks.push(header(`${rel}/`, 0, 0o755, '5'));
      for (const name of readdirSync(full).sort()) walk(`${rel}/${name}`);
    } else {
      const data = readFileSync(full);
      chunks.push(header(rel, data.length, executable(rel) ? 0o755 : 0o644, '0'), data, Buffer.alloc((512 - data.length % 512) % 512));
      bytes += data.length;
    }
  };
  for (const e of entries) walk(e);
  chunks.push(Buffer.alloc(1024));
  return { archive: Buffer.concat(chunks), bytes };
}
const md5 = data => createHash('md5').update(data).digest('hex');

step('Packing');
for (const f of ['bin/ffmpeg', 'bin/exiftool']) chmodSync(path.join(payload, f), 0o755);
const inner = tar(payload, readdirSync(payload).sort());
const packageTgz = gzipSync(inner.archive, { level: 9 });
writeFileSync(path.join(stage, 'package.tgz'), packageTgz);

const info = new Map(readFileSync(path.join(root, 'synology/INFO'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean)
  .map(line => { const m = line.match(/^(\w+)="(.*)"$/); if (!m) throw new Error(`bad INFO line: ${line}`); return [m[1], m[2]]; }));
info.set('version', version);
info.set('arch', 'x86_64');
info.set('silent_upgrade', 'yes');
info.set('checksum', md5(packageTgz));
info.set('extractsize', String(Math.ceil(inner.bytes / 1024)));
writeFileSync(path.join(stage, 'INFO'), [...info].map(([k, v]) => `${k}="${v}"`).join('\n') + '\n');

const spk = tar(stage, ['INFO', 'conf', 'scripts', 'package.tgz', 'PACKAGE_ICON.PNG', 'PACKAGE_ICON_256.PNG']).archive;
const out = path.join(dist, `StudioGallery-x86_64-${version}.spk`);
writeFileSync(out, spk);
writeFileSync(path.join(dist, 'release.json'), JSON.stringify({ version, md5: md5(spk), size: spk.length }, null, 2) + '\n');
if (!flag('--keep-stage')) rmSync(stage, { recursive: true, force: true });
console.log(`\n✔ ${path.relative(root, out)} (${(spk.length / 1048576).toFixed(1)} MB)\n✔ dist/release.json`);
statSync(out);
