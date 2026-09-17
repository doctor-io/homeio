# API Reference

This reference is generated from the current `app/api/**/route.ts` tree and verified against route exports. Auth means the route is protected by the shared `requireApiSession()` helper or an auth-specific session check. There is no central middleware.

## Response Conventions

- Preferred success shape for new routes: `{ "data": ... }`.
- Preferred error shape: `{ "error": string, "code"?: string, "details"?: unknown }`.
- Current code is inconsistent. Examples: `app/api/v1/files/route.ts` returns `{ data, meta }`; `app/api/v1/scheduled-tasks/route.ts` returns `{ tasks }`; auth routes use auth-specific shapes.
- Routes that parse JSON generally return `400` for invalid JSON or validation failure.
- Protected routes return `401` when session authentication fails.
- `POST /api/auth/login` returns `429` with `{ "error": "Too many login attempts" }` after 5 failed attempts per 15 minutes for the same normalized username/client IP.

## Token Authentication

Two mechanisms, and they are not interchangeable.

- **Session cookie.** `POST /api/auth/login` sets an httpOnly cookie and returns the user. Nothing is returned for a script to hold as a bearer credential. A cookie reaches every protected route.
- **API token.** A stored credential, `homeio_` + secret, created at `POST /api/v1/auth/tokens`. The full value is returned once, at creation; only the prefix (`homeio_` + 8 chars) is stored in readable form afterwards. Verified with scrypt in `api-token-service.ts`.

### Scopes

From `API_TOKEN_SCOPES` in `lib/shared/contracts/api-tokens.ts`. Nothing is granted implicitly — a token holds exactly the scopes it was created with.

| Scope | Grants |
|---|---|
| `read:metrics` | Read system metrics |
| `read:apps` | See installed apps |
| `write:apps` | Start, stop and install apps |
| `read:files` | Read files |
| `write:files` | Write and delete files |
| `system:power` | Shut down and restart the server |

### Default deny

`requireApiSession()` accepts a bearer token **only** when the route passes a `scope` option. A route that says nothing keeps refusing tokens, so adding token auth to the codebase cannot quietly open an endpoint nobody reviewed.

The practical consequence: holding a scope is not enough. `read:files` does not open `/api/v1/files`, because that route has not opted in. These are every route that accepts a token today — grep for `scope:` in `app/api/**` to check this list is still current:

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/v1/apps` | `read:apps` |
| `POST` | `/api/v1/apps/[appId]/start` | `write:apps` |
| `POST` | `/api/v1/apps/[appId]/stop` | `write:apps` |
| `POST` | `/api/v1/apps/[appId]/restart` | `write:apps` |
| `GET` | `/api/v1/system/metrics` | `read:metrics` |
| `GET` | `/api/v1/system/summary` | `read:metrics` |
| `POST` | `/api/v1/system/power/shutdown` | `system:power` |
| `POST` | `/api/v1/system/power/reboot` | `system:power` |

`system:power` is deliberately separate from `write:apps`: shutting a server down is not "managing apps".

### Token routes are session-only

`/api/v1/auth/tokens` passes no `scope`, so a token can never mint another token or read the list of them. The omission is the mechanism, not an oversight — do not add a scope to those routes.

Bad token attempts are rate limited per token prefix, answering `429` with `{ "error": "Too many token attempts", "code": "rate_limited" }`. The prefix is the credential's public half, so it is keyed the way a username is.

## Auth Routes

| Method | Path | Auth | Request | Response |
|---|---|---:|---|---|
| `POST` | `/api/auth/login` | N | JSON username/password | session cookie + user/session payload or error |
| `POST` | `/api/auth/logout` | N | session cookie | clears cookie |
| `GET` | `/api/auth/me` | Y | session cookie | current user/session |
| `POST` | `/api/auth/register` | N | JSON username/password | creates first user/session |
| `GET` | `/api/auth/status` | N | none | registration/status payload |
| `POST` | `/api/auth/unlock` | N | JSON password | unlock result |
| `GET` | `/api/health` | N | none | health payload |

## Apps And Store

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/apps` | Y | List installed apps |
| `POST` | `/api/v1/apps/[appId]/start` | Y | Start app stack |
| `POST` | `/api/v1/apps/[appId]/stop` | Y | Stop app stack |
| `POST` | `/api/v1/apps/[appId]/restart` | Y | Restart app stack |
| `POST` | `/api/v1/apps/[appId]/check-updates` | Y | Check one app for updates |
| `GET` | `/api/v1/apps/[appId]/logs/stream` | Y | SSE container logs |
| `GET` | `/api/v1/store/apps` | Y | List catalog apps |
| `GET` | `/api/v1/store/apps/[appId]` | Y | App detail |
| `GET` | `/api/v1/store/apps/[appId]/compose` | Y | Compose for catalog/installed app |
| `PATCH` | `/api/v1/store/apps/[appId]/settings` | Y | Update stored app settings |
| `POST` | `/api/v1/store/apps/[appId]/install` | Y | Start install operation |
| `POST` | `/api/v1/store/apps/[appId]/update` | Y | Start update operation |
| `POST` | `/api/v1/store/apps/[appId]/redeploy` | Y | Start redeploy operation |
| `POST` | `/api/v1/store/apps/[appId]/uninstall` | Y | Start uninstall operation |
| `GET` | `/api/v1/store/operations/[operationId]` | Y | Operation snapshot |
| `GET` | `/api/v1/store/operations/[operationId]/stream` | Y | SSE operation progress |
| `POST` | `/api/v1/store/check-updates` | Y | Check catalog/installed updates |
| `POST` | `/api/v1/store/custom-apps/install` | Y | Install custom app |
| `GET` | `/api/v1/store/sources` | Y | List catalog sources |
| `POST` | `/api/v1/store/sources` | Y | Create catalog source |
| `PATCH` | `/api/v1/store/sources/[sourceId]` | Y | Update catalog source |
| `DELETE` | `/api/v1/store/sources/[sourceId]` | Y | Delete catalog source |
| `POST` | `/api/v1/store/sources/[sourceId]/refresh` | Y | Refresh catalog source |

