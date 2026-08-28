import { describe, expect, it } from "vitest";
import {
  ComposeRiskError,
  ComposeValidationError,
  analyzeComposeDocument,
  assertComposeAcknowledged,
} from "@/lib/server/modules/store/compose-validation";

const SAFE = `services:
  web:
    image: nginx:latest
    ports:
      - '8080:80'
    volumes:
      - ./data:/usr/share/nginx/html
`;

describe("analyzeComposeDocument — rejects what cannot work", () => {
  it("rejects an empty document", () => {
    expect(() => analyzeComposeDocument("   ")).toThrow(ComposeValidationError);
  });

  it("rejects invalid YAML", () => {
    expect(() => analyzeComposeDocument("services:\n  web:\n   - :::")).toThrow(
      ComposeValidationError,
    );
  });

  it("rejects an HTML page saved as compose", () => {
    // The common case: a GitHub 404 page fetched instead of a raw file.
    expect(() => analyzeComposeDocument("<!doctype html><html>Not Found</html>")).toThrow(
      ComposeValidationError,
    );
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      analyzeComposeDocument("services:\n  web:\n    image: nginx\nsevices:\n  typo: 1\n"),
    ).toThrow(/Unexpected top-level keys: sevices/);
  });

  it("allows x- extensions at the top level", () => {
    const analysis = analyzeComposeDocument(
      "x-casaos:\n  main: web\nservices:\n  web:\n    image: nginx\n",
    );
    expect(analysis.services).toEqual(["web"]);
  });

  it("rejects a document with no services", () => {
    expect(() => analyzeComposeDocument("version: '3'\nservices: {}\n")).toThrow(/no services/);
  });

  it("rejects a service with neither image nor build", () => {
    expect(() => analyzeComposeDocument("services:\n  web:\n    ports:\n      - '80:80'\n")).toThrow(
      /neither an image nor a build/,
    );
  });

  it("accepts a service that builds instead of pulling", () => {
    const analysis = analyzeComposeDocument("services:\n  web:\n    build: .\n");
    expect(analysis.services).toEqual(["web"]);
  });

  it("reports no risks for an ordinary app", () => {
    expect(analyzeComposeDocument(SAFE).risks).toEqual([]);
  });
});

describe("analyzeComposeDocument — reports what hands over the host", () => {
  it("flags privileged", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    privileged: true\n",
    );
    expect(risks).toEqual([
      expect.objectContaining({ code: "privileged", service: "web" }),
    ]);
  });

  it("flags host networking", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    network_mode: host\n",
    );
    expect(risks[0].code).toBe("host_network");
  });

  it("flags the host PID namespace", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    pid: host\n",
    );
    expect(risks[0].code).toBe("host_pid");
  });

  it("flags the Docker socket in short syntax", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: portainer\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
    );
    expect(risks[0]).toMatchObject({ code: "docker_socket" });
    expect(risks[0].detail).toContain("root on the host");
  });

  it("flags the Docker socket in long syntax", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: portainer\n    volumes:\n      - type: bind\n        source: /var/run/docker.sock\n        target: /var/run/docker.sock\n",
    );
    expect(risks[0].code).toBe("docker_socket");
  });

  it("flags a bind mount of the host root", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    volumes:\n      - /:/host\n",
    );
    expect(risks[0]).toMatchObject({ code: "sensitive_mount" });
  });

  it("flags dangerous capabilities", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    cap_add:\n      - SYS_ADMIN\n",
    );
    expect(risks[0].code).toBe("dangerous_capability");
  });

  it("leaves ordinary bind mounts and capabilities alone", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    cap_add:\n      - NET_BIND_SERVICE\n    volumes:\n      - /srv/media:/media\n",
    );
    expect(risks).toEqual([]);
  });

  it("names the service each risk came from", () => {
    const { risks } = analyzeComposeDocument(
      "services:\n  safe:\n    image: nginx\n  risky:\n    image: agent\n    privileged: true\n",
    );
    expect(risks).toHaveLength(1);
    expect(risks[0].service).toBe("risky");
  });
});

describe("assertComposeAcknowledged", () => {
  it("passes a clean document without acknowledgement", () => {
    expect(() => assertComposeAcknowledged(analyzeComposeDocument(SAFE), false)).not.toThrow();
  });

  it("blocks a risky document until it is acknowledged", () => {
    const analysis = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    privileged: true\n",
    );

    expect(() => assertComposeAcknowledged(analysis, false)).toThrow(ComposeRiskError);
    expect(() => assertComposeAcknowledged(analysis, true)).not.toThrow();
  });

  it("carries the risks on the error so the UI can list them", () => {
    const analysis = analyzeComposeDocument(
      "services:\n  web:\n    image: nginx\n    privileged: true\n    network_mode: host\n",
    );

    try {
      assertComposeAcknowledged(analysis, false);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as ComposeRiskError).risks).toHaveLength(2);
    }
  });
});
