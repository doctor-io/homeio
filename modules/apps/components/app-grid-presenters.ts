"use client";

import type {
  InstalledApp,
  StoreAppSummary,
  StoreOperationAction,
  StoreOperationStatus,
} from "@/lib/shared/contracts/apps";
import type { UnmanagedContainer } from "@/lib/shared/contracts/docker";
import type { AppCondition, AppConditionSummary } from "@/lib/shared/app-condition";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Camera,
  Cloud,
  Code,
  Container,
  Database,
  Download,
  Film,
  FolderOpen,
  Gamepad2,
  Globe,
  Home,
  Lock,
  Mail,
  MessageSquare,
  Music,
  Pause,
  RefreshCw,
  Rss,
  Server,
  Shield,
} from "@/components/icons/platform-icons";
import type { ComponentType } from "react";
import { isStoreOperationActiveStatus } from "@/lib/shared/store-operations";

export type AppGridStatus =
  | "running"
  | "partial"
  | "paused"
  | "stopped"
  | "unknown"
  | "updating"
  /** Running on this host, but not deployed by Homeio. */
  | "unmanaged";

export type AppItem = {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  logoUrl: string | null;
  color: string;
  bgColor: string;
  status: AppGridStatus;
  category: string;
  webUiPort: number | null;
  webUiUrl: string | null;
  containerName: string | null;
  updateAvailable: boolean;
  /** Finer state from the server; the desktop falls back to status without it. */
  condition?: AppConditionSummary | null;
};

export type AppActionTarget = {
  appId: string;
  appName: string;
  dashboardUrl: string;
  containerName: string;
};

export type AppOperationStateLike = {
  appId: string;
  action: StoreOperationAction;
  status: StoreOperationStatus;
  progressPercent: number;
  updatedAt?: string;
};

export type ActiveAppOperation = {
  appId: string;
  appName: string;
  action: StoreOperationAction;
  status: "queued" | "running";
  progressPercent: number;
  updatedAt: string;
};

const iconByKeyword: Array<{
  keywords: string[];
  icon: ComponentType<{ className?: string }>;
  category: string;
}> = [
  { keywords: ["plex", "jellyfin"], icon: Film, category: "Media" },
  { keywords: ["nextcloud", "cloud"], icon: Cloud, category: "Productivity" },
  { keywords: ["pihole", "pi-hole"], icon: Shield, category: "Network" },
  {
    keywords: ["home assistant", "home-asst"],
    icon: Home,
    category: "Automation",
  },
  { keywords: ["portainer", "docker"], icon: Container, category: "System" },
  { keywords: ["grafana"], icon: BarChart3, category: "System" },
  { keywords: ["proxy", "nginx"], icon: Globe, category: "Network" },
  {
    keywords: ["vaultwarden", "auth", "2fauth"],
    icon: Lock,
    category: "Security",
  },
  {
    keywords: ["qbittorrent", "torrent"],
    icon: Download,
    category: "Downloads",
  },
  {
    keywords: ["postgres", "mysql", "database"],
    icon: Database,
    category: "System",
  },
  { keywords: ["music", "audio"], icon: Music, category: "Media" },
  { keywords: ["gitea", "git"], icon: Code, category: "Development" },
  { keywords: ["immich", "photo"], icon: Camera, category: "Media" },
  { keywords: ["book", "wiki"], icon: BookOpen, category: "Productivity" },
  { keywords: ["file"], icon: FolderOpen, category: "Productivity" },
  { keywords: ["uptime", "kuma"], icon: Server, category: "System" },
  { keywords: ["mail"], icon: Mail, category: "Communication" },
  {
    keywords: ["matrix", "chat"],
    icon: MessageSquare,
    category: "Communication",
  },
  { keywords: ["rss"], icon: Rss, category: "Productivity" },
  { keywords: ["minecraft", "game"], icon: Gamepad2, category: "Gaming" },
];

