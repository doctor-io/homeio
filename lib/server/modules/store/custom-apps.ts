import "server-only";

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import yaml from "js-yaml";
import { db } from "@/lib/server/db/drizzle";
import { customStoreApps } from "@/lib/server/db/schema";
import { withServerTiming } from "@/lib/server/logging/logger";
import {
  parseComposeContentToApp,
  type AppDefinition,
} from "@/lib/server/modules/store/casaos-compose-mapper";
import type { StoreCatalogTemplate } from "@/lib/server/modules/store/catalog";

export type CustomStoreSourceType = "docker-compose" | "docker-run" | "url";

export type CustomStoreTemplate = AppDefinition & {
  isCustom: true;
  sourceType: CustomStoreSourceType;
  composeContent: string;
  sourceText: string;
  sourceUrl: string | null;
  sourceRef: string | null;
  sourceChecksum: string | null;
  lastImportedAt: string | null;
};

export type StoreTemplateSource = StoreCatalogTemplate | CustomStoreTemplate;

type UpsertCustomStoreTemplateInput = {
  name: string;
  iconUrl?: string;
  sourceType: CustomStoreSourceType;
  sourceText: string;
  repositoryUrl?: string;
  /** Where an imported compose file came from. Absent for pasted sources. */
  sourceUrl?: string;
  /** Commit SHA or tag the import was pinned to, when the caller pinned one. */
  sourceRef?: string;
};

const CUSTOM_SOURCE_TYPES: CustomStoreSourceType[] = ["docker-compose", "docker-run", "url"];

/** Detects an upstream change between imports without storing the whole body twice. */
export function checksumSource(sourceText: string) {
  return createHash("sha256").update(sourceText).digest("hex");
}

