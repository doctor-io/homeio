import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { serverEnv } from "@/lib/server/env";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import {
  applyBindMountOwnershipOverrides,
  classifyServiceBindMountOwnership,
  type BindMountOwnershipOverride,
} from "@/lib/server/modules/docker/app-data-ownership";
import {
  ensureDataRootDirectories,
  resolveStoreAppDataRoot,
  resolveStoreStacksRoot,
} from "@/lib/server/storage/data-root";
import { parseEnvFileContent } from "@/lib/shared/env-file";

const execFileAsync = promisify(execFile);

type ComposeCommandInput = {
  composePath: string;
  envPath: string;
  stackName: string;
  args: string[];
};

export type MaterializedStack = {
  stackDir: string;
  composePath: string;
  envPath: string;
  stackName: string;
  webUiPort: number | null;
};

export type ComposeStorageMappingStrategy =
  | "legacy_named_source"
  | "app_target_path";

type ParsedListItem = {
  prefix: string;
  spec: string;
  quote: "'" | '"' | null;
  comment: string;
};

type ParsedComposeVolumeSpec = {
  source: string;
  target: string;
  mode: string | null;
};

type ComposeStorageReferences = {
  bindMountDirectories: Set<string>;
  namedVolumeSources: Set<string>;
};

type ServiceOwnershipContext = {
  image: string | null;
  user: string | null;
  env: Record<string, string>;
};

type ParsedKeyValueLine = {
  key: string;
  value: string;
  comment: string;
  quote: "'" | '"' | null;
};

type ParsedLongFormVolumeItem = {
  end: number;
  fields: Partial<Record<"type" | "source" | "target", string>>;
  fieldLines: Partial<Record<"type" | "source" | "target", number>>;
};

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeStackName(appId: string, displayName?: string) {
  const source = displayName && displayName.trim().length > 0 ? displayName : appId;
  const sanitized = sanitizeSegment(source);

  if (!sanitized) {
    return `app-${Date.now()}`;
  }

  return sanitized.slice(0, 63);
}

