"use client";

import { Bell, Trash2, CheckCircle2 } from "@/components/icons/platform-icons";
import { useNotifications } from "@/modules/system/hooks/useNotifications";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

const KIND_DOT: Record<string, string> = {
  error: "bg-status-red",
  success: "bg-status-green",
  info: "bg-primary",
};

type Filter = "all" | "unread";

export function NotificationsPanel() {
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/60 handheld:bg-[var(--mobile-canvas)]">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-glass-border/60 px-4 py-3 handheld:border-[var(--mobile-divider)] handheld:px-[var(--mobile-gutter)] handheld:py-2">
        <div className="flex items-center gap-1 rounded-lg border border-glass-border/60 bg-background/40 p-0.5 handheld:border-[var(--mobile-divider)] handheld:bg-[var(--mobile-panel)]">
          {(["all", "unread"] as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1 handheld:min-h-11 text-xs font-medium capitalize transition-colors",
                filter === f
                  ? "bg-primary/15 text-primary handheld:text-[var(--mobile-accent-text)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
              {f === "unread" && unreadCount > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => markAllRead()}
            disabled={unreadCount === 0}
            aria-label="Mark all read"
            title="Mark all read"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed handheld:grid handheld:size-11 handheld:place-items-center handheld:border handheld:border-[var(--mobile-divider)] handheld:bg-[var(--mobile-panel)]"
          >
            <CheckCircle2 className="size-3.5 handheld:size-5" aria-hidden="true" />
            <span className="handheld:sr-only">Mark all read</span>
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            disabled={notifications.length === 0}
            aria-label="Clear all"
            title="Clear all"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background/50 hover:text-status-red disabled:opacity-40 disabled:cursor-not-allowed handheld:grid handheld:size-11 handheld:place-items-center handheld:border handheld:border-[var(--mobile-divider)] handheld:bg-[var(--mobile-panel)]"
          >
            <Trash2 className="size-3.5 handheld:size-5" aria-hidden="true" />
            <span className="handheld:sr-only">Clear all</span>
          </button>
        </div>
      </div>

      {confirmClear && <div role="alertdialog" aria-label="Clear all notifications?" className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mobile-divider)] bg-[var(--mobile-panel)] px-4 py-3"><p className="text-sm">Clear all notifications?</p><div className="flex gap-2"><button type="button" onClick={() => setConfirmClear(false)} className="min-h-11 rounded-lg px-3 text-sm">Cancel</button><button type="button" onClick={() => { clearAll(); setConfirmClear(false); }} className="min-h-11 rounded-lg bg-status-red/15 px-3 text-sm text-status-red">Clear all</button></div></div>}
      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto handheld:overscroll-contain">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground handheld:min-h-full handheld:px-[var(--mobile-gutter)] handheld:py-8">
            <Bell className="size-10 opacity-20" />
            <p className="text-sm">
              {filter === "unread" ? "No unread notifications" : "No notifications"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-glass-border/40 handheld:mobile-list-group handheld:mx-[var(--mobile-gutter)] handheld:my-3">
            {visible.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "flex items-start gap-3 px-5 py-4 transition-colors hover:bg-background/30 handheld:px-3",
                  !n.read && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.read ? "bg-muted-foreground/20" : (KIND_DOT[n.kind] ?? "bg-primary"),
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <span className={cn("min-w-0 [overflow-wrap:anywhere] text-sm font-medium", n.read ? "text-muted-foreground" : "text-foreground")}>
                      {n.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground/60">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-0.5 [overflow-wrap:anywhere] text-sm text-muted-foreground">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
