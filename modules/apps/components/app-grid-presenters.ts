"use client";

import type {
  InstalledApp,
  StoreAppSummary,
  StoreOperationAction,
  StoreOperationStatus,
} from "@/lib/shared/contracts/apps";
import {
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
  | "updating";

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

/**
 * Status is carried by dimming and a small dot, never by a glyph stamped over
 * the artwork. The icon set renders as coloured <img> SVGs, so a badge could
 * not be recoloured to match a state, and at the 10px it was drawn at the
 * detail turned to mush. A dot is CSS: crisp at any size, and its colour is
 * ours to choose.
 */
export function getAppVisualState(app: AppItem) {
  if (app.status === "updating") {
    return {
      containerClass: "animate-pulse shadow-amber-500/20",
      imageClass: "",
      dotClass: "bg-status-amber",
      dotInnerClass: "animate-pulse",
      ringClass: "border-status-amber/60",
      title: "Processing",
    };
  }

  // Degraded is the one state here that genuinely wants attention, so it keeps
  // amber. It does not need to pulse to say so.
  if (app.status === "partial") {
    return {
      containerClass: "",
      imageClass: "opacity-80 saturate-50",
      dotClass: "bg-status-amber",
      dotInnerClass: "",
      ringClass: "border-status-amber/40",
      title: "Degraded",
    };
  }

  // Pausing is a deliberate act, like stopping, so it carries no alert colour.
  // The pause glyph is what separates it from off — less dimming than stopped,
  // because a paused app is still loaded.
  if (app.status === "paused") {
    return {
      containerClass: "",
      imageClass: "opacity-80 saturate-50",
      dotClass: "bg-muted-foreground/50",
      dotInnerClass: "",
      ringClass: "border-transparent",
      title: "Paused",
    };
  }

  // A stopped app is not a failure — usually someone stopped it on purpose —
  // so it gets no alarm colour, no pulsing frame and no blinking dot. Dimming
  // and desaturating says "off" the way every dock and launcher already does,
  // and it stays legible next to a running app without shouting.
  //
  // Red is deliberately unused here: the status union has no error state, so
  // nothing on this grid warrants an alarm. Keep it free for one.
  if (app.status === "stopped") {
    return {
      containerClass: "",
      imageClass: "opacity-50 grayscale",
      dotClass: "",
      dotInnerClass: "",
      ringClass: "border-transparent",
      title: "Stopped",
    };
  }

  // Unknown is genuinely uncertain rather than off, so it keeps a mark — muted,
  // not red, and not animated.
  if (app.status === "unknown") {
    return {
      containerClass: "",
      imageClass: "opacity-50 grayscale",
      dotClass: "bg-muted-foreground/50",
      dotInnerClass: "",
      ringClass: "border-transparent",
      title: "Status unknown",
    };
  }

  return {
    containerClass: "",
    imageClass: "",
    dotClass: "",
    dotInnerClass: "",
    ringClass: "border-transparent",
    title: "Running",
  };
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
