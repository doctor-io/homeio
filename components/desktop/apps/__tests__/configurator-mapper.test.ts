import { describe, expect, it } from "vitest";

import {
  buildInstallPayloadFromClassic,
  buildSettingsPayloadFromClassic,
  buildInitialComposeDraft,
  classicStateToCompose,
  composeToClassicState,
  createDefaultClassicState,
  safeComposeToClassicState,
} from "@/modules/apps/components/configurator/configurator-mapper";

describe("configurator-mapper", () => {
  it("maps compose draft to classic state", () => {
    const composeDraft = `services:\n  app:\n    image: ghcr.io/example/app:latest\n    ports:\n      - \"8080:80\"\n    volumes:\n      - \"/data/app:/config\"\n    environment:\n      APP_URL: \"http://example.local:8080\"\n      TZ: \"UTC\"\n    network_mode: bridge\n    restart: unless-stopped\n    privileged: true\n    cap_add:\n      - NET_ADMIN\n    hostname: example-app\n    devices:\n      - /dev/ttyUSB0:/dev/ttyUSB0\n    command: [\"--config\",\"/config/settings.yaml\"]\n`;

    const state = composeToClassicState({
      composeDraft,
      seed: {
        title: "Example",
        iconUrl: "",
        fallbackPort: 8080,
      },
    });

    expect(state.dockerImage).toBe("ghcr.io/example/app:latest");
    expect(state.webUi.port).toBe("8080");
    expect(state.ports[0]?.container).toBe("80");
    expect(state.volumes[0]?.host).toBe("/data/app");
    expect(state.envVars.find((entry) => entry.key === "TZ")?.value).toBe("UTC");
    expect(state.restartPolicy).toBe("unless-stopped");
    expect(state.privileged).toBe(true);
    expect(state.capabilities).toContain("NET_ADMIN");
    expect(state.devices[0]).toBe("/dev/ttyUSB0:/dev/ttyUSB0");
    expect(state.containerCommands).toEqual(["--config", "/config/settings.yaml"]);
  });

  it("maps long syntax ports and volumes to classic state", () => {
    const composeDraft = `services:
  app:
    image: ghcr.io/example/app:latest
    ports:
      - target: 80
        published: 8080
        protocol: tcp
    volumes:
      - type: bind
        source: /data/app
        target: /config
      - type: volume
        source: app-cache
        target: /cache
`;

    const state = composeToClassicState({
      composeDraft,
      seed: {
        title: "Example",
        iconUrl: "",
      },
    });

    expect(state.ports[0]?.host).toBe("8080");
    expect(state.ports[0]?.container).toBe("80");
    expect(state.volumes[0]?.host).toBe("/data/app");
    expect(state.volumes[0]?.container).toBe("/config");
    expect(state.volumes[1]?.host).toBe("app-cache");
    expect(state.volumes[1]?.container).toBe("/cache");
  });

  it("prefers app service over db sidecar when appId matches sidecar name", () => {
    const composeDraft = `services:
  app:
    image: photoprism/photoprism:240915
    ports:
      - "2342:2342"
    network_mode: host
  photoprism-db:
    image: mariadb:10.8
`;

    const state = composeToClassicState({
      composeDraft,
      appId: "photoprism",
      seed: {
        title: "Photoprism",
        iconUrl: "",
      },
    });

    expect(state.dockerImage).toBe("photoprism/photoprism:240915");
    expect(state.webUi.port).toBe("2342");
    expect(state.network).toBe("host");
    expect(state.ports[0]?.host).toBe("2342");
  });

  it("replaces loopback APP_URL host with fallback host for editing", () => {
    const composeDraft = `services:
  app:
    image: ghcr.io/example/app:latest
    environment:
      APP_URL: "http://localhost:3000"
`;

    const state = composeToClassicState({
      composeDraft,
      seed: {
        title: "Example",
        iconUrl: "",
        fallbackPort: 3000,
        fallbackHost: "192.168.1.12",
      },
    });

    expect(state.webUi.host).toBe("192.168.1.12");
    expect(state.webUi.port).toBe("3000");
  });

  it("maps classic state back to compose while keeping unknown top-level fields", () => {
    const seed = createDefaultClassicState({
      title: "Sample",
      iconUrl: "",
      fallbackPort: 8080,
    });

    const nextState = {
      ...seed,
      dockerImage: "nginx:1.27",
      hostname: "sample-app",
      envVars: [{ id: "env-1", key: "TZ", value: "UTC" }],
      ports: [{ id: "p-1", host: "18080", container: "80", protocol: "TCP" as const }],
    };

    const previousCompose = `name: sample-stack\nservices:\n  app:\n    image: old:image\n`;
    const compose = classicStateToCompose(nextState, previousCompose);

    expect(compose).toContain("name: sample-stack");
    expect(compose).toContain("image: nginx:1.27");
    expect(compose).toContain("18080:80");
    expect(compose).toContain("hostname: sample-app");
    expect(compose).toContain("TZ: UTC");
  });

  it("removes ports when network mode is host", () => {
    const seed = createDefaultClassicState({
      title: "Host App",
      iconUrl: "",
      fallbackPort: 8123,
    });

    const compose = classicStateToCompose({
      ...seed,
      network: "host",
      ports: [{ id: "p-1", host: "8123", container: "8123", protocol: "TCP" as const }],
    });

    expect(compose).toContain("network_mode: host");
    expect(compose).not.toContain("ports:");
    expect(compose).not.toContain("8123:8123");
  });

  it("returns parse error for invalid yaml", () => {
    const parsed = safeComposeToClassicState({
      composeDraft: "services:\n  app: [",
      seed: {
        title: "Broken",
        iconUrl: "",
      },
    });

    expect(parsed.state).toBeNull();
    expect(parsed.error).toBeTruthy();
  });

  it("builds install payload including env and web ui port", () => {
    const state = createDefaultClassicState({
      title: "Install Me",
      iconUrl: "",
      fallbackPort: 8080,
      fallbackHost: "localhost",
    });

    const payload = buildInstallPayloadFromClassic({
      appId: "install-me",
      state: {
        ...state,
        envVars: [{ id: "env-1", key: "TZ", value: "UTC" }],
      },
    });

    expect(payload.appId).toBe("install-me");
    expect(payload.webUiPort).toBe(8080);
    expect(payload.env?.TZ).toBe("UTC");
    expect(payload.env?.APP_URL).toContain("localhost:8080");
    expect(payload.env?.VOLUMES).toBeUndefined();
  });

  it("sends the link override on its own, without touching the compose", () => {
    const initial = createDefaultClassicState({
      title: "Reverse Proxied",
      iconUrl: "",
      fallbackPort: 8080,
      fallbackHost: "homeio.example.com",
    });

    const payload = buildSettingsPayloadFromClassic({
      appId: "reverse-proxied",
      current: { ...initial, webUiLink: "https://myapp.example.com" },
      initial,
    });

    expect(payload.webUiUrl).toBe("https://myapp.example.com");
    // Nothing that lives in the compose file changed, so no redeploy.
    expect(payload.webUiPort).toBeUndefined();
    expect(payload.env).toBeUndefined();
  });

  it("clears the link override when the field is emptied", () => {
    const initial = createDefaultClassicState({
      title: "Back To Auto",
      iconUrl: "",
      fallbackPort: 8080,
      fallbackHost: "homeio.example.com",
      webUiLink: "https://myapp.example.com",
    });

    const payload = buildSettingsPayloadFromClassic({
      appId: "back-to-auto",
      current: { ...initial, webUiLink: "  " },
      initial,
    });

    expect(payload.webUiUrl).toBeNull();
  });

  it("leaves the link alone when only the web ui port changes", () => {
    const initial = createDefaultClassicState({
      title: "Port Only",
      iconUrl: "",
      fallbackPort: 8080,
      fallbackHost: "homeio.example.com",
    });

    const payload = buildSettingsPayloadFromClassic({
      appId: "port-only",
      current: { ...initial, webUi: { ...initial.webUi, port: "9090" } },
      initial,
    });

    expect(payload.webUiUrl).toBeUndefined();
    expect(payload.webUiPort).toBe(9090);
  });

  it("keeps the container APP_URL separate from the link override", () => {
    const initial = createDefaultClassicState({
      title: "Two Concerns",
      iconUrl: "",
      fallbackPort: 8080,
      fallbackHost: "homeio.example.com",
    });

    const payload = buildSettingsPayloadFromClassic({
      appId: "two-concerns",
      current: {
        ...initial,
        webUi: { ...initial.webUi, host: "internal.example.com" },
      },
      initial,
    });

    // The Web UI row still composes the container's APP_URL...
    expect(payload.env?.APP_URL).toBe("http://internal.example.com:8080");
    // ...and no longer doubles as the rendered link.
    expect(payload.webUiUrl).toBeUndefined();
  });

  it("does not rebuild compose volumes from legacy VOLUMES env metadata", () => {
    const compose = buildInitialComposeDraft({
      appId: "legacy-app",
      template: {
        id: "legacy-app",
        name: "Legacy App",
        description: "",
        platform: "linux",
        categories: [],
        logoUrl: null,
        repositoryUrl: "",
        stackFile: "docker-compose.yml",
        status: "installed",
        webUiPort: null,
        updateAvailable: false,
        localDigest: null,
        remoteDigest: null,
        note: "",
        env: [],
        screenshots: [],
        installedConfig: {
          appId: "legacy-app",
          templateName: "legacy-app",
          stackName: "legacy-app",
          composePath: "/tmp/docker-compose.yml",
          status: "installed",
          webUiPort: null,
          env: {
            VOLUMES: '[{"host":"/DATA/AppData/legacy-app/data","container":"/data"}]',
          },
          displayName: "Legacy App",
          iconUrl: null,
          installedAt: null,
          updatedAt: new Date().toISOString(),
          isUpToDate: true,
          lastUpdateCheck: null,
          localDigest: null,
          remoteDigest: null,
        },
      },
    });

    expect(compose).not.toContain("/DATA/AppData/legacy-app/data:/data");
    expect(compose).toContain("environment:");
  });

  it("patches only immich primary service and preserves other compose content", () => {
    const immichCompose = `services:
  immich-server:
    image: ghcr.io/immich-app/immich-server:v2.5.0
    ports:
      - "2283:2283"
    depends_on:
      - redis
      - database
    environment:
      TZ: UTC
  immich-machine-learning:
    image: ghcr.io/immich-app/immich-machine-learning:v2.5.0
  redis:
    image: redis:7
  database:
    image: postgres:14
    volumes:
      - pgdata:/var/lib/postgresql/data
networks:
  default:
    name: immich_default
volumes:
  pgdata:
`;

    const parsed = safeComposeToClassicState({
      composeDraft: immichCompose,
      seed: { title: "Immich", iconUrl: "" },
      appId: "immich",
      primaryServiceName: "immich-server",
    });
    expect(parsed.error).toBeNull();
    expect(parsed.state?.dockerImage).toBe("ghcr.io/immich-app/immich-server:v2.5.0");

    const nextCompose = classicStateToCompose(
      {
        ...parsed.state!,
        dockerImage: "ghcr.io/immich-app/immich-server:v2.5.6",
        envVars: [{ id: "env-1", key: "TZ", value: "Europe/Paris" }],
      },
      immichCompose,
      { appId: "immich", primaryServiceName: "immich-server" },
    );

    expect(nextCompose).toContain("immich-server:");
    expect(nextCompose).toContain("image: ghcr.io/immich-app/immich-server:v2.5.6");
    expect(nextCompose).toContain("immich-machine-learning:");
    expect(nextCompose).toContain("redis:");
    expect(nextCompose).toContain("depends_on:");
    expect(nextCompose).toContain("volumes:");
    expect(nextCompose).toContain("pgdata:");
    expect(nextCompose).toContain("networks:");
    expect(nextCompose).not.toContain("\n  app:\n");
  });
});
