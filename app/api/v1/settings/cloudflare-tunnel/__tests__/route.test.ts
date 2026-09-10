import { describe, expect, it, vi } from "vitest";

const saveCloudflareTunnelConfig = vi.fn();
const verifyApiToken = vi.fn();

vi.mock("@/lib/server/modules/integrations/cloudflare-tunnel-config", () => ({
  saveCloudflareTunnelConfig: (...args: unknown[]) => saveCloudflareTunnelConfig(...args),
  getCloudflareTunnelConfigPublic: vi.fn(),
  clearCloudflareTunnelConfig: vi.fn(),
}));

vi.mock("@/lib/server/modules/integrations/cloudflare-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/server/modules/integrations/cloudflare-api")
  >("@/lib/server/modules/integrations/cloudflare-api");
  return {
    decodeConnectorToken: actual.decodeConnectorToken,
    verifyApiToken: (...args: unknown[]) => verifyApiToken(...args),
  };
});

import { PUT } from "@/app/api/v1/settings/cloudflare-tunnel/route";

function request(body: unknown) {
  return new Request("http://localhost/api/v1/settings/cloudflare-tunnel", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validConnectorToken = Buffer.from(
  JSON.stringify({ a: "account", t: "tunnel", s: "secret" }),
).toString("base64");

describe("PUT /api/v1/settings/cloudflare-tunnel", () => {
  it("refuses a connector token that does not decode", async () => {
    // Storing one leaves cloudflared crash-looping and, since the account and
    // tunnel ids come out of it, silently disables route creation too.
    const response = await PUT(request({ enabled: true, domain: "example.com", token: "nope" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "validation_error" });
    expect(saveCloudflareTunnelConfig).not.toHaveBeenCalled();
  });

  it("refuses an API token Cloudflare rejects", async () => {
    verifyApiToken.mockRejectedValueOnce(new Error("Invalid API Token"));

    const response = await PUT(
      request({ enabled: true, domain: "example.com", apiToken: "wrong-secret" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/rejected by Cloudflare/i);
    expect(saveCloudflareTunnelConfig).not.toHaveBeenCalled();
  });

  it("stores a connector token that decodes", async () => {
    saveCloudflareTunnelConfig.mockResolvedValueOnce({
      enabled: true,
      domain: "example.com",
      hasToken: true,
      hasApiToken: false,
    });

    const response = await PUT(
      request({ enabled: true, domain: "example.com", token: validConnectorToken }),
    );

    expect(response.status).toBe(200);
    expect(saveCloudflareTunnelConfig).toHaveBeenCalledWith(
      expect.objectContaining({ token: validConnectorToken }),
    );
  });
});
