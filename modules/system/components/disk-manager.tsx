"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PANEL_INSET } from "@/lib/ui/surface-tokens";
import {
  useDisks,
  useDiskFormat,
  useDiskMount,
  useDiskUnmount,
  useDiskCreatePartition,
  useDiskDeletePartition,
  useDiskWipe,
} from "@/modules/system/hooks/useDisks";
import { isElevationCancelled } from "@/modules/auth/elevation/elevation-error";
import type { DiskDevice, DiskFilesystem, DiskPartition } from "@/lib/shared/contracts/disks";
import { DISK_FILESYSTEMS } from "@/lib/shared/contracts/disks";
import {
  RefreshCw    as ArrowSyncRegular,
  HardDrive    as HardDriveRegular,
  AlertTriangle as WarningRegular,
  X            as DismissRegular,
  Check        as CheckmarkRegular,
  Download     as ArrowDownloadRegular,
  Upload       as ArrowUploadRegular,
  Trash2       as DeleteRegular,
  Plus         as AddRegular,
} from "@/components/icons/platform-icons";

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

const FS_COLOR: Record<string, string> = {
  ext4: "bg-primary/70",
  ext3: "bg-primary/50",
  btrfs: "bg-violet-500/70",
  xfs: "bg-emerald-500/70",
  ntfs: "bg-orange-400/70",
  vfat: "bg-sky-400/70",
  exfat: "bg-sky-500/60",
  swap: "bg-status-red/60",
};

function fsColor(fstype: string | null): string {
  return fstype ? (FS_COLOR[fstype.toLowerCase()] ?? "bg-muted-foreground/30") : "bg-muted-foreground/20";
}

const MEDIA_BADGE: Record<string, { label: string; color: string }> = {
  nvme:      { label: "NVMe",      color: "text-violet-400" },
  ssd:       { label: "SSD",       color: "text-sky-400" },
  hdd:       { label: "HDD",       color: "text-amber-400" },
  removable: { label: "USB",       color: "text-emerald-400" },
  unknown:   { label: "Disk",      color: "text-muted-foreground/60" },
};

// ─── sub-components ───────────────────────────────────────────────────────────

function DiskCard({ disk, selected, onClick }: { disk: DiskDevice; selected: boolean; onClick: () => void }) {
  const badge = MEDIA_BADGE[disk.mediaType] ?? MEDIA_BADGE.unknown!;
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-glass-border bg-background/40 text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        <HardDriveRegular className={cn("size-3.5 shrink-0", selected ? "text-primary" : badge.color)} />
        <span className="truncate text-sm font-medium">{disk.device}</span>
      </div>
      {disk.model && (
        <p className="truncate pl-5 text-2xs text-muted-foreground/70">{disk.model}</p>
      )}
      <div className="flex items-center gap-2 pl-5">
        <span className={cn("text-2xs font-medium", badge.color)}>{badge.label}</span>
        <span className="text-2xs text-muted-foreground/60">{formatBytes(disk.sizeBytes)}</span>
        <span className="text-2xs text-muted-foreground/40">{disk.partitions.length}p</span>
      </div>
    </button>
  );
}

function PartitionBar({ partitions, totalBytes }: { partitions: DiskPartition[]; totalBytes: number | null }) {
  if (!totalBytes || totalBytes === 0) return null;

  const sized = partitions.filter((p) => p.sizeBytes !== null && p.sizeBytes > 0);
  const usedBytes = sized.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
  const freeBytes = Math.max(0, totalBytes - usedBytes);
  const freePct = (freeBytes / totalBytes) * 100;

  return (
    <div className="flex h-6 w-full overflow-hidden rounded-lg border border-glass-border/60">
      {sized.map((p) => {
        const pct = ((p.sizeBytes ?? 0) / totalBytes) * 100;
        return (
          <div
            key={p.name}
            title={`${p.device} — ${p.fstype ?? "unformatted"} — ${formatBytes(p.sizeBytes)}`}
            className={cn("h-full transition-all", fsColor(p.fstype))}
            style={{ width: `${pct}%` }}
          />
        );
      })}
      {freePct > 0.5 && (
        <div
          className="h-full flex-1 bg-background/50"
          title={`Unallocated — ${formatBytes(freeBytes)}`}
        />
      )}
    </div>
  );
}

// ─── confirm banner ───────────────────────────────────────────────────────────

type ConfirmState =
  | { type: "format"; device: string; filesystem: DiskFilesystem; label: string }
  | { type: "delete"; device: string }
  | { type: "wipe"; disk: string };

