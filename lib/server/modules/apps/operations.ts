import "server-only";

import { randomUUID } from "node:crypto";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanupComposeDataOnUninstall,
  getComposeRuntimeInfo,
  materializeInlineStackFiles,
  runComposeDown,
  runComposePull,
  runComposeRestart,
  runComposeStart,
  runComposeStop,
  runComposeUp,
  sanitizeStackName,
} from "@/lib/server/modules/docker/compose-runner";
import { invalidateInstalledAppsCache } from "@/lib/server/modules/apps/service";
import { findStoreCatalogTemplateByAppId } from "@/lib/server/modules/store/catalog";
import {
  findCustomStoreTemplateByAppId,
  isCustomStoreTemplate,
} from "@/lib/server/modules/store/custom-apps";
import {
  extractPrimaryServiceWithName,
  parseComposeFile,
} from "@/lib/server/modules/docker/compose-parser";
import {
  createStoreOperation,
  deleteInstalledStackByAppId,
  findInstalledStackByAppId,
  findStackByWebUiPort,
  findStoreOperationById,
  markStaleOperationsAsError,
  pruneFinishedOperations,
  updateStackUpdateStatus,
  updateStoreOperation,
  upsertInstalledStack,
} from "@/lib/server/modules/apps/stacks-repository";
import { resolveInstalledComposePath } from "@/lib/server/modules/apps/installed-compose-path";
import { logServerAction } from "@/lib/server/logging/logger";
import { serverEnv } from "@/lib/server/env";
import type {
  InstalledStackConfig,
  StoreOperation,
  StoreOperationAction,
  StoreOperationEvent,
  StoreOperationStatus,
} from "@/lib/shared/contracts/apps";
import { isTagUpdateAvailable } from "@/lib/server/modules/store/update-check";
import { createNotification } from "@/lib/server/modules/notifications/service";
import yaml from "js-yaml";

type OperationParams = {
  appId: string;
  action: StoreOperationAction;
  displayName?: string;
  env?: Record<string, string>;
  webUiPort?: number;
  composeSource?: string;
  removeVolumes?: boolean;
  resetToCatalog?: boolean;
};

