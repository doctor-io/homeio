import "server-only";

import { run } from "@/lib/server/platform/process";

/**
 * The two tools a backup is made of.
 *
 * Both take a secret or a filesystem tree as an argument, and both have already
 * cost this project a bad night. `pg_dump` is handed a connection string
 * complete with password; `tar` is handed the paths that decide what a restore
 * will later delete. Neither belongs in a feature module spelling out argv by
 * hand.
 */

/**
 * Dumps a database to a file.
 *
 * The connection string carries the password, so it is never logged — not the
 * host, not the database name, nothing. There is no argument here worth a log
 * line, and one of them would leak the credential.
 */
export async function dumpDatabase(connectionString: string, outputPath: string) {
  await run("pg_dump", ["--file", outputPath, connectionString], {
    // A dump of a large install is minutes, not seconds.
    timeoutMs: 30 * 60_000,
    env: process.env,
    loggableArgs: ["--file", outputPath],
  });
}

/**
 * Creates a gzipped archive.
 *
 * The argument list is built by the caller because tar's `-C` and `--transform`
 * are positional — their effect depends on what follows them — so an
 * abstraction that reordered them would quietly change what ends up in the
 * archive. What this adds is the timeout, the environment, and a log line that
 * records the destination without the whole tree.
 */
export async function createArchive(args: readonly string[], { archivePath }: { archivePath: string }) {
  await run("tar", args, {
    timeoutMs: 60 * 60_000,
    env: process.env,
    loggableArgs: ["-czf", archivePath],
  });
}
