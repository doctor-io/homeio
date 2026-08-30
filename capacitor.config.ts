import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The launcher (Connect / server-picker UI) is bundled and served locally.
 * Once the user picks a server, the WebView navigates to the remote Homeio
 * origin (a tailnet `*.ts.net` MagicDNS name or a `100.x` tailnet IP). Those
 * hosts must be listed in `server.allowNavigation` so the navigation stays
 * inside the app instead of opening an external browser.
 *
 * Because the WebView ends up *on the server's own origin*, the `homeio_session`
 * cookie is first-party and the terminal WebSocket / SSE / uploads all work
 * with no CORS configuration.
 */
const config: CapacitorConfig = {
  appId: "io.homeio.app",
  appName: "Homeio",
  webDir: "dist",
  server: {
    // The launcher must be served from an `http` origin: Homeio servers speak
    // plain HTTP on the tailnet (Tailscale encrypts at the network layer), and
    // an `https://localhost` page would block the `http://<server>` health
    // probe as mixed content.
    androidScheme: "http",
    cleartext: true,
    // Hosts the WebView is allowed to navigate to in-app.
    // `*.ts.net` covers MagicDNS names; `100.*` covers raw tailnet IPs;
    // custom domains cover servers published through a reverse proxy /
    // Cloudflare Tunnel instead of Tailscale.
    allowNavigation: ["*.ts.net", "100.*", "homeio.ahmedtabib.com"],
  },
  plugins: {
    App: {
      // MainActivity owns the back button. Capacitor's own handler drops the
      // event when a page has no JS listener, which is every page after the
      // WebView leaves the launcher.
      disableBackButtonHandler: true,
    },
  },
};

export default config;
