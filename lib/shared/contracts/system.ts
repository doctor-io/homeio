export type CpuLoad = {
  oneMinute: number;
  fiveMinute: number;
  fifteenMinute: number;
  normalizedPercent: number;
};

export type MemoryUsage = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export type TemperatureMetrics = {
  mainCelsius: number | null;
  maxCelsius: number | null;
  coresCelsius: number[];
};

export type BatteryMetrics = {
  hasBattery: boolean;
  isCharging: boolean;
  percent: number | null;
  timeRemainingMinutes: number | null;
  acConnected: boolean | null;
  manufacturer: string | null;
  cycleCount: number | null;
  designedCapacityWh: number | null;
  maxCapacityWh: number | null;
  designToMaxCapacityPercent: number | null;
};

export type StorageMetrics = {
  mountPath: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
  volumes?: StorageVolumeMetrics[];
  raid?: RaidMetrics | null;
  smart?: SmartHealthMetrics | null;
};

export type StorageVolumeMetrics = {
  id: string;
  label: string;
  mountPath: string;
  device: string;
  filesystem: string | null;
  mediaType: string | null;
  totalBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export type RaidMetrics = {
  name: string;
  type: string;
  totalBytes: number | null;
  redundancy: string | null;
  status: "healthy" | "degraded" | "unknown";
};

export type SmartDiskInfo = {
  device: string;
  name: string | null;
  vendor: string | null;
  type: string | null;
  sizeBytes: number | null;
  status: "healthy" | "degraded" | "unknown";
  smartStatus: string;
  temperatureCelsius: number | null;
  powerOnHours: number | null;
};

export type SmartHealthMetrics = {
  status: "healthy" | "degraded" | "unknown";
  healthyDisks: number;
  failingDisks: number;
  checkedAt: string;
  message: string;
  disks: SmartDiskInfo[];
};

export type WifiAccessPoint = {
  ssid: string;
  channel: number | null;
  qualityPercent: number | null;
  security: string | null;
};

export type WifiMetrics = {
  connected: boolean;
  iface: string | null;
  ssid: string | null;
  bssid: string | null;
  signalPercent: number | null;
  txRateMbps: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  ipv4: string | null;
  ipv6: string | null;
  availableNetworks: WifiAccessPoint[];
};

export const SYSTEM_TIMEZONE_OPTIONS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export const SYSTEM_BACKUP_DAY_OPTIONS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const SYSTEM_BACKUP_FREQUENCY_OPTIONS = ["daily", "weekly"] as const;
export const SYSTEM_SECURITY_POLICY_OPTIONS = ["allow", "deny", "reject"] as const;

export const SYSTEM_SECURITY_MAX_RETRIES_MIN = 1;
export const SYSTEM_SECURITY_MAX_RETRIES_MAX = 20;
export const SYSTEM_SECURITY_BAN_DURATION_MIN = 60;
export const SYSTEM_SECURITY_BAN_DURATION_MAX = 2_592_000;

export type SystemBackupFrequency = (typeof SYSTEM_BACKUP_FREQUENCY_OPTIONS)[number];
export type SystemBackupDayOfWeek = (typeof SYSTEM_BACKUP_DAY_OPTIONS)[number];
export type SystemSecurityPolicy = (typeof SYSTEM_SECURITY_POLICY_OPTIONS)[number];

export type SystemPreferences = {
  hostname: string;
  timezone: string;
};

export type SystemUpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
};

export type SystemUpdateApplyAcceptedResponse = {
  action: "update";
  accepted: true;
};

export type SystemSecuritySettings = {
  firewallEnabled: boolean;
  firewallIncomingPolicy: SystemSecurityPolicy;
  firewallOutgoingPolicy: SystemSecurityPolicy;
  fail2banEnabled: boolean;
  fail2banMaxRetries: number;
  fail2banBanDurationSeconds: number;
};

export type SystemBackupSettings = {
  enabled: boolean;
  frequency: SystemBackupFrequency;
  dayOfWeek: SystemBackupDayOfWeek;
  time: string;
  retentionCount: number;
};

export type SystemBackupSummary = {
  id: string;
  createdAt: string;
  sizeBytes: number;
  appVersion: string;
  hostname: string;
  backupPath: string;
  dbDumpIncluded: boolean;
  dataRootIncluded: boolean;
  stacksRootIncluded: boolean;
  storeConfigIncluded: boolean;
  status: "completed" | "failed";
};

export type SystemBackupListResponse = {
  settings: SystemBackupSettings;
  backups: SystemBackupSummary[];
  backupRoot: string;
};

export type SystemRestoreAcceptedResponse = {
  action: "restore";
  accepted: true;
  backupId: string;
};

export type SystemMetricsSnapshot = {
  timestamp: string;
  hostname: string;
  platform: string;
  architecture: string;
  uptimeSeconds: number;
  cpu: CpuLoad;
  memory: MemoryUsage;
  temperature: TemperatureMetrics;
  battery: BatteryMetrics;
  storage?: StorageMetrics;
  wifi: WifiMetrics;
  process: {
    pid: number;
    uptimeSeconds: number;
    nodeVersion: string;
  };
};

export type SystemStreamEvent = {
  type: "metrics.updated" | "heartbeat";
  data: SystemMetricsSnapshot | { timestamp: string };
};
