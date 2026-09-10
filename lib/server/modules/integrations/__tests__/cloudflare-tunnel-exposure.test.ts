import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildTunnelUrl,
  resolveOriginHost,
  toSubdomain,
} from "@/lib/server/modules/integrations/cloudflare-tunnel-exposure";

describe("cloudflare tunnel exposure", () => {
  it("turns app names into DNS labels", () => {
    expect(toSubdomain("Home Assistant")).toBe("home-assistant");
    expect(toSubdomain("  Nextcloud!  ")).toBe("nextcloud");
    expect(toSubdomain("2FAuth")).toBe("2fauth");
    expect(toSubdomain("--weird--name--")).toBe("weird-name");
  });

  it("keeps labels within the 63 character DNS limit", () => {
    expect(toSubdomain("a".repeat(100))).toHaveLength(63);
  });

  it("builds the public address without a port", () => {
    // A tunnel serves on 443, so appending the app's port would break the link.
    expect(buildTunnelUrl("jellyfin", "example.com")).toBe("https://jellyfin.example.com");
  });

  it("has no address until both parts are known", () => {
    expect(buildTunnelUrl("", "example.com")).toBeNull();
    expect(buildTunnelUrl("jellyfin", "")).toBeNull();
  });

  it("prefers a reachable address over localhost for the tunnel origin", () => {
    // A connector on another machine resolves localhost to itself and answers
    // 502, so the origin has to be an address every connector can reach.
    expect(resolveOriginHost()).not.toBe("localhost");
  });

  it("lets the operator override the origin host", () => {
    const previous = process.env.HOMEIO_TUNNEL_ORIGIN_HOST;
    process.env.HOMEIO_TUNNEL_ORIGIN_HOST = "10.0.0.5";
    try {
      expect(resolveOriginHost()).toBe("10.0.0.5");
    } finally {
      if (previous === undefined) delete process.env.HOMEIO_TUNNEL_ORIGIN_HOST;
      else process.env.HOMEIO_TUNNEL_ORIGIN_HOST = previous;
    }
  });
});