Contracts: `lib/shared/contracts/apps.ts`, `lib/shared/contracts/docker.ts`. Operation SSE events: `operation.step`, `operation.completed`, `operation.failed`, `heartbeat`.

Store operation mutation routes can return `409` with `code: "operation_conflict"` when the same app already has an active operation, or `429` with `code: "operation_limit_reached"` when `serverEnv.STORE_MAX_CONCURRENT_OPERATIONS` is reached.

## Docker

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/docker/info` | Y | Docker daemon info |
| `GET` | `/api/v1/docker/stats` | Y | Container stats snapshot |
| `GET` | `/api/v1/docker/stats/stream` | Y | SSE stats stream |
| `POST` | `/api/v1/docker/prune/images` | Y | Prune Docker images |
| `POST` | `/api/v1/docker/prune/volumes` | Y | Prune Docker volumes |

Docker stats SSE events: `stats.updated`, `heartbeat`.

## Files

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/files` | Y | List directory |
| `GET` | `/api/v1/files/root` | Y | File root info |
| `GET` | `/api/v1/files/content` | Y | Read file content |
| `PUT` | `/api/v1/files/content` | Y | Write text file |
| `GET` | `/api/v1/files/asset` | Y | Stream asset content |
| `GET` | `/api/v1/files/download` | Y | Download file |
| `POST` | `/api/v1/files/upload` | Y | Upload files |
| `POST` | `/api/v1/files/ops` | Y | Create/rename/paste/info/star operations |
| `GET` | `/api/v1/files/search` | Y | Search files |
| `GET` | `/api/v1/files/starred` | Y | List starred files |
| `GET` | `/api/v1/files/zip` | Y | Download folder zip |
| `POST` | `/api/v1/files/trash/move` | Y | Move entry to trash |
| `POST` | `/api/v1/files/trash/restore` | Y | Restore trash entry |
| `POST` | `/api/v1/files/trash/delete` | Y | Delete trash entry |
| `POST` | `/api/v1/files/trash/empty` | Y | Empty trash |
| `GET` | `/api/v1/files/network/discover/servers` | Y | Discover SMB servers |
| `POST` | `/api/v1/files/network/discover/shares` | Y | Discover SMB shares |
| `GET` | `/api/v1/files/network/shares` | Y | List SMB shares |
| `POST` | `/api/v1/files/network/shares` | Y | Add SMB share |
| `DELETE` | `/api/v1/files/network/shares/[shareId]` | Y | Remove SMB share |
| `POST` | `/api/v1/files/network/shares/[shareId]/mount` | Y | Mount SMB share |
| `POST` | `/api/v1/files/network/shares/[shareId]/unmount` | Y | Unmount SMB share |
| `GET` | `/api/v1/files/shared/folders` | Y | List local folder shares |
| `POST` | `/api/v1/files/shared/folders` | Y | Add local folder share |
| `DELETE` | `/api/v1/files/shared/folders/[shareId]` | Y | Remove local folder share |
| `GET` | `/api/v1/files/usb` | Y | List USB drives |
| `GET` | `/api/v1/files/usb/stream` | Y | SSE USB events |
| `POST` | `/api/v1/files/usb/[driveId]/mount` | Y | Mount USB drive |
| `POST` | `/api/v1/files/usb/[driveId]/unmount` | Y | Unmount USB drive |
| `POST` | `/api/v1/files/usb/[driveId]/eject` | Y | Eject USB drive |
| `GET` | `/api/v1/files/google-drive/auth` | N | Start Google Drive OAuth |
| `GET` | `/api/v1/files/google-drive/callback` | N | OAuth callback |
| `GET` | `/api/v1/files/google-drive/connections` | Y | List Drive connections |
| `DELETE` | `/api/v1/files/google-drive/connections/[id]` | Y | Delete Drive connection |
| `GET` | `/api/v1/files/google-drive/[id]/browse` | Y | Browse Drive folder |
| `GET` | `/api/v1/files/google-drive/[id]/download` | Y | Download Drive file |
| `POST` | `/api/v1/files/google-drive/[id]/upload` | Y | Upload Drive file |
| `POST` | `/api/v1/files/google-drive/[id]/folders` | Y | Create Drive folder |
| `PATCH` | `/api/v1/files/google-drive/[id]/files/[fileId]` | Y | Move/rename Drive file |
| `DELETE` | `/api/v1/files/google-drive/[id]/files/[fileId]` | Y | Delete Drive file |

