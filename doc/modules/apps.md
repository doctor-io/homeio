# Apps, App Store, And Operations

## Purpose

This module displays installed Docker Compose apps, loads the App Store catalog, and runs install/update/uninstall/start/stop/restart operations. Long-running operations are persisted in PostgreSQL and streamed to the UI with SSE.

The App Store groups catalog results by source. The **Source** filter works alongside search, categories, and installed status, and **Custom** includes locally imported apps. When sources publish the same app ID, the official catalog takes precedence, followed by the first configured source containing that app. The **Manage Sources** dialog lists entries suppressed by these conflicts.

## Locations

- Server-side: `lib/server/modules/apps/`, `lib/server/modules/store/`, `lib/server/modules/docker/`
- Client-side: `modules/apps/`
- Routes: `app/api/v1/apps/`, `app/api/v1/store/`, `app/api/v1/docker/`

## Key Files

| File | Role |
|---|---|
| `lib/server/modules/apps/service.ts` | Lists installed apps and demo app metadata |
| `lib/server/modules/apps/operations.ts` | App lifecycle operation state machine |
| `lib/server/modules/apps/stacks-repository.ts` | `app_stacks` and `app_operations` persistence |
| `lib/server/modules/store/catalog.ts` | Catalog loading |
| `lib/server/modules/store/custom-apps.ts` | Custom app persistence and parsing |
| `modules/apps/components/app-grid.tsx` | Installed apps window |
| `modules/apps/components/app-store.tsx` | App Store window |
| `modules/apps/hooks/useStoreOperation.ts` | Operation snapshot and SSE subscription |

## Public API

- Server functions: `listInstalledApps()`, `startStoreOperation()`, `getStoreOperation()`, `subscribeToStoreOperation()`
- Client hooks: `useInstalledApps()`, `useStoreCatalog()`, `useStoreApp()`, `useStoreOperation()`, `useStoreActions()`, `useStoreSources()`
- Components: `AppGrid`, `AppStore`, `AppLogsDialog`, `CustomAppInstallDialog`, `UninstallAppDialog`

## Contracts

- `lib/shared/contracts/apps.ts`
- `lib/shared/contracts/docker.ts`

## Database Tables

- `apps`
- `app_stacks`
- `app_operations`
- `custom_store_apps`

## API Routes Owned

- `GET /api/v1/apps`
- `POST /api/v1/apps/[appId]/start`
- `POST /api/v1/apps/[appId]/stop`
- `POST /api/v1/apps/[appId]/restart`
- `POST /api/v1/apps/[appId]/check-updates`
- `GET /api/v1/apps/[appId]/logs/stream`
- `GET /api/v1/store/apps`
- `GET /api/v1/store/apps/[appId]`
- `GET /api/v1/store/apps/[appId]/compose`
- `PATCH /api/v1/store/apps/[appId]/settings`
- `POST /api/v1/store/apps/[appId]/install`
- `POST /api/v1/store/apps/[appId]/update`
- `POST /api/v1/store/apps/[appId]/redeploy`
- `POST /api/v1/store/apps/[appId]/uninstall`
- `GET /api/v1/store/operations/[operationId]`
- `GET /api/v1/store/operations/[operationId]/stream`
- `GET/POST/PATCH/DELETE /api/v1/store/sources*`
- `POST /api/v1/store/custom-apps/install`
- `POST /api/v1/store/check-updates`

## Known Issues

- `lib/server/modules/apps/operations.ts` is over 1,200 lines and runs operations in-process via `queueMicrotask()`.
- There is no external operation queue. `startStoreOperation()` uses an in-memory per-app guard and `serverEnv.STORE_MAX_CONCURRENT_OPERATIONS` global cap.
- Routes in this domain are protected by `requireApiSession()` except documented OAuth-style bootstrap routes outside this module.
- Demo app data and CDN icon URLs are hardcoded in `lib/server/modules/apps/service.ts`.

## How To Extend

To add a new operation:

1. Add action/status types in `lib/shared/contracts/apps.ts`.
2. Add persistence fields only if needed in `lib/server/db/schema.ts`.
3. Add operation logic in `lib/server/modules/apps/operations.ts`, keeping changes narrow.
4. Preserve the existing `StoreOperationError` behavior for same-app conflicts (`409`) and global caps (`429`).
5. Add a route under `app/api/v1/store/apps/[appId]/`.
6. Add a client action in `modules/apps/hooks/useStoreActions.ts`.
7. Add UI in `modules/apps/components/`.
8. Add tests beside the route and in `lib/server/modules/apps/__tests__/`.
