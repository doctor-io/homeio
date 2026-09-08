export type StoreOperationAction =
  | "install"
  | "update"
  | "redeploy"
  | "uninstall"
  | "start"
  | "stop"
  | "restart"
  | "check-updates";

export type StoreOperationStatus = "queued" | "running" | "success" | "error";

export type StoreOperation = {
  id: string;
  appId: string;
  action: StoreOperationAction;
  status: StoreOperationStatus;
  progressPercent: number;
  currentStep: string;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type InstalledAppActiveOperation = Pick<
  StoreOperation,
  "id" | "action" | "status" | "progressPercent" | "currentStep" | "updatedAt"
>;

export type InstalledApp = {
  id: string;
  name: string;
  stackName: string;
  composePath: string;
  webUiPort?: number | null;
  /** Operator-set link for this app. Null means "build the default from the browser location". */
  webUiUrl?: string | null;
  containerName?: string | null;
  logoUrl?: string | null;
  status: "running" | "partial" | "paused" | "stopped" | "unknown";
  activeOperation?: InstalledAppActiveOperation | null;
  updatedAt: string;
};

export type InstalledStackStatus =
  | "installed"
  | "not_installed"
  | "installing"
  | "error"
  | "updating"
  | "uninstalling";

export type StoreAppEnvDefinition = {
  name: string;
  label?: string;
  description?: string;
  default?: string;
};

export type StoreCatalogSourceKind = "official" | "remote";
export type StoreAppSourceKind = StoreCatalogSourceKind | "custom";
export type StoreCatalogSourceStatus = "ready" | "syncing" | "error";

export type StoreCatalogSource = {
  id: string;
  name: string;
  url: string;
  kind: StoreCatalogSourceKind;
  enabled: boolean;
  status: StoreCatalogSourceStatus;
  sourcePath: string;
  suppressedAppIds: string[];
  addedAt: string;
  updatedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type StoreCatalogSourceCreateRequest = {
  url: string;
  name?: string;
};

export type StoreCatalogSourceUpdateRequest = {
  enabled: boolean;
};

export type StoreAppSummary = {
  id: string;
  name: string;
  description: string;
  platform: string;
  categories: string[];
  logoUrl: string | null;
  repositoryUrl: string;
  stackFile: string;
  status: InstalledStackStatus;
  webUiPort: number | null;
  updateAvailable: boolean;
  installedImage?: string | null;
  image?: string | null;
  sourceId: string;
  sourceName: string;
  sourceKind: StoreAppSourceKind;
};

export type StoreAppDetail = StoreAppSummary & {
  note: string;
  env: StoreAppEnvDefinition[];
  screenshots: string[];
  installedConfig: InstalledStackConfig | null;
};

export type InstalledStackConfig = {
  appId: string;
  templateName: string;
  stackName: string;
  composePath: string;
  status: InstalledStackStatus;
  webUiPort: number | null;
  webUiUrl: string | null;
  tunnelSubdomain: string | null;
  env: Record<string, string>;
  displayName: string | null;
  iconUrl: string | null;
  installedAt: string | null;
  updatedAt: string;
  isUpToDate: boolean;
  lastUpdateCheck: string | null;
};

export type DockerPullProgressDetail = {
  current: number;
  total: number;
  percent: number | null;
};

export type StoreOperationEventType =
  | "operation.started"
  | "operation.step"
  | "operation.pull.progress"
  | "operation.completed"
  | "operation.failed";

export type StoreOperationEvent = {
  type: StoreOperationEventType;
  operationId: string;
  appId: string;
  action: StoreOperationAction;
  status: StoreOperationStatus;
  timestamp: string;
  progressPercent: number;
  step: string;
  message?: string;
  image?: string;
  dockerStatus?: string;
  progressDetail?: DockerPullProgressDetail;
};
