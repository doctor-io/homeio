import "server-only";

import yaml from "js-yaml";

export type ComposeConflictCode = "port_in_use" | "container_name_taken";

export type ComposeConflict = {
  code: ComposeConflictCode;
  service: string;
  value: string;
  detail: string;
};

export type InstalledStackSummary = {
  appId: string;
  stackName: string;
  webUiPort: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Host ports a service publishes. Compose accepts "8080:80", "127.0.0.1:8080:80",
 * "8080-8081:80-81" and the long object form; the host side is what collides.
 */
export function publishedHostPorts(service: Record<string, unknown>): number[] {
  const entries = Array.isArray(service.ports) ? service.ports : [];
  const ports: number[] = [];

  for (const entry of entries) {
    if (typeof entry === "number") {
      ports.push(entry);
      continue;
    }

    if (typeof entry === "string") {
      const parts = entry.split(":");
      // No host side ("80") means Docker assigns one — nothing to collide with.
      if (parts.length < 2) continue;

      const hostPart = parts[parts.length - 2];
      for (const port of expandRange(hostPart)) ports.push(port);
      continue;
    }

    const record = asRecord(entry);
    const published = record?.published;
    if (typeof published === "number") ports.push(published);
    else if (typeof published === "string") {
      for (const port of expandRange(published)) ports.push(port);
    }
  }

  return ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65_536);
}

function expandRange(value: string): number[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const [start, end] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(start)) return [];
  if (!Number.isInteger(end)) return [start];

  // A range is bounded to keep a typo like "1-65535" from producing a
  // pathological list; anything that wide is a conflict with something anyway.
  const span = Math.min(end - start, 128);
  return Array.from({ length: span + 1 }, (_, index) => start + index);
}

/**
 * Everything that would make `docker compose up` fail, found before the queue
 * starts rather than surfacing as a subprocess error two minutes in.
 */
export function detectComposeConflicts(input: {
  composeContent: string;
  appId: string;
  installedStacks: InstalledStackSummary[];
  /** Container names Docker already holds. Empty means the check cannot fire. */
  usedContainerNames?: string[];
  /** Host ports Docker already publishes, and who holds each one. */
  usedHostPorts?: { port: number; owner: string }[];
}): ComposeConflict[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(input.composeContent);
  } catch {
    // Validation owns malformed input; there is nothing to compare here.
    return [];
  }

  const services = asRecord(asRecord(parsed)?.services);
  if (!services) return [];

  const others = input.installedStacks.filter((stack) => stack.appId !== input.appId);
  const portOwners = new Map<number, string>();
  for (const stack of others) {
    if (stack.webUiPort !== null) portOwners.set(stack.webUiPort, stack.appId);
  }

  // What Docker reports, on top of what the database remembers. The database
  // knows one port per app — its webUiPort — and knows nothing at all about a
  // container someone started outside Homeio. Both gaps ended the same way: the
  // install was accepted, then died several steps later on a raw daemon error,
  // which is the failure this check exists to replace with a sentence naming
  // the owner. Docker's answer wins, because it is the one that will refuse.
  for (const taken of input.usedHostPorts ?? []) {
    portOwners.set(taken.port, taken.owner);
  }

  const takenNames = new Set(
    (input.usedContainerNames ?? []).map((name) => name.toLowerCase()),
  );
  const conflicts: ComposeConflict[] = [];
  const seenPorts = new Set<number>();

  for (const [serviceName, rawService] of Object.entries(services)) {
    const service = asRecord(rawService);
    if (!service) continue;

    for (const port of publishedHostPorts(service)) {
      const owner = portOwners.get(port);
      if (owner && !seenPorts.has(port)) {
        seenPorts.add(port);
        conflicts.push({
          code: "port_in_use",
          service: serviceName,
          value: String(port),
          detail: `Port ${port} is already published by "${owner}"`,
        });
      }
    }

    const containerName =
      typeof service.container_name === "string" ? service.container_name.trim() : "";
    if (containerName && takenNames.has(containerName.toLowerCase())) {
      conflicts.push({
        code: "container_name_taken",
        service: serviceName,
        value: containerName,
        detail: `A container named "${containerName}" already exists`,
      });
    }
  }

  return conflicts;
}

/**
 * What Docker currently holds: container names, and published host ports with
 * the container holding each.
 *
 * Separate from `detectComposeConflicts` so that stays pure and testable; this
 * is the impure half, and it is deliberately forgiving. Docker being
 * unreachable returns nothing rather than throwing: the caller then checks
 * against the database alone, which is what it did before, instead of refusing
 * an install because the daemon was slow to answer.
 */
export async function collectDockerConflictSources(): Promise<{
  usedContainerNames: string[];
  usedHostPorts: { port: number; owner: string }[];
}> {
  const { listContainers } = await import("@/lib/server/modules/docker/stats");
  const containers = await listContainers();

  const usedContainerNames: string[] = [];
  const usedHostPorts: { port: number; owner: string }[] = [];

  for (const container of containers) {
    const raw = container.Names?.[0]?.trim() ?? "";
    const name = (raw.startsWith("/") ? raw.slice(1) : raw) || container.Id.slice(0, 12);
    if (name) usedContainerNames.push(name);

    // A stopped container still owns its name, but not its ports — Docker only
    // reports a PublicPort while the binding is live, so this needs no filter.
    for (const binding of container.Ports ?? []) {
      if (typeof binding.PublicPort === "number") {
        usedHostPorts.push({ port: binding.PublicPort, owner: name });
      }
    }
  }

  return { usedContainerNames, usedHostPorts };
}
