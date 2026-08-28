import { describe, expect, it } from "vitest";
import {
  checksumSource,
  convertDockerRunToCompose,
} from "@/lib/server/modules/store/custom-apps";

describe("custom store app helpers", () => {
  it("converts docker run command to compose content", () => {
    const compose = convertDockerRunToCompose(
      "docker run --name myapp -p 8080:80 -e TZ=UTC -v /data:/config nginx:latest",
      "My App",
    );

    expect(compose).toContain("services:");
    expect(compose).toContain("myapp:");
    expect(compose).toContain("image: 'nginx:latest'");
    expect(compose).toContain("- '8080:80'");
    expect(compose).toContain("- 'TZ=UTC'");
    expect(compose).toContain("- '/data:/config'");
  });

  it("throws on invalid docker run input", () => {
    expect(() =>
      convertDockerRunToCompose("docker pull nginx:latest", "Bad Command"),
    ).toThrow("docker run");
  });
});

describe("custom store app provenance", () => {
  it("hashes the source so a later import can tell whether upstream changed", () => {
    const a = checksumSource("services:\n  web:\n    image: nginx\n");
    const b = checksumSource("services:\n  web:\n    image: nginx\n");
    const c = checksumSource("services:\n  web:\n    image: caddy\n");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});
