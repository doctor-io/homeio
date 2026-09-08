"use client";

import type { StoreAppDetail } from "@/lib/shared/contracts/apps";
import type { AppActionTarget } from "@/modules/apps/components/app-grid";
import { ClassicFormView } from "@/modules/apps/components/configurator/classic-form-view";
import { ComposeEditorView } from "@/modules/apps/components/configurator/compose-editor-view";
import { ConfiguratorHeader } from "@/modules/apps/components/configurator/configurator-header";
import {
  buildInitialComposeDraft,
  buildInitialDockerRunState,
  buildInstallPayloadFromClassic,
  buildSettingsPayloadFromClassic,
  classicStateToCompose,
  createDefaultClassicState,
  safeComposeToClassicState,
  toAppId,
  type ClassicConfigState,
  type ConfiguratorView,
  type DockerRunState,
} from "@/modules/apps/components/configurator/configurator-mapper";
import { DockerRunView } from "@/modules/apps/components/configurator/docker-run-view";
import { useAppCompose } from "@/modules/apps/hooks/useAppCompose";
import {
  type InstallAppInput,
  type InstallCustomAppInput,
  type SaveAppSettingsInput,
} from "@/modules/apps/hooks/useStoreActions";
import { useSharedStoreActions } from "@/modules/apps/hooks/StoreActionsContext";
import { useStoreApp } from "@/modules/apps/hooks/useStoreApp";
import { Loader2 } from "@/components/icons/platform-icons";
import { useEffect, useMemo, useRef, useState } from "react";

export type AppConfiguratorContext =
  | "installed_edit"
  | "catalog_install"
  | "custom_install";

export type AppConfiguratorPanelProps = {
  context: AppConfiguratorContext;
  target?: AppActionTarget;
  template?: StoreAppDetail;
  customDefaults?: {
    name?: string;
    iconUrl?: string;
  };
  actions?: {
    installApp?: (input: InstallAppInput) => Promise<unknown>;
    installCustomApp?: (input: InstallCustomAppInput) => Promise<unknown>;
    saveAppSettings?: (input: SaveAppSettingsInput) => Promise<unknown>;
  };
  onClose?: () => void;
};

function parseDashboardUrl(input: string | undefined) {
  const browserHost =
    typeof window !== "undefined" && window.location.hostname.trim().length > 0
      ? window.location.hostname
      : "localhost";

  if (!input) {
    return {
      host: browserHost,
      port: undefined as number | undefined,
    };
  }

  try {
    const parsed = new URL(input);
    return {
      host: parsed.hostname || browserHost,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : undefined,
    };
  } catch {
    return {
      host: browserHost,
      port: undefined as number | undefined,
    };
  }
}

function defaultViewForContext(
  context: AppConfiguratorContext,
): ConfiguratorView {
  if (context === "custom_install") return "docker_run";
  return "classic";
}

function titleForContext(
  context: AppConfiguratorContext,
  currentTitle: string,
) {
  if (context === "installed_edit") return `${currentTitle || "App"} Settings`;
  if (context === "catalog_install") return `Install ${currentTitle || "App"}`;
  return "Install Custom App";
}

