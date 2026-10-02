import "server-only";

import { listContainers, type DockerContainerPort } from "@/lib/server/modules/docker/stats";
import { listInstalledStacksFromDb } from "@/lib/server/modules/apps/stacks-repository";
import { logServerAction } from "@/lib/server/logging/logger";
import { homeioComponentOf } from "@/lib/server/modules/integrations/cloudflared-connectors";
import {
  parseDockerStatusLine,
  summarizeContainers,
  type AppConditionSummary,
} from "@/lib/shared/app-condition";

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";

export type UnmanagedContainer = {
  id: string;
  name: string;
  image: string;
  /** Docker's own state: running, exited, paused, restarting, ... */
  state: string;
  /** Docker's human status line, e.g. "Up 3 days". */
  status: string;
  /** What the container is doing, read from state and status line. */
  condition: AppConditionSummary;
  composeProject: string | null;
  /** Best-guess web UI port, picked from the container's published TCP ports. */
  webUiPort: number | null;
};

function toContainerName(names: string[] | undefined, id: string) {
  const first = names?.[0]?.trim() ?? "";
  // Docker prefixes container names with a slash.
  const stripped = first.startsWith("/") ? first.slice(1) : first;
  return stripped.length > 0 ? stripped : id.slice(0, 12);
}

/**
 * Homeio doesn't know which published port (if any) serves a web UI for a
 * container it didn't install itself, so this is a best-effort guess: the
 * lowest-numbered published TCP port. Wrong for e.g. a container that only
 * exposes a database port, but there's no better signal available for an
 * unmanaged container.
 */
export function pickWebUiPort(ports: DockerContainerPort[] | undefined): number | null {
  if (!ports) return null;

  const tcpPublicPorts = ports
    .filter((port) => port.Type === "tcp" && typeof port.PublicPort === "number")
    .map((port) => port.PublicPort as number);

  if (tcpPublicPorts.length === 0) return null;

  return Math.min(...tcpPublicPorts);
}

/**
 * Containers running on this host that Homeio did not deploy.
 *
 * Homeio drives its own apps through `docker compose -p <stackName>`, so a
 * container whose compose project matches a known stack is ours. Everything
 * else was started by something else -- CasaOS, Portainer, a bare `docker run`
 * -- and is surfaced read-only for now. Homeio's own components, such as the
 * Cloudflare connector, are neither: they live in Settings.
 */
export async function listUnmanagedContainers(): Promise<UnmanagedContainer[]> {
  const [containers, stacks] = await Promise.all([
    listContainers(),
    listInstalledStacksFromDb().catch((error) => {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "docker.unmanaged-containers",
        status: "error",
        message: "Could not read installed stacks; treating all containers as unmanaged",
        error,
      });
      return [];
    }),
  ]);

  const managedProjects = new Set(stacks.map((stack) => stack.stackName));

  return containers
    .filter((container) => {
      if (homeioComponentOf(container)) return false;
      const project = container.Labels?.[COMPOSE_PROJECT_LABEL];
      return !project || !managedProjects.has(project);
    })
    .map((container) => ({
      id: container.Id,
      name: toContainerName(container.Names, container.Id),
      image: container.Image ?? "",
      state: container.State ?? "unknown",
      status: container.Status ?? "",
      condition: summarizeContainers([
        { state: container.State ?? "unknown", ...parseDockerStatusLine(container.Status ?? "") },
      ]),
      composeProject: container.Labels?.[COMPOSE_PROJECT_LABEL] ?? null,
      webUiPort: pickWebUiPort(container.Ports),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
