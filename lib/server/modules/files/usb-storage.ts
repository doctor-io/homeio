import "server-only";

import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/server/env";
import type { UsbDrive, UsbPartition } from "@/lib/shared/contracts/usb";
import { emitUsbEvent } from "./usb-emitter";
import * as storage from "@/lib/server/platform/storage";


const USB_MOUNT_ROOT = path.join(serverEnv.FILES_ROOT, "Removable");
const POLL_INTERVAL_MS = 5_000;

// Snapshot of previously-known drives for change detection
let lastKnownDriveIds = new Set<string>();
let pollerStarted = false;

type LsblkPartition = {
  name: string;
  fstype?: string | null;
  label?: string | null;
  uuid?: string | null;
  size?: string;
  mountpoint?: string | null;
  type?: string;
};

type LsblkDevice = {
  name: string;
  vendor?: string | null;
  model?: string | null;
  size?: string;
  type?: string;
  rm?: boolean;
  hotplug?: boolean;
  tran?: string | null;
  children?: LsblkPartition[];
};

type LsblkOutput = { blockdevices: LsblkDevice[] };

function driveLabel(device: LsblkDevice): string {
  const parts = [device.vendor, device.model].filter(Boolean).join(" ").trim();
  return parts || device.name;
}

function partLabel(part: LsblkPartition): string {
  return part.label || part.uuid || part.name;
}

function driveId(device: LsblkDevice): string {
  // Use the first partition UUID if available, otherwise device name
  const firstUuid = device.children?.find((p) => p.uuid)?.uuid;
  return firstUuid ?? device.name;
}

async function detectUsbDrives(): Promise<UsbDrive[]> {
  let stdout: string;
  try {
    stdout = await storage.listBlockDevices([
      "NAME", "VENDOR", "MODEL", "SIZE", "TYPE", "MOUNTPOINT",
      "FSTYPE", "RM", "HOTPLUG", "LABEL", "UUID", "TRAN",
    ]);
  } catch {
    return [];
  }

  let parsed: LsblkOutput;
  try {
    parsed = JSON.parse(stdout) as LsblkOutput;
  } catch {
    return [];
  }

  const drives: UsbDrive[] = [];

  for (const device of parsed.blockdevices ?? []) {
    const isRemovable = device.rm === true || device.hotplug === true || device.tran === "usb";
    const isVirtualOrLoop = device.type === "loop" || device.name.startsWith("loop");
    if (!isRemovable || isVirtualOrLoop || device.type !== "disk") continue;

    const partitions: UsbPartition[] = (device.children ?? [])
      .filter((c) => c.type === "part" || !c.type)
      .map((p) => ({
        name: p.name,
        fstype: p.fstype ?? null,
        label: p.label ?? null,
        uuid: p.uuid ?? null,
        size: p.size ?? device.size ?? "",
        mountpoint: p.mountpoint ?? null,
      }));

    const mountedPart = partitions.find((p) => p.mountpoint);
    const isMounted = Boolean(mountedPart);
    const id = driveId(device);

    drives.push({
      id,
      device: `/dev/${device.name}`,
      vendor: device.vendor?.trim() || null,
      model: device.model?.trim() || null,
      size: device.size ?? "",
      partitions,
      isMounted,
      mountpoint: mountedPart?.mountpoint ?? null,
      label: driveLabel(device),
    });
  }

  return drives;
}

export async function listUsbDrives(): Promise<UsbDrive[]> {
  return detectUsbDrives();
}

function mountpointForDrive(drive: UsbDrive): string {
  const safe = drive.label.replace(/[^a-zA-Z0-9\-_]/g, "_").replace(/_+/g, "_").slice(0, 32);
  return path.join(USB_MOUNT_ROOT, safe || drive.id.slice(0, 8));
}

export async function mountUsbDrive(driveId: string): Promise<UsbDrive> {
  const drives = await detectUsbDrives();
  const drive = drives.find((d) => d.id === driveId);
  if (!drive) throw new Error("Drive not found");
  if (drive.isMounted) return drive;

  const partition = drive.partitions[0];
  if (!partition) throw new Error("No partition found on drive");

  const mountPath = mountpointForDrive(drive);
  await mkdir(mountPath, { recursive: true });

  const fstype = partition.fstype && partition.fstype !== "auto" ? partition.fstype : "auto";
  await storage.mount(`/dev/${partition.name}`, mountPath, { fsType: fstype });

  const updated = await detectUsbDrives();
  const updatedDrive = updated.find((d) => d.id === driveId);
  const result: UsbDrive = updatedDrive ?? { ...drive, isMounted: true, mountpoint: mountPath };
  emitUsbEvent({ type: "usb.mounted", drive: result });
  return result;
}

export async function unmountUsbDrive(driveId: string): Promise<void> {
  const drives = await detectUsbDrives();
  const drive = drives.find((d) => d.id === driveId);
  if (!drive) throw new Error("Drive not found");

  // Use our own mount path or the detected mountpoint
  const mountpoint = drive.mountpoint ?? mountpointForDrive(drive);
  await storage.unmount(mountpoint).catch(async () => {
    // Try the partition mountpoint as fallback
    const partition = drive.partitions.find((p) => p.mountpoint);
    if (partition?.mountpoint) {
      await storage.unmount(partition.mountpoint);
    }
  });

  emitUsbEvent({ type: "usb.unmounted", driveId });
}

export async function ejectUsbDrive(driveId: string): Promise<void> {
  await unmountUsbDrive(driveId).catch(() => undefined);

  const drives = await detectUsbDrives();
  const drive = drives.find((d) => d.id === driveId);
  if (!drive) return;

  try {
    await storage.powerOff(drive.device);
  } catch {
    // udisksctl not available or already ejected — that's fine
  }

  emitUsbEvent({ type: "usb.disconnected", driveId });
}

async function pollDrives() {
  try {
    const drives = await detectUsbDrives();
    const currentIds = new Set(drives.map((d) => d.id));

    for (const drive of drives) {
      if (!lastKnownDriveIds.has(drive.id)) {
        emitUsbEvent({ type: "usb.connected", drive });
      }
    }

    for (const oldId of lastKnownDriveIds) {
      if (!currentIds.has(oldId)) {
        emitUsbEvent({ type: "usb.disconnected", driveId: oldId });
      }
    }

    lastKnownDriveIds = currentIds;
  } catch {
    // don't crash the poller
  }
}

export function startUsbPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  // Seed initial state without emitting events
  detectUsbDrives().then((drives) => {
    lastKnownDriveIds = new Set(drives.map((d) => d.id));
  }).catch(() => undefined);
  setInterval(pollDrives, POLL_INTERVAL_MS);
}
