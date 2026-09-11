import { afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/modules/auth/api", async () => {
  const { NextResponse } = await import("next/server");

  return {
    requireApiSession: vi.fn(async () => ({
      session: {
        sessionId: "test-session",
        userId: "test-user",
        username: "admin",
        passwordHash: "test-password-hash",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      response: null,
    })),
    unauthorizedApiResponse: () =>
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
});

// Tests must never write to a real database. The app-operation tests walk every
// success and failure branch, and each branch inserted a notification row for
// real — around twenty per run, into whatever DATABASE_URL points at, which for
// a developer is their own dev database. Half the notifications in a working
// install were coming from the test suite, and the pre-commit hook runs it on
// every commit.
vi.mock("@/lib/server/modules/notifications/service", () => ({
  listNotifications: vi.fn(async () => []),
  createNotification: vi.fn(async () => undefined),
  markAllNotificationsRead: vi.fn(async () => undefined),
  clearAllNotifications: vi.fn(async () => undefined),
}));

// Node 26 defines its own `localStorage` global: an inert getter that returns
// undefined unless the process was started with --localstorage-file. It shadows
// the Storage JSDOM provides, so give the DOM tests a working in-memory one.
if (typeof window !== "undefined" && !globalThis.localStorage) {
  function createMemoryStorage(): Storage {
    const entries = new Map<string, string>();

    return {
      get length() {
        return entries.size;
      },
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(String(key)) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(String(key), String(value));
      },
      removeItem: (key: string) => {
        entries.delete(String(key));
      },
      clear: () => {
        entries.clear();
      },
    } as Storage;
  }

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

// next-themes calls window.matchMedia on mount; JSDOM doesn't implement it.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof globalThis !== "undefined" && !("EventSource" in globalThis)) {
  class EventSourceMock {
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }

  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: EventSourceMock,
  });
}

if (typeof globalThis !== "undefined" && !globalThis.localStorage) {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });
}

// Radix primitives (dropdown menus, selects) rely on pointer capture,
// ResizeObserver and scrollIntoView — none of which JSDOM implements.
if (typeof window !== "undefined") {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    });
  }

  if (!("PointerEvent" in globalThis)) {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      writable: true,
      value: globalThis.MouseEvent,
    });
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});
