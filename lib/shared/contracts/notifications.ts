/**
 * Security notifications are recognised by title, because the server writes
 * them without knowing the viewer's preferences — a failed sign-in has no
 * session to read a setting from — and the desktop decides whether to show
 * them. One constant, so the producer and the filter cannot drift apart.
 */
export const SECURITY_NOTIFICATION_TITLE = "Failed sign-in attempts";

export type NotificationKind = "info" | "success" | "error";

export type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  read: boolean;
  createdAt: string;
};

export type NotificationsListResponse = {
  notifications: NotificationRecord[];
};

export type NotificationSseEvent =
  | { type: "notification.created"; notification: NotificationRecord }
  | { type: "notification.read-all" }
  | { type: "notification.cleared" };
