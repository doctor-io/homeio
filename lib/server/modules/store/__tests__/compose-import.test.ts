import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));

import { ComposeImportError, fetchComposeFromUrl } from "@/lib/server/modules/store/compose-import";

const COMPOSE = "services:\n  web:\n    image: nginx\n";

function publicDns() {
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const value of responses) fetchMock.mockResolvedValueOnce(value);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchComposeFromUrl", () => {
  it("returns the document from a public https URL", async () => {
    publicDns();
    mockFetch(response(COMPOSE));

    const result = await fetchComposeFromUrl("https://example.com/compose.yml");

    expect(result.content).toBe(COMPOSE);
    expect(result.url).toBe("https://example.com/compose.yml");
  });

  it("refuses a literal loopback address", async () => {
    mockFetch(response(COMPOSE));

    await expect(fetchComposeFromUrl("https://127.0.0.1/compose.yml")).rejects.toMatchObject({
      code: "private_host",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a hostname that resolves into a private range", async () => {
    // The whole point of resolving first: a public-looking name can answer 10.x.
    mockLookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
    mockFetch(response(COMPOSE));

    await expect(fetchComposeFromUrl("https://sneaky.example/compose.yml")).rejects.toMatchObject({
      code: "private_host",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses the cloud metadata address", async () => {
    mockFetch(response(COMPOSE));

    await expect(
      fetchComposeFromUrl("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toMatchObject({ code: "private_host" });
  });

  it("refuses IPv6 loopback and unique-local addresses", async () => {
    mockFetch(response(COMPOSE));

    await expect(fetchComposeFromUrl("https://[::1]/compose.yml")).rejects.toMatchObject({
      code: "private_host",
    });
    await expect(fetchComposeFromUrl("https://[fd00::1]/compose.yml")).rejects.toMatchObject({
      code: "private_host",
    });
  });

  it("re-checks every redirect hop, not just the first URL", async () => {
    // A public URL that redirects to the metadata endpoint is the actual attack.
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    mockFetch(
      response("", { status: 302, headers: { location: "http://169.254.169.254/latest/" } }),
    );

    await expect(fetchComposeFromUrl("https://example.com/compose.yml")).rejects.toMatchObject({
      code: "insecure_url",
    });
  });

  it("follows a redirect to another public host", async () => {
    publicDns();
    mockFetch(
      response("", { status: 302, headers: { location: "https://cdn.example.com/c.yml" } }),
      response(COMPOSE),
    );

    const result = await fetchComposeFromUrl("https://example.com/compose.yml");

    expect(result.url).toBe("https://cdn.example.com/c.yml");
    expect(result.content).toBe(COMPOSE);
  });

  it("gives up rather than following a redirect loop", async () => {
    publicDns();
    const redirect = () =>
      response("", { status: 302, headers: { location: "https://example.com/next" } });
    mockFetch(redirect(), redirect(), redirect(), redirect(), redirect());

    await expect(fetchComposeFromUrl("https://example.com/compose.yml")).rejects.toMatchObject({
      code: "too_many_redirects",
    });
  });

  it("rejects a declared length over the cap before reading the body", async () => {
    publicDns();
    mockFetch(response(COMPOSE, { headers: { "content-length": "9000000" } }));

    await expect(
      fetchComposeFromUrl("https://example.com/compose.yml", { maxBytes: 1_000 }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("stops reading a body that lies about its length", async () => {
    publicDns();
    mockFetch(response("x".repeat(5_000)));

    await expect(
      fetchComposeFromUrl("https://example.com/compose.yml", { maxBytes: 1_000 }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("reports an upstream error status instead of swallowing it", async () => {
    publicDns();
    mockFetch(response("not found", { status: 404 }));

    await expect(fetchComposeFromUrl("https://example.com/nope.yml")).rejects.toMatchObject({
      code: "fetch_failed",
      statusCode: 404,
    });
  });

  it("refuses plain http unless LAN sources are allowed", async () => {
    publicDns();
    mockFetch(response(COMPOSE));

    await expect(fetchComposeFromUrl("http://example.com/c.yml")).rejects.toBeInstanceOf(
      ComposeImportError,
    );
  });

  it("allows a LAN address once the operator opts in", async () => {
    mockFetch(response(COMPOSE));

    const result = await fetchComposeFromUrl("http://192.168.1.10/compose.yml", {
      allowPrivateHosts: true,
    });

    expect(result.content).toBe(COMPOSE);
  });

  it("rejects a non-http protocol outright", async () => {
    await expect(fetchComposeFromUrl("file:///etc/passwd")).rejects.toMatchObject({
      code: "invalid_url",
    });
  });
});
