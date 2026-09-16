import "server-only";

import { run } from "@/lib/server/platform/process";

/**
 * Block devices and mounts, as the rest of the server is allowed to see them.
 *
 * This is the destructive family. `wipefs` and `parted` do not ask twice, and a
 * device path that arrives from a request body reaches them as an argument.
 * Before this file, six binaries were spelled out across two modules with no
 * shared validation, so every call site had to remember the same things and
 * some did not.
 *
 * Every entry point here validates the device path itself. That is deliberate
 * duplication of whatever the caller checks: the caller's check protects the
 * caller's flow, and this one protects the disk.
 */

/**
 * `/dev/sda`, `/dev/nvme0n1p2`, `/dev/mmcblk0p1` — and nothing else.
 *
 * The shape matters more than it looks. `execFile` does not involve a shell, so
 * there is no injection through metacharacters, but there is nothing stopping
 * a path like `/dev/../etc` or a device belonging to something else from being
 * passed to `wipefs --all --force`.
 */
const DEVICE_PATH = /^\/dev\/[a-z0-9]+(p?[0-9]+)?$/;

export class InvalidDeviceError extends Error {
  constructor(device: string) {
    super(`Refusing to act on "${device}": not a plain block device path`);
    this.name = "InvalidDeviceError";
  }
}

function assertDevice(device: string) {
  if (!DEVICE_PATH.test(device)) throw new InvalidDeviceError(device);
  return device;
}

/** Raw `lsblk --json` output, for the caller to parse. */
export async function listBlockDevices(columns: readonly string[]): Promise<string> {
  const args = ["--json", "--bytes", "--output", columns.join(",")];
  const { stdout } = await run("lsblk", args, { timeoutMs: 15_000, loggableArgs: args });
  return stdout;
}

export type MountOptions = {
  /** Filesystem type, when it should not be detected. */
  fsType?: string;
};

export async function mount(device: string, mountPoint: string, { fsType }: MountOptions = {}) {
  assertDevice(device);
  const args = fsType ? ["-t", fsType, device, mountPoint] : [device, mountPoint];
  await run("mount", args, { loggableArgs: args });
}

/** Unmounts by device or by mount point — `umount` accepts either. */
export async function unmount(target: string) {
  await run("umount", [target], { loggableArgs: [target] });
}

/**
 * Hands a removable device back so it can be pulled out safely.
 *
 * `--no-user-interaction` is not optional here: without it udisksctl can stop
 * and wait for an answer that will never come from a server process.
 */
export async function powerOff(device: string) {
  assertDevice(device);
  const args = ["power-off", "--block-device", device, "--no-user-interaction"];
  await run("udisksctl", args, { timeoutMs: 30_000, loggableArgs: args });
}

/**
 * Writes a GPT label. Destroys the existing partition table.
 *
 * Callers treat a failure here as "a table already exists", which is usually
 * true and is why the error is swallowed upstream rather than here.
 */
export async function createPartitionTable(disk: string) {
  assertDevice(disk);
  const args = ["--script", disk, "mklabel", "gpt"];
  await run("parted", args, { timeoutMs: 120_000, loggableArgs: args });
}

export async function createPartition(disk: string, start: string, end: string) {
  assertDevice(disk);
  const args = ["--script", "--align", "optimal", disk, "mkpart", "primary", start, end];
  await run("parted", args, { timeoutMs: 120_000, loggableArgs: args });
}

export async function removePartition(disk: string, partitionNumber: number) {
  assertDevice(disk);
  const args = ["--script", disk, "rm", String(partitionNumber)];
  await run("parted", args, { timeoutMs: 120_000, loggableArgs: args });
}

export const MKFS_BINARIES = {
  ext4: "mkfs.ext4",
  ext3: "mkfs.ext3",
  btrfs: "mkfs.btrfs",
  xfs: "mkfs.xfs",
  ntfs: "mkfs.ntfs",
  vfat: "mkfs.vfat",
  exfat: "mkfs.exfat",
} as const;

export type MkfsFilesystem = keyof typeof MKFS_BINARIES;

/**
 * Formats a partition. Everything on it is gone.
 *
 * The filesystem is a key into a fixed map rather than a string reaching the
 * process layer, so a value that came from a request body can only ever select
 * one of seven known binaries — never name one.
 */
export async function format(
  device: string,
  filesystem: MkfsFilesystem,
  extraArgs: readonly string[] = [],
) {
  assertDevice(device);

  const binary = MKFS_BINARIES[filesystem];
  if (!binary) throw new Error(`Refusing to format: unknown filesystem "${filesystem}"`);

  const args = [...extraArgs, device];
  await run(binary, args, { timeoutMs: 600_000, loggableArgs: args });
}

/**
 * Erases every filesystem and partition-table signature on a disk.
 *
 * The most destructive thing the server can do, and it takes a device path
 * that started life in an HTTP request. Nothing downstream will question it,
 * so the shape is checked here, immediately before the call.
 */
export async function wipeSignatures(disk: string) {
  assertDevice(disk);
  const args = ["--all", "--force", disk];
  await run("wipefs", args, { timeoutMs: 120_000, loggableArgs: args });
}