function serializeEnvFile(env: Record<string, string>) {
  return Object.keys(env)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${env[key] ?? ""}`)
    .join("\n");
}

function interpolateComposeVariables(
  composeContent: string,
  env: Record<string, string>,
) {
  return composeContent.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      return match;
    }

    return env[key] ?? "";
  });
}

export function applyWebUiPortOverride(composeContent: string, webUiPort: number) {
  const lines = composeContent.split("\n");
  let replaced = false;

  const updated = lines.map((line) => {
    if (replaced) return line;

    const match = line.match(/^(\s*-\s*["']?)(\d+)(:\d+(?::\d+)?(?:\/[a-z]+)?["']?\s*)$/i);
    if (!match) return line;

    replaced = true;
    return `${match[1]}${webUiPort}${match[3]}`;
  });

  // Some stacks (for example `network_mode: host`) intentionally do not publish ports.
  // In that case keep compose as-is and persist the port in installed stack metadata.
  if (!replaced) {
    return composeContent;
  }

  return updated.join("\n");
}

function isBlankOrComment(line: string) {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

function getIndentation(line: string) {
  return line.length - line.trimStart().length;
}

function parseListItem(line: string): ParsedListItem | null {
  const match = line.match(/^(\s*-\s+)(.+)$/);
  if (!match) return null;

  const prefix = match[1];
  let remainder = match[2].trimEnd();

  let quote: "'" | '"' | null = null;
  let comment = "";
  let quoteState: "'" | '"' | null = null;
  let commentStart = -1;

  for (let index = 0; index < remainder.length; index += 1) {
    const char = remainder[index];

    if (char === "'" || char === '"') {
      if (quoteState === char) {
        quoteState = null;
      } else if (quoteState === null) {
        quoteState = char;
      }
      continue;
    }

    if (char === "#" && quoteState === null && index > 0 && /\s/.test(remainder[index - 1])) {
      commentStart = index;
      break;
    }
  }

  if (commentStart >= 0) {
    comment = remainder.slice(commentStart - 1);
    remainder = remainder.slice(0, commentStart - 1).trimEnd();
  }

  if (
    (remainder.startsWith('"') && remainder.endsWith('"')) ||
    (remainder.startsWith("'") && remainder.endsWith("'"))
  ) {
    quote = remainder[0] as "'" | '"';
    remainder = remainder.slice(1, -1);
  }

  const spec = remainder.trim();
  if (!spec) return null;

  return {
    prefix,
    spec,
    quote,
    comment,
  };
}

function parseComposeVolumeSpec(spec: string): ParsedComposeVolumeSpec | null {
  if (spec.includes(": ")) {
    return null;
  }

  const parts = spec.split(":");
  if (parts.length < 2) {
    return null;
  }

  const source = parts[0]?.trim();
  const target = parts[1]?.trim();

  if (!source || !target || !target.startsWith("/")) {
    return null;
  }

  const modeRaw = parts.slice(2).join(":").trim();

  return {
    source,
    target,
    mode: modeRaw.length > 0 ? modeRaw : null,
  };
}

function parseKeyValueLine(line: string): ParsedKeyValueLine | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*?)\s*$/);
  if (!match) {
    return null;
  }

  let remainder = match[2] ?? "";
  let quote: "'" | '"' | null = null;
  let comment = "";
  let quoteState: "'" | '"' | null = null;
  let commentStart = -1;

  for (let index = 0; index < remainder.length; index += 1) {
    const char = remainder[index];

    if (char === "'" || char === '"') {
      if (quoteState === char) {
        quoteState = null;
      } else if (quoteState === null) {
        quoteState = char;
      }
      continue;
    }

    if (char === "#" && quoteState === null && index > 0 && /\s/.test(remainder[index - 1])) {
      commentStart = index;
      break;
    }
  }

  if (commentStart >= 0) {
    comment = remainder.slice(commentStart - 1);
    remainder = remainder.slice(0, commentStart - 1).trimEnd();
  }

  if (
    (remainder.startsWith('"') && remainder.endsWith('"')) ||
    (remainder.startsWith("'") && remainder.endsWith("'"))
  ) {
    quote = remainder[0] as "'" | '"';
    remainder = remainder.slice(1, -1);
  }

  return {
    key: match[1],
    value: remainder.trim(),
    comment,
    quote,
  };
}

function isLikelyNamedVolumeSource(source: string) {
  if (!source) return false;
  if (source.startsWith("/")) return false;
  if (source.startsWith("./") || source.startsWith("../")) return false;
  if (source === "." || source === "..") return false;
  if (source.startsWith("~")) return false;
  if (source.startsWith("$")) return false;
  if (source.includes("/")) return false;
  return true;
}

function isPathWithinRoot(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeContainerTargetPath(target: string) {
  const normalizedTarget = path.posix.normalize(target);
  const segments = normalizedTarget
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");

  if (segments.length === 0) {
    return "data";
  }

  return path.join(...segments);
}

function resolveNamedVolumeBindSource(input: {
  appDataRoot: string;
  appId: string;
  source: string;
  target: string;
  strategy: ComposeStorageMappingStrategy;
}) {
  if (input.strategy === "legacy_named_source") {
    return path.join(input.appDataRoot, input.source);
  }

  if (input.appId.trim().length === 0) {
    throw new Error("appId is required for app_target_path storage mapping");
  }

  const appScopedRoot = path.join(input.appDataRoot, input.appId);
  const relativeTargetPath = normalizeContainerTargetPath(input.target);
  const bindSource = path.join(appScopedRoot, relativeTargetPath);

  if (!isPathWithinRoot(bindSource, appScopedRoot)) {
    throw new Error(
      `Generated bind mount path escapes app root for appId "${input.appId}"`,
    );
  }

  return bindSource;
}

function resolveAppScopedBindSource(appDataRoot: string, appId: string, target: string) {
  return resolveNamedVolumeBindSource({
    appDataRoot,
    appId,
    source: "__ignored__",
    target,
    strategy: "app_target_path",
  });
}

function shouldRewriteAppDataBindSource(input: {
  appDataRoot: string;
  appId: string;
  source: string;
  target: string;
  strategy: ComposeStorageMappingStrategy;
}) {
  if (input.strategy !== "app_target_path") {
    return false;
  }

  if (!path.isAbsolute(input.source) || !isPathWithinRoot(input.source, input.appDataRoot)) {
    return false;
  }

  const appScopedRoot = path.join(input.appDataRoot, input.appId);
  if (isPathWithinRoot(input.source, appScopedRoot)) {
    return false;
  }

  const desiredSource = resolveAppScopedBindSource(input.appDataRoot, input.appId, input.target);
  return path.resolve(input.source) !== path.resolve(desiredSource);
}

function parseLongFormVolumeItem(lines: string[], startIndex: number): ParsedLongFormVolumeItem {
  const startLine = lines[startIndex];
  const itemIndent = getIndentation(startLine);
  let end = startIndex + 1;

  while (end < lines.length) {
    const line = lines[end];
    if (isBlankOrComment(line)) {
      end += 1;
      continue;
    }

    if (getIndentation(line) <= itemIndent) {
      break;
    }

    end += 1;
  }

  const fields: ParsedLongFormVolumeItem["fields"] = {};
  const fieldLines: ParsedLongFormVolumeItem["fieldLines"] = {};
  const firstInline = parseKeyValueLine(startLine.replace(/^(\s*-\s+)/, ""));
  if (firstInline && (firstInline.key === "type" || firstInline.key === "source" || firstInline.key === "target")) {
    fields[firstInline.key] = firstInline.value;
    fieldLines[firstInline.key] = startIndex;
  }

  for (let index = startIndex + 1; index < end; index += 1) {
    const parsed = parseKeyValueLine(lines[index]);
    if (!parsed) continue;
    if (parsed.key === "type" || parsed.key === "source" || parsed.key === "target") {
      fields[parsed.key] = parsed.value;
      fieldLines[parsed.key] = index;
    }
  }

  return {
    end,
    fields,
    fieldLines,
  };
}

function collectServiceOwnershipContext(lines: string[]) {
  const serviceContexts = new Map<string, ServiceOwnershipContext>();
  const pathStack: Array<{ indent: number; key: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentation(line);
    while (pathStack.length > 0 && indent <= pathStack[pathStack.length - 1].indent) {
      pathStack.pop();
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):(\s*#.*)?$/);
    if (keyMatch) {
      pathStack.push({
        indent,
        key: keyMatch[1],
      });
      continue;
    }

    const pathKeys = pathStack.map((entry) => entry.key);
    if (pathKeys.length < 2 || pathKeys[0] !== "services") {
      continue;
    }

    const serviceName = pathKeys[1];
    const context = serviceContexts.get(serviceName) ?? {
      image: null,
      user: null,
      env: {},
    };

    const parsed = parseKeyValueLine(line);
    if (
      pathKeys.length === 2 &&
      parsed &&
      parsed.value.length > 0 &&
      (parsed.key === "image" || parsed.key === "user")
    ) {
      if (parsed.key === "image") {
        context.image = parsed.value;
      } else {
        context.user = parsed.value;
      }
      serviceContexts.set(serviceName, context);
      continue;
    }

    if (pathKeys.length === 3 && pathKeys[2] === "environment") {
      if (parsed && parsed.key.length > 0) {
        context.env[parsed.key] = parsed.value;
        serviceContexts.set(serviceName, context);
        continue;
      }

      const listItem = parseListItem(line);
      if (!listItem) {
        continue;
      }

      const separatorIndex = listItem.spec.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = listItem.spec.slice(0, separatorIndex).trim();
      const value = listItem.spec.slice(separatorIndex + 1).trim();
      if (!key) {
        continue;
      }

      context.env[key] = value;
      serviceContexts.set(serviceName, context);
    }
  }

  return serviceContexts;
}

function resolveBindMountOwnershipOverride(
  context: ServiceOwnershipContext,
  target: string,
) {
  const resolution = classifyServiceBindMountOwnership({
    image: context.image,
    user: context.user,
    env: context.env,
    targetPath: target,
  });

  if (resolution.source === "fallback") {
    return null;
  }

  return {
    uid: resolution.uid,
    gid: resolution.gid,
  };
}

export function collectComposeBindMountOwnershipOverrides(composeContent: string) {
  const lines = composeContent.split(/\r?\n/);
  const serviceContexts = collectServiceOwnershipContext(lines);
  const pathStack: Array<{ indent: number; key: string }> = [];
  const overrides = new Map<string, BindMountOwnershipOverride>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentation(line);
    while (pathStack.length > 0 && indent <= pathStack[pathStack.length - 1].indent) {
      pathStack.pop();
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):(\s*#.*)?$/);
    if (keyMatch) {
      pathStack.push({
        indent,
        key: keyMatch[1],
      });
      continue;
    }

    const pathKeys = pathStack.map((entry) => entry.key);
    const isServiceVolumeList =
      pathKeys.length === 3 &&
      pathKeys[0] === "services" &&
      pathKeys[2] === "volumes";

    if (!isServiceVolumeList) {
      continue;
    }

    const serviceContext = serviceContexts.get(pathKeys[1]);
    if (!serviceContext) {
      continue;
    }

    const listItem = parseListItem(line);
    if (!listItem) {
      continue;
    }

    const volumeSpec = parseComposeVolumeSpec(listItem.spec);
    if (volumeSpec) {
      if (!path.isAbsolute(volumeSpec.source)) {
        continue;
      }

      const ownership = resolveBindMountOwnershipOverride(serviceContext, volumeSpec.target);
      if (!ownership) {
        continue;
      }

      overrides.set(volumeSpec.source, {
        directoryPath: volumeSpec.source,
        uid: ownership.uid,
        gid: ownership.gid,
      });
      continue;
    }

    const longForm = parseLongFormVolumeItem(lines, index);
    const source = longForm.fields.source;
    const target = longForm.fields.target;
    if (!source || !target || !path.isAbsolute(source)) {
      index = longForm.end - 1;
      continue;
    }

    const ownership = resolveBindMountOwnershipOverride(serviceContext, target);
    if (ownership) {
      overrides.set(source, {
        directoryPath: source,
        uid: ownership.uid,
        gid: ownership.gid,
      });
    }

    index = longForm.end - 1;
  }

  return Array.from(overrides.values());
}

export function resolveComposeBindMountOwnershipOverrides(
  composeContent: string,
  env: Record<string, string>,
) {
  return collectComposeBindMountOwnershipOverrides(
    interpolateComposeVariables(composeContent, env),
  );
}

export function collectMaterializationDirectories(
  bindMountDirectories: Iterable<string>,
  ownershipOverrides: Iterable<BindMountOwnershipOverride>,
) {
  const directoriesToEnsure = new Set(bindMountDirectories);
  for (const { directoryPath } of ownershipOverrides) {
    directoriesToEnsure.add(directoryPath);
  }

  return directoriesToEnsure;
}

function rewriteKeyValueLine(
  line: string,
  expectedKey: string,
  nextValue: string,
  quote?: "'" | '"' | null,
) {
  const prefixMatch = line.match(/^(\s*-\s+|\s*)/);
  const prefix = prefixMatch?.[1] ?? "";
  const lineWithoutPrefix = prefix.trim() === "-" ? line.slice(prefix.length) : line.trimStart();
  const parsed = parseKeyValueLine(lineWithoutPrefix.trim());
  const trailingComment = parsed?.comment ?? "";
  const quoteChar = quote ?? parsed?.quote ?? null;
  const serializedValue = quoteChar ? `${quoteChar}${nextValue}${quoteChar}` : nextValue;
  return `${prefix}${expectedKey}: ${serializedValue}${trailingComment}`;
}

function findTopLevelSectionEnd(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (isBlankOrComment(line)) continue;
    if (getIndentation(line) === 0) {
      return index;
    }
  }

  return lines.length;
}

function removeTopLevelVolumeDefinitions(lines: string[], namesToRemove: Set<string>) {
  if (namesToRemove.size === 0) {
    return;
  }

  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!(getIndentation(line) === 0 && /^volumes:(\s*#.*)?$/.test(trimmed))) {
      index += 1;
      continue;
    }

    const sectionStart = index;
    const sectionEnd = findTopLevelSectionEnd(lines, index + 1);
    const entries: Array<{ name: string; start: number; end: number }> = [];

    let cursor = sectionStart + 1;
    while (cursor < sectionEnd) {
      const entryLine = lines[cursor];
      if (isBlankOrComment(entryLine)) {
        cursor += 1;
        continue;
      }

      const indent = getIndentation(entryLine);
      const entryMatch = entryLine.trim().match(/^([A-Za-z0-9_.-]+):(\s*#.*)?$/);

      if (indent !== 2 || !entryMatch) {
        cursor += 1;
        continue;
      }

      let end = cursor + 1;
      while (end < sectionEnd) {
        const maybeNested = lines[end];
        if (isBlankOrComment(maybeNested)) {
          end += 1;
          continue;
        }

        if (getIndentation(maybeNested) <= 2) {
          break;
        }

        end += 1;
      }

      entries.push({
        name: entryMatch[1],
        start: cursor,
        end,
      });

      cursor = end;
    }

    if (entries.length === 0) {
      index = sectionEnd;
      continue;
    }

    const removable = entries.filter((entry) => namesToRemove.has(entry.name));
    if (removable.length === 0) {
      index = sectionEnd;
      continue;
    }

    if (removable.length === entries.length) {
      lines.splice(sectionStart, sectionEnd - sectionStart);
      continue;
    }

    removable
      .sort((left, right) => right.start - left.start)
      .forEach((entry) => {
        lines.splice(entry.start, entry.end - entry.start);
      });

    index = sectionStart + 1;
  }
}

function shouldCollectBindMountSource(source: string, cleanupRoots: string[]) {
  if (!path.isAbsolute(source)) {
    return false;
  }

  return cleanupRoots.some((root) => isPathWithinRoot(source, root));
}

function collectComposeStorageReferences(
  composeContent: string,
  cleanupRoots: string[],
): ComposeStorageReferences {
  const lines = composeContent.split(/\r?\n/);
  const pathStack: Array<{ indent: number; key: string }> = [];
  const bindMountDirectories = new Set<string>();
  const namedVolumeSources = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentation(line);
    while (pathStack.length > 0 && indent <= pathStack[pathStack.length - 1].indent) {
      pathStack.pop();
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):(\s*#.*)?$/);
    if (keyMatch) {
      pathStack.push({
        indent,
        key: keyMatch[1],
      });
      continue;
    }

    const listItem = parseListItem(line);
    if (!listItem) {
      continue;
    }

    const pathKeys = pathStack.map((entry) => entry.key);
    const isServiceVolumeList =
      pathKeys.length === 3 &&
      pathKeys[0] === "services" &&
      pathKeys[2] === "volumes";

    if (!isServiceVolumeList) {
      continue;
    }

    const volumeSpec = parseComposeVolumeSpec(listItem.spec);
    if (volumeSpec) {
      if (shouldCollectBindMountSource(volumeSpec.source, cleanupRoots)) {
        bindMountDirectories.add(volumeSpec.source);
        continue;
      }

      if (isLikelyNamedVolumeSource(volumeSpec.source)) {
        namedVolumeSources.add(volumeSpec.source);
      }
      continue;
    }

    const longForm = parseLongFormVolumeItem(lines, index);
    const source = longForm.fields.source;
    if (!source) {
      index = longForm.end - 1;
      continue;
    }

    if (shouldCollectBindMountSource(source, cleanupRoots)) {
      bindMountDirectories.add(source);
      index = longForm.end - 1;
      continue;
    }

    if (isLikelyNamedVolumeSource(source)) {
      namedVolumeSources.add(source);
    }

    index = longForm.end - 1;
  }

  return {
    bindMountDirectories,
    namedVolumeSources,
  };
}

export function normalizeComposeStorageBindings(
  composeContent: string,
  stacksRoot: string,
  appDataRoot: string,
  options?: {
    appId?: string;
    strategy?: ComposeStorageMappingStrategy;
  },
) {
  const strategy = options?.strategy ?? "legacy_named_source";
  const appId = options?.appId ?? "";

  const lines = composeContent.split(/\r?\n/);
  const pathStack: Array<{ indent: number; key: string }> = [];
  const bindMountDirectories = new Set<string>();
  const convertedNamedVolumes = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentation(line);
    while (pathStack.length > 0 && indent <= pathStack[pathStack.length - 1].indent) {
      pathStack.pop();
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+):(\s*#.*)?$/);
    if (keyMatch) {
      pathStack.push({
        indent,
        key: keyMatch[1],
      });
      continue;
    }

    const listItem = parseListItem(line);
    if (!listItem) {
      continue;
    }

    const pathKeys = pathStack.map((entry) => entry.key);
    const isServiceVolumeList =
      pathKeys.length === 3 &&
      pathKeys[0] === "services" &&
      pathKeys[2] === "volumes";

    if (!isServiceVolumeList) {
      continue;
    }

    const volumeSpec = parseComposeVolumeSpec(listItem.spec);
    if (volumeSpec) {
      let bindSource: string | null = null;

      if (isLikelyNamedVolumeSource(volumeSpec.source)) {
        bindSource = resolveNamedVolumeBindSource({
          appDataRoot,
          appId,
          source: volumeSpec.source,
          target: volumeSpec.target,
          strategy,
        });
        convertedNamedVolumes.add(volumeSpec.source);
      } else if (shouldRewriteAppDataBindSource({
        appDataRoot,
        appId,
        source: volumeSpec.source,
        target: volumeSpec.target,
        strategy,
      })) {
        bindSource = resolveAppScopedBindSource(appDataRoot, appId, volumeSpec.target);
      }

      if (!bindSource) {
        continue;
      }

      const rewrittenSpec = volumeSpec.mode
        ? `${bindSource}:${volumeSpec.target}:${volumeSpec.mode}`
        : `${bindSource}:${volumeSpec.target}`;
      const quotedSpec = listItem.quote ? `${listItem.quote}${rewrittenSpec}${listItem.quote}` : rewrittenSpec;

      lines[index] = `${listItem.prefix}${quotedSpec}${listItem.comment}`;
      bindMountDirectories.add(bindSource);
      continue;
    }

    const longForm = parseLongFormVolumeItem(lines, index);
    const source = longForm.fields.source;
    const target = longForm.fields.target;
    if (!source || !target) {
      index = longForm.end - 1;
      continue;
    }

    let bindSource: string | null = null;
    let convertedNamedVolume = false;

    if (isLikelyNamedVolumeSource(source)) {
      bindSource = resolveNamedVolumeBindSource({
        appDataRoot,
        appId,
        source,
        target,
        strategy,
      });
      convertedNamedVolume = true;
      convertedNamedVolumes.add(source);
    } else if (shouldRewriteAppDataBindSource({
      appDataRoot,
      appId,
      source,
      target,
      strategy,
    })) {
      bindSource = resolveAppScopedBindSource(appDataRoot, appId, target);
    }

    let itemEnd = longForm.end;
    if (bindSource) {
      const sourceLineIndex = longForm.fieldLines.source;
      if (typeof sourceLineIndex === "number") {
        lines[sourceLineIndex] = rewriteKeyValueLine(lines[sourceLineIndex], "source", bindSource);
      }

      const typeLineIndex = longForm.fieldLines.type;
      if (typeof typeLineIndex === "number") {
        lines[typeLineIndex] = rewriteKeyValueLine(lines[typeLineIndex], "type", "bind");
      } else if (convertedNamedVolume && typeof sourceLineIndex === "number") {
        const indent = " ".repeat(getIndentation(lines[sourceLineIndex]));
        lines.splice(sourceLineIndex, 0, `${indent}type: bind`);
        itemEnd += 1;
      }

      bindMountDirectories.add(bindSource);
    }

    index = itemEnd - 1;
  }

  removeTopLevelVolumeDefinitions(lines, convertedNamedVolumes);

  return {
    composeContent: lines.join("\n"),
    bindMountDirectories,
    convertedNamedVolumes,
  };
}

export async function materializeInlineStackFiles(input: {
  appId: string;
  stackName: string;
  composeContent: string;
  env: Record<string, string>;
  webUiPort: number | null;
  storageMappingStrategy?: ComposeStorageMappingStrategy;
}) {
  let composeContent = input.composeContent;
  if (input.webUiPort !== null) {
    composeContent = applyWebUiPortOverride(composeContent, input.webUiPort);
  }

  await ensureDataRootDirectories();
  const stacksRoot = resolveStoreStacksRoot();
  const appDataRoot = resolveStoreAppDataRoot();
  const normalized = normalizeComposeStorageBindings(composeContent, stacksRoot, appDataRoot, {
    appId: input.appId,
    strategy: input.storageMappingStrategy,
  });
  const ownershipOverrides = resolveComposeBindMountOwnershipOverrides(normalized.composeContent, {
    ...input.env,
    AppID: input.appId,
  });
  const directoriesToEnsure = collectMaterializationDirectories(
    normalized.bindMountDirectories,
    ownershipOverrides,
  );

  const stackDir = path.join(stacksRoot, input.appId);
  const composePath = path.join(stackDir, "docker-compose.yml");
  const envPath = path.join(stackDir, ".env");

  await mkdir(stackDir, { recursive: true });
  await Promise.all(
    Array.from(directoriesToEnsure).map((directoryPath) =>
      mkdir(directoryPath, { recursive: true }),
    ),
  );
  await applyBindMountOwnershipOverrides(ownershipOverrides);
  await writeFile(composePath, normalized.composeContent, "utf8");
  await writeFile(envPath, serializeEnvFile(input.env), "utf8");

  return {
    stackDir,
    composePath,
    envPath,
    stackName: input.stackName,
    webUiPort: input.webUiPort,
  } satisfies MaterializedStack;
}

async function runComposeCommand(input: ComposeCommandInput) {
  return withServerTiming(
    {
      layer: "system",
      action: "store.compose.exec",
      meta: {
        stackName: input.stackName,
        args: input.args,
      },
    },
    async () => {
      const args = [
        "compose",
        "-f",
        input.composePath,
        "--env-file",
        input.envPath,
        "-p",
        input.stackName,
        ...input.args,
      ];

      // The spawn below runs with the stack directory as its cwd, and Node
      // reports a missing cwd as `spawn docker ENOENT` — a message that names
      // the binary and sends people hunting for a broken Docker install. The
      // stack directory disappears whenever a database is restored ahead of the
      // files it describes, so check it and say what is actually wrong.
      const stackDir = path.dirname(input.composePath);
      const composeFileExists = await stat(input.composePath)
        .then((entry) => entry.isFile())
        .catch(() => false);

      if (!composeFileExists) {
        throw new Error(
          `The files for this app are missing: ${input.composePath} does not exist. ` +
            `Homeio still has a record of it, but there is nothing on disk to act on.`,
        );
      }

      const timeoutMs = serverEnv.DOCKER_COMPOSE_TIMEOUT_MS;
      const { stdout } = await execFileAsync("docker", args, {
        cwd: stackDir,
        timeout: timeoutMs,
        // Buffer cap protects against runaway compose output on Pi where
        // a stuck `docker compose logs` could exhaust memory.
        maxBuffer: 10 * 1024 * 1024,
      }).catch((err: unknown) => {
        // Detect Node's child_process timeout (SIGTERM + killed) before
        // anything else so the user sees a clear "timed out" message
        // instead of a truncated stderr.
        const errorObject = err as {
          killed?: boolean;
          signal?: string;
          code?: string | number;
          stderr?: string;
        };
        const timedOut =
          errorObject?.killed === true ||
          errorObject?.signal === "SIGTERM" ||
          errorObject?.code === "ETIMEDOUT";
        if (timedOut) {
          throw new Error(
            `Docker compose command timed out after ${Math.round(timeoutMs / 1000)}s. ` +
              `Check Docker daemon status and network connectivity, then retry.`,
          );
        }

        // Extract Docker's stderr for a more meaningful error message.
        const stderr =
          typeof errorObject.stderr === "string"
            ? errorObject.stderr.trim()
            : "";

        // Detect hardware device requirements not present on this host
        // (e.g. Raspberry Pi GPU /dev/vcsm in some CasaOS templates).
        const deviceMatch = stderr.match(
          /adding custom device "([^"]+)".*no such file or directory/i,
        );
        if (deviceMatch) {
          throw new Error(
            `This app requires a hardware device (${deviceMatch[1]}) that is not available on this host. ` +
              `The app template is designed for specific hardware (e.g. Raspberry Pi). ` +
              `You can edit the app's compose file to remove the device requirement if it is optional.`,
          );
        }

        // For all other failures, surface Docker's stderr so the user sees
        // the real reason instead of a generic "Command failed" message.
        if (stderr) {
          throw new Error(stderr);
        }

        throw err;
      });

      return stdout;
    },
  );
}

