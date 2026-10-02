import "server-only";

import { request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serverEnv } from "@/lib/server/env";
import { LruCache } from "@/lib/server/cache/lru";
import { memoizeAsync } from "@/lib/server/cache/memoize-async";
import { logServerAction } from "@/lib/server/logging/logger";
import type { DockerInfo } from "@/lib/shared/contracts/docker";

const execFileAsync = promisify(execFile);

const STATS_CACHE_KEY = "all";
const statsCache = new LruCache<ContainerStats[]>(1, 5_000);

export type ContainerStats = {
  id: string;
  name: string;
  state: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
};

export type DockerStatsResult = {
  containers: ContainerStats[];
  /** false when the Docker daemon socket is unreachable or returns an error. */
  daemonAvailable: boolean;
};

type DockerContainerPort = {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
};

type DockerContainer = {
  Id: string;
  Names: string[];
  State: string;
  Status: string;
  Image?: string;
  Labels?: Record<string, string>;
  Ports?: DockerContainerPort[];
};

export type { DockerContainer, DockerContainerPort };

type DockerStatsResponse = {
  cpu_stats: {
    cpu_usage: {
      total_usage: number;
      percpu_usage?: number[];
    };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: {
      total_usage: number;
    };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage: number;
    limit: number;
  };
  networks?: Record<
    string,
    {
      rx_bytes: number;
      tx_bytes: number;
    }
  >;
  blkio_stats: {
    io_service_bytes_recursive?: Array<{
      op: string;
      value: number;
    }>;
  };
};

/**
 * Make HTTP request to a Docker-compatible socket. Defaults to the
 * configured DOCKER_SOCKET_PATH, but callers can target a different socket
 * (e.g. a rootless Podman user's socket) via `socketPath`.
 */
function dockerRequest<T>(
  path: string,
  method = "GET",
  socketPath: string = serverEnv.DOCKER_SOCKET_PATH,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path,
        method,
        headers: {
          Host: "docker",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            reject(new Error(`Docker API failed (${res.statusCode}): ${body}`));
          });
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed as T);
          } catch (error) {
            reject(new Error(`Failed to parse Docker response: ${error}`));
          }
        });
      },
    );

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * Calculate CPU percentage from Docker stats.
 * Result is clamped to [0, cpuCount * 100] to prevent values > 100% per core.
 */
function calculateCpuPercent(stats: DockerStatsResponse): number {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

  if (systemDelta > 0 && cpuDelta > 0) {
    const cpuCount = stats.cpu_stats.online_cpus || 1;
    const raw = (cpuDelta / systemDelta) * cpuCount * 100;
    return Number(Math.max(0, Math.min(raw, cpuCount * 100)).toFixed(2));
  }

  return 0;
}

/**
 * Calculate memory percentage
 */
function calculateMemoryPercent(stats: DockerStatsResponse): number {
  if (stats.memory_stats.limit > 0) {
    return Number(
      ((stats.memory_stats.usage / stats.memory_stats.limit) * 100).toFixed(2),
    );
  }
  return 0;
}

/**
 * Get network stats (total RX/TX across all interfaces)
 */
function getNetworkStats(stats: DockerStatsResponse): {
  rx: number;
  tx: number;
} {
  if (!stats.networks) {
    return { rx: 0, tx: 0 };
  }

  let totalRx = 0;
  let totalTx = 0;

  for (const network of Object.values(stats.networks)) {
    totalRx += network.rx_bytes || 0;
    totalTx += network.tx_bytes || 0;
  }

  return { rx: totalRx, tx: totalTx };
}

/**
 * Get block I/O stats
 */
function getBlockStats(stats: DockerStatsResponse): {
  read: number;
  write: number;
} {
  const ioStats = stats.blkio_stats.io_service_bytes_recursive || [];
  let totalRead = 0;
  let totalWrite = 0;

  for (const io of ioStats) {
    if (io.op === "Read") {
      totalRead += io.value;
    } else if (io.op === "Write") {
      totalWrite += io.value;
    }
  }

  return { read: totalRead, write: totalWrite };
}

async function listContainersFromSocket(
  socketPath: string,
): Promise<DockerContainer[]> {
  return dockerRequest<DockerContainer[]>("/containers/json?all=true", "GET", socketPath);
}

/**
 * List all containers across the configured Docker/Podman socket(s) (catches
 * errors per-socket, returns whatever succeeded).
 */
