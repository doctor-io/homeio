"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { StoreAppDetail, StoreAppSummary } from "@/lib/shared/contracts/apps";
import { queryKeys } from "@/lib/shared/query-keys";
import { getStoreOperationLabel, isStoreOperationActiveStatus } from "@/lib/shared/store-operations";
import { AppStoreInstallMenu } from "@/modules/apps/components/app-store-install-menu";
import { CustomAppSourceActions } from "@/modules/apps/components/custom-app-source-actions";
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
import {
  ArrowUpCircle,
  ChevronLeftIcon as ChevronLeft,
  ChevronRight,
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  PANEL_SHELL as STORE_PANEL_SHELL,
  PANEL_INSET as STORE_PANEL_INSET,
  BADGE_SURFACE as STORE_BADGE_SURFACE,
} from "@/lib/ui/surface-tokens";
import { cn } from "@/lib/utils";

const STORE_ROW_ACTION =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-2xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const STORE_ROW_ACTION_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-background/50 px-2.5 py-1.5 text-2xs font-medium text-foreground transition-colors hover:border-primary/30 hover:text-primary";

const STORE_PAGE_SIZE = 24;
const STORE_SECTION_LIMIT = 8;

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

// ── Category filter ───────────────────────────────────────────────────────────

type CatalogCategory = { id: string; name: string; description: string; appCount: number };

/**
 * Categories are a filter, not a place, so they read better as a row of pills
 * than as a permanent column competing with the catalog for the eye.
 *
 * The first pill is "All" rather than "All Apps": the toolbar already has an
 * "All Apps" tab that filters by install state, and two controls with the same
 * label meaning different things is worse than a shorter word.
 *
 * Per-category counts are dropped here — the catalog header reports the count
 * for whatever is selected, so the number is one selection away instead of
 * repeated a dozen times across the row.
 */
function CategoryPills({
  categories,
  selectedCategory,
  onSelect,
}: {
  categories: CatalogCategory[];
  selectedCategory: string | null;
  onSelect: (category: string | null) => void;
}) {
  const pill =
    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
  const idle =
    "border-glass-border bg-background/40 text-muted-foreground hover:text-foreground hover:border-primary/25";
  const active = "border-primary/30 bg-primary/15 text-primary";

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-1 pt-3"
      role="group"
      aria-label="Filter by category"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selectedCategory === null}
        className={cn(pill, selectedCategory === null ? active : idle)}
      >
        All
      </button>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => onSelect(cat.name)}
          title={cat.description}
          aria-pressed={selectedCategory === cat.name}
          className={cn(pill, selectedCategory === cat.name ? active : idle)}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}

// ── Featured strip ────────────────────────────────────────────────────────────

/**
 * The storefront's largest scale. Everything else — the recommended strip, the
 * catalog rows — is small and uniform, so nothing drew the eye; Umbrel opens on
 * banners that take a third of the screen and homeio opened on nothing.
 *
 * Paged with CSS scroll snapping rather than a carousel library: embla is a
 * dependency here but unused, and paging a scroll container is something the
 * platform already does well. Reach for embla if drag physics are ever wanted.
 *
 * Apps without a screenshot fall back to a tinted panel rather than a broken
 * image: the CasaOS catalog does not guarantee artwork.
 */