export function AppConfiguratorPanel({
  context,
  target,
  template,
  customDefaults,
  actions,
  onClose,
}: AppConfiguratorPanelProps) {
  const derivedTargetAppId = target
    ? target.appId || toAppId(target.appName)
    : undefined;
  const queryAppId =
    context === "custom_install"
      ? null
      : (template?.id ?? derivedTargetAppId ?? null);

  const detailQuery = useStoreApp(queryAppId);
  const fetchedDetail = (detailQuery.data ?? undefined) || undefined;

  const effectiveTemplate = useMemo(() => {
    if (context === "catalog_install") {
      return template ?? fetchedDetail;
    }

    if (context === "installed_edit") {
      return fetchedDetail ?? template;
    }

    return undefined;
  }, [context, fetchedDetail, template]);

  const composeSource = context === "installed_edit" ? "installed" : "catalog";
  const shouldFetchCompose = Boolean(
    queryAppId && context !== "custom_install",
  );
  const composeQuery = useAppCompose(
    queryAppId ?? undefined,
    shouldFetchCompose,
    composeSource,
  );
  const composeResponse = composeQuery.data;
  const composeData = composeResponse?.primary;
  const primaryServiceName = composeResponse?.primaryServiceName;

  const dashboard = parseDashboardUrl(target?.dashboardUrl);
  const seedTitle =
    effectiveTemplate?.installedConfig?.displayName ??
    effectiveTemplate?.name ??
    target?.appName ??
    customDefaults?.name ??
    "";
  const seedIconUrl =
    effectiveTemplate?.installedConfig?.iconUrl ??
    effectiveTemplate?.logoUrl ??
    customDefaults?.iconUrl ??
    "";
  const seedPort = effectiveTemplate?.webUiPort ?? dashboard.port;
  const seedHost = dashboard.host;
  const seedWebUiLink = effectiveTemplate?.installedConfig?.webUiUrl ?? "";

  const fallbackAppId = toAppId(seedTitle || "custom-app") || "custom-app";
  const appId = queryAppId ?? fallbackAppId;

  const initialComposeDraft = useMemo(
    () =>
      composeResponse?.compose ??
      buildInitialComposeDraft({
        appId,
        template: effectiveTemplate,
        composeData,
        dockerImageFallback: `${appId}/${appId}:latest`,
      }),
    [appId, composeData, composeResponse?.compose, effectiveTemplate],
  );

  const initialParsed = useMemo(
    () =>
      safeComposeToClassicState({
        composeDraft: initialComposeDraft,
        seed: {
          title: seedTitle,
          iconUrl: seedIconUrl,
          fallbackPort: seedPort,
          fallbackHost: seedHost,
          webUiLink: seedWebUiLink,
        },
        appId,
        primaryServiceName,
      }),
    [
      appId,
      initialComposeDraft,
      primaryServiceName,
      seedHost,
      seedIconUrl,
      seedPort,
      seedTitle,
      seedWebUiLink,
    ],
  );

  const initialClassicState: ClassicConfigState =
    initialParsed.state ??
    createDefaultClassicState({
      title: seedTitle,
      iconUrl: seedIconUrl,
      fallbackPort: seedPort,
      fallbackHost: seedHost,
      webUiLink: seedWebUiLink,
    });

  const initialDockerRunState = useMemo(
    () =>
      buildInitialDockerRunState({
        title: initialClassicState.title || "my-app",
        iconUrl: initialClassicState.iconUrl,
        port: initialClassicState.webUi.port,
      }),
    [
      initialClassicState.iconUrl,
      initialClassicState.title,
      initialClassicState.webUi.port,
    ],
  );

  const [activeView, setActiveView] = useState<ConfiguratorView>(
    defaultViewForContext(context),
  );
  const [classicState, setClassicState] =
    useState<ClassicConfigState>(initialClassicState);
  const [composeDraft, setComposeDraft] = useState(initialComposeDraft);
  const [composeParseError, setComposeParseError] = useState<string | null>(
    initialParsed.error,
  );
  const [dockerRunState, setDockerRunState] = useState<DockerRunState>(
    initialDockerRunState,
  );
  const [didSave, setDidSave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [installingAppId, setInstallingAppId] = useState<string | null>(null);

  const initialClassicRef = useRef<ClassicConfigState>(initialClassicState);
  const initialComposeRef = useRef(initialComposeDraft);
  const fallbackActions = useSharedStoreActions();
  const installingOperation = installingAppId
    ? fallbackActions.operationsByApp[installingAppId]
    : null;

  // Auto-close on success; surface error and stay open on failure.
  useEffect(() => {
    if (!installingAppId || !installingOperation) return;

    if (installingOperation.status === "success") {
      const timer = setTimeout(() => onClose?.(), 1_500);
      return () => clearTimeout(timer);
    }

    if (installingOperation.status === "error") {
      setSaveError(installingOperation.message ?? "Installation failed");
      setInstallingAppId(null);
    }
  }, [installingAppId, installingOperation, onClose]);
  const saveAppSettings =
    actions?.saveAppSettings ?? fallbackActions.saveAppSettings;
  const installApp = actions?.installApp ?? fallbackActions.installApp;
  const installCustomApp =
    actions?.installCustomApp ?? fallbackActions.installCustomApp;

  useEffect(() => {
    setActiveView(defaultViewForContext(context));
    setClassicState(initialClassicState);
    setComposeDraft(initialComposeDraft);
    setComposeParseError(initialParsed.error);
    setDockerRunState(initialDockerRunState);
    setDidSave(false);
    setSaveError(null);
    setInstallingAppId(null);
    initialClassicRef.current = initialClassicState;
    initialComposeRef.current = initialComposeDraft;
  }, [
    context,
    initialClassicState,
    initialComposeDraft,
    initialDockerRunState,
    initialParsed.error,
  ]);

  const availableViews = useMemo<ConfiguratorView[]>(() => {
    if (context === "custom_install") {
      return ["classic", "compose", "docker_run"];
    }

    return ["classic", "compose"];
  }, [context]);

  useEffect(() => {
    if (availableViews.includes(activeView)) return;
    setActiveView(availableViews[0]);
  }, [activeView, availableViews]);

  function handleClassicChange(nextState: ClassicConfigState) {
    setDidSave(false);
    setSaveError(null);
    setClassicState(nextState);
    setComposeDraft((previousDraft) =>
      classicStateToCompose(nextState, previousDraft, {
        appId,
        primaryServiceName,
      }),
    );
    setComposeParseError(null);
  }

  function handleComposeChange(nextDraft: string) {
    setDidSave(false);
    setSaveError(null);
    setComposeDraft(nextDraft);

    const parsed = safeComposeToClassicState({
      composeDraft: nextDraft,
      seed: {
        title: classicState.title,
        iconUrl: classicState.iconUrl,
        fallbackPort: seedPort,
        fallbackHost: seedHost,
      },
      appId,
      primaryServiceName,
    });

    if (parsed.state) {
      setClassicState(parsed.state);
      setComposeParseError(null);
      return;
    }

    setComposeParseError(parsed.error);
  }

  const title = titleForContext(context, classicState.title || seedTitle);
  const buttonLabel =
    context === "installed_edit"
      ? isSaving
        ? "Saving..."
        : "Save"
      : isSaving
        ? "Installing..."
        : "Install";

  // "classic" view edits form fields directly — the compose YAML is derived
  // from those fields, so a parse error on the underlying draft is irrelevant
  // and must not block the submit button.
  const classicCanSubmit =
    classicState.title.trim().length > 0 &&
    classicState.dockerImage.trim().length > 0 &&
    (context !== "catalog_install" || Boolean(queryAppId));
  const composeCanSubmit =
    composeDraft.trim().length > 0 &&
    !composeParseError &&
    (context !== "catalog_install" || Boolean(queryAppId));
  const dockerRunCanSubmit =
    dockerRunState.name.trim().length > 0 &&
    dockerRunState.source.trim().length > 0;
  const canSubmit =
    activeView === "classic"
      ? classicCanSubmit
      : activeView === "docker_run"
        ? dockerRunCanSubmit
        : composeCanSubmit;
  const shouldBlockOnTemplateLoading =
    context === "catalog_install" &&
    !effectiveTemplate &&
    detailQuery.isLoading;

  async function handleSubmit() {
    if (isSaving || !canSubmit) return;

    setIsSaving(true);
    setDidSave(false);
    setSaveError(null);

    try {
      if (context === "installed_edit") {
        if (!queryAppId) throw new Error("App ID is required for settings");

        await saveAppSettings(
          buildSettingsPayloadFromClassic({
            appId: queryAppId,
            current: classicState,
            initial: initialClassicRef.current,
            composeSource: composeDraft,
            initialComposeSource: initialComposeRef.current,
          }),
        );
      } else if (context === "catalog_install") {
        if (!queryAppId) throw new Error("App ID is required for install");

        await installApp(
          buildInstallPayloadFromClassic({
            appId: queryAppId,
            state: classicState,
            composeSource: composeDraft,
          }),
        );
      } else if (activeView === "docker_run") {
        const result = (await installCustomApp({
          name: dockerRunState.name.trim(),
          iconUrl: dockerRunState.iconUrl.trim() || undefined,
          repositoryUrl: dockerRunState.repositoryUrl.trim() || undefined,
          sourceType: "docker-run",
          source: dockerRunState.source,
        })) as { appId: string } | undefined;
        setInstallingAppId(result?.appId ?? null);
        return;
      } else {
        const result = (await installCustomApp({
          name: classicState.title.trim() || "Custom App",
          iconUrl: classicState.iconUrl.trim() || undefined,
          sourceType: "docker-compose",
          source: composeDraft,
        })) as { appId: string } | undefined;
        setInstallingAppId(result?.appId ?? null);
        return;
      }

      setDidSave(true);
      onClose?.();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Unable to submit app configuration.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-card/90">
      <ConfiguratorHeader
        title={title}
        activeView={activeView}
        views={availableViews}
        onViewChange={setActiveView}
        onClose={onClose}
      />

      {shouldBlockOnTemplateLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading app configuration...
        </div>
      ) : (
        <>
          {context === "installed_edit" && composeQuery.isError ? (
            <div className="mx-3 mt-2 rounded-lg border border-status-red/40 bg-status-red/10 px-2 py-1 text-2xs text-status-red">
              {String(composeQuery.error).includes("installed_compose_missing")
                ? "Installed compose file is unavailable for this app."
                : "Unable to load compose source for this app."}
            </div>
          ) : null}

          {context !== "custom_install" && !effectiveTemplate ? (
            <div className="mx-3 mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-2xs text-amber-200">
              App template metadata is unavailable. You can still edit and
              submit manually.
            </div>
          ) : null}

          {activeView === "classic" ? (
            <ClassicFormView
              appIdLabel={queryAppId ?? appId}
              state={classicState}
              onChange={handleClassicChange}
            />
          ) : null}

          {activeView === "compose" ? (
            <ComposeEditorView
              composeDraft={composeDraft}
              onChange={handleComposeChange}
              parseError={composeParseError}
            />
          ) : null}

          {activeView === "docker_run" && context === "custom_install" ? (
            <DockerRunView
              state={dockerRunState}
              onChange={(nextState) => {
                setDidSave(false);
                setSaveError(null);
                setDockerRunState(nextState);
              }}
            />
          ) : null}
        </>
      )}

      <footer className="flex flex-col border-t border-glass-border px-3 py-2.5 gap-2">
        {installingAppId && installingOperation ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-foreground">
                {installingOperation.status === "success"
                  ? "Installation complete"
                  : installingOperation.status === "error"
                    ? "Installation failed"
                    : installingOperation.step || "Installing…"}
              </span>
              <span className="text-2xs tabular-nums text-muted-foreground shrink-0">
                {installingOperation.progressPercent}%
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  installingOperation.status === "success"
                    ? "bg-status-green"
                    : installingOperation.status === "error"
                      ? "bg-status-red"
                      : "bg-primary"
                }`}
                style={{ width: `${installingOperation.progressPercent}%` }}
              />
            </div>
            {installingOperation.status === "success" ? (
              <span className="text-2xs text-status-green">
                Installed successfully — closing window…
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              {saveError ? (
                <span className="truncate text-xs text-status-red">{saveError}</span>
              ) : context === "installed_edit" ? (
                <span className="text-xs text-muted-foreground">
                  {isSaving ? "Applying changes…" : "Edit and save to redeploy"}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {didSave ? "Installation started" : "Configure settings before installing"}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSaving || !canSubmit}
              className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {buttonLabel}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
