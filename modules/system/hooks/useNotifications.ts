"use client";

import type { NotificationRecord, NotificationSseEvent } from "@/lib/shared/contracts/notifications";
import { queryKeys } from "@/lib/shared/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

async function fetchNotifications(): Promise<NotificationRecord[]> {
  const res = await fetch("/api/v1/notifications");
  if (!res.ok) throw new Error("Failed to fetch notifications");
  const data = await res.json() as { notifications: NotificationRecord[] };
  return data.notifications;
}

function sortByNewest(records: NotificationRecord[]) {
  return [...records].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchNotifications,
    staleTime: 30_000,
  });

  useEffect(() => {
    const source = new EventSource("/api/v1/notifications/stream");

    const handleCreated = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as NotificationSseEvent;
        if (payload.type !== "notification.created") return;
        queryClient.setQueryData<NotificationRecord[]>(queryKeys.notifications, (prev = []) => {
          const next = [payload.notification, ...prev.filter((n) => n.id !== payload.notification.id)];
          // Sort rather than assume the event that just arrived is the newest:
          // several producers emit these, and delivery order does not have to
          // match createdAt. Trim only once the order is right.
          return sortByNewest(next).slice(0, 50);
        });
      } catch {
        // ignore parse errors
      }
    };

    const handleReadAll = () => {
      queryClient.setQueryData<NotificationRecord[]>(queryKeys.notifications, (prev = []) =>
        prev.map((n) => ({ ...n, read: true })),
      );
    };

    const handleCleared = () => {
      queryClient.setQueryData<NotificationRecord[]>(queryKeys.notifications, []);
    };

    source.addEventListener("notification.created", handleCreated);
    source.addEventListener("notification.read-all", handleReadAll);
    source.addEventListener("notification.cleared", handleCleared);

    return () => {
      source.removeEventListener("notification.created", handleCreated);
      source.removeEventListener("notification.read-all", handleReadAll);
      source.removeEventListener("notification.cleared", handleCleared);
      source.close();
    };
  }, [queryClient]);

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("Failed to mark notifications read");
    },
    onSuccess: () => {
      queryClient.setQueryData<NotificationRecord[]>(queryKeys.notifications, (prev = []) =>
        prev.map((n) => ({ ...n, read: true })),
      );
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/notifications", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to clear notifications");
    },
    onSuccess: () => {
      queryClient.setQueryData<NotificationRecord[]>(queryKeys.notifications, []);
    },
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    markAllRead: markAllReadMutation.mutate,
    clearAll: clearAllMutation.mutate,
  };
}
