"use client";

import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  Search,
  SortAsc,
  SortDesc,
  Upload,
  Trash2,
} from "@/components/icons/platform-icons";
import { cn } from "@/lib/utils";
import { FILES_PANEL_SHELL } from "@/modules/files/components/file-manager-surface";
import { type RefObject, useId, useState } from "react";

type ToolbarProps = {
  canNavigateUp: boolean;
  hasWindowBack: boolean;
  currentEntriesCount: number;
  currentPath: string[];
  currentPathForDisplay: string[];
  emptyTrashPending: boolean;
  globalSearch: boolean;
  globalSearchIsFetching: boolean;
  includeHidden: boolean;
  isEmptyingTrash: boolean;
  isStarredView: boolean;
  isTrashView: boolean;
  rootLabel: string;
  searchQuery: string;
  sortBy: "name" | "modified" | "size";
  sortDir: "asc" | "desc";
  uploadFilesPending: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  viewMode: "grid" | "list";
  onCycleSortBy: () => void;
  onEmptyTrash: () => void;
  onNavigateToPath: (path: string[]) => void;
  onNavigateUp: () => void;
  onSearchQueryChange: (value: string) => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  onToggleGlobalSearch: () => void;
  onToggleIncludeHidden: () => void;
  onToggleSortDir: () => void;
  onUploadInputChange: (files: File[]) => void;
};

const iconBtn = "inline-flex size-11 items-center justify-center rounded-lg transition-colors active:bg-foreground/10 md:size-7 handheld:size-[var(--mobile-touch-target)]";
const iconBtnIdle = "text-muted-foreground hover:bg-background/50 hover:text-foreground";

