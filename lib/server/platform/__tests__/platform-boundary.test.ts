import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ALLOWED_BINARIES } from "@/lib/server/platform/process";

/**
 * The architecture rule, as a test rather than a document.
 *
 * Homeio is modular by feature. The rule that makes that worth something is
 * that a feature does not reach past its own module — and the reach that
 * mattered was to the operating system: nineteen files started processes on
 * their own, twenty different binaries between them, with no list anywhere of
 * what the app could run.
 *
 * A convention nobody enforces is a convention that erodes at the next
 * deadline. `token-scope-architecture.test.ts` already guards the auth
 * boundary the same way, and it works. This is the same idea for the OS.
 */

const SERVER_ROOT = path.join(process.cwd(), "lib", "server");
const PLATFORM_ROOT = path.join(SERVER_ROOT, "platform");

async function serverSourceFiles(): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        await walk(full);
        continue;
      }

      if (entry.name.endsWith(".ts")) found.push(full);
    }
  }

  await walk(SERVER_ROOT);
  return found;
}

describe("platform boundary", () => {
  it("is the only part of the server that starts a process", async () => {
    const offenders: string[] = [];

    for (const file of await serverSourceFiles()) {
      if (file.startsWith(PLATFORM_ROOT)) continue;

      const source = await readFile(file, "utf8");
      if (/from "node:child_process"|require\(["']node:child_process["']\)/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    // If this fails, the fix is to add the capability to lib/server/platform
    // and call it from here — not to add an exception.
    expect(offenders).toEqual([]);
  });

  it("names every binary it is allowed to run, with a reason", () => {
    for (const [binary, reason] of Object.entries(ALLOWED_BINARIES)) {
      // Dots are legitimate: the mkfs family is mkfs.ext4, mkfs.btrfs…
      expect(binary).toMatch(/^[a-z][a-z0-9_.-]*$/);
      // The reason is the point: a list of names tells a reviewer nothing about
      // whether the entry should still be there.
      expect(reason.length).toBeGreaterThan(8);
    }
  });

  it("refuses a binary that is not on the list", async () => {
    const { run } = await import("@/lib/server/platform/process");

    await expect(
      // The cast is the realistic route in: types do not survive a boundary
      // with a string that came from configuration.
      run("curl" as never, ["https://example.com"]),
    ).rejects.toThrow(/not in the platform allowlist/);
  });
});
