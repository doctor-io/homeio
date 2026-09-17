import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/db/drizzle", () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
  },
}));

import { ONBOARDING_LAST_STEP } from "@/lib/shared/contracts/onboarding";
import { db } from "@/lib/server/db/drizzle";
import {
  findOnboardingRow,
  markOnboardingComplete,
  markOnboardingPending,
  saveOnboardingProgress,
} from "@/lib/server/modules/onboarding/repository";

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit"]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  chain.catch = (reject: (r: unknown) => unknown) => Promise.resolve(rows).catch(reject);
  chain.finally = (cb: () => void) => Promise.resolve(rows).finally(cb);
  return chain;
}

/**
 * Static SQL text of a drizzle template, with bound params left out. Nested
 * `sql` fragments carry their own queryChunks, so this recurses rather than
 * dropping them — that is exactly how the "keep the existing value" branches
 * of saveOnboardingProgress are expressed.
 */
function sqlText(query: unknown): string {
  const chunks =
    (query as { queryChunks?: Array<Record<string, unknown>> }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      if (Array.isArray(chunk?.value)) return chunk.value.join("");
      if (chunk && typeof chunk === "object" && "queryChunks" in chunk) return sqlText(chunk);
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function executedStatements() {
  return vi.mocked(db.execute).mock.calls.map(([query]) => sqlText(query));
}

beforeEach(() => {
  vi.mocked(db.select).mockReset();
  vi.mocked(db.execute).mockReset();
  vi.mocked(db.execute).mockResolvedValue(undefined as never);
});

describe("onboarding repository", () => {
  it("returns the settings row when one exists", async () => {
    const row = {
      onboardingState: "pending",
      onboardingStep: 2,
      onboardingCompletedAt: null,
      timezone: "Europe/Paris",
      defaultStorageRoot: "/DATA",
    };
    vi.mocked(db.select).mockReturnValue(makeSelectChain([row]) as never);

    await expect(findOnboardingRow()).resolves.toEqual(row);
  });

  it("returns null when the settings row is missing", async () => {
    vi.mocked(db.select).mockReturnValue(makeSelectChain([]) as never);

    await expect(findOnboardingRow()).resolves.toBeNull();
  });

  it("only marks onboarding pending when the state has never been set", async () => {
    await markOnboardingPending();

    const update = executedStatements().find((text) => text.includes("SET onboarding_state"));
    expect(update).toContain("'pending'");
    // The guard is what makes this safe to replay: db:init re-runs every
    // migration and the container re-runs push on each start.
    expect(update).toContain("onboarding_state IS NULL");
  });

  it("keeps the stored timezone when a step does not supply one", async () => {
    await saveOnboardingProgress({ step: 3 });

    const update = executedStatements().find((text) => text.includes("SET onboarding_step"));
    expect(update).toContain("timezone = timezone");
    expect(update).toContain("default_storage_root = default_storage_root");
  });

  it("writes supplied values as bound parameters", async () => {
    await saveOnboardingProgress({ step: 2, timezone: "Europe/Paris" });

    const update = executedStatements().find((text) => text.includes("SET onboarding_step"));
    expect(update).not.toContain("timezone = timezone");
    expect(update).toContain("default_storage_root = default_storage_root");
  });

  it("refuses to progress or complete an install that is not mid-wizard", async () => {
    await saveOnboardingProgress({ step: 2 });
    await markOnboardingComplete();

    for (const text of executedStatements().filter((t) => t.startsWith("UPDATE settings"))) {
      expect(text).toMatch(/onboarding_state = 'pending'|onboarding_state IS NULL/);
    }
  });

  it("completing stamps the finished timestamp", async () => {
    await markOnboardingComplete();

    const update = executedStatements().find((text) => text.includes("onboarding_completed_at"));
    expect(update).toContain("onboarding_state = 'complete'");
    expect(update).toContain("onboarding_completed_at = NOW()");
  });
});

describe("completing the wizard records the last step (D-14)", () => {
  it("writes ONBOARDING_LAST_STEP, not a number typed out beside it", async () => {
    // It wrote 5 while the wizard has six steps, so finishing at step 6 moved
    // the stored progress backwards. Measured: database at 6, complete called,
    // database at 5.
    vi.mocked(db.execute).mockResolvedValue(undefined as never);

    await markOnboardingComplete();

    const statement = vi.mocked(db.execute).mock.calls.at(-1)?.[0] as {
      queryChunks?: unknown[];
    };
    const values = JSON.stringify(statement);

    expect(values).toContain(String(ONBOARDING_LAST_STEP));
    expect(ONBOARDING_LAST_STEP).toBe(6);
  });
});