type ComposeLike = {
  name?: unknown;
  services?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

function normalize(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeServiceName(value: string) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "app";
}

function quoteYaml(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function splitShellCommand(input: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }

      if (char === "\\" && quote === '"' && index + 1 < input.length) {
        current += input[index + 1];
        index += 1;
        continue;
      }

      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (char === "\\" && index + 1 < input.length) {
      current += input[index + 1];
      index += 1;
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Invalid docker run command: unmatched quote");
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function readOptionValue(tokens: string[], index: number) {
  if (index + 1 >= tokens.length) {
    throw new Error(`Invalid docker run command: missing value for ${tokens[index]}`);
  }
  return tokens[index + 1];
}

export function convertDockerRunToCompose(command: string, fallbackServiceName: string) {
  const tokens = splitShellCommand(command.trim());
  let index = 0;

  if (tokens[index] === "docker") {
    index += 1;
  }

  if (tokens[index] === "container" && tokens[index + 1] === "run") {
    index += 2;
  } else if (tokens[index] === "run") {
    index += 1;
  } else {
    throw new Error("Invalid docker run command: must start with `docker run`");
  }

  const env: string[] = [];
  const ports: string[] = [];
  const volumes: string[] = [];
  let containerName = "";

  while (index < tokens.length) {
    const token = tokens[index];

    if (token === "--") {
      index += 1;
      break;
    }

    if (!token.startsWith("-")) {
      break;
    }

    if (token === "--name") {
      containerName = readOptionValue(tokens, index);
      index += 2;
      continue;
    }

    if (token.startsWith("--name=")) {
      containerName = token.slice("--name=".length);
      index += 1;
      continue;
    }

    if (token === "-p" || token === "--publish") {
      ports.push(readOptionValue(tokens, index));
      index += 2;
      continue;
    }

    if (token.startsWith("--publish=")) {
      ports.push(token.slice("--publish=".length));
      index += 1;
      continue;
    }

    if (token.startsWith("-p") && token.length > 2) {
      ports.push(token.slice(2));
      index += 1;
      continue;
    }

    if (token === "-e" || token === "--env") {
      env.push(readOptionValue(tokens, index));
      index += 2;
      continue;
    }

    if (token.startsWith("--env=")) {
      env.push(token.slice("--env=".length));
      index += 1;
      continue;
    }

    if (token.startsWith("-e") && token.length > 2) {
      env.push(token.slice(2));
      index += 1;
      continue;
    }

    if (token === "-v" || token === "--volume") {
      volumes.push(readOptionValue(tokens, index));
      index += 2;
      continue;
    }

    if (token.startsWith("--volume=")) {
      volumes.push(token.slice("--volume=".length));
      index += 1;
      continue;
    }

    if (token.startsWith("-v") && token.length > 2) {
      volumes.push(token.slice(2));
      index += 1;
      continue;
    }

    if (token.includes("=")) {
      index += 1;
      continue;
    }

    if (token.startsWith("--") && index + 1 < tokens.length && !tokens[index + 1].startsWith("-")) {
      index += 2;
      continue;
    }

    index += 1;
  }

  const image = tokens[index];
  if (!image) {
    throw new Error("Invalid docker run command: image is required");
  }
  index += 1;

  const commandArgs = tokens.slice(index);
  const serviceName = sanitizeServiceName(containerName || fallbackServiceName);

  const lines = [
    "services:",
    `  ${serviceName}:`,
    `    image: ${quoteYaml(image)}`,
    "    restart: unless-stopped",
  ];

  if (containerName) {
    lines.push(`    container_name: ${quoteYaml(containerName)}`);
  }

  if (env.length > 0) {
    lines.push("    environment:");
    for (const item of env) {
      lines.push(`      - ${quoteYaml(item)}`);
    }
  }

  if (ports.length > 0) {
    lines.push("    ports:");
    for (const port of ports) {
      lines.push(`      - ${quoteYaml(port)}`);
    }
  }

  if (volumes.length > 0) {
    lines.push("    volumes:");
    for (const volume of volumes) {
      lines.push(`      - ${quoteYaml(volume)}`);
    }
  }

  if (commandArgs.length > 0) {
    lines.push(`    command: ${quoteYaml(commandArgs.join(" "))}`);
  }

  return lines.join("\n");
}

function parseComposeDocument(content: string) {
  const parsed = yaml.load(content) as ComposeLike | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Docker compose source must be valid YAML");
  }

  if (!parsed.services || typeof parsed.services !== "object" || Array.isArray(parsed.services)) {
    throw new Error("Docker compose source must include a services section");
  }

  return parsed;
}

function parseFirstPublishedPort(service: Record<string, unknown>) {
  const ports = service.ports;
  if (!Array.isArray(ports)) return null;

  for (const entry of ports) {
    if (typeof entry === "string") {
      const [mappingPart] = entry.split("/");
      const segments = mappingPart.split(":").filter(Boolean);
      const published = segments.length >= 2 ? segments[segments.length - 2] : segments[0];
      const parsed = Number.parseInt(published, 10);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
        return parsed;
      }
      continue;
    }

    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { published?: unknown; target?: unknown };
    const published = typeof candidate.published === "number" || typeof candidate.published === "string"
      ? Number.parseInt(String(candidate.published), 10)
      : typeof candidate.target === "number" || typeof candidate.target === "string"
        ? Number.parseInt(String(candidate.target), 10)
        : NaN;
    if (Number.isInteger(published) && published >= 1 && published <= 65535) {
      return published;
    }
  }

  return null;
}

function augmentCustomComposeMetadata(input: {
  appId: string;
  name: string;
  iconUrl?: string;
  sourceType: CustomStoreSourceType;
  composeContent: string;
}) {
  const parsed = parseComposeDocument(input.composeContent);
  const services = parsed.services as Record<string, Record<string, unknown>>;
  const existingCasaos =
    parsed["x-casaos"] && typeof parsed["x-casaos"] === "object" && !Array.isArray(parsed["x-casaos"])
      ? (parsed["x-casaos"] as Record<string, unknown>)
      : {};

  const serviceNames = Object.keys(services);
  const mainService =
    typeof existingCasaos.main === "string" && services[existingCasaos.main]
      ? existingCasaos.main
      : serviceNames[0] ?? "app";
  const detectedPort = parseFirstPublishedPort(services[mainService] ?? {});

  parsed.name = typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name : input.appId;
  parsed["x-casaos"] = {
    ...existingCasaos,
    main: mainService,
    title:
      existingCasaos.title && typeof existingCasaos.title === "object"
        ? existingCasaos.title
        : { en_us: input.name },
    icon:
      typeof existingCasaos.icon === "string" && existingCasaos.icon.trim().length > 0
        ? existingCasaos.icon
        : input.iconUrl,
    category:
      typeof existingCasaos.category === "string" && existingCasaos.category.trim().length > 0
        ? existingCasaos.category
        : "Custom",
    description:
      existingCasaos.description && typeof existingCasaos.description === "object"
        ? existingCasaos.description
        : {
            en_us:
              input.sourceType === "docker-run"
                ? "Custom app installed from docker run"
                : input.sourceType === "url"
                  ? "Custom app imported from a compose URL"
                  : "Custom app installed from docker compose",
          },
    tips:
      existingCasaos.tips && typeof existingCasaos.tips === "object"
        ? existingCasaos.tips
        : {
            before_install: {
              en_us: "Managed as a custom CasaOS compose app.",
            },
          },
    scheme:
      typeof existingCasaos.scheme === "string" && existingCasaos.scheme.trim().length > 0
        ? existingCasaos.scheme
        : "http",
    index:
      typeof existingCasaos.index === "string" && existingCasaos.index.trim().length > 0
        ? existingCasaos.index
        : "/",
    port_map:
      existingCasaos.port_map ?? (detectedPort !== null ? String(detectedPort) : undefined),
  };

  return yaml.dump(parsed, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

function mapRow(row: typeof customStoreApps.$inferSelect): CustomStoreTemplate {
  const sourceType = CUSTOM_SOURCE_TYPES.includes(row.sourceType as CustomStoreSourceType)
    ? (row.sourceType as CustomStoreSourceType)
    : "docker-compose";
  const virtualComposePath = path.join(process.cwd(), "custom", row.appId, "docker-compose.yml");
  const parsed = parseComposeContentToApp(virtualComposePath, row.composeContent);

  return {
    ...parsed,
    repositoryUrl: row.repositoryUrl ?? "custom://local",
    stackFile: `custom/${row.appId}/docker-compose.yml`,
    isCustom: true,
    sourceType,
    composeContent: row.composeContent,
    sourceText: row.sourceText,
    sourceUrl: row.sourceUrl ?? null,
    sourceRef: row.sourceRef ?? null,
    sourceChecksum: row.sourceChecksum ?? null,
    lastImportedAt: row.lastImportedAt?.toISOString() ?? null,
  };
}

async function hasCustomStoreAppsTable() {
  const check = await db.execute<{ table_exists: string | null }>(
    sql`SELECT to_regclass('public.custom_store_apps') AS table_exists`,
  );
  return Boolean(check.rows[0]?.table_exists);
}

function normalizeComposeContent(input: {
  sourceType: CustomStoreSourceType;
  sourceText: string;
  fallbackServiceName: string;
}) {
  const sourceText = input.sourceText.trim();
  if (!sourceText) {
    throw new Error("Custom app source cannot be empty");
  }

  if (input.sourceType === "docker-run") {
    return convertDockerRunToCompose(sourceText, input.fallbackServiceName);
  }

  // "url" carries the fetched document, so it validates as compose like a
  // pasted one — the difference is provenance, not format.
  parseComposeDocument(sourceText);
  return sourceText;
}

export function isCustomStoreTemplate(template: StoreTemplateSource): template is CustomStoreTemplate {
  return "isCustom" in template && template.isCustom === true;
}

export async function listCustomStoreTemplates() {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "store.customApps.list",
    },
    async () => {
      if (!(await hasCustomStoreAppsTable())) return [];

      const rows = await db
        .select()
        .from(customStoreApps)
        .orderBy(desc(customStoreApps.updatedAt));

      return rows.map(mapRow);
    },
  );
}

export async function findCustomStoreTemplateByAppId(appId: string) {
  return withServerTiming(
    {
      level: "debug",
      layer: "service",
      action: "store.customApps.findById",
      meta: { appId },
    },
    async () => {
      if (!(await hasCustomStoreAppsTable())) return null;

      const rows = await db
        .select()
        .from(customStoreApps)
        .where(eq(customStoreApps.appId, appId))
        .limit(1);

      const row = rows[0];
      return row ? mapRow(row) : null;
    },
  );
}

export async function upsertCustomStoreTemplate(input: UpsertCustomStoreTemplateInput) {
  return withServerTiming(
    {
      layer: "service",
      action: "store.customApps.upsert",
      meta: { sourceType: input.sourceType },
    },
    async () => {
      if (!(await hasCustomStoreAppsTable())) {
        throw new Error("custom_store_apps table is missing. Run `npm run db:init`.");
      }

      const name = input.name.trim();
      if (!name) {
        throw new Error("Custom app name is required");
      }

      const slug = slugify(name);
      const appId = slug ? `custom-${slug}` : `custom-${randomUUID().slice(0, 8)}`;
      const composeContent = normalizeComposeContent({
        sourceType: input.sourceType,
        sourceText: input.sourceText,
        fallbackServiceName: name,
      });
      // Provenance is recorded only for imports. Re-saving a pasted app must
      // not invent a source URL, and must not leave a stale one behind either.
      const sourceUrl = normalize(input.sourceUrl);
      const importOrigin = sourceUrl
        ? {
            sourceUrl,
            sourceRef: normalize(input.sourceRef),
            sourceChecksum: checksumSource(input.sourceText.trim()),
            lastImportedAt: new Date(),
          }
        : { sourceUrl: null, sourceRef: null, sourceChecksum: null, lastImportedAt: null };

      const casaosComposeContent = augmentCustomComposeMetadata({
        appId,
        name,
        iconUrl: input.iconUrl,
        sourceType: input.sourceType,
        composeContent,
      });

      const rows = await db
        .insert(customStoreApps)
        .values({
          appId,
          name,
          iconUrl: normalize(input.iconUrl),
          webUiUrl: null,
          sourceType: input.sourceType,
          sourceText: input.sourceText.trim(),
          composeContent: casaosComposeContent,
          repositoryUrl: normalize(input.repositoryUrl),
          sourceUrl: importOrigin.sourceUrl,
          sourceRef: importOrigin.sourceRef,
          sourceChecksum: importOrigin.sourceChecksum,
          lastImportedAt: importOrigin.lastImportedAt,
          updatedAt: sql`NOW()`,
        })
        .onConflictDoUpdate({
          target: customStoreApps.appId,
          set: {
            name,
            iconUrl: normalize(input.iconUrl),
            webUiUrl: null,
            sourceType: input.sourceType,
            sourceText: input.sourceText.trim(),
            composeContent: casaosComposeContent,
            repositoryUrl: normalize(input.repositoryUrl),
            sourceUrl: importOrigin.sourceUrl,
            sourceRef: importOrigin.sourceRef,
            sourceChecksum: importOrigin.sourceChecksum,
            lastImportedAt: importOrigin.lastImportedAt,
            updatedAt: sql`NOW()`,
          },
        })
        .returning();

      return mapRow(rows[0]);
    },
  );
}
