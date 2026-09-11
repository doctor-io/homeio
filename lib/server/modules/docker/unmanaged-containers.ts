import "server-only";

import { listContainers } from "@/lib/server/modules/docker/stats";
import { listInstalledStacksFromDb } from "@/lib/server/modules/apps/stacks-repository";
import { logServerAction } from "@/lib/server/logging/logger";

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";

export type UnmanagedContainer = {
  id: string;
  name: string;
  image: string;
  /** Docker's own state: running, exited, paused, restarting, ... */
  state: string;
  /** Docker's human status line, e.g. "Up 3 days". */
  status: string;
  composeProject: string | null;
};

function toContainerName(names: string[] | undefined, id: string) {
  const first = names?.[0]?.trim() ?? "";
  // Docker prefixes container names with a slash.
  const stripped = first.startsWith("/") ? first.slice(1) : first;
  return stripped.length > 0 ? stripped : id.slice(0, 12);
}

/**
 * Containers running on this host that Homeio did not deploy.
 *
 * Homeio drives its own apps through `docker compose -p <stackName>`, so a
 * container whose compose project matches a known stack is ours. Everything
 * else was started by something else -- CasaOS, Portainer, a bare `docker run`
 * -- and is surfaced read-only for now.
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
      const project = container.Labels?.[COMPOSE_PROJECT_LABEL];
      return !project || !managedProjects.has(project);
    })
    .map((container) => ({
      id: container.Id,
      name: toContainerName(container.Names, container.Id),
      image: container.Image ?? "",
      state: container.State ?? "unknown",
      status: container.Status ?? "",
      composeProject: container.Labels?.[COMPOSE_PROJECT_LABEL] ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
