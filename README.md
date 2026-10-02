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

Podman is supported as an alternative to Docker — pass `HOMEIO_CONTAINER_RUNTIME=podman`, or leave it unset to auto-detect (Podman is used automatically when it's already installed and Docker isn't):

```bash
curl -fsSL https://raw.githubusercontent.com/doctor-io/homeio/main/scripts/install.sh -o install.sh
sudo HOMEIO_CONTAINER_RUNTIME=podman bash install.sh
```

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
- The built-in terminal is a full shell on the host (or inside a container) for whoever is logged in; only the one-off command API is limited to an allowlist
- Found a vulnerability? Report it privately — see [SECURITY.md](./SECURITY.md)

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

In production, Homeio sends a small anonymous ping to `https://homeio.app/api/stats` a minute after startup and then every 12 hours. It tells us how many servers are running and which versions they are on, and the totals are public at [homeio.app/stats](https://homeio.app/stats).

What is sent: a random instance UUID (generated once, stored in your local database), the Homeio version, the CPU architecture, the OS platform, whether it runs in Docker, and — outside Docker — the Linux distribution and its version from `/etc/os-release` (for example `debian` `12`). Inside a container that file describes the image, not your machine, so it is not sent. That is the whole payload; see `lib/server/modules/telemetry/service.ts`. Your IP address is used only to rate-limit the endpoint and is never stored. No usernames, file paths, app names or hardware details are sent.

To opt out, turn off **Settings → Advanced → Usage Stats**, or set `HOMEIO_TELEMETRY=false` in your environment, which also locks the setting off. Demo mode and development builds never send anything.

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

Homeio is free and open source software, licensed under the [GNU Affero General Public License v3.0](./LICENSE) (AGPL-3.0).

- **Use it anywhere**: at home, at work, on as many servers as you like, and change it however you want.
- **Share what you change**: if you distribute a modified Homeio, or run a modified version as a service for other people, you must publish your changes under the AGPL-3.0 as well. Nobody can turn Homeio into a closed product.

License history: versions up to and including 1.9.5 are MIT, 1.9.6 and 1.9.7 are under the Business Source License 1.1, and 1.10.0 onward is AGPL-3.0. Each release stays under the license it shipped with.
