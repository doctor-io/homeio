import { describe, expect, it } from "vitest";
import { analyzeComposeDocument } from "@/lib/server/modules/store/compose-validation";
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

  it("ignores surrounding whitespace, so the writer and the update check agree", () => {
    // These hashed differently once, which made every imported app report
    // itself as changed the moment it was checked.
    const raw = "services:\n  web:\n    image: nginx\n";
    expect(checksumSource(raw)).toBe(checksumSource(`\n${raw}   `));
  });
});

describe("docker run conversion reports what it drops (D-9)", () => {
  it("names the flags it cannot translate", () => {
    // Measured before the fix: this exact command produced a container with
    // Privileged=false, NetworkMode=<default>, PidMode empty and CapAdd=[] —
    // none of what was asked for, and not a word about it.
    const compose = convertDockerRunToCompose(
      "docker run -d --name pi --privileged --network host --pid host --cap-add SYS_ADMIN alpine sleep 300",
      "fallback",
    );

    expect(compose).toContain("dockerRunNotCarriedOver");
    for (const flag of ["--privileged", "--network host", "--pid host", "--cap-add SYS_ADMIN"]) {
      expect(compose).toContain(flag);
    }
  });

  it("stays quiet about flags a compose file has no use for", () => {
    const compose = convertDockerRunToCompose(
      "docker run -d --rm --name quiet -p 8080:80 -e TZ=Europe/Paris alpine",
      "fallback",
    );

    expect(compose).not.toContain("dockerRunNotCarriedOver");
    expect(compose).toContain("8080:80");
    expect(compose).toContain("TZ=Europe/Paris");
  });

  it("keeps the notice out of the way of the document itself", () => {
    const compose = convertDockerRunToCompose(
      "docker run --name x --privileged alpine",
      "fallback",
    );

    // Still a compose document: the notice is an x- extension, which the
    // validator allows and a round trip through js-yaml keeps.
    expect(compose.split("\n")[0]).toBe("services:");
    expect(() => analyzeComposeDocument(compose)).not.toThrow();
  });
});

describe("a valueless flag does not swallow the image (D-10)", () => {
  it("converts a command whose last flag is a bare switch", () => {
    // Before: "Invalid docker run command: image is required", about a command
    // whose image is right there. The fallback treated `--privileged alpine` as
    // a flag and its argument.
    const compose = convertDockerRunToCompose(
      "docker run --name x --privileged alpine",
      "fallback",
    );

    expect(compose).toContain("image: 'alpine'");
    expect(compose).toContain("container_name: 'x'");
  });

  it("still reads a flag that genuinely takes a value", () => {
    const compose = convertDockerRunToCompose(
      "docker run --name y --cap-add SYS_ADMIN alpine sleep 5",
      "fallback",
    );

    expect(compose).toContain("image: 'alpine'");
    expect(compose).toContain("--cap-add SYS_ADMIN");
    expect(compose).toContain("command: 'sleep 5'");
  });

  it("was hidden by ordering, so both orders are held", () => {
    for (const command of [
      "docker run --privileged --network host alpine",
      "docker run --network host --privileged alpine",
    ]) {
      expect(convertDockerRunToCompose(command, "fallback")).toContain("image: 'alpine'");
    }
  });
});
