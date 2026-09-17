import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

vi.mock("@/lib/server/modules/store/catalog", () => ({
  findStoreCatalogTemplateByAppId: vi.fn(),
}));

vi.mock("@/lib/server/modules/docker/compose-parser", () => ({
  parseComposeFile: vi.fn(),
  extractPrimaryServiceWithName: vi.fn(),
}));

vi.mock("@/lib/server/modules/docker/compose-runner", () => ({
  cleanupComposeDataOnUninstall: vi.fn(),
  getComposeRuntimeInfo: vi.fn(),
  materializeInlineStackFiles: vi.fn(),
  runComposeDown: vi.fn(),
  runComposePull: vi.fn(),
  runComposeRestart: vi.fn(),
  runComposeStart: vi.fn(),
  runComposeStop: vi.fn(),
  runComposeUp: vi.fn(),
  sanitizeStackName: vi.fn(() => "adguard-home"),
}));

vi.mock("@/lib/server/modules/store/custom-apps", () => ({
  findCustomStoreTemplateByAppId: vi.fn(),
  isCustomStoreTemplate: vi.fn(() => false),
}));

vi.mock("@/lib/server/modules/store/docker-client", () => ({}));

vi.mock("@/lib/server/modules/apps/service", () => ({
  invalidateInstalledAppsCache: vi.fn(),
}));

vi.mock("@/lib/server/modules/docker/stats", () => ({
  listContainers: vi.fn(async () => []),
}));

vi.mock("@/lib/server/modules/apps/stacks-repository", () => ({
  createStoreOperation: vi.fn(),
  deleteInstalledStackByAppId: vi.fn(),
  findInstalledStackByAppId: vi.fn(),
  findStackByWebUiPort: vi.fn(),
  findStoreOperationById: vi.fn(),
  markStaleOperationsAsError: vi.fn().mockResolvedValue(undefined),
  pruneFinishedOperations: vi.fn().mockResolvedValue(undefined),
  updateStoreOperation: vi.fn(),
  updateStackUpdateStatus: vi.fn(),
  upsertInstalledStack: vi.fn(),
}));

import { findStoreCatalogTemplateByAppId } from "@/lib/server/modules/store/catalog";
import {
  extractPrimaryServiceWithName,
  parseComposeFile,
} from "@/lib/server/modules/docker/compose-parser";
import {
  cleanupComposeDataOnUninstall,
  getComposeRuntimeInfo,
  materializeInlineStackFiles,
  runComposeDown,
  runComposePull,
  runComposeRestart,
  runComposeUp,
} from "@/lib/server/modules/docker/compose-runner";
import { findCustomStoreTemplateByAppId } from "@/lib/server/modules/store/custom-apps";
import { invalidateInstalledAppsCache } from "@/lib/server/modules/apps/service";
import { listContainers } from "@/lib/server/modules/docker/stats";
import {
  createStoreOperation,
  deleteInstalledStackByAppId,
  findInstalledStackByAppId,
  findStackByWebUiPort,
  updateStoreOperation,
  updateStackUpdateStatus,
  upsertInstalledStack,
} from "@/lib/server/modules/apps/stacks-repository";
import {
  _resetActiveOperationsForTesting,
  getLatestStoreOperationEvent,
  startStoreOperation,
} from "@/lib/server/modules/apps/operations";
import type { StoreOperationError } from "@/lib/server/modules/apps/operations";

