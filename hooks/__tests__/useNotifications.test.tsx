/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/shared/query-keys";
import { useNotifications } from "@/modules/system/hooks/useNotifications";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";

class MockEventSource {
  static instances: MockEventSource[] = [];

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function notification(id: string, title: string, createdAt: string) {
  return { id, title, body: "", kind: "info", read: false, createdAt };
}

describe("useNotifications", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          notifications: [
            notification("a", "App Redeployed", "2026-09-09T20:25:00.000Z"),
            notification("b", "App Installed", "2026-09-09T20:23:00.000Z"),
          ],
        }),
      }),
    );
  });

  it("keeps the list newest-first when an event arrives out of order", async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useNotifications(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    const source = MockEventSource.instances.at(-1)!;

    act(() => {
      // Older than what is already at the top: several producers emit these and
      // delivery order does not have to follow createdAt.
      source.emit("notification.created", {
        type: "notification.created",
        notification: notification("c", "System Snapshot", "2026-09-09T20:18:00.000Z"),
      });
    });

    act(() => {
      source.emit("notification.created", {
        type: "notification.created",
        notification: notification("d", "CPU Warning", "2026-09-09T20:31:00.000Z"),
      });
    });

    const titles = result.current.notifications.map((n) => n.title);
    // Assert on the cache: that is what the panel renders, and it updates
    // outside React's render cycle here.
    const cached = client.getQueryData(queryKeys.notifications) as { title: string }[];
    expect(cached.map((n) => n.title)).toEqual([
      "CPU Warning",
      "App Redeployed",
      "App Installed",
      "System Snapshot",
    ]);
  });
});
