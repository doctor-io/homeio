"use client";

import {
  ArrowUp,
  ChevronRight,
  Globe,
  HardDrive,
  LayoutGrid,
  List,
  Loader2,
  PanelLeftIcon,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "@/components/icons/platform-icons";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { FILES_PANEL_SHELL } from "@/modules/files/components/file-manager-surface";
import type { RefObject } from "react";

type SortBy = "name" | "modified" | "size";

type ToolbarProps = {
  /** Narrow panels hide the places list, so the toolbar carries the way to it. */
  onOpenSidebar?: () => void;
  canNavigateUp: boolean;
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
  sortBy: SortBy;
  sortDir: "asc" | "desc";
  uploadFilesPending: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
  viewMode: "grid" | "list";
  onEmptyTrash: () => void;
  onNavigateToPath: (path: string[]) => void;
  onNavigateUp: () => void;
  onSearchQueryChange: (value: string) => void;
  onSetSortBy: (by: SortBy) => void;
  onSetViewMode: (mode: "grid" | "list") => void;
  onToggleGlobalSearch: () => void;
  onToggleIncludeHidden: () => void;
  onToggleSortDir: () => void;
  onUploadInputChange: (files: File[]) => void;
};

const iconBtn = "inline-flex size-7 items-center justify-center rounded-lg transition-colors";
const iconBtnIdle = "text-muted-foreground hover:bg-background/50 hover:text-foreground";

const SORT_LABELS: Record<SortBy, string> = {
  name: "Name",
  modified: "Date modified",
  size: "Size",
};

export function FileManagerToolbar({
  onOpenSidebar,
  canNavigateUp,
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
  onEmptyTrash,
  onNavigateToPath,
  onNavigateUp,
  onSearchQueryChange,
  onSetSortBy,
  onSetViewMode,
  onToggleGlobalSearch,
  onToggleIncludeHidden,
  onToggleSortDir,
  onUploadInputChange,
}: ToolbarProps) {
  return (
    <div className={cn("flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-glass-border/60 px-3 py-2", FILES_PANEL_SHELL)}>

      {/* Only while the places list is hidden — see @container/files. */}
      <button
        onClick={onOpenSidebar}
        aria-label="Show places"
        title="Show places"
        className={cn(iconBtn, iconBtnIdle, "shrink-0 @2xl/files:hidden")}
      >
        <PanelLeftIcon className="size-3.5" />
      </button>

      {/* Back / up */}
      <button
        onClick={onNavigateUp}
        disabled={!canNavigateUp}
        aria-label="Go up one level"
        className={cn(iconBtn, iconBtnIdle, "disabled:cursor-not-allowed disabled:opacity-30")}
      >
        <ArrowUp className="size-3.5" />
      </button>

      {/* Breadcrumb */}
      <nav className="flex min-w-0 flex-1 items-center gap-0.5" aria-label="File path">
        <button
          onClick={() => onNavigateToPath([])}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground"
        >
          <HardDrive className="size-4" />
          <span className="hidden 2xl:inline">{rootLabel}</span>
        </button>
        {currentPath.map((segment, index) => (
          <div key={segment + index} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            <button
              onClick={() => onNavigateToPath(currentPath.slice(0, index + 1))}
              className="max-w-24 truncate rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground sm:max-w-28 md:max-w-32"
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

      {/* Search — the scope toggle lives inside the field so it reads as one control */}
      <div className="relative w-40 min-w-0 shrink">
        {globalSearchIsFetching ? (
          <Loader2 className="absolute left-2 top-1/2 size-3 -translate-y-1/2 animate-spin text-primary" />
        ) : (
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
        )}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={globalSearch ? "Search everywhere…" : "Search…"}
          className={cn(
            "h-7 w-full rounded-lg border pl-7 pr-8 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none transition-all",
            globalSearch
              ? "border-primary/40 bg-background/60 focus:border-primary/60"
              : "border-glass-border bg-background/55 focus:border-primary/40",
          )}
        />
        <button
          onClick={onToggleGlobalSearch}
          aria-label={globalSearch ? "Switch to local search" : "Search everywhere"}
          aria-pressed={globalSearch}
          title={globalSearch ? "Switch to local search" : "Search everywhere"}
          className={cn(
            "absolute right-1 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md transition-colors",
            globalSearch
              ? "bg-primary/15 text-primary hover:bg-primary/20"
              : "text-muted-foreground/60 hover:bg-background/60 hover:text-foreground",
          )}
        >
          <Globe className="size-3" />
        </button>
      </div>

      {/* View options — sorting, hidden files and the rare destructive action */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="View options"
            title="View options"
            className={cn(iconBtn, iconBtnIdle, "shrink-0 data-[state=open]:bg-background/50 data-[state=open]:text-foreground")}
          >
            <Settings2 className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortBy}
            onValueChange={(value) => onSetSortBy(value as SortBy)}
          >
            {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {SORT_LABELS[key]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={sortDir === "desc"}
            onCheckedChange={onToggleSortDir}
          >
            Descending order
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={includeHidden}
            onCheckedChange={onToggleIncludeHidden}
          >
            Show hidden files
          </DropdownMenuCheckboxItem>

          {isTrashView && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={isEmptyingTrash || emptyTrashPending || currentEntriesCount === 0}
                onSelect={onEmptyTrash}
              >
                <Trash2 className="size-3.5" />
                Empty Trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* View mode toggle */}
      <div className="flex shrink-0 items-center rounded-lg border border-glass-border/60 bg-background/40 p-0.5">
        <button
          onClick={() => onSetViewMode("grid")}
          aria-label="Grid view"
          aria-pressed={viewMode === "grid"}
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
          aria-pressed={viewMode === "list"}
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
