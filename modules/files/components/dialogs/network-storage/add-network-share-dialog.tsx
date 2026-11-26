"use client";

import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Plus, RefreshCw, Search, X } from "@/components/icons/platform-icons";

export type AddNetworkShareDraft = {
  host: string;
  share: string;
  username: string;
  password: string;
};

type AddNetworkShareDialogProps = {
  createPending: boolean;
  discoverSharesPending: boolean;
  discoveredShares: string[];
  draft: AddNetworkShareDraft;
  isBusy: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDiscoverServers: () => void;
  onDiscoverShares: () => void;
  onDraftChange: (updater: AddNetworkShareDraft | ((draft: AddNetworkShareDraft) => AddNetworkShareDraft)) => void;
  onSelectShare: (share: string) => void;
  onSubmit: () => void;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </div>
  );
}

export function AddNetworkShareDialog({
  createPending,
  discoverSharesPending,
  discoveredShares,
  draft,
  isBusy,
  isOpen,
  onClose,
  onDiscoverServers,
  onDiscoverShares,
  onDraftChange,
  onSelectShare,
  onSubmit,
}: AddNetworkShareDialogProps) {
  function update<K extends keyof AddNetworkShareDraft>(key: K, value: AddNetworkShareDraft[K]) {
    onDraftChange((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent mobileSheet showCloseButton={false} className="max-w-[34rem] gap-0 border-glass-border bg-popover/96 p-0 shadow-2xl shadow-black/45 backdrop-blur-2xl handheld:grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader className="sr-only">
          <DialogTitle>Add Network Share</DialogTitle>
          <DialogDescription>Connect to an SMB share</DialogDescription>
        </DialogHeader>

        {/* Window chrome title bar */}
        <div className="flex h-11 shrink-0 select-none items-center gap-0 border-b border-glass-border/50 bg-popover/70 backdrop-blur-2xl handheld:grid handheld:h-auto handheld:min-h-12 handheld:grid-cols-[5rem_minmax(0,1fr)_5rem]">
          {/* Traffic lights */}
          <div className="flex items-center gap-1.5 px-4 handheld:hidden">
            <button
              onClick={onClose}
              className="group flex size-3 cursor-pointer items-center justify-center rounded-full bg-[#ff5f57] transition-all hover:brightness-110"
              aria-label="Close"
            >
              <X className="size-[7px] text-[#6a0002] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <span className="size-3 rounded-full bg-white/10" />
            <span className="size-3 rounded-full bg-white/10" />
          </div>

          {/* Centered title */}
          <div className="flex flex-1 items-center justify-center">
            <span className="text-xs font-medium text-foreground/80 handheld:text-center handheld:text-sm handheld:font-semibold">Add Network Share</span>
          </div>

          {/* Right action — back button to balance */}
          <div className="flex items-center justify-end px-4 handheld:order-first handheld:justify-start handheld:px-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-glass-border bg-background/80 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground handheld:h-[var(--mobile-touch-target)] handheld:border-transparent handheld:bg-transparent handheld:text-xs handheld:text-[var(--mobile-accent-text)]"
              aria-label="Back"
            >
              <ArrowLeft className="size-3" />
              Back
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 handheld:overflow-y-auto handheld:overscroll-contain handheld:[&_button]:min-h-[var(--mobile-touch-target)] handheld:[&_input]:min-h-[var(--mobile-touch-target)] handheld:[&_input]:text-base">
          {/* Server */}
          <div>
            <FieldLabel>Server</FieldLabel>
            <div className="flex gap-2">
              <Input
                value={draft.host}
                onChange={(event) => update("host", event.target.value)}
                placeholder="Host or IP (e.g. nas.local, 192.168.1.100)"
                className="h-8 rounded-lg border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-0"
              />
              <button
                type="button"
                onClick={onDiscoverServers}
                disabled={isBusy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="size-3" />
                Scan
              </button>
            </div>
          </div>

          {/* Credentials */}
          <div>
            <FieldLabel>Credentials</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={draft.username}
                onChange={(event) => update("username", event.target.value)}
                placeholder="Username"
                className="h-8 rounded-lg border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-0"
              />
              <Input
                type="password"
                value={draft.password}
                onChange={(event) => update("password", event.target.value)}
                placeholder="Password"
                className="h-8 rounded-lg border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-0"
              />
            </div>
          </div>

          {/* Share */}
          <div>
            <FieldLabel>Share</FieldLabel>
            <div className="flex gap-2">
              <Input
                value={draft.share}
                onChange={(event) => update("share", event.target.value)}
                placeholder="Share name (e.g. Media, Documents)"
                className="h-8 rounded-lg border-glass-border bg-background/55 px-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:border-primary/40 focus-visible:ring-0"
              />
              <button
                type="button"
                onClick={onDiscoverShares}
                disabled={isBusy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {discoverSharesPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Search className="size-3" />
                )}
                Find
              </button>
            </div>

            {discoveredShares.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {discoveredShares.map((shareName) => (
                  <button
                    key={shareName}
                    type="button"
                    onClick={() => onSelectShare(shareName)}
                    className="rounded-lg border border-glass-border bg-background/55 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/75 hover:text-foreground"
                  >
                    {shareName}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-glass-border/60 px-5 py-4 handheld:py-2 handheld:[&_button]:min-h-[var(--mobile-touch-target)]">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-glass-border bg-background/55 px-3 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isBusy}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/20 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createPending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            Add Share
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
