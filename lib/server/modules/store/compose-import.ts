import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { serverEnv } from "@/lib/server/env";

export class ComposeImportError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ComposeImportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

const MAX_REDIRECTS = 3;

/**
 * IPv4 and IPv6 ranges that must never be reachable through an import: the
 * server makes this request, so an unguarded URL would let anyone with access
 * to the UI probe localhost, the LAN, or a cloud metadata endpoint.
 */
function isPrivateAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, and AWS/GCP metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }

  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  // Mapped IPv4 (::ffff:127.0.0.1) is judged on the address it wraps.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return (
    normalized.startsWith("fc") || // unique local
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || // link-local
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function assertPublicHost(hostname: string, allowPrivateHosts: boolean) {
  if (allowPrivateHosts) return;

  const literal = isIP(hostname);
  if (literal) {
    if (isPrivateAddress(hostname)) {
      throw new ComposeImportError(
        "private_host",
        "That address is on a private network. Set STORE_IMPORT_ALLOW_PRIVATE_HOSTS=true to import from your LAN.",
      );
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ComposeImportError("dns_failed", `Could not resolve ${hostname}`);
  }

  // A hostname can resolve to several addresses; one private answer is enough
  // to refuse. (This resolves before fetching, so a hostile DNS server could
  // still answer differently on the real request — blocking the obvious cases
  // is the goal, not defeating a determined attacker on your own machine.)
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ComposeImportError(
      "private_host",
      "That host resolves to a private network address. Set STORE_IMPORT_ALLOW_PRIVATE_HOSTS=true to import from your LAN.",
    );
  }
}

function parseUrl(rawUrl: string, allowPrivateHosts: boolean) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ComposeImportError("invalid_url", "That does not look like a URL");
  }

  if (url.protocol === "http:" && !allowPrivateHosts) {
    throw new ComposeImportError(
      "insecure_url",
      "Only https URLs can be imported. Set STORE_IMPORT_ALLOW_PRIVATE_HOSTS=true to allow plain http from your LAN.",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ComposeImportError("invalid_url", "Only http and https URLs can be imported");
  }

  return url;
}

export type ComposeImportResult = {
  url: string;
  content: string;
  bytes: number;
};

/**
 * Fetches a compose document on the server's behalf. Every hop is re-checked,
 * because a public URL that redirects to 169.254.169.254 is the whole trick.
 */
export async function fetchComposeFromUrl(
  rawUrl: string,
  options: {
    allowPrivateHosts?: boolean;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<ComposeImportResult> {
  const allowPrivateHosts =
    options.allowPrivateHosts ?? serverEnv.STORE_IMPORT_ALLOW_PRIVATE_HOSTS;
  const maxBytes = options.maxBytes ?? serverEnv.STORE_IMPORT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? serverEnv.STORE_IMPORT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let target = parseUrl(rawUrl, allowPrivateHosts);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicHost(target.hostname, allowPrivateHosts);

      const response = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/plain, text/yaml, application/yaml, */*" },
      }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          throw new ComposeImportError(
            "timeout",
            `The source did not respond within ${Math.round(timeoutMs / 1000)}s`,
            504,
          );
        }
        throw new ComposeImportError("unreachable", "Could not reach that URL", 502);
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new ComposeImportError("unreachable", "The source redirected with no target", 502);
        }
        target = parseUrl(new URL(location, target).toString(), allowPrivateHosts);
        continue;
      }

      if (!response.ok) {
        throw new ComposeImportError(
          "fetch_failed",
          `The source returned HTTP ${response.status}`,
          response.status === 404 ? 404 : 502,
        );
      }

      // Trust the declared length when it is present, but still count bytes:
      // Content-Length is a claim, not a guarantee.
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ComposeImportError("too_large", `That file is larger than ${maxBytes} bytes`, 413);
      }

      const content = await readCapped(response, maxBytes);
      return { url: target.toString(), content, bytes: Buffer.byteLength(content) };
    }

    throw new ComposeImportError("too_many_redirects", "That URL redirected too many times");
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response: Response, maxBytes: number) {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ComposeImportError("too_large", `That file is larger than ${maxBytes} bytes`, 413);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}
