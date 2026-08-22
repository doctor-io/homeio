import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SOURCE_ROOTS = ["app", "components", "hooks", "lib", "modules"];
const FEATURE_MODULES = [
  "modules/apps",
  "modules/files",
  "modules/onboarding",
  "modules/settings",
  "modules/system",
];
const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;
const CURRENT_TEST_FILE = join(
  REPO_ROOT,
  "modules",
  "__tests__",
  "architecture-boundaries.test.ts",
);

function isTestFile(filePath: string) {
  return (
    filePath.includes("/__tests__/") ||
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx")
  );
}

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
      continue;
    }

    if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function readImports(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("module boundaries", () => {
  it("does not import feature code from the legacy desktop bucket", () => {
    const files = SOURCE_ROOTS
      .flatMap((root) => listSourceFiles(join(REPO_ROOT, root)))
      .filter((filePath) => filePath !== CURRENT_TEST_FILE);

    const offenders = files.filter((filePath) =>
      readImports(filePath).includes('from "@/components/desktop/')
    );

    expect(offenders).toEqual([]);
  });

  it("keeps feature modules independent from shell internals", () => {
    const files = FEATURE_MODULES.flatMap((root) => listSourceFiles(join(REPO_ROOT, root)));

    const offenders = files.filter((filePath) =>
      readImports(filePath).includes('from "@/modules/shell/')
    );

    expect(offenders).toEqual([]);
  });

  it("keeps feature-owned hooks out of the top-level hooks bucket", () => {
    const files = SOURCE_ROOTS
      .flatMap((root) => listSourceFiles(join(REPO_ROOT, root)))
      .filter((filePath) => filePath !== CURRENT_TEST_FILE);

    const offenders = files.filter((filePath) => {
      const source = readImports(filePath);

      return (
        source.includes('from "@/hooks/useInstalledApps"') ||
        source.includes('from "@/hooks/useStoreActions"') ||
        source.includes('from "@/hooks/useStoreApp"') ||
        source.includes('from "@/hooks/useStoreCatalog"') ||
        source.includes('from "@/hooks/useStoreOperation"') ||
        source.includes('from "@/hooks/useFiles"') ||
        source.includes('from "@/hooks/useLocalFolderShares"') ||
        source.includes('from "@/hooks/useNetworkShares"') ||
        source.includes('from "@/hooks/useTrashActions"') ||
        source.includes('from "@/hooks/useSettingsBackend"') ||
        source.includes('from "@/hooks/useDesktopAppearance"') ||
        source.includes('from "@/hooks/useRebootRecovery"') ||
        source.includes('from "@/hooks/useTerminalCommand"') ||
        source.includes('from "@/hooks/useCurrentWeather"') ||
        source.includes('from "@/hooks/useDockerInfo"') ||
        source.includes('from "@/hooks/useDockerStats"') ||
        source.includes('from "@/hooks/useNetworkActions"') ||
        source.includes('from "@/hooks/useNetworkEventsSse"') ||
        source.includes('from "@/hooks/useNetworkStatus"') ||
        source.includes('from "@/hooks/useSystemMetrics"') ||
        source.includes('from "@/hooks/useSystemSse"') ||
        source.includes('from "@/hooks/useSystemUpdateStatus"') ||
        source.includes('from "@/hooks/useUserLocation"') ||
        source.includes('from "@/hooks/useWifiNetworks"')
      );
    });

    expect(offenders).toEqual([]);
  });

  it("keeps feature modules independent from app api routes", () => {
    const files = FEATURE_MODULES
      .flatMap((root) => listSourceFiles(join(REPO_ROOT, root)))
      .filter((filePath) => !isTestFile(filePath));

    const offenders = files.filter((filePath) => readImports(filePath).includes('from "@/app/api/'));

    expect(offenders).toEqual([]);
  });

  it("keeps app api routes away from feature ui modules", () => {
    const files = listSourceFiles(join(REPO_ROOT, "app", "api")).filter(
      (filePath) => !isTestFile(filePath),
    );

    const offenders = files.filter((filePath) =>
      readImports(filePath).includes('from "@/modules/'),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps components/desktop limited to tests during the migration", () => {
    const desktopRoot = join(REPO_ROOT, "components", "desktop");
    const offenders = listSourceFiles(desktopRoot).filter(
      (filePath) =>
        !filePath.includes("/__tests__/") &&
        !filePath.endsWith(".test.ts") &&
        !filePath.endsWith(".test.tsx"),
    );

    expect(offenders).toEqual([]);
  });

  /**
   * api/v1 routes that are intentionally exempt from requireApiSession.
   * Currently limited to the Google Drive OAuth handshake: the browser is
   * redirected through Google, and Google's redirect back to /callback may
   * arrive without the homeio session cookie depending on SameSite behaviour.
   * The allowlist must only ever shrink — never grow.
   */
  const V1_AUTH_ALLOWLIST = new Set<string>([
    "app/api/v1/files/google-drive/auth/route.ts",
    "app/api/v1/files/google-drive/callback/route.ts",
  ]);

  const HTTP_HANDLER_PATTERN =
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/;

  it("requires requireApiSession in every new app/api/v1/** route handler", () => {
    const v1Root = join(REPO_ROOT, "app", "api", "v1");
    const routeFiles = listSourceFiles(v1Root)
      .filter((filePath) => !isTestFile(filePath))
      .filter((filePath) => filePath.endsWith("/route.ts"));

    const offenders: string[] = [];
    const staleAllowlistEntries: string[] = [];

    for (const filePath of routeFiles) {
      const source = readImports(filePath);
      if (!HTTP_HANDLER_PATTERN.test(source)) continue;

      const relativePath = filePath.slice(REPO_ROOT.length + 1);
      const hasAuth = source.includes("requireApiSession");
      const allowlisted = V1_AUTH_ALLOWLIST.has(relativePath);

      if (!hasAuth && !allowlisted) {
        offenders.push(relativePath);
      }
      if (hasAuth && allowlisted) {
        // A previously-unauthenticated route now calls requireApiSession;
        // remove it from V1_AUTH_ALLOWLIST so the snapshot keeps shrinking.
        staleAllowlistEntries.push(relativePath);
      }
    }

    expect(offenders, "new v1 routes must call requireApiSession").toEqual([]);
    expect(
      staleAllowlistEntries,
      "remove these from V1_AUTH_ALLOWLIST — they now authenticate",
    ).toEqual([]);
  });
});