type OperationSubscriber = (event: StoreOperationEvent) => void;
type ComposeDocument = {
  services?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

const operationSubscribers = new Map<string, Set<OperationSubscriber>>();
const latestOperationEvent = new Map<string, StoreOperationEvent>();
const IS_TEST_ENV = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

/**
 * How long after a terminal event we keep the cached payload in
 * `latestOperationEvent` so SSE clients that connect right after
 * completion still receive it without a DB round-trip. After this
 * window the entry is dropped to keep memory bounded on long-lived
 * servers (especially Pi). The timeout is unref'd so it never blocks
 * graceful shutdown.
 */
const FINISHED_EVENT_TTL_MS = IS_TEST_ENV ? 1_000 : 60_000;

/**
 * In-memory guard for concurrent operations on the same app.
 * Prevents two simultaneous requests from launching duplicate operations.
 * Cleared on operation completion (success or error).
 */
const activeOperationsByApp = new Set<string>();

export class StoreOperationError extends Error {
  constructor(
    message: string,
    public readonly code: "operation_conflict" | "operation_limit_reached",
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "StoreOperationError";
  }
}

/**
 * Whether an install, update or uninstall currently holds this app. The
 * auto-heal watchdog reads it to stand down: restarting a container midway
 * through an operation on the same app is how you corrupt a stack.
 */
export function hasActiveOperation(appId: string) {
  return activeOperationsByApp.has(appId);
}

/** Exposed only for unit tests — clears the in-memory guard between test cases. */
export function _resetActiveOperationsForTesting() {
  activeOperationsByApp.clear();
}

// On startup, mark any DB operations that were left in "queued"/"running" state
// (from a previous crash or hard restart) as errors so the UI doesn't show them
// as stuck forever.
if (!IS_TEST_ENV) {
  void markStaleOperationsAsError().catch(() => undefined);
}
const DEPLOYMENT_HEALTH_TIMEOUT_MS = IS_TEST_ENV ? 25 : 25_000;
const DEPLOYMENT_HEALTH_POLL_MS = IS_TEST_ENV ? 1 : 2_000;
const WEB_UI_PROBE_TIMEOUT_MS = IS_TEST_ENV ? 25 : 2_000;
const WEB_UI_PROBE_ATTEMPTS = 3;
const WEB_UI_PROBE_DELAY_MS = IS_TEST_ENV ? 1 : 750;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Runs `docker compose pull` and advances progress incrementally while it runs.
// Progress goes from startPercent up to (endPercent - 2), then the caller emits endPercent.
async function pullImagesWithProgress(
  composeInput: { composePath: string; envPath: string; stackName: string },
  opts: {
    startPercent: number;
    endPercent: number;
    onProgress: (percent: number) => Promise<void>;
  },
) {
  let currentPercent = opts.startPercent;
  let done = false;
  const cap = opts.endPercent - 2;

  const interval = setInterval(() => {
    if (done || currentPercent >= cap) return;
    currentPercent = Math.min(cap, currentPercent + 1);
    void opts.onProgress(currentPercent);
  }, IS_TEST_ENV ? 1 : 2_000);
  // unref so an in-flight pull doesn't keep the Node.js event loop
  // alive during graceful shutdown (SIGTERM). clearInterval still runs
  // in the finally block below.
  interval.unref?.();

  try {
    await runComposePull(composeInput);
  } finally {
    done = true;
    clearInterval(interval);
  }
}

function assertValidPort(port: number) {
  if (!Number.isInteger(port)) {
    throw new Error("webUiPort must be an integer");
  }

  if (port < 1024 || port > 65535) {
    throw new Error("webUiPort must be between 1024 and 65535");
  }
}

function mergeEnv(
  allowedKeys: string[],
  defaults: Record<string, string>,
  existing: Record<string, string>,
  overrides: Record<string, string>,
) {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(overrides).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Unsupported env key(s): ${unknownKeys.join(", ")}. Only template-defined env keys are allowed.`,
    );
  }

  const merged: Record<string, string> = {
    ...defaults,
    ...existing,
  };

  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = String(value);
  }

  return merged;
}

function withComposeInterpolationEnv(env: Record<string, string>, appId: string) {
  return {
    AppID: appId,
    ...env,
  };
}

function parseFirstPublishedPort(ports: string[] | undefined): number | null {
  if (!ports || ports.length === 0) return null;

  for (const mapping of ports) {
    const [mappingPart] = mapping.split("/");
    const parts = mappingPart.split(":").filter(Boolean);
    const published = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    if (!published) continue;
    const parsed = Number.parseInt(published, 10);
    if (Number.isInteger(parsed)) return parsed;
  }

  return null;
}

function parseComposeDocument(content: string, sourceLabel: string): ComposeDocument {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch {
    throw new Error(`Invalid compose source (${sourceLabel})`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid compose source (${sourceLabel})`);
  }

  return parsed as ComposeDocument;
}

function resolveComposeServices(
  document: ComposeDocument,
  sourceLabel: string,
): Record<string, Record<string, unknown>> {
  const services = document.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error(`Invalid compose source (${sourceLabel})`);
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [name, value] of Object.entries(services)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid compose source (${sourceLabel})`);
    }
    normalized[name] = value;
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error(`Invalid compose source (${sourceLabel})`);
  }

  return normalized;
}

function haveEqualServiceSet(
  left: Record<string, Record<string, unknown>>,
  right: Record<string, Record<string, unknown>>,
) {
  const leftNames = Object.keys(left).sort((a, b) => a.localeCompare(b));
  const rightNames = Object.keys(right).sort((a, b) => a.localeCompare(b));
  if (leftNames.length !== rightNames.length) return false;
  return leftNames.every((name, index) => name === rightNames[index]);
}

async function resolveStoreComposeSource(appId: string) {
  const template =
    (await findStoreCatalogTemplateByAppId(appId)) ??
    (await findCustomStoreTemplateByAppId(appId));
  if (!template) {
    throw new Error(`Template not found for appId "${appId}"`);
  }

  if (isCustomStoreTemplate(template)) {
    return template.composeContent;
  }

  return readFile(template.composePath, "utf8");
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildLocalWebUiUrl(input: {
  webUiPort: number | null;
  scheme?: string | null;
  index?: string | null;
}) {
  if (!Number.isInteger(input.webUiPort) || input.webUiPort === null) {
    return null;
  }

  const scheme = typeof input.scheme === "string" && input.scheme.trim().length > 0
    ? input.scheme.trim()
    : "http";
  const index = typeof input.index === "string" && input.index.trim().length > 0
    ? input.index.trim()
    : "/";

  try {
    return new URL(index, `${scheme}://127.0.0.1:${input.webUiPort}`).toString();
  } catch {
    return null;
  }
}

