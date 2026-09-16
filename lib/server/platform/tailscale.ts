import "server-only";

import { run, type RunResult } from "@/lib/server/platform/process";

/**
 * Tailscale, which is a host package rather than a container.
 *
 * That distinction is the reason this file is short and the reason it matters.
 * Nothing Homeio does to Docker or to /DATA touches Tailscale, so a factory
 * reset that wipes both still leaves the machine enrolled on its owner's
 * tailnet, holding the node key it had before — a real defect, found only by
 * asking what a reset does *not* reach.
 */

/** Raw `tailscale status --json`, for the caller to parse. */
export async function status(): Promise<string> {
  const { stdout } = await run("tailscale", ["status", "--json"], {
    timeoutMs: 10_000,
    loggableArgs: ["status", "--json"],
  });
  return stdout;
}

/**
 * Runs Tailscale's own install script.
 *
 * This is `curl | sh` and there is no pretending otherwise. It is a fixed
 * string in this file rather than anything assembled at runtime, and it is the
 * vendor's documented installation route; what would make it dangerous is a
 * URL that came from somewhere else, which is why the URL lives here and
 * takes no parameter.
 */
export function install(): Promise<RunResult> {
  return run("sh", ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"], {
    timeoutMs: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    loggableArgs: ["-c", "curl -fsSL https://tailscale.com/install.sh | sh"],
  });
}

/**
 * Brings the node up with an auth key read from a file.
 *
 * The key is passed as `--auth-key=file:…` rather than inline, so it never
 * appears in this process's argv — where any other user on the machine could
 * read it out of `/proc`. The caller writes the file with mode 0600 and
 * deletes it afterwards.
 */
export function up(authKeyFile: string): Promise<RunResult> {
  const args = ["up", `--auth-key=file:${authKeyFile}`, "--accept-dns=true"];
  return run("tailscale", args, {
    timeoutMs: 120_000,
    // The filename is safe to log; it holds the key but does not spell it out.
    loggableArgs: args,
  });
}

/**
 * Leaves the tailnet, discarding the node key.
 *
 * Used by the factory reset, which otherwise hands on a machine still
 * enrolled under its previous owner.
 */
export async function logout() {
  await run("tailscale", ["logout"], { timeoutMs: 30_000, loggableArgs: ["logout"] });
}