Contracts: `lib/shared/contracts/files.ts`, `lib/shared/contracts/usb.ts`, `lib/shared/contracts/google-drive.ts`. File service errors use `FileServiceErrorCode`.

`POST /api/v1/files/upload` accepts multipart `FormData` with `path`, optional `includeHidden`, and repeated `file` parts. The route stream-parses multipart content with `busboy`, passes each file stream to the file service, and avoids holding whole uploads in memory. The client upload helper uses `XMLHttpRequest` for progress and supports `AbortSignal` cancellation. Next's route-handler proxy upload limit is configured by `experimental.proxyClientMaxBodySize` in `next.config.mjs`; external reverse proxies may still enforce their own limit.

`POST /api/v1/files/ops` also supports `action: "unzip"` for archive extraction beside create/rename/paste/info/star operations.

## Network

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/network/status` | Y | Network status |
| `GET` | `/api/v1/network/networks` | Y | WiFi scan |
| `POST` | `/api/v1/network/connect` | Y | Connect WiFi |
| `POST` | `/api/v1/network/disconnect` | Y | Disconnect WiFi |
| `GET` | `/api/v1/network/events/stream` | Y | SSE network events |

Contract: `lib/shared/contracts/network.ts`.

## Notifications

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/notifications` | Y | List notifications |
| `DELETE` | `/api/v1/notifications` | Y | Clear notifications |
| `POST` | `/api/v1/notifications/read-all` | Y | Mark all read |
| `GET` | `/api/v1/notifications/stream` | Y | SSE notification events |

Contract: `lib/shared/contracts/notifications.ts`.

