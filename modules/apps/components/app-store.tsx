"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDownRegular, ChevronRightRegular, FilterRegular } from "@fluentui/react-icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  CUSTOM_STORE_SOURCE_ID,
  type StoreAppDetail,
  type StoreAppSummary,
  type StoreCatalogCategory,
  type StoreCatalogSource,
} from "@/lib/shared/contracts/apps";
import { queryKeys } from "@/lib/shared/query-keys";
import { getStoreOperationLabel, isStoreOperationActiveStatus } from "@/lib/shared/store-operations";
import { AppStoreInstallMenu } from "@/modules/apps/components/app-store-install-menu";
import { AppStoreSourcesDialog } from "@/modules/apps/components/app-store-sources-dialog";
import { AppConfiguratorPanel } from "@/modules/apps/components/configurator/app-configurator-panel";
import { UninstallAppDialog } from "@/modules/apps/components/uninstall-app-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstalledApps } from "@/modules/apps/hooks/useInstalledApps";
import type { AppOperationState } from "@/modules/apps/hooks/useStoreActions";
import { useSharedStoreActions } from "@/modules/apps/hooks/StoreActionsContext";
import { useStoreApp } from "@/modules/apps/hooks/useStoreApp";
import { useStoreCatalog } from "@/modules/apps/hooks/useStoreCatalog";
import { useStoreOperation } from "@/modules/apps/hooks/useStoreOperation";
import { useStoreSourceActions, useStoreSources } from "@/modules/apps/hooks/useStoreSources";
import { useMobileWindowPage } from "@/components/ui/mobile-window-page";
import {
  ArrowUpCircle,
  ChevronLeftIcon as ChevronLeft,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wrench,
} from "@/components/icons/platform-icons";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  PANEL_SHELL as STORE_PANEL_SHELL,
  PANEL_INSET as STORE_PANEL_INSET,
  BADGE_SURFACE as STORE_BADGE_SURFACE,
} from "@/lib/ui/surface-tokens";
import { cn } from "@/lib/utils";

const STORE_PAGE_SIZE = 24;
const STORE_SECTION_LIMIT = 8;

