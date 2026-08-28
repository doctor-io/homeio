# Homeio v2.0 — Work Plan

Every work item for the v2.0 release, in the order we agreed. One item = one PR = one
commit + tests. Tick a box only when the item is committed **and** its tests pass.

Design reference (setup wizard): https://claude.ai/code/artifact/94d8eb81-366a-4632-934f-fbedd1cb3be3
Release scope and rationale: [ROADMAP.md](./ROADMAP.md) · Shipped history: [CHANGELOG.md](./CHANGELOG.md)

**Item prefixes:** `W` wizard · `C` custom compose · `H` auto-heal · `K` API keys + Home
Assistant · `X` expose over Tailscale · `M` mobile v2.

---

## Rules that apply to every item

Homeio is running on other people's servers. These are requirements, not preferences.

1. **Additive migrations only.** New tables, or nullable/defaulted columns. No drops, no
   type changes, no data backfills.
   *Why backfills are banned:* Docker runs `drizzle-kit push` ([docker-entrypoint.sh:5](docker-entrypoint.sh:5))
   which syncs schema and never runs migration SQL, while `npm run db:init` drops the
   migration table and **replays every migration from scratch** ([scripts/db-migrate.ts:30](scripts/db-migrate.ts:30)).
   A backfill therefore never runs for real upgraders and re-fires forever for everyone else.
   Every migration must be idempotent (`IF NOT EXISTS`, guarded `UPDATE`).
2. **No breaking API changes.** Existing `/api/v1` routes keep request and response shapes.
   New behaviour goes on new routes or new optional fields.
3. **Off by default.** Every new subsystem stays inert until switched on. An operator who
   updates and changes nothing must get the Homeio they had yesterday.
4. **Kill switch on anything risky.** Container lifecycle and auth changes get an env var
   that disables them without a downgrade.
5. **Auth allowlist may only shrink.** The v1.7 architecture test snapshots the 65
   unauthenticated `/api/v1` routes. Never add to it.
6. **Full suite before every commit.** Compare against the known-failing baseline below —
   do not chase pre-existing failures inside a feature commit.

---

## Track 1 — First-Run Setup Wizard

### [x] W1 — Onboarding state (`70cb3d6`)

Delivered: `settings.onboarding_state / onboarding_step / onboarding_completed_at /
timezone / default_storage_root`, migration `drizzle/0009_onboarding.sql`,
`lib/server/modules/onboarding/{repository,service}.ts`,
`lib/shared/contracts/onboarding.ts`, first-registration hook in the register route.
21 unit tests + 3 register regressions.

**Do not undo this design decision:** the wizard *opts in*, it does not opt out. NULL state
means "install predates the wizard" → setup is skipped. Only the first registration writes
`'pending'`, guarded on `onboarding_state IS NULL`. This is what makes upgrades safe under
both migration paths — see rule 1.

### [x] W2 — Setup API routes

- `GET /api/v1/setup/state` → `OnboardingState`
- `POST /api/v1/setup/step` → persists one step, returns new state
- `POST /api/v1/setup/complete` → terminal; also the "skip everything" path
- All three require a session (`requireApiSession`). **Do not** add them to the public
  allowlist — the user is authenticated by the time setup runs.
- Zod validation on the body; map `OnboardingError.code/statusCode` to the `{error, code}`
  envelope used everywhere else.
- Tests: 401 unauthenticated, 400 bad step, 409 when not pending, happy path per route.

  **Landed.** `app/api/v1/setup/{state,step,complete}/route.ts` + 13 route tests.
  Gotcha for every future route test: `test/setup.ts` mocks
  `@/lib/server/modules/auth/api` **globally** so `requireApiSession` always returns a
  signed-in session. A 401 case must override that module mock locally — mocking
  `authenticateSession` underneath it does nothing, and the test passes while asserting
  nothing.

### [x] W3 — Redirect gate

- Root page redirects to `/setup` when status is `pending`.
- **Never block login, and never trap anyone**: `not_applicable` and `complete` must fall
  through untouched. A failure reading state must fall through, not redirect.
- Decide server-side (the root page is already a server component) so there is no flash of
  the desktop shell before the redirect.
- Tests: pending → redirect; complete → desktop; not_applicable → desktop; DB error → desktop.

  **Landed.** Gate in `app/page.tsx`, guard in `app/setup/page.tsx`, wizard frame in
  `modules/onboarding/components/setup-wizard.tsx` (steps land in W4–W7; W3 ships the frame
  plus a working Skip). Both pages are `force-dynamic` — without it Next prerenders the
  gate and bakes in one answer, the same trap that hid `DEMO_MODE` on /login until 1.7.23.
  `modules/onboarding` added to `FEATURE_MODULES` in the architecture guard.

