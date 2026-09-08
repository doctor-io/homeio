import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const apps = pgTable(
  "apps",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status").notNull().default("unknown"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("apps_name_idx").on(table.name)],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    totpSecret: text("totp_secret"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    totpBackupCodes: text("totp_backup_codes"),
    totpEnrolledAt: timestamp("totp_enrolled_at", { withTimezone: true }),
  },
  (table) => [index("users_username_idx").on(table.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const appStacks = pgTable(
  "app_stacks",
  {
    appId: text("app_id").primaryKey(),
    templateName: text("template_name").notNull(),
    stackName: text("stack_name").notNull(),
    composePath: text("compose_path").notNull(),
    status: text("status").notNull().default("not_installed"),
    webUiPort: integer("web_ui_port"),
    webUiUrl: text("web_ui_url"),
    /** Subdomain this app is published under when the tunnel is enabled. */
    tunnelSubdomain: text("tunnel_subdomain"),
    envJson: jsonb("env_json").notNull().default({}),
    displayName: text("display_name"),
    iconUrl: text("icon_url"),
    installedAt: timestamp("installed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    isUpToDate: boolean("is_up_to_date").default(true),
    lastUpdateCheck: timestamp("last_update_check", { withTimezone: true }),
    localDigest: text("local_digest"),
    remoteDigest: text("remote_digest"),
  },
  (table) => [
    index("app_stacks_status_idx").on(table.status),
    index("app_stacks_web_ui_port_idx").on(table.webUiPort),
  ],
);

export const appOperations = pgTable(
  "app_operations",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    progressPercent: integer("progress_percent").notNull().default(0),
    currentStep: text("current_step").notNull().default("queued"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("app_operations_app_id_idx").on(table.appId),
    index("app_operations_status_idx").on(table.status),
    index("app_operations_updated_at_idx").on(table.updatedAt.desc()),
  ],
);

export const customStoreApps = pgTable(
  "custom_store_apps",
  {
    appId: text("app_id").primaryKey(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    webUiUrl: text("web_ui_url"),
    sourceType: text("source_type").notNull(),
    sourceText: text("source_text").notNull(),
    composeContent: text("compose_content").notNull(),
    repositoryUrl: text("repository_url"),
    // URL-sourced custom apps (v2.0 Track 2). Null for apps pasted by hand:
    // only an import knows where its compose came from, which ref it was
    // pinned to, and what the body hashed to when it was last fetched.
    sourceUrl: text("source_url"),
    sourceRef: text("source_ref"),
    sourceChecksum: text("source_checksum"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("custom_store_apps_updated_at_idx").on(table.updatedAt.desc())],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // scrypt, same construction as password hashing — the raw token is never
    // stored, so a database read cannot yield a working credential.
    tokenHash: text("token_hash").notNull(),
    // Indexed lookup key, so validating a token hashes one row instead of the
    // whole table.
    prefix: text("prefix").notNull(),
    scopes: jsonb("scopes").notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_tokens_prefix_idx").on(table.prefix),
    index("api_tokens_created_at_idx").on(table.createdAt.desc()),
  ],
);

export const appHealth = pgTable(
  "app_health",
  {
    appId: text("app_id").primaryKey(),
    // Docker's own policy names, so the stored value is what compose takes.
    // Defaults to "no": auto-heal is off until an operator turns it on.
    restartPolicy: text("restart_policy").notNull().default("no"),
    maxRestarts: integer("max_restarts").notNull().default(5),
    windowMinutes: integer("window_minutes").notNull().default(10),
    state: text("state").notNull().default("unknown"),
    restartCount: integer("restart_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }),
    lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("app_health_state_idx").on(table.state)],
);

export const filesNetworkShares = pgTable(
  "files_network_shares",
  {
    id: text("id").primaryKey(),
    host: text("host").notNull(),
    share: text("share").notNull(),
    username: text("username").notNull(),
    passwordCiphertext: text("password_ciphertext").notNull(),
    passwordIv: text("password_iv").notNull(),
    passwordTag: text("password_tag").notNull(),
    mountPath: text("mount_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("files_network_shares_mount_path_idx").on(table.mountPath),
    index("files_network_shares_created_at_idx").on(table.createdAt),
  ],
);

export const filesLocalShares = pgTable(
  "files_local_shares",
  {
    id: text("id").primaryKey(),
    shareName: text("share_name").notNull(),
    sourcePath: text("source_path").notNull(),
    sharedPath: text("shared_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("files_local_shares_share_name_idx").on(table.shareName),
    uniqueIndex("files_local_shares_source_path_idx").on(table.sourcePath),
    uniqueIndex("files_local_shares_shared_path_idx").on(table.sharedPath),
    index("files_local_shares_created_at_idx").on(table.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    kind: text("kind").notNull().default("info"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notifications_created_at_idx").on(table.createdAt.desc())],
);

export const scheduledTasks = pgTable(
  "scheduled_tasks",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    taskType: text("task_type").notNull(),
    taskConfig: jsonb("task_config").notNull().default({}),
    cronExpression: text("cron_expression").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastRunStatus: text("last_run_status"),
    lastRunOutput: text("last_run_output"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("scheduled_tasks_next_run_at_idx").on(table.nextRunAt)],
);

export const scheduledTaskExecutions = pgTable(
  "scheduled_task_executions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => scheduledTasks.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    output: text("output"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("scheduled_task_executions_task_id_idx").on(table.taskId),
    index("scheduled_task_executions_started_at_idx").on(table.startedAt.desc()),
  ],
);

export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("singleton"),
  appearanceJson: jsonb("appearance_json").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  googleClientId: text("google_client_id"),
  googleClientSecretCiphertext: text("google_client_secret_ciphertext"),
  googleClientSecretIv: text("google_client_secret_iv"),
  googleClientSecretTag: text("google_client_secret_tag"),
  googleRedirectUri: text("google_redirect_uri"),
  tailscaleTailnet: text("tailscale_tailnet"),
  tailscaleApiKeyCiphertext: text("tailscale_api_key_ciphertext"),
  tailscaleApiKeyIv: text("tailscale_api_key_iv"),
  tailscaleApiKeyTag: text("tailscale_api_key_tag"),
  // First-run wizard (v2.0 Track 1). Deliberately nullable with no default:
  // a NULL onboardingState means "this install predates the wizard", so
  // servers upgrading from 1.7 are never dropped into setup. Only the
  // register flow flips it to "pending" — see modules/onboarding.
  onboardingState: text("onboarding_state"),
  onboardingStep: integer("onboarding_step"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  timezone: text("timezone"),
  defaultStorageRoot: text("default_storage_root"),
  // Push delivery (v2.0 Track 7). Off until an operator turns it on, so an
  // upgraded install keeps exactly the notifications it had.
  pushEnabled: boolean("push_enabled").notNull().default(false),
  pushNtfyUrl: text("push_ntfy_url"),
  pushNtfyTopic: text("push_ntfy_topic"),
  pushNtfyTokenCiphertext: text("push_ntfy_token_ciphertext"),
  pushNtfyTokenIv: text("push_ntfy_token_iv"),
  pushNtfyTokenTag: text("push_ntfy_token_tag"),
  /** False — the default — sends a signal with no alert text in it. */
  pushIncludeContent: boolean("push_include_content").notNull().default(false),
  cloudflareTunnelEnabled: boolean("cloudflare_tunnel_enabled").notNull().default(false),
  cloudflareTunnelDomain: text("cloudflare_tunnel_domain"),
  cloudflareTunnelTokenCiphertext: text("cloudflare_tunnel_token_ciphertext"),
  cloudflareTunnelTokenIv: text("cloudflare_tunnel_token_iv"),
  cloudflareTunnelTokenTag: text("cloudflare_tunnel_token_tag"),
});

export const filesGoogleDriveTokens = pgTable(
  "files_google_drive_tokens",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenIv: text("access_token_iv").notNull(),
    accessTokenTag: text("access_token_tag").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    refreshTokenIv: text("refresh_token_iv"),
    refreshTokenTag: text("refresh_token_tag"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("files_google_drive_tokens_email_idx").on(table.email),
    index("files_google_drive_tokens_created_at_idx").on(table.createdAt),
  ],
);

export const filesTrashEntries = pgTable(
  "files_trash_entries",
  {
    id: text("id").primaryKey(),
    trashPath: text("trash_path").notNull(),
    originalPath: text("original_path").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("files_trash_entries_trash_path_idx").on(table.trashPath),
    index("files_trash_entries_deleted_at_idx").on(table.deletedAt.desc()),
  ],
);

/**
 * Short-lived codes behind the pairing QR, so a phone can be signed in by
 * scanning rather than by typing a tailnet address and a password on a
 * touchscreen.
 *
 * The code is the credential, so: hashed at rest, single use (claimed_at is
 * set in the same statement that reads it), and dead in a minute. Minting a
 * new one drops the owner's earlier unclaimed codes, so at most one QR on one
 * screen is ever live.
 */
export const pairingCodes = pgTable(
  "pairing_codes",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedIp: text("claimed_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pairing_codes_code_hash_idx").on(table.codeHash),
    index("pairing_codes_user_id_idx").on(table.userId),
  ],
);