const visualPalette = [
  { color: "text-sky-300", bgColor: "bg-sky-600/20" },
  { color: "text-emerald-300", bgColor: "bg-emerald-600/20" },
  { color: "text-amber-300", bgColor: "bg-amber-600/20" },
  { color: "text-violet-300", bgColor: "bg-violet-600/20" },
  { color: "text-rose-300", bgColor: "bg-rose-600/20" },
  { color: "text-cyan-300", bgColor: "bg-cyan-600/20" },
  { color: "text-lime-300", bgColor: "bg-lime-600/20" },
  { color: "text-orange-300", bgColor: "bg-orange-600/20" },
] as const;

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function pickVisual(appName: string, appId: string) {
  const name = appName.toLowerCase();
  const matched =
    iconByKeyword.find((entry) =>
      entry.keywords.some((keyword) => name.includes(keyword)),
    ) ?? null;
  const palette = visualPalette[hashText(appId) % visualPalette.length];

  return {
    icon: matched?.icon ?? Container,
    category: matched?.category ?? "Apps",
    color: palette.color,
    bgColor: palette.bgColor,
  };
}

export function resolveAppActionTarget(app: AppItem): AppActionTarget {
  const fallbackContainerName = app.containerName?.trim() ?? "";
  const customUrl = app.webUiUrl?.trim() ?? "";

  // An operator-set link wins: the automatic one is built from the browser's
  // own location, which is wrong behind a reverse proxy or tunnel.
  if (customUrl.length > 0) {
    return {
      appId: app.id,
      appName: app.name,
      dashboardUrl: customUrl,
      containerName: fallbackContainerName,
    };
  }

  if (app.webUiPort !== null) {
    const protocol =
      typeof window !== "undefined" ? window.location.protocol : "http:";
    const hostname =
      typeof window !== "undefined" ? window.location.hostname : "localhost";

    return {
      appId: app.id,
      appName: app.name,
      dashboardUrl: `${protocol}//${hostname}:${app.webUiPort}`,
      containerName: fallbackContainerName,
    };
  }

  return {
    appId: app.id,
    appName: app.name,
    dashboardUrl: "",
    containerName: fallbackContainerName,
  };
}

export function requireAppActionTarget(
  app: AppItem,
  options?: {
    requireContainerName?: boolean;
    requireDashboardUrl?: boolean;
  },
): AppActionTarget | null {
  const fallback = resolveAppActionTarget(app);
  const requireContainerName = options?.requireContainerName ?? false;
  const requireDashboardUrl = options?.requireDashboardUrl ?? false;

  if (requireDashboardUrl && fallback.dashboardUrl.trim().length === 0) {
    return null;
  }

  if (requireContainerName && fallback.containerName.trim().length === 0) {
    return null;
  }

  return fallback;
}

type AppVisualState = {
  imageClass: string;
  ringClass: string;
  badgeIcon: ComponentType<{ className?: string }> | null;
  badgeClass: string;
  badgeIconClass: string;
  title: string;
};

// Running apps keep their colours, anything down turns grey; a bare glyph over
// the icon marks the states worth a look. No status dot.
const COLOUR = "";
const GREY = "opacity-60 grayscale";
const PLAIN = { imageClass: COLOUR, ringClass: "border-transparent", badgeIcon: null, badgeClass: "", badgeIconClass: "" };

function withCode(label: string, exitCode: number | null | undefined, skipZero = true) {
  if (exitCode === null || exitCode === undefined || (skipZero && exitCode === 0)) return label;
  return `${label} (exit ${exitCode})`;
}