### [x] W4 — `/setup` shell

- Route and `FullScreenShell` wrapper already exist from W3 — W4 adds the step machinery.
- Centred card + 5-bar pill indicator — **continuing `components/auth/register-form.tsx`**,
  not the left rail the roadmap text describes. The two flows run back to back.
- Resume from the stored `onboarding_step` on load; write progress on every transition.
- `Skip` is a first-class button next to `Back` on every step, never hidden.
- Keyboard: Enter continues, Esc skips, ← goes back.

  **Landed.** Step registry, 5-bar rail, resume, Back/Skip/Continue, keyboard handling —
  all in `modules/onboarding/components/setup-wizard.tsx`, 13 component tests.
  Every transition (Back included) is recorded server-side before the UI moves, so a
  refresh always resumes where the user actually was. A failed save keeps the user on the
  step rather than advancing past an answer the server never stored.
  Step panels are still empty — W5-W7 fill them in.

### [x] W5 — Steps 1–2 (time zone, storage)

- Step 1: timezone (default from `Intl.DateTimeFormat().resolvedOptions().timeZone`),
  12/24h, week start.
- Step 2: drive list from the existing disk manager with free space; warn when the choice
  is the system partition; offer the existing SMB/USB mount flows.
- Both steps must be skippable without leaving a broken install.

  **Landed.** `modules/onboarding/components/steps/{timezone,storage}-step.tsx`, 9 step
  tests + 4 wizard tests for answer handling.

  **Deferred, not dropped:** 12/24-hour clock and first-day-of-week. `AppearanceSettings`
  has no field for either, so they need new appearance keys plus the appearance API — a
  change to a shipped settings surface, which does not belong inside a wizard commit.
  Open a separate item before W7 if you want them in the release.

  **Also note:** the stored `timezone` is recorded but nothing consumes it yet. Making
  scheduled tasks and log timestamps actually honour it is its own work item.

  Two constraints worth keeping: skipping sends no answer (a skipped question must never
  write a value the user did not choose), and the storage step falls back to a path field
  whenever the disk list is empty or fails — Docker without host block devices reports an
  empty list rather than an error, and a dev machine has no `lsblk` at all.

### [x] W6 — Steps 3–4 (Tailscale, 2FA)

- Step 3: embed the existing install-and-activate flow from `modules/integrations`.
  Reuse the `missing_tun` / `service_unavailable` states — do not invent new error handling.
  Ends with the tailnet address + pairing QR (feeds M4).
- Step 4: embed the v1.7 TOTP enrolment (`useTwoFactor`) rather than duplicating it.
  Show a plain warning when step 3 enabled remote access and the user skips this.

  **Landed.** `steps/remote-access-step.tsx` and `steps/two-factor-step.tsx`, 13 tests.
  The 2FA step reuses `useStartTwoFactorSetup` / `useVerifyTwoFactor` from
  `modules/settings/hooks/useTwoFactor` — one implementation of enrolment, two
  presentations. The settings `TwoFactorCard` itself was **not** reused: it is built from
  settings-panel chrome (`SETTINGS_PANEL_INSET`, `SectionDivider`) that clashes inside the
  full-screen wizard.

  **Layout fix that came out of this:** `/setup` now passes `showClock={false}` and scrolls
  its centre column. The clock in `FullScreenShell` is absolutely positioned, and the 2FA
  step is roughly twice the height of the time zone step — on a laptop-height viewport the
  clock sat on top of the step indicator. Worth remembering for W7, whose summary card is
  taller again.

### [x] W7 — Step 5 + finish

- Six starter tiles; install fires in the background so the wizard never waits on a pull.
- Summary card listing configured vs skipped, then `finishOnboarding()` and into the desktop.
- Full-flow test: complete all five; skip all five (must equal the v1.7.24 end state).

  **Landed.** `steps/first-app-step.tsx` + the summary screen in the wizard, 8 new tests.
  Starters come from the catalog's own `meta.recommendedAppIds`, falling back to well-known
  slugs, then to the first few uninstalled apps — no hardcoded IDs that may not exist in a
  given catalog. An empty or unreachable catalog stays skippable.

  **Bug the skip-everything test caught:** the summary was reading local step state, and
  the time zone step seeds itself from the browser on mount — so a *skipped* time zone step
  still displayed a value the server had never stored. The wizard now tracks what was
  actually saved (`saved`), separate from what a step is showing.

  **Wizard track complete (W1–W7).** Remaining from the roadmap's Track 1 scope, both
  deliberately deferred: the 12/24-hour and week-start controls (need `AppearanceSettings`
  fields), and making anything actually *consume* the stored time zone.

