"use client";

import { useEffect, useRef } from "react";
import { useUpdateLog } from "@/modules/shell/hooks/useUpdateLog";

type UpdateLogPaneProps = {
  /** Poll only while the update is actually under way. */
  enabled: boolean;
};

/**
 * A read-only view of what the updater is doing, for the wait that used to be
 * a spinner and a sentence. Read-only on purpose: nothing here is a control,
 * and an update is not something to offer people buttons in the middle of.
 */
export function UpdateLogPane({ enabled }: UpdateLogPaneProps) {
  const { lines, available, unavailableReason, isLoading } = useUpdateLog(enabled);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);

  // Follow the tail, but stop following the moment someone scrolls up to read
  // something — yanking them back to the bottom on the next poll would make
  // the log unreadable exactly when they are trying to read it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !pinnedToBottomRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [lines]);

  if (!enabled) return null;

  if (!available) {
    return (
      <p className="mx-auto mt-6 max-w-md text-xs leading-5 text-muted-foreground/70">
        {unavailableReason}
      </p>
    );
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-xl text-left">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="text-3xs tracking-[0.22em] text-foreground/45 uppercase">
          Updater output
        </span>
      </div>
      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          pinnedToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="system-floating-surface h-52 overflow-y-auto bg-black/24 px-3 py-2.5 font-mono text-2xs leading-5 text-foreground/72"
        data-testid="update-log-pane"
        role="log"
        aria-live="polite"
        aria-label="Updater output"
      >
        {lines.length === 0 ? (
          <p className="text-foreground/45">
            {isLoading ? "Attaching to the updater…" : "Waiting for the updater to start…"}
          </p>
        ) : (
          lines.map((line, index) => (
            <div key={`${index}-${line}`} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
