import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/homeio",
    STORE_APP_DATA_ROOT: "",
    FILES_ROOT: "",
    NODE_ENV: "test",
  },
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const tempRoots = {
  dataRoot: "",
  stacksRoot: "",
};

vi.mock("@/lib/server/storage/data-root", () => ({
  resolveDataRootDirectory: () => tempRoots.dataRoot,
  resolveStoreStacksRoot: () => tempRoots.stacksRoot,
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: serverEnvMock,
}));

import {
    buildRestoreShellCommand,
    getSystemBackupsSnapshot,
    resolveManagedBackupRoot,
    runSystemBackupNow,
    scheduleSystemBackupRestore,
} from "@/lib/server/modules/system/backup-service";

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

function mockExecFileForBackup() {
  execFileMock.mockImplementation(
    (command: string, args: string[], ...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);

      if (command === "systemctl") {
        callback(new Error("disabled"));
        return;
      }

      if (command === "pg_dump") {
        const dumpIndex = args.indexOf("--file");
        void writeFile(args[dumpIndex + 1]!, "db-dump").then(() => {
          callback(null, "", "");
        });
        return;
      }

      if (command === "tar") {
        void writeFile(args[1]!, "archive").then(() => {
          callback(null, "", "");
        });
        return;
      }

      callback(null, "", "");
    },
  );
}

