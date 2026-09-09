import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  DiskDevice,
  DiskFilesystem,
  DiskMediaType,
  DiskPartition,
} from "@/lib/shared/contracts/disks";

const execFileAsync = promisify(execFile);

// ─── lsblk types ─────────────────────────────────────────────────────────────

type LsblkChild = {
  name: string;
  size: number | null;
  type: string;
  fstype: string | null;
  label: string | null;
  uuid: string | null;
  mountpoint: string | null;
  ro: boolean | string;
  parttype: string | null;
};

type LsblkDevice = {
  name: string;
  model: string | null;
  vendor: string | null;
  serial: string | null;
  size: number | null;
  type: string;
  tran: string | null;
  rm: boolean;
  rota: boolean;
  children?: LsblkChild[];
};

type LsblkOutput = { blockdevices: LsblkDevice[] };

// ─── helpers ──────────────────────────────────────────────────────────────────

function parsePartitionInfo(name: string): { disk: string; number: number } | null {
  // NVMe / eMMC: nvme0n1p2, mmcblk0p1
  const nvme = name.match(/^((?:nvme|mmcblk)\d+(?:n\d+)?)p(\d+)$/);
  if (nvme) return { disk: nvme[1]!, number: parseInt(nvme[2]!, 10) };
  // SATA / SCSI / VirtIO: sda1, vda2, xda10
  const sata = name.match(/^([a-z]+?)(\d+)$/);
  if (sata) return { disk: sata[1]!, number: parseInt(sata[2]!, 10) };
  return null;
}

