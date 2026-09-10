"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Stops point at the interface itself rather than a mock of it. A simulated
 * tour is a second copy of every screen to keep in step with the real one, and
 * it drifts silently — this cannot, because it highlights what is on screen.
 */
type Stop = {
  id: string;
  /** Queried at display time; a stop whose anchor is absent is skipped. */
  selector: string;
  title: string;
  body: string;
};

const STOPS: Stop[] = [
  {
    id: "apps",
    selector: "[data-tour='apps']",
    title: "Everything running, in one place",
    body: "Your apps live here, and so do containers Homeio did not install — it reads them straight from Docker.",
  },
  {
    id: "app-store",
    selector: "[aria-label='App Store']",
    title: "Install from the store",
    body: "Hundreds of apps, plus any CasaOS-compatible store you point Homeio at. Or paste your own compose file.",
  },
  {
    id: "files",
    selector: "[aria-label='Files']",
    title: "Your files, not someone else's",
    body: "Browse, upload and share what is on the server. Network shares and Google Drive plug in here too.",
  },
  {
    id: "settings",
    selector: "[aria-label='Settings']",
    title: "The rest lives in Settings",
    body: "Remote access, backups, scheduled tasks and users. Anything setup skipped is waiting there.",
  },
];

type Placement = { top: number; left: number } | null;

const EDGE_MARGIN = 16;

/** Against the account, not the browser: a second device is the same person. */
async function recordSeen() {
  try {
    await fetch("/api/v1/system/tour", { method: "POST" });
  } catch {
    // Worst case it is offered again on the next load.
  }
}

export function useDesktopTour({
  hasSeenTour,
  isReady,
}: {
  hasSeenTour: boolean;
  isReady: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isReady || hasSeenTour || dismissed) return;
    // Let the desktop land first. Arriving on top of it turns the tour into
    // something to dismiss rather than read.
    const timer = window.setTimeout(() => setIsOpen(true), 1800);
    return () => window.clearTimeout(timer);
  }, [dismissed, hasSeenTour, isReady]);

  return {
    isOpen,
    start: useCallback(() => setIsOpen(true), []),
    close: useCallback(() => {
      setDismissed(true);
      setIsOpen(false);
    }, []),
  };
}

export function DesktopTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(0);

  const visibleStops = useMemo(() => {
    if (!open || typeof document === "undefined") return STOPS;
    return STOPS.filter((stop) => document.querySelector(stop.selector));
  }, [open]);

  const stop = visibleStops[index];

  const finish = useCallback(() => {
    void recordSeen();
    setIndex(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open || !stop) return;

    function measure() {
      const target = document.querySelector(stop!.selector);
      setRect(target ? target.getBoundingClientRect() : null);
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, stop]);

  useLayoutEffect(() => {
    if (!open) return;
    setBubbleHeight(bubbleRef.current?.offsetHeight ?? 0);
  }, [open, index, rect]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight" || event.key === "Enter") {
        setIndex((current) => {
          if (current + 1 >= visibleStops.length) {
            finish();
            return current;
          }
          return current + 1;
        });
      } else if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(0, current - 1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish, open, visibleStops.length]);

  if (!open || !stop || visibleStops.length === 0) return null;

  // A large anchor — the app grid fills the screen — has both edges close to
  // the viewport's, so "above or below it" is not enough: the bubble has to be
  // clamped into view or it renders half off-screen.
  const placement: Placement = rect
    ? (() => {
        const height = bubbleHeight || 160;
        const viewport = window.innerHeight;

        const above = rect.top - EDGE_MARGIN - height;
        const below = rect.bottom + EDGE_MARGIN;

        const top =
          above >= EDGE_MARGIN
            ? above
            : below + height <= viewport - EDGE_MARGIN
              ? below
              : Math.max(EDGE_MARGIN, viewport - height - EDGE_MARGIN);

        return {
          top,
          left: Math.min(
            Math.max(rect.left + rect.width / 2, 180),
            window.innerWidth - 180,
          ),
        };
      })()
    : null;

  const isLast = index === visibleStops.length - 1;

  return (
    <div className="fixed inset-0 z-[80]" data-testid="desktop-tour">
      {/* Dim everything but the anchor. Clicking away leaves, like any overlay. */}
      <button
        type="button"
        aria-label="Close tour"
        onClick={finish}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[1px]"
      />

      {rect && (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          className="pointer-events-none absolute rounded-2xl ring-2 ring-white/70 transition-all duration-300 ease-out"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
        />
      )}

      <div
        ref={bubbleRef}
        data-testid="tour-bubble"
        className="desktop-tour-bubble absolute w-[320px] -translate-x-1/2 rounded-2xl border border-glass-border bg-background/95 p-4 text-left shadow-2xl backdrop-blur"
        style={
          placement
            ? { top: placement.top, left: placement.left, transform: "translateX(-50%)" }
            : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
        }
      >
        <p className="text-sm font-medium text-foreground">{stop.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground/75">{stop.body}</p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            {visibleStops.map((entry, position) => (
              <span
                key={entry.id}
                className={`h-[3px] rounded-full transition-all duration-300 ${
                  position === index ? "w-4 bg-white" : "w-2.5 bg-white/25"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            {/* Leaving is as easy as continuing: a tour you cannot escape is
                one people learn to fear rather than read. */}
            <button
              type="button"
              onClick={finish}
              className="cursor-pointer text-[11px] text-muted-foreground/70 hover:text-foreground"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => (isLast ? finish() : setIndex(index + 1))}
              className="system-primary-action cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