function getAppSourceId(app: StoreAppSummary) {
  return app.sourceKind === "custom" ? CUSTOM_STORE_SOURCE_ID : app.sourceId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Prefer the link the operator saved. The automatic one is built from the
 * browser's own location, which is wrong behind a reverse proxy or tunnel.
 */
function resolveStoreDetailUrl(detail: StoreAppDetail) {
  const customUrl = detail.installedConfig?.webUiUrl?.trim() ?? "";
  if (customUrl.length > 0) return customUrl;

  if (!detail.webUiPort) return null;

  const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
  const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `${protocol}//${hostname}:${detail.webUiPort}`;
}

function isOperationBusy(op: AppOperationState | undefined) {
  return Boolean(op && isStoreOperationActiveStatus(op.status));
}

function compareImageTags(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function extractImageTag(image: string | null | undefined): string | null {
  if (!image) return null;
  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  if (lastColon > lastSlash) return image.slice(lastColon + 1) || null;
  return null;
}

function buildUpdateTooltipLines(app: StoreAppSummary): string[] {
  if (!app.updateAvailable) return [];
  const currentTag = extractImageTag(app.installedImage);
  const availableTag = extractImageTag(app.image);
  const catalogIsNewer =
    currentTag !== null && availableTag !== null && compareImageTags(availableTag, currentTag) > 0;
  if (!catalogIsNewer) return [];
  const lines: string[] = [];
  if (app.installedImage) lines.push(`Current image: ${app.installedImage}`);
  if (currentTag) lines.push(`Current tag: ${currentTag}`);
  if (app.image) lines.push(`Available image: ${app.image}`);
  if (availableTag) lines.push(`Available tag: ${availableTag}`);
  return lines;
}

// ── Small reusables ───────────────────────────────────────────────────────────

function StoreLogo({ logoUrl, alt, className }: { logoUrl: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={alt} className={className} onError={() => setFailed(true)} />
    );
  }
  return <Package className={cn(className, "text-muted-foreground/50")} aria-label={alt} />;
}

function AppStatusDot({ app, operation }: { app: StoreAppSummary; operation?: AppOperationState }) {
  if (operation) {
    if (operation.status === "error") return <span className="size-2 rounded-full bg-status-red shrink-0" />;
    if (operation.status === "success") return <span className="size-2 rounded-full bg-status-green shrink-0" />;
    return <span className="size-2 rounded-full bg-primary animate-pulse shrink-0" />;
  }
  if (app.status === "installed") {
    return <span className={cn("size-2 rounded-full shrink-0", app.updateAvailable ? "bg-primary" : "bg-status-green")} />;
  }
  if (app.status === "error") return <span className="size-2 rounded-full bg-status-red shrink-0" />;
  return null;
}

function UpdateInfoTooltip({ app, children }: { app: StoreAppSummary; children: ReactNode }) {
  const lines = buildUpdateTooltipLines(app);
  if (lines.length === 0) return <>{children}</>;
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        className="max-w-[26rem] rounded-[calc(var(--radius)+0.125rem)] border border-glass-border bg-card/96 px-3 py-2 text-left text-2xs leading-5 text-foreground shadow-xl backdrop-blur-xl"
      >
        <div className="space-y-0.5">
          {lines.map((line) => <div key={line}>{line}</div>)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function SourceBadge({ sourceName, sourceKind }: Pick<StoreAppSummary, "sourceName" | "sourceKind">) {
  return (
    <span className={cn(
      "rounded border px-1.5 py-0.5 text-2xs uppercase tracking-[0.14em]",
      sourceKind === "official" ? "border-primary/25 text-primary" :
      sourceKind === "custom" ? "border-status-amber/30 text-status-amber" :
      "border-glass-border text-muted-foreground/70",
    )}>
      {sourceName}
    </span>
  );
}

// ── Catalog sidebar ───────────────────────────────────────────────────────────

function CatalogSidebar({
  id,
  mobileExpanded,
  categories,
  selectedCategory,
  onSelectCategory,
  sources,
  selectedSourceId,
  onSelectSource,
}: {
  id: string;
  mobileExpanded: boolean;
  categories: StoreCatalogCategory[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  sources: StoreCatalogSource[];
  selectedSourceId: string;
  onSelectSource: (sourceId: string) => void;
}) {
  return (
    <aside id={id} className={cn("mx-4 max-[360px]:mx-3 mb-2 flex min-w-0 shrink-0 flex-row gap-2 border-0 bg-transparent px-0 py-0 shadow-none backdrop-blur-none md:m-2 md:w-48 md:flex-col md:gap-0 md:overflow-y-auto md:border md:bg-card/78 md:px-2 md:py-3 md:shadow-sm md:backdrop-blur-xl handheld:!mx-[var(--mobile-gutter)] handheld:!mb-2 handheld:!w-auto handheld:!flex-row handheld:!gap-2 handheld:!overflow-visible handheld:!border-0 handheld:!bg-transparent handheld:!px-0 handheld:!py-0 handheld:!shadow-none handheld:!backdrop-blur-none", STORE_PANEL_SHELL, !mobileExpanded && "handheld:!hidden")}>
      <label className="relative flex min-w-0 flex-1 flex-col gap-1.5 md:mb-3 md:flex-none md:px-3 handheld:!mb-0 handheld:!flex-1 handheld:!px-0">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:font-sans md:text-[10px] md:font-semibold md:tracking-[0.16em] md:text-muted-foreground/50 handheld:!font-mono handheld:!text-[11px] handheld:!font-medium handheld:!tracking-wider handheld:!text-muted-foreground">
          Source
        </span>
        <select
          value={selectedSourceId}
          onChange={(event) => onSelectSource(event.target.value)}
          className="min-h-11 w-full appearance-none rounded-lg border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] pr-8 pl-3 text-base text-foreground focus-visible:outline-primary md:min-h-0 md:appearance-auto md:border-glass-border md:bg-background/55 md:px-2 md:py-1.5 md:text-xs handheld:!min-h-11 handheld:!appearance-none handheld:!border-[var(--mobile-divider)] handheld:!bg-[var(--mobile-panel)] handheld:!pr-8 handheld:!pl-3 handheld:!py-0 handheld:!text-base"
        >
          <option value="">All Sources</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.name}</option>
          ))}
          <option value={CUSTOM_STORE_SOURCE_ID}>Custom</option>
        </select>
        <ChevronDownRegular className="pointer-events-none absolute right-3 bottom-3.5 size-4 text-muted-foreground md:hidden handheld:!block" aria-hidden="true" />
      </label>
      <label className="relative flex min-w-0 flex-1 flex-col gap-1.5 md:hidden handheld:!flex">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Category</span>
        <select
          value={selectedCategory ?? ""}
          onChange={(event) => onSelectCategory(event.target.value || null)}
          className="min-h-11 w-full appearance-none rounded-lg border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] pr-8 pl-3 text-base text-foreground focus-visible:outline-primary"
        >
          <option value="">All Apps</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.name}>
              {cat.name} ({cat.appCount})
            </option>
          ))}
        </select>
        <ChevronDownRegular className="pointer-events-none absolute right-3 bottom-3.5 size-4 text-muted-foreground" aria-hidden="true" />
      </label>
      <div className="mb-1 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50 md:block handheld:!hidden">
        Categories
      </div>
      <div className="hidden flex-col gap-0.5 md:flex handheld:!hidden">
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
            selectedCategory === null ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
          )}
        >
          <span>All Apps</span>
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.name)}
            title={cat.description}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
              selectedCategory === cat.name ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
            )}
          >
            <span className="truncate">{cat.name}</span>
            <span className={cn(STORE_BADGE_SURFACE, "ml-1.5 shrink-0 px-1.5 py-0.5 text-2xs text-muted-foreground")}>
              {selectedSourceId ? (cat.appCountBySource[selectedSourceId] ?? 0) : cat.appCount}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ── Featured strip ────────────────────────────────────────────────────────────