function ConfirmBanner({
  state,
  onConfirm,
  onCancel,
  isPending,
}: {
  state: ConfirmState;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const messages: Record<ConfirmState["type"], string> = {
    format: `Format ${state.type === "format" ? state.device : ""} as ${state.type === "format" ? state.filesystem : ""}? All data will be lost.`,
    delete: `Delete partition ${state.type === "delete" ? state.device : ""}? This cannot be undone.`,
    wipe: `Wipe all data and partitions from ${state.type === "wipe" ? state.disk : ""}? This is irreversible.`,
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-status-red/30 bg-status-red/10 px-4 py-2.5">
      <WarningRegular className="size-4 shrink-0 text-status-red" />
      <p className="flex-1 text-xs text-foreground">{messages[state.type]}</p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onCancel}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          <DismissRegular className="size-3.5" />
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-status-red/20 px-3 py-1.5 text-xs font-medium text-status-red transition-colors hover:bg-status-red/30 disabled:opacity-50"
        >
          <CheckmarkRegular className="size-3.5" />
          {isPending ? "Working…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

// ─── mount form ───────────────────────────────────────────────────────────────

function MountForm({
  device,
  onMount,
  onCancel,
  isPending,
}: {
  device: string;
  onMount: (mountPoint: string, addToFstab: boolean) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const safeName = device.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "");
  const [mountPoint, setMountPoint] = useState(`/mnt/${safeName}`);
  const [addToFstab, setAddToFstab] = useState(false);

  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-3 p-3")}>
      <p className="text-xs font-medium text-foreground">Mount {device}</p>
      <div className="flex flex-col gap-1.5">
        <label className="text-2xs text-muted-foreground">Mount point</label>
        <input
          value={mountPoint}
          onChange={(e) => setMountPoint(e.target.value)}
          className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
          placeholder="/mnt/data"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={addToFstab}
          onChange={(e) => setAddToFstab(e.target.checked)}
          className="rounded"
        />
        Auto-mount at boot (add to /etc/fstab)
      </label>
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={() => onMount(mountPoint, addToFstab)}
          disabled={isPending || !mountPoint.startsWith("/")}
          className="rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
        >
          {isPending ? "Mounting…" : "Mount"}
        </button>
      </div>
    </div>
  );
}

// ─── format form ──────────────────────────────────────────────────────────────

function FormatForm({
  device,
  onFormat,
  onCancel,
}: {
  device: string;
  onFormat: (filesystem: DiskFilesystem, label: string) => void;
  onCancel: () => void;
}) {
  const [filesystem, setFilesystem] = useState<DiskFilesystem>("ext4");
  const [label, setLabel] = useState("");

  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-3 p-3")}>
      <p className="text-xs font-medium text-foreground">Format {device}</p>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-2xs text-muted-foreground">Filesystem</label>
          <select
            value={filesystem}
            onChange={(e) => setFilesystem(e.target.value as DiskFilesystem)}
            className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
          >
            {DISK_FILESYSTEMS.map((fs) => (
              <option key={fs} value={fs}>{fs}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-2xs text-muted-foreground">Label (optional)</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="data"
            className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={() => onFormat(filesystem, label)}
          className="rounded-lg bg-status-amber/20 px-3 py-1.5 text-xs font-medium text-status-amber transition-colors hover:bg-status-amber/30"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ─── create partition form ────────────────────────────────────────────────────

function CreatePartitionForm({
  disk,
  onCreate,
  onCancel,
  isPending,
}: {
  disk: string;
  onCreate: (start: string, end: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [start, setStart] = useState("1MiB");
  const [end, setEnd] = useState("100%");

  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-3 p-3")}>
      <p className="text-xs font-medium text-foreground">New partition on {disk}</p>
      <div className="flex gap-3">
        {[
          { label: "Start", value: start, setter: setStart, placeholder: "1MiB or 0%" },
          { label: "End", value: end, setter: setEnd, placeholder: "100% or 50GiB" },
        ].map(({ label, value, setter, placeholder }) => (
          <div key={label} className="flex flex-1 flex-col gap-1.5">
            <label className="text-2xs text-muted-foreground">{label}</label>
            <input
              value={value}
              onChange={(e) => setter(e.target.value)}
              placeholder={placeholder}
              className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs font-mono text-foreground outline-none focus:border-primary/40"
            />
          </div>
        ))}
      </div>
      <p className="text-2xs text-muted-foreground/60">
        Use % for proportional (e.g. 0%, 100%) or size units (1MiB, 50GiB).
      </p>
      <div className="flex items-center justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          onClick={() => onCreate(start, end)}
          disabled={isPending}
          className="rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:opacity-50"
        >
          {isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

// ─── partition row ────────────────────────────────────────────────────────────

function PartitionRow({
  partition,
  onFormat,
  onMount,
  onUnmount,
  onDelete,
}: {
  partition: DiskPartition;
  onFormat: () => void;
  onMount: () => void;
  onUnmount: () => void;
  onDelete: () => void;
}) {
  const isMounted = Boolean(partition.mountpoint);

  return (
    <div className="grid grid-cols-[1.4fr_0.9fr_0.8fr_1.2fr_auto] items-center gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-background/30">
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn("size-2 shrink-0 rounded-sm", fsColor(partition.fstype))} />
        <span className="font-mono font-medium text-foreground truncate">{partition.device}</span>
      </div>
      <span className="text-muted-foreground/80">{partition.fstype ?? <span className="text-muted-foreground/40">—</span>}</span>
      <span className="font-mono text-muted-foreground/80">{formatBytes(partition.sizeBytes)}</span>
      <span className={cn("font-mono truncate", isMounted ? "text-status-green" : "text-muted-foreground/40")}>
        {partition.mountpoint ?? "—"}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onFormat}
          title="Format"
          className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-background/60 hover:text-status-amber"
        >
          <ArrowSyncRegular className="size-3.5" />
        </button>
        {isMounted ? (
          <button
            onClick={onUnmount}
            title="Unmount"
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-background/60 hover:text-foreground"
          >
            <ArrowUploadRegular className="size-3.5" />
          </button>
        ) : (
          <button
            onClick={onMount}
            title="Mount"
            className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-background/60 hover:text-primary"
          >
            <ArrowDownloadRegular className="size-3.5" />
          </button>
        )}
        <button
          onClick={onDelete}
          title="Delete partition"
          className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-background/60 hover:text-status-red"
        >
          <DeleteRegular className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── disk detail panel ────────────────────────────────────────────────────────

type ActiveForm =
  | { type: "format"; device: string }
  | { type: "mount"; device: string }
  | { type: "create-partition" }
  | null;

function DiskDetail({ disk }: { disk: DiskDevice }) {
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [pendingFormat, setPendingFormat] = useState<{ filesystem: DiskFilesystem; label: string } | null>(null);

  const formatMutation = useDiskFormat();
  const mountMutation = useDiskMount();
  const unmountMutation = useDiskUnmount();
  const createPartitionMutation = useDiskCreatePartition();
  const deletePartitionMutation = useDiskDeletePartition();
  const wipeMutation = useDiskWipe();

  const anyPending =
    formatMutation.isPending ||
    mountMutation.isPending ||
    unmountMutation.isPending ||
    createPartitionMutation.isPending ||
    deletePartitionMutation.isPending ||
    wipeMutation.isPending;

  async function handleConfirm() {
    if (!confirmState) return;
    try {
      if (confirmState.type === "format") {
        await formatMutation.mutateAsync({
          device: confirmState.device,
          filesystem: confirmState.filesystem,
          label: confirmState.label || undefined,
        });
        toast.success(`Formatted ${confirmState.device} as ${confirmState.filesystem}`);
      } else if (confirmState.type === "delete") {
        await deletePartitionMutation.mutateAsync({ device: confirmState.device });
        toast.success(`Deleted partition ${confirmState.device}`);
      } else if (confirmState.type === "wipe") {
        await wipeMutation.mutateAsync({ disk: confirmState.disk });
        toast.success(`Wiped disk ${confirmState.disk}`);
      }
    } catch (e) {
      // Closing the password prompt is an answer, not a fault. Reporting it as
      // one tells the user something broke when they are the one who stopped it.
      if (!isElevationCancelled(e)) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      }
    } finally {
      setConfirmState(null);
      setPendingFormat(null);
      setActiveForm(null);
    }
  }

  function handleFormatSubmit(filesystem: DiskFilesystem, label: string) {
    if (activeForm?.type !== "format") return;
    setPendingFormat({ filesystem, label });
    setConfirmState({ type: "format", device: activeForm.device, filesystem, label });
    setActiveForm(null);
  }

  async function handleMount(mountPoint: string, addToFstab: boolean) {
    if (activeForm?.type !== "mount") return;
    try {
      await mountMutation.mutateAsync({ device: activeForm.device, mountPoint, addToFstab });
      toast.success(`Mounted ${activeForm.device} at ${mountPoint}`);
      setActiveForm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mount failed");
    }
  }

  async function handleUnmount(device: string) {
    try {
      await unmountMutation.mutateAsync({ device });
      toast.success(`Unmounted ${device}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unmount failed");
    }
  }

  async function handleCreatePartition(start: string, end: string) {
    try {
      await createPartitionMutation.mutateAsync({ disk: disk.device, start, end });
      toast.success("Partition created");
      setActiveForm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {/* Disk header */}
      <div className={cn(PANEL_INSET, "flex items-center gap-3 px-4 py-3")}>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-glass-border bg-background/55">
          <HardDriveRegular className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {disk.model ?? disk.device}
          </p>
          <p className="font-mono text-2xs text-muted-foreground/70">
            {disk.device} · {formatBytes(disk.sizeBytes)} · {MEDIA_BADGE[disk.mediaType]?.label ?? "Disk"}
          </p>
        </div>
        {disk.serial && (
          <span className="font-mono text-2xs text-muted-foreground/50">{disk.serial}</span>
        )}
      </div>

      {/* Partition bar */}
      {disk.partitions.length > 0 && (
        <PartitionBar partitions={disk.partitions} totalBytes={disk.sizeBytes} />
      )}

      {/* Partition table */}
      <div className={cn(PANEL_INSET, "overflow-hidden")}>
        <div className="grid grid-cols-[1.4fr_0.9fr_0.8fr_1.2fr_auto] gap-3 border-b border-glass-border/50 px-4 py-2 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
          <span>Partition</span>
          <span>Filesystem</span>
          <span>Size</span>
          <span>Mount Point</span>
          <span />
        </div>

        {disk.partitions.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground/60">
            No partitions found
          </p>
        ) : (
          <div className="divide-y divide-glass-border/40">
            {disk.partitions.map((partition) => (
              <PartitionRow
                key={partition.name}
                partition={partition}
                onFormat={() => setActiveForm({ type: "format", device: partition.device })}
                onMount={() => setActiveForm({ type: "mount", device: partition.device })}
                onUnmount={() => handleUnmount(partition.device)}
                onDelete={() => setConfirmState({ type: "delete", device: partition.device })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Inline forms */}
      {activeForm?.type === "format" && (
        <FormatForm
          device={activeForm.device}
          onFormat={handleFormatSubmit}
          onCancel={() => setActiveForm(null)}
        />
      )}

      {activeForm?.type === "mount" && (
        <MountForm
          device={activeForm.device}
          onMount={handleMount}
          onCancel={() => setActiveForm(null)}
          isPending={mountMutation.isPending}
        />
      )}

      {activeForm?.type === "create-partition" && (
        <CreatePartitionForm
          disk={disk.device}
          onCreate={handleCreatePartition}
          onCancel={() => setActiveForm(null)}
          isPending={createPartitionMutation.isPending}
        />
      )}

      {/* Confirm banner */}
      {confirmState && (
        <ConfirmBanner
          state={confirmState}
          onConfirm={handleConfirm}
          onCancel={() => { setConfirmState(null); setPendingFormat(null); }}
          isPending={anyPending}
        />
      )}

      {/* Disk-level actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setActiveForm({ type: "create-partition" })}
          disabled={anyPending}
          className="flex items-center gap-1.5 rounded-xl border border-glass-border bg-background/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground disabled:opacity-40"
        >
          <AddRegular className="size-3.5" />
          Create Partition
        </button>
        <button
          onClick={() => setConfirmState({ type: "wipe", disk: disk.device })}
          disabled={anyPending}
          className="flex items-center gap-1.5 rounded-xl border border-status-red/25 bg-status-red/8 px-3 py-2 text-xs text-status-red transition-colors hover:bg-status-red/15 disabled:opacity-40"
        >
          <WarningRegular className="size-3.5" />
          Wipe Disk
        </button>
      </div>
    </div>
  );
}

// ─── DiskManager (root) ───────────────────────────────────────────────────────

export function DiskManager() {
  const { data, isLoading, refetch, isRefetching } = useDisks();
  const [selectedDisk, setSelectedDisk] = useState<string | null>(null);

  const disks = data?.disks ?? [];
  const active = disks.find((d) => d.name === selectedDisk) ?? disks[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-glass-border/60 px-4 py-2.5">
        <span className="text-sm font-medium text-foreground">
          {isLoading ? "Loading…" : `${disks.length} disk${disks.length !== 1 ? "s" : ""} detected`}
        </span>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground disabled:opacity-50"
        >
          <ArrowSyncRegular className={cn("size-3.5", isRefetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Disk list sidebar */}
        <div className="flex w-52 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-glass-border/60 p-2">
          {isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">Detecting disks…</p>
          ) : disks.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">No disks found</p>
          ) : (
            disks.map((disk) => (
              <DiskCard
                key={disk.name}
                disk={disk}
                selected={disk.name === (active?.name ?? "")}
                onClick={() => setSelectedDisk(disk.name)}
              />
            ))
          )}
        </div>

        {/* Detail panel */}
        {active ? (
          <DiskDetail key={active.name} disk={active} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <HardDriveRegular className="size-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground/60">Select a disk</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