async function probeWebUiReachability(url: string) {
  for (let attempt = 0; attempt < WEB_UI_PROBE_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(WEB_UI_PROBE_TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status >= 200 && response.status < 500) {
        return true;
      }
    } catch {
      // Retry within the bounded health-check window.
    }

    if (attempt < WEB_UI_PROBE_ATTEMPTS - 1) {
      await sleep(WEB_UI_PROBE_DELAY_MS);
    }
  }

  return false;
}

async function waitForDeploymentHealth(input: {
  operationId: string;
  appId: string;
  action: StoreOperationAction;
  composePath: string;
  envPath: string;
  stackName: string;
  webUiUrl?: string | null;
}) {
  const deadline = Date.now() + DEPLOYMENT_HEALTH_TIMEOUT_MS;
  let lastLifecycleStatus: "running" | "paused" | "restarting" | "stopped" | "unknown" = "unknown";
  let lastMessage: string | null = null;

  while (Date.now() < deadline) {
    const runtime = await getComposeRuntimeInfo({
      composePath: input.composePath,
      envPath: input.envPath,
      stackName: input.stackName,
    });
    lastLifecycleStatus = runtime.lifecycleStatus;

    const statusMessage =
      runtime.lifecycleStatus === "restarting"
        ? "Containers are restarting"
        : runtime.lifecycleStatus === "paused"
          ? "Containers are paused"
          : runtime.lifecycleStatus === "unknown"
            ? "Waiting for docker compose runtime status"
            : "Waiting for containers to become healthy";

    if (runtime.status === "running") {
      if (!input.webUiUrl) {
        return {
          webUiReachable: null,
        };
      }

      const webUiReachable = await probeWebUiReachability(input.webUiUrl);
      if (!webUiReachable) {
        await patchOperationAndEmit({
          operationId: input.operationId,
          appId: input.appId,
          action: input.action,
          status: "running",
          eventType: "operation.step",
          progressPercent: 98,
          step: "health-check",
          message: "Web UI not reachable yet",
        });
      }

      return {
        webUiReachable,
      };
    }

    if (statusMessage !== lastMessage) {
      await patchOperationAndEmit({
        operationId: input.operationId,
        appId: input.appId,
        action: input.action,
        status: "running",
        eventType: "operation.step",
        progressPercent: 96,
        step: "health-check",
        message: statusMessage,
      });
      lastMessage = statusMessage;
    }

    await sleep(DEPLOYMENT_HEALTH_POLL_MS);
  }

  if (lastLifecycleStatus === "restarting") {
    throw new Error("Deployment failed because containers are restarting");
  }

  if (lastLifecycleStatus === "paused") {
    throw new Error("Deployment failed because containers are paused");
  }

  if (lastLifecycleStatus === "stopped") {
    throw new Error("Deployment failed because containers never reached a running state");
  }

  throw new Error("Deployment failed because runtime status could not be confirmed");
}

