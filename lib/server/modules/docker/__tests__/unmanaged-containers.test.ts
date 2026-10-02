import { describe, expect, it } from "vitest";
import { pickWebUiPort } from "@/lib/server/modules/docker/unmanaged-containers";

describe("pickWebUiPort", () => {
  it("returns null when there are no published ports", () => {
    expect(pickWebUiPort(undefined)).toBeNull();
    expect(pickWebUiPort([])).toBeNull();
  });

  it("ignores ports without a public mapping", () => {
    expect(
      pickWebUiPort([{ PrivatePort: 80, Type: "tcp" }]),
    ).toBeNull();
  });

  it("ignores non-tcp ports", () => {
    expect(
      pickWebUiPort([{ PrivatePort: 53, PublicPort: 53, Type: "udp" }]),
    ).toBeNull();
  });

  it("picks the lowest-numbered published tcp port", () => {
    expect(
      pickWebUiPort([
        { PrivatePort: 443, PublicPort: 8443, Type: "tcp" },
        { PrivatePort: 80, PublicPort: 8080, Type: "tcp" },
        { PrivatePort: 53, PublicPort: 53, Type: "udp" },
      ]),
    ).toBe(8080);
  });
});
