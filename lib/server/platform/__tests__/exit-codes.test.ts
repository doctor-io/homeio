import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A non-zero exit that means "no" rather than "broken".
 *
 * Found on the real host, not here: every call of `isMountPoint` on a path that
 * was not a mount point wrote an ERROR line to the journal — `mountpoint -q`
 * answers "no" by exiting 32, and the wrapper could only read an exit code by
 * catching a failure. Logging a normal answer as an error is how a journal
 * stops being worth reading, so the code comes back as a result now.
 */

const { execFileMock, logMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], _options: unknown, callback: unknown) => {
    const outcome = execFileMock(file, args) as {
      exitCode: number;
      stdout?: string;
      missing?: boolean;
    };

    if (outcome.missing) {
      const absent = new Error(`spawn ${file} ENOENT`) as NodeJS.ErrnoException;
      absent.code = "ENOENT";
      (callback as (e: unknown, o: string, s: string) => void)(absent, "", "");
      return;
    }

    const stdout = outcome.stdout ?? "";
    const done = callback as (e: unknown, o: string, s: string) => void;

    if (outcome.exitCode === 0) {
      done(null, stdout, "");
      return;
    }

    const error = new Error(`Command failed: ${file} ${args.join(" ")}`) as Error & {
      code: number;
      stdout: string;
      stderr: string;
    };
    error.code = outcome.exitCode;
    error.stdout = stdout;
    error.stderr = "";
    done(error, stdout, "");
  },
}));

vi.mock("@/lib/server/logging/logger", () => ({
  logServerAction: logMock,
  withServerTiming: async <T>(_meta: unknown, fn: () => Promise<T>) => fn(),
}));

import { isMountPoint } from "@/lib/server/platform/sharing";
import { isActive, isEnabled } from "@/lib/server/platform/systemd";

function errorLines() {
  return logMock.mock.calls.filter(([entry]) => (entry as { level?: string }).level === "error");
}

describe("isMountPoint", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    logMock.mockReset();
  });

  it("says yes when the path is a mount point", async () => {
    execFileMock.mockReturnValue({ exitCode: 0 });

    expect(await isMountPoint("/DATA")).toBe(true);
    expect(errorLines()).toHaveLength(0);
  });

  it.each([32, 1])("says no on exit %i without calling it an error", async (exitCode) => {
    execFileMock.mockReturnValue({ exitCode });

    expect(await isMountPoint("/DATA")).toBe(false);
    // The whole point: a "no" that used to arrive as a logged failure.
    expect(errorLines()).toHaveLength(0);
  });

  it("still says no when the command genuinely fails", async () => {
    // An exit code nobody listed. The answer to the caller is the same — this
    // path is not a mount point as far as we can tell — but the journal should
    // record it, because now something really is wrong.
    execFileMock.mockReturnValue({ exitCode: 127 });

    expect(await isMountPoint("/DATA")).toBe(false);
    expect(errorLines().length).toBeGreaterThan(0);
  });
});

describe("systemctl queries", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    logMock.mockReset();
  });

  // systemd answers these on stdout and exits non-zero for anything that is not
  // a plain yes. Polled on a timer, a service that is simply not installed was
  // writing an ERROR line per poll — 4 in ten minutes on the real server, for
  // two units that were never meant to exist there.
  it.each([
    ["is-active", isActive, 3, "inactive"],
    ["is-enabled", isEnabled, 1, "disabled"],
    ["is-enabled on a unit that does not exist", isEnabled, 4, ""],
  ])("reads %s from stdout without logging an error", async (_label, query, exitCode, answer) => {
    execFileMock.mockReturnValue({ exitCode, stdout: answer });

    expect(await query("whatever.service")).toBe(answer || "unknown");
    expect(errorLines()).toHaveLength(0);
  });

  it("still answers when the command itself fails", async () => {
    execFileMock.mockReturnValue({ exitCode: 127, stdout: "" });

    expect(await isActive("whatever.service")).toBe("unknown");
  });
});

describe("a binary that is not installed", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    logMock.mockReset();
  });

  // Found in the Docker image, not on the server that has lsblk: the disk list
  // polls every five seconds and degrades to "no disks" when it is absent, so
  // the image wrote an ERROR line every five seconds, forever, about a fact
  // that could not change without a restart.
  it("is said once, and as a warning rather than an error", async () => {
    vi.resetModules();
    const { run, isCommandMissing } = await import("@/lib/server/platform/process");
    execFileMock.mockReturnValue({ exitCode: 0, missing: true });

    for (let poll = 0; poll < 5; poll += 1) {
      await expect(run("lsblk", ["--json"])).rejects.toSatisfy(isCommandMissing);
    }

    expect(errorLines()).toHaveLength(0);
    const warnings = logMock.mock.calls.filter(
      ([entry]) => (entry as { level?: string }).level === "warn",
    );
    expect(warnings).toHaveLength(1);
    expect((warnings[0][0] as { meta?: { binary?: string } }).meta?.binary).toBe("lsblk");
  });

  it("still says it for a different binary", async () => {
    vi.resetModules();
    const { run } = await import("@/lib/server/platform/process");
    execFileMock.mockReturnValue({ exitCode: 0, missing: true });

    await expect(run("lsblk", [])).rejects.toThrow();
    await expect(run("wipefs", [])).rejects.toThrow();

    const warnings = logMock.mock.calls.filter(
      ([entry]) => (entry as { level?: string }).level === "warn",
    );
    expect(warnings).toHaveLength(2);
  });
});
