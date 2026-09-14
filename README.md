# Homeio

A self-hosted server manager with a desktop-style UI. Alternative to CasaOS, Umbrel, and Portainer — focused on a modern interface, real-time system visibility, and Docker app management.

<p align="center">
  <img src="public/screenshots/demo.gif" alt="Homeio demo — desktop shell, command palette, file manager, and terminal" width="100%" />
</p>

<p align="center">
  <a href="https://demo.homeio.app"><strong>🖥️ Live demo</strong></a> &nbsp;·&nbsp;
  <code>homeio</code> / <code>homeio26</code>
  &nbsp;·&nbsp;
  <a href="https://github.com/sponsors/doctor-io">
    <img src="https://img.shields.io/github/sponsors/doctor-io?style=for-the-badge" alt="GitHub Sponsors" />
  </a>
</p>

## Screenshots

| Desktop | App Store |
|---------|-----------|
| ![Desktop](public/screenshots/home.png) | ![App Store](public/screenshots/app-store.png) |

| Settings | Terminal |
|----------|----------|
| ![Settings](public/screenshots/settings.png) | ![Terminal](public/screenshots/terminal.png) |

## Features

- Desktop shell UI with dock, windows, command palette (`⌘K`), widgets, and lock screen
- Real-time system metrics (CPU, memory, disk, network) via SSE
- App Store: install, update, uninstall Docker Compose apps — compatible with CasaOS store archives; add your own catalog sources
- Cloudflare Tunnel: publish an app on a public hostname from the UI — Homeio creates the DNS record and the ingress rule for you
- Backup and restore: scheduled archives of the database, your files and your compose stacks, restorable from the UI
- Container log viewer: real-time streaming, log-level badges, keyword filter, download
- File manager: browse, upload (with progress), download, multi-select copy/move, conflict resolution, audio/video/image/PDF preview, Monaco code editor
- Scheduled tasks: built-in cron runner for shell commands, app restarts, backups, and image pulls — no SSH required
- Notification system: real-time alerts for app events, container crashes, disk warnings, and task failures
- USB drive support: auto-detect, mount, browse, and eject removable drives from the file manager
- Local folder sharing over Samba and SMB network mount/unmount
- Terminal with command allowlist (ls, cat, docker, df, ping, and more)
- Docker container stats in real time, including containers Homeio did not deploy
- Network manager: WiFi and Ethernet via NetworkManager
- Weather widget with location-based conditions
- PostgreSQL-backed persistence

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

**Uninstall** (keeps data):

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/uninstall.sh | sudo bash
```

**Full purge** (removes everything):

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/uninstall.sh | sudo bash -s -- --purge --yes
```

---

## Security Notes

- Change `AUTH_SESSION_SECRET` to a random 32+ character string before exposing outside your LAN
- Put Homeio behind a TLS reverse proxy for HTTPS — the `Secure` cookie flag is set automatically when requests arrive over HTTPS. A built-in reverse proxy manager with automatic Let's Encrypt certificates is planned; in the meantime, Cloudflare Tunnel gives you HTTPS on a public hostname without opening a port.
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

## Roadmap

See [ROADMAP.md](./ROADMAP.md) — currently shipping v1.9. Recent releases are in [CHANGELOG.md](./CHANGELOG.md).

**Planned next:**
- Metrics history — persist and graph system and container metrics with time-range selectors (1 h / 24 h / 7 d / 30 d)
- SMART disk health — real-time drive health status, temperature, and pre-failure alerts via `smartctl`
- Hardware sensor monitoring — CPU die temperature, NVMe temp, and fan RPM
- Docker image manager — browse, pull, inspect, and remove images directly without compose files
- Webhooks — outbound HTTP notifications to Home Assistant, n8n, and other services
- File manager enhancements — zip/unzip, bulk rename, batch delete

## Support Homeio

Homeio is open-source and built for the homelab and self-hosting community. If you find it useful:

- [Sponsor on GitHub](https://github.com/sponsors/doctor-io)
- Contribute code or ideas — see [CONTRIBUTING.md](./CONTRIBUTING.md)
- Share Homeio with others in the homelab community

Your support helps fund ongoing development: real-time infrastructure tooling, Docker management, documentation, and long-term maintenance.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