function emitEvent(event: StoreOperationEvent) {
  latestOperationEvent.set(event.operationId, event);
  const subscribers = operationSubscribers.get(event.operationId);
  if (!subscribers || subscribers.size === 0) return;

  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

async function patchOperationAndEmit(input: {
  operationId: string;
  appId: string;
  action: StoreOperationAction;
  status: StoreOperationStatus;
  eventType: StoreOperationEvent["type"];
  progressPercent: number;
  step: string;
  message?: string;
  image?: string;
  dockerStatus?: string;
  progressDetail?: StoreOperationEvent["progressDetail"];
  errorMessage?: string | null;
  markStarted?: boolean;
  markFinished?: boolean;
}) {
  const progressPercent = clampPercent(input.progressPercent);

  await updateStoreOperation(input.operationId, {
    status: input.status,
    progressPercent,
    currentStep: input.step,
    errorMessage: input.errorMessage,
    markStarted: input.markStarted,
    markFinished: input.markFinished,
  });

  if (input.eventType !== "operation.pull.progress" || input.status === "error") {
    logServerAction({
      level: input.status === "error" ? "error" : "info",
      layer: "service",
      action: "store.apps.operation",
      status: input.status === "error" ? "error" : "info",
      message: input.message,
      meta: {
        operationId: input.operationId,
        appId: input.appId,
        action: input.action,
        eventType: input.eventType,
        step: input.step,
        progressPercent,
      },
    });
  }

  emitEvent({
    type: input.eventType,
    operationId: input.operationId,
    appId: input.appId,
    action: input.action,
    status: input.status,
    progressPercent,
    step: input.step,
    message: input.message,
    image: input.image,
    dockerStatus: input.dockerStatus,
    progressDetail: input.progressDetail,
    timestamp: new Date().toISOString(),
  });
}

async function runInstallOrRedeployOperation(
  operationId: string,
  params: OperationParams,
  existingStack: InstalledStackConfig | null,
) {
  const template =
    (await findStoreCatalogTemplateByAppId(params.appId)) ??
    (await findCustomStoreTemplateByAppId(params.appId));
  if (!template) {
    throw new Error(`Template not found for appId "${params.appId}"`);
  }

  if (params.action === "redeploy" && !existingStack) {
    throw new Error(`Cannot redeploy "${params.appId}" because it is not installed`);
  }

  let composeSourceInput = params.composeSource;
  if (
    existingStack &&
    !params.resetToCatalog &&
    (params.action === "install" || params.action === "redeploy") &&
    (typeof composeSourceInput !== "string" || composeSourceInput.trim().length === 0)
  ) {
    try {
      composeSourceInput = await readFile(
        resolveInstalledComposePath({
          appId: existingStack.appId,
          composePath: existingStack.composePath,
          stackName: existingStack.stackName,
        }),
        "utf8",
      );
    } catch {
      // Keep catalog/template compose fallback when installed compose is unavailable.
    }
  }

  const hasComposeSource = typeof composeSourceInput === "string" &&
    composeSourceInput.trim().length > 0;
  const requestedEnv = params.env ?? {};
  const templateComposeSource = hasComposeSource ? null : await resolveStoreComposeSource(params.appId);

  let composeSourcePrimary:
    | ReturnType<typeof extractPrimaryServiceWithName>
    | null = null;

  if (hasComposeSource) {
    const parsedCompose = parseComposeFile(composeSourceInput as string);
    if (!parsedCompose) {
      throw new Error("Invalid compose source");
    }

    composeSourcePrimary = extractPrimaryServiceWithName(parsedCompose, params.appId);
    if (!composeSourcePrimary) {
      throw new Error("Invalid compose source");
    }
  }

  let effectiveEnv: Record<string, string>;
  if (hasComposeSource) {
    const composeEnv = composeSourcePrimary?.service.environment ?? {};
    effectiveEnv = {
      ...(existingStack?.env ?? {}),
      ...composeEnv,
      ...requestedEnv,
    };
  } else {
    const allowedEnvKeys = template.env.map((definition) => definition.name);
    const templateDefaults = Object.fromEntries(
      template.env
        .filter((definition) => typeof definition.default === "string")
        .map((definition) => [definition.name, definition.default as string]),
    );
    effectiveEnv = mergeEnv(
      allowedEnvKeys,
      templateDefaults,
      existingStack?.env ?? {},
      requestedEnv,
    );
  }
  effectiveEnv = withComposeInterpolationEnv(effectiveEnv, params.appId);

  const composeSourcePort = hasComposeSource
    ? parseFirstPublishedPort(composeSourcePrimary?.service.ports)
    : null;
  const requestedPort =
    typeof params.webUiPort === "number"
      ? params.webUiPort
      : existingStack?.webUiPort ?? composeSourcePort ?? template.port ?? null;

  if (requestedPort !== null) {
    assertValidPort(requestedPort);

    const occupied = await findStackByWebUiPort(requestedPort, {
      excludeAppId: params.appId,
    });
    if (occupied) {
      throw new Error(`webUiPort ${requestedPort} is already used by "${occupied.appId}"`);
    }
  }

  const stackName =
    existingStack?.stackName ?? sanitizeStackName(params.appId, params.displayName ?? template.name);
  const isFreshInstall = params.action === "install" && !existingStack;
  const storageMappingStrategy = isFreshInstall
    ? "app_target_path"
    : "legacy_named_source";

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 8,
    step: "render",
    message: "Materializing compose files",
  });

  const materialized = await materializeInlineStackFiles({
    appId: params.appId,
    stackName,
    composeContent: hasComposeSource ? (composeSourceInput as string) : (templateComposeSource as string),
    env: effectiveEnv,
    webUiPort: requestedPort,
    storageMappingStrategy,
  });

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 15,
    step: "pull-images",
    message: "Pulling images",
  });

  await pullImagesWithProgress(
    {
      composePath: materialized.composePath,
      envPath: materialized.envPath,
      stackName: materialized.stackName,
    },
    {
      startPercent: 15,
      endPercent: 80,
      onProgress: async (percent) => {
        await patchOperationAndEmit({
          operationId,
          appId: params.appId,
          action: params.action,
          status: "running",
          eventType: "operation.step",
          progressPercent: percent,
          step: "pull-images",
          message: "Pulling images",
        });
      },
    },
  );

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 85,
    step: "compose-up",
    message: "Applying docker compose up -d",
  });

  await runComposeUp({
    composePath: materialized.composePath,
    envPath: materialized.envPath,
    stackName: materialized.stackName,
  });

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 95,
    step: "health-check",
    message: "Finalizing deployment",
  });

  const deploymentHealth = await waitForDeploymentHealth({
    operationId,
    appId: params.appId,
    action: params.action,
    composePath: materialized.composePath,
    envPath: materialized.envPath,
    stackName: materialized.stackName,
    webUiUrl: buildLocalWebUiUrl({
      webUiPort: materialized.webUiPort,
      scheme: template.scheme,
      index: template.index,
    }),
  });

  if (deploymentHealth.webUiReachable === false) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "store.apps.operation.health-check",
      status: "error",
      message: "Web UI probe did not respond before deployment completed",
      meta: {
        operationId,
        appId: params.appId,
        action: params.action,
      },
    });
  }

  await upsertInstalledStack({
    appId: params.appId,
    templateName: template.templateName,
    stackName: materialized.stackName,
    composePath: materialized.composePath,
    status: "installed",
    webUiPort: materialized.webUiPort,
    env: effectiveEnv,
    markInstalledAt: true,
  });
}

