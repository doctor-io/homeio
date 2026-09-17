"use client";

import type { SystemUpdateLog } from "@/lib/shared/contracts/system";
import { useEffect, useRef, useState } from "react";

const POLL_MS = 2_000;

/**
 * Keep the pane bounded. An update is a few hundred lines; anything past this
 * is a runaway loop in the script, and rendering all of it would not help the
 * person reading it.
 */
const MAX_LINES = 600;

export type UpdateLogState = {
  lines: string[];
  running: boolean;
  available: boolean;
  unavailableReason: string | null;
  /** True until the first answer arrives, so the pane can say nothing yet. */
  isLoading: boolean;
};

/**
 * Follows the update log across the restart that the update itself causes.
 *
 * The byte offset lives here rather than on the server: the process being
 * polled is replaced partway through, so the only side of this that survives
 * the update is the browser. A request that fails is a service that is down
 * mid-restart, which is expected — the lines already collected stay on screen
 * and the next tick picks up where this one left off.
 */
export function useUpdateLog(enabled: boolean): UpdateLogState {
  const [state, setState] = useState<UpdateLogState>({
    lines: [],
    running: false,
    available: true,
    unavailableReason: null,
    isLoading: true,
  });

  const offsetRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const query =
          offsetRef.current === undefined ? "" : `?offset=${offsetRef.current}`;
        const res = await fetch(`/api/v1/system/updates/log${query}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;

        const json = (await res.json()) as { data?: Partial<SystemUpdateLog> };
        if (cancelled) return;

        // A 200 is not a promise that the body is ours. Mid-update this can be
        // a proxy's own page, or a Homeio of a different version answering
        // before the new one is up. This screen exists to survive the restart,
        // so an answer it does not recognise is skipped, not parsed on faith.
        const next = json.data;
        if (!next || !Array.isArray(next.lines) || typeof next.nextOffset !== "number") {
          return;
        }

        offsetRef.current = next.nextOffset;

        const incoming = next.lines;
        setState((previous) => ({
          lines: incoming.length
            ? [...previous.lines, ...incoming].slice(-MAX_LINES)
            : previous.lines,
          running: next.running === true,
          available: next.available !== false,
          unavailableReason: next.unavailableReason ?? null,
          isLoading: false,
        }));
      } catch {
        // The service is restarting. Hold what we have and try again.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return state;
}
