"use client";

import { MoreHorizontal } from "@/components/icons/platform-icons";
import { GridRegular, ListRegular, PulseRegular } from "@fluentui/react-icons";
import { getAppVisualState, type AppItem } from "@/modules/apps/components/app-grid-presenters";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

type Props = {
  activeAppId: string | null;
  apps: AppItem[];
  isAppsError: boolean;
  isAppsLoading: boolean;
  onAppContextMenu: (event: MouseEvent, app: AppItem) => void;
  onBrowseStore?: () => void;
  onOpenApp: (app: AppItem) => void;
};

const VIEW_KEY = "homeio.mobile-launcher.view.v1";

function isAppRunning(app: AppItem) {
  return app.status === "unmanaged"
    ? app.condition?.condition === "running"
    : app.status === "running";
}

export function MobileAppLauncher({ activeAppId, apps, isAppsError, isAppsLoading, onAppContextMenu, onBrowseStore, onOpenApp }: Props) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [size, setSize] = useState({ columns: 4, rows: 3, showWidget: false });
  const [pageAnchor, setPageAnchor] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch {
      // Keep the default when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const element = areaRef.current;
    if (!element || view !== "grid" || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const columns = width >= 432 ? Math.min(7, Math.floor(width / 86)) : Math.max(2, Math.min(4, Math.floor(width / 66)));
      const minRowHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue("--mobile-grid-min-row")) || 108;
      const rows = Math.max(1, Math.min(height >= 656 ? 6 : 5, Math.floor(height / minRowHeight)));
      const showWidget = width >= 320 && columns >= 4 && rows >= 4 && height > width;
      setSize((previous) => previous.columns === columns && previous.rows === rows && previous.showWidget === showWidget
        ? previous
        : { columns, rows, showWidget });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, apps.length, isAppsLoading, isAppsError]);

  const capacity = size.columns * size.rows;
  const showWidget = size.showWidget && !isAppsLoading && !isAppsError && apps.length > 0;
  const firstCapacity = capacity - (showWidget ? 2 : 0);
  const pageCount = 1 + Math.ceil(Math.max(0, apps.length - firstCapacity) / capacity);
  const currentPage = pageAnchor < firstCapacity
    ? 0
    : Math.min(pageCount - 1, 1 + Math.floor((pageAnchor - firstCapacity) / capacity));
  const pageStart = currentPage === 0 ? 0 : firstCapacity + (currentPage - 1) * capacity;
  const pageSize = currentPage === 0 ? firstCapacity : capacity;
  const runningCount = apps.filter(isAppRunning).length;

  function goToPage(next: number) {
    setPageAnchor(next === 0 ? 0 : firstCapacity + (next - 1) * capacity);
  }

  useEffect(() => {
    pagerRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentPage, pageCount, view]);
  function chooseView(next: "grid" | "list") {
    setView(next);
    setPageAnchor(0);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* Keep the choice for this session. */ }
  }
  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") swipe.current = { x: event.clientX, y: event.clientY };
  }
  function endSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || view !== "grid") return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      goToPage(Math.max(0, Math.min(pageCount - 1, currentPage + (dx < 0 ? 1 : -1))));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[var(--mobile-home-width)] min-h-0 flex-1 flex-col">
      {isAppsLoading && apps.length === 0 ? (
        <p role="status" className="mobile-wallpaper-label py-4 text-sm">Loading apps…</p>
      ) : isAppsError && apps.length === 0 ? (
        <p role="alert" className="mobile-wallpaper-label py-4 text-sm">Could not load apps. Check your connection and try again.</p>
      ) : apps.length === 0 ? (
        <div className="py-5 text-sm">
          <p className="mobile-wallpaper-label">No apps installed yet.</p>
          {onBrowseStore && <button type="button" onClick={onBrowseStore} className="mt-3 min-h-11 rounded-lg bg-primary px-4 font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary">Browse Store</button>}
        </div>
      ) : view === "list" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-[var(--system-radius-panel)] border border-[var(--mobile-divider)] bg-[var(--mobile-panel)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="divide-y divide-[var(--mobile-divider)] px-3">
            {apps.map((app) => <MobileApp key={app.id} app={app} list active={activeAppId === app.id} onOpenApp={onOpenApp} onAppContextMenu={onAppContextMenu} />)}
          </ul>
        </div>
      ) : (
        <>
          <div ref={areaRef} className="min-h-0 flex-1 overflow-hidden [touch-action:pan-y_pinch-zoom]" onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipe.current = null; }}>
            <ul aria-label="Apps" className="grid h-full content-start" style={{ gridTemplateColumns: `repeat(${size.columns}, minmax(0, 1fr))`, gridAutoRows: `minmax(0, min(${100 / size.rows}%, 7.75rem))` }}>
              {showWidget && currentPage === 0 && (
                <li className="col-span-2 flex px-1.5 pt-[var(--mobile-app-inset)]">
                  <section aria-label="App activity" className="mobile-glass flex h-[min(5.5rem,calc(100%-0.5rem))] w-full min-w-0 items-center justify-between gap-2 rounded-[1.2rem] px-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground/80">Apps running</p>
                      <p className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                        <strong className="text-[1.65rem] leading-none tracking-tight">{runningCount}</strong>
                        <span className="text-xs font-medium text-foreground/75">of {apps.length}</span>
                      </p>
                    </div>
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full p-[2px] text-[var(--mobile-accent-text)]" style={{ background: `conic-gradient(currentColor ${runningCount / apps.length}turn, var(--mobile-divider) 0)` }}>
                      <span className="grid size-full place-items-center rounded-full bg-[var(--mobile-panel)]">
                        <PulseRegular className="size-4" />
                      </span>
                    </span>
                  </section>
                </li>
              )}
              {apps.slice(pageStart, pageStart + pageSize).map((app) => (
                <MobileApp key={app.id} app={app} active={activeAppId === app.id} onOpenApp={onOpenApp} onAppContextMenu={onAppContextMenu} />
              ))}
            </ul>
          </div>
        </>
      )}
      {!isAppsLoading && !isAppsError && apps.length > 0 && (
        <div className="relative flex h-[var(--mobile-launcher-controls)] shrink-0 items-center justify-center px-[6rem]" aria-label="Launcher controls">
          {view === "grid" && pageCount > 1 && (
            <div ref={pagerRef} className="flex max-w-full snap-x items-center overflow-x-auto overscroll-x-contain rounded-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="App pages">
              {Array.from({ length: pageCount }, (_, index) => (
                <button key={index} type="button" aria-label={`App page ${index + 1}`} aria-current={index === currentPage ? "page" : undefined} onClick={() => goToPage(index)} className="flex size-11 shrink-0 snap-center items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white">
                  <span aria-hidden="true" className={`size-1.5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)] ${index === currentPage ? "bg-white" : "bg-white/45"}`} />
                </button>
              ))}
            </div>
          )}
          <div role="group" aria-label="App view" className="mobile-glass absolute right-0 flex rounded-full p-0.5">
            {(["grid", "list"] as const).map((option) => (
              <button key={option} type="button" aria-label={option === "grid" ? "Grid" : "List"} aria-pressed={view === option} onClick={() => chooseView(option)} className={`flex size-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary ${view === option ? "bg-primary/14 text-[var(--mobile-accent-text)] shadow-sm" : "text-foreground/75"}`}>
                {option === "grid" ? <GridRegular aria-hidden="true" className="size-[1.1rem]" /> : <ListRegular aria-hidden="true" className="size-[1.1rem]" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileApp({ app, active, list = false, onOpenApp, onAppContextMenu }: { app: AppItem; active: boolean; list?: boolean; onOpenApp: Props["onOpenApp"]; onAppContextMenu: Props["onAppContextMenu"] }) {
  const [imageFailed, setImageFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const held = useRef(false);
  const visual = getAppVisualState(app);
  const running = isAppRunning(app);
  function cancelHold() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => () => cancelHold(), []);
  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    cancelHold();
    held.current = false;
    suppressClick.current = false;
    if (event.pointerType !== "touch" || event.isPrimary === false) return;
    touch.current = { x: event.clientX, y: event.clientY };
    timer.current = setTimeout(() => {
      held.current = true;
      suppressClick.current = true;
      onAppContextMenu(event, app);
    }, 550);
  }
  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 10) {
      cancelHold();
      suppressClick.current = true;
    }
  }
  const icon = <span className={`relative flex ${list ? "size-11 rounded-xl" : "size-[var(--mobile-app-tile)] rounded-[28%] shadow-[0_4px_12px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.55)]"} shrink-0 items-center justify-center border ${visual.ringClass} ${app.logoUrl && !imageFailed ? "bg-white/90" : `${app.bgColor} ${app.color}`}`}>
    {app.logoUrl && !imageFailed ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={app.logoUrl} alt="" width={64} height={64} className={`size-full rounded-[inherit] object-contain ${list ? "p-0.5" : "p-[2px]"} ${visual.imageClass}`} onError={() => setImageFailed(true)} />) : <app.icon className={`size-7 ${visual.imageClass}`} aria-hidden="true" />}
    {running ? <span data-running-indicator className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-black/30 bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.7)]" aria-hidden="true" /> : null}
  </span>;
  return (
    <li className={list ? "flex min-w-0 items-center" : "relative flex min-w-0 flex-col items-center justify-start px-0.5"}>
      <button
        type="button"
        aria-label={`Open ${app.name} (${visual.title})`}
        data-app-status={app.status}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => { cancelHold(); touch.current = null; }}
        onPointerCancel={() => { cancelHold(); touch.current = null; suppressClick.current = true; }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelHold();
          if (held.current) return;
          if (touch.current) {
            suppressClick.current = true;
            held.current = true;
          }
          onAppContextMenu(event, app);
        }}
        onClick={(event) => {
          if (suppressClick.current) {
            event.stopPropagation();
            suppressClick.current = false;
            return;
          }
          onOpenApp(app);
        }}
        className={`cursor-pointer select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-primary ${list ? "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 text-left active:bg-foreground/5" : "flex h-full w-full min-w-0 flex-col items-center gap-[var(--mobile-app-gap)] rounded-2xl px-0.5 pt-[var(--mobile-app-inset)] active:opacity-75"}`}
      >
        {icon}
        <span className={list ? "min-w-0 flex-1" : "w-full min-w-0 text-center"}>
          <span className={list ? "block [overflow-wrap:anywhere] text-sm font-medium text-foreground" : `mobile-wallpaper-label text-[length:var(--mobile-app-label)] font-medium leading-tight ${app.name.includes(" ") ? "line-clamp-2 text-balance [overflow-wrap:anywhere]" : "block truncate"}`}>{app.name}</span>
          {list && <span className="block text-xs text-muted-foreground">{visual.title}{app.updateAvailable && app.status === "running" ? " · Update available" : ""}</span>}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Actions for ${app.name}`}
        aria-expanded={active}
        onClick={(event) => { event.stopPropagation(); onAppContextMenu(event, app); }}
        className={`${list ? "size-11 shrink-0" : "sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:right-0 focus-visible:top-0 focus-visible:size-11 focus-visible:bg-[var(--mobile-panel)]"} flex items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-primary`}
      >
        <MoreHorizontal className="size-4 opacity-75 brightness-0 dark:invert" aria-hidden="true" />
      </button>
    </li>
  );
}
