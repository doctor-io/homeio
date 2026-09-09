import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/logging/logger", () => ({ logServerAction: vi.fn() }));

import { decodeConnectorToken } from "@/lib/server/modules/integrations/cloudflare-api";

describe("decodeConnectorToken", () => {
  it("reads the account and tunnel ids out of a connector token", () => {
    // Cloudflare hands out base64 of {"a": account, "t": tunnel, "s": secret},
    // so the operator only has to supply the one token.
    const token = Buffer.from(
      JSON.stringify({ a: "acct-123", t: "tunnel-456", s: "secret" }),
    ).toString("base64");

    expect(decodeConnectorToken(token)).toEqual({
      accountId: "acct-123",
      tunnelId: "tunnel-456",
    });
  });

  it("returns null rather than throwing on anything else", () => {
    expect(decodeConnectorToken("not-base64-json")).toBeNull();
    expect(decodeConnectorToken(Buffer.from('{"a":1}').toString("base64"))).toBeNull();
    expect(decodeConnectorToken("")).toBeNull();
  });
});