export function FileManagerToolbar({
  canNavigateUp,
  hasWindowBack,
  currentEntriesCount,
  currentPath,
  currentPathForDisplay,
  emptyTrashPending,
  globalSearch,
  globalSearchIsFetching,
  includeHidden,
  isEmptyingTrash,
  isStarredView,
  isTrashView,
  rootLabel,
  searchQuery,
  sortBy,
  sortDir,
  uploadFilesPending,
  uploadInputRef,
  viewMode,
  onCycleSortBy,
  onEmptyTrash,
  onNavigateToPath,
  onNavigateUp,
  onSearchQueryChange,
  onSetViewMode,
  onToggleGlobalSearch,
  onToggleIncludeHidden,
  onToggleSortDir,
  onUploadInputChange,
}: ToolbarProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchId = useId();

  return (
    <div className={cn("flex flex-wrap items-center gap-2 md:flex-nowrap md:overflow-x-auto border-b border-glass-border/60 px-2 py-2 md:px-3 handheld:!px-2 handheld:!flex-wrap handheld:!overflow-x-visible handheld:@lg/mobile-files:!flex-nowrap", FILES_PANEL_SHELL)}>

      {/* Back / up */}
      <button
        onClick={onNavigateUp}
        disabled={!canNavigateUp}
        aria-label="Go up one level"
        className={cn(iconBtn, iconBtnIdle, "disabled:cursor-not-allowed disabled:opacity-30", (!canNavigateUp || hasWindowBack) && "handheld:hidden")}
      >
        <ArrowUp className="size-3.5" />
      </button>

      {/* Breadcrumb */}
      <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="File path">
        <button
          onClick={() => onNavigateToPath([])}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground handheld:min-h-11"
        >
          <HardDrive className="size-4" />
          <span className="md:hidden 2xl:inline handheld:!hidden">{rootLabel}</span>
          <span className="hidden handheld:!inline">
            {rootLabel.includes("/") || rootLabel.includes("\\") ? "Storage" : rootLabel}
          </span>
        </button>
        {currentPath.map((segment, index) => (
          <div key={segment + index} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            <button
              onClick={() => onNavigateToPath(currentPath.slice(0, index + 1))}
              className="max-w-24 truncate rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground sm:max-w-28 md:max-w-32 handheld:min-h-11"
            >
              {currentPathForDisplay[index] ?? segment}
            </button>
          </div>
        ))}
      </nav>

      {/* Upload */}
      {!isTrashView && !isStarredView && (
        <div className="shrink-0">
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploadFilesPending}
            aria-label="Upload files"
            title={uploadFilesPending ? "Upload in progress" : "Upload files"}
            className={cn(iconBtn, iconBtnIdle, "disabled:cursor-not-allowed disabled:opacity-45")}
          >
            {uploadFilesPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              onUploadInputChange(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      )}

      <button
        type="button"
        aria-label={searchExpanded ? "Hide file search" : "Show file search"}
        aria-controls={searchId}
        aria-expanded={searchExpanded}
        onClick={() => setSearchExpanded((expanded) => !expanded)}
        className={cn(iconBtn, "hidden shrink-0 handheld:inline-flex", searchQuery || searchExpanded ? "bg-primary/15 text-[var(--mobile-accent-text)]" : iconBtnIdle)}
      >
        <Search className="size-4" aria-hidden="true" />
      </button>

      {/* Search */}
      <div id={searchId} className={cn("order-first flex w-full items-center gap-1 md:order-none md:w-auto md:shrink-0 handheld:!order-first handheld:!w-full handheld:@lg/mobile-files:!order-none handheld:@lg/mobile-files:!w-[42%] handheld:@lg/mobile-files:max-w-72", !searchExpanded && "handheld:!hidden")}>
        <div className="relative min-w-0 flex-1 md:w-36 md:flex-none handheld:flex-1">
          {globalSearchIsFetching ? (
            <Loader2 className="absolute left-2 top-1/2 size-3 -translate-y-1/2 animate-spin text-primary" />
          ) : (
            <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
          )}
          <input
            type="text"
            aria-label="Search files"
            enterKeyHint="search"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={globalSearch ? "Search everywhere…" : "Search…"}
            className={cn(
              "h-11 w-full rounded-lg border pl-7 pr-2 text-sm md:h-7 md:text-xs handheld:!h-[var(--mobile-touch-target)] handheld:!text-[length:max(16px,1rem)] text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors",
              globalSearch
                ? "border-primary/40 bg-background/60 focus:border-primary/60"
                : "border-glass-border bg-background/55 focus:border-primary/40",
            )}
          />
        </div>
        <button
          onClick={onToggleGlobalSearch}
          aria-label={globalSearch ? "Switch to local search" : "Search everywhere"}
          title={globalSearch ? "Switch to local search" : "Search everywhere"}
          className={cn(
            iconBtn,
            globalSearch ? "bg-primary/15 text-primary hover:bg-primary/20" : iconBtnIdle,
          )}
        >
          <Globe className="size-3.5" />
        </button>
      </div>

      <details className="relative md:hidden handheld:block">
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] px-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors active:bg-foreground/10">Options</summary>
        <div className="absolute right-0 z-50 mt-1 flex w-48 flex-col rounded-xl border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] p-1 shadow-xl">
          <button type="button" onClick={onCycleSortBy} className="min-h-11 rounded-lg px-3 text-left text-sm transition-colors active:bg-foreground/10">Sort by {sortBy}</button>
          <button type="button" onClick={onToggleSortDir} className="min-h-11 rounded-lg px-3 text-left text-sm transition-colors active:bg-foreground/10">{sortDir === "asc" ? "Ascending" : "Descending"}</button>
          <button type="button" onClick={onToggleIncludeHidden} className="min-h-11 rounded-lg px-3 text-left text-sm transition-colors active:bg-foreground/10">{includeHidden ? "Hide hidden files" : "Show hidden files"}</button>
          {isTrashView && <button type="button" aria-label="Permanently remove trashed items" onClick={onEmptyTrash} disabled={isEmptyingTrash || emptyTrashPending || currentEntriesCount === 0} className="min-h-11 rounded-lg px-3 text-left text-sm transition-colors active:bg-foreground/10 text-status-red disabled:opacity-40">Empty Trash</button>}
        </div>
      </details>
      {/* Sort + visibility */}
      <div className="hidden shrink-0 items-center gap-1 md:flex handheld:hidden">
        {isTrashView && (
          <button
            onClick={onEmptyTrash}
            disabled={isEmptyingTrash || emptyTrashPending || currentEntriesCount === 0}
            title="Permanently delete all items in Trash"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-status-red transition-colors hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
            <span className="hidden xl:inline">Empty Trash</span>
          </button>
        )}
        <button
          onClick={onToggleIncludeHidden}
          aria-label={includeHidden ? "Hide hidden files" : "Show hidden files"}
          title={includeHidden ? "Hide hidden files" : "Show hidden files"}
          className={cn(iconBtn, iconBtnIdle)}
        >
          {includeHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          onClick={onCycleSortBy}
          title={`Sort by: ${sortBy} (click to change)`}
          className="rounded-lg px-2 py-1 text-xs capitalize text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
        >
          <span>{sortBy}</span>
        </button>
        <button
          onClick={onToggleSortDir}
          aria-label={sortDir === "asc" ? "Sort descending" : "Sort ascending"}
          title={sortDir === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse"}
          className={cn(iconBtn, iconBtnIdle)}
        >
          {sortDir === "asc" ? <SortAsc className="size-3.5" /> : <SortDesc className="size-3.5" />}
        </button>
      </div>

      {/* View mode toggle */}
      <div className="hidden shrink-0 items-center rounded-lg border border-glass-border/60 bg-background/40 p-0.5 md:flex handheld:hidden">
        <button
          onClick={() => onSetViewMode("grid")}
          aria-label="Grid view"
          className={cn(
            "rounded-md p-1 transition-colors",
            viewMode === "grid" ? "bg-primary/15 text-primary" : iconBtnIdle,
          )}
        >
          <LayoutGrid className="size-3.5" />
        </button>
        <button
          onClick={() => onSetViewMode("list")}
          aria-label="List view"
          className={cn(
            "rounded-md p-1 transition-colors",
            viewMode === "list" ? "bg-primary/15 text-primary" : iconBtnIdle,
          )}
        >
          <List className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