---

## Track 2 — Bring Your Own Compose

**Already exists — this track extends it, it does not build it:** `custom_store_apps` table,
`convertDockerRunToCompose()`, `upsertCustomStoreTemplate()` in
`lib/server/modules/store/custom-apps.ts`, and `POST /api/v1/store/custom-apps/install`.
There is **no UI anywhere** — that is the missing half.

- [x] **C1** — Columns `source_url`, `source_ref`, `source_checksum`, `last_imported_at`;
      `source_type` gains `"url"`. Existing routes keep their contracts.
      **Landed.** Migration `0010_custom_app_source_url.sql`, provenance written in
      `upsertCustomStoreTemplate`, 6 tests. Provenance is set only for imports and
      explicitly nulled otherwise on *both* the insert and conflict branches — an imported
      app edited by hand must stop claiming a URL it no longer tracks.
      `checksumSource()` (sha256 of the fetched body) is what C6's update check will
      compare against.
- [ ] **C2** — `POST /api/v1/store/custom-apps/import`: server-side fetch with 5 MB cap,
      10 s timeout, redirect limit, private-IP-range block (with an opt-in setting for LAN
      sources — homelabbers legitimately host on their own network).
- [ ] **C3** — Validation layer: parse YAML, reject unknown top-level keys, require explicit
      confirmation for `privileged: true` and host networking. Nothing touches disk until it parses.
- [ ] **C4** — Add-app modal: three tabs (paste compose / docker run / from URL), Monaco in
      YAML mode (already a dependency), live preview card showing images, ports, volumes, env count.
- [ ] **C5** — Conflict detection before install: port in use, container name taken, bind
      mount outside the storage root.
- [ ] **C6** — Custom badge in the store list, edit-compose action, re-import with a diff view,
      export back out.

---

## Track 3 — Container Auto-Heal

- [ ] **H1** — `app_health` table (`app_id` PK, `policy` jsonb, `state`, `restart_count`,
      `window_started_at`, `last_transition_at`, `muted_until`). Leave `apps` untouched.
- [ ] **H2** — Watchdog service on a **single** `docker events` subscription for the whole
      system, with a 30 s inspect poll only as fallback. In-memory state, debounced writes —
      follow the bounded-memory pattern from the v1.7 `latestOperationEvent` fix.
- [ ] **H3** — Policy engine: restart budget (N restarts in M minutes), exponential backoff
      with a hard ceiling, then stop-and-notify.
      **Two rules it must never break:** a container the user stopped manually stays stopped;
      the watchdog stands down while `activeOperationsByApp` holds the app.
- [ ] **H4** — `/api/v1/apps/[id]/health` routes; existing app routes unchanged.
- [ ] **H5** — UI: Health & recovery section in the app panel, health dot on app cards,
      24 h restart sparkline, recovery history, mute-for-24h.
- [ ] **H6** — `HOMEIO_AUTOHEAL=false` kill switch + surface Docker `HEALTHCHECK` results
      where the image defines one.

---

## Track 4 — API Tokens + Home Assistant

- [ ] **K1** — `api_tokens` table (`id`, `name`, `token_hash` scrypt, `prefix`, `scopes`
      jsonb, `expires_at`, `last_used_at`, `last_used_ip`, `created_at`, `revoked_at`).
- [ ] **K2** — Bearer auth that runs **after** the session-cookie check, so browser traffic
      keeps its current path byte for byte. Index the lookup on `prefix` so validation never
      scrypts the whole table. Reuse the login rate limiter; same `{error, code}` envelope.
- [ ] **K3** — Scopes: `read:metrics`, `read:apps`, `write:apps`, `read:files`,
      `write:files`, `system:power`. Nothing granted by default; `system:power` needs a
      separate confirmation at creation.
- [ ] **K4** — Extend the v1.7 architecture test to accept bearer auth as a valid auth path.
      It must still fail any route with *no* auth.
