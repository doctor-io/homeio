import { describe, expect, it, vi } from "vitest";

const { mockDecrypt, mockSelect } = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@/lib/server/modules/files/secrets", () => ({
  decryptSecret: mockDecrypt,
  encryptSecret: vi.fn(),
}));

vi.mock("@/lib/server/db/drizzle", () => ({
  db: { select: mockSelect, insert: vi.fn(), update: vi.fn(), execute: vi.fn(async () => undefined) },
}));

import {
  CloudflareSecretUnreadableError,
  getCloudflareTunnelConfig,
} from "@/lib/server/modules/integrations/cloudflare-tunnel-config";

function rowWithSealedSecrets() {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => [
    {
      enabled: true,
      domain: "example.test",
      tokenCiphertext: "ct",
      tokenIv: "iv",
      tokenTag: "tag",
      apiCiphertext: null,
      apiIv: null,
      apiTag: null,
    },
  ]);
  mockSelect.mockReturnValue(chain);
}

describe("a secret sealed with another key (D-17)", () => {
  it("says the token cannot be opened, and what to do", async () => {
    // The key comes from AUTH_SESSION_SECRET, and the container entrypoint
    // regenerates that on every boot when it cannot persist it. The decrypt
    // then throws "Unsupported state or unable to authenticate data" and the
    // route reported an internal error about itself — sending the operator to
    // look at the server rather than at the token.
    rowWithSealedSecrets();
    mockDecrypt.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });

    await expect(getCloudflareTunnelConfig()).rejects.toBeInstanceOf(
      CloudflareSecretUnreadableError,
    );
  });

  it("names the secret and keeps the original cause", async () => {
    rowWithSealedSecrets();
    const cause = new Error("Unsupported state or unable to authenticate data");
    mockDecrypt.mockImplementation(() => {
      throw cause;
    });

    const error = await getCloudflareTunnelConfig().catch((thrown) => thrown);

    expect(error.message).toContain("tunnel token");
    expect(error.message).toContain("AUTH_SESSION_SECRET");
    expect(error.code).toBe("secret_unreadable");
    expect(error.cause).toBe(cause);
  });

  it("does not turn a readable secret into an error", async () => {
    // The control: this must fire only when the secret really cannot be opened.
    rowWithSealedSecrets();
    mockDecrypt.mockReturnValue("the-real-token");

    await expect(getCloudflareTunnelConfig()).resolves.toMatchObject({
      token: "the-real-token",
    });
  });
});
