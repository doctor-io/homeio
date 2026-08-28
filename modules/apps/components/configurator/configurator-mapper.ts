import yaml from "js-yaml";

import type { AppComposeData } from "@/modules/apps/hooks/useAppCompose";
import type { StoreAppDetail } from "@/lib/shared/contracts/apps";

export type ConfiguratorView = "classic" | "compose" | "docker_run" | "import_url";

export type PortProtocol = "TCP" | "UDP" | "TCP + UDP";

export type PortRow = {
  id: string;
  host: string;
  container: string;
  protocol: PortProtocol;
};

export type VolumeRow = {
  id: string;
  host: string;
  container: string;
};

export type EnvRow = {
  id: string;
  key: string;
  value: string;
};

export type WebUiState = {
  protocol: "http" | "https";
  host: string;
  port: string;
  path: string;
};

export type ClassicConfigState = {
  dockerImage: string;
  title: string;
  iconUrl: string;
  webUi: WebUiState;
  network: string;
  ports: PortRow[];
  volumes: VolumeRow[];
  envVars: EnvRow[];
  privileged: boolean;
  restartPolicy: string;
  capabilities: string;
  hostname: string;
  devices: string[];
  containerCommands: string[];
};

export type DockerRunState = {
  name: string;
  iconUrl: string;
  repositoryUrl: string;
  source: string;
};