function FeaturedStrip({
  title,
  icon,
  apps,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  apps: StoreAppSummary[];
  onSelect: (id: string) => void;
}) {
  if (apps.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className={cn(STORE_BADGE_SURFACE, "ml-auto px-2 py-0.5 text-2xs text-muted-foreground")}>
          {apps.length}
        </span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {apps.slice(0, STORE_SECTION_LIMIT).map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onSelect(app.id)}
            className={cn(
              STORE_PANEL_INSET,
              "group flex w-48 shrink-0 flex-col gap-2.5 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30",
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn(STORE_PANEL_INSET, "flex size-9 shrink-0 items-center justify-center overflow-hidden")}>
                <StoreLogo logoUrl={app.logoUrl} alt={app.name} className="size-5 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-semibold text-foreground">{app.name}</span>
                  <AppStatusDot app={app} />
                </div>
                {app.webUiPort && (
                  <span className="font-mono text-2xs text-muted-foreground/60">:{app.webUiPort}</span>
                )}
              </div>
            </div>
            <p className="line-clamp-2 text-2xs leading-4 text-muted-foreground/80">{app.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Catalog row ───────────────────────────────────────────────────────────────

function CatalogRow({
  app,
  operation,
  onClick,
}: {
  app: StoreAppSummary;
  operation?: AppOperationState;
  onClick: () => void;
}) {
  const busy = isOperationBusy(operation);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        STORE_PANEL_INSET,
        "group flex min-h-16 w-full items-center gap-3 rounded-none border-x-0 border-t-0 bg-transparent px-0 py-2 text-left transition-colors active:bg-foreground/10 hover:bg-secondary/30 md:rounded-[calc(var(--radius)+0.125rem)] md:border md:bg-background/42 md:p-3 md:hover:border-primary/25 md:hover:bg-background/60 handheld:!rounded-none handheld:!border-x-0 handheld:!border-t-0 handheld:!bg-transparent handheld:!px-3 handheld:!py-2",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}
    >
      {/* Logo */}
      <div className={cn(STORE_PANEL_INSET, "flex size-11 shrink-0 items-center justify-center overflow-hidden")}>
        <StoreLogo logoUrl={app.logoUrl} alt={app.name} className="size-6 object-contain" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{app.name}</span>
          <AppStatusDot app={app} operation={operation} />
          {operation && !["error", "success"].includes(operation.status) && (
            <span className="text-2xs text-muted-foreground">
              {getStoreOperationLabel(operation)}… {operation.progressPercent}%
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">{app.description}</p>

        {operation && !["error", "success"].includes(operation.status) ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(2, operation.progressPercent)}%` }}
            />
          </div>
        ) : (
          <div className="mt-1.5 hidden flex-wrap items-center gap-1 md:flex handheld:!hidden">
            <SourceBadge sourceName={app.sourceName} sourceKind={app.sourceKind} />
            {app.categories.slice(0, 2).map((cat) => (
              <span key={cat} className={cn(STORE_BADGE_SURFACE, "px-1.5 py-0.5 text-2xs text-muted-foreground/70")}>
                {cat}
              </span>
            ))}
            {app.webUiPort && (
              <span className={cn(STORE_BADGE_SURFACE, "px-1.5 py-0.5 font-mono text-2xs text-muted-foreground/70")}>
                :{app.webUiPort}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status label */}
      <div className="shrink-0 text-right">
        {operation?.status === "error" ? (
          <span className="text-2xs font-medium text-status-red">Failed</span>
        ) : operation?.status === "success" ? (
          <span className="text-2xs font-medium text-status-green">Done</span>
        ) : busy ? (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        ) : app.status === "installed" ? (
          <span className={cn("text-2xs font-medium", app.updateAvailable ? "text-primary" : "text-status-green")}>
            {app.updateAvailable ? "Update" : "Installed"}
          </span>
        ) : app.status === "error" ? (
          <span className="text-2xs font-medium text-status-red">Error</span>
        ) : (
          <>
            <span className="text-xs font-semibold text-primary transition-colors group-hover:text-primary/80 handheld:hidden">View</span>
            <ChevronRightRegular className="hidden size-5 text-[var(--mobile-accent-text)] handheld:block" aria-hidden="true" />
          </>
        )}
      </div>
    </button>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailInfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 break-all text-right text-xs font-medium text-foreground md:break-normal">{children}</div>
    </div>
  );
}

function AppStoreDetailPanel({
  withinMobileWindow,
  app,
  detail,
  isLoading,
  operation,
  actionError,
  onBack,
  onInstall,
  onUpdate,
  onRedeploy,
  onUninstall,
  onCustomInstall,
  onRemoveCustom,
  removingCustom,
}: {
  withinMobileWindow: boolean;
  app: StoreAppSummary | null;
  detail: StoreAppDetail | null | undefined;
  isLoading: boolean;
  operation?: AppOperationState;
  actionError: string | null;
  onBack: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onRedeploy: () => void;
  onUninstall: () => void;
  onCustomInstall: () => void;
  onRemoveCustom: () => void;
  removingCustom: boolean;
}) {
  const busy = isOperationBusy(operation);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Nav bar */}
      {!withinMobileWindow && <div className="shrink-0 border-b border-glass-border/60 px-4 py-2.5 handheld:px-[var(--mobile-gutter)] handheld:py-0">
        <button
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80 md:min-h-0 md:text-xs md:text-muted-foreground handheld:min-h-[var(--mobile-touch-target)] handheld:text-[var(--mobile-accent-text)]"
        >
          <ChevronLeft className="size-3.5" />
          Back to Store
        </button>
      </div>}

      {!app || isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !detail ? (
        <div className="flex flex-1 items-center justify-center text-sm text-status-red">
          App details unavailable.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto handheld:overscroll-contain">
          <div className="space-y-5 p-4 md:p-5 handheld:!px-[var(--mobile-gutter)] handheld:!py-3 handheld:space-y-4">

            {/* App header */}
            <div className="flex flex-wrap items-start gap-4 md:flex-nowrap handheld:gap-3">
              {/* Logo */}
              <div className={cn(STORE_PANEL_INSET, "flex size-16 shrink-0 items-center justify-center overflow-hidden handheld:size-12")}>
                <StoreLogo logoUrl={detail.logoUrl} alt={detail.name} className="size-9 object-contain handheld:size-7" />
              </div>

              {/* Name + badges + progress */}
              <div className="min-w-0 flex-1 pt-0.5">
                {!withinMobileWindow && <h2 className="break-words text-base font-semibold text-foreground md:truncate handheld:!whitespace-normal">{detail.name}</h2>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <AppStatusDot app={detail} operation={operation} />
                  {operation ? (
                    <span className="text-xs text-muted-foreground">
                      {getStoreOperationLabel(operation)}… {operation.progressPercent}%
                    </span>
                  ) : app.status === "installed" ? (
                    <span className={cn("text-xs font-medium", app.updateAvailable ? "text-primary" : "text-status-green")}>
                      {app.updateAvailable ? "Update available" : "Installed"}
                    </span>
                  ) : null}
                  <SourceBadge sourceName={detail.sourceName} sourceKind={detail.sourceKind} />
                  {detail.categories.map((cat) => (
                    <span key={cat} className={cn(STORE_BADGE_SURFACE, "px-1.5 py-0.5 text-2xs text-muted-foreground/70 uppercase tracking-[0.13em]")}>
                      {cat}
                    </span>
                  ))}
                </div>
                {operation && !["error", "success"].includes(operation.status) && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(2, operation.progressPercent)}%` }} />
                    </div>
                    {operation.message && <p className="text-2xs text-status-red">{operation.message}</p>}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex w-full shrink-0 flex-row flex-wrap items-stretch gap-1.5 md:w-28 md:flex-col">
                {actionError && <p className="text-center text-2xs leading-tight text-status-red">{actionError}</p>}

                {detail.status === "not_installed" ? (
                  <button
                    onClick={onInstall}
                    disabled={busy}
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download className="size-3.5" /> Install
                  </button>
                ) : detail.updateAvailable ? (
                  <UpdateInfoTooltip app={detail}>
                    <button
                      onClick={onUpdate}
                      disabled={busy}
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ArrowUpCircle className="size-3.5" /> Update
                    </button>
                  </UpdateInfoTooltip>
                ) : resolveStoreDetailUrl(detail) ? (
                  <a
                    href={resolveStoreDetailUrl(detail) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                ) : null}

                <button
                  onClick={onCustomInstall}
                  disabled={busy}
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg border border-glass-border bg-background/55 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Wrench className="size-3.5" /> Custom
                </button>

                {detail.sourceKind === "custom" && detail.status === "not_installed" && (
                  <button
                    onClick={onRemoveCustom}
                    disabled={busy || removingCustom}
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg border border-status-red/30 bg-status-red/8 px-3 py-2 text-xs font-medium text-status-red transition-colors hover:bg-status-red/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" />
                    {removingCustom ? "Removing…" : "Remove"}
                  </button>
                )}

                {detail.status !== "not_installed" && (
                  <button
                    onClick={onUninstall}
                    disabled={busy}
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 md:min-h-0 md:w-full md:flex-none rounded-lg border border-status-red/30 bg-status-red/8 px-3 py-2 text-xs font-medium text-status-red transition-colors hover:bg-status-red/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" /> Uninstall
                  </button>
                )}
              </div>
            </div>

            {/* Description */}
            <div className={cn(STORE_PANEL_INSET, "px-4 py-3 text-xs leading-5 text-muted-foreground")}>
              {detail.note}
            </div>

            {/* Screenshots */}
            {detail.screenshots.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
                  Screenshots
                </p>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {detail.screenshots.slice(0, 4).map((src, i) => (
                    <div
                      key={`${src}-${i}`}
                      className={cn(STORE_PANEL_INSET, "min-w-[min(100%,18rem)] overflow-hidden sm:min-w-[20rem]")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`${detail.name} screenshot ${i + 1}`} className="h-44 w-full object-cover sm:h-48" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className={cn(STORE_PANEL_INSET, "divide-y divide-glass-border/40 px-4")}>
              <DetailInfoRow label="Platform">{detail.platform}</DetailInfoRow>
              {detail.webUiPort && (
                <DetailInfoRow label="Web UI Port">
                  <span className="font-mono">{detail.webUiPort}</span>
                </DetailInfoRow>
              )}
              <DetailInfoRow label="Source">
                <SourceBadge sourceName={detail.sourceName} sourceKind={detail.sourceKind} />
              </DetailInfoRow>
              <DetailInfoRow label="Repository">
                {detail.repositoryUrl.startsWith("http") ? (
                  <a href={detail.repositoryUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                    {detail.repositoryUrl}
                  </a>
                ) : (
                  <span className="break-all">{detail.repositoryUrl}</span>
                )}
              </DetailInfoRow>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ── Main store ────────────────────────────────────────────────────────────────

export function AppStore({
  onOpenCustomInstall,
  launchRequest,
}: {
  onOpenCustomInstall: () => void;
  launchRequest?: { nonce: number; search?: string; appId?: string } | null;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 250);
  const [filter, setFilter] = useState<"all" | "installed">("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customInstallTemplate, setCustomInstallTemplate] = useState<StoreAppDetail | null>(null);
  const [uninstallDialogApp, setUninstallDialogApp] = useState<StoreAppSummary | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstallPending, setUninstallPending] = useState(false);
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(STORE_PAGE_SIZE);
  const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filtersId = useId();

  const queryClient = useQueryClient();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const refreshAttemptedRef = useRef(false);

  const { operationsByApp, installApp, updateApp, redeployApp, uninstallApp } = useSharedStoreActions();
  const storeSourcesQuery = useStoreSources();
  const { addSource, updateSource, refreshSource, removeSource } = useStoreSourceActions();
  const installedAppsQuery = useInstalledApps();

  const catalogQuery = useStoreCatalog({
    category: selectedCategory ?? undefined,
    search: debouncedSearch || undefined,
    installedOnly: filter === "installed",
  });

  const catalog = catalogQuery.data;
  const sources = (catalog?.sources ?? storeSourcesQuery.data ?? []).filter((source) => source.enabled);
  const isSelectedSourceAvailable = selectedSourceId === CUSTOM_STORE_SOURCE_ID ||
    sources.some((source) => source.id === selectedSourceId);
  const sourceFilter = isSelectedSourceAvailable ? selectedSourceId : "";
  const apps = useMemo(
    () => (catalog?.apps ?? []).filter((app) => !sourceFilter || getAppSourceId(app) === sourceFilter),
    [catalog, sourceFilter],
  );
  const categories = catalog?.categories ?? [];
  const appGroups = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; apps: StoreAppSummary[] }>();
    for (const app of apps) {
      const id = getAppSourceId(app);
      const group = groups.get(id);
      if (group) {
        group.apps.push(app);
      } else {
        groups.set(id, { id, name: app.sourceName, apps: [app] });
      }
    }
    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [apps]);
  const largestGroupSize = appGroups.reduce((size, group) => Math.max(size, group.apps.length), 0);
  const hasMoreApps = largestGroupSize > visibleCatalogCount;

  const selectedSummary = useMemo(() => apps.find((a) => a.id === selectedAppId) ?? null, [apps, selectedAppId]);
  const detailQuery = useStoreApp(selectedAppId);
  const selectedDetail = detailQuery.data;
  const backToCatalog = useCallback(() => setSelectedAppId(null), []);
  const backFromMobilePage = useCallback(() => {
    if (customInstallTemplate) setCustomInstallTemplate(null);
    else backToCatalog();
  }, [backToCatalog, customInstallTemplate]);
  const detailTitle = customInstallTemplate
    ? `Install ${customInstallTemplate.name}`
    : selectedAppId ? (selectedDetail?.name ?? selectedSummary?.name ?? "App details") : null;
  const withinMobileWindow = useMobileWindowPage(detailTitle, backFromMobilePage);

  const selectedOperationId = selectedAppId && operationsByApp[selectedAppId] ? operationsByApp[selectedAppId].operationId : null;
  const selectedOperationQuery = useStoreOperation(selectedOperationId);
  const selectedOperation =
    (selectedAppId ? operationsByApp[selectedAppId] : undefined) ??
    (selectedOperationQuery.operation
      ? {
          operationId: selectedOperationQuery.operation.id,
          appId: selectedOperationQuery.operation.appId,
          action: selectedOperationQuery.operation.action,
          status: selectedOperationQuery.operation.status,
          progressPercent: selectedOperationQuery.operation.progressPercent,
          step: selectedOperationQuery.operation.currentStep,
          message: selectedOperationQuery.operation.errorMessage,
        }
      : undefined);

  const installedCount = installedAppsQuery.data?.length ?? 0;
  const appById = useMemo(() => new Map(apps.map((a) => [a.id, a])), [apps]);
  const featuredApps = useMemo(
    () => (catalog?.featuredAppIds ?? []).map((id) => appById.get(id)).filter(Boolean) as StoreAppSummary[],
    [appById, catalog?.featuredAppIds],
  );
  const recommendedApps = useMemo(
    () => (catalog?.recommendedAppIds ?? []).map((id) => appById.get(id)).filter(Boolean) as StoreAppSummary[],
    [appById, catalog?.recommendedAppIds],
  );
  const shouldShowStrips = filter === "all" && !search.trim() && !selectedCategory && !sourceFilter;

  useEffect(() => {
    if (!launchRequest) return;
    setFilter("all");
    setSelectedCategory(null);
    setSelectedSourceId("");
    setActionError(null);
    setSearch(launchRequest.search ?? "");
    setSelectedAppId(launchRequest.appId ?? null);
  }, [launchRequest]);

  useEffect(() => {
    if (refreshAttemptedRef.current) return;
    refreshAttemptedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/store/check-updates", { method: "POST", cache: "no-store" });
        if (!res.ok || cancelled) return;
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog }),
          queryClient.invalidateQueries({ queryKey: queryKeys.installedApps }),
        ]);
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [queryClient]);

  useEffect(() => { setVisibleCatalogCount(STORE_PAGE_SIZE); }, [debouncedSearch, filter, selectedCategory, sourceFilter]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMoreApps || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCatalogCount((c) => Math.min(c + STORE_PAGE_SIZE, largestGroupSize));
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreApps, largestGroupSize]);

  async function startInstall(app: StoreAppSummary) {
    setActionError(null);
    try {
      await installApp({ appId: app.id, webUiPort: app.webUiPort ?? undefined });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to start install.");
    }
  }

  async function startUpdate(app: StoreAppSummary) {
    setActionError(null);
    try {
      await updateApp({ appId: app.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to start update.");
    }
  }

  const [removingCustom, setRemovingCustom] = useState(false);

  async function removeCustomApp() {
    if (!selectedSummary) return;
    setActionError(null);
    setRemovingCustom(true);

    try {
      const response = await fetch(
        `/api/v1/store/custom-apps/${encodeURIComponent(selectedSummary.id)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Failed to remove the custom app (${response.status})`);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.storeCatalog }),
        queryClient.invalidateQueries({ queryKey: queryKeys.installedApps }),
      ]);
      setSelectedAppId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to remove the custom app");
    } finally {
      setRemovingCustom(false);
    }
  }

  async function submitDetailAction(action: "install" | "update" | "redeploy" | "uninstall") {
    if (!selectedSummary || !selectedDetail) return;
    setActionError(null);
    try {
      if (action === "uninstall") { setUninstallDialogApp(selectedSummary); return; }
      if (action === "install") { await installApp({ appId: selectedSummary.id, webUiPort: selectedSummary.webUiPort ?? undefined }); return; }
      if (action === "update") { await updateApp({ appId: selectedSummary.id }); return; }
      await redeployApp({ appId: selectedSummary.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  async function confirmUninstall(input: { deleteData: boolean }) {
    if (!uninstallDialogApp) return;
    setUninstallError(null);
    setUninstallPending(true);
    try {
      await uninstallApp({ appId: uninstallDialogApp.id, removeVolumes: input.deleteData });
      setUninstallDialogApp(null);
    } catch (err) {
      setUninstallError(err instanceof Error ? err.message : "Unable to start uninstall.");
    } finally {
      setUninstallPending(false);
    }
  }

  const uninstallDialog = (
    <UninstallAppDialog
      open={Boolean(uninstallDialogApp)}
      appName={uninstallDialogApp?.name ?? null}
      isSubmitting={uninstallPending}
      error={uninstallError}
      onOpenChange={(open) => { if (!open) { setUninstallDialogApp(null); setUninstallError(null); } }}
      onConfirm={confirmUninstall}
    />
  );

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selectedAppId) {
    return (
      <div className="relative h-full">
        <div className="h-full" inert={customInstallTemplate ? true : undefined}>
        <AppStoreDetailPanel
          withinMobileWindow={withinMobileWindow}
          app={selectedSummary}
          detail={selectedDetail}
          isLoading={detailQuery.isLoading}
          operation={selectedOperation}
          actionError={actionError}
          onBack={backToCatalog}
          onInstall={() => void submitDetailAction("install")}
          onUpdate={() => void submitDetailAction("update")}
          onRedeploy={() => void submitDetailAction("redeploy")}
          onUninstall={() => void submitDetailAction("uninstall")}
          onCustomInstall={() => { if (selectedDetail) setCustomInstallTemplate(selectedDetail); }}
          onRemoveCustom={() => void removeCustomApp()}
          removingCustom={removingCustom}
        />
        </div>
        {customInstallTemplate && (
          <div className={cn("absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm", withinMobileWindow && "p-0")}>
            <div className={cn("relative h-[min(85dvh,900px)] w-full overflow-hidden md:h-[50vh] md:w-[min(96vw,980px)]", STORE_PANEL_SHELL, withinMobileWindow && "h-full w-full rounded-none border-0 md:h-full md:w-full")}>
              <AppConfiguratorPanel
                context="catalog_install"
                withinMobileWindow={withinMobileWindow}
                template={customInstallTemplate}
                actions={{ installApp }}
                onClose={() => setCustomInstallTemplate(null)}
              />
            </div>
          </div>
        )}
        {uninstallDialog}
      </div>
    );
  }

  // ── Catalog view ─────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto md:overflow-visible handheld:@container/mobile-store handheld:!overflow-y-auto handheld:overscroll-contain">
      {/* Header */}
      <div className={cn("relative z-10 mx-4 max-[360px]:mx-3 mb-2 mt-3 flex shrink-0 flex-wrap items-center gap-2 border-0 bg-transparent px-0 py-0 shadow-none backdrop-blur-none md:m-2 md:flex-nowrap md:gap-3 md:border md:bg-card/78 md:px-4 md:py-2.5 md:shadow-sm md:backdrop-blur-xl handheld:!mx-[var(--mobile-gutter)] handheld:!mb-2 handheld:!mt-3 handheld:!flex-wrap handheld:@xl/mobile-store:!flex-nowrap handheld:!border-0 handheld:!bg-transparent handheld:!px-0 handheld:!py-0 handheld:!shadow-none handheld:!backdrop-blur-none", STORE_PANEL_SHELL)}>
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5">
          {(["all", "installed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "min-h-11 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors active:bg-foreground/10 md:min-h-0 handheld:!min-h-11",
                filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {f === "all" ? "All Apps" : `Installed (${installedCount})`}
            </button>
          ))}
        </div>

        <div className="flex-1 handheld:@xl/mobile-store:hidden" />

        <AppStoreInstallMenu
          onInstallCustomClick={onOpenCustomInstall}
          onManageSourcesClick={() => setIsSourcesDialogOpen(true)}
        />

        {/* Search */}
        <div className="order-first flex w-full items-center gap-2 md:order-none md:w-52 handheld:!order-first handheld:!w-full handheld:@xl/mobile-store:!order-none handheld:@xl/mobile-store:!w-auto handheld:@xl/mobile-store:min-w-0 handheld:@xl/mobile-store:flex-1">
          <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
            enterKeyHint="search"
            className="min-h-11 w-full rounded-lg border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] md:border-glass-border md:bg-background/55 handheld:!border-[var(--mobile-divider)] handheld:!bg-[var(--mobile-panel)] pl-8 pr-3 md:min-h-0 text-base md:text-xs handheld:!min-h-[var(--mobile-touch-target)] handheld:!text-[length:max(16px,1rem)] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          </div>
          <button type="button" aria-controls={filtersId} aria-expanded={filtersExpanded} onClick={() => setFiltersExpanded((current) => !current)} className="hidden min-h-[var(--mobile-touch-target)] min-w-[var(--mobile-touch-target)] shrink-0 items-center gap-1.5 rounded-lg border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] px-2.5 text-xs font-medium active:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary handheld:inline-flex">
            <FilterRegular aria-hidden="true" className="size-4" />
            Filters
            {selectedCategory && <span className="rounded-full bg-primary/15 px-1.5 text-[var(--mobile-accent-text)]" aria-label="active filter">1</span>}
          </button>
        </div>
      </div>

      {uninstallDialog}
      <AppStoreSourcesDialog
        open={isSourcesDialogOpen}
        onOpenChange={setIsSourcesDialogOpen}
        sources={storeSourcesQuery.data ?? catalog?.sources ?? []}
        isLoading={storeSourcesQuery.isLoading}
        error={storeSourcesQuery.error instanceof Error ? storeSourcesQuery.error.message : null}
        addPending={addSource.isPending}
        pendingSourceId={
          (refreshSource.isPending ? (refreshSource.variables as string | undefined) : undefined) ??
          (updateSource.isPending ? (updateSource.variables as { sourceId: string } | undefined)?.sourceId : undefined) ??
          (removeSource.isPending ? (removeSource.variables as string | undefined) : undefined) ??
          null
        }
        onAddSource={async (input) => { await addSource.mutateAsync(input); }}
        onToggleSource={async (input) => { await updateSource.mutateAsync({ sourceId: input.sourceId, payload: { enabled: input.enabled } }); }}
        onRefreshSource={async (sourceId) => { await refreshSource.mutateAsync(sourceId); }}
        onRemoveSource={async (sourceId) => { await removeSource.mutateAsync(sourceId); }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row md:overflow-hidden handheld:!flex-none handheld:!flex-col handheld:!overflow-visible">
        <CatalogSidebar
          id={filtersId}
          mobileExpanded={filtersExpanded}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          sources={sources}
          selectedSourceId={sourceFilter}
          onSelectSource={setSelectedSourceId}
        />

        <div className={cn("mx-4 max-[360px]:mx-3 min-h-0 min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none backdrop-blur-none md:m-2 md:mt-2 md:overflow-y-auto md:border md:bg-card/78 md:p-4 md:shadow-sm md:backdrop-blur-xl handheld:!mx-[var(--mobile-gutter)] handheld:!mt-0 handheld:!overflow-visible handheld:!border-0 handheld:!bg-transparent handheld:!p-0 handheld:!shadow-none handheld:!backdrop-blur-none", STORE_PANEL_SHELL)}>
          {actionError && (
            <div className="mb-3 rounded-lg border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">
              {actionError}
            </div>
          )}

          {catalogQuery.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading catalog…
            </div>
          ) : catalogQuery.isError ? (
            <div className="flex h-full items-center justify-center text-sm text-status-red">
              Unable to load app catalog.
            </div>
          ) : apps.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Search className="size-8 opacity-30" />
              <span className="text-sm">No apps found</span>
            </div>
          ) : (
            <div className="space-y-3 md:space-y-6">
              {/* Featured + Recommended strips */}
              {shouldShowStrips && (
                <div className="hidden space-y-6 md:block handheld:!hidden">
                  <FeaturedStrip
                    title="Featured"
                    icon={<Star className="size-4 text-primary" />}
                    apps={featuredApps}
                    onSelect={setSelectedAppId}
                  />
                  <FeaturedStrip
                    title="Recommended"
                    icon={<Sparkles className="size-4 text-primary" />}
                    apps={recommendedApps}
                    onSelect={setSelectedAppId}
                  />
                </div>
              )}

              {/* Catalog list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="handheld:flex handheld:w-full handheld:items-baseline handheld:justify-between handheld:gap-2">
                    <h2 className="text-sm font-semibold text-foreground">
                      {selectedCategory ?? (filter === "installed" ? "Installed Apps" : "Catalog")}
                    </h2>
                    <p className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs text-muted-foreground md:font-sans handheld:!font-mono handheld:text-right">{apps.length} apps</p>
                  </div>
                </div>

                {appGroups.map((group) => (
                  <section key={group.id} aria-label={group.name} className="space-y-2 pt-2">
                    {appGroups.length > 1 && (
                      <h3 className="text-xs font-semibold text-muted-foreground">{group.name}</h3>
                    )}
                    <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2 handheld:mobile-list-group handheld:grid-cols-1 handheld:gap-0 handheld:@xl/mobile-store:grid-cols-2">
                      {group.apps.slice(0, visibleCatalogCount).map((app) => (
                        <CatalogRow
                          key={app.id}
                          app={app}
                          operation={operationsByApp[app.id]}
                          onClick={() => setSelectedAppId(app.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {hasMoreApps && (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => setVisibleCatalogCount((c) => Math.min(c + STORE_PAGE_SIZE, largestGroupSize))}
                      className="rounded-lg border border-glass-border bg-background/55 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground"
                    >
                      Load more apps
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
