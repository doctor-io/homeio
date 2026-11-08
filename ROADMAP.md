# Homeio Roadmap

This document outlines what has shipped, what's being built now, and what's being considered. It's a living document — priorities shift based on community feedback. If something here matters to you, open an issue or leave a 👍 on the relevant discussion.

**Current stable release:** [v1.11.2](https://github.com/doctor-io/homeio/releases/tag/v1.11.2) (2026-11-08)  
**In active development:** [Homeio 2.0](#homeio-20--in-progress)

---

## Homeio 2.0 — in progress

> *A new desktop, AI assistants that can run your server, and Homeio in your pocket.*

- **A new desktop** — a full redesign of the interface, from the dock and windows to Settings and the App Store
- **MCP server** — connect Claude, ChatGPT, Cursor or any MCP client and let it install apps, read logs and check your server, with your approval for anything that changes it
- **Android app** — a native app to pair with your server and keep an eye on your apps and system from your phone
- **Container control** — start, stop, restart and read the logs of containers Homeio did not deploy (#73)

---

## Shipped

### v1.11 — November 2026

- Weather location set once for the whole server, no browser geolocation needed (#70)
- 24-hour clock and the Europe/Kyiv time zone (#74, #75)
- Settings → About: installed version, release notes, Discord and sponsor links
- Docker install: apps that chown their data folder install again, app data lands in the mounted `/DATA`
- Network readouts: the wired link is reported instead of an idle Wi-Fi radio, addressed tunnels show as Up (#66, #69)

### v1.10 — October 2026

- Open source again, under the AGPL-3.0
- The desktop shows the real state of every app and container: stopped, crashed (with its exit code), restarting
- The Monitor keeps an hour and a day of history for CPU, memory, temperature and network, with fuller Network and Disks tabs
- An update reminder above the dock, and update checks that follow published releases
- The Cloudflare Tunnel connector became a Homeio component
- The Terminal is a real login shell (#58); name, icon and link for containers Homeio did not deploy (#55)
- Security headers on every response, uploads checked before nginx streams them

### v1.9 — September 2026

- Anonymous usage stats with public totals at [homeio.app/stats](https://homeio.app/stats)
- Security fixes: open sign-up on internet-facing script installs, backup restore, partition mount points

### v1.4 – v1.8 — spring and summer 2026

- Desktop shell with command palette (`⌘K`), dock, windows, widgets and lock screen
- Container logs viewer with live streaming, log-level badges, keyword filter and download
- Monaco file editor, full-screen file preview, archive extraction
- Notifications, scheduled tasks
- USB drives, disk and partition manager, Google Drive in the file manager
- Two-factor authentication (TOTP) with backup codes
- Cloudflare Tunnel: publish an app on a public hostname from the UI
- Raspberry Pi hardening: authenticated SSE streams, compose timeouts, heap cap, multi-arch (`amd64` / `arm64`) Docker image

---

## Under Consideration

These are not scheduled. Community interest decides if and when they move to a release — open an issue or leave a 👍 on an existing one.

**Monitoring**
- **SMART disk health** — drive status, temperature and pre-failure alerts via `smartctl`
- **More hardware sensors** — NVMe temperature and fan RPM (CPU temperature is already in the Monitor)
- **Longer metrics history** — 7 and 30 days, beyond today's hour and day
- **Observability stack** — a Prometheus endpoint and an optional Grafana sidecar
- **Webhooks** — outbound notifications to Home Assistant, n8n and other services

**Apps and Docker**
- **Link-only apps** — desktop tiles that open a URL, with no container behind them (#76)
- **Portainer-style container control** — create containers straight from an image, inspect them, open a shell inside (#73)
- **Docker image manager** — browse, pull, inspect and remove images without compose files
- **Podman support** — run Homeio on Podman instead of Docker, including rootless containers (#54)
- **External secret management** — Docker secrets or encrypted `.env` files for app credentials

**Network and access**
- **Built-in reverse proxy** — custom domains with Let's Encrypt certificates, without Cloudflare
- **Dynamic DNS** — keep a domain pointed at a changing home IP
- **Multi-user** — roles (admin, user, viewer), per-app access and an audit log
- **API tokens** — scoped tokens for scripts and integrations

**Files and platform**
- **File manager extras** — create zip archives, bulk rename, batch delete
- **ARMv7** — 32-bit Raspberry Pi 2/3 support
- **Terminal multi-pane** — split panes and named tabs
- **SSE multiplexing** — one connection instead of several streams, for low-memory devices

---

## What This Project Is Not

To set clear expectations for contributors and users:

- **Not a NAS OS replacement** — Homeio manages applications and files but does not aim to replace TrueNAS, Unraid, or similar full NAS operating systems
- **Not a Kubernetes orchestrator** — Docker Compose is the deployment target; Swarm/K8s orchestration is out of scope
- **Not a cloud service** — everything runs locally; no Homeio cloud accounts. The only outbound call is an opt-out anonymous stats ping (instance ID, version, arch, OS, install method, distribution) whose totals are public at [homeio.app/stats](https://homeio.app/stats)

---

*Updated November 2026 · [Open an issue](https://github.com/doctor-io/homeio/issues) to suggest a feature or report a problem*