async function runUpdateOperation(
  operationId: string,
  params: OperationParams,
  existingStack: InstalledStackConfig | null,
) {
  if (!existingStack || existingStack.status === "not_installed") {
    throw new Error(`Cannot update "${params.appId}" because it is not installed`);
  }

  const resolvedComposePath = resolveInstalledComposePath({
    appId: existingStack.appId,
    composePath: existingStack.composePath,
    stackName: existingStack.stackName,
  });
  const composeInput = {
    composePath: resolvedComposePath,
    envPath: resolveEnvPathFromComposePath(resolvedComposePath),
    stackName: existingStack.stackName,
  };

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 8,
    step: "load-installed-compose",
    message: "Loading installed compose source",
  });

  let installedComposeSource: string;
  try {
    installedComposeSource = await readFile(resolvedComposePath, "utf8");
  } catch {
    throw new Error("Installed compose source is unavailable");
  }

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 16,
    step: "load-store-compose",
    message: "Loading store compose source",
  });

  const storeComposeSource = await resolveStoreComposeSource(params.appId);
  const installedDocument = parseComposeDocument(installedComposeSource, "installed");
  const storeDocument = parseComposeDocument(storeComposeSource, "store");
  const installedServices = resolveComposeServices(installedDocument, "installed");
  const storeServices = resolveComposeServices(storeDocument, "store");

  if (!haveEqualServiceSet(installedServices, storeServices)) {
    throw new Error("Installed compose does not match store services");
  }

  let updatedImageCount = 0;
  for (const serviceName of Object.keys(installedServices)) {
    const installedService = installedServices[serviceName];
    const storeService = storeServices[serviceName];
    const storeImage = storeService.image;

    if (typeof storeImage !== "string" || storeImage.trim().length === 0) {
      continue;
    }

    const normalizedStoreImage = storeImage.trim();
    if (installedService.image !== normalizedStoreImage) {
      installedService.image = normalizedStoreImage;
      updatedImageCount += 1;
    }
  }

  if (updatedImageCount === 0) {
    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 95,
      step: "up-to-date",
      message: "Installed compose images are already up to date",
    });
    return;
  }

  const nextComposeSource = yaml.dump(installedDocument, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });

  const backupPath = `${resolvedComposePath}.bak`;
  let backupPrepared = false;

  try {
    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 24,
      step: "write-compose",
      message: "Updating compose image references",
    });

    await copyFile(resolvedComposePath, backupPath);
    backupPrepared = true;
    await writeFile(resolvedComposePath, nextComposeSource, "utf8");

    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 32,
      step: "pull-images",
      message: "Pulling updated images",
    });

    await pullImagesWithProgress(
      composeInput,
      {
        startPercent: 32,
        endPercent: 83,
        onProgress: async (percent) => {
          await patchOperationAndEmit({
            operationId,
            appId: params.appId,
            action: params.action,
            status: "running",
            eventType: "operation.step",
            progressPercent: percent,
            step: "pull-images",
            message: "Pulling updated images",
          });
        },
      },
    );

    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 85,
      step: "compose-up",
      message: "Applying docker compose up -d",
    });

    await runComposeUp(composeInput);

    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 95,
      step: "health-check",
      message: "Finalizing update",
    });

    const updateTemplate =
      (await findStoreCatalogTemplateByAppId(params.appId)) ??
      (await findCustomStoreTemplateByAppId(params.appId));

    const deploymentHealth = await waitForDeploymentHealth({
      operationId,
      appId: params.appId,
      action: params.action,
      composePath: composeInput.composePath,
      envPath: composeInput.envPath,
      stackName: composeInput.stackName,
      webUiUrl: buildLocalWebUiUrl({
        webUiPort: existingStack.webUiPort,
        scheme: updateTemplate?.scheme,
        index: updateTemplate?.index,
      }),
    });

    if (deploymentHealth.webUiReachable === false) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "store.apps.operation.health-check",
        status: "error",
        message: "Web UI probe did not respond before update completed",
        meta: {
          operationId,
          appId: params.appId,
          action: params.action,
        },
      });
    }
  } catch (error) {
    if (backupPrepared) {
      try {
        await copyFile(backupPath, resolvedComposePath);
        await runComposeUp(composeInput);
      } catch (recoveryError) {
        logServerAction({
          level: "error",
          layer: "service",
          action: "store.apps.operation.rollback",
          status: "error",
          message: "Failed to restore previous compose after update error",
          error: recoveryError,
          meta: {
            operationId,
            appId: params.appId,
          },
        });
      }
    }

    throw error;
  } finally {
    if (backupPrepared) {
      try {
        await rm(backupPath, { force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  await upsertInstalledStack({
    appId: existingStack.appId,
    templateName: existingStack.templateName,
    stackName: existingStack.stackName,
    composePath: resolvedComposePath,
    status: "installed",
    webUiPort: existingStack.webUiPort,
    env: existingStack.env,
  });
}

async function runUninstallOperation(operationId: string, params: OperationParams) {
  const stack = await findInstalledStackByAppId(params.appId);

  // No record at all is not the same as a record saying "not installed". The
  // desktop lists containers Homeio did not deploy under a synthetic
  // `container:<id>`, and uninstalling one used to land here and report
  // success — the container stayed up while the UI said it was gone. Refuse
  // instead, and say why.
  if (!stack) {
    throw new Error(
      `Homeio has no record of "${params.appId}", so it cannot uninstall it. ` +
        `Containers Homeio did not deploy have to be removed with Docker directly.`,
    );
  }

  if (stack.status === "not_installed") {
    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "running",
      eventType: "operation.step",
      progressPercent: 90,
      step: "noop",
      message: "Application already uninstalled",
    });
    await deleteInstalledStackByAppId(params.appId);
    return;
  }

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 35,
    step: "compose-down",
    message: "Running docker compose down",
  });

  await runComposeDown({
    composePath: stack.composePath,
    envPath: stack.composePath.replace(/docker-compose\.yml$/, ".env"),
    stackName: stack.stackName,
    removeVolumes: params.removeVolumes,
  });

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: params.removeVolumes ? 70 : 90,
    step: "cleanup",
    message: params.removeVolumes
      ? "Removing app data"
      : "Removing installed stack files",
  });

  await cleanupComposeDataOnUninstall({
    composePath: stack.composePath,
    removeVolumes: params.removeVolumes,
  });

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 95,
    step: "cleanup",
    message: "Removing installed stack record",
  });

  await deleteInstalledStackByAppId(params.appId);
}

