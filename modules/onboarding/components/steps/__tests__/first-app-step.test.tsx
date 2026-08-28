/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FirstAppStep } from "@/modules/onboarding/components/steps/first-app-step";

function app(id: string, name: string, status = "not_installed") {
  return {
    id,
    name,
    description: "",
    platform: "linux",
    categories: [],
    logoUrl: null,
    repositoryUrl: "",
    stackFile: `${id}.yml`,
    status,
    webUiPort: null,
    updateAvailable: false,
    sourceId: "casaos",
    sourceName: "CasaOS",
    sourceKind: "official",
  };
}

function mockCatalog(payload: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("FirstAppStep", () => {
  it("prefers the catalog's own recommendations", async () => {
    mockCatalog({
      data: [app("jellyfin", "Jellyfin"), app("syncthing", "Syncthing"), app("plex", "Plex")],
      meta: { recommendedAppIds: ["syncthing", "plex"] },
    });
    render(<FirstAppStep selectedAppId={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Syncthing")).toBeTruthy());
    expect(screen.getByText("Plex")).toBeTruthy();
    expect(screen.queryByText("Jellyfin")).toBeNull();
  });

  it("falls back to well-known starters when nothing is recommended", async () => {
    mockCatalog({
      data: [app("jellyfin", "Jellyfin"), app("obscure-thing", "Obscure Thing")],
      meta: {},
    });
    render(<FirstAppStep selectedAppId={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Jellyfin")).toBeTruthy());
  });

  it("hides apps that are already installed", async () => {
    mockCatalog({
      data: [app("jellyfin", "Jellyfin", "running"), app("immich", "Immich")],
      meta: {},
    });
    render(<FirstAppStep selectedAppId={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Immich")).toBeTruthy());
    expect(screen.queryByText("Jellyfin")).toBeNull();
  });

  it("reports the chosen app", async () => {
    mockCatalog({ data: [app("immich", "Immich")], meta: {} });
    const onChange = vi.fn();
    render(<FirstAppStep selectedAppId={null} onChange={onChange} />);

    await waitFor(() => expect(screen.getByText("Immich")).toBeTruthy());
    fireEvent.click(screen.getByText("Immich"));

    expect(onChange).toHaveBeenCalledWith({ id: "immich", name: "Immich" });
  });

  it("clears the choice when the selected tile is clicked again", async () => {
    mockCatalog({ data: [app("immich", "Immich")], meta: {} });
    const onChange = vi.fn();
    render(<FirstAppStep selectedAppId="immich" onChange={onChange} />);

    await waitFor(() => expect(screen.getByText("Immich")).toBeTruthy());
    fireEvent.click(screen.getByText("Immich"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("stays skippable when the catalog cannot be read", async () => {
    mockCatalog({}, false);
    render(<FirstAppStep selectedAppId={null} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/store is on your dock/)).toBeTruthy());
  });
});
