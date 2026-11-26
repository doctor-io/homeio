"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { StoreCatalogSource } from "@/lib/shared/contracts/apps";
import { Loader2, RefreshCw, Trash2 } from "@/components/icons/platform-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMemo, useState, type FormEvent } from "react";

type AppStoreSourcesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: StoreCatalogSource[];
  isLoading: boolean;
  error: string | null;
  addPending: boolean;
  pendingSourceId: string | null;
  onAddSource: (input: { url: string; name?: string }) => Promise<void>;
  onToggleSource: (input: {
    sourceId: string;
    enabled: boolean;
  }) => Promise<void>;
  onRefreshSource: (sourceId: string) => Promise<void>;
  onRemoveSource: (sourceId: string) => Promise<void>;
};

function formatSyncLabel(source: StoreCatalogSource) {
  if (source.status === "syncing") return "Syncing...";
  if (source.lastSyncedAt) {
    return `Synced ${new Date(source.lastSyncedAt).toLocaleString()}`;
  }
  return "Not synced yet";
}

export function AppStoreSourcesDialog({
  open,
  onOpenChange,
  sources,
  isLoading,
  error,
  addPending,
  pendingSourceId,
  onAddSource,
  onToggleSource,
  onRefreshSource,
  onRemoveSource,
}: AppStoreSourcesDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sortedSources = useMemo(
    () =>
      [...sources].sort((left, right) => {
        if (left.kind === "official") return -1;
        if (right.kind === "official") return 1;
        return left.name.localeCompare(right.name);
      }),
    [sources],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    try {
      await onAddSource({
        url: url.trim(),
        name: name.trim() || undefined,
      });
      setUrl("");
      setName("");
    } catch (submitFailure) {
      setSubmitError(
        submitFailure instanceof Error
          ? submitFailure.message
          : "Unable to add store source.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobileSheet className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto overscroll-contain border-glass-border bg-card/95 backdrop-blur-xl handheld:@container/store-sources handheld:max-w-[min(42rem,calc(100%-2*var(--mobile-overlay-gutter)))] handheld:gap-3 handheld:border-[var(--mobile-divider)] handheld:bg-[var(--mobile-panel)] handheld:p-4 handheld:[backdrop-filter:none]">
        <DialogHeader className="handheld:pr-10 handheld:text-left">
          <DialogTitle>Store Sources</DialogTitle>
          <DialogDescription>
            Add ZIP-based CasaOS app stores on top of the official catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1.3fr,0.9fr] handheld:gap-3 @lg/store-sources:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            <div className="rounded-2xl border border-glass-border bg-glass/30 p-3 handheld:border-0 handheld:bg-transparent handheld:p-0">
              {error ? (
                <div className="rounded-lg border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">
                  {error}
                </div>
              ) : null}

              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading sources...
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedSources.map((source) => {
                    const isPending = pendingSourceId === source.id;

                    return (
                      <div
                        key={source.id}
                        className="rounded-xl border border-glass-border bg-background/40 p-3"
                      >
                        <div className="flex min-w-0 flex-col items-start justify-between gap-3 md:flex-row">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-foreground">
                                {source.name}
                              </p>
                              <span className="rounded-[var(--radius)] border border-glass-border px-2 py-0.5 text-2xs uppercase tracking-[0.18em] text-muted-foreground">
                                {source.kind}
                              </span>
                              {!source.enabled ? (
                                <span className="rounded-[var(--radius)] border border-glass-border px-2 py-0.5 text-2xs uppercase tracking-[0.18em] text-status-yellow">
                                  disabled
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-all text-xs text-muted-foreground">
                              {source.url}
                            </p>
                            <p className="mt-1 text-2xs text-muted-foreground">
                              {formatSyncLabel(source)}
                            </p>
                            {source.lastError ? (
                              <p className="mt-2 text-xs text-status-red">
                                {source.lastError}
                              </p>
                            ) : null}
                            {source.suppressedAppIds.length > 0 ? (
                              <p className="mt-2 text-xs text-status-yellow">
                                Suppressed conflicts:{" "}
                                {source.suppressedAppIds.join(", ")}
                              </p>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void onToggleSource({
                                  sourceId: source.id,
                                  enabled: !source.enabled,
                                })
                              }
                              disabled={source.kind === "official" || isPending}
                              className="rounded-md border border-glass-border min-h-11 px-2.5 py-1 text-xs md:min-h-0 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
                            >
                              {source.enabled ? "Disable" : "Enable"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void onRefreshSource(source.id)}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-glass-border min-h-11 px-2.5 py-1 text-xs md:min-h-0 text-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`size-3 ${isPending ? "animate-spin" : ""}`}
                              />
                              Refresh
                            </button>
                            {source.kind === "remote" ? (
                              <button
                                type="button"
                                onClick={() => void onRemoveSource(source.id)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-status-red/25 min-h-11 px-2.5 py-1 text-xs md:min-h-0 text-status-red transition-colors hover:bg-status-red/10 disabled:opacity-50"
                              >
                                <Trash2 className="size-3" />
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-glass-border bg-glass/30 p-4">
            <p className="text-sm font-semibold text-foreground">Add Source</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste an HTTPS ZIP URL for a CasaOS-style App Store archive.
              Homeio is fully compatible with CasaOS app stores — browse
              community stores at{" "}
              <a
                href="https://awesome.casaos.io/content/3rd-party-app-stores/list.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:brightness-125"
              >
                awesome.casaos.io
              </a>
              .
            </p>

            <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="store-source-url"
                  >
                    ZIP URL
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex size-3.5 cursor-default items-center justify-center rounded-full border border-glass-border text-2xs text-muted-foreground">
                        ?
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-[18rem] text-xs"
                    >
                      Any CasaOS-compatible app store ZIP works here. Find
                      community stores at{" "}
                      <span className="font-medium text-foreground">
                        awesome.casaos.io/content/3rd-party-app-stores/list.html
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <input
                  id="store-source-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/appstore.zip"
                  className="h-10 w-full rounded-lg border border-glass-border bg-background/40 px-3 text-sm text-foreground outline-none handheld:min-h-[var(--mobile-touch-target)] handheld:text-[length:max(16px,1rem)]"
                  required
                />
              </div>

              <div className="space-y-1">
                <label
                  className="text-xs text-muted-foreground"
                  htmlFor="store-source-name"
                >
                  Name
                </label>
                <input
                  id="store-source-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Optional display name"
                  className="h-10 w-full rounded-lg border border-glass-border bg-background/40 px-3 text-sm text-foreground outline-none handheld:min-h-[var(--mobile-touch-target)] handheld:text-[length:max(16px,1rem)]"
                />
              </div>

              {submitError ? (
                <div className="rounded-lg border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">
                  {submitError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={addPending || !url.trim()}
                className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60 handheld:min-h-[var(--mobile-touch-target)]"
              >
                {addPending ? "Adding Source..." : "Add Source"}
              </button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