export async function extractComposeImages(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  const stdout = await runComposeCommand({
    ...input,
    args: ["config", "--images"],
  });

  return Array.from(
    new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  );
}

export async function runComposePull(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  await runComposeCommand({
    ...input,
    args: ["pull"],
  });
}

export async function runComposeUp(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  await runComposeCommand({
    ...input,
    args: ["up", "-d"],
  });
}

export async function runComposeDown(input: {
  composePath: string;
  envPath: string;
  stackName: string;
  removeVolumes?: boolean;
}) {
  const args = ["down"];
  if (input.removeVolumes) {
    args.push("-v");
  }

  await runComposeCommand({
    ...input,
    args,
  });
}

export async function runComposeStart(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  await runComposeCommand({
    ...input,
    args: ["start"],
  });
}

export async function runComposeStop(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  await runComposeCommand({
    ...input,
    args: ["stop"],
  });
}

export async function runComposeRestart(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}) {
  await runComposeCommand({
    ...input,
    args: ["restart"],
  });
}

export async function getComposeStatus(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}): Promise<"running" | "partial" | "paused" | "stopped" | "unknown"> {
  const info = await getComposeRuntimeInfo(input);
  return info.status;
}

type ComposePsEntry = {
  State?: string;
  Name?: string;
};

function parseComposePsOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return [] as ComposePsEntry[];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is ComposePsEntry => {
          return Boolean(entry && typeof entry === "object");
        });
      }
    } catch {
      // fallback to line-delimited parser
    }
  }

  return trimmed
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line) as ComposePsEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is ComposePsEntry => entry !== null);
}

