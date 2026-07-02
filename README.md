# Homeio Mobile

A small [Capacitor](https://capacitorjs.com/) app (Android + iOS) that connects to a
self-hosted Homeio server over **Tailscale**.

## How it works

This app is a thin native shell, not a re-implementation of the dashboard:

1. It opens on a bundled **Connect screen** (the only code in this project) where you add a
   server by its tailnet address and optional username.
2. It probes `GET <address>/api/health` to confirm the server is reachable.
3. It then **navigates the WebView onto the server's own origin**. From there the full
   Homeio web app runs first-party — its existing `/login` page handles your
   username/password (and TOTP), and everything (terminal WebSocket, SSE, uploads) works
   because the WebView is on the server's origin (no CORS, no auth re-implementation).

Network reachability is provided by the **official Tailscale app**, which must be installed
and connected on the phone. This app does **not** embed the Tailscale tunnel.

See [`doc/modules/mobile-app.md`](../../doc/modules/mobile-app.md) for the full architecture.

## Prerequisites

- Node.js 20+ and npm
- The official **Tailscale** app on the phone, signed into the same tailnet as the server
- For Android builds: Android Studio + JDK 17
- For iOS builds: macOS + Xcode

## Setup

```bash
cd apps/mobile
npm install

# Add the native platforms (generated locally; git-ignored)
npm run add:android
npm run add:ios        # macOS only

# Build the launcher and copy it into the native projects
npm run sync
```

## Run

```bash
npm run dev            # iterate on the Connect screen in a desktop browser
npm run run:android    # build + sync + launch on a device/emulator
npm run run:ios        # macOS only
```

## Finding your server's address

On the server, run `tailscale status`, or open Homeio → **Settings → Integrations →
Tailscale**. Use the MagicDNS name (`*.ts.net`) or a `100.x` tailnet IP, with the Homeio
port (default `3000`), e.g. `homeio.tailnet-name.ts.net:3000`.

## Notes

- Passwords are **not** stored by this app; you sign in on the server's first-party login
  page. Silent auto-login is a planned enhancement (see the module doc).
- `android/` and `ios/` are git-ignored — run `cap add` after cloning.
- Allowed navigation hosts (`*.ts.net`, `100.*`) are configured in `capacitor.config.ts`.