function resolveEnvPathFromComposePath(composePath: string) {
  return path.join(path.dirname(composePath), ".env");
}

async function runRuntimeLifecycleOperation(operationId: string, params: OperationParams) {
  const stack = await findInstalledStackByAppId(params.appId);

  if (!stack || stack.status === "not_installed") {
    throw new Error(`Cannot ${params.action} "${params.appId}" because it is not installed`);
  }

  const composeInput = {
    composePath: stack.composePath,
    envPath: resolveEnvPathFromComposePath(stack.composePath),
    stackName: stack.stackName,
  };

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 40,
    step: "compose-action",
    message: `Running compose ${params.action}`,
  });

  if (params.action === "start") {
    await runComposeStart(composeInput);
  } else if (params.action === "stop") {
    await runComposeStop(composeInput);
  } else {
    await runComposeRestart(composeInput);
  }

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 85,
    step: "status-refresh",
    message: "Refreshing runtime status",
  });

  await getComposeRuntimeInfo(composeInput);
}

async function runCheckUpdatesOperation(operationId: string, params: OperationParams) {
  const stack = await findInstalledStackByAppId(params.appId);

  if (!stack || stack.status === "not_installed") {
    throw new Error(`Cannot check updates for "${params.appId}" because it is not installed`);
  }

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 45,
    step: "inspect-images",
    message: "Checking Docker image updates",
  });

  const [catalogTemplate, customTemplate] = await Promise.all([
    findStoreCatalogTemplateByAppId(params.appId),
    findCustomStoreTemplateByAppId(params.appId),
  ]);
  const template = catalogTemplate ?? customTemplate;

  const composePath = resolveInstalledComposePath({
    appId: stack.appId,
    composePath: stack.composePath,
    stackName: stack.stackName,
  });
  let installedImage: string | null = null;
  try {
    const composeContent = await readFile(composePath, "utf8");
    const parsed = parseComposeFile(composeContent);
    if (parsed) {
      installedImage = extractPrimaryServiceWithName(parsed, params.appId)?.service.image ?? null;
    }
  } catch {
    // ignore read errors
  }

  const updateAvailable = isTagUpdateAvailable(installedImage, template?.image);

  await updateStackUpdateStatus({
    appId: params.appId,
    isUpToDate: !updateAvailable,
  });

  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.step",
    progressPercent: 90,
    step: "updates-resolved",
    message: updateAvailable ? "Updates available" : "Already up to date",
  });
}