export async function getComposeRuntimeInfo(input: {
  composePath: string;
  envPath: string;
  stackName: string;
}): Promise<{
  status: "running" | "partial" | "paused" | "stopped" | "unknown";
  lifecycleStatus: "running" | "paused" | "restarting" | "stopped" | "unknown";
  containerNames: string[];
  primaryContainerName: string | null;
}> {
  try {
    const stdout = await runComposeCommand({
      ...input,
      args: ["ps", "--format", "json"],
    });

    if (!stdout.trim()) {
      return {
        status: "stopped",
        lifecycleStatus: "stopped",
        containerNames: [],
        primaryContainerName: null,
      };
    }

    const containers = parseComposePsOutput(stdout);

    if (containers.length === 0) {
      return {
        status: "stopped",
        lifecycleStatus: "stopped",
        containerNames: [],
        primaryContainerName: null,
      };
    }

    const normalizedStates = containers.map((container) =>
      (container.State ?? "").trim().toLowerCase(),
    );
    const allRunning = normalizedStates.every((state) => state === "running");
    const anyRunning = containers.some((c) => c.State === "running");
    const anyPaused = normalizedStates.some((state) => state === "paused");
    const anyRestarting = normalizedStates.some((state) => state.includes("restart"));
    const containerNames = containers
      .map((c) => c.Name?.trim() ?? "")
      .filter((name) => name.length > 0);
    const primaryRunning = containers.find((c) => c.State === "running" && c.Name);
    const primaryPaused = containers.find((c) => c.State === "paused" && c.Name);
    const primaryContainerName =
      primaryRunning?.Name?.trim() ??
      primaryPaused?.Name?.trim() ??
      containerNames[0] ??
      null;

    const status = allRunning ? "running" : anyRunning ? "partial" : anyPaused ? "paused" : "stopped";
    const lifecycleStatus = allRunning || anyRunning
      ? "running"
      : anyPaused
        ? "paused"
        : anyRestarting
          ? "restarting"
          : "stopped";

    return {
      status,
      lifecycleStatus,
      containerNames,
      primaryContainerName,
    };
  } catch {
    return {
      status: "unknown",
      lifecycleStatus: "unknown",
      containerNames: [],
      primaryContainerName: null,
    };
  }
}

