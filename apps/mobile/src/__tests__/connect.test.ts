import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTailnetHost, messageFor, normalizeAddress, probeServer } from "../connect";

function mockFetch(handler: (url: string) => "ok" | "fail" | "hang") {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const outcome = handler(url);
    if (outcome === "ok") return {} as Response;
    if (outcome === "fail") throw new TypeError("Load failed");

    // Hang until the caller's AbortController fires, the way a dropped
    // connection behaves.
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      );
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("isTailnetHost", () => {
  it("recognises MagicDNS names", () => {
    expect(isTailnetHost("homeio.tail9c2f.ts.net")).toBe(true);
    expect(isTailnetHost("homeio.tail9c2f.ts.net:3000")).toBe(true);
  });

  it("recognises the tailnet CGNAT range", () => {
    expect(isTailnetHost("100.64.0.1")).toBe(true);
    expect(isTailnetHost("100.127.255.255")).toBe(true);
  });

  it("does not mistake other 100.x addresses for a tailnet", () => {
    // 100.0.0.1 is ordinary public space; only 100.64/10 is CGNAT.
    expect(isTailnetHost("100.0.0.1")).toBe(false);
    expect(isTailnetHost("100.200.0.1")).toBe(false);
  });

  it("does not treat a LAN address as a tailnet", () => {
    expect(isTailnetHost("192.168.1.10")).toBe(false);
    expect(isTailnetHost("homeio.local")).toBe(false);
  });
});

describe("probeServer diagnosis", () => {
  it("succeeds when the server answers", async () => {
    mockFetch(() => "ok");

    await expect(probeServer("http://homeio.tail9c2f.ts.net:3000")).resolves.toEqual({ ok: true });
  });

  it("reports a timeout separately from a refusal", async () => {
    mockFetch(() => "hang");

    const result = await probeServer("http://192.168.1.10:3000", 10);

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("blames Tailscale for an unreachable tailnet address", async () => {
    // The most common cause by far, and fixable in seconds — worth naming.
    mockFetch(() => "fail");

    const result = await probeServer("http://homeio.tail9c2f.ts.net:3000");

    expect(result).toMatchObject({ ok: false, reason: "tailscale_down" });
    expect((result as { error: string }).error).toContain("Tailscale");
  });

  it("does not blame Tailscale for a LAN address", async () => {
    mockFetch(() => "fail");

    const result = await probeServer("http://192.168.1.10:3000");

    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("spots a wrong port when the default one answers", async () => {
    mockFetch((url) => (url.includes(":3000") ? "ok" : "fail"));

    const result = await probeServer("http://192.168.1.10:8080");

    expect(result).toMatchObject({
      ok: false,
      reason: "wrong_port",
      suggestedOrigin: "http://192.168.1.10:3000",
    });
    expect((result as { error: string }).error).toContain("3000");
  });

  it("does not claim a wrong port when nothing answers at all", async () => {
    mockFetch(() => "fail");

    const result = await probeServer("http://192.168.1.10:8080");

    expect((result as { reason: string }).reason).not.toBe("wrong_port");
  });

  it("reads a failing https origin as a certificate problem", async () => {
    mockFetch(() => "fail");

    const result = await probeServer("https://homeio.example.com");

    expect(result).toMatchObject({ ok: false, reason: "tls" });
  });
});

describe("messageFor", () => {
  it("tells the user what to do, not what failed", () => {
    expect(messageFor("tailscale_down")).toContain("Open the Tailscale app");
    expect(messageFor("wrong_port", "http://x:3000")).toContain("Try that address");
  });

  it("still says something useful without a suggestion", () => {
    expect(messageFor("wrong_port")).toBeTruthy();
  });
});

describe("normalizeAddress", () => {
  it("adds the default scheme and port", () => {
    expect(normalizeAddress("homeio.tail9c2f.ts.net")).toEqual({
      ok: true,
      origin: "http://homeio.tail9c2f.ts.net:3000",
      host: "homeio.tail9c2f.ts.net:3000",
    });
  });

  it("keeps an explicit port", () => {
    expect(normalizeAddress("100.64.0.1:8096")).toMatchObject({
      origin: "http://100.64.0.1:8096",
    });
  });

  it("strips a pasted path", () => {
    expect(normalizeAddress("http://100.64.0.1:3000/login?next=/")).toMatchObject({
      origin: "http://100.64.0.1:3000",
    });
  });

  it("refuses an empty address", () => {
    expect(normalizeAddress("   ")).toMatchObject({ ok: false });
  });
});