- [ ] **K5** — Settings → Security UI: create (value shown once, like 2FA backup codes),
      list with prefix/scopes/last used/last IP, revoke. Flag unused tokens over 90 days.
- [ ] **K6** — `GET /api/v1/system/summary` aggregate endpoint, cached 5 s, so N pollers do
      not become N scrapes.
- [ ] **K7** — Home Assistant custom component (HACS): config flow validating against the
      summary endpoint, `DataUpdateCoordinator` on 30 s, entities for CPU/RAM/disk/temp/uptime
      plus per-app sensor and start/stop switch. **Decide first:** `apps/home-assistant/` in
      this repo, or its own repo.

---

## Track 5 — Expose over Tailscale

- [ ] **X1** — `tailscale_exposures` table (`id`, `app_id`, `mode` serve|funnel,
      `target_port`, `path`, `url`, `enabled`, `created_at`). Existing Tailscale settings
      columns untouched.
- [ ] **X2** — Service wrapping `tailscale serve --bg`; idempotent boot reconciliation
      (verify, do not blindly recreate). Never touch nginx or host firewall rules.
- [ ] **X3** — Port auto-detected from the app's compose file, with an override for
      multi-port apps.
- [ ] **X4** — Expose sheet: tailnet-only is the default and the safe path; Funnel behind a
      red confirmation naming the app and URL, and **gated on 2FA being enabled**.
      Result shows the HTTPS URL with copy + QR.
- [ ] **X5** — Settings → Network → Remote access list with per-exposure toggles.
      Uninstalling an app removes its exposure — no orphans. When `tailscaled` is missing or
      down, reuse the existing `missing_tun` / `service_unavailable` states and disable the
      feature gracefully.

---

## Track 6 — Mobile App v2

- [ ] **M1** — Server list replacing the single connect screen: nickname, address, live
      status dot, swipe to delete, reorder. Renders from local storage before any probe returns.
- [ ] **M2** — Real error states: tailnet not connected, server unreachable, wrong port,
      certificate error — each with the next step, not a stack trace.
- [ ] **M3** — Native splash + icon, system light/dark, safe-area and notch handling,
      keyboard avoidance in the terminal, Android back button → WebView history → server list.
- [ ] **M4** — QR pairing consuming the code from W6 / X4.
- [ ] **M5** — Downloads and uploads from inside the WebView, including the camera picker.
      Optional biometric lock on the launcher (gates the app, **not** the Homeio session).
- [ ] **M6** — Release: signed APK on GitHub Releases; iOS via TestFlight or local Xcode.

**Never break these:** no credentials stored by the app; WebView origin allowlist limited to
configured servers; TLS errors never silently accepted; and the app must keep working against
a **v1.7 server** — it may not assume v2.0 endpoints exist.

---

## Local test environment

The `db` service in `docker-compose.yml` publishes **no host port**, so `docker compose up -d db`
is not reachable from the host. Use a throwaway container matching the default `DATABASE_URL`:

```bash
docker run -d --name homeio-dev-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=home_server -p 5432:5432 postgres:16-alpine
```

Then `npm run db:init` and `npm run dev`.

Gotchas that already cost time:

- **The dev server binds IPv6 only** (`[::1]:3000`). `curl 127.0.0.1:3000` returns `000`;
  use `localhost:3000`.
- **The wizard only shows on a fresh database.** Any DB with an account already in it has
  `onboarding_state = NULL` and skips setup forever — that is the upgrade guarantee, not a bug.
  Reset with `docker rm -f homeio-dev-db` and re-create.
- **`.env.local` needs macOS-friendly paths** — `FILES_ROOT` / `STORE_STACKS_ROOT` default to
  `/DATA` and `/var/lib/home-server`, which do not exist on a Mac.
- **The running Docker instance uses `ghcr.io/doctor-io/homeio:latest`** — a published release
  image. It will never show branch work until an image is built from this branch.

### Known-failing baseline (pre-existing, not ours)

Compare against these numbers before blaming a commit:

- **41 failing tests across 7 files** — jsdom environment issues (`localStorage` undefined in
  `update-recovery-screen.test.tsx`, plus the SSE/hook tests). Verified identical on a clean tree.
- **113 `tsc --noEmit` errors**, all in existing `__tests__` files.

Worth fixing on their own branch — not inside a feature commit.

### Unfinished side items

- `scripts/verify-onboarding.sql` — four-case DB check for W1, currently uncommitted. Keep or delete.
- `@types/js-yaml` is still in `dependencies`; belongs in `devDependencies`.
