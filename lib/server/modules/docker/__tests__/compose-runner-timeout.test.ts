import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  // The runner refuses to spawn when the stack is gone, so these cases — which
  // are about what happens *after* the spawn — need a real file to point at.
  let composePath = "";
  let envPath = "";

  beforeEach(async () => {
    const stackDir = await mkdtemp(path.join(os.tmpdir(), "compose-runner-"));
    composePath = path.join(stackDir, "docker-compose.yml");
    envPath = path.join(stackDir, ".env");
    await writeFile(composePath, "services: {}\n", "utf8");
    await writeFile(envPath, "", "utf8");
  });

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
        composePath,
        envPath,
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
        composePath,
        envPath,
        stackName: "demo",
      }),
    ).rejects.toThrow(/pull access denied/);
  });

  it("names the missing stack instead of blaming the docker binary", async () => {
    // Node reports a missing cwd as `spawn docker ENOENT`, which reads as a
    // broken Docker install. Restoring a database ahead of the files it
    // describes leaves exactly this state, so the message has to say so.
    const missing = path.join(os.tmpdir(), "compose-runner-gone", "docker-compose.yml");

    await expect(
      runComposePull({
        composePath: missing,
        envPath: path.join(path.dirname(missing), ".env"),
        stackName: "demo",
      }),
    ).rejects.toThrow(/files for this app are missing/);

    expect(execFileMock).not.toHaveBeenCalled();
  });
});
