# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.9.1] - 2026-09-14

Issues [#31](https://github.com/doctor-io/homeio/issues/31), [#32](https://github.com/doctor-io/homeio/issues/32), [#33](https://github.com/doctor-io/homeio/issues/33) and [#35](https://github.com/doctor-io/homeio/issues/35), reported while migrating from CasaOS, plus the faults those reports turned up around them.

### Added

#### Cloudflare Tunnel

- Publish an installed app on a public hostname from Settings → Integrations, without editing the tunnel's ingress by hand. Homeio creates the DNS record and the ingress rule through the Cloudflare API and keeps the catch-all rule last.
- The connector token can be pasted as the whole `cloudflared service install eyJ…` command Cloudflare hands you — the token is extracted from it.
- Tokens are validated before they are stored, so a token that cannot work is refused at the point of entry instead of failing silently later.
- A saved token is masked and its field locked; editing is deliberate rather than accidental.

#### Apps

- An app's link can be set explicitly, for cases where the address Homeio would guess is not the one that reaches it — a tunnel hostname, a reverse proxy, a non-standard port ([#33](https://github.com/doctor-io/homeio/issues/33)).
- Containers running on the host that Homeio did not deploy are listed on the desktop in a muted state, so the machine's real contents are visible in one place ([#31](https://github.com/doctor-io/homeio/issues/31)).
- Custom app definitions imported from a compose file can be removed again.

### Fixed

#### Backup and restore

- **Restoring a backup could empty the database and delete every backup on the machine**, then present the registration screen as though the install were new. The reset dropped only the `public` schema while the migration journal lives in `drizzle`, so the dump's own `CREATE SCHEMA drizzle` failed 25 lines in — with the wipe already committed. The reset and the reload now run as one transaction, the archive is checked for a database dump before anything is deleted, and the stored backups are excluded from the wipe.
- A restore left the app stores the user had added behind: the registry lives beside the compose stacks rather than under the data root, and was never part of the archive. It is archived and restored now, and an older archive that does not carry one leaves the sources on disk alone.
- A successful restore ended with no container running. `docker compose down` removes the containers, so nothing was left for a restart policy to revive, and the desktop's Start button could not recover it. The stacks are recreated before the reboot.

#### App store

- Adding or removing a store source could silently drop the others. Concurrent read-modify-write cycles on the registry overwrote each other, and a corrupt registry fell back to the official catalog without saying so ([#32](https://github.com/doctor-io/homeio/issues/32)).

#### Integrations

- A tunnel pointed at `localhost` returned 502 on any tunnel with more than one connector. The origin is now the LAN address, overridable with `HOMEIO_TUNNEL_ORIGIN_HOST`.
- Tailscale asked again for details it already had; a connected node now says so instead of showing an empty form.

#### Notifications

- The list is ordered newest-first, and the ordering is applied to the merged list rather than to each half — persisted app events no longer sit above a status snapshot from seconds ago ([#35](https://github.com/doctor-io/homeio/issues/35)).

#### Appearance

- Changing the wallpaper re-downloaded the image twice on every switch; wallpapers are now cached for a year, which over a tunnel is the difference between a click doing nothing and a click working.
- Reloading the page flashed the default wallpaper before the saved one appeared, and the crossfade was too fast to read as a transition.

#### Docker image

- **`docker compose up -d` did not start.** The compose file shipped `change-me-to-a-random-32-char-secret` as the session secret, which production explicitly refuses, so the quickstart in the README crash-looped on the instrumentation hook and answered 500 on `/api/health`. The entrypoint now generates a secret when none is supplied — as the Linux installer has always done — and keeps it in the stacks volume so sessions survive a restart.
- The container had no `docker` CLI and could not reach the socket, so app management degraded silently. The CLI and compose plugin ship in the image, and the entrypoint detects the socket's group.

#### Scripts

- `uninstall.sh` re-enabled nginx's default vhost unconditionally, even on a run that removed nothing. Because that vhost listens with `default_server` and Homeio's does not, the server answered every request by IP with "Welcome to nginx!" while the app kept running — a live server taken off the air by a script that was supposed to have done nothing.
- `uninstall.sh` crashed with `reply: unbound variable` when run non-interactively over SSH.

### Security

- Archive extraction rejects entries that escape their destination, disk wipes validate their target, and sign-in rate limiting now counts per account as well as per address, so a spread of source addresses still trips the lockout.

---

## [1.6.28] - 2026-05-23

### Fixed

#### In-app updater

- **Bug**: in-app updates from 1.6.22+ left the server stuck on "Applying Homeio update…" because `go build` aborted with `GOCACHE is not defined and neither $XDG_CACHE_HOME nor $HOME are defined`. The updater is scheduled via `systemd-run --no-block`, which starts a transient unit with a minimal environment — `$HOME` and `/usr/local/go/bin` were missing. `build_upload_server` exited hard before `start_service` ran, so the recovery screen polled `/api/health` forever.
- Fix: pass `HOME=/root` and an explicit `PATH` (including `/usr/local/go/bin`) to the `systemd-run` invocation in `scheduleSystemUpdate`, and defensively export `HOME`/`GOCACHE`/`GOPATH` inside `build_upload_server` so the script is safe regardless of how it is invoked.

> **Manual recovery for servers already stuck** (the fix can only protect *future* updates):
>
> ```bash
> sudo systemctl start home-server
> sudo bash -c 'export HOME=/root && cd /opt/home-server/services/upload-server && \
>   /usr/local/go/bin/go build -o /opt/home-server/bin/upload-server . && \
>   systemctl restart home-server-upload'
> ```

---

## [1.6.0] - 2026-05-04

### Added

#### Tailscale Integration

- Settings panel for configuring Tailnet and auth key (encrypted at rest)
- Status indicator in the status bar with live popover (hostname, IP, TUN device, connection state)
- Install & activate flow: downloads the official Tailscale Linux client via `install.sh`, enables `tailscaled` via systemd, and runs `tailscale up` — all from the UI
- Local status polling (`tailscale status --json`) with structured error states: `missing_tun`, `service_unavailable`
- Proxmox LXC guidance banner when `/dev/net/tun` is not available

#### Google Drive Integration

- Full OAuth 2.0 flow with encrypted token storage (access + refresh tokens)
- File browser with folder navigation, download, and upload support
- Multiple account connections support
- Redirect URI auto-derived from `window.location.origin` — no manual configuration needed for LAN/Tailscale access

#### Go Upload Sidecar

- Streaming multipart upload server in Go (`services/upload-server/`) routed via nginx Unix socket
- Eliminates Node.js memory pressure for large file uploads (tested up to 10 GB)
- Validates session HMAC locally without a DB round-trip

#### Server Info & Disk Management

- Server information panel: CPU model, RAM, OS, uptime, network interfaces, thermal sensors
- Disk manager: list drives, partitions, usage, mount points
- Disk and temperature warnings in the desktop shell notification area

#### UI — Kora Icon Set

- Replaced all placeholder icons with the Kora SVG icon set
- Added scalable weather, status, and system icons

### Fixed

#### Tailscale (security & correctness — audit follow-up)

- **Bug**: stored auth key was never used for activation; clicking "Activate" with a saved key required retyping it — the install route now reads from the database when no key is provided in the request body
- **Security**: auth key was passed as `--auth-key=<raw>` CLI argument, exposing it in the process list — now written to a mode-0600 temp file and passed as `--auth-key=file:<path>`, cleaned up in `finally`
- **Robustness**: added in-process concurrency lock to prevent overlapping `installTailscale` calls
- **UI**: `status-yellow` CSS token (undefined in theme) replaced with `status-amber`
- **UX**: "Activate" button now enabled when credentials are already saved, even if the auth key field is empty
- **Error display**: install script failures now surface the real `stderr` from `apt-get` instead of a truncated `error.message`

#### Google Drive

- Redirect URI field now shows the correct server URL (`window.location.origin`) instead of always defaulting to `http://localhost:3000`

#### General

- Password fields (`Client secret`, `Auth key`) wrapped in `<form>` elements — eliminates browser accessibility warning and enables Enter-to-submit
- API access hardened; upload route protected
- Upload server Unix socket permissions corrected

### Tests

- 16 new tests covering Tailscale routes and service:
  - `GET /api/v1/system/tailscale/status`: connected, not-installed, error
  - `POST /api/v1/system/tailscale/install`: body key, stored key fallback, no key, TUN error, concurrency guard
  - `getLocalTailscaleStatus`: CLI absent, Running state, missing TUN, service unavailable
  - `installTailscale`: file-based key, temp file cleanup on failure, concurrency rejection

### Infrastructure

- `scripts/install.sh`: hostname configuration, Node 22, Go 1.23, Docker, yq, nginx reverse proxy, systemd units for main app + upload sidecar + D-Bus helper
- `scripts/update.sh`: zero-downtime update flow with service restart
