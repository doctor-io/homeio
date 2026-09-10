import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/logging/logger", () => ({ logServerAction: vi.fn() }));

import {
  decodeConnectorToken,
  normalizeConnectorToken,
} from "@/lib/server/modules/integrations/cloudflare-api";

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

describe("normalizeConnectorToken", () => {
  const token = Buffer.from(
    JSON.stringify({ a: "acct-123", t: "tunnel-456", s: "secret" }),
  ).toString("base64");

  it("accepts the install command Cloudflare actually shows you", () => {
    // The dashboard gives a command, not a bare token, and that is what people
    // copy. Rejecting it sent one operator round in circles.
    expect(normalizeConnectorToken(`sudo cloudflared service install ${token}`)).toBe(token);
  });

  it("accepts the docker form too", () => {
    expect(
      normalizeConnectorToken(
        `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${token}`,
      ),
    ).toBe(token);
  });

  it("accepts a bare token, and trims it", () => {
    expect(normalizeConnectorToken(`  ${token}  `)).toBe(token);
  });

  it("hands anything unusable back for validation to reject", () => {
    expect(normalizeConnectorToken("  not a token  ")).toBe("not a token");
    // Looks like a token, is not one: must not be mistaken for valid.
    expect(decodeConnectorToken(normalizeConnectorToken("eyJub3BlIjoxfQ=="))).toBeNull();
  });
});