function FeaturedHero({
  title,
  icon,
  apps,
  operationsByApp,
  onSelect,
  onInstall,
  onUpdate,
}: {
  title: string;
  icon: ReactNode;
  apps: StoreAppSummary[];
  operationsByApp: Record<string, AppOperationState>;
  onSelect: (id: string) => void;
  onInstall: (app: StoreAppSummary) => void;
  onUpdate: (app: StoreAppSummary) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const update = () => {
      setCanPrev(el.scrollLeft > 4);
      setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [apps.length]);

  function page(direction: 1 | -1) {
    const el = trackRef.current;
    // jsdom has no scrollBy; nothing to page in a test either.
    el?.scrollBy?.({ left: direction * el.clientWidth, behavior: "smooth" });
  }

  if (apps.length === 0) return null;

  const arrow =
    "inline-flex size-6 items-center justify-center rounded-full border border-glass-border bg-background/60 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <section className="space-y-2" aria-label={`${title} apps`}>
      <div className="flex items-center gap-2 px-0.5">
        {icon}
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => page(-1)}
            disabled={!canPrev}
            aria-label={`Previous ${title.toLowerCase()} apps`}
            className={arrow}
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => page(1)}
            disabled={!canNext}
            aria-label={`More ${title.toLowerCase()} apps`}
            className={arrow}
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth"
      >
        {apps.map((app) => (
          <div
            key={app.id}
            className="group relative h-44 min-w-full shrink-0 snap-start overflow-hidden rounded-xl border border-glass-border md:min-w-[calc(50%-0.375rem)]"
          >
            {app.heroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={app.heroImageUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-background/50 to-background/85" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />

            <button
              type="button"
              onClick={() => onSelect(app.id)}
              aria-label={`View details for ${app.name}`}
              className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
              <div className={cn(STORE_PANEL_INSET, "flex size-11 shrink-0 items-center justify-center overflow-hidden bg-black/40")}>
                <StoreLogo logoUrl={app.logoUrl} alt={app.name} className="size-6 object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{app.name}</span>
                  <AppStatusDot app={app} operation={operationsByApp[app.id]} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-white/70">{app.description}</p>
              </div>
              <div className="pointer-events-auto shrink-0">
                <CatalogRowAction
                  app={app}
                  operation={operationsByApp[app.id]}
                  onInstall={() => onInstall(app)}
                  onUpdate={() => onUpdate(app)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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

function CatalogRowAction({
  app,
  operation,
  onInstall,
  onUpdate,
}: {
  app: StoreAppSummary;
  operation?: AppOperationState;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const busy = isOperationBusy(operation);

  if (operation?.status === "error") {
    return <span className="text-2xs font-medium text-status-red">Failed</span>;
  }
  if (operation?.status === "success") {
    return <span className="text-2xs font-medium text-status-green">Done</span>;
  }
  if (operation && busy) {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        {getStoreOperationLabel(operation)}…
      </span>
    );
  }

  if (app.status === "installed") {
    if (app.updateAvailable) {
      return (
        <UpdateInfoTooltip app={app}>
          <button type="button" onClick={onUpdate} className={STORE_ROW_ACTION}>
            <ArrowUpCircle className="size-3.5" /> Update
          </button>
        </UpdateInfoTooltip>
      );
    }
    if (app.webUiPort) {
      return (
        <a
          href={`http://${typeof window !== "undefined" ? window.location.hostname : "localhost"}:${app.webUiPort}`}
          target="_blank"
          rel="noreferrer"
          className={STORE_ROW_ACTION_SECONDARY}
        >
          <ExternalLink className="size-3.5" /> Open
        </a>
      );
    }
    return <span className="text-2xs font-medium text-status-green">Installed</span>;
  }

  if (app.status === "error") {
    return <span className="text-2xs font-medium text-status-red">Error</span>;
  }

  return (
    <button type="button" onClick={onInstall} className={STORE_ROW_ACTION}>
      <Download className="size-3.5" /> Install
    </button>
  );
}

function CatalogRow({
  app,
  operation,
  onClick,
  onInstall,
  onUpdate,
}: {
  app: StoreAppSummary;
  operation?: AppOperationState;
  onClick: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  return (
    <div
      className={cn(
        STORE_PANEL_INSET,
        "group flex w-full items-center gap-3 p-3 text-left transition-all hover:border-primary/25 hover:bg-background/60 focus-within:border-primary/25",
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "72px" }}
    >
      {/* Everything left of the action opens the detail page. It is a sibling of
          the action button rather than its parent — nesting them would be
          invalid markup and would swallow the primary click. */}
      <button
        type="button"
        onClick={onClick}
        aria-label={`View details for ${app.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
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
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">{app.description}</p>

          {/* Categories and the web UI port are filter and detail material, not
              scanning material — the detail panel carries both. The source is
              worth flagging only when it is not the official catalog. */}
          {operation && !["error", "success"].includes(operation.status) ? (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.max(2, operation.progressPercent)}%` }}
              />
            </div>
          ) : app.sourceKind !== "official" ? (
            <div className="mt-1.5 flex items-center">
              <SourceBadge sourceName={app.sourceName} sourceKind={app.sourceKind} />
            </div>
          ) : null}
        </div>
      </button>

      {/* Primary action, on the row itself */}
      <div className="flex shrink-0 items-center justify-end text-right">
        <CatalogRowAction
          app={app}
          operation={operation}
          onInstall={onInstall}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailInfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs font-medium text-foreground">{children}</div>
    </div>
  );
}

function AppStoreDetailPanel({
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
}: {
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
}) {
  const busy = isOperationBusy(operation);

  return (
    <div className="flex h-full flex-col">
      {/* Nav bar */}
      <div className="shrink-0 border-b border-glass-border/60 px-4 py-2.5">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          Back to Store
        </button>
      </div>

      {!app || isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : !detail ? (
        <div className="flex flex-1 items-center justify-center text-sm text-status-red">
          App details unavailable.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-5 p-5">

            {/* App header */}
            <div className="flex items-start gap-4">
              {/* Logo */}
              <div className={cn(STORE_PANEL_INSET, "flex size-16 shrink-0 items-center justify-center overflow-hidden")}>
                <StoreLogo logoUrl={detail.logoUrl} alt={detail.name} className="size-9 object-contain" />
              </div>

              {/* Name + badges + progress */}
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 className="truncate text-base font-semibold text-foreground">{detail.name}</h2>
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
              <div className="flex shrink-0 flex-col items-stretch gap-1.5 w-28">
                {actionError && <p className="text-center text-2xs leading-tight text-status-red">{actionError}</p>}

                {detail.status === "not_installed" ? (
                  <button
                    onClick={onInstall}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download className="size-3.5" /> Install
                  </button>
                ) : detail.updateAvailable ? (
                  <UpdateInfoTooltip app={detail}>
                    <button
                      onClick={onUpdate}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ArrowUpCircle className="size-3.5" /> Update
                    </button>
                  </UpdateInfoTooltip>
                ) : resolveStoreDetailUrl(detail) ? (
                  <a
                    href={resolveStoreDetailUrl(detail) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-all hover:brightness-110"
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                ) : null}

                <button
                  onClick={onCustomInstall}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-glass-border bg-background/55 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Wrench className="size-3.5" /> Custom
                </button>

                {detail.sourceKind === "custom" && (
                  <CustomAppSourceActions appId={detail.id} disabled={busy} />
                )}

                {detail.status !== "not_installed" && (
                  <button
                    onClick={onUninstall}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-status-red/30 bg-status-red/8 px-3 py-2 text-xs font-medium text-status-red transition-colors hover:bg-status-red/15 disabled:cursor-not-allowed disabled:opacity-60"
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
                <p className="text-3xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
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
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customInstallTemplate, setCustomInstallTemplate] = useState<StoreAppDetail | null>(null);
  const [uninstallDialogApp, setUninstallDialogApp] = useState<StoreAppSummary | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstallPending, setUninstallPending] = useState(false);
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(STORE_PAGE_SIZE);
  const [isSourcesDialogOpen, setIsSourcesDialogOpen] = useState(false);

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
  const apps = useMemo(() => catalog?.apps ?? [], [catalog]);
  const categories = catalog?.categories ?? [];
  const visibleApps = useMemo(() => apps.slice(0, visibleCatalogCount), [apps, visibleCatalogCount]);
  const hasMoreApps = visibleApps.length < apps.length;

  const selectedSummary = useMemo(() => apps.find((a) => a.id === selectedAppId) ?? null, [apps, selectedAppId]);
  const detailQuery = useStoreApp(selectedAppId);
  const selectedDetail = detailQuery.data;

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
  const shouldShowStrips = filter === "all" && !search.trim() && !selectedCategory;

  useEffect(() => {
    if (!launchRequest) return;
    setFilter("all");
    setSelectedCategory(null);
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

  useEffect(() => { setVisibleCatalogCount(STORE_PAGE_SIZE); }, [debouncedSearch, filter, selectedCategory]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !hasMoreApps || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCatalogCount((c) => Math.min(c + STORE_PAGE_SIZE, apps.length));
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [apps.length, hasMoreApps]);

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
        <AppStoreDetailPanel
          app={selectedSummary}
          detail={selectedDetail}
          isLoading={detailQuery.isLoading}
          operation={selectedOperation}
          actionError={actionError}
          onBack={() => setSelectedAppId(null)}
          onInstall={() => void submitDetailAction("install")}
          onUpdate={() => void submitDetailAction("update")}
          onRedeploy={() => void submitDetailAction("redeploy")}
          onUninstall={() => void submitDetailAction("uninstall")}
          onCustomInstall={() => { if (selectedDetail) setCustomInstallTemplate(selectedDetail); }}
        />
        {customInstallTemplate && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
            <div className={cn("relative h-[50vh] w-[min(96vw,980px)] overflow-hidden", STORE_PANEL_SHELL)}>
              <AppConfiguratorPanel
                context="catalog_install"
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className={cn("relative z-10 m-2 flex shrink-0 items-center gap-3 px-4 py-2.5", STORE_PANEL_SHELL)}>
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5">
          {(["all", "installed"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {f === "all" ? "All Apps" : `Installed (${installedCount})`}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <AppStoreInstallMenu
          onInstallCustomClick={onOpenCustomInstall}
          onManageSourcesClick={() => setIsSourcesDialogOpen(true)}
        />

        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="w-full rounded-lg border border-glass-border bg-background/55 py-1.5 pl-8 pr-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary/40"
          />
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

      <div className="flex flex-1 flex-col overflow-hidden">
        <CategoryPills categories={categories} selectedCategory={selectedCategory} onSelect={setSelectedCategory} />

        <div className={cn("mx-2 mb-2 mt-1 flex-1 overflow-y-auto p-4", STORE_PANEL_SHELL)}>
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
            <div className="space-y-6">
              {/* Featured + Recommended strips */}
              {shouldShowStrips && (
                <>
                  <FeaturedHero
                    title="Featured"
                    icon={<Star className="size-4 text-primary" />}
                    apps={featuredApps}
                    operationsByApp={operationsByApp}
                    onSelect={setSelectedAppId}
                    onInstall={(app) => void startInstall(app)}
                    onUpdate={(app) => void startUpdate(app)}
                  />
                  <FeaturedStrip
                    title="Recommended"
                    icon={<Sparkles className="size-4 text-primary" />}
                    apps={recommendedApps}
                    onSelect={setSelectedAppId}
                  />
                </>
              )}

              {/* Catalog list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {selectedCategory ?? (filter === "installed" ? "Installed Apps" : "Catalog")}
                    </h2>
                    <p className="text-xs text-muted-foreground/70">{apps.length} apps</p>
                  </div>
                </div>

                {/* Named so the catalog is distinguishable from the featured
                    cards above, where the same app can also appear. */}
                <div
                  role="group"
                  aria-label="Catalog"
                  className="grid grid-cols-1 gap-1.5 lg:grid-cols-2"
                >
                  {visibleApps.map((app) => (
                    <CatalogRow
                      key={app.id}
                      app={app}
                      operation={operationsByApp[app.id]}
                      onClick={() => setSelectedAppId(app.id)}
                      onInstall={() => void startInstall(app)}
                      onUpdate={() => void startUpdate(app)}
                    />
                  ))}
                </div>

                {hasMoreApps && (
                  <div className="flex flex-col items-center gap-3 py-2">
                    <div ref={loadMoreRef} className="h-1 w-full" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => setVisibleCatalogCount((c) => Math.min(c + STORE_PAGE_SIZE, apps.length))}
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
