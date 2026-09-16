import "server-only";

import path from "node:path";
import { run } from "@/lib/server/platform/process";

/**
 * Zip archives, with the path check welded to the extraction.
 *
 * The validation below is not new — it was written when app store archives
 * were hardened — but it lived beside the extraction rather than inside it, as
 * a sequence a caller had to remember: list the entries, check each one, then
 * extract. A second caller that skips the middle step gets no warning, and the
 * archives being extracted are downloaded from URLs a user typed in.
 *
 * So there is no way to extract from here without the check running. That is
 * the whole point of the file.
 */

/** Entry names, exactly as the archive declares them. */
export async function listEntries(zipPath: string): Promise<string[]> {
  const { stdout } = await run("unzip", ["-Z1", zipPath], {
    timeoutMs: 60_000,
    loggableArgs: ["-Z1"],
  });

  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Verbose listing, for showing an archive's contents without opening it. */
export async function describe(zipPath: string): Promise<string> {
  const { stdout } = await run("unzip", ["-Z", zipPath], {
    timeoutMs: 60_000,
    loggableArgs: ["-Z"],
  });
  return stdout;
}

export class UnsafeArchiveEntryError extends Error {
  readonly entry: string;

  constructor(entry: string) {
    super(`Unsafe archive path: ${entry}`);
    this.name = "UnsafeArchiveEntryError";
    this.entry = entry;
  }
}

/**
 * Refuses any entry that would land outside `destination` once extracted.
 *
 * Backslashes are normalised first: an archive written on Windows can carry
 * `..\\..\\etc\\passwd`, which a check that only looks for `../` waves through.
 */
export function assertEntriesStayInside(entries: readonly string[], destination: string) {
  const root = path.resolve(destination);
  const rootWithSeparator = `${root}${path.sep}`;

  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");

    if (normalized.startsWith("/")) throw new UnsafeArchiveEntryError(entry);

    const resolved = path.resolve(root, normalized);
    if (resolved !== root && !resolved.startsWith(rootWithSeparator)) {
      throw new UnsafeArchiveEntryError(entry);
    }
  }
}

export type ExtractOptions = {
  /** Pass `[1]` to accept "extracted, with warnings". */
  allowedExitCodes?: readonly number[];
  /** Omit `-q` so the caller can read what was written. */
  verbose?: boolean;
};

/**
 * Extracts an archive into `destination`, and only into `destination`.
 *
 * Every entry is checked before anything is written, so a hostile archive
 * fails with nothing extracted rather than partway through.
 */
export async function extract(
  zipPath: string,
  destination: string,
  { allowedExitCodes, verbose = false }: ExtractOptions = {},
) {
  assertEntriesStayInside(await listEntries(zipPath), destination);

  const args = verbose
    ? ["-o", zipPath, "-d", destination]
    : ["-oq", zipPath, "-d", destination];

  await run("unzip", args, {
    timeoutMs: 300_000,
    allowedExitCodes,
    loggableArgs: [args[0]!, "-d", destination],
  });
}