describe("backup-service", () => {
  beforeEach(async () => {
    execFileMock.mockReset();
    spawnMock.mockReset();

    const root = await mkdtemp(path.join(os.tmpdir(), "homeio-backup-"));
    tempRoots.dataRoot = path.join(root, "DATA");
    tempRoots.stacksRoot = path.join(tempRoots.dataRoot, "Apps");
    await mkdir(tempRoots.stacksRoot, { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.1.72" }),
    );
    process.chdir(root);
    serverEnvMock.STORE_APP_DATA_ROOT = path.join(
      tempRoots.dataRoot,
      "AppData",
    );
    serverEnvMock.FILES_ROOT = tempRoots.dataRoot;
    serverEnvMock.NODE_ENV = "test";
  });

  it("pins the managed backup root to /DATA in production", () => {
    serverEnvMock.NODE_ENV = "production";

    expect(resolveManagedBackupRoot()).toBe("/DATA/Backups/homeio");
  });

  it("creates an archive manifest and prunes old backups beyond retention", async () => {
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    for (let index = 0; index < 8; index += 1) {
      const id = `backup-old-${index}`;
      await writeFile(path.join(backupRoot, `${id}.tar.gz`), "old");
      await writeFile(
        path.join(backupRoot, `${id}.manifest.json`),
        JSON.stringify({
          id,
          createdAt: `2026-03-0${index + 1}T09:00:00.000Z`,
          sizeBytes: 3,
          appVersion: "0.1.71",
          hostname: "old-host",
          backupPath: path.join(backupRoot, `${id}.tar.gz`),
          dbDumpIncluded: true,
          dataRootIncluded: true,
          stacksRootIncluded: true,
          storeConfigIncluded: true,
          status: "completed",
        }),
      );
    }

    const backup = await runSystemBackupNow();

    expect(backup.id).toContain("backup-");
    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.backupPath).toBe(
      path.join(backupRoot, `${backup.id}.tar.gz`),
    );
    // stacks root is inside data root — should NOT be marked as separately archived
    expect(manifest.stacksRootIncluded).toBe(false);
    await expect(
      stat(path.join(backupRoot, "backup-old-0.tar.gz")),
    ).rejects.toBeTruthy();
  });

  it("marks stacksRootIncluded true only when stacks root is external and exists", async () => {
    const externalStacksRoot = path.join(tempRoots.dataRoot, "..", "ext-stacks");
    tempRoots.stacksRoot = externalStacksRoot;
    await mkdir(externalStacksRoot, { recursive: true });
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    const backup = await runSystemBackupNow();

    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    expect(JSON.parse(manifestRaw).stacksRootIncluded).toBe(true);
  });

  it("lists settings and backups from the managed backup root", async () => {
    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });
    await writeFile(
      path.join(backupRoot, "backup-1.manifest.json"),
      JSON.stringify({
        id: "backup-1",
        createdAt: "2026-03-08T09:00:00.000Z",
        sizeBytes: 10,
        appVersion: "0.1.72",
        hostname: "home-node",
        backupPath: path.join(backupRoot, "backup-1.tar.gz"),
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: true,
        storeConfigIncluded: true,
        status: "completed",
      }),
    );
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);
      callback(new Error("disabled"));
    });

    const snapshot = await getSystemBackupsSnapshot();

    expect(snapshot.backups).toHaveLength(1);
    expect(snapshot.backupRoot).toBe(backupRoot);
  });

  it("builds a restore command and schedules it for valid backups", async () => {
    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });
    await writeFile(path.join(backupRoot, "backup-1.tar.gz"), "archive");
    await writeFile(
      path.join(backupRoot, "backup-1.manifest.json"),
      JSON.stringify({
        id: "backup-1",
        createdAt: "2026-03-08T09:00:00.000Z",
        sizeBytes: 10,
        appVersion: "0.1.72",
        hostname: "home-node",
        backupPath: path.join(backupRoot, "backup-1.tar.gz"),
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: true,
        storeConfigIncluded: true,
        status: "completed",
      }),
    );
    // All execFile calls fail EXCEPT systemd-run (which schedules the restore).
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const cmd = rest[0] as string;
      const callback = resolveExecFileCallback(rest);
      if (cmd === "systemd-run") {
        callback(null);
      } else {
        callback(new Error("disabled"));
      }
    });

    const accepted = await scheduleSystemBackupRestore("backup-1");

    expect(accepted.backupId).toBe("backup-1");
    const command = buildRestoreShellCommand({
      id: "backup-1",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: path.join(backupRoot, "backup-1.tar.gz"),
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });
    expect(command).toContain("docker compose -f");
    expect(command).toContain("set -Eeuo pipefail");
    expect(command).toContain("systemctl stop home-server.service || true");
    expect(command).toContain("DROP SCHEMA IF EXISTS public CASCADE");
    expect(command).toContain("psql");
    expect(command).toContain("systemctl reboot");
  });

  it("restores without being able to destroy what it cannot replace", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-guard",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-guard.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    const restoreRoot = "/var/tmp/homeio-restore-backup-guard";

    // The dump has to be there before anything is deleted; an archive without
    // one used to take the database with it.
    expect(command).toContain(`test -s '${restoreRoot}/db/database.sql'`);
    expect(command.indexOf("test -s")).toBeLessThan(command.indexOf("rm -rf {} +"));

    // drizzle holds the migration journal outside `public`; leaving it behind
    // made the dump's own CREATE SCHEMA fail 25 lines in.
    expect(command).toContain("DROP SCHEMA IF EXISTS drizzle CASCADE");

    // Reset and reload as one transaction, so a failure rolls back rather than
    // leaving an empty database.
    expect(command).toContain("--single-transaction");

    // Backups live under the data root but are excluded from the archive, so
    // wiping it wholesale destroyed every backup, including this one.
    expect(command).toContain("! -name 'Backups'");

    // And the reset has to come before the dump in the same file, or the
    // transaction would load into a schema it is about to drop.
    const combined = command.indexOf("printf '%s");
    expect(combined).toBeGreaterThan(-1);
    expect(combined).toBeLessThan(command.indexOf("--single-transaction"));
  });

  it("uses FILES_ROOT as the managed data snapshot root when it differs from stacks", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "homeio-backup-files-root-"),
    );
    tempRoots.dataRoot = path.join(root, "fallback-DATA");
    tempRoots.stacksRoot = "/var/lib/home-server/stacks";
    serverEnvMock.STORE_APP_DATA_ROOT = "/DATA/AppData";
    serverEnvMock.FILES_ROOT = "/wrong-files-root";
    const restoreRoot = path.join("/var/tmp", "homeio-restore-backup-2");

    const command = buildRestoreShellCommand({
      id: "backup-2",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-2.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    // Backups sit outside this data root here, so there is nothing to spare
    // and the wipe stays unguarded.
    expect(command).toContain(
      "find '/DATA' -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    );
    expect(command).toContain(`cp -a '${restoreRoot}/data-root/.' '/DATA/'`);
    expect(command).toContain(
      `cp -a '${restoreRoot}/stacks-root' '/var/lib/home-server/stacks'`,
    );
  });

  it("derives the restore root from STORE_APP_DATA_ROOT even for legacy /DATA/AppData installs", () => {
    tempRoots.stacksRoot = "/var/lib/home-server/stacks";
    serverEnvMock.STORE_APP_DATA_ROOT = "/DATA/AppData";
    serverEnvMock.FILES_ROOT = "/DATA/data-root";
    const restoreRoot = path.join("/var/tmp", "homeio-restore-backup-legacy");

    const command = buildRestoreShellCommand({
      id: "backup-legacy",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-legacy.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    expect(command).toContain(
      "find '/DATA' -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    );
    expect(command).toContain(`cp -a '${restoreRoot}/data-root/.' '/DATA/'`);
  });

  it("archives the store registry when it sits outside the data root", async () => {
    // Mirrors a real install: files under /DATA, store sources under
    // /var/lib/home-server/AppStore. Restoring used to bring the files and the
    // database back while dropping every catalog source the user had added.
    const filesRoot = path.join(tempRoots.dataRoot, "..", "DATA2");
    serverEnvMock.STORE_APP_DATA_ROOT = path.join(filesRoot, "AppData");
    await mkdir(path.join(tempRoots.dataRoot, "AppStore"), { recursive: true });
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    const backup = await runSystemBackupNow();

    const tarArgs = execFileMock.mock.calls.find(
      ([command]) => command === "tar",
    )?.[1] as string[];
    expect(tarArgs).toContain("store-config");

    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    expect(JSON.parse(manifestRaw).storeConfigIncluded).toBe(true);

    const command = buildRestoreShellCommand(backup);
    const restoreRoot = `/var/tmp/homeio-restore-${backup.id}`;
    expect(command).toContain(
      `cp -a '${restoreRoot}/store-config' '${path.join(tempRoots.dataRoot, "AppStore")}'`,
    );
  });

  it("leaves the store registry alone for archives that predate it", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-legacy",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-legacy.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: false,
      status: "completed",
    });

    // The copy is guarded on the archive actually carrying the member, so an
    // older backup must not wipe the sources that are on disk today.
    expect(command).toContain(
      "if [ -d '/var/tmp/homeio-restore-backup-legacy/store-config' ]; then",
    );
  });

  it("brings the stacks back up before rebooting", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-stacks",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-stacks.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    // `docker compose down` removes the containers, so without this a
    // successful restore left no container for a restart policy to revive.
    const restartIndex = command.lastIndexOf("restart_existing_stacks");
    const rebootIndex = command.indexOf("systemctl reboot");
    expect(restartIndex).toBeGreaterThan(command.indexOf("docker compose down"));
    expect(restartIndex).toBeLessThan(rebootIndex);
  });

  it("skips copying an external stacks root when it does not exist", async () => {
    tempRoots.stacksRoot = path.join(
      tempRoots.dataRoot,
      "..",
      "missing-stacks",
    );

    mockExecFileForBackup();

    await runSystemBackupNow();

    const tarInvocation = execFileMock.mock.calls.find(
      ([command]) => command === "tar",
    );
    expect(tarInvocation).toBeDefined();

    const tarArgs = tarInvocation?.[1] as string[];
    expect(tarArgs).not.toContain("stacks-root");
  });
});