async function executeStoreOperation(operationId: string, params: OperationParams) {
  await patchOperationAndEmit({
    operationId,
    appId: params.appId,
    action: params.action,
    status: "running",
    eventType: "operation.started",
    progressPercent: 1,
    step: "start",
    markStarted: true,
    message: "Operation started",
  });

  try {
    const existingStack = await findInstalledStackByAppId(params.appId);

    if (params.action === "install" || params.action === "redeploy") {
      await runInstallOrRedeployOperation(operationId, params, existingStack);
    } else if (params.action === "update") {
      await runUpdateOperation(operationId, params, existingStack);
    } else if (params.action === "uninstall") {
      await runUninstallOperation(operationId, params);
    } else if (params.action === "check-updates") {
      await runCheckUpdatesOperation(operationId, params);
    } else {
      await runRuntimeLifecycleOperation(operationId, params);
    }

    // Mark app as up-to-date after successful install/redeploy/update
    if (
      params.action === "install" ||
      params.action === "redeploy" ||
      params.action === "update"
    ) {
      await updateStackUpdateStatus({
        appId: params.appId,
        isUpToDate: true,
      });
    }
    invalidateInstalledAppsCache();

    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "success",
      eventType: "operation.completed",
      progressPercent: 100,
      step: "completed",
      markFinished: true,
      message: "Operation completed",
      errorMessage: null,
    });

    const appLabel = params.displayName ?? params.appId;
    if (params.action === "install") {
      void createNotification({ title: "App Installed", body: `${appLabel} installed successfully`, kind: "success" }).catch(() => undefined);
    } else if (params.action === "update") {
      void createNotification({ title: "App Updated", body: `${appLabel} updated successfully`, kind: "success" }).catch(() => undefined);
    } else if (params.action === "uninstall") {
      void createNotification({ title: "App Uninstalled", body: `${appLabel} was uninstalled`, kind: "info" }).catch(() => undefined);
    } else if (params.action === "redeploy") {
      void createNotification({ title: "App Redeployed", body: `${appLabel} redeployed successfully`, kind: "success" }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operation failed";

    await patchOperationAndEmit({
      operationId,
      appId: params.appId,
      action: params.action,
      status: "error",
      eventType: "operation.failed",
      progressPercent: 100,
      step: "failed",
      markFinished: true,
      message,
      errorMessage: message,
    });

    const appLabel = params.displayName ?? params.appId;
    if (params.action === "install" || params.action === "update" || params.action === "uninstall" || params.action === "redeploy") {
      void createNotification({ title: "Operation Failed", body: `Failed to ${params.action} ${appLabel}: ${message}`, kind: "error" }).catch(() => undefined);
    }
  } finally {
    // Always release the guard so future operations on this app can proceed.
    activeOperationsByApp.delete(params.appId);
    // Drop the cached terminal event after a short grace window so any
    // SSE client that connects right at completion still sees it from
    // memory. After the TTL, the entry is purged to keep memory bounded
    // on long-lived servers (Pi).
    const purgeTimer = setTimeout(() => {
      latestOperationEvent.delete(operationId);
    }, FINISHED_EVENT_TTL_MS);
    purgeTimer.unref?.();
  }
}

