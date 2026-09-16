import "server-only";

import { run } from "@/lib/server/platform/process";

/**
 * Git, for keeping app store catalogues on disk.
 *
 * Every clone here is shallow and every update is a hard reset. Homeio does not
 * author commits in these checkouts — it mirrors someone else's repository —
 * so a local change is not work to be preserved, it is drift to be discarded.
 * A `pull` would try to merge it and stop on a conflict, leaving the catalogue
 * stuck in a state nobody asked for and nobody can see.
 */

/**
 * Whether a directory is a usable git checkout.
 *
 * Not just "does .git exist": an interrupted clone leaves a directory that
 * looks right and that every subsequent command refuses to work in. That state
 * used to be read as "already cloned", so the catalogue never recovered on its
 * own — `rev-parse` is what actually answers the question.
 */
export async function isRepository(directory: string): Promise<boolean> {
  return run("git", ["-C", directory, "rev-parse", "--git-dir"], {
    timeoutMs: 15_000,
    loggableArgs: ["-C", directory, "rev-parse", "--git-dir"],
  })
    .then(() => true)
    .catch(() => false);
}

export async function shallowClone(repositoryUrl: string, destination: string) {
  const args = ["clone", "--depth=1", repositoryUrl, destination];
  await run("git", args, { timeoutMs: 300_000, loggableArgs: args });
}

/**
 * Brings a checkout to the remote's current HEAD, discarding anything local.
 *
 * Fetch then hard reset, rather than pull: see the note at the top of the file.
 */
export async function resetToRemoteHead(directory: string) {
  const fetchArgs = ["-C", directory, "fetch", "--depth=1", "origin"];
  await run("git", fetchArgs, { timeoutMs: 300_000, loggableArgs: fetchArgs });

  const resetArgs = ["-C", directory, "reset", "--hard", "origin/HEAD"];
  await run("git", resetArgs, { timeoutMs: 60_000, loggableArgs: resetArgs });
}
