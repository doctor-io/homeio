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

describe("IPv6 hosts (D-7)", () => {
  /** The refusal must come from the check, not from DNS failing to parse brackets. */
  async function refusalFor(url: string) {
    mockFetch(response(COMPOSE));
    try {
      await fetchComposeFromUrl(url);
      return "accepted";
    } catch (error) {
      return error instanceof ComposeImportError ? error.code : "other";
    }
  }

  it.each([
    ["https://[::1]/compose.yml", "loopback"],
    ["https://[::ffff:127.0.0.1]/compose.yml", "mapped loopback"],
    ["https://[::ffff:169.254.169.254]/compose.yml", "mapped cloud metadata"],
    ["https://[::ffff:192.168.1.43]/compose.yml", "mapped LAN"],
    ["https://[fd00::1]/compose.yml", "unique local"],
    ["https://[fe80::1]/compose.yml", "link-local"],
  ])("refuses %s as private, by the check and not by DNS", async (url) => {
    // `URL.hostname` keeps the brackets, so isIP said 0 and every one of these
    // reached DNS instead of isPrivateAddress. They were refused — as
    // `dns_failed`, which is a refusal by accident.
    await expect(refusalFor(url)).resolves.toBe("private_host");
  });

  it("reads a mapped address in the hex form URL produces, not only the dotted one", async () => {
    // new URL("https://[::ffff:127.0.0.1]") normalises the tail to ::ffff:7f00:1.
    // Matching only /^::ffff:(\d+\.\d+\.\d+\.\d+)$/ calls that public.
    expect(new URL("https://[::ffff:127.0.0.1]/x").hostname).toBe("[::ffff:7f00:1]");
    await expect(refusalFor("https://[::ffff:127.0.0.1]/x")).resolves.toBe("private_host");
  });

  it("still imports from a public IPv6 host", async () => {
    // The other half of the defect: no IPv6 literal could be imported at all,
    // because a bracketed string never resolves.
    mockFetch(response(COMPOSE));
    await expect(
      fetchComposeFromUrl("https://[2606:4700:4700::1111]/compose.yml"),
    ).resolves.toMatchObject({ content: COMPOSE });
  });

  it("still imports from a public mapped IPv4", async () => {
    mockFetch(response(COMPOSE));
    await expect(
      fetchComposeFromUrl("https://[::ffff:8.8.8.8]/compose.yml"),
    ).resolves.toMatchObject({ content: COMPOSE });
  });
});
