import "server-only";

import { run, type RunResult } from "@/lib/server/platform/process";

/**
 * Network shares: mounting someone else's, and exporting your own.
 *
 * Kept apart from `storage.ts` because the risk is different. A block device
 * path is a short, closed shape that can be validated outright. What arrives
 * here is a hostname, a share name and a UNC path — user-supplied strings with
 * no useful grammar to check them against, that end up as arguments to `mount`
 * and to Samba.
 *
 * They are safe because `execFile` takes no shell, so an argument is an
 * argument however it is spelled. That is the actual protection, and it is
 * worth knowing it is the only one: adding a `bash -c` here would remove it
 * with nothing to notice.
 */

const SHORT_TIMEOUT_MS = 15_000;

/**
 * Whether a path is a mount point.
 *
 * `mountpoint -q` answers "no" by exiting non-zero — 32 on util-linux, 1 on
 * older builds — so "no" and "broken" arrive the same way. Listing those codes
 * makes the difference: a plain "no" comes back as a result, and only a real
 * failure (the binary missing, a timeout) still throws. Before this, every
 * check of a path that was not a mount point wrote an ERROR to the journal.
 */
const NOT_A_MOUNT_POINT = [1, 32];

export async function isMountPoint(absolutePath: string): Promise<boolean> {
  return run("mountpoint", ["-q", absolutePath], {
    timeoutMs: SHORT_TIMEOUT_MS,
    loggableArgs: ["-q", absolutePath],
    allowedExitCodes: NOT_A_MOUNT_POINT,
  })
    .then((result) => result.exitCode === 0)
    .catch(() => false);
}

/**
 * `mount` with arbitrary arguments, because a network mount's argument list is
 * genuinely open — `-t cifs -o username=…,vers=3.0` and so on, decided by what
 * the remote speaks.
 *
 * Credentials travel in `-o`, so nothing here is logged by default; the caller
 * names what is safe.
 */
export function mount(args: readonly string[], loggableArgs: readonly string[] = []): Promise<RunResult> {
  return run("mount", args, { timeoutMs: 60_000, loggableArgs });
}

/** A bind mount, whose arguments are two local paths and nothing secret. */
export async function bindMount(source: string, destination: string) {
  const args = ["--bind", source, destination];
  await run("mount", args, { timeoutMs: SHORT_TIMEOUT_MS, loggableArgs: args });
}

export type UnmountOptions = {
  /**
   * Detach now and clean up when the last user lets go. A bind mount that
   * something is still reading from refuses a plain unmount, and the caller
   * has nothing useful to do with that refusal.
   */
  lazy?: boolean;
};

export async function unmount(absolutePath: string, { lazy = false }: UnmountOptions = {}) {
  const args = lazy ? ["-l", absolutePath] : [absolutePath];
  await run("umount", args, { timeoutMs: SHORT_TIMEOUT_MS, loggableArgs: args });
}

/** `net usershare …`, Samba's per-user share management. */
export function netUsershare(args: readonly string[]): Promise<RunResult> {
  return run("net", ["usershare", ...args], {
    timeoutMs: SHORT_TIMEOUT_MS,
    loggableArgs: ["usershare", ...args],
  });
}

/** Browses the local network for advertised services. */
export function avahiBrowse(args: readonly string[]): Promise<RunResult> {
  return run("avahi-browse", args, { timeoutMs: 30_000, loggableArgs: args });
}

/**
 * `smbclient`, for listing what a server offers.
 *
 * A password can appear in these arguments, so the caller decides what is
 * loggable and the default is nothing.
 */
export function smbclient(
  args: readonly string[],
  loggableArgs: readonly string[] = [],
): Promise<RunResult> {
  return run("smbclient", args, { timeoutMs: 30_000, loggableArgs });
}
