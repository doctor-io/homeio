import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db/drizzle", () => ({
  db: {
    execute: vi.fn(),
    insert: vi.fn(),
  },
}));

import { db } from "@/lib/server/db/drizzle";
import { upsertCustomStoreTemplate } from "@/lib/server/modules/store/custom-apps";

const COMPOSE = "services:\n  web:\n    image: nginx:latest\n    ports:\n      - '8080:80'\n";

type Captured = Record<string, unknown>;

function mockInsert() {
  const captured: { values?: Captured; set?: Captured } = {};

  vi.mocked(db.execute).mockResolvedValue({
    rows: [{ table_exists: "custom_store_apps" }],
  } as never);

  vi.mocked(db.insert).mockReturnValue({
    values: (values: Captured) => {
      captured.values = values;
      return {
        onConflictDoUpdate: ({ set }: { set: Captured }) => {
          captured.set = set;
          return {
            returning: async () => [
              {
                appId: "custom-test-app",
                name: "Test App",
                iconUrl: null,
                webUiUrl: null,
                sourceType: values.sourceType,
                sourceText: values.sourceText,
                composeContent: values.composeContent,
                repositoryUrl: null,
                sourceUrl: values.sourceUrl ?? null,
                sourceRef: values.sourceRef ?? null,
                sourceChecksum: values.sourceChecksum ?? null,
                lastImportedAt: values.lastImportedAt ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ],
          };
        },
      };
    },
  } as never);

  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertCustomStoreTemplate provenance", () => {
  it("records where an imported compose file came from", async () => {
    const captured = mockInsert();

    const template = await upsertCustomStoreTemplate({
      name: "Test App",
      sourceType: "url",
      sourceText: COMPOSE,
      sourceUrl: "https://raw.githubusercontent.com/acme/stack/main/compose.yml",
      sourceRef: "9f2c1ab",
    });

    expect(captured.values?.sourceUrl).toBe(
      "https://raw.githubusercontent.com/acme/stack/main/compose.yml",
    );
    expect(captured.values?.sourceRef).toBe("9f2c1ab");
    expect(captured.values?.sourceChecksum).toHaveLength(64);
    expect(captured.values?.lastImportedAt).toBeInstanceOf(Date);
    expect(template.sourceUrl).toBe(
      "https://raw.githubusercontent.com/acme/stack/main/compose.yml",
    );
  });

  it("leaves provenance empty for a pasted compose file", async () => {
    const captured = mockInsert();

    const template = await upsertCustomStoreTemplate({
      name: "Test App",
      sourceType: "docker-compose",
      sourceText: COMPOSE,
    });

    expect(captured.values?.sourceUrl).toBeNull();
    expect(captured.values?.sourceChecksum).toBeNull();
    expect(captured.values?.lastImportedAt).toBeNull();
    expect(template.sourceUrl).toBeNull();
  });

  it("clears stale provenance when an imported app is re-saved by hand", async () => {
    // The conflict branch must write the same nulls as the insert branch,
    // otherwise an edited import keeps claiming a URL it no longer tracks.
    const captured = mockInsert();

    await upsertCustomStoreTemplate({
      name: "Test App",
      sourceType: "docker-compose",
      sourceText: COMPOSE,
    });

    expect(captured.set?.sourceUrl).toBeNull();
    expect(captured.set?.sourceRef).toBeNull();
    expect(captured.set?.sourceChecksum).toBeNull();
    expect(captured.set?.lastImportedAt).toBeNull();
  });

  it("accepts a fetched document as compose, not as a new format", async () => {
    const captured = mockInsert();

    const template = await upsertCustomStoreTemplate({
      name: "Test App",
      sourceType: "url",
      sourceText: COMPOSE,
      sourceUrl: "https://example.com/compose.yml",
    });

    expect(captured.values?.sourceType).toBe("url");
    expect(String(captured.values?.composeContent)).toContain("nginx:latest");
    expect(template.sourceType).toBe("url");
  });

  it("rejects a fetched document that is not valid compose", async () => {
    mockInsert();

    await expect(
      upsertCustomStoreTemplate({
        name: "Test App",
        sourceType: "url",
        sourceText: "<!doctype html><html>404 not found</html>",
        sourceUrl: "https://example.com/oops.html",
      }),
    ).rejects.toThrow();
  });
});
