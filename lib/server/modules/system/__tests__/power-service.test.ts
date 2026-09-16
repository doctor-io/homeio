import type * as NodeFsPromises from "node:fs/promises";
import type * as DataRootModule from "@/lib/server/storage/data-root";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, statMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
}));

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/homeio",
  },
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFsPromises>();
  return { ...original, stat: statMock };
});

vi.mock("@/lib/server/env", () => ({
  serverEnv: serverEnvMock,
}));

vi.mock("@/lib/server/storage/data-root", async (importOriginal) => {
  const actual =
    await importOriginal<typeof DataRootModule>();
  return {
    ...actual,
    resolveDataRootDirectory: () => "/DATA",
    resolveStoreStacksRoot: () => "/DATA/Apps",
  };
});

import {
  scheduleFactoryReset,
  scheduleSystemReboot,
  scheduleSystemShutdown,
} from "@/lib/server/modules/system/power-service";

function resolveExecFileCallback(args: unknown[]) {
  const maybeCallback = args.at(-1);
  if (typeof maybeCallback !== "function") {
    throw new Error("Expected execFile callback");
  }

  return maybeCallback as (
    error: Error | null,
    stdout?: string,
    stderr?: string,
  ) => void;
}

describe("power-service", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    statMock.mockReset();
    // Script exists by default
    statMock.mockResolvedValue({});
    execFileMock.mockImplementation(
      (_command: string, _args: string[], ...rest: unknown[]) => {
        const callback = resolveExecFileCallback(rest);
        callback(null, "", "");
      },
    );
  });

  it("schedules reboot through a transient systemd unit", async () => {
    await scheduleSystemReboot();

    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining([
        "--quiet",
        "--no-block",
        "--collect",
        "--property=Type=exec",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=30s",
        "--property=SendSIGKILL=yes",
        "bash",
        "-lc",
        "sleep 2; systemctl reboot",
      ]),
      // The platform wrapper always passes options — a timeout above all, so
      // a command with no ceiling cannot hang a request.
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("schedules shutdown through a transient systemd unit", async () => {
    await scheduleSystemShutdown();

    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining(["bash", "-lc", "sleep 2; systemctl poweroff"]),
      // The platform wrapper always passes options — a timeout above all, so
      // a command with no ceiling cannot hang a request.
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("schedules factory reset via script file with env vars injected through --setenv", async () => {
    await scheduleFactoryReset();

    // execFileMock called twice: "which npm" then "systemd-run"
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenCalledWith(
      "which",
      ["npm"],
      // The platform wrapper always passes options — a timeout above all, so
      // a command with no ceiling cannot hang a request.
      expect.any(Object),
      expect.any(Function),
    );

    const systemdCall = execFileMock.mock.calls[1];
    expect(systemdCall?.[0]).toBe("systemd-run");

    const args: string[] = systemdCall?.[1] ?? [];

    // Systemd unit flags
    expect(args).toContain("--quiet");
    expect(args).toContain("--no-block");
    expect(args).toContain("--collect");
    expect(args).toContain("--property=Type=exec");

    // Environment variables injected via --setenv (no shell interpolation)
    const setenvPairs = args
      .map((arg, i) => (args[i - 1] === "--setenv" ? arg : null))
      .filter(Boolean) as string[];

    const envMap = Object.fromEntries(
      setenvPairs.map((pair) => {
        const eq = pair.indexOf("=");
        return [pair.slice(0, eq), pair.slice(eq + 1)];
      }),
    );

    expect(envMap.DATABASE_URL).toBe(serverEnvMock.DATABASE_URL);
    expect(envMap.HOMEIO_RESET_DATA_ROOT).toBe("/DATA");
    expect(envMap.HOMEIO_RESET_STACKS_ROOT).toBe("/DATA/Apps");
    // The store registry sits outside the data root on a real install, so a
    // reset that only wiped /DATA left every catalog the user had added.
    expect(envMap.HOMEIO_RESET_STORE_CONFIG_ROOT).toBe("/DATA/AppStore");
    expect(envMap.HOMEIO_RESET_WORKDIR).toBeTruthy();
    expect(envMap.HOMEIO_RESET_NPM_BIN).toBeTruthy();

    // Script path is the last argument — no inline bash command string
    const scriptArg = args.at(-1) ?? "";
    expect(scriptArg).toMatch(/factory-reset\.sh$/);
    expect(args).not.toContain("-lc");
  });

  it("rejects factory reset when the script does not exist", async () => {
    statMock.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(scheduleFactoryReset()).rejects.toThrow(
      "Factory reset script not found",
    );
    expect(execFileMock).not.toHaveBeenCalledWith(
      "systemd-run",
      expect.anything(),
      expect.anything(),
    );
  });
});
