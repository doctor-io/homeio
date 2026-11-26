"use client";

import { Loader2, Star } from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";
import { buildAssetUrl } from "@/modules/files/hooks/files-api";
import {
  getFileIcon,
  getLargeFileIcon,
  type FileEntry,
} from "@/modules/files/components/file-manager-presenters";
import React, { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const VIRTUAL_BATCH = 100;

function useVirtualLimit(total: number): [number, React.RefObject<HTMLDivElement | null>] {
  const [limit, setLimit] = useState(VIRTUAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLimit(VIRTUAL_BATCH);
  }, [total]);

  useEffect(() => {
    if (limit >= total) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setLimit((prev) => Math.min(prev + VIRTUAL_BATCH, total));
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [limit, total]);

  return [limit, sentinelRef];
}

export function LoadMoreBanner({
  shown,
  total,
  onLoadMore,
}: {
  shown: number;
  total: number;
  onLoadMore: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-center gap-3 py-2">
      <span className="text-xs text-muted-foreground">
        Showing {shown} of {total} results
      </span>
      <button
        onClick={onLoadMore}
        className="rounded-lg bg-background/50 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background/70"
      >
        Load more
      </button>
    </div>
  );
}

function GridThumbnail({ entry }: { entry: FileEntry }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const src = buildAssetUrl(entry.path);

  return (
    <div className="relative size-14">
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
          status === "loaded" ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        {getLargeFileIcon(entry)}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={entry.name}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        className={cn(
          "size-14 rounded-lg object-cover transition-opacity duration-150",
          status === "loaded" ? "opacity-100" : "opacity-0",
        )}
        loading="lazy"
      />
    </div>
  );
}

function entryLocation(path: string) {
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : "/";
}

export function FileGrid({
  entries,
  pendingEntryPath,
  selectedFiles,
  selecting,
  showLocation,
  onEntryClick,
  onEntryContextMenu,
  onToggleSelection,
  onOpenEntry,
}: {
  entries: FileEntry[];
  pendingEntryPath: string | null;
  selectedFiles: Set<string>;
  selecting: boolean;
  showLocation: boolean;
  onEntryClick: (event: MouseEvent, entry: FileEntry) => void;
  onEntryContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onToggleSelection: (entry: FileEntry) => void;
  onOpenEntry: (entry: FileEntry) => void;
}) {
  const [limit, sentinelRef] = useVirtualLimit(entries.length);
  const visible = entries.slice(0, limit);

  return (
    <>
      <div className="grid grid-cols-1 gap-0 md:grid-cols-4 md:gap-3 lg:grid-cols-5 handheld:grid-cols-1 handheld:gap-0 handheld:@lg/mobile-files:grid-cols-2 handheld:@lg/mobile-files:gap-x-3">
        {visible.map((entry) => {
          const isImage = entry.type === "file" && IMAGE_EXTS.has((entry.ext ?? "").toLowerCase());
          const isSelected = selectedFiles.has(entry.path);
          return (
            <div key={entry.path} className="flex min-w-0 items-center border-b border-[var(--mobile-divider)] md:block md:border-0 handheld:flex handheld:border-b">
            <button
              aria-label={showLocation ? `${entry.name}, ${entryLocation(entry.path)}` : entry.name}
              aria-pressed={selecting ? isSelected : undefined}
              title={showLocation ? entry.path : entry.name}
              onClick={(event) => { if (window.matchMedia?.("(width < 48rem), (pointer: coarse) and (hover: none)").matches) { if (selecting) onToggleSelection(entry); else onOpenEntry(entry); } else onEntryClick(event, entry); }}
              onDoubleClick={() => onOpenEntry(entry)}
              onContextMenu={(event) => onEntryContextMenu(event, entry)}
              className={cn(
                "flex min-h-14 min-w-0 flex-1 cursor-pointer flex-row items-center gap-3 rounded-xl border p-2 text-left transition-colors md:w-full md:flex-col md:p-4 handheld:flex-row handheld:p-2",
                isSelected
                  ? "border-primary/30 bg-primary/15"
                  : "border-transparent hover:bg-background/50 active:bg-foreground/10",
              )}
            >
              <div className="relative scale-75 md:scale-100 handheld:scale-75">
                {pendingEntryPath === entry.path ? (
                  <div className="flex size-14 items-center justify-center">
                    <Loader2 className="size-7 animate-spin text-primary" />
                  </div>
                ) : isImage ? (
                  <GridThumbnail entry={entry} />
                ) : (
                  getLargeFileIcon(entry)
                )}
                {entry.starred && pendingEntryPath !== entry.path && (
                  <Star className="absolute -right-1 -top-1 size-3.5 fill-amber-400 text-amber-400" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5 md:w-full md:items-center handheld:items-start">
                <span className="line-clamp-2 break-words text-sm font-medium leading-tight md:break-all handheld:break-words text-foreground md:text-center handheld:text-left">
                  {entry.name}
                </span>
                <span className="max-w-full truncate font-mono text-xs text-muted-foreground md:hidden handheld:block">
                  {showLocation ? entryLocation(entry.path) : [entry.type === "folder" ? "Folder" : entry.size, entry.modified].filter(Boolean).join(" · ")}
                </span>
                {entry.size && <span className="hidden text-2xs text-muted-foreground/60 md:block handheld:hidden">{entry.size}</span>}
              </div>
            </button>
            {selecting ? <span aria-hidden="true" className="px-4 text-primary md:hidden handheld:flex">{isSelected ? "✓" : "○"}</span> : <button type="button" onClick={(event) => onEntryContextMenu(event, entry)} aria-label={`Actions for ${entry.name}`} className="min-h-11 min-w-11 rounded-lg text-xl text-muted-foreground transition-colors hover:bg-foreground/10 active:bg-foreground/15 md:hidden handheld:inline-flex handheld:items-center handheld:justify-center">⋯</button>}
            </div>
          );
        })}
      </div>
      {limit < entries.length && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        </div>
      )}
    </>
  );
}

export function FileList({
  entries,
  showLocation,
  isTrashView,
  pendingEntryPath,
  selectedFiles,
  selecting,
  onEntryClick,
  onEntryContextMenu,
  onToggleSelection,
  onOpenEntry,
}: {
  entries: FileEntry[];
  showLocation: boolean;
  isTrashView: boolean;
  pendingEntryPath: string | null;
  selectedFiles: Set<string>;
  selecting: boolean;
  onEntryClick: (event: MouseEvent, entry: FileEntry) => void;
  onEntryContextMenu: (event: MouseEvent, entry: FileEntry) => void;
  onToggleSelection: (entry: FileEntry) => void;
  onOpenEntry: (entry: FileEntry) => void;
}) {
  const [limit, sentinelRef] = useVirtualLimit(entries.length);
  const visible = entries.slice(0, limit);

  return (
    <div className="flex flex-col">
      <div className="hidden items-center gap-3 border-b md:flex border-glass-border/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
        <span className="min-w-0 flex-1">Name</span>
        {isTrashView && <span className="hidden w-48 text-right lg:block">Original Location</span>}
        {showLocation && <span className="hidden w-48 text-right lg:block">Location</span>}
        <span className="hidden w-20 text-right sm:block">Size</span>
        <span className="hidden w-32 text-right md:block">
          {isTrashView ? "Deleted" : "Modified"}
        </span>
      </div>

      {visible.map((entry) => (
        <div key={entry.path} className="flex items-center border-b border-[var(--mobile-divider)] md:border-0 handheld:border-b">
        <button
          aria-label={showLocation ? `${entry.name}, ${entryLocation(entry.path)}` : entry.name}
          aria-pressed={selecting ? selectedFiles.has(entry.path) : undefined}
          onClick={(event) => { if (window.matchMedia?.("(width < 48rem), (pointer: coarse) and (hover: none)").matches) { if (selecting) onToggleSelection(entry); else onOpenEntry(entry); } else onEntryClick(event, entry); }}
          onDoubleClick={() => onOpenEntry(entry)}
          onContextMenu={(event) => onEntryContextMenu(event, entry)}
          className={cn(
            "flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-foreground/10 md:min-h-0 handheld:min-h-14",
            selectedFiles.has(entry.path) ? "bg-primary/15" : "hover:bg-background/50",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {pendingEntryPath === entry.path ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              getFileIcon(entry)
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{entry.name}</span>
              <span className="block max-w-full truncate font-mono text-xs text-muted-foreground md:hidden handheld:block">
                {showLocation ? entryLocation(entry.path) : [entry.type === "folder" ? "Folder" : entry.size, entry.modified].filter(Boolean).join(" · ")}
              </span>
            </span>
            {entry.starred && pendingEntryPath !== entry.path && (
              <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
            )}
          </div>

          {isTrashView && (
            <span
              className="hidden w-48 shrink-0 truncate text-right text-xs text-muted-foreground/60 lg:block"
              title={entry.trashOriginalPath}
            >
              {entry.trashOriginalPath ?? "—"}
            </span>
          )}

          {showLocation && (
            <span
              className="hidden w-48 shrink-0 truncate text-right text-xs text-muted-foreground/60 lg:block"
              title={entry.path}
            >
              {entryLocation(entry.path)}
            </span>
          )}

          <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground/60 sm:block">
            {entry.type === "folder" ? "—" : (entry.size ?? "0 B")}
          </span>
          <span className="hidden w-32 shrink-0 text-right text-xs text-muted-foreground/60 md:block">
            {isTrashView
              ? entry.trashDeletedAt
                ? new Date(entry.trashDeletedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "—"
              : entry.modified}
          </span>
        </button>
        {selecting ? <span aria-hidden="true" className="px-4 text-primary md:hidden handheld:flex">{selectedFiles.has(entry.path) ? "✓" : "○"}</span> : <button type="button" onClick={(event) => onEntryContextMenu(event, entry)} aria-label={`Actions for ${entry.name}`} className="min-h-11 min-w-11 rounded-lg text-xl text-muted-foreground transition-colors hover:bg-foreground/10 active:bg-foreground/15 md:hidden handheld:inline-flex handheld:items-center handheld:justify-center">⋯</button>}
        </div>
      ))}

      {limit < entries.length && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4">
          <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
}