function conditionVisual(condition: AppCondition, exitCode: number | null): AppVisualState {
  switch (condition) {
    case "running":
      return { ...PLAIN, title: "Running" };
    case "starting":
      return { ...PLAIN, title: "Starting" };
    case "unhealthy":
      return { ...PLAIN, badgeIcon: AlertTriangle, badgeClass: "text-status-red", title: "Running but unhealthy" };
    case "restarting":
      return {
        ...PLAIN,
        imageClass: GREY,
        badgeIcon: RefreshCw,
        badgeClass: "text-white",
        badgeIconClass: "animate-spin",
        title: withCode("Restarting", exitCode),
      };
    case "partial":
      return {
        ...PLAIN,
        badgeIcon: AlertTriangle,
        badgeClass: "text-status-amber",
        title: exitCode === null ? "Degraded: a service is not running" : `Degraded: a service exited (code ${exitCode})`,
      };
    case "paused":
      return { ...PLAIN, imageClass: GREY, badgeIcon: Pause, badgeClass: "text-white", title: "Paused" };
    case "crashed":
      return {
        ...PLAIN,
        imageClass: GREY,
        badgeIcon: AlertTriangle,
        badgeClass: "text-status-red",
        title: withCode("Crashed", exitCode, false),
      };
    case "stopped":
      return { ...PLAIN, imageClass: GREY, title: withCode("Stopped", exitCode) };
    case "created":
      return { ...PLAIN, imageClass: GREY, ringClass: "border-dashed border-muted-foreground/30", title: "Never started" };
    case "unknown":
    default:
      return { ...PLAIN, imageClass: GREY, title: "Status unknown" };
  }
}

// The coarse status the grid already knows, from the server or from an
// optimistic click (Stop shows as stopped before the server confirms).
function coarseOf(condition: AppCondition): AppGridStatus {
  if (condition === "running" || condition === "starting" || condition === "unhealthy") return "running";
  if (condition === "partial") return "partial";
  if (condition === "paused") return "paused";
  if (condition === "unknown") return "unknown";
  return "stopped";
}

function statusOnlyCondition(status: AppGridStatus): AppCondition {
  if (status === "running" || status === "partial" || status === "paused" || status === "stopped") return status;
  return "unknown";
}

export function getAppVisualState(app: AppItem): AppVisualState {
  if (app.status === "updating") {
    return {
      ...PLAIN,
      imageClass: GREY,
      badgeIcon: RefreshCw,
      badgeClass: "text-white",
      badgeIconClass: "animate-spin",
      title: "Processing",
    };
  }

  if (app.status === "unmanaged") {
    const condition = app.condition ?? { condition: "unknown" as const, exitCode: null };
    const visual = conditionVisual(condition.condition, condition.exitCode);
    // Same colours as Homeio's apps; the dashed outline says someone else runs it.
    return {
      ...visual,
      ringClass: visual.ringClass.includes("border-transparent")
        ? "border-dashed border-muted-foreground/40"
        : `${visual.ringClass} border-dashed`,
      title: `${visual.title} · not managed by Homeio`,
    };
  }

  // Trust the server's finer condition only while it agrees with the status
  // shown, so an optimistic Stop is not overridden by a stale "running".
  const condition =
    app.condition && coarseOf(app.condition.condition) === app.status
      ? app.condition
      : { condition: statusOnlyCondition(app.status), exitCode: null };
  return conditionVisual(condition.condition, condition.exitCode);
}

export function buildUnmanagedAppItems(
  containers: UnmanagedContainer[],
): AppItem[] {
  return containers.map((container) => {
    const visual = pickVisual(container.name, container.id);

    return {
      id: `container:${container.id}`,
      name: container.name,
      icon: visual.icon,
      logoUrl: null,
      color: visual.color,
      bgColor: visual.bgColor,
      status: "unmanaged" as const,
      condition: container.condition,
      category: "Containers",
      webUiPort: container.webUiPort,
      webUiUrl: null,
      containerName: container.name,
      updateAvailable: false,
    } satisfies AppItem;
  });
}

