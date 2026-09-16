import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * install.sh and update.sh each carry their own copy of the same helpers, and
 * that is not going to change: both are fetched and piped straight into bash,
 * so neither can `source` a shared file that is not on the machine yet.
 *
 * What can change is whether the copies stay the same. They had not. Seven of
 * the eight shared functions had drifted — different wording, different error
 * handling, and in one case different behaviour: a missing upload-server source
 * aborted an install and was shrugged off by an update. Nobody decided that; it
 * is what two copies do when they are edited a year apart.
 *
 * So the duplication is allowed and the divergence is not. Change a function
 * here and this test tells you about the other copy.
 */

const SCRIPTS = path.join(process.cwd(), "scripts");

const SHARED_FUNCTIONS = [
  "print_status",
  "print_warn",
  "print_error",
  "command_exists",
  "require_root",
  "install_go",
  "build_upload_server",
  "ensure_security_dependencies",
] as const;

/** The body of a top-level `name() { … }`, from the declaration to its closing brace. */
function extractFunction(source: string, name: string): string | null {
  const start = source.indexOf(`${name}() {`);
  if (start === -1) return null;

  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

describe("the maintenance page", () => {
  const MAINTENANCE_PAGE = path.join(
    "packages", "os", "overlay-common", "var", "lib",
    "homeio-maintenance", "__homeio_unavailable.html",
  );

  it("ships as a file both scripts copy, rather than a heredoc in each", async () => {
    const [install, update, page] = await Promise.all([
      readFile(path.join(SCRIPTS, "install.sh"), "utf8"),
      readFile(path.join(SCRIPTS, "update.sh"), "utf8"),
      readFile(path.join(process.cwd(), MAINTENANCE_PAGE), "utf8"),
    ]);

    expect(page).toContain("<!doctype html>");

    // Both scripts point at the same file, and neither carries the page again.
    for (const [name, script] of [["install.sh", install], ["update.sh", update]] as const) {
      expect(script, `${name} should copy the shipped page`).toContain(
        "packages/os/overlay-common/var/lib/homeio-maintenance/__homeio_unavailable.html",
      );
      expect(script, `${name} still embeds an HTML document`).not.toMatch(/<!doctype html>/i);
    }
  });
});

describe("install.sh and update.sh shared helpers", () => {
  it.each(SHARED_FUNCTIONS)("%s is identical in both scripts", async (name) => {
    const [install, update] = await Promise.all([
      readFile(path.join(SCRIPTS, "install.sh"), "utf8"),
      readFile(path.join(SCRIPTS, "update.sh"), "utf8"),
    ]);

    const fromInstall = extractFunction(install, name);
    const fromUpdate = extractFunction(update, name);

    expect(fromInstall, `${name} is missing from install.sh`).not.toBeNull();
    expect(fromUpdate, `${name} is missing from update.sh`).not.toBeNull();

    // Byte for byte. "Nearly the same" is how they got here.
    expect(fromUpdate).toBe(fromInstall);
  });
});
