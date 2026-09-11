import type {
  BatteryMetrics,
  SystemMetricsSnapshot,
} from "@/lib/shared/contracts/system";
import type { NetworkStatus } from "@/lib/shared/contracts/network";

export type Notification = {
  id: string;
  title: string;
  message: string;
  /** Preformatted for display; createdAt is what ordering uses. */
  time: string;
  createdAt: string;
  read: boolean;
};

export type StatusBarProps = {
  onLock?: () => void;
  onLogout?: () => void;
  isLogoutPending?: boolean;
  onOpenNotifications?: () => void;
};

export type StatusPopover = "weather" | "wifi" | "battery" | "tailscale" | "notifications" | "date";

export type WifiPopoverProps = {
  metrics: SystemMetricsSnapshot | undefined;
  networkStatus: NetworkStatus | undefined;
  isDemoMode?: boolean;
  onClose: () => void;
};

export type BatteryPopoverProps = {
  battery: BatteryMetrics | undefined;
  onClose: () => void;
};
