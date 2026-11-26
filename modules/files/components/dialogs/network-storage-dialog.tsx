"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, RefreshCw, X } from "@/components/icons/platform-icons";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useCreateNetworkShare,
  useDiscoverNetworkServers,
  useDiscoverNetworkShares,
  useMountNetworkShare,
  useNetworkShares,
  useRemoveNetworkShare,
  useUnmountNetworkShare,
} from "@/modules/files/hooks/useNetworkShares";
import {
  AddNetworkShareDialog,
  type AddNetworkShareDraft,
} from "@/modules/files/components/dialogs/network-storage/add-network-share-dialog";
import { NetworkStorageGrid } from "@/modules/files/components/dialogs/network-storage/network-storage-grid";
import { useEffect, useMemo, useRef, useState } from "react";

type NetworkStorageDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToNetwork: () => void;
};

const EMPTY_DRAFT: AddNetworkShareDraft = {
  host: "",
  share: "",
  username: "",
  password: "",
};

export function NetworkStorageDialog({
  isOpen,
  onClose,
  onNavigateToNetwork,
}: NetworkStorageDialogProps) {
  const currentUserQuery = useCurrentUser();
  const autoDiscoverRanRef = useRef(false);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [draft, setDraft] = useState<AddNetworkShareDraft>(EMPTY_DRAFT);
  const [localError, setLocalError] = useState<string | null>(null);
  const [discoveredServers, setDiscoveredServers] = useState<string[]>([]);
  const [discoveredShares, setDiscoveredShares] = useState<string[]>([]);

  const sharesQuery = useNetworkShares();
  const discoverServers = useDiscoverNetworkServers();
  const discoverShares = useDiscoverNetworkShares();
  const createShare = useCreateNetworkShare();
  const removeShare = useRemoveNetworkShare();
  const mountShare = useMountNetworkShare();
  const unmountShare = useUnmountNetworkShare();
  const isDemoMode = currentUserQuery.data?.isDemoMode ?? false;

  const isBusy =
    discoverServers.isPending ||
    discoverShares.isPending ||
    createShare.isPending ||
    removeShare.isPending ||
    mountShare.isPending ||
    unmountShare.isPending;

  const apiError = useMemo(() => {
    return (
      localError ||
      (sharesQuery.error instanceof Error ? sharesQuery.error.message : null) ||
      (discoverServers.error instanceof Error ? discoverServers.error.message : null) ||
      (discoverShares.error instanceof Error ? discoverShares.error.message : null) ||
      (createShare.error instanceof Error ? createShare.error.message : null) ||
      (removeShare.error instanceof Error ? removeShare.error.message : null) ||
      (mountShare.error instanceof Error ? mountShare.error.message : null) ||
      (unmountShare.error instanceof Error ? unmountShare.error.message : null)
    );
  }, [
    createShare.error,
    discoverServers.error,
    discoverShares.error,
    localError,
    mountShare.error,
    removeShare.error,
    sharesQuery.error,
    unmountShare.error,
  ]);

  useEffect(() => {
    if (isOpen) return;
    autoDiscoverRanRef.current = false;
    setIsAddFormOpen(false);
    setDraft(EMPTY_DRAFT);
    setLocalError(null);
    setDiscoveredServers([]);
    setDiscoveredShares([]);
  }, [isOpen]);

  const discoverServersMutate = discoverServers.mutateAsync;
  useEffect(() => {
    if (!isOpen || autoDiscoverRanRef.current) return;
    autoDiscoverRanRef.current = true;
    setLocalError(null);
    void discoverServersMutate()
      .then((result) => {
        setDiscoveredServers(result.servers);
      })
      .catch(() => {
        // Errors surface through the mutation state.
      });
  }, [discoverServersMutate, isOpen]);

  if (isDemoMode) return null;

  async function handleDiscoverServers() {
    setLocalError(null);
    const result = await discoverServers.mutateAsync();
    setDiscoveredServers(result.servers);
  }

  async function handleDiscoverShares() {
    setLocalError(null);
    if (!draft.host.trim() || !draft.username.trim() || !draft.password) {
      setLocalError("Host, username, and password are required to discover shares.");
      return;
    }
    const result = await discoverShares.mutateAsync({
      host: draft.host.trim(),
      username: draft.username.trim(),
      password: draft.password,
    });
    setDiscoveredShares(result.shares);
  }

  async function handleAddShare() {
    setLocalError(null);
    if (!draft.host.trim() || !draft.share.trim() || !draft.username.trim() || !draft.password) {
      setLocalError("Host, share, username, and password are required.");
      return;
    }
    await createShare.mutateAsync({
      host: draft.host.trim(),
      share: draft.share.trim(),
      username: draft.username.trim(),
      password: draft.password,
    });
    setIsAddFormOpen(false);
    onNavigateToNetwork();
  }

  return (
    <>
      <Dialog open={isOpen && !isAddFormOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent mobileSheet
          showCloseButton={false}
          className="max-w-[min(96vw,60rem)] gap-0 overflow-hidden rounded-[calc(var(--radius)+0.75rem)] border-glass-border bg-popover/96 p-0 shadow-2xl shadow-black/45 backdrop-blur-2xl handheld:grid-rows-[auto_minmax(0,1fr)_auto]"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Network Storage</DialogTitle>
            <DialogDescription>Discover, mount, and manage SMB shares.</DialogDescription>
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
              <span className="text-xs font-medium text-foreground/80 handheld:text-center handheld:text-sm handheld:font-semibold">Network Storage</span>
            </div>

            {/* Right actions */}
            <div className="flex items-center justify-end gap-2 px-4 handheld:px-2">
              <button
                type="button"
                onClick={() => void handleDiscoverServers()}
                disabled={isBusy}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-glass-border bg-background/80 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 handheld:h-[var(--mobile-touch-target)] handheld:border-transparent handheld:bg-transparent handheld:px-1 handheld:text-xs"
              >
                {discoverServers.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Rescan
              </button>
            </div>
          </div>

          {/* Grid + floating add button */}
          <div className="relative min-h-[50vh] overflow-y-auto p-5 handheld:min-h-0 handheld:pb-16">
            <NetworkStorageGrid
              configuredShares={sharesQuery.data ?? []}
              discoveredServers={discoveredServers}
              isBusy={isBusy}
              isDiscovering={discoverServers.isPending}
              selectedHost={draft.host}
              onMount={(id) => void mountShare.mutateAsync(id)}
              onRemove={(id) => void removeShare.mutateAsync(id)}
              onSelectServer={(host) => {
                setDraft((current) => ({ ...current, host }));
                setIsAddFormOpen(true);
              }}
              onUnmount={(id) => void unmountShare.mutateAsync(id)}
            />
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                setIsAddFormOpen(true);
              }}
              disabled={isBusy}
              className="absolute bottom-5 right-5 flex size-11 items-center justify-center rounded-full bg-primary/20 text-primary shadow-lg shadow-primary/10 transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Add network share"
              title="Add network share"
            >
              <Plus className="size-5" />
            </button>
          </div>

          {apiError ? (
            <div className="border-t border-glass-border bg-status-red/8 px-5 py-3 text-xs text-status-red">
              {apiError}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AddNetworkShareDialog
        createPending={createShare.isPending}
        discoverSharesPending={discoverShares.isPending}
        discoveredShares={discoveredShares}
        draft={draft}
        isBusy={isBusy}
        isOpen={isOpen && isAddFormOpen}
        onClose={() => setIsAddFormOpen(false)}
        onDiscoverServers={() => void handleDiscoverServers()}
        onDiscoverShares={() => void handleDiscoverShares()}
        onDraftChange={setDraft}
        onSelectShare={(share) => setDraft((current) => ({ ...current, share }))}
        onSubmit={() => void handleAddShare()}
      />
    </>
  );
}
