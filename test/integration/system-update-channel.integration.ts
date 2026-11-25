import type { ExecFileException } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import type * as FileSystem from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { coerce, gt, inc } from "semver";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { version as installedVersion } from "../../package.json";

const execFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFile,
}));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof FileSystem>();
  return {
    ...fs,
    existsSync: (filename: Parameters<typeof fs.existsSync>[0]) =>
      filename === "/.dockerenv" ? false : fs.existsSync(filename),
  };
});

let pool: Pool | undefined;

beforeAll(async () => {
  const databaseUrl = process.env.HOMEIO_INTEGRATION_DATABASE_URL;
  if (!databaseUrl) throw new Error("Set HOMEIO_INTEGRATION_DATABASE_URL to a disposable empty PostgreSQL database.");

  vi.stubEnv("DATABASE_URL", databaseUrl);
  vi.stubEnv("HOMEIO_REPO_URL", "https://github.com/doctor-io/homeio.git");
  vi.stubEnv("HOMEIO_REPO_BRANCH", "");
  vi.stubEnv("HOMEIO_CONTAINER", "");
  vi.stubEnv("DOCKER", "");
  vi.stubEnv("AUTH_SESSION_SECRET", "homeio-update-integration-test-secret");
  vi.stubEnv("LOG_TO_FILE", "false");

  const { pgPool } = await import("@/lib/server/db/postgres");
  pool = pgPool;
  const { rows } = await pool.query<{ present: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS present",
  );
  if (rows[0].present) throw new Error("The integration test requires an empty database.");
  const { db } = await import("@/lib/server/db/drizzle");
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await pool?.end();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("persists Beta and schedules exactly the advertised GitHub pre-release", async () => {
  const stableVersion = coerce(installedVersion)?.version;
  const betaSeries = stableVersion && inc(stableVersion, "major");
  if (!stableVersion || !betaSeries) throw new Error("The package version must use SemVer.");
  const beta = `${betaSeries}-beta.10`;
  const olderBeta = `${betaSeries}-beta.2`;
  const stableTag = `v${stableVersion}`;
  let latestStableTag = stableTag;

  const github = "https://api.github.com/repos/doctor-io/homeio/releases";
  const betaReleaseUrl = `${github}?per_page=100&page=1`;
  const betaReleases = () => Response.json([
    { tag_name: `v${olderBeta}`, prerelease: true, draft: false },
    { tag_name: `v${betaSeries}-beta.20`, prerelease: true, draft: true },
    { tag_name: stableTag, prerelease: false, draft: false },
    { tag_name: `v${beta}`, prerelease: true, draft: false },
  ]);
  const fetchMock = vi.fn(async (url: string) => {
    if (url === `${github}/latest`) return Response.json({ tag_name: latestStableTag });
    if (url === betaReleaseUrl) return betaReleases();
    throw new Error(`Unexpected network request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  execFile.mockImplementation((
    command: string,
    _args: string[],
    callback: (error: ExecFileException | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    if (!["which", "systemctl", "systemd-run"].includes(command)) {
      throw new Error(`Unexpected process: ${command}`);
    }
    callback(null, { stdout: "", stderr: "" });
  });

  const { loginUser, registerUser } = await import("@/lib/server/modules/auth/service");
  const { getAuthCookieName } = await import("@/lib/server/modules/auth/cookies");
  const login = { username: "update-test", password: "integration-fixture-password" };
  await registerUser({ ...login, confirmPassword: login.password });
  const session = await loginUser(login);
  if (session.kind !== "session") throw new Error("Expected an authenticated test session.");
  const sessionToken = session.token;

  const channel = await import("@/app/api/v1/system/updates/channel/route");
  const status = await import("@/app/api/v1/system/updates/route");
  const check = await import("@/app/api/v1/system/updates/check/route");
  const apply = await import("@/app/api/v1/system/updates/apply/route");
  const { pgPool } = await import("@/lib/server/db/postgres");
  const { resetUpdateStatusCacheForTests } = await import("@/lib/server/modules/system/update-service");
  const base = "http://localhost/api/v1/system/updates";

  function request(suffix = "", method = "GET", body?: object) {
    return new NextRequest(`${base}${suffix}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: { cookie: `${getAuthCookieName()}=${sessionToken}`, "Content-Type": "application/json" },
    });
  }

  expect((await channel.GET(new Request(`${base}/channel`))).status).toBe(401);
  expect(await (await channel.GET(request("/channel"))).json()).toEqual({
    data: { channel: "stable", disabledReason: null },
  });
  expect(await (await status.GET(request())).json()).toMatchObject({
    data: {
      currentVersion: installedVersion,
      latestVersion: stableVersion,
      updateAvailable: gt(stableVersion, installedVersion),
    },
  });

  expect((await channel.PUT(request("/channel", "PUT", { channel: "beta" }))).status).toBe(200);
  expect((await pgPool.query("SELECT update_channel FROM settings WHERE id = 'singleton'")).rows)
    .toEqual([{ update_channel: "beta" }]);
  resetUpdateStatusCacheForTests();
  expect(await (await channel.GET(request("/channel"))).json()).toMatchObject({
    data: { channel: "beta" },
  });
  const checked = await check.POST(request("/check", "POST"));
  expect(checked.status).toBe(200);
  expect(await checked.json()).toMatchObject({
    data: { latestVersion: beta, updateAvailable: true },
  });

  expect((await apply.POST(request(`/apply?version=${olderBeta}`, "POST"))).status).toBe(409);
  expect((await apply.POST(request(`/apply?version=${beta}`, "POST"))).status).toBe(202);

  const lookupStarted = Promise.withResolvers<void>();
  const pendingLookup = Promise.withResolvers<Response>();
  fetchMock.mockImplementationOnce(async (url) => {
    expect(url).toBe(betaReleaseUrl);
    lookupStarted.resolve();
    return pendingLookup.promise;
  });
  const pendingApply = apply.POST(request(`/apply?version=${beta}`, "POST"));
  await Promise.race([lookupStarted.promise, pendingApply.then(() => {
    throw new Error("The update request completed before querying GitHub for Beta releases.");
  })]);
  latestStableTag = "v0.0.0";
  resetUpdateStatusCacheForTests();
  try {
    expect((await channel.PUT(request("/channel", "PUT", { channel: "stable" }))).status).toBe(200);
  } finally {
    pendingLookup.resolve(betaReleases());
  }
  const staleApply = await pendingApply;
  expect(staleApply.status).toBe(409);
  expect(await staleApply.json()).toMatchObject({ error: expect.stringContaining("channel has changed") });

  expect((await apply.POST(request(`/apply?version=${beta}`, "POST"))).status).toBe(409);
  expect(await (await status.GET(request())).json()).toMatchObject({
    data: { latestVersion: "0.0.0", updateAvailable: false },
  });
  const downgrade = await apply.POST(request("/apply?version=0.0.0", "POST"));
  expect(downgrade.status).toBe(409);
  expect(await downgrade.json()).toMatchObject({ error: expect.stringContaining("no newer Homeio version") });

  const launches = execFile.mock.calls.filter(([command]) => command === "systemd-run");
  expect(launches).toEqual([["systemd-run", expect.arrayContaining([
    `--setenv=HOMEIO_REPO_BRANCH=v${beta}`,
    "--setenv=HOMEIO_REPO_URL=https://github.com/doctor-io/homeio.git",
  ]), expect.any(Function)]]);
});
