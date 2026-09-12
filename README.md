# Homeio

A self-hosted server manager with a desktop-style UI. Alternative to CasaOS, Umbrel, and Portainer — focused on a modern interface, real-time system visibility, and Docker app management.

<p align="center">
  <a href="https://github.com/doctor-io/homeio/stargazers"><img src="https://img.shields.io/github/stars/doctor-io/homeio?style=for-the-badge&logo=github&color=2563eb" alt="GitHub Stars" /></a>
  <a href="https://demo.homeio.app"><img src="https://img.shields.io/badge/Live%20Demo-demo.homeio.app-10b981?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Demo" /></a>
  <a href="https://github.com/doctor-io/homeio/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge" alt="MIT License" /></a>
  <a href="https://github.com/sponsors/doctor-io"><img src="https://img.shields.io/github/sponsors/doctor-io?style=for-the-badge&color=ec4899" alt="GitHub Sponsors" /></a>
</p>

<p align="center">
  <img src="public/screenshots/demo.gif" alt="Homeio demo — desktop shell, command palette, file manager, and terminal" width="100%" />
</p>

<p align="center">
  <a href="https://demo.homeio.app"><strong>🖥️ Live demo</strong></a> &nbsp;·&nbsp;
  <code>homeio</code> / <code>homeio26</code>
  &nbsp;·&nbsp;
  <a href="https://github.com/doctor-io/homeio"><strong>⭐ Star on GitHub</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/sponsors/doctor-io"><strong>💖 Sponsor</strong></a>
</p>

## Why Homeio

Most self-hosted managers give you a dashboard of tiles. Homeio gives you a
desktop: windows you can move and stack, a dock, and `⌘K` to jump anywhere.

- **It manages the machine, not just the containers.** Files, disks, network,
  USB drives, scheduled tasks and a terminal are built in — not add-on apps.
- **Everything is live.** CPU, memory, disk, container stats and logs stream
  over SSE. No refresh button.
- **It runs on a Raspberry Pi.** Native amd64 and arm64 images.
- **MIT.** The whole server manager is in this repository — nothing here is a
  trial, a demo tier, or a feature waiting for a licence key.

## Quick start

```bash
git clone https://github.com/doctor-io/homeio.git
cd homeio
docker compose up -d
```

Open **http://localhost:12026**, create your account, done. The database ships
with it — nothing else to install.

