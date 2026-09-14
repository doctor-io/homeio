import "server-only";

import { logServerAction } from "@/lib/server/logging/logger";

const API_BASE = "https://api.cloudflare.com/client/v4";

type IngressRule = {
  hostname?: string;
  service: string;
  originRequest?: Record<string, unknown>;
  path?: string;
};

type TunnelConfiguration = {
  ingress: IngressRule[];
  [key: string]: unknown;
};

/**
 * The connector token is base64 of {"a": account tag, "t": tunnel id, "s": secret}.
 * Reading it means the operator supplies one token, not three identifiers.
 */
export function decodeConnectorToken(token: string) {
  try {
    const decoded = JSON.parse(Buffer.from(token.trim(), "base64").toString("utf8")) as {
      a?: unknown;
      t?: unknown;
    };

    if (typeof decoded.a !== "string" || typeof decoded.t !== "string") return null;
    return { accountId: decoded.a, tunnelId: decoded.t };
  } catch {
    return null;
  }
}

/**
 * Cloudflare hands out the whole install command, not the bare token:
 *
 *   sudo cloudflared service install eyJhIjoi...
 *   docker run cloudflare/cloudflared:latest tunnel run --token eyJhIjoi...
 *
 * Pull the token out of whatever was pasted, so copying the command as shown
 * works. Anything with no usable token is returned untouched for validation
 * to reject with a message.
 */
export function normalizeConnectorToken(input: string) {
  const trimmed = input.trim();

  for (const candidate of trimmed.match(/eyJ[A-Za-z0-9+/=_-]+/g) ?? []) {
    if (decodeConnectorToken(candidate)) return candidate;
  }

  return trimmed;
}

async function cloudflareRequest<T>(input: {
  apiToken: string;
  path: string;
  method?: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${API_BASE}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.apiToken}`,
      "Content-Type": "application/json",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });

  const payload = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: { message?: string }[];
  } | null;

  if (!response.ok || !payload?.success) {
    const detail =
      payload?.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      `HTTP ${response.status}`;
    throw new Error(`Cloudflare API: ${detail}`);
  }

  return payload.result as T;
}

/**
 * Ask Cloudflare whether the API token is real and active. Pasting the wrong
 * secret into the wrong field is easy, and the failure is otherwise silent:
 * everything saves, and nothing happens until someone reads a log.
 */
export async function verifyApiToken(apiToken: string) {
  const result = await cloudflareRequest<{ status?: string }>({
    apiToken,
    path: "/user/tokens/verify",
  });

  if (result?.status && result.status !== "active") {
    throw new Error(`Cloudflare API token is ${result.status}`);
  }
}

async function resolveZoneId(apiToken: string, domain: string) {
  const zones = await cloudflareRequest<{ id: string; name: string }[]>({
    apiToken,
    path: `/zones?name=${encodeURIComponent(domain)}`,
  });

  const zone = zones?.[0];
  if (!zone) {
    throw new Error(`No Cloudflare zone found for ${domain}`);
  }

  return zone.id;
}

async function getTunnelConfiguration(input: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
}) {
  const result = await cloudflareRequest<{ config?: TunnelConfiguration }>({
    apiToken: input.apiToken,
    path: `/accounts/${input.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
  });

  return result?.config ?? { ingress: [] };
}

async function putTunnelConfiguration(input: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  config: TunnelConfiguration;
}) {
  await cloudflareRequest({
    apiToken: input.apiToken,
    path: `/accounts/${input.accountId}/cfd_tunnel/${input.tunnelId}/configurations`,
    method: "PUT",
    body: { config: input.config },
  });
}

/** The catch-all has no hostname and must stay last, so it is rebuilt each time. */
function withCatchAllLast(rules: IngressRule[]) {
  const routed = rules.filter((rule) => Boolean(rule.hostname));
  const catchAll = rules.find((rule) => !rule.hostname) ?? { service: "http_status:404" };
  return [...routed, catchAll];
}

export type CloudflareRouteInput = {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  domain: string;
  hostname: string;
  /** Where the tunnel should send traffic, e.g. http://localhost:8080 */
  service: string;
};

/** Add (or update) the public hostname and the CNAME that points at the tunnel. */
export async function createTunnelRoute(input: CloudflareRouteInput) {
  const config = await getTunnelConfiguration(input);
  const others = (config.ingress ?? []).filter((rule) => rule.hostname !== input.hostname);

  await putTunnelConfiguration({
    ...input,
    config: {
      ...config,
      ingress: withCatchAllLast([
        ...others,
        { hostname: input.hostname, service: input.service },
      ]),
    },
  });

  const zoneId = await resolveZoneId(input.apiToken, input.domain);
  const existing = await cloudflareRequest<{ id: string }[]>({
    apiToken: input.apiToken,
    path: `/zones/${zoneId}/dns_records?name=${encodeURIComponent(input.hostname)}&type=CNAME`,
  });

  const record = {
    type: "CNAME",
    name: input.hostname,
    content: `${input.tunnelId}.cfargotunnel.com`,
    proxied: true,
  };

  if (existing?.[0]) {
    await cloudflareRequest({
      apiToken: input.apiToken,
      path: `/zones/${zoneId}/dns_records/${existing[0].id}`,
      method: "PATCH",
      body: record,
    });
  } else {
    await cloudflareRequest({
      apiToken: input.apiToken,
      path: `/zones/${zoneId}/dns_records`,
      method: "POST",
      body: record,
    });
  }

  logServerAction({
    level: "info",
    layer: "service",
    action: "cloudflare.route.create",
    status: "success",
    message: `Published ${input.hostname}`,
  });
}

/** Remove the ingress rule and the CNAME again. */
export async function deleteTunnelRoute(input: Omit<CloudflareRouteInput, "service">) {
  const config = await getTunnelConfiguration(input);
  const remaining = (config.ingress ?? []).filter((rule) => rule.hostname !== input.hostname);

  await putTunnelConfiguration({
    ...input,
    config: { ...config, ingress: withCatchAllLast(remaining) },
  });

  const zoneId = await resolveZoneId(input.apiToken, input.domain);
  const existing = await cloudflareRequest<{ id: string; content: string }[]>({
    apiToken: input.apiToken,
    path: `/zones/${zoneId}/dns_records?name=${encodeURIComponent(input.hostname)}&type=CNAME`,
  });

  for (const record of existing ?? []) {
    // Only reclaim records that point at this tunnel: the operator may have
    // pointed that name somewhere else by hand.
    if (record.content !== `${input.tunnelId}.cfargotunnel.com`) continue;
    await cloudflareRequest({
      apiToken: input.apiToken,
      path: `/zones/${zoneId}/dns_records/${record.id}`,
      method: "DELETE",
    });
  }

  logServerAction({
    level: "info",
    layer: "service",
    action: "cloudflare.route.delete",
    status: "success",
    message: `Unpublished ${input.hostname}`,
  });
}
