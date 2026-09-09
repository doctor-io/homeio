import "server-only";

import {
  listInstalledStacksFromDb,
  patchInstalledStackMeta,
} from "@/lib/server/modules/apps/stacks-repository";
import { getCloudflareTunnelConfig } from "@/lib/server/modules/integrations/cloudflare-tunnel-config";
import {
  createTunnelRoute,
  decodeConnectorToken,
  deleteTunnelRoute,
} from "@/lib/server/modules/integrations/cloudflare-api";
import type { CloudflareTunnelAppExposure } from "@/lib/shared/contracts/cloudflare-tunnel";
import type { InstalledStackConfig } from "@/lib/shared/contracts/apps";

/** Subdomains are a DNS label: lowercase alphanumerics and dashes. */
export function toSubdomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function buildTunnelUrl(subdomain: string, domain: string) {
  const label = toSubdomain(subdomain);
  if (!label || !domain) return null;
  return `https://${label}.${domain}`;
}

function suggestSubdomain(stack: InstalledStackConfig) {
  return (
    toSubdomain(stack.tunnelSubdomain ?? "") ||
    toSubdomain(stack.displayName ?? "") ||
    toSubdomain(stack.templateName) ||
    toSubdomain(stack.appId)
  );
}

export async function listCloudflareTunnelExposures(): Promise<CloudflareTunnelAppExposure[]> {
  const [config, stacks] = await Promise.all([
    getCloudflareTunnelConfig(),
    listInstalledStacksFromDb(),
  ]);

  return stacks
    .filter((stack) => stack.status === "installed")
    .map((stack) => {
      const subdomain = suggestSubdomain(stack);
      const exposed = Boolean(stack.tunnelSubdomain);

      return {
        appId: stack.appId,
        name: stack.displayName || stack.templateName || stack.appId,
        port: stack.webUiPort,
        subdomain,
        exposed,
        publicUrl: exposed ? buildTunnelUrl(subdomain, config.domain) : null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Publish or unpublish one app. Exposing it fills in the app's link, which is
 * the whole point: the operator should not have to retype the address the
 * tunnel already serves.
 */
export async function saveCloudflareTunnelExposure(input: {
  appId: string;
  exposed: boolean;
  subdomain?: string;
}): Promise<CloudflareTunnelAppExposure> {
  const config = await getCloudflareTunnelConfig();
  const stacks = await listInstalledStacksFromDb();
  const stack = stacks.find((entry) => entry.appId === input.appId);

  if (!stack) {
    throw new Error("App not found");
  }

  if (input.exposed && !config.domain) {
    throw new Error("Set the tunnel domain before exposing an app");
  }

  const subdomain = toSubdomain(input.subdomain ?? "") || suggestSubdomain(stack);

  if (input.exposed && !subdomain) {
    throw new Error("Could not derive a subdomain for this app");
  }

  const publicUrl = input.exposed ? buildTunnelUrl(subdomain, config.domain) : null;

  // Only reclaim the link when it is one we set. A link typed by hand stays.
  const previousTunnelUrl = stack.tunnelSubdomain
    ? buildTunnelUrl(stack.tunnelSubdomain, config.domain)
    : null;
  const linkIsOurs = stack.webUiUrl !== null && stack.webUiUrl === previousTunnelUrl;

  // With an API token Homeio owns the route end to end; without one it only
  // records the mapping and the operator adds the hostname by hand.
  const identifiers = config.token ? decodeConnectorToken(config.token) : null;
  if (config.apiToken && identifiers) {
    const hostname = `${input.exposed ? subdomain : stack.tunnelSubdomain}.${config.domain}`;
    const route = {
      apiToken: config.apiToken,
      accountId: identifiers.accountId,
      tunnelId: identifiers.tunnelId,
      domain: config.domain,
      hostname,
    };

    if (input.exposed && stack.webUiPort) {
      // The connector runs in host network mode on this machine, so the app's
      // published port is reachable on localhost.
      await createTunnelRoute({ ...route, service: `http://localhost:${stack.webUiPort}` });
    } else if (!input.exposed && stack.tunnelSubdomain) {
      await deleteTunnelRoute(route);
    }
  }

  await patchInstalledStackMeta(input.appId, {
    tunnelSubdomain: input.exposed ? subdomain : null,
    ...(input.exposed
      ? { webUiUrl: publicUrl }
      : linkIsOurs
        ? { webUiUrl: null }
        : {}),
  });

  return {
    appId: stack.appId,
    name: stack.displayName || stack.templateName || stack.appId,
    port: stack.webUiPort,
    subdomain,
    exposed: input.exposed,
    publicUrl,
  };
}
