# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.11.1] - 2026-10-28

### Added

- **Weather without the browser's location (#70).** Settings → General has a **Weather location**: search a city, or take this browser's position once. It is saved on the server, so every device shows the same weather without asking for permission, also over Tailscale or a plain LAN address where browsers refuse geolocation. With no location set, each browser uses its own as before. The weather popover now says why there is no weather: no location yet, or the weather service could not be reached.
- **24-hour clock (#75, thanks @zahornyak).** Settings → General → **Time format** switches the status bar and lock screen clocks between 12-hour and 24-hour. The default follows the language, and the clocks change at once, without a reload.
- **Europe/Kyiv time zone (#74, thanks @zahornyak).**
- **Settings → About.** A new page at the bottom of Settings with the installed version and its release notes, the GitHub stars, the Discord, the number of active Homeio servers from homeio.app/stats, and links to sponsor the project. The stars and the server count are fetched by the browser only while the page is open.
- **Discord.** Homeio now has a community server: [discord.gg/KFzTbRbex3](https://discord.gg/KFzTbRbex3), for help, app configs and ideas.

### Fixed

- **Network readouts (#66, #69, thanks @ikhsanddy).** On a server wired to the network with an idle Wi-Fi radio, the status bar reported `wlan0` as offline with zero rates; it now reports the wired link. VPN tunnels such as `tailscale0` or `wg0` with an address now show as **Up** instead of **Unknown**, without a fake all-zero MAC.

### Security

- **Dependency updates:** `next` 16.4.3 (unauthenticated remote code execution in `use cache`, denial of service with Server Actions; the SVG image-optimizer issue did not apply, Homeio does not use the optimizer), `ip-address`, and in the development tools `vite` 8.3.3 (#72), `esbuild` 0.25 and `vitest` 4.1.12.

### Changed

- **Contributors:** the verify job now runs on pull requests (#68), and `PROJECT_AUDIT.md` is marked as a 1.6.1 snapshot (#67), thanks @ikhsanddy.

---

## [1.10.3] - 2026-10-14

### Fixed

- **Contributor tooling (thanks @cannnz).** The pre-commit hook ran the tests in watch mode and never returned in a terminal; it now runs them once (#62). `npm run test:coverage` timed out on the heavy desktop tests; tests now get 15 seconds (#64). Dead `AGENTS.md` links and stale versions, paths and testing notes in the docs are fixed (#61, #63).

### Security

- **Dependency updates (#60):** `compression` 1.8.2 (CVE-2026-87776), `next` 16.4.0, `sharp` 0.35.5 and others.

---

## [1.10.2] - 2026-10-12

### Added

- **Name, icon and link for containers Homeio did not deploy (#55).** App Settings in their right-click menu now opens a small panel to give them a display name, an icon URL and the URL **Open Dashboard** and **Copy URL** go to. Empty fields fall back to the Docker name and the default icon. The settings are kept by container name, so they survive the container being recreated.
- **The Terminal is a real shell (#58).** It now opens a full login shell on the server over the existing `/api/terminal` WebSocket, the same one an SSH login would give: on a direct install that is root, so `git`, `apt`, editors, `top` and anything else that runs in a terminal works, with colours, resizing, links and scrollback. Copy and paste are **Ctrl+Shift+C** / **Ctrl+Shift+V**, as in Ubuntu's terminal. **Open in Terminal** on an app drops into a shell inside its container. When the shell exits, Enter starts a new one. Where the shell cannot run (the Docker image, demo mode) the window falls back to the previous command terminal and its allow list.

### Fixed

- **The terminal WebSocket could never open a shell.** It loaded node-pty through a default import the package does not have, so every session failed with `Cannot read properties of undefined (reading 'spawn')`. On script installs, nginx also dropped the WebSocket upgrade on its way to Homeio; `/api/terminal` now has its own nginx location that passes it through. The new nginx configuration is written by `update.sh`, so an in-app update applies it on the update after this one; run `curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/update.sh | sudo bash` to apply it at once.

### Security

- **The terminal WebSocket only accepts Homeio's own pages.** Browsers send the session cookie on a WebSocket handshake from any page on the same site, including another app on the server's IP at a different port; the handshake is now refused unless its Origin matches the host it came in on.

---

## [1.10.0] - 2026-10-01

### Added

- **A reminder above the dock when a Homeio update is available.** It shows the new version and the one installed, with **Update now**, **Details** (opens Settings → Updates) and **Later**, which hides it for an hour for that version; a newer version shows straight away. It follows the existing *Update notifications* setting, and is not shown on the lock screen or in demo mode. In the Docker image, where Homeio cannot update itself, it shows `docker compose pull && docker compose up -d` instead of an Update now button; the update status now reports this as `canSelfUpdate`.
- **The desktop shows the real state of every app and container.** Stopped, crashed (with its exit code), restarting, unhealthy, degraded, paused and never started used to look the same, and containers Homeio did not deploy were grey whatever their state. They are now told apart, for Homeio apps and for other containers alike: running apps keep their colours, apps that are down turn grey, and a single glyph marks the states worth a look.
- **The Monitor keeps an hour and a day of history.** CPU, memory, temperature and network (download and upload) are sampled every 5 seconds in the background, even with the Monitor closed, so opening or refreshing it shows the last **15 min** (the default) or **1 h** at full resolution, or the last **24 h** as one-minute averages. Until Homeio has been up for the whole range, the charts spread the history they have across their full width instead of filling in from one side. Each chart shows current, average and peak values and the reading under the pointer. The history lives in the server's memory: it survives page refreshes, not a Homeio restart, and the chart says since when it has data. The temperature chart is left out on machines without a sensor.
- **A fuller Network tab in the Monitor.** Live download and upload, the default gateway and the DNS servers at the top; a throughput chart with the same 15 min, 1 h and 24 h views; and a card per active interface with its type, state, IPv4 and IPv6 addresses, MAC, link speed, DHCP or static address, live traffic, totals since boot and errors. Interfaces that are down or have no address are listed in one collapsed line each, and Docker and bridge interfaces are left out. In the Docker image the tab says it shows the container's network rather than the host's. The 1 h and 24 h charts now keep their real time scale and grey out the part with no data yet, so they look different from the 15 min view.
- **A monitoring Disks tab in the Monitor.** It no longer embeds the disk manager: partitioning, formatting and wiping stay in Settings, one click away through *Manage disks…*. The tab shows disk usage, a read and write throughput chart with the 15 min, 1 h and 24 h views, and a card per disk with its model, type and bus, live read and write speed, SMART health, temperature and power-on time when the disk reports them, and its partitions. Throughput comes from `/proc/diskstats`, so it also works in the Docker image, where partition mount points are left out because the container only sees its own.
- **App icons in the Monitor's container list.** A container that belongs to an installed app, as the app's own container or another service of its Compose stack, shows that app's icon instead of its initial.
- **Every open desktop switches to the restart or update screen.** Only the browser that clicked Reboot, Shut down, Factory reset, Restore or Update used to show it; every other browser and device lost the connection and sat on a dead desktop until someone reloaded it. The action is now announced on the system stream every desktop keeps open, and Homeio waits two seconds before stopping so the message goes out.
- **A reconnecting screen when Homeio stops answering.** A crash, a restart from the terminal, an update over SSH or a dropped network used to freeze the desktop with no explanation. A screen now fades in over the desktop, says how long Homeio has been away and keeps trying, with a **Try now** button. After 45 seconds it shows the restart command for your install (`systemctl` for the install script, `docker restart` in Docker). When Homeio answers again it says so and reloads if needed.

### Changed

- **Homeio is open source again, under the AGPL-3.0, from 1.10.0.** The Business Source License used for 1.9.6 and 1.9.7 was meant to stop companies from reselling Homeio, but it made Homeio source-available rather than open source, which kept it out of open source directories and worried contributors. The AGPL-3.0 is OSI-approved and still rules out a closed commercial fork: anyone who distributes a modified Homeio, or runs one as a service for others, must publish their changes under the same license. Use at home or at work is unrestricted. 1.9.5 and earlier stay MIT; 1.9.6 and 1.9.7 stay under the BSL.
- **Update checks follow published releases instead of the `main` branch.** An update used to be offered the moment a PR landed on `main`, minutes before its GitHub release and Docker image existed, so a Docker user pulling at that point got the old image. The check now reads the release GitHub marks as Latest, and **Update now** installs exactly that release's tag. `install.sh` and `update.sh` do the same: without `HOMEIO_REPO_BRANCH` they clone or fetch the latest release's tag with git, and fall back to `main` with a warning when GitHub cannot be reached. Servers that set `HOMEIO_REPO_BRANCH` keep following that branch.
- **The Cloudflare Tunnel connector is a Homeio component, not an app.** The `homeio-cloudflared` container is now labelled `io.homeio.component=cloudflare-tunnel` and no longer shows on the desktop as a container Homeio does not manage; connectors created by older versions are recognised by their exact name. A cloudflared you installed yourself stays a normal app, and Settings → Cloudflare Tunnel warns when it serves the same tunnel as Homeio's connector.
- **The Monitor's Processes tab shows load and temperature at the top.** Net RX and Net TX were container totals since start, not live load; they stay in the Network tab. Their place goes to the 1-minute load average, with the 5 and 15-minute values under it, and the CPU card shows the current temperature in small type. The temperature chart sits next to the network chart and says so when the machine has no sensor. The separate Load Average card is gone, and Disk Usage moved to the Disks tab.
- **The Monitor's history charts are drawn as smooth curves.** Busy charts used to turn into sharp zigzags between 5-second samples. The curve never rises above a peak or dips below zero between two samples.
- **Homeio does much less work when nobody is looking.** System metrics are read from `/proc` and `/sys` instead of spawning about 130 commands per snapshot, which with the new history sampler would have been some 900 commands a minute on an idle server. Temperature, Wi-Fi link, the disk list, preferences, security settings and `docker compose version` are cached for a few seconds to a few minutes and dropped as soon as Homeio changes them.
- **Homeio stays responsive with many desktops open.** Load tests with up to 400 simultaneous users found several bottlenecks, now gone: App Store requests share one catalog check instead of each running their own and rewriting the store registry, API routes look the session up once instead of twice, signed-out visitors share one "do accounts exist" lookup, and Homeio listens with a deeper accept queue. On script installs nginx keeps more idle connections to Homeio, closes them before Node does (which caused random 502 errors), and allows 4096 connections per worker instead of 768.
- **The log file is rotated at 10 MB, and the Logs window opens instantly.** The file grew forever (81 MB after two months on the demo) and each Logs open read all of it to show the last 500 lines. Homeio now keeps the current file and one previous one, writes lines in batches, and reads the Logs window from the end of the file.

### Security

- **Security headers on every response, and nginx no longer shows its version.** The dashboard controls the whole machine, but nothing stopped another site from embedding it in a hidden frame to trick a signed-in admin into clicking. Homeio now sends `X-Frame-Options: DENY`, a `frame-ancestors 'none'` Content Security Policy, `X-Content-Type-Options: nosniff`, a Referrer-Policy, a Permissions-Policy that denies the camera and microphone and keeps location for Homeio's own pages, and HSTS. Because the app sends them, they apply behind the Cloudflare tunnel, behind nginx and in the Docker image. `install.sh` and `update.sh` also turn off `server_tokens` in nginx.
- **Uploads are checked by Homeio before nginx streams them.** On script installs nginx sent uploads straight to the upload server, which only checked the cookie's signature: a signed-out cookie kept working until it expired, and demo visitors could upload while every other change was refused. nginx now asks Homeio first, which checks the session in the database and applies demo mode. The upload server keeps its own check as a second layer. Docker installs were not affected.

### Fixed

- **fail2ban would not start on Debian 12 and later.** These releases no longer ship rsyslog, so `/var/log/auth.log` does not exist and fail2ban gave up on the SSH jail. `install.sh` and `update.sh` now set fail2ban to read the systemd journal and install `python3-systemd`, which it needs for that.
- **The Monitor's Disks tab was always empty in the Docker image, and said nothing about why.** Disks are listed with `lsblk`, which the image did not include, and any failure was turned into an empty list. The image now ships `lsblk`, so Docker installs list the host's disks, read-only: formatting, partitioning, mounting and wiping are disabled there with a note that they need the script install. When disks cannot be listed at all, the tab now gives the reason (not Linux, `lsblk` missing). Empty network block devices and zram swap are no longer listed as disks.
- **The in-app update installed `main` even on a server following another branch.** The check compared against `HOMEIO_REPO_BRANCH`, but `update.sh` ran without it and fell back to `main`, so the version offered and the version installed could differ.
- **Uploads failed with a 502 after a reboot or a restart of the D-Bus helper.** The upload server and the D-Bus helper shared `/run/home-server`, so restarting either one deleted the other's socket. The upload server now has its own runtime directory, `/run/home-server-upload`.
- **The update check could fail for everyone on a busy server.** Every desktop and Settings load asked GitHub for the latest release, and GitHub allows 60 unauthenticated calls an hour, so a busy server (the public demo, within minutes) got an error until the hour reset. The latest version is now remembered for an hour, a failed check is retried after five minutes, and the last known version is shown in the meantime. **Check now** still asks GitHub directly.

### Removed

- **The tarball install path.** `install.sh` and `update.sh` only install with git now. `HOMEIO_RELEASE_TAG` and `HOMEIO_RELEASE_TARBALL_URL` stop the script with a message instead of being ignored; pin a version with `HOMEIO_REPO_BRANCH=v1.10.0`, which fetches that tag with git. The tarball path in `update.sh` ran `rsync --delete` without excluding `.env` or `bin/`, so it would have deleted the server's configuration.

---

## [1.9.7] - 2026-09-26

### Changed

- **The usage stats ping says how Homeio is installed and on which distribution.** Every server reported `linux` as its OS, which told nobody anything. The ping now adds `install` (`docker` or `host`) and, for host installs, the `ID` and `VERSION_ID` from `/etc/os-release`, such as `debian` `12` or `ubuntu` `24.04`. Docker installs send no distribution: inside a container that file describes the image, not the machine. The kernel version is deliberately left out; it is close to unique per machine and says little. [homeio.app/stats](https://homeio.app/stats) shows both breakdowns.

---

## [1.9.6] - 2026-09-26

### Security

- **Dependencies with known vulnerabilities are updated.** Next.js 16.3.6 fixes server-side request forgery, a proxy bypass and several denial-of-service bugs; systeminformation fixes a command injection in `networkInterfaces()`, which Homeio calls for system stats; drizzle-orm, js-yaml, ws, sharp and a set of transitive packages are patched too. `npm audit --omit=dev` now reports nothing. The optional `usocket` add-on used by the D-Bus helper pulled in node-gyp 7 and the long-deprecated `request`; it is now built with node-gyp 11. The mobile app moves to Vite 8.
- **Partitions can only be mounted inside `/mnt`, `/media`, `/srv` or `/DATA`.** A mount point was accepted anywhere outside a short blocklist, so a partition could be mounted over `/etc/ssh` or `/root` and hide what was there. The folders themselves are refused too, so a mount can't cover `/DATA`.
- **Two slow regular expressions in the Cloudflare Tunnel settings are gone.** A domain or subdomain made of a long run of `/` or `-` took quadratic time to normalize.

### Changed

- **Homeio is now source-available under the Business Source License 1.1, replacing MIT.** Running it for yourself, your household or your organization stays free, including in production and with modifications. What needs a commercial license is offering it to others as a hosted or managed service, or selling it, including preinstalled on hardware. Each version converts to the Apache License 2.0 four years after release. Versions up to and including 1.9.5 remain MIT.

---

## [1.9.5] - 2026-09-26

### Added

- **Anonymous usage stats, with public totals.** A minute after startup and then every 12 hours, a production server sends a random instance ID, the Homeio version, the CPU architecture and the OS to `https://homeio.app/api/stats`. Nothing else is sent, and the IP address is not stored. The counts are public at [homeio.app/stats](https://homeio.app/stats), so what is collected and what it shows are both visible. Turn it off in Settings → Advanced → Usage Stats, or with `HOMEIO_TELEMETRY=false`, which also locks the setting off.

### Fixed

- **The README described telemetry that no longer existed.** The PostHog startup ping was removed in 1.5.10, but the README and `.env.example` kept documenting it while the roadmap said there was none. All three now describe the stats ping above.

---

## [1.9.3] - 2026-09-16

Also from [#37](https://github.com/doctor-io/homeio/issues/37), found because the reporter had created a second account on his own single-user server without meaning to.

### Security

- **A script-installed server reachable from the internet would create an account for anyone who asked.** Registration was gated on `usersExist && !AUTH_ALLOW_REGISTRATION` — an environment variable duplicating a fact the database already held — and `install.sh` wrote that variable as `true` and never turned it off. `.env.example` said `false`, which is why it went unnoticed; Docker installs defaulted closed and were never affected. There are no roles in Homeio, so a second account carries the same access as the first: terminal, files, Docker, disk operations, factory reset. The register *page* redirects away once an account exists, so the UI hid this; the API enforced nothing.

  The variable is removed rather than corrected. The database decides: one account, and registration closes behind it.

  **If you installed with `install.sh` and published your server**, check Settings → Users for accounts you did not create. Existing accounts keep working after this update — it only prevents new ones.

---

## [1.9.2] - 2026-09-16

Issue [#37](https://github.com/doctor-io/homeio/issues/37): locked out on the
registration page, on a server that already had an account.

### Fixed

#### Authentication behind a proxy or CDN

- **A cache in front could lock everyone out of their own server.** The proxy set
  no `Cache-Control` on its own responses, so a tunnel or CDN configured to cache
  aggressively was free to keep them — including the `307 -> /register` an install
  answers while it is still empty. Once that redirect was cached, every later
  visitor was sent to registration however many accounts existed, and an
  authenticated one had their session cookie cleared on the way back. Incognito,
  another browser and another device all failed identically, because the cache sat
  upstream of all three. Every non-static response now says `private, no-store`;
  immutable assets never reach that middleware and keep their long-lived caching.
  The documentation recommends putting Homeio behind exactly such a tunnel.
- A failed "are there any accounts" lookup was read as "fresh install". A momentary
  database or network hiccup therefore signed everyone out and offered the machine
  up for registration. Not knowing now answers "accounts exist": a genuinely fresh
  install pays one redirect to `/login`, where the old answer cost a running
  install its sessions.

#### Container logs

- Containers that colour their output — most Node images, Uptime Kuma among them —
  had their escape sequences printed as literal `[36m` and `[38;5;119m` noise, most
  of the width of the pane. Worse, `\x1b[33mWARN:` leaves no word boundary before
  WARN, so level detection missed it and the line fell through to the stderr badge:
  every warning was labelled a red error. Escapes are stripped where the line is
  parsed, so the level is read from clean text.

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