async function waitForLatestEventType(operationId: string, expectedType: string) {
  for (let index = 0; index < 50; index += 1) {
    const latest = getLatestStoreOperationEvent(operationId);
    if (latest?.type === expectedType) {
      return latest;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for event type "${expectedType}"`);
}

async function writeCatalogComposeFile(prefix: string, composeContent: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const composePath = path.join(tempDir, "docker-compose.yml");
  await writeFile(composePath, composeContent, "utf8");
  return { tempDir, composePath };
}

describe("store operations", () => {
  beforeEach(() => {
    _resetActiveOperationsForTesting();
    vi.mocked(findStoreCatalogTemplateByAppId).mockReset();
    vi.mocked(findCustomStoreTemplateByAppId).mockReset();
    vi.mocked(cleanupComposeDataOnUninstall).mockReset();
    vi.mocked(parseComposeFile).mockReset();
    vi.mocked(extractPrimaryServiceWithName).mockReset();
    vi.mocked(getComposeRuntimeInfo).mockReset();
    vi.mocked(materializeInlineStackFiles).mockReset();
    vi.mocked(runComposePull).mockReset();
    vi.mocked(runComposeUp).mockReset();
    vi.mocked(invalidateInstalledAppsCache).mockReset();
    vi.mocked(createStoreOperation).mockReset();
    vi.mocked(deleteInstalledStackByAppId).mockReset();
    vi.mocked(findInstalledStackByAppId).mockReset();
    vi.mocked(findStackByWebUiPort).mockReset();
    vi.mocked(updateStoreOperation).mockReset();
    vi.mocked(updateStackUpdateStatus).mockReset();
    vi.mocked(upsertInstalledStack).mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
      }),
    );
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "running",
      lifecycleStatus: "running",
      containerNames: ["app"],
      primaryContainerName: "app",
    });
  });

  it("rejects a second active operation for the same app", async () => {
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);

    await startStoreOperation({
      appId: "example",
      action: "install",
    });

    await expect(
      startStoreOperation({
        appId: "example",
        action: "update",
      }),
    ).rejects.toMatchObject({
      code: "operation_conflict",
      statusCode: 409,
    } satisfies Partial<StoreOperationError>);
  });

  it("rejects new operations when the global concurrency cap is reached", async () => {
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);

    await startStoreOperation({ appId: "one", action: "install" });
    await startStoreOperation({ appId: "two", action: "install" });
    await startStoreOperation({ appId: "three", action: "install" });

    await expect(
      startStoreOperation({ appId: "four", action: "install" }),
    ).rejects.toMatchObject({
      code: "operation_limit_reached",
      statusCode: 429,
    } satisfies Partial<StoreOperationError>);
  });

  it("runs install flow and completes with progress updates", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-install-",
      `services:
  adguard-home:
    image: ghcr.io/example/app:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "adguard-home",
      templateName: "adguard-home",
      name: "AdGuard Home",
      description: "dns",
      platform: "Docker",
      note: "note",
      categories: ["Network"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/bigbeartechworld/big-bear-portainer",
      stackFile: "Apps/adguard-home/docker-compose.yml",
      composePath,
      env: [{ name: "TZ", default: "UTC" }],
      screenshots: [],
      image: "ghcr.io/example/app:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "adguard-home",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);

    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/adguard-home",
      composePath: "/tmp/store/stacks/adguard-home/docker-compose.yml",
      envPath: "/tmp/store/stacks/adguard-home/.env",
      stackName: "adguard-home",
      webUiPort: 3001,
    });
    vi.mocked(runComposePull).mockResolvedValue(undefined);

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "adguard-home",
      action: "install",
      webUiPort: 3001,
      env: {
        TZ: "Africa/Tunis",
      },
    });

    await done;

    expect(operationId).toBeTruthy();
    expect(upsertInstalledStack).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "adguard-home",
        status: "installed",
        webUiPort: 3001,
      }),
    );
    expect(materializeInlineStackFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "adguard-home",
        storageMappingStrategy: "app_target_path",
      }),
    );
    expect(invalidateInstalledAppsCache).toHaveBeenCalledTimes(1);
    expect(runComposeUp).toHaveBeenCalled();

    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.status).toBe("success");
    await rm(tempDir, { recursive: true, force: true });
  });

  it("marks operation as failed when docker pull fails", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-install-fail-",
      `services:
  homepage:
    image: ghcr.io/example/homepage:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "homepage",
      templateName: "homepage",
      name: "Homepage",
      description: "dashboard",
      platform: "Docker",
      note: "note",
      categories: ["Productivity"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/bigbeartechworld/big-bear-portainer",
      stackFile: "Apps/Homepage/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/homepage:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "homepage",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);

    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/homepage",
      composePath: "/tmp/store/stacks/homepage/docker-compose.yml",
      envPath: "/tmp/store/stacks/homepage/.env",
      stackName: "homepage",
      webUiPort: null,
    });
    vi.mocked(runComposePull).mockRejectedValue(new Error("unauthorized"));
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "homepage",
      action: "install",
    });

    await done;

    const latest = await waitForLatestEventType(operationId, "operation.failed");
    expect(latest?.status).toBe("error");
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails install when compose runtime never reaches running", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-install-health-stopped-",
      `services:
  grafana:
    image: grafana/grafana:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "grafana",
      templateName: "grafana",
      name: "Grafana",
      description: "observability",
      platform: "Docker",
      note: "note",
      categories: ["Developer"],
      logoUrl: null,
      port: 3000,
      repositoryUrl: "https://github.com/grafana/grafana",
      stackFile: "Apps/Grafana/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "grafana/grafana:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "grafana",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/grafana",
      composePath: "/tmp/store/stacks/grafana/docker-compose.yml",
      envPath: "/tmp/store/stacks/grafana/.env",
      stackName: "grafana",
      webUiPort: 3000,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "stopped",
      lifecycleStatus: "stopped",
      containerNames: ["grafana"],
      primaryContainerName: "grafana",
    });

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "grafana",
      action: "install",
    });

    await done;

    expect(upsertInstalledStack).not.toHaveBeenCalled();
    const latest = await waitForLatestEventType(operationId, "operation.failed");
    expect(latest?.message).toBe(
      "Deployment failed because containers never reached a running state",
    );
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails install when compose runtime remains unknown", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-install-health-unknown-",
      `services:
  kuma:
    image: louislam/uptime-kuma:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "uptime-kuma",
      templateName: "uptime-kuma",
      name: "Uptime Kuma",
      description: "monitoring",
      platform: "Docker",
      note: "note",
      categories: ["Monitoring"],
      logoUrl: null,
      port: 3001,
      repositoryUrl: "https://github.com/louislam/uptime-kuma",
      stackFile: "Apps/Uptime-Kuma/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "louislam/uptime-kuma:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "kuma",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/uptime-kuma",
      composePath: "/tmp/store/stacks/uptime-kuma/docker-compose.yml",
      envPath: "/tmp/store/stacks/uptime-kuma/.env",
      stackName: "uptime-kuma",
      webUiPort: 3001,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "unknown",
      lifecycleStatus: "unknown",
      containerNames: [],
      primaryContainerName: null,
    });

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "uptime-kuma",
      action: "install",
    });

    await done;

    expect(upsertInstalledStack).not.toHaveBeenCalled();
    const latest = await waitForLatestEventType(operationId, "operation.failed");
    expect(latest?.message).toBe(
      "Deployment failed because runtime status could not be confirmed",
    );
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps install successful when containers are stable but the Web UI probe fails", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-install-health-webui-",
      `services:
  home-assistant:
    image: ghcr.io/home-assistant/home-assistant:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "home-assistant",
      templateName: "home-assistant",
      name: "Home Assistant",
      description: "automation",
      platform: "Docker",
      note: "note",
      categories: ["Automation"],
      logoUrl: null,
      port: 8123,
      repositoryUrl: "https://github.com/home-assistant/core",
      stackFile: "Apps/Home-Assistant/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/home-assistant/home-assistant:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "home-assistant",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/home-assistant",
      composePath: "/tmp/store/stacks/home-assistant/docker-compose.yml",
      envPath: "/tmp/store/stacks/home-assistant/.env",
      stackName: "home-assistant",
      webUiPort: 8123,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "home-assistant",
      action: "install",
    });

    await done;

    expect(upsertInstalledStack).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "home-assistant",
      }),
    );
    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.status).toBe("success");
    expect(updateStoreOperation).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        currentStep: "health-check",
      }),
    );
    await rm(tempDir, { recursive: true, force: true });
  });

  it("refuses to uninstall a container Homeio never deployed", async () => {
    // The desktop lists foreign containers as `container:<id>`. There is no
    // stack record behind one, and that used to be read as "already
    // uninstalled": the operation reported success while the container kept
    // running, so the UI said it was gone and it was not.
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);

    const { operationId } = await startStoreOperation({
      appId: "container:de8926a963f7",
      action: "uninstall",
    });

    const latest = await waitForLatestEventType(operationId, "operation.failed");
    expect(latest?.status).toBe("error");
    expect(latest?.message).toMatch(/no record of/);
    expect(deleteInstalledStackByAppId).not.toHaveBeenCalled();
    expect(runComposeDown).not.toHaveBeenCalled();
  });

  it("hard-deletes stack record on uninstall and removes data when requested", async () => {
    const { composePath: twoFactorComposePath } = await writeCatalogComposeFile(
      "store-uninstall-",
      "services:\n  app:\n    image: 2fauth\n",
    );
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "2fauth",
      templateName: "2fauth",
      stackName: "big-bear-2fauth",
      composePath: twoFactorComposePath,
      status: "installed",
      webUiPort: 8000,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(runComposeDown).mockResolvedValue(undefined);
    vi.mocked(cleanupComposeDataOnUninstall).mockResolvedValue(undefined);
    vi.mocked(deleteInstalledStackByAppId).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "2fauth",
      action: "uninstall",
      removeVolumes: true,
    });

    await done;

    expect(runComposeDown).toHaveBeenCalledWith({
      composePath: twoFactorComposePath,
      envPath: twoFactorComposePath.replace("docker-compose.yml", ".env"),
      stackName: "big-bear-2fauth",
      removeVolumes: true,
    });
    expect(cleanupComposeDataOnUninstall).toHaveBeenCalledWith({
      composePath: twoFactorComposePath,
      removeVolumes: true,
    });
    expect(deleteInstalledStackByAppId).toHaveBeenCalledWith("2fauth");
    expect(invalidateInstalledAppsCache).toHaveBeenCalledTimes(1);

    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.status).toBe("success");
  });

  it("always cleans up installed stack files during uninstall even when data deletion is disabled", async () => {
    const { composePath: pingvinComposePath } = await writeCatalogComposeFile(
      "store-uninstall-keep-data-",
      "services:\n  app:\n    image: pingvin\n",
    );
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "pingvin-share",
      templateName: "pingvin-share",
      stackName: "pingvin-share",
      composePath: pingvinComposePath,
      status: "installed",
      webUiPort: 3410,
      env: {},
      installedAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(runComposeDown).mockResolvedValue(undefined);
    vi.mocked(cleanupComposeDataOnUninstall).mockResolvedValue(undefined);
    vi.mocked(deleteInstalledStackByAppId).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "pingvin-share",
      action: "uninstall",
      removeVolumes: false,
    });

    await done;

    expect(runComposeDown).toHaveBeenCalledWith({
      composePath: pingvinComposePath,
      envPath: pingvinComposePath.replace("docker-compose.yml", ".env"),
      stackName: "pingvin-share",
      removeVolumes: false,
    });
    expect(cleanupComposeDataOnUninstall).toHaveBeenCalledWith({
      composePath: pingvinComposePath,
      removeVolumes: false,
    });
    expect(deleteInstalledStackByAppId).toHaveBeenCalledWith("pingvin-share");
  });

  it("uses legacy storage mapping on redeploy for existing apps", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-redeploy-",
      `services:
  home-assistant:
    image: ghcr.io/example/home-assistant:latest
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "home-assistant",
      templateName: "home-assistant",
      name: "Home Assistant",
      description: "automation",
      platform: "Docker",
      note: "note",
      categories: ["Automation"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/bigbeartechworld/big-bear-portainer",
      stackFile: "Apps/home-assistant/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/home-assistant:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "home-assistant",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "home-assistant",
      templateName: "home-assistant",
      stackName: "home-assistant",
      composePath: "/tmp/store/stacks/home-assistant/docker-compose.yml",
      status: "installed",
      webUiPort: null,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/home-assistant",
      composePath: "/tmp/store/stacks/home-assistant/docker-compose.yml",
      envPath: "/tmp/store/stacks/home-assistant/.env",
      stackName: "home-assistant",
      webUiPort: null,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "home-assistant",
      action: "redeploy",
    });

    await done;

    expect(materializeInlineStackFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "home-assistant",
        storageMappingStrategy: "legacy_named_source",
      }),
    );
    expect(invalidateInstalledAppsCache).toHaveBeenCalledTimes(1);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses composeSource for install materialization and bypasses template env whitelist", async () => {
    const composeSource = `services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server:v2.5.6\n    ports:\n      - \"2283:2283\"\n    environment:\n      DB_HOSTNAME: immich-postgres\n      CUSTOM_ENV: yes\n`;

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "immich",
      templateName: "immich",
      name: "Immich",
      description: "photos",
      platform: "Docker",
      note: "note",
      categories: ["Photos"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/bigbeartechworld/big-bear-portainer",
      stackFile: "Apps/immich/docker-compose.yml",
      composePath: "/tmp/store/immich/docker-compose.yml",
      env: [{ name: "TZ", default: "UTC" }],
      screenshots: [],
      image: "ghcr.io/immich-app/immich-server:v2.5.6",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "immich-server",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(parseComposeFile).mockReturnValue({
      services: {
        "immich-server": {
          image: "ghcr.io/immich-app/immich-server:v2.5.6",
          ports: ["2283:2283"],
          environment: {
            DB_HOSTNAME: "immich-postgres",
            CUSTOM_ENV: "yes",
          },
        },
      },
    });
    vi.mocked(extractPrimaryServiceWithName).mockReturnValue({
      name: "immich-server",
      service: {
        image: "ghcr.io/immich-app/immich-server:v2.5.6",
        ports: ["2283:2283"],
        environment: {
          DB_HOSTNAME: "immich-postgres",
          CUSTOM_ENV: "yes",
        },
      },
    });
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/immich",
      composePath: "/tmp/store/stacks/immich/docker-compose.yml",
      envPath: "/tmp/store/stacks/immich/.env",
      stackName: "immich",
      webUiPort: 2283,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "immich",
      action: "install",
      composeSource,
    });

    await done;

    expect(materializeInlineStackFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "immich",
        composeContent: composeSource,
      }),
    );
    expect(upsertInstalledStack).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "immich",
        env: expect.objectContaining({
          AppID: "immich",
          DB_HOSTNAME: "immich-postgres",
          CUSTOM_ENV: "yes",
        }),
      }),
    );
  });

  it("injects AppID into compose interpolation env during install", async () => {
    const composeSource = `services:\n  home-assistant:\n    image: ghcr.io/home-assistant/home-assistant:latest\n    volumes:\n      - /DATA/AppData/$AppID/config:/config\n`;

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "home-assistant",
      templateName: "home-assistant",
      name: "Home Assistant",
      description: "automation",
      platform: "Docker",
      note: "note",
      categories: ["Automation"],
      logoUrl: null,
      port: 8123,
      repositoryUrl: "https://github.com/home-assistant/core",
      stackFile: "Apps/home-assistant/docker-compose.yml",
      composePath: "/tmp/store/home-assistant/docker-compose.yml",
      env: [],
      screenshots: [],
      image: "ghcr.io/home-assistant/home-assistant:latest",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "home-assistant",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue(null);
    vi.mocked(findStackByWebUiPort).mockResolvedValue(null);
    vi.mocked(parseComposeFile).mockReturnValue({
      services: {
        "home-assistant": {
          image: "ghcr.io/home-assistant/home-assistant:latest",
          volumes: ["/DATA/AppData/$AppID/config:/config"],
        },
      },
    });
    vi.mocked(extractPrimaryServiceWithName).mockReturnValue({
      name: "home-assistant",
      service: {
        image: "ghcr.io/home-assistant/home-assistant:latest",
        volumes: ["/DATA/AppData/$AppID/config:/config"],
      },
    });
    vi.mocked(materializeInlineStackFiles).mockResolvedValue({
      stackDir: "/tmp/store/stacks/home-assistant",
      composePath: "/tmp/store/stacks/home-assistant/docker-compose.yml",
      envPath: "/tmp/store/stacks/home-assistant/.env",
      stackName: "home-assistant",
      webUiPort: 8123,
    });

    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "home-assistant",
      action: "install",
      composeSource,
    });

    await done;

    expect(materializeInlineStackFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "home-assistant",
        env: expect.objectContaining({
          AppID: "home-assistant",
        }),
      }),
    );
  });

  it("updates only service images and preserves other compose fields", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-"));
    const composePath = path.join(tempDir, "docker-compose.yml");
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    const initialCompose = `services:
  app:
    image: ghcr.io/example/app:v1
    environment:
      TZ: UTC
      APP_URL: http://localhost:3100
    ports:
      - "3100:3100"
  redis:
    image: redis:6
`;
    await writeFile(composePath, initialCompose, "utf8");
    await writeFile(
      storeComposePath,
      `services:
  app:
    image: ghcr.io/example/app:v2
  redis:
    image: redis:7
`,
      "utf8",
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath,
      status: "installed",
      webUiPort: 3100,
      env: {
        TZ: "UTC",
      },
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(upsertInstalledStack).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const updatedCompose = await readFile(composePath, "utf8");
    const parsed = yaml.load(updatedCompose) as {
      services: Record<string, { image?: string; environment?: Record<string, string>; ports?: string[] }>;
    };

    expect(parsed.services.app.image).toBe("ghcr.io/example/app:v2");
    expect(parsed.services.redis.image).toBe("redis:7");
    expect(parsed.services.app.environment).toEqual({
      TZ: "UTC",
      APP_URL: "http://localhost:3100",
    });
    expect(parsed.services.app.ports).toEqual(["3100:3100"]);
    expect(runComposeUp).toHaveBeenCalledTimes(1);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("treats update as no-op when installed images are already current", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-noop-"));
    const composePath = path.join(tempDir, "docker-compose.yml");
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    const initialCompose = `services:\n  app:\n    image: ghcr.io/example/app:v2\n    environment:\n      TZ: UTC\n`;
    await writeFile(composePath, initialCompose, "utf8");
    await writeFile(storeComposePath, `services:\n  app:\n    image: ghcr.io/example/app:v2\n`, "utf8");

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath,
      status: "installed",
      webUiPort: 3100,
      env: {
        TZ: "UTC",
      },
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let finished = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!finished && patch.status === "success") {
          finished = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.status).toBe("success");
    expect(runComposeUp).not.toHaveBeenCalled();
    expect(runComposePull).not.toHaveBeenCalled();

    const composeAfterNoop = await readFile(composePath, "utf8");
    expect(composeAfterNoop).toBe(initialCompose);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails update with explicit error when installed compose is missing", async () => {
    const { tempDir, composePath } = await writeCatalogComposeFile(
      "store-update-missing-",
      `services:
  app:
    image: ghcr.io/example/app:v2
`,
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath: "/tmp/missing-compose/docker-compose.yml",
      status: "installed",
      webUiPort: 3100,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    const { operationId } = await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const latest = await waitForLatestEventType(operationId, "operation.failed");
    expect(latest?.message).toBe("Installed compose source is unavailable");
    expect(runComposeUp).not.toHaveBeenCalled();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resolves moved installed compose path before update", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-resolved-compose-"));
    const fallbackDir = path.join(tempDir, "missing-compose", "example");
    await mkdir(fallbackDir, { recursive: true });
    await writeFile(
      path.join(fallbackDir, "docker-compose.yml"),
      "services:\n  app:\n    image: ghcr.io/example/app:v1\n",
      "utf8",
    );
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    await writeFile(
      storeComposePath,
      "services:\n  app:\n    image: ghcr.io/example/app:v2\n",
      "utf8",
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath: path.join(tempDir, "missing-compose", "docker-compose.yml"),
      status: "installed",
      webUiPort: 3100,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);
    vi.mocked(runComposeUp).mockResolvedValue();
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "running",
      primaryContainerName: "example",
    });

    const { operationId } = await startStoreOperation({
      appId: "example",
      action: "update",
    });

    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.type).toBe("operation.completed");
    expect(runComposeUp).toHaveBeenCalledWith(
      expect.objectContaining({
        composePath: path.join(fallbackDir, "docker-compose.yml"),
      }),
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails update when installed and store services do not match", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-mismatch-"));
    const composePath = path.join(tempDir, "docker-compose.yml");
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    const initialCompose = `services:\n  app:\n    image: ghcr.io/example/app:v1\n`;
    await writeFile(composePath, initialCompose, "utf8");
    await writeFile(
      storeComposePath,
      `services:
  web:
    image: ghcr.io/example/app:v2
`,
      "utf8",
    );

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "web",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath,
      status: "installed",
      webUiPort: 3100,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const composeAfterFailure = await readFile(composePath, "utf8");
    expect(composeAfterFailure).toBe(initialCompose);
    expect(runComposeUp).not.toHaveBeenCalled();

    await rm(tempDir, { recursive: true, force: true });
  });

  it("restores backup compose when update apply fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-rollback-"));
    const composePath = path.join(tempDir, "docker-compose.yml");
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    const initialCompose = `services:\n  app:\n    image: ghcr.io/example/app:v1\n`;
    await writeFile(composePath, initialCompose, "utf8");
    await writeFile(storeComposePath, `services:\n  app:\n    image: ghcr.io/example/app:v2\n`, "utf8");

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: null,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath,
      status: "installed",
      webUiPort: 3100,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    vi.mocked(runComposeUp)
      .mockRejectedValueOnce(new Error("compose up failed"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const composeAfterRollback = await readFile(composePath, "utf8");
    expect(composeAfterRollback).toBe(initialCompose);
    expect(runComposeUp).toHaveBeenCalledTimes(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("restores backup compose when update health-check fails after compose up", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "store-update-health-rollback-"));
    const composePath = path.join(tempDir, "docker-compose.yml");
    const storeComposePath = path.join(tempDir, "store-compose.yml");
    const initialCompose = `services:\n  app:\n    image: ghcr.io/example/app:v1\n`;
    await writeFile(composePath, initialCompose, "utf8");
    await writeFile(storeComposePath, `services:\n  app:\n    image: ghcr.io/example/app:v2\n`, "utf8");

    vi.mocked(findStoreCatalogTemplateByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      name: "Example",
      description: "example",
      platform: "Docker",
      note: "note",
      categories: ["Tools"],
      logoUrl: null,
      port: 3100,
      repositoryUrl: "https://github.com/example/store",
      stackFile: "Apps/example/docker-compose.yml",
      composePath: storeComposePath,
      env: [],
      screenshots: [],
      image: "ghcr.io/example/app:v2",
      volumes: [],
      scheme: "http",
      index: "/",
      mainServiceName: "app",
    });
    vi.mocked(findCustomStoreTemplateByAppId).mockResolvedValue(null);
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "example",
      templateName: "example",
      stackName: "example",
      composePath,
      status: "installed",
      webUiPort: 3100,
      env: {},
      installedAt: "2026-02-24T00:00:00.000Z",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    vi.mocked(runComposeUp).mockResolvedValue(undefined);
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "stopped",
      lifecycleStatus: "restarting",
      containerNames: ["example-app-1"],
      primaryContainerName: "example-app-1",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStackUpdateStatus).mockResolvedValue(undefined);

    let failed = false;
    const done = new Promise<void>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!failed && patch.status === "error") {
          failed = true;
          resolve();
        }
      });
    });

    await startStoreOperation({
      appId: "example",
      action: "update",
    });

    await done;

    const composeAfterRollback = await readFile(composePath, "utf8");
    expect(composeAfterRollback).toBe(initialCompose);
    expect(runComposeUp).toHaveBeenCalledTimes(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("purges latestOperationEvent after the terminal-event grace window", async () => {
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "purge-me",
      templateName: "purge-me",
      stackName: "purge-me",
      composePath: "/tmp/store/stacks/purge-me/docker-compose.yml",
      status: "installed",
      webUiPort: 4001,
      env: {},
      installedAt: new Date("2026-02-24T00:00:00.000Z"),
      updatedAt: new Date("2026-02-24T00:00:00.000Z"),
      isUpToDate: true,
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
    vi.mocked(updateStoreOperation).mockResolvedValue(undefined);
    vi.mocked(getComposeRuntimeInfo).mockResolvedValue({
      status: "running",
      lifecycleStatus: "running",
      containerNames: ["purge"],
      primaryContainerName: "purge",
    });
    vi.mocked(runComposeRestart).mockResolvedValue(undefined);

    const { operationId } = await startStoreOperation({
      appId: "purge-me",
      action: "restart",
    });

    const latest = await waitForLatestEventType(operationId, "operation.completed");
    expect(latest?.status).toBe("success");

    // Wait past the test TTL (1s) plus a margin so the unref'd timer fires.
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(getLatestStoreOperationEvent(operationId)).toBeNull();
  });
});

