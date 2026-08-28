import "server-only";

import yaml from "js-yaml";

export type ComposeRiskCode =
  | "privileged"
  | "host_network"
  | "host_pid"
  | "docker_socket"
  | "sensitive_mount"
  | "dangerous_capability";

export type ComposeRisk = {
  code: ComposeRiskCode;
  service: string;
  detail: string;
};

export class ComposeValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ComposeValidationError";
    this.code = code;
  }
}

export class ComposeRiskError extends Error {
  readonly code = "risks_not_acknowledged";
  readonly risks: ComposeRisk[];

  constructor(risks: ComposeRisk[]) {
    super("This compose file asks for privileged access to the host");
    this.name = "ComposeRiskError";
    this.risks = risks;
  }
}

/**
 * Top-level keys Compose actually defines. Anything else is either a typo or a
 * file that is not a compose file at all — both are better caught here than by
 * `docker compose` three steps later.
 */
const ALLOWED_TOP_LEVEL = new Set([
  "version",
  "name",
  "services",
  "networks",
  "volumes",
  "configs",
  "secrets",
  "include",
]);

/** Capabilities that hand over most of what `privileged` would. */
const DANGEROUS_CAPABILITIES = new Set([
  "SYS_ADMIN",
  "SYS_MODULE",
  "SYS_PTRACE",
  "SYS_RAWIO",
  "DAC_READ_SEARCH",
  "ALL",
]);

/** Host paths that give away the machine when bind-mounted. */
const SENSITIVE_HOST_PATHS = ["/", "/etc", "/root", "/boot", "/sys", "/proc", "/var/lib/docker"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bindSource(entry: unknown): string | null {
  if (typeof entry === "string") {
    const source = entry.split(":")[0];
    return source.startsWith("/") || source.startsWith("~") ? source : null;
  }

  const record = asRecord(entry);
  if (record?.type === "bind" && typeof record.source === "string") return record.source;
  return null;
}

function inspectService(name: string, service: Record<string, unknown>): ComposeRisk[] {
  const risks: ComposeRisk[] = [];

  if (service.privileged === true) {
    risks.push({
      code: "privileged",
      service: name,
      detail: "Runs privileged — full root access to the host kernel",
    });
  }

  if (service.network_mode === "host") {
    risks.push({
      code: "host_network",
      service: name,
      detail: "Uses the host network — every port it opens is open on your server",
    });
  }

  if (service.pid === "host") {
    risks.push({
      code: "host_pid",
      service: name,
      detail: "Shares the host process namespace — it can see and signal host processes",
    });
  }

  const capAdd = Array.isArray(service.cap_add) ? service.cap_add : [];
  for (const capability of capAdd) {
    if (typeof capability === "string" && DANGEROUS_CAPABILITIES.has(capability.toUpperCase())) {
      risks.push({
        code: "dangerous_capability",
        service: name,
        detail: `Requests the ${capability} capability`,
      });
    }
  }

  const volumes = Array.isArray(service.volumes) ? service.volumes : [];
  for (const entry of volumes) {
    const source = bindSource(entry);
    if (!source) continue;

    if (source === "/var/run/docker.sock" || source.endsWith("/docker.sock")) {
      risks.push({
        code: "docker_socket",
        service: name,
        // This one deserves spelling out: it is not "access to Docker", it is
        // root on the host by another name.
        detail: "Mounts the Docker socket — equivalent to root on the host",
      });
      continue;
    }

    const normalized = source.replace(/\/+$/, "") || "/";
    if (SENSITIVE_HOST_PATHS.includes(normalized)) {
      risks.push({
        code: "sensitive_mount",
        service: name,
        detail: `Mounts ${normalized} from the host`,
      });
    }
  }

  return risks;
}

export type ComposeAnalysis = {
  services: string[];
  risks: ComposeRisk[];
};

/**
 * Parses and sanity-checks a compose document, returning the risks it carries.
 * Throws only for documents that are not usable at all — risk is reported, not
 * rejected, so the caller can decide whether it was acknowledged.
 */
export function analyzeComposeDocument(content: string): ComposeAnalysis {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new ComposeValidationError("empty", "The compose file is empty");
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(trimmed);
  } catch (error) {
    throw new ComposeValidationError(
      "invalid_yaml",
      error instanceof Error ? `Invalid YAML: ${error.message}` : "Invalid YAML",
    );
  }

  const document = asRecord(parsed);
  if (!document) {
    throw new ComposeValidationError("not_compose", "That file is not a compose document");
  }

  const unknownKeys = Object.keys(document).filter(
    (key) => !ALLOWED_TOP_LEVEL.has(key) && !key.startsWith("x-"),
  );
  if (unknownKeys.length) {
    throw new ComposeValidationError(
      "unknown_keys",
      `Unexpected top-level keys: ${unknownKeys.join(", ")}`,
    );
  }

  const services = asRecord(document.services);
  if (!services || Object.keys(services).length === 0) {
    throw new ComposeValidationError("no_services", "The compose file defines no services");
  }

  const risks: ComposeRisk[] = [];
  for (const [name, rawService] of Object.entries(services)) {
    const service = asRecord(rawService);
    if (!service) {
      throw new ComposeValidationError("invalid_service", `Service "${name}" is not an object`);
    }

    if (!service.image && !service.build) {
      throw new ComposeValidationError(
        "no_image",
        `Service "${name}" has neither an image nor a build`,
      );
    }

    risks.push(...inspectService(name, service));
  }

  return { services: Object.keys(services), risks };
}

export function assertComposeAcknowledged(analysis: ComposeAnalysis, acknowledged: boolean) {
  if (analysis.risks.length && !acknowledged) {
    throw new ComposeRiskError(analysis.risks);
  }
}