> Try it first at **[demo.homeio.app](https://demo.homeio.app)** — `homeio` / `homeio26`

## Screenshots

| Desktop | App Store |
|---------|-----------|
| ![Desktop](public/screenshots/home.png) | ![App Store](public/screenshots/app-store.png) |

| Settings | Terminal |
|----------|----------|
| ![Settings](public/screenshots/settings.png) | ![Terminal](public/screenshots/terminal.png) |

## How it compares

|  | **Homeio** | CasaOS | Umbrel | Portainer |
|---|---|---|---|---|
| Interface | Desktop shell — windows, dock, `⌘K` | App dashboard | App dashboard | Admin console |
| Built for | Running the whole server | Home apps | Home apps | Container operations |
| Docker apps | Compose app store — reads CasaOS store archives | Compose app store | Curated app store | Stacks and containers |
| Files · disks · network · terminal | Built in | Partly | Mostly via apps | Containers only |
| Remote access | Tailscale built in — no port forwarding | — | Tailscale / Tor | Bring your own |
| Licence | **MIT** | Apache-2.0 | Source-available | zlib (CE) + paid Business |

Homeio is the youngest of the four and the smallest. What it trades in maturity
it spends on the interface and on treating the host as a first-class citizen.

## Features

- Desktop shell UI with dock, windows, command palette (`⌘K`), widgets, and lock screen
- Real-time system metrics (CPU, memory, disk, network) via SSE
- App Store: install, update, uninstall Docker Compose apps — compatible with CasaOS store archives
- File manager: browse, upload (with progress), download, multi-select copy/move, conflict resolution, audio/video/image/PDF preview, Monaco code editor
- Terminal with command allowlist (ls, cat, docker, df, ping, and more)
- Tailscale integration: install, activate, and monitor your tailnet from Settings — reach your server from anywhere without port forwarding
- Runs on amd64 and arm64 — Raspberry Pi 4/5 pull a native image

<details>
<summary><strong>And 12 more — logs, backups, cron, USB, Samba, 2FA, Google Drive…</strong></summary>

- Container log viewer: real-time streaming, log-level badges, keyword filter, download
- Scheduled tasks: built-in cron runner for shell commands, app restarts, backups, and image pulls — no SSH required
- Notification system: real-time alerts for app events, container crashes, disk warnings, and task failures
- USB drive support: auto-detect, mount, browse, and eject removable drives from the file manager
- Local folder sharing over Samba and SMB network mount/unmount
- Docker container stats in real time
- Network manager: WiFi and Ethernet via NetworkManager
- Google Drive: connect accounts over OAuth 2.0 and browse Drive alongside local and network locations in the file manager
- Two-factor authentication (TOTP) with backup codes — works with any authenticator app
- Disk manager and server info: drives, partitions, mount points, thermal sensors, and usage warnings
- Mobile app (preview): a Capacitor shell for Android and iOS that reaches your server over Tailscale
- PostgreSQL-backed persistence

</details>

---

## Install

### Docker (recommended)

Requires Docker and Docker Compose.

```bash
git clone https://github.com/doctor-io/homeio.git
cd homeio
docker compose up -d
```

Open `http://localhost:12026` → create your account → done.

Database is included — no external setup needed. On first run the app routes to `/register`. After you create your account, registration closes automatically.

> **Security:** change `AUTH_SESSION_SECRET` in `docker-compose.yml` before exposing outside your LAN.

**Update:**

```bash
docker compose pull && docker compose up -d
```

### Linux install script

For bare-metal or VM installs on Debian/Ubuntu/Raspberry Pi OS:

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/install.sh | sudo bash
```

The app listens on `127.0.0.1:12026` and is exposed on `:80` via Nginx.

**Update:**

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/update.sh | sudo bash
```

**Uninstall** — removes the services, the application, its database and its
configuration. Your files under `/DATA` (AppData, Documents, Media, Download,
Backups) and your Docker containers, images and volumes are kept:

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/uninstall.sh | sudo bash
```

To erase your content as well, run a factory reset from **Settings → Power**
before uninstalling: it wipes `/DATA`, the Docker state and the tailnet
registration, then reboots into a clean install.

---

## Security Notes

- Change `AUTH_SESSION_SECRET` to a random 32+ character string before exposing outside your LAN
- Put Homeio behind a TLS reverse proxy for HTTPS — the `Secure` cookie flag is set automatically when requests arrive over HTTPS. Tailscale ships integrated and can serve Homeio over HTTPS on your tailnet with no port forwarding and no certificates to renew.
- Enable two-factor authentication (Settings → Users & Access) before exposing Homeio beyond your LAN
- The built-in terminal enforces a strict command allowlist — it is not a full shell

---

## Limitations

- **Single user** — one account per installation; registration closes after first setup
- **Linux only** — the install script targets Debian/Ubuntu/Raspberry Pi OS; Docker works on any platform
- **Network manager** — WiFi/Ethernet management requires NetworkManager with D-Bus
- **USB drive support** — requires `udisks2` and `udev` on the host; not available inside Docker without extra configuration
- **App Store hardware compatibility** — some templates require specific hardware (e.g. Raspberry Pi GPU); edit the compose file to remove optional hardware requirements

---

## Experimental Features

- **Shutdown** — shuts down the OS from the UI; requires physical power-on to recover
- **Factory reset** — wipes all Homeio data; irreversible
- **Self-update rollback** — restores previous version on failed update; not tested under all failure scenarios

---

## Development

**Requirements:** Node.js 22.x, npm, PostgreSQL

```bash
npm install
cp .env.example .env.local
createdb home_server
npm run db:init
npm run dev
```

Open `http://localhost:3000`. Routes to `/register` if no users exist.

**Useful commands:**

```bash
npm run test        # Run tests
npm run lint        # ESLint
npm run build       # Production build
npm run db:migrate  # Run migrations
npm run db:reset    # Reset database (destructive)
```

---

## Telemetry

In production, Homeio sends one anonymous ping to [PostHog](https://posthog.com) on startup. This tells us how many instances are active and which versions are in use — nothing more.

What is collected: a random instance UUID (generated once, stored in your local database), Homeio version, Node.js version, CPU architecture, and OS platform. No IP address, no usernames, no file paths, no app names.

To opt out, set `HOMEIO_TELEMETRY=false` in your environment.

---

## Support Homeio

Homeio is open-source and built for the homelab and self-hosting community. If you find it useful:

- [Sponsor on GitHub](https://github.com/sponsors/doctor-io)
- Contribute code or ideas — see [CONTRIBUTING.md](./CONTRIBUTING.md)
- Share Homeio with others in the homelab community

Your support helps fund ongoing development: real-time infrastructure tooling, Docker management, documentation, and long-term maintenance.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Where Homeio is heading: [ROADMAP.md](./ROADMAP.md).

## License

MIT — see [LICENSE](./LICENSE).
