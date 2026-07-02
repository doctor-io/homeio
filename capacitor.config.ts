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
    androidScheme: "https",
    // Tailnet hosts the WebView is allowed to navigate to in-app.
    // `*.ts.net` covers MagicDNS names; `100.*` covers raw tailnet IPs.
    allowNavigation: ["*.ts.net", "100.*"],
  },
};

export default config;
