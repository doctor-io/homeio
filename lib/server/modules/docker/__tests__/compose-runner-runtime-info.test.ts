import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

// Mock child_process BEFORE importing the runner so the promisified
// execFileAsync wraps our fake instead of the real one.
type ExecCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

const execFileMock = vi.fn();

vi.mock("node:child_process", () => {
  const execFile = (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => execFileMock(callback);

  // Node's real child_process.execFile has a custom util.promisify.custom
  // implementation resolving {stdout, stderr}, which is what
  // compose-runner's execFileAsync destructures. Without this, the default
  // promisify wrapping would resolve with just the raw stdout string.
  Object.defineProperty(execFile, promisify.custom, {
    value: () =>
      new Promise((resolve, reject) => {
        execFileMock((error: NodeJS.ErrnoException | null, stdout: string, stderr: string) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
  });

  return { execFile };
});

vi.mock("@/lib/server/env", () => ({
  serverEnv: {
    DOCKER_COMPOSE_TIMEOUT_MS: 30_000,
  },
}));

const { logServerActionMock } = vi.hoisted(() => ({
  logServerActionMock: vi.fn(),
}));

vi.mock("@/lib/server/logging/logger", () => ({
  logServerAction: logServerActionMock,
  withServerTiming: async <T>(_meta: unknown, fn: () => Promise<T>) => fn(),
}));

import { getComposeRuntimeInfo } from "@/lib/server/modules/docker/compose-runner";

describe("getComposeRuntimeInfo", () => {
  it("logs and returns unknown status when `compose ps` fails", async () => {
    execFileMock.mockImplementationOnce((callback: ExecCallback) => {
      const error: NodeJS.ErrnoException & { killed?: boolean; stderr?: string } =
        Object.assign(new Error("Command failed: docker compose ps"), {
          killed: false,
          stderr: "some provider-specific failure",
        });
      callback(error, "", "some provider-specific failure");
    });

    const result = await getComposeRuntimeInfo({
      composePath: "/tmp/x/docker-compose.yml",
      envPath: "/tmp/x/.env",
      stackName: "hermes",
    });

    expect(result).toEqual({
      status: "unknown",
      lifecycleStatus: "unknown",
      containerNames: [],
      primaryContainerName: null,
      condition: { condition: "unknown", exitCode: null },
    });

    expect(logServerActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "docker.compose.runtime-info",
        message: expect.stringContaining("hermes"),
      }),
    );
  });

  it("reports stopped, not unknown, when `compose ps` succeeds with no containers", async () => {
    execFileMock.mockImplementationOnce((callback: ExecCallback) => {
      callback(null, "", "");
    });

    const result = await getComposeRuntimeInfo({
      composePath: "/tmp/x/docker-compose.yml",
      envPath: "/tmp/x/.env",
      stackName: "hermes",
    });

    expect(result.status).toBe("stopped");
    expect(logServerActionMock).not.toHaveBeenCalled();
  });
});
