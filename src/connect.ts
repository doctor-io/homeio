/**
 * Address normalization + reachability probing for the Connect screen.
 *
 * The probe hits the server's existing unauthenticated `GET /api/health`
 * endpoint so we can show a clear "can't reach server" error instead of
 * navigating the WebView into a blank page.
 */

const DEFAULT_PORT = "3000";

export type NormalizeResult =
  | { ok: true; origin: string; host: string }
  | { ok: false; error: string };

/**
 * Accepts forms like:
 *   homeio.tailnet-name.ts.net
 *   homeio.tailnet-name.ts.net:3000
 *   100.101.102.103
 *   http://100.101.102.103:3000
 * and returns a normalized origin ("scheme://host:port", no trailing slash).
 */
export function normalizeAddress(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter a server address." };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like a valid address." };
  }

  if (!url.hostname) return { ok: false, error: "Missing host in address." };
  if (!url.port && url.protocol === "http:") url.port = DEFAULT_PORT;

  // Strip any path/query the user may have pasted — we want the origin only.
  const origin = `${url.protocol}//${url.host}`;
  return { ok: true, origin, host: url.host };
}

/**
 * Why a probe failed, as far as we can tell. `no-cors` gives us an opaque
 * response or a bare TypeError — no status, no reason — so the diagnosis comes
 * from what we already know about the address plus one follow-up probe, not
 * from the error object.
 */
export type ProbeFailureReason =
  | "timeout"
  | "tailscale_down"
  | "wrong_port"
  | "tls"
  | "unreachable";

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: ProbeFailureReason; error: string; suggestedOrigin?: string };

/** MagicDNS names and the 100.64/10 tailnet range. */
export function isTailnetHost(host: string): boolean {
  const hostname = host.split(":")[0].toLowerCase();
  if (hostname.endsWith(".ts.net")) return true;

  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  // 100.64.0.0/10 — the CGNAT range Tailscale assigns from.
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function messageFor(reason: ProbeFailureReason, suggestedOrigin?: string): string {
  switch (reason) {
    case "timeout":
      return "The server didn't answer in time. It may be asleep, or something on the network is dropping the connection.";
    case "tailscale_down":
      // The single most common cause, and the one the user can fix in seconds.
      return "Couldn't reach that tailnet address. Open the Tailscale app and check it's connected, then try again.";
    case "wrong_port":
      return suggestedOrigin
        ? `Nothing is listening on that port, but ${suggestedOrigin} answered. Try that address instead.`
        : "Nothing is listening on that port.";
    case "tls":
      return "Couldn't establish a secure connection. The server's certificate may not be trusted on this device.";
    case "unreachable":
    default:
      return "Couldn't reach the server. Check the address, and that the server is switched on.";
  }
}

/**
 * Probe `<origin>/api/health`. The launcher runs on the WebView's local
 * `http://localhost` origin and Homeio servers don't send CORS headers, so a
 * normal fetch is blocked before we can read anything. `mode: "no-cors"`
 * returns an opaque response instead: we can't inspect the status, but the
 * promise resolving at all means the server answered — which is all the
 * reachability check needs. Network failures almost always mean Tailscale
 * isn't connected / the address is wrong, so we surface a Tailscale-aware
 * hint.
 */
export async function probeServer(
  origin: string,
  timeoutMs = 6000,
): Promise<ProbeResult> {
  const attempt = await reach(origin, timeoutMs);
  if (attempt === "ok") return { ok: true };

  if (attempt === "timeout") {
    return { ok: false, reason: "timeout", error: messageFor("timeout") };
  }

  const url = safeUrl(origin);

  // A failing https origin is far more often a certificate the device will not
  // trust than a wrong port, and the two are indistinguishable from here.
  if (url?.protocol === "https:") {
    return { ok: false, reason: "tls", error: messageFor("tls") };
  }

  // If a non-default port was given, see whether the default answers. When it
  // does, the address is right and only the port is wrong — worth saying,
  // rather than making the user guess.
  if (url && url.port && url.port !== DEFAULT_PORT) {
    const fallback = `${url.protocol}//${url.hostname}:${DEFAULT_PORT}`;
    if ((await reach(fallback, timeoutMs)) === "ok") {
      return {
        ok: false,
        reason: "wrong_port",
        error: messageFor("wrong_port", fallback),
        suggestedOrigin: fallback,
      };
    }
  }

  if (url && isTailnetHost(url.host)) {
    return { ok: false, reason: "tailscale_down", error: messageFor("tailscale_down") };
  }

  return { ok: false, reason: "unreachable", error: messageFor("unreachable") };
}

function safeUrl(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

async function reach(origin: string, timeoutMs: number): Promise<"ok" | "timeout" | "failed"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${origin}/api/health`, {
      method: "GET",
      mode: "no-cors",
      signal: controller.signal,
      cache: "no-store",
    });
    return "ok";
  } catch (err) {
    return err instanceof DOMException && err.name === "AbortError" ? "timeout" : "failed";
  } finally {
    clearTimeout(timer);
  }
}
