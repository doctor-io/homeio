import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildTunnelUrl,
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
});