export function buildAppItems(params: {
  installedApps: InstalledApp[];
  installedCatalogApps: StoreAppSummary[];
  operationsByApp: Record<string, AppOperationStateLike>;
  statusByAppId: Record<string, AppGridStatus>;
}) {
  const { installedApps, installedCatalogApps, operationsByApp, statusByAppId } =
    params;
  const installedById = new Map(installedApps.map((app) => [app.id, app]));
  const catalogById = new Map(installedCatalogApps.map((app) => [app.id, app]));
  const ids = Array.from(
    new Set([...installedById.keys(), ...catalogById.keys()]),
  );

  return ids
    .map((appId) => {
      const installed = installedById.get(appId);
      const catalog = catalogById.get(appId);
      const name = catalog?.name ?? installed?.name ?? appId;
      const visual = pickVisual(name, appId);

      let derivedStatus: AppGridStatus = "stopped";
      if (catalog?.status === "installing" || catalog?.status === "updating") {
        derivedStatus = "updating";
      } else if (installed?.status === "running") {
        derivedStatus = "running";
      } else if (installed?.status === "partial") {
        derivedStatus = "partial";
      } else if (installed?.status === "paused") {
        derivedStatus = "paused";
      } else if (installed?.status === "stopped") {
        derivedStatus = "stopped";
      } else if (installed?.status === "unknown") {
        derivedStatus = "unknown";
      }

      const operationState = operationsByApp[appId];
      if (operationState && isStoreOperationActiveStatus(operationState.status)) {
        derivedStatus = "updating";
      } else if (
        installed?.activeOperation &&
        isStoreOperationActiveStatus(installed.activeOperation.status)
      ) {
        derivedStatus = "updating";
      }

      const optimisticStatus = statusByAppId[appId];
      if (optimisticStatus) {
        derivedStatus = optimisticStatus;
      }

      return {
        id: appId,
        name,
        icon: visual.icon,
        logoUrl: catalog?.logoUrl ?? installed?.logoUrl ?? null,
        color: visual.color,
        bgColor: visual.bgColor,
        status: derivedStatus,
        condition: installed?.condition ?? null,
        category: catalog?.categories[0] ?? visual.category,
        webUiPort: installed?.webUiPort ?? null,
        webUiUrl: installed?.webUiUrl ?? null,
        containerName: installed?.containerName ?? null,
        updateAvailable: catalog?.updateAvailable ?? false,
      } satisfies AppItem;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildActiveAppOperations(params: {
  installedApps: InstalledApp[];
  installedCatalogApps: StoreAppSummary[];
  operationsByApp: Record<string, AppOperationStateLike>;
  nowIso?: string;
}) {
  const {
    installedApps,
    installedCatalogApps,
    operationsByApp,
    nowIso = new Date().toISOString(),
  } = params;
  const appNames = new Map<string, string>();

  for (const app of installedApps) {
    appNames.set(app.id, app.name);
  }

  for (const app of installedCatalogApps) {
    if (!appNames.has(app.id)) {
      appNames.set(app.id, app.name);
    }
  }

  const merged = new Map<string, ActiveAppOperation>();

  for (const app of installedApps) {
    if (
      app.activeOperation &&
      isStoreOperationActiveStatus(app.activeOperation.status)
    ) {
      merged.set(app.id, {
        appId: app.id,
        appName: appNames.get(app.id) ?? app.name,
        action: app.activeOperation.action,
        status: app.activeOperation.status,
        progressPercent: app.activeOperation.progressPercent,
        updatedAt: app.activeOperation.updatedAt,
      });
    }
  }

  for (const operation of Object.values(operationsByApp)) {
    if (!isStoreOperationActiveStatus(operation.status)) {
      continue;
    }

    merged.set(operation.appId, {
      appId: operation.appId,
      appName: appNames.get(operation.appId) ?? operation.appId,
      action: operation.action,
      status: operation.status,
      progressPercent: operation.progressPercent,
      updatedAt: operation.updatedAt ?? nowIso,
    });
  }

  return Array.from(merged.values()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}
