"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw, X, HardDrive, Plug, EjectIcon } from "@/components/icons/platform-icons";
import { useUsbDrives } from "@/modules/files/hooks/useUsbDrives";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/shared/query-keys";

type UsbStorageDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToUsb: (path: string[]) => void;
};

export function UsbStorageDialog({ isOpen, onClose, onNavigateToUsb }: UsbStorageDialogProps) {
  const queryClient = useQueryClient();
  const { drives, mount, unmount, eject, isMounting, isUnmounting, isEjecting } = useUsbDrives();

  const isBusy = isMounting || isUnmounting || isEjecting;

  function handleRefresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.usbDrives });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobileSheet
        showCloseButton={false}
        className="max-w-[min(96vw,60rem)] gap-0 overflow-hidden rounded-[calc(var(--radius)+0.75rem)] border-glass-border bg-popover/96 p-0 shadow-2xl shadow-black/45 backdrop-blur-2xl handheld:grid-rows-[auto_minmax(0,1fr)]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>USB & Removable Storage</DialogTitle>
          <DialogDescription>Manage removable drives connected to your server.</DialogDescription>
        </DialogHeader>

        {/* Window chrome title bar */}
        <div className="flex h-11 shrink-0 select-none items-center gap-0 border-b border-glass-border/50 bg-popover/70 backdrop-blur-2xl handheld:grid handheld:h-auto handheld:min-h-12 handheld:grid-cols-[5rem_minmax(0,1fr)_5rem]">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5 px-4 handheld:px-2">
            <button
              onClick={onClose}
              className="group flex size-3 cursor-pointer items-center justify-center rounded-full bg-[#ff5f57] transition-all hover:brightness-110 handheld:size-[var(--mobile-touch-target)] handheld:bg-transparent handheld:text-muted-foreground"
              aria-label="Close"
            >
              <X className="size-[7px] text-[#6a0002] opacity-0 transition-opacity group-hover:opacity-100 handheld:size-4 handheld:text-current handheld:opacity-100" />
            </button>
            <span className="size-3 rounded-full bg-white/10 handheld:hidden" />
            <span className="size-3 rounded-full bg-white/10 handheld:hidden" />
          </div>

          {/* Centered title */}
          <div className="flex flex-1 items-center justify-center">
            <span className="text-xs font-medium text-foreground/80 handheld:hidden">USB & Removable Storage</span>
            <span className="hidden text-center text-sm font-semibold text-foreground/80 handheld:block">USB Storage</span>
          </div>

          {/* Right actions */}
          <div className="flex items-center justify-end gap-2 px-4 handheld:px-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isBusy}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-glass-border bg-background/80 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 handheld:h-[var(--mobile-touch-target)] handheld:border-transparent handheld:bg-transparent handheld:px-1 handheld:text-xs"
            >
              <RefreshCw className="size-3" />
              Rescan
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="relative min-h-[50vh] overflow-y-auto p-5 handheld:min-h-0 handheld:overscroll-contain handheld:[&_button]:min-h-[var(--mobile-touch-target)]">
          {drives.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <HardDrive className="size-8 opacity-25" />
              <span>No removable drives detected.</span>
              <span className="text-xs opacity-60">Plug in a USB drive and click Rescan.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
                Detected drives
              </p>
              {drives.map((drive) => (
                <div
                  key={drive.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                    drive.isMounted
                      ? "border-emerald-500/20 bg-card/60"
                      : "border-glass-border bg-card/60"
                  }`}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55">
                    <Plug
                      className={`size-4 ${drive.isMounted ? "text-emerald-400" : "text-amber-400"}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {drive.label}
                      </span>
                      {drive.isMounted && (
                        <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          Mounted
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                      <span>{drive.size}</span>
                      {drive.partitions[0]?.fstype && (
                        <>
                          <span>·</span>
                          <span>{drive.partitions[0].fstype.toUpperCase()}</span>
                        </>
                      )}
                      {drive.isMounted && drive.mountpoint && (
                        <>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => onNavigateToUsb(["Removable", drive.label])}
                            className="truncate hover:text-foreground hover:underline"
                          >
                            {drive.mountpoint}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 handheld:[&_button]:min-w-[var(--mobile-touch-target)]">
                    {isBusy ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
                    ) : drive.isMounted ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { unmount(drive.id); }}
                          className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/25"
                        >
                          Unmount
                        </button>
                        <button
                          type="button"
                          onClick={() => { eject(drive.id); onClose(); }}
                          title="Eject"
                          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/40 transition-colors hover:bg-background/50 hover:text-foreground"
                        >
                          <EjectIcon className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { mount(drive.id); }}
                        className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-400 transition-colors hover:bg-sky-500/25"
                      >
                        Mount
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
