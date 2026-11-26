"use client";

import { getStoreOperationActionLabel } from "@/lib/shared/store-operations";
import {
  getAppVisualState,
  type ActiveAppOperation,
  type AppItem,
} from "@/modules/apps/components/app-grid-presenters";
import { MoreHorizontal } from "@/components/icons/platform-icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, type MouseEvent } from "react";
import { MobileAppLauncher } from "@/modules/apps/components/mobile-app-launcher";

type AppGridContentProps = {
  mobile?: boolean;
  onBrowseStore?: () => void;
  activeAppId: string | null;
  activeOperationsCount: number;
  animationsEnabled: boolean;
  apps: AppItem[];
  iconSize: "small" | "medium" | "large";
  isAppsError: boolean;
  isAppsLoading: boolean;
  onAppContextMenu: (event: MouseEvent, app: AppItem) => void;
  onOpenApp: (app: AppItem) => void;
  primaryOperation: ActiveAppOperation | null;
};

export function AppGridContent({
  mobile = false,
  onBrowseStore,
  activeAppId,
  activeOperationsCount,
  animationsEnabled,
  apps,
  iconSize,
  isAppsError,
  isAppsLoading,
  onAppContextMenu,
  onOpenApp,
  primaryOperation,
}: AppGridContentProps) {
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const iconContainerClass =
    iconSize === "small"
      ? "size-12 rounded-xl"
      : iconSize === "large"
        ? "size-16 rounded-3xl"
        : "size-14 rounded-2xl";
  const iconGlyphClass =
    iconSize === "small"
      ? "size-6"
      : iconSize === "large"
        ? "size-8"
        : "size-7";

  return (
    <>
      {primaryOperation ? (
        <div
          className="fixed bottom-[5.75rem] left-1/2 z-[150] -translate-x-1/2 w-[min(92vw,22rem)] overflow-hidden rounded-[var(--system-radius-control)] border border-glass-border/50 bg-popover/90 shadow-[0_8px_32px_rgba(0,0,0,0.28)] backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)] animate-pulse" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {getStoreOperationActionLabel(primaryOperation.action)}{" "}
                <span className="text-foreground/60">{primaryOperation.appName}</span>
              </p>
            </div>
            <span className="shrink-0 tabular-nums text-2xs text-muted-foreground/60">
              {activeOperationsCount > 1
                ? `+${activeOperationsCount - 1} more`
                : `${primaryOperation.progressPercent}%`}
            </span>
          </div>
          <div className="h-px w-full bg-glass-border/30">
            <div
              className="h-full bg-primary/60 transition-all duration-500"
              style={{ width: `${Math.max(2, primaryOperation.progressPercent)}%` }}
            />
          </div>
        </div>
      ) : null}

      {mobile ? (
        <MobileAppLauncher
          activeAppId={activeAppId}
          apps={apps}
          isAppsError={isAppsError}
          isAppsLoading={isAppsLoading}
          onAppContextMenu={onAppContextMenu}
          onBrowseStore={onBrowseStore}
          onOpenApp={onOpenApp}
        />
      ) : isAppsLoading && apps.length === 0 ? (
        <div className="mt-24" role="status" aria-live="polite">
          <div className="mx-auto flex max-w-xs flex-col items-center text-center">
            <div className="relative h-1 w-48 overflow-hidden rounded-full bg-glass-border/30">
              <div className="absolute inset-0 animate-grid-scan rounded-full bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
            </div>
            <p className="mt-4 text-2xs uppercase tracking-[0.2em] font-mono text-muted-foreground">
              Syncing containers
            </p>
          </div>
          {/* Skeleton placeholder icons that match the real grid layout */}
          <div
            aria-hidden="true"
            className="mt-8 grid grid-cols-[repeat(3,minmax(0,5.5rem))] justify-center gap-x-1 gap-y-6 opacity-40 sm:grid-cols-[repeat(5,minmax(0,5.5rem))] md:grid-cols-[repeat(6,minmax(0,5.5rem))] lg:grid-cols-[repeat(8,minmax(0,5.5rem))] xl:grid-cols-[repeat(10,minmax(0,5.5rem))]"
          >
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2 p-2">
                <Skeleton className={`${iconContainerClass} shrink-0`} />
                <Skeleton className="h-2.5 w-12 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : isAppsError && apps.length === 0 ? (
        <div className="mt-24 text-center">
          <p className="text-2xs uppercase tracking-[0.2em] font-mono text-status-red">
            Connection failed
          </p>
        </div>
      ) : apps.length === 0 ? (
        <div className="mt-24 min-h-[12rem]" aria-hidden="true" />
      ) : (
        <div className="mt-24 grid grid-cols-[repeat(3,minmax(0,5.5rem))] justify-center gap-x-1 gap-y-6 sm:grid-cols-[repeat(5,minmax(0,5.5rem))] md:grid-cols-[repeat(6,minmax(0,5.5rem))] lg:grid-cols-[repeat(8,minmax(0,5.5rem))] xl:grid-cols-[repeat(10,minmax(0,5.5rem))]">
          {apps.map((app) => {
            const visualState = getAppVisualState(app);
            const BadgeIcon = visualState.badgeIcon;

            return (
              <div key={app.id} className="flex min-w-0 flex-col items-center">
              <button
                onClick={() => onOpenApp(app)}
                onContextMenu={(event) => onAppContextMenu(event, app)}
                className={`group flex flex-col items-center gap-2 rounded-xl p-2 cursor-pointer ${
                  activeAppId === app.id
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : "hover:bg-foreground/5"
                } ${animationsEnabled ? "transition-all duration-200" : ""} ${
                  animationsEnabled ? "group-active:scale-95" : ""
                }`}
                aria-label={`Open ${app.name}`}
                data-app-status={app.status}
                title={visualState.title}
              >
                <div className="relative">
                  <div
                    className={`${iconContainerClass} relative flex items-center justify-center overflow-hidden border grain-overlay ${visualState.ringClass} ${!app.logoUrl ? `${app.bgColor} ${app.color}` : "bg-white/90"} shadow-lg shadow-black/20 ${
                      animationsEnabled
                        ? `transition-transform duration-200 group-hover:scale-110`
                        : ""
                    }`}
                    style={{ transform: "translateZ(0)" }}
                  >
                    {app.logoUrl ? (
                      <>
                        {!loadedImages.has(app.logoUrl) ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className={`${iconGlyphClass} animate-pulse`}>
                              <app.icon className="h-full w-full opacity-30" />
                            </div>
                          </div>
                        ) : null}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={app.logoUrl}
                          alt={`${app.name} logo`}
                          className={`absolute inset-0 h-full w-full object-contain p-1.5 ${visualState.imageClass}`}
                          loading="lazy"
                          decoding="async"
                          onLoad={() => {
                            setLoadedImages((previous) =>
                              new Set(previous).add(app.logoUrl!),
                            );
                          }}
                          onError={(event) => {
                            const img = event.currentTarget;
                            const container = img.parentElement;
                            if (!container) return;
                            img.style.display = "none";
                            container.classList.remove("bg-white/90");
                            container.classList.add(app.bgColor, app.color);
                            const fallback = container.querySelector(
                              "[data-fallback-icon]",
                            );
                            if (fallback instanceof HTMLElement) {
                              fallback.style.display = "block";
                            }
                          }}
                        />
                        <app.icon
                          className={`${iconGlyphClass} hidden ${visualState.imageClass}`}
                          data-fallback-icon
                        />
                      </>
                    ) : (
                      <app.icon
                        className={`${iconGlyphClass} ${visualState.imageClass}`}
                      />
                    )}
                  </div>
                  {BadgeIcon ? (
                    <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                      <BadgeIcon
                        className={`size-7 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] ${visualState.badgeClass} ${
                          animationsEnabled ? visualState.badgeIconClass : ""
                        }`}
                      />
                    </span>
                  ) : null}
                  {app.updateAvailable && app.status === "running" ? (
                    <span
                      className="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full border border-background bg-primary"
                      title="Update available"
                    />
                  ) : null}
                </div>

                <span
                  className={`max-w-[4.5rem] truncate text-center text-2xs font-medium leading-tight tracking-tight text-foreground/80 ${
                    animationsEnabled
                      ? "transition-colors group-hover:text-foreground"
                      : ""
                  }`}
                >
                  {app.name}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Actions for ${app.name}`}
                aria-expanded={activeAppId === app.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onAppContextMenu(event, app);
                }}
                className="hidden min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-primary max-sm:flex [@media(pointer:coarse)]:flex"
              >
                <MoreHorizontal className="size-5" aria-hidden="true" />
              </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