type ComposeLike = {
  services?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

type PrimaryServiceSelectionInput = {
  compose: ComposeLike;
  appId?: string;
  primaryServiceName?: string;
};

const INFRA_SERVICE_TOKEN_PATTERN =
  /(?:^|[-_.])(db|database|postgres|postgresql|mariadb|mysql|redis|cache|broker|queue|rabbitmq|kafka|zookeeper|mongo|mongodb|elasticsearch|minio)(?:$|[-_.])/i;
const APP_ALIAS_PATTERN = /^(app|main|server|web|frontend|backend)$/i;

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function parsePortValue(port: string) {
  if (!port.trim()) return undefined;
  const parsed = Number.parseInt(port, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }
  return parsed;
}

function toWebUiUrl(webUi: WebUiState) {
  const host = webUi.host.trim();
  const port = webUi.port.trim();
  if (!host || !port) return undefined;

  const normalizedPath = webUi.path.trim();
  const path = normalizedPath
    ? normalizedPath.startsWith("/")
      ? normalizedPath
      : `/${normalizedPath}`
    : "";

  return `${webUi.protocol}://${host}:${port}${path}`;
}

function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function resolveWebUiHost(host: string | undefined, fallbackHost?: string) {
  const trimmedHost = host?.trim();
  const trimmedFallback = fallbackHost?.trim();

  if (!trimmedHost) {
    return trimmedFallback || "localhost";
  }

  if (trimmedFallback && isLoopbackHost(trimmedHost)) {
    return trimmedFallback;
  }

  return trimmedHost;
}

function parseEnvironment(environment: unknown): Record<string, string> {
  if (Array.isArray(environment)) {
    const map: Record<string, string> = {};
    for (const item of environment) {
      if (typeof item !== "string") continue;
      const [key, ...rest] = item.split("=");
      if (!key) continue;
      map[key] = rest.join("=");
    }
    return map;
  }

  if (environment && typeof environment === "object") {
    return Object.fromEntries(
      Object.entries(environment as Record<string, unknown>).map(
        ([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")],
      ),
    );
  }

  return {};
}

function parseWebUi(
  appUrl: string | undefined,
  fallbackPort: string,
  fallbackHost?: string,
): WebUiState {
  if (!appUrl) {
    return {
      protocol: "http" as const,
      host: resolveWebUiHost(undefined, fallbackHost),
      port: fallbackPort,
      path: "",
    };
  }

  try {
    const parsed = new URL(appUrl);
    const protocol: WebUiState["protocol"] =
      parsed.protocol.replace(":", "") === "https" ? "https" : "http";
    return {
      protocol,
      host: resolveWebUiHost(parsed.hostname, fallbackHost),
      port: parsed.port || fallbackPort,
      path: parsed.pathname === "/" ? "" : parsed.pathname,
    };
  } catch {
    return {
      protocol: "http" as const,
      host: resolveWebUiHost(undefined, fallbackHost),
      port: fallbackPort,
      path: "",
    };
  }
}

function parsePortMapping(value: string): Omit<PortRow, "id"> | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;

  const [mappingPart, protocolPart] = trimmed.split("/");
  const protocol = protocolPart?.toLowerCase() === "udp" ? "UDP" : "TCP";
  const segments = mappingPart.split(":").filter(Boolean);

  let host = "";
  let container = "";
  if (segments.length === 1) {
    host = segments[0] || "";
    container = segments[0] || "";
  } else if (segments.length >= 2) {
    host = segments[segments.length - 2] || "";
    container = segments[segments.length - 1] || "";
  }

  if (!host || !container) return null;

  return {
    host,
    container,
    protocol,
  } satisfies Omit<PortRow, "id">;
}

function parsePorts(ports: unknown): PortRow[] {
  if (!Array.isArray(ports)) return [];

  return ports
    .map((item, index) => {
      let parsed: Omit<PortRow, "id"> | null = null;

      if (typeof item === "string") {
        parsed = parsePortMapping(item);
      } else if (item && typeof item === "object") {
        const candidate = item as {
          published?: unknown;
          target?: unknown;
          protocol?: unknown;
        };
        const host =
          candidate.published === undefined || candidate.published === null
            ? ""
            : String(candidate.published).trim();
        const container =
          candidate.target === undefined || candidate.target === null
            ? ""
            : String(candidate.target).trim();
        const protocol =
          typeof candidate.protocol === "string" &&
          candidate.protocol.toLowerCase() === "udp"
            ? "UDP"
            : "TCP";

        if (host && container) {
          parsed = {
            host,
            container,
            protocol,
          };
        }
      }

      if (!parsed) return null;
      return {
        id: nextId(`port-${index}`),
        ...parsed,
      } satisfies PortRow;
    })
    .filter((item): item is PortRow => item !== null);
}

function parseVolumeMapping(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;

  const segments = trimmed.split(":");
  if (segments.length < 2) return null;

  const host = segments[0] || "";
  const container = segments[1] || "";

  if (!host || !container) return null;

  return {
    host,
    container,
  } satisfies Omit<VolumeRow, "id">;
}

function parseVolumes(volumes: unknown): VolumeRow[] {
  if (!Array.isArray(volumes)) return [];

  return volumes
    .map((item, index) => {
      let parsed: Omit<VolumeRow, "id"> | null = null;

      if (typeof item === "string") {
        parsed = parseVolumeMapping(item);
      } else if (item && typeof item === "object") {
        const candidate = item as {
          source?: unknown;
          target?: unknown;
        };
        const host =
          candidate.source === undefined || candidate.source === null
            ? ""
            : String(candidate.source).trim();
        const container =
          candidate.target === undefined || candidate.target === null
            ? ""
            : String(candidate.target).trim();

        if (container) {
          parsed = {
            host,
            container,
          };
        }
      }

      if (!parsed) return null;
      return {
        id: nextId(`volume-${index}`),
        ...parsed,
      } satisfies VolumeRow;
    })
    .filter((item): item is VolumeRow => item !== null);
}

function parseStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function parseCommand(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof input === "string" && input.trim().length > 0) {
    return [input.trim()];
  }

  return [];
}

function hasPublishedPorts(input: Record<string, unknown>): boolean {
  const ports = input.ports;
  if (!Array.isArray(ports)) {
    return false;
  }

  return ports.some((entry) => {
    if (typeof entry === "string") {
      return entry.trim().length > 0;
    }
    if (!entry || typeof entry !== "object") {
      return false;
    }

    const candidate = entry as { target?: unknown; published?: unknown };
    return Boolean(candidate.target ?? candidate.published);
  });
}

function scorePrimaryServiceCandidate(input: {
  name: string;
  service: Record<string, unknown>;
  appId?: string;
}): number {
  const name = input.name.toLowerCase();
  const appId = input.appId?.toLowerCase().trim();
  const image =
    typeof input.service.image === "string" ? input.service.image.toLowerCase() : "";

  let score = 0;
  if (hasPublishedPorts(input.service)) {
    score += 40;
  }

  if (name === "app") {
    score += 60;
  } else if (APP_ALIAS_PATTERN.test(name)) {
    score += 30;
  }
  if (name.includes("server")) {
    score += 20;
  }

  if (appId) {
    if (name === appId) {
      score += 100;
    } else if (name.startsWith(`${appId}-`) || name.endsWith(`-${appId}`)) {
      score += 45;
    } else if (name.includes(appId)) {
      score += 25;
    }

    if (image.includes(appId)) {
      score += 20;
    }
  }

  if (INFRA_SERVICE_TOKEN_PATTERN.test(name)) {
    score -= 80;
  }

  return score;
}

function getPrimaryService(
  input: PrimaryServiceSelectionInput,
): { name: string; service: Record<string, unknown> } {
  const { compose, appId, primaryServiceName } = input;
  const services = compose.services ?? {};
  const names = Object.keys(services);
  if (names.length === 0) {
    return {
      name: "app",
      service: {},
    };
  }

  if (primaryServiceName && services[primaryServiceName]) {
    return {
      name: primaryServiceName,
      service: services[primaryServiceName] ?? {},
    };
  }

  if (appId) {
    const normalizedAppId = appId.toLowerCase();
    const exactMatch = names.find((name) => name.toLowerCase() === normalizedAppId);
    if (exactMatch) {
      return {
        name: exactMatch,
        service: services[exactMatch] ?? {},
      };
    }
  }

  const rankedServices = names
    .map((name, index) => ({
      name,
      index,
      score: scorePrimaryServiceCandidate({
        name,
        service: services[name] ?? {},
        appId,
      }),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const name = rankedServices[0]?.name ?? names[0];
  return {
    name,
    service: services[name] ?? {},
  };
}

function toEnvRows(environment: Record<string, string>) {
  return Object.entries(environment)
    .filter(([key]) => key !== "APP_URL" && key !== "VOLUMES")
    .map(([key, value], index) => ({
      id: nextId(`env-${index}`),
      key,
      value,
    } satisfies EnvRow));
}

function toEnvPayload(state: ClassicConfigState) {
  const env = Object.fromEntries(
    state.envVars
      .filter((row) => row.key.trim().length > 0)
      .map((row) => [row.key.trim(), row.value]),
  );

  const appUrl = toWebUiUrl(state.webUi);
  if (appUrl) {
    env.APP_URL = appUrl;
  }

  return env;
}

function composeFromObject(compose: ComposeLike) {
  return yaml.dump(compose, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

export function toAppId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toHostname(value: string) {
  const normalized = toAppId(value);
  return normalized.length > 0 ? normalized : "app";
}

export function createDefaultClassicState(seed: {
  title: string;
  iconUrl: string;
  fallbackPort?: number | null;
  fallbackHost?: string;
}): ClassicConfigState {
  const fallbackPort = seed.fallbackPort ? String(seed.fallbackPort) : "";

  return {
    dockerImage: "nginx:latest",
    title: seed.title,
    iconUrl: seed.iconUrl,
    webUi: {
      protocol: "http",
      host: resolveWebUiHost(undefined, seed.fallbackHost),
      port: fallbackPort,
      path: "",
    },
    network: "bridge",
    ports: fallbackPort
      ? [
          {
            id: nextId("port-0"),
            host: fallbackPort,
            container: fallbackPort,
            protocol: "TCP",
          },
        ]
      : [],
    volumes: [],
    envVars: [],
    privileged: false,
    restartPolicy: "always",
    capabilities: "",
    hostname: toHostname(seed.title || "app"),
    devices: [],
    containerCommands: [],
  };
}

export function buildInitialComposeDraft(input: {
  appId: string;
  template?: StoreAppDetail;
  composeData?: AppComposeData;
  dockerImageFallback?: string;
}) {
  const { composeData, template, appId, dockerImageFallback } = input;
  const installed = template?.installedConfig;

  const baseEnv = installed?.env ?? {};
  const service: Record<string, unknown> = {
    image:
      composeData?.image ||
      baseEnv.DOCKER_IMAGE ||
      baseEnv.IMAGE ||
      dockerImageFallback ||
      `${appId}/${appId}:latest`,
  };

  if (composeData?.ports && composeData.ports.length > 0) {
    service.ports = composeData.ports;
  } else if (template?.webUiPort) {
    service.ports = [`${template.webUiPort}:${template.webUiPort}`];
  }

  if (composeData?.volumes && composeData.volumes.length > 0) {
    service.volumes = composeData.volumes;
  }

  const environment = {
    ...(composeData?.environment ?? {}),
    ...baseEnv,
  };
  if (Object.keys(environment).length > 0) {
    service.environment = environment;
  }

  if (composeData?.networkMode || baseEnv.NETWORK_MODE) {
    service.network_mode = composeData?.networkMode ?? baseEnv.NETWORK_MODE;
  }

  if (composeData?.restart || baseEnv.RESTART_POLICY) {
    service.restart = composeData?.restart ?? baseEnv.RESTART_POLICY;
  }

  if (typeof composeData?.privileged === "boolean") {
    service.privileged = composeData.privileged;
  } else if (baseEnv.PRIVILEGED) {
    service.privileged = ["true", "1", "yes"].includes(baseEnv.PRIVILEGED.toLowerCase());
  }

  if (composeData?.capAdd && composeData.capAdd.length > 0) {
    service.cap_add = composeData.capAdd;
  } else if (baseEnv.CAP_ADD) {
    service.cap_add = baseEnv.CAP_ADD.split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  if (composeData?.hostname || installed?.stackName) {
    service.hostname = composeData?.hostname ?? installed?.stackName;
  }

  if (composeData?.devices && composeData.devices.length > 0) {
    service.devices = composeData.devices;
  }

  if (composeData?.command) {
    service.command = composeData.command;
  }

  return composeFromObject({
    services: {
      app: service,
    },
  });
}

export function composeToClassicState(input: {
  composeDraft: string;
  seed: {
    title: string;
    iconUrl: string;
    fallbackPort?: number | null;
    fallbackHost?: string;
  };
  appId?: string;
  primaryServiceName?: string;
}): ClassicConfigState {
  const parsed = yaml.load(input.composeDraft) as ComposeLike;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Compose is empty or invalid");
  }

  const { service } = getPrimaryService({
    compose: parsed,
    appId: input.appId,
    primaryServiceName: input.primaryServiceName,
  });
  const environment = parseEnvironment(service.environment);
  const ports = parsePorts(service.ports);

  const fallbackPort =
    ports[0]?.host ||
    (input.seed.fallbackPort ? String(input.seed.fallbackPort) : "");
  const webUi = parseWebUi(environment.APP_URL, fallbackPort, input.seed.fallbackHost);

  return {
    dockerImage:
      typeof service.image === "string" && service.image.length > 0
        ? service.image
        : "",
    title: input.seed.title,
    iconUrl: input.seed.iconUrl,
    webUi,
    network:
      typeof service.network_mode === "string" && service.network_mode.length > 0
        ? service.network_mode
        : "bridge",
    ports,
    volumes: parseVolumes(service.volumes),
    envVars: toEnvRows(environment),
    privileged: Boolean(service.privileged),
    restartPolicy:
      typeof service.restart === "string" && service.restart.length > 0
        ? service.restart
        : "always",
    capabilities: parseStringArray(service.cap_add).join(","),
    hostname:
      typeof service.hostname === "string" && service.hostname.length > 0
        ? service.hostname
        : toHostname(input.seed.title || "app"),
    devices: parseStringArray(service.devices),
    containerCommands: parseCommand(service.command),
  };
}

export function safeComposeToClassicState(input: {
  composeDraft: string;
  seed: {
    title: string;
    iconUrl: string;
    fallbackPort?: number | null;
    fallbackHost?: string;
  };
  appId?: string;
  primaryServiceName?: string;
}): {
  state: ClassicConfigState | null;
  error: string | null;
} {
  try {
    return {
      state: composeToClassicState(input),
      error: null,
    };
  } catch (error) {
    return {
      state: null,
      error: error instanceof Error ? error.message : "Invalid docker compose",
    };
  }
}

export function classicStateToCompose(
  state: ClassicConfigState,
  previousComposeDraft?: string,
  options?: {
    appId?: string;
    primaryServiceName?: string;
  },
) {
  let compose: ComposeLike = {
    services: {
      app: {},
    },
  };

  if (previousComposeDraft) {
    try {
      const parsed = yaml.load(previousComposeDraft) as ComposeLike;
      if (parsed && typeof parsed === "object") {
        compose = parsed;
      }
    } catch {
      // Keep fallback skeleton when old compose is invalid.
    }
  }

  if (!compose.services) {
    compose.services = {};
  }

  const serviceInfo = getPrimaryService({
    compose,
    appId: options?.appId,
    primaryServiceName: options?.primaryServiceName,
  });
  const previousService = serviceInfo.service;
  const nextService: Record<string, unknown> = {
    ...previousService,
    image: state.dockerImage,
    environment: toEnvPayload(state),
    network_mode: state.network,
    restart: state.restartPolicy,
    privileged: state.privileged,
    hostname: state.hostname,
  };

  const normalizedPorts =
    state.network.trim().toLowerCase() === "host"
      ? []
      : state.ports
          .filter((row) => row.host.trim() && row.container.trim())
          .map((row) =>
            row.protocol === "UDP"
              ? `${row.host}:${row.container}/udp`
              : `${row.host}:${row.container}`,
          );
  if (normalizedPorts.length > 0) {
    nextService.ports = normalizedPorts;
  } else {
    delete nextService.ports;
  }

  const normalizedVolumes = state.volumes
    .filter((row) => row.host.trim() && row.container.trim())
    .map((row) => `${row.host}:${row.container}`);
  if (normalizedVolumes.length > 0) {
    nextService.volumes = normalizedVolumes;
  } else {
    delete nextService.volumes;
  }

  const capAdd = state.capabilities
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (capAdd.length > 0) {
    nextService.cap_add = capAdd;
  } else {
    delete nextService.cap_add;
  }

  const devices = state.devices.map((entry) => entry.trim()).filter(Boolean);
  if (devices.length > 0) {
    nextService.devices = devices;
  } else {
    delete nextService.devices;
  }

  const command = state.containerCommands.map((entry) => entry.trim()).filter(Boolean);
  if (command.length === 1) {
    nextService.command = command[0];
  } else if (command.length > 1) {
    nextService.command = command;
  } else {
    delete nextService.command;
  }

  compose.services[serviceInfo.name] = nextService;

  return composeFromObject(compose);
}

export function buildInstallPayloadFromClassic(input: {
  appId: string;
  state: ClassicConfigState;
  composeSource?: string;
}) {
  const payload = {
    appId: input.appId,
    displayName: input.state.title.trim() || undefined,
    env: toEnvPayload(input.state),
    webUiPort: parsePortValue(input.state.webUi.port),
    composeSource: input.composeSource,
  };

  return payload;
}

export function buildSettingsPayloadFromClassic(input: {
  appId: string;
  current: ClassicConfigState;
  initial: ClassicConfigState;
  composeSource?: string;
  initialComposeSource?: string;
}) {
  const payload: {
    appId: string;
    displayName: string;
    iconUrl: string | null;
    env?: Record<string, string>;
    webUiPort?: number;
    composeSource?: string;
  } = {
    appId: input.appId,
    displayName: input.current.title,
    iconUrl: input.current.iconUrl.trim() || null,
  };

  const nextCompose = input.composeSource?.trim();
  const initialCompose = input.initialComposeSource?.trim();
  if (nextCompose && nextCompose.length > 0 && nextCompose !== initialCompose) {
    payload.composeSource = input.composeSource;
  }

  const currentEnv = toEnvPayload(input.current);
  const initialEnv = toEnvPayload(input.initial);
  if (JSON.stringify(currentEnv) !== JSON.stringify(initialEnv)) {
    payload.env = currentEnv;
  }

  const currentPort = parsePortValue(input.current.webUi.port);
  const initialPort = parsePortValue(input.initial.webUi.port);
  if (currentPort !== undefined && currentPort !== initialPort) {
    payload.webUiPort = currentPort;
  }

  return payload;
}

export function buildInitialDockerRunState(input: {
  title: string;
  iconUrl: string;
  port: string;
}) {
  const appName = input.title.trim() || "my-app";
  const webUiPort = input.port.trim() || "8080";

  return {
    name: appName,
    iconUrl: input.iconUrl,
    repositoryUrl: "",
    source: `docker run --name ${toAppId(appName)} -p ${webUiPort}:80 nginx:latest`,
  } satisfies DockerRunState;
}