export async function cleanupComposeDataOnUninstall(input: {
  composePath: string;
  removeVolumes?: boolean;
}) {
  const cleanupSummary: {
    bindMountDirectories: string[];
    namedVolumeSources: string[];
    removedStackDir: string | null;
    composeMissing: boolean;
  } = {
    bindMountDirectories: [],
    namedVolumeSources: [],
    removedStackDir: null,
    composeMissing: false,
  };

  await withServerTiming(
    {
      layer: "system",
      action: "store.compose.cleanup",
      meta: {
        composePath: input.composePath,
        removeVolumes: input.removeVolumes ?? false,
      },
      onSuccessMeta: () => ({
        removeVolumes: input.removeVolumes ?? false,
        bindMountDirectoryCount: cleanupSummary.bindMountDirectories.length,
        namedVolumeCount: cleanupSummary.namedVolumeSources.length,
        removedStackDir: cleanupSummary.removedStackDir,
        composeMissing: cleanupSummary.composeMissing,
      }),
    },
    async () => {
      const stacksRoot = resolveStoreStacksRoot();
      const appDataRoot = resolveStoreAppDataRoot();
      const stackDir = path.dirname(input.composePath);
      const envPath = path.join(stackDir, ".env");
      const stackAppId = path.basename(stackDir);

      let composeContent: string | null = null;
      try {
        composeContent = await readFile(input.composePath, "utf8");
      } catch (error) {
        const errorWithCode = error as NodeJS.ErrnoException;
        if (errorWithCode.code !== "ENOENT") {
          throw error;
        }
        cleanupSummary.composeMissing = true;
      }

      if (input.removeVolumes && composeContent !== null) {
        let interpolationEnv: Record<string, string> = {
          AppID: stackAppId,
        };

        try {
          const envContent = await readFile(envPath, "utf8");
          interpolationEnv = {
            ...interpolationEnv,
            ...parseEnvFileContent(envContent),
          };
        } catch (error) {
          const errorWithCode = error as NodeJS.ErrnoException;
          if (errorWithCode.code !== "ENOENT") {
            throw error;
          }
        }

        const storage = collectComposeStorageReferences(composeContent, [
          stacksRoot,
          appDataRoot,
        ]);
        const interpolatedStorage = collectComposeStorageReferences(
          interpolateComposeVariables(composeContent, interpolationEnv),
          [stacksRoot, appDataRoot],
        );
        cleanupSummary.bindMountDirectories = Array.from(storage.bindMountDirectories).sort((a, b) => a.localeCompare(b));
        cleanupSummary.namedVolumeSources = Array.from(storage.namedVolumeSources).sort((a, b) => a.localeCompare(b));
        if (interpolatedStorage.bindMountDirectories.size > 0) {
          cleanupSummary.bindMountDirectories = Array.from(
            interpolatedStorage.bindMountDirectories,
          ).sort((a, b) => a.localeCompare(b));
        }
        if (interpolatedStorage.namedVolumeSources.size > 0) {
          cleanupSummary.namedVolumeSources = Array.from(
            interpolatedStorage.namedVolumeSources,
          ).sort((a, b) => a.localeCompare(b));
        }

        logServerAction({
          layer: "system",
          action: "store.compose.cleanup.targets",
          status: "info",
          message: "Resolved compose cleanup targets",
          meta: {
            composePath: input.composePath,
            bindMountDirectories: cleanupSummary.bindMountDirectories,
            namedVolumeSources: cleanupSummary.namedVolumeSources,
          },
        });

        await Promise.all(
          cleanupSummary.bindMountDirectories.map((directoryPath) =>
            rm(directoryPath, {
              recursive: true,
              force: true,
            }),
          ),
        );

        for (const volumeName of cleanupSummary.namedVolumeSources) {
          try {
            await execFileAsync("docker", ["volume", "rm", volumeName]);
          } catch {
            // Best effort cleanup for legacy named volumes.
          }
        }

        // Also remove the app's root directory under appDataRoot (e.g. /DATA/AppData/<appId>).
        // Individual bind mount entries point to sub-directories, so the parent folder
        // remains unless we explicitly delete it.
        const appDataDir = path.join(appDataRoot, stackAppId);
        const normalizedAppDataDir = path.resolve(appDataDir);
        const normalizedAppDataRoot = path.resolve(appDataRoot);
        if (
          isPathWithinRoot(normalizedAppDataDir, normalizedAppDataRoot) &&
          normalizedAppDataDir !== normalizedAppDataRoot
        ) {
          await rm(normalizedAppDataDir, { recursive: true, force: true });
        }
      }

      const normalizedStackDir = path.resolve(stackDir);
      const normalizedStacksRoot = path.resolve(stacksRoot);
      const composeFileName = path.basename(input.composePath).toLowerCase();
      const isComposeStackFile =
        composeFileName === "docker-compose.yml" ||
        composeFileName === "docker-compose.yaml";
      const isKnownStackDirectory =
        isPathWithinRoot(normalizedStackDir, normalizedStacksRoot) ||
        path.basename(path.dirname(normalizedStackDir)) === "Apps";
      const shouldRemoveStackDir =
        isComposeStackFile &&
        normalizedStackDir !== normalizedStacksRoot &&
        isKnownStackDirectory;

      if (shouldRemoveStackDir) {
        await rm(normalizedStackDir, {
          recursive: true,
          force: true,
        });
        cleanupSummary.removedStackDir = normalizedStackDir;
      }
    },
  );
}