## Scheduled Tasks

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/scheduled-tasks` | Y | List tasks |
| `POST` | `/api/v1/scheduled-tasks` | Y | Create task |
| `GET` | `/api/v1/scheduled-tasks/[taskId]` | Y | Task detail |
| `PATCH` | `/api/v1/scheduled-tasks/[taskId]` | Y | Update task |
| `DELETE` | `/api/v1/scheduled-tasks/[taskId]` | Y | Delete task |
| `POST` | `/api/v1/scheduled-tasks/[taskId]/run` | Y | Run task now |

Contract: `lib/shared/contracts/scheduled-tasks.ts`.

## Settings And System

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `GET` | `/api/v1/settings/appearance` | Y | Appearance settings |
| `PUT` | `/api/v1/settings/appearance` | Y | Save appearance settings |
| `GET` | `/api/v1/settings/google-oauth` | Y | Public Google OAuth config status |
| `PUT` | `/api/v1/settings/google-oauth` | Y | Save Google OAuth client credentials |
| `DELETE` | `/api/v1/settings/google-oauth` | Y | Clear Google OAuth client credentials |
| `GET` | `/api/v1/system/info` | Y | Server info |
| `GET` | `/api/v1/system/metrics` | Y | Metrics snapshot |
| `GET` | `/api/v1/system/stream` | Y | SSE metrics stream |
| `GET` | `/api/v1/system/preferences` | Y | System preferences |
| `PUT` | `/api/v1/system/preferences` | Y | Save system preferences |
| `GET` | `/api/v1/system/security` | Y | Security settings |
| `PUT` | `/api/v1/system/security` | Y | Save security settings |
| `GET` | `/api/v1/system/updates` | Y | Update status |
| `POST` | `/api/v1/system/updates/check` | Y | Check for updates |
| `POST` | `/api/v1/system/updates/apply` | Y | Apply update |
| `GET` | `/api/v1/system/backups` | Y | List backups |
| `POST` | `/api/v1/system/backups/run` | Y | Run backup |
| `PUT` | `/api/v1/system/backups/settings` | Y | Save backup settings |
| `POST` | `/api/v1/system/backups/[backupId]/restore` | Y | Restore backup |
| `GET` | `/api/v1/system/power/capabilities` | Y | Power capabilities |
| `GET` | `/api/v1/system/power/schedule` | Y | Reboot schedule |
| `PUT` | `/api/v1/system/power/schedule` | Y | Save reboot schedule |
| `POST` | `/api/v1/system/power/shutdown` | Y | Shutdown host |
| `POST` | `/api/v1/system/power/reboot` | Y | Reboot host |
| `POST` | `/api/v1/system/power/factory-reset` | Y | Schedule factory reset |
| `GET` | `/api/v1/system/disks` | Y | List disks |
| `POST` | `/api/v1/system/disks/format` | Y | Format partition |
| `POST` | `/api/v1/system/disks/mount` | Y | Mount partition |
| `POST` | `/api/v1/system/disks/unmount` | Y | Unmount partition |
| `POST` | `/api/v1/system/disks/create-partition` | Y | Create partition |
| `POST` | `/api/v1/system/disks/delete-partition` | Y | Delete partition |
| `POST` | `/api/v1/system/disks/wipe` | Y | Wipe disk |
| `GET` | `/api/v1/logs` | Y | Read logs |

Contracts: `lib/shared/contracts/system.ts`, `lib/shared/contracts/disks.ts`, `lib/shared/contracts/server-info.ts`.

## Terminal

| Method | Path | Auth | Purpose |
|---|---|---:|---|
| `POST` | `/api/v1/terminal/execute` | Y | Execute allowlisted command |
| `WS` | `/api/terminal` | Configured by `TERMINAL_WS_REQUIRE_AUTH` | Full PTY terminal |

WebSocket client-to-server messages in `lib/server/modules/terminal/websocket-server.ts`:

| Message | Shape | Effect |
|---|---|---|
| `input` | `{ "type": "input", "data": string }` | Writes data to PTY |
| `resize` | `{ "type": "resize", "cols"?: number, "rows"?: number }` | Resizes PTY |
| `attach` | `{ "type": "attach", "target": string }` | Switches to `docker exec -it <target> bash`, fallback `sh` |
| `ping` | `{ "type": "ping" }` | Sends `{ "type": "pong" }` |

Server-to-client terminal output is mostly raw PTY bytes as WebSocket text. Error messages can be JSON: `{ "type": "error", "code": string, "message": string }`.

## Known Auth Gaps

Current `/api/v1/**` routes are protected by the shared `requireApiSession()` helper except the Google Drive OAuth bootstrap/callback routes listed above. See [security.md](./security.md) for remaining risks.