export async function listContainers(): Promise<DockerContainer[]> {
  const primary = await listContainersFromSocket(serverEnv.DOCKER_SOCKET_PATH).catch(
    (error) => {
      logServerAction({
        level: "error",
        layer: "service",
        action: "docker.list-containers",
        status: "error",
        message: "Failed to list Docker containers",
        error,
      });
      return [];
    },
  );

  if (!serverEnv.PODMAN_ROOTLESS_SOCKET_PATH) {
    return primary;
  }

  const rootless = await listContainersFromSocket(
    serverEnv.PODMAN_ROOTLESS_SOCKET_PATH,
  ).catch((error) => {
    logServerAction({
      level: "error",
      layer: "service",
      action: "docker.list-containers",
      status: "error",
      message: "Failed to list containers from the rootless Podman socket",
      error,
    });
    return [];
  });

  return [...primary, ...rootless];
}

/**
 * Get stats for a specific container
 */
export async function getContainerStats(
  containerId: string,
): Promise<DockerStatsResponse | null> {
  try {
    const stats = await dockerRequest<DockerStatsResponse>(
      `/containers/${containerId}/stats?stream=false`,
    );
    return stats;
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "docker.container-stats",
      status: "error",
      message: `Failed to get stats for container ${containerId}`,
      error,
    });
    return null;
  }
}

/**
 * Collect fresh stats from Docker for all containers and update the cache.
 * Calls dockerRequest directly (no catch) so daemon errors propagate to the caller.
 */
async function collectAllContainersStats(): Promise<ContainerStats[]> {
  // May throw — getAllContainersStats handles the error and sets daemonAvailable: false
  const containers = await dockerRequest<DockerContainer[]>(
    "/containers/json?all=true",
  );

  const statsPromises = containers.map(async (container) => {
    const stats = await getContainerStats(container.Id);

    if (!stats) {
      return null;
    }

    const network = getNetworkStats(stats);
    const blockIO = getBlockStats(stats);

    return {
      id: container.Id,
      name: container.Names[0]?.replace(/^\//, "") || container.Id.slice(0, 12),
      state: container.State,
      cpuPercent: calculateCpuPercent(stats),
      memoryUsed: stats.memory_stats.usage,
      memoryLimit: stats.memory_stats.limit,
      memoryPercent: calculateMemoryPercent(stats),
      networkRx: network.rx,
      networkTx: network.tx,
      blockRead: blockIO.read,
      blockWrite: blockIO.write,
    } satisfies ContainerStats;
  });

  const results = await Promise.all(statsPromises);
  const statsList = results.filter(
    (stat): stat is ContainerStats => stat !== null,
  );
  statsCache.set(STATS_CACHE_KEY, statsList);
  return statsList;
}

/**
 * Get stats for all containers, returning cached data if fresh (< 5s old).
 * Returns daemonAvailable: false when the Docker daemon socket cannot be reached.
 */
export async function getAllContainersStats(): Promise<DockerStatsResult> {
  try {
    const cached = statsCache.get(STATS_CACHE_KEY);
    if (cached) return { containers: cached, daemonAvailable: true };

    const containers = await collectAllContainersStats();
    return { containers, daemonAvailable: true };
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "docker.all-stats",
      status: "error",
      message: "Failed to get Docker container stats — daemon may be unavailable",
      error,
    });
    return { containers: [], daemonAvailable: false };
  }
}

type DockerDaemonInfo = {
  ServerVersion: string;
  Driver: string;
  CgroupDriver: string;
  Images: number;
};

/**
 * Fetch Docker engine metadata from the /info endpoint.
 * Returns null when the daemon socket is unreachable.
 */
// `docker compose version` spawns the docker CLI and its compose plugin (three
// processes) and only changes when Docker is upgraded: ask every 10 minutes.
const COMPOSE_VERSION_TTL_MS = 10 * 60_000;

const readComposeVersion = memoizeAsync(async () => {
  try {
    const { stdout } = await execFileAsync("docker", ["compose", "version", "--short"]);
    return stdout.trim();
  } catch {
    // compose plugin not installed or unavailable
    return "--";
  }
}, COMPOSE_VERSION_TTL_MS);

export async function getDockerInfo(): Promise<DockerInfo | null> {
  try {
    const [info, composeVersion] = await Promise.all([
      dockerRequest<DockerDaemonInfo>("/info"),
      readComposeVersion(),
    ]);

    return {
      engineVersion: info.ServerVersion,
      composeVersion,
      storageDriver: info.Driver,
      cgroupDriver: info.CgroupDriver,
      images: info.Images,
    };
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "docker.info",
      status: "error",
      message: "Failed to fetch Docker engine info — daemon may be unavailable",
      error,
    });
    return null;
  }
}