describe("uninstalling an app whose files are gone (D-8)", () => {
  const MISSING = "/nonexistent/stacks/ghost/docker-compose.yml";

  function ghostStack() {
    vi.mocked(findInstalledStackByAppId).mockResolvedValue({
      appId: "ghost",
      templateName: "ghost",
      stackName: "ghost",
      composePath: MISSING,
      status: "installed",
      webUiPort: 8080,
      env: {},
      installedAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
    });
    vi.mocked(createStoreOperation).mockResolvedValue(undefined);
  }

  function settled() {
    let done = false;
    // `errorMessage`, not `message` — the field the operation record actually
    // carries, and the one the UI renders. Asserting the wrong one is how a
    // probe reports "no message" about a message that is there.
    return new Promise<{ status?: string; errorMessage?: string | null }>((resolve) => {
      vi.mocked(updateStoreOperation).mockImplementation(async (_id, patch) => {
        if (!done && (patch.status === "success" || patch.status === "error")) {
          done = true;
          resolve(patch as { status?: string; errorMessage?: string | null });
        }
      });
    });
  }

  it("removes the record when nothing is left on disk or in Docker", async () => {
    // Before this, `docker compose down` could not run without its file, so the
    // uninstall errored — and the delete route refuses a definition whose stack
    // still reads "installed". The app could be neither uninstalled nor
    // forgotten. A database restored ahead of its stack directories lands here.
    ghostStack();
    vi.mocked(listContainers).mockResolvedValue([]);
    const outcome = settled();

    await startStoreOperation({ appId: "ghost", action: "uninstall" });

    expect((await outcome).status).toBe("success");
    expect(deleteInstalledStackByAppId).toHaveBeenCalledWith("ghost");
    expect(runComposeDown).not.toHaveBeenCalled();
  });

  it("still refuses when the containers are up, and names them", async () => {
    // Dropping the record here would leave containers running with nothing in
    // Homeio naming them — the state the "no record of" guard exists to avoid.
    ghostStack();
    vi.mocked(listContainers).mockResolvedValue([
      {
        Id: "abc123def456",
        Names: ["/ghost-web-1"],
        State: "running",
        Status: "Up 2 days",
        Labels: { "com.docker.compose.project": "ghost" },
      },
    ]);
    const outcome = settled();

    await startStoreOperation({ appId: "ghost", action: "uninstall" });

    const patch = await outcome;
    expect(patch.status).toBe("error");
    expect(patch.errorMessage).toMatch(/ghost-web-1/);
    expect(deleteInstalledStackByAppId).not.toHaveBeenCalled();
  });

  it("refuses rather than guessing when Docker does not answer", async () => {
    ghostStack();
    vi.mocked(listContainers).mockRejectedValue(new Error("docker socket gone"));
    const outcome = settled();

    await startStoreOperation({ appId: "ghost", action: "uninstall" });

    expect((await outcome).status).toBe("error");
    expect(deleteInstalledStackByAppId).not.toHaveBeenCalled();
  });

  it("ignores containers belonging to another stack", async () => {
    ghostStack();
    vi.mocked(listContainers).mockResolvedValue([
      {
        Id: "other",
        Names: ["/jellyfin-1"],
        State: "running",
        Status: "Up 1 day",
        Labels: { "com.docker.compose.project": "jellyfin" },
      },
    ]);
    const outcome = settled();

    await startStoreOperation({ appId: "ghost", action: "uninstall" });

    expect((await outcome).status).toBe("success");
    expect(deleteInstalledStackByAppId).toHaveBeenCalledWith("ghost");
  });
});
