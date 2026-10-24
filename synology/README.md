# Studio Gallery on Synology DSM

The DSM 7 package runs the backend and web UI as the dedicated `StudioGallery` system user. During package startup, DSM's `data-share` resource grants that user read-only access to the `Studio` shared folder. DSM creates `Studio` if it does not already exist. The app never runs with the installing administrator's account.

The Console lists DSM shared folders and reports whether the package user can read each one. Other folders remain inaccessible until an administrator grants the `StudioGallery` system user read-only access in Control Panel. Enabling a folder in the Console approves it as a photo source; it does not change DSM permissions.

The package preserves its application data under `/var/packages/StudioGallery/var` during upgrades.

## Network layout

DSM's Package Center installs the required `Node.js v22` package first. Three node processes run as the package user:

- `gateway.mjs` on port 3215, the only port reachable from the LAN. It sends `/api/*` straight to the backend and every other path to Next.js.
- The backend on `127.0.0.1:3211` and Next.js on `127.0.0.1:3210`.

Login and access rate limits count each client address separately. The gateway always replaces `X-Forwarded-For` with the real peer address. It keeps a forwarded address only when the request comes from loopback, which is how DSM's own Reverse Proxy on the same NAS connects.

`PUBLIC_ORIGIN` lives in `/var/packages/StudioGallery/var/.env`. If it is empty, the package detects the NAS LAN address at each start and uses `http://<lan-ip>:3215`. If customers open a domain or HTTPS address through DSM Reverse Proxy, set that exact origin and restart the package.

Logs are in `/var/packages/StudioGallery/var/logs`. A log over 5 MB is rotated when the package starts.

## Build and updates

`node scripts/build-spk.mjs --build <n>` produces `dist/StudioGallery-x86_64-<version>-<n>.spk` and `dist/release.json` on any OS; backend dependencies are installed for linux-x64/glibc, and a static FFmpeg plus ExifTool are bundled in `bin/`. `release.yml` publishes both files on a `v*` tag. Package Center learns about new releases from the package source `http://127.0.0.1:3215/api/pkg-source`, which reads the latest GitHub release of `UPDATE_REPO` (default `Andyict/studio-gallery`).
