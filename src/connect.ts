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

export type ProbeResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Probe `<origin>/api/health`. A reachable Homeio server answers 200.
 * Network failures almost always mean Tailscale isn't connected / the address
 * is wrong, so we surface a Tailscale-aware hint.
 */
export async function probeServer(
  origin: string,
  timeoutMs = 6000,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/health`, {
      method: "GET",
      signal: controller.signal,
      // We only need reachability + status; we don't read cookies here.
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      error: `Server responded with ${res.status}. Is this a Homeio server?`,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: "Timed out reaching the server." };
    }
    return {
      ok: false,
      error:
        "Couldn't reach the server. Make sure the Tailscale app is connected " +
        "and the address is correct.",
    };
  } finally {
    clearTimeout(timer);
  }
}
