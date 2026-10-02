# Contributing

This file is the canonical contributor guide. The root `CONTRIBUTING.md` points here to avoid divergent instructions.

## Local Development Setup

Requirements:

- Node.js 22.x
- npm
- PostgreSQL
- Docker for Docker/App Store integration testing
- Linux with NetworkManager/D-Bus only if working on network or USB host features

```bash
npm install
cp .env.example .env.local
createdb home_server
npm run db:init
npm run dev
```

Open `http://localhost:3000`. The app routes to `/register` if no users exist.

For Docker-based local setup, `docker-compose.yml` runs Homeio plus PostgreSQL and mounts the Docker socket.

## Environment

Add server env vars to `lib/server/env.ts` and `.env.example`. Feature code should use `serverEnv`, not direct `process.env`.

Important env vars include:

- `DATABASE_URL`
- `PG_MAX_CONNECTIONS`
- `AUTH_SESSION_SECRET`
- `AUTH_SESSION_HOURS`
- `AUTH_ALLOW_REGISTRATION`
- `LOG_LEVEL`
- `LOG_TO_FILE`
- `STORE_STACKS_ROOT`
- `STORE_APP_DATA_ROOT`
- `STORE_MAX_CONCURRENT_OPERATIONS`
- `FILES_ROOT`
- `DOCKER_SOCKET_PATH`
- `PODMAN_ROOTLESS_SOCKET_PATH`
- `DBUS_HELPER_SOCKET_PATH`
- `TERMINAL_WS_REQUIRE_AUTH`
- `HOMEIO_TELEMETRY`
- `HOMEIO_TELEMETRY_URL`
- `DEMO_MODE`

## D-Bus Helper

Network and USB host features depend on `services/dbus-helper/`. It is plain ESM JavaScript and talks to NetworkManager/udisks2 over D-Bus. Do not change it as part of a main-app-only task without running its tests and verifying the sidecar separately.

## Workflow

Branches:

- `main`: stable
- `feature/<name>`: new features
- `fix/<name>`: bug fixes

Commits use conventional prefixes:

```text
feat: add Google Drive integration
fix: prevent EventSource reconnect loop after log.end
refactor: extract surface tokens to lib/ui/surface-tokens
docs: update roadmap for v1.5
```

Before opening a PR:

```bash
npm run lint
npm run build
npm run test
```

If touching the schema:

```bash
npm run db:generate
npm run db:migrate
```

Use `npm run db:init` for local initialization with care; it drops Drizzle migration history before rerunning migrations.

## Add A Feature Module

Read [AGENTS.md](./AGENTS.md) and [conventions.md](./conventions.md). In short:

1. Put client UI in `modules/<feature>/`.
2. Put server code in `lib/server/modules/<feature>/`.
3. Put shared contracts in `lib/shared/contracts/`.
4. Put query keys in `lib/shared/query-keys.ts`.
5. Add API routes under `app/api/v1/<feature>/`.
6. Add tests beside changed code.
7. Document the module under `doc/modules/`.

## Design System

Homeio uses shadcn/ui on Radix primitives plus Homeio surface tokens. Prefer tokens in `lib/ui/surface-tokens.ts`:

| Token | Use |
|---|---|
| `PANEL_SHELL` | Outer panel or window content shell |
| `PANEL_INSET` | Inner section |
| `BADGE_SURFACE` | Badge/chip |
| `MENU_SHELL` | Popovers and menus |

Use `cn()` from `@/lib/utils`.

## PR Checklist

- Code follows [conventions.md](./conventions.md).
- Protected `/api/v1/**` routes call `requireApiSession()`.
- New APIs have contracts in `lib/shared/contracts/`.
- New query keys are in `lib/shared/query-keys.ts`.
- Server files under `lib/server/` import `"server-only"`.
- Tests cover service logic, route validation, and critical UI behavior.
- `npm run lint`, `npm run test`, and relevant build/db commands were run.
- Docs were updated when public routes, modules, env vars, or schemas changed.
