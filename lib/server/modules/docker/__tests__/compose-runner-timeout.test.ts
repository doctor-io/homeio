import { describe, expect, it, vi } from "vitest";

// Mock child_process BEFORE importing the runner so the promisified
// execFileAsync wraps our fake instead of the real one.
type ExecCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: ExecCallback,
  ) => execFileMock(callback),
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: {
    DOCKER_COMPOSE_TIMEOUT_MS: 30_000,
  },
}));

vi.mock("@/lib/server/logging/logger", () => ({
  logServerAction: vi.fn(),
  withServerTiming: async <T>(_meta: unknown, fn: () => Promise<T>) => fn(),
}));

import { runComposePull } from "@/lib/server/modules/docker/compose-runner";

describe("runComposeCommand timeout handling", () => {
  it("surfaces a friendly message when the child process times out", async () => {
    execFileMock.mockImplementationOnce((callback: ExecCallback) => {
      const error: NodeJS.ErrnoException & { killed?: boolean; signal?: string } =
        Object.assign(new Error("Command failed: docker compose pull"), {
          killed: true,
          signal: "SIGTERM",
          code: undefined,
        });
      callback(error, "", "");
    });

    await expect(
      runComposePull({
        composePath: "/tmp/x/docker-compose.yml",
        envPath: "/tmp/x/.env",
        stackName: "demo",
      }),
    ).rejects.toThrow(/timed out after 30s/);
  });

  it("propagates docker stderr for non-timeout failures", async () => {
    execFileMock.mockImplementationOnce((callback: ExecCallback) => {
      const error: NodeJS.ErrnoException & { stderr?: string } = Object.assign(
        new Error("Command failed"),
        { stderr: "Error response from daemon: pull access denied" },
      );
      callback(error, "", "Error response from daemon: pull access denied");
    });

    await expect(
      runComposePull({
        composePath: "/tmp/x/docker-compose.yml",
        envPath: "/tmp/x/.env",
        stackName: "demo",
      }),
    ).rejects.toThrow(/pull access denied/);
  });

  it("includes stdout when stderr is only a harmless compose-provider notice", async () => {
    execFileMock.mockImplementationOnce((callback: ExecCallback) => {
      const noise = "Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.";
      const realFailure = "no configuration file provided: not found";
      const error: NodeJS.ErrnoException & { stdout?: string; stderr?: string } =
        Object.assign(new Error("Command failed"), {
          stdout: realFailure,
          stderr: noise,
        });
      callback(error, realFailure, noise);
    });

    await expect(
      runComposePull({
        composePath: "/tmp/x/docker-compose.yml",
        envPath: "/tmp/x/.env",
        stackName: "demo",
      }),
    ).rejects.toThrow(/no configuration file provided/);
  });
});