export async function startStoreOperation(params: OperationParams) {
  if (activeOperationsByApp.has(params.appId)) {
    throw new StoreOperationError(
      `App ${params.appId} already has an active operation in progress. Wait for it to complete before starting another.`,
      "operation_conflict",
      409,
    );
  }

  if (activeOperationsByApp.size >= serverEnv.STORE_MAX_CONCURRENT_OPERATIONS) {
    throw new StoreOperationError(
      "Too many app operations are already running. Wait for one to complete before starting another.",
      "operation_limit_reached",
      429,
    );
  }

  activeOperationsByApp.add(params.appId);

  // Prune stale finished rows non-blocking so the table doesn't grow unbounded.
  void pruneFinishedOperations().catch(() => undefined);

  const operationId = randomUUID();

  try {
    await createStoreOperation({
      id: operationId,
      appId: params.appId,
      action: params.action,
      status: "queued",
      progressPercent: 0,
      currentStep: "queued",
      startedAt: false,
    });
  } catch (error) {
    activeOperationsByApp.delete(params.appId);
    throw error;
  }

  logServerAction({
    layer: "service",
    action: "store.apps.operation",
    status: "start",
    message: "Queued store operation",
    meta: {
      operationId,
      appId: params.appId,
      action: params.action,
    },
  });

  queueMicrotask(() => {
    void executeStoreOperation(operationId, params);
  });

  return {
    operationId,
  };
}

export async function getStoreOperation(operationId: string): Promise<StoreOperation | null> {
  return findStoreOperationById(operationId);
}

export function getLatestStoreOperationEvent(operationId: string) {
  return latestOperationEvent.get(operationId) ?? null;
}

export function subscribeToStoreOperation(operationId: string, callback: OperationSubscriber) {
  const existing = operationSubscribers.get(operationId) ?? new Set<OperationSubscriber>();
  existing.add(callback);
  operationSubscribers.set(operationId, existing);

  return () => {
    const subscribers = operationSubscribers.get(operationId);
    if (!subscribers) return;

    subscribers.delete(callback);
    if (subscribers.size === 0) {
      operationSubscribers.delete(operationId);
    }
  };
}
