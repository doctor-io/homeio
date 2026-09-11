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

/** Shape returned by both the REST endpoint and the SSE "stats.updated" event. */
export type DockerStatsPayload = {
  containers: ContainerStats[];
  /** false when the Docker daemon socket is unreachable. */
  daemonAvailable: boolean;
};

export type DockerStatsResponse = {
  data: DockerStatsPayload;
};

export type DockerStatsStreamEvent = {
  type: "stats.updated" | "heartbeat";
  data: DockerStatsPayload | { timestamp: string };
};

/** Engine-level metadata returned by GET /api/v1/docker/info */
export type DockerInfo = {
  engineVersion: string;
  composeVersion: string;
  storageDriver: string;
  cgroupDriver: string;
  images: number;
};

export type DockerInfoResponse = {
  data: DockerInfo;
};

/** A container running on this host that Homeio did not deploy. */
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