function mediaTypeFromDevice(dev: LsblkDevice): DiskMediaType {
  if (dev.rm || dev.tran === "usb") return "removable";
  if (dev.tran === "nvme") return "nvme";
  if (dev.rota === false) return "ssd";
  if (dev.rota === true) return "hdd";
  return "unknown";
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function listDisks(): Promise<DiskDevice[]> {
  let stdout: string;
  try {
    const result = await execFileAsync("lsblk", [
      "--json",
      "--bytes",
      "--output",
      "NAME,MODEL,VENDOR,SERIAL,SIZE,TYPE,FSTYPE,LABEL,UUID,MOUNTPOINT,TRAN,RM,RO,ROTA,PARTTYPE",
    ]);
    stdout = result.stdout;
  } catch {
    return [];
  }

  let parsed: LsblkOutput;
  try {
    parsed = JSON.parse(stdout) as LsblkOutput;
  } catch {
    return [];
  }

  const disks: DiskDevice[] = [];

  for (const dev of parsed.blockdevices ?? []) {
    if (dev.type !== "disk") continue;
    if (dev.name.startsWith("loop") || dev.name.startsWith("ram")) continue;

    const partitions: DiskPartition[] = (dev.children ?? [])
      .filter((c) => c.type === "part" || c.type === "lvm" || c.type === "crypt")
      .map((c) => {
        const info = parsePartitionInfo(c.name);
        return {
          name: c.name,
          device: `/dev/${c.name}`,
          number: info?.number ?? null,
          fstype: c.fstype ?? null,
          label: c.label ?? null,
          uuid: c.uuid ?? null,
          sizeBytes: c.size ?? null,
          mountpoint: c.mountpoint ?? null,
          type: c.type,
          ro: c.ro === true || c.ro === "1",
        };
      });

    disks.push({
      name: dev.name,
      device: `/dev/${dev.name}`,
      model: dev.model?.trim() || null,
      vendor: dev.vendor?.trim() || null,
      serial: dev.serial?.trim() || null,
      sizeBytes: dev.size ?? null,
      mediaType: mediaTypeFromDevice(dev),
      transport: dev.tran ?? null,
      isRemovable: Boolean(dev.rm),
      partitions,
    });
  }

  return disks;
}

// ─── format ───────────────────────────────────────────────────────────────────

const MKFS_COMMAND: Record<DiskFilesystem, string> = {
  ext4: "mkfs.ext4",
  ext3: "mkfs.ext3",
  btrfs: "mkfs.btrfs",
  xfs: "mkfs.xfs",
  ntfs: "mkfs.ntfs",
  vfat: "mkfs.vfat",
  exfat: "mkfs.exfat",
};

const LABEL_FLAG: Record<DiskFilesystem, string> = {
  ext4: "-L",
  ext3: "-L",
  btrfs: "-L",
  xfs: "-L",
  ntfs: "-L",
  vfat: "-n",
  exfat: "-L",
};

const SYSTEM_CRITICAL_MOUNTPOINTS = new Set([
  "/",
  "/boot",
  "/boot/efi",
  "/etc",
  "/usr",
  "/var",
  "/home",
]);

const VALID_DISK_RE = /^\/dev\/(?:sd[a-z]+|nvme\d+n\d+|vd[a-z]+|mmcblk\d+|xvd[a-z]+)$/;
const VALID_PARTITION_RE = /^\/dev\/(?:sd[a-z]+\d+|nvme\d+n\d+p\d+|vd[a-z]+\d+|mmcblk\d+p\d+|xvd[a-z]+\d+)$/;
const VALID_MOUNTPOINT_RE = /^\/[a-zA-Z0-9_\-\.\/]+$/;

async function checkDeviceNotMounted(deviceOrDisk: string, isWholeDisk = false): Promise<void> {
  try {
    const mounts = await readFile("/proc/mounts", "utf8");
    const name = deviceOrDisk.replace("/dev/", "");
    for (const line of mounts.split("\n")) {
      const [mountDevice, mountPoint] = line.trim().split(/\s+/);
      if (!mountDevice || !mountPoint) continue;

      const matches = isWholeDisk
        ? mountDevice.startsWith(`/dev/${name}`)
        : mountDevice === deviceOrDisk;

      if (matches) {
        if (SYSTEM_CRITICAL_MOUNTPOINTS.has(mountPoint)) {
          throw new Error(`Cannot modify system device containing critical mountpoint (${mountPoint})`);
        }
        throw new Error(
          `Cannot modify active mounted device (${mountDevice} mounted on ${mountPoint}). Unmount it first.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Cannot modify")) throw err;
    // /proc/mounts might not exist on macOS in local dev
  }
}

export async function formatPartition(
  device: string,
  filesystem: DiskFilesystem,
  label?: string,
): Promise<void> {
  if (!VALID_PARTITION_RE.test(device)) {
    throw new Error("Invalid partition device path");
  }

  await checkDeviceNotMounted(device, false);

  const cmd = MKFS_COMMAND[filesystem];
  const flag = LABEL_FLAG[filesystem];
  const args: string[] = [];

  if (filesystem === "ntfs") args.push("--fast");
  if (label) {
    if (/[\r\n\0]/.test(label)) throw new Error("Invalid characters in partition label");
    args.push(flag, label);
  }

  args.push(device);

  await execFileAsync(cmd, args);
}

// ─── mount ────────────────────────────────────────────────────────────────────

export async function mountPartition(
  device: string,
  mountPoint: string,
  addToFstab = false,
): Promise<void> {
  if (!VALID_PARTITION_RE.test(device)) {
    throw new Error("Invalid partition device path");
  }
  if (SYSTEM_CRITICAL_MOUNTPOINTS.has(mountPoint)) {
    throw new Error(`Cannot mount partition over critical system directory: ${mountPoint}`);
  }
  if (!VALID_MOUNTPOINT_RE.test(mountPoint) || mountPoint.includes("..")) {
    throw new Error("Mount point must be a safe, absolute path without control characters");
  }
  if (/[\r\n\t\s]/.test(device) || /[\r\n\t\s]/.test(mountPoint)) {
    throw new Error("Device and mount point cannot contain whitespace or newline characters");
  }

  await mkdir(mountPoint, { recursive: true });
  await execFileAsync("mount", [device, mountPoint]);

  if (addToFstab) {
    await appendFstabEntry(device, mountPoint);
  }
}

async function appendFstabEntry(device: string, mountPoint: string): Promise<void> {
  if (/[\r\n\t\s]/.test(device) || /[\r\n\t\s]/.test(mountPoint)) {
    throw new Error("Invalid characters in fstab entry");
  }

  let existing = "";
  try {
    existing = await readFile("/etc/fstab", "utf8");
  } catch {
    // /etc/fstab might not exist on some systems — create it
  }

  // Check line-by-line for existing entry to avoid accidental substring matches
  const lines = existing.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [entryDev, entryPoint] = trimmed.split(/\s+/);
    if (entryDev === device || entryPoint === mountPoint) {
      return; // Already present
    }
  }

  const entry = `${device}\t${mountPoint}\tauto\tdefaults\t0\t2\n`;
  const contentToSave = existing.length > 0 && !existing.endsWith("\n")
    ? `${existing}\n${entry}`
    : `${existing}${entry}`;

  await writeFile("/etc/fstab", contentToSave, "utf8");
}

// ─── unmount ──────────────────────────────────────────────────────────────────

export async function unmountPartition(device: string): Promise<void> {
  if (SYSTEM_CRITICAL_MOUNTPOINTS.has(device)) {
    throw new Error(`Cannot unmount critical system directory: ${device}`);
  }
  if (!VALID_PARTITION_RE.test(device) && !VALID_MOUNTPOINT_RE.test(device)) {
    throw new Error("Invalid device or mount path");
  }
  await execFileAsync("umount", [device]);
}

// ─── create partition ─────────────────────────────────────────────────────────

export async function createPartition(
  disk: string,
  start: string,
  end: string,
): Promise<void> {
  if (!VALID_DISK_RE.test(disk)) throw new Error("Invalid disk device path");
  if (!/^[0-9]+(?:\.[0-9]+)?(?:[kKMGTPE]?i?B|%)?$/.test(start.trim()) ||
      !/^[0-9]+(?:\.[0-9]+)?(?:[kKMGTPE]?i?B|%)?$/.test(end.trim())) {
    throw new Error("Invalid partition boundaries");
  }

  // Ensure GPT table exists (safe — no-op if already present)
  try {
    await execFileAsync("parted", ["--script", disk, "mklabel", "gpt"]);
  } catch {
    // Disk may already have a partition table
  }

  await execFileAsync("parted", [
    "--script",
    "--align",
    "optimal",
    disk,
    "mkpart",
    "primary",
    start.trim(),
    end.trim(),
  ]);
}

// ─── delete partition ─────────────────────────────────────────────────────────

export async function deletePartition(device: string): Promise<void> {
  if (!VALID_PARTITION_RE.test(device)) throw new Error("Invalid partition device path");

  await checkDeviceNotMounted(device, false);

  const name = device.replace("/dev/", "");
  const info = parsePartitionInfo(name);
  if (!info) throw new Error(`Cannot determine partition number from ${device}`);

  const disk = `/dev/${info.disk}`;
  await execFileAsync("parted", ["--script", disk, "rm", String(info.number)]);
}

// ─── wipe disk ────────────────────────────────────────────────────────────────

export async function wipeDisk(disk: string): Promise<void> {
  if (!VALID_DISK_RE.test(disk)) {
    throw new Error("Invalid disk device path");
  }

  // 1. Guard against mounted partitions in /proc/mounts
  await checkDeviceNotMounted(disk, true);

  // 2. Guard against system partitions / active mountpoints using listDisks()
  const disks = await listDisks();
  const diskName = disk.replace("/dev/", "");
  const matched = disks.find((d) => d.device === disk || d.name === diskName);

  if (matched) {
    for (const part of matched.partitions) {
      if (part.mountpoint) {
        if (SYSTEM_CRITICAL_MOUNTPOINTS.has(part.mountpoint)) {
          throw new Error(
            `Cannot wipe system disk containing the operating system (${part.mountpoint})`,
          );
        }
        throw new Error(
          `Cannot wipe disk with active mounted partition (${part.device} on ${part.mountpoint}). Unmount all partitions first.`,
        );
      }
    }
  }

  // wipefs removes all filesystem and partition table signatures
  await execFileAsync("wipefs", ["--all", "--force", disk]);
}
