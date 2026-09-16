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

/**
 * Two files start processes and are not going to stop.
 *
 * This is an exception, written down, with the reason attached — not a rule
 * quietly worked around. Both run a command chosen by the operator at the
 * moment they run it, which is the opposite of what an allowlist is for:
 * putting them behind `platform/` would mean either an allowlist that permits
 * everything, or two lists of permitted commands that can disagree. We know
 * what a second source of truth costs.
 *
 * What guards them instead is written beside each one:
 *
 * - `terminal/service.ts` carries its own command allowlist, because the whole
 *   feature is "run this command". That list is the boundary; `platform/` has
 *   nothing to add to it.
 * - `scheduled-tasks/service.ts` runs `bash -c` on a script the operator saved.
 *   Routing that through `platform/` would give a false impression of safety:
 *   the bash entry in the allowlist already admits that anything handed to a
 *   shell runs outside every guarantee this file makes.
 *
 * Both are streams rather than commands that return, which is also why `run`
 * does not fit. If a third file needs to join them, that is the moment to ask
 * whether the exception is still an exception.
 */
const DELIBERATE_EXCEPTIONS = [
  path.join("modules", "terminal", "service.ts"),
  path.join("modules", "terminal", "websocket-server.ts"),
  path.join("modules", "scheduled-tasks", "service.ts"),
];

describe("platform boundary", () => {
  it("is the only part of the server that starts a process", async () => {
    const offenders: string[] = [];

    for (const file of await serverSourceFiles()) {
      if (file.startsWith(PLATFORM_ROOT)) continue;
      if (DELIBERATE_EXCEPTIONS.some((allowed) => file.endsWith(allowed))) continue;

      const source = await readFile(file, "utf8");
      if (/from "node:child_process"|require\(["']node:child_process["']\)/.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }

    // If this fails, the fix is to add the capability to lib/server/platform
    // and call it from there — not to add an entry above. The exceptions are
    // closed: they exist because those two features *are* "run what the
    // operator typed", and that is not a shape an allowlist can help with.
    expect(offenders).toEqual([]);
  });

  it("keeps the exception list from growing quietly", async () => {
    // An exception is only honest while someone has to argue for it. Changing
    // this number is the argument.
    expect(DELIBERATE_EXCEPTIONS).toHaveLength(3);

    for (const exception of DELIBERATE_EXCEPTIONS) {
      const source = await readFile(path.join(SERVER_ROOT, exception), "utf8");
      // Each one has to say, in its own file, what guards it instead.
      expect(source).toMatch(/allowlist|allow-list|operator|command list/i);
    }
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
