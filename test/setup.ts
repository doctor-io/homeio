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

afterEach(() => {
  vi.restoreAllMocks();
});
