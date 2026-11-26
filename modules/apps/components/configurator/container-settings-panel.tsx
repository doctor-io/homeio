"use client";

import type { AppActionTarget } from "@/modules/apps/components/app-grid";
import { useContainerCustomization } from "@/modules/apps/hooks/useContainerCustomization";
import { useUnmanagedContainers } from "@/modules/apps/hooks/useUnmanagedContainers";
import { Container, Loader2 } from "@/components/icons/platform-icons";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

type FormState = {
  displayName: string;
  iconUrl: string;
  dashboardUrl: string;
};

const EMPTY_FORM: FormState = { displayName: "", iconUrl: "", dashboardUrl: "" };

function isHttpUrl(value: string) {
  if (value.length === 0) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Settings for a container Homeio did not deploy (#55). Its compose file is
 * not Homeio's to edit, so this only changes how the desktop shows it: the
 * name, the icon and where "Open Dashboard" goes.
 */
export function ContainerSettingsPanel({
  target,
  onClose,
}: {
  target: AppActionTarget;
  onClose?: () => void;
}) {
  const containersQuery = useUnmanagedContainers();
  const container = containersQuery.data?.find(
    (entry) => entry.name === target.containerName,
  );
  const saveMutation = useContainerCustomization(target.containerName);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [iconFailed, setIconFailed] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Fill the form once the container is known; later refetches must not
  // overwrite what the operator is typing.
  useEffect(() => {
    if (!container || loadedFor === container.name) return;
    setForm({
      displayName: container.displayName ?? "",
      iconUrl: container.iconUrl ?? "",
      dashboardUrl: container.dashboardUrl ?? "",
    });
    setLoadedFor(container.name);
  }, [container, loadedFor]);

  const iconUrl = form.iconUrl.trim();
  const dashboardUrl = form.dashboardUrl.trim();
  const iconUrlValid = isHttpUrl(iconUrl);
  const dashboardUrlValid = isHttpUrl(dashboardUrl);
  const canSave = iconUrlValid && dashboardUrlValid && !saveMutation.isPending;

  function update(patch: Partial<FormState>) {
    if (patch.iconUrl !== undefined) setIconFailed(false);
    setForm((previous) => ({ ...previous, ...patch }));
  }

  async function save(next: FormState) {
    try {
      await saveMutation.mutateAsync({
        displayName: next.displayName.trim() || null,
        iconUrl: next.iconUrl.trim() || null,
        dashboardUrl: next.dashboardUrl.trim() || null,
      });
      toast.success(`${next.displayName.trim() || target.containerName} saved`);
      onClose?.();
    } catch {
      // The error is shown in the footer.
    }
  }

  if (containersQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-card/90 text-sm text-muted-foreground">
        Loading container...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/90 handheld:bg-[var(--mobile-canvas)]">
      <section className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 handheld:overscroll-contain handheld:px-[var(--mobile-gutter)]">
        <div className="flex items-center gap-3 rounded-lg border border-glass-border bg-secondary/25 px-3 py-2.5">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-glass-border bg-white/90">
            {iconUrl && iconUrlValid && !iconFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                className="size-full object-cover"
                onError={() => setIconFailed(true)}
              />
            ) : (
              <Container className="size-6 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground handheld:whitespace-normal handheld:[overflow-wrap:anywhere]">
              {form.displayName.trim() || target.containerName}
            </p>
            <p className="truncate text-2xs text-muted-foreground handheld:whitespace-normal handheld:[overflow-wrap:anywhere]">
              {target.containerName}
              {container?.image ? ` · ${container.image}` : ""}
            </p>
            <p className="text-2xs text-muted-foreground">
              Not managed by Homeio: only how it shows on the desktop changes.
            </p>
          </div>
        </div>

        <Field label="Name" hint={`Leave empty to show "${target.containerName}".`}>
          <TextInput
            ariaLabel="Name"
            value={form.displayName}
            onChange={(value) => update({ displayName: value })}
            placeholder={target.containerName}
            maxLength={80}
          />
        </Field>

        <Field
          label="Icon URL"
          error={iconUrlValid ? undefined : "Enter an http:// or https:// URL."}
        >
          <TextInput
            ariaLabel="Icon URL"
            value={form.iconUrl}
            onChange={(value) => update({ iconUrl: value })}
            placeholder="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyfin.png"
            invalid={!iconUrlValid}
          />
        </Field>

        <Field
          label="Dashboard URL"
          hint="Where Open Dashboard and Copy URL go."
          error={dashboardUrlValid ? undefined : "Enter an http:// or https:// URL."}
        >
          <TextInput
            ariaLabel="Dashboard URL"
            value={form.dashboardUrl}
            onChange={(value) => update({ dashboardUrl: value })}
            placeholder="http://192.168.1.10:8096"
            invalid={!dashboardUrlValid}
          />
        </Field>
      </section>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-glass-border px-3 py-2.5 handheld:bg-[var(--mobile-panel)] handheld:px-[var(--mobile-gutter)]">
        <span className="min-w-0 truncate text-xs text-status-red handheld:whitespace-normal handheld:[overflow-wrap:anywhere]">
          {saveMutation.error instanceof Error ? saveMutation.error.message : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_FORM);
              void save(EMPTY_FORM);
            }}
            disabled={saveMutation.isPending}
            className="cursor-pointer rounded-[var(--radius)] border border-glass-border bg-secondary/40 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary/60 disabled:cursor-not-allowed disabled:opacity-50 handheld:min-h-11"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => void save(form)}
            disabled={!canSave}
            className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 handheld:min-h-11"
          >
            {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
      </footer>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      {children}
      {error ? (
        <p className="text-2xs text-status-red">{error}</p>
      ) : hint ? (
        <p className="text-2xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function TextInput({
  ariaLabel,
  value,
  onChange,
  placeholder,
  maxLength,
  invalid = false,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  invalid?: boolean;
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`h-9 w-full rounded-lg border bg-secondary/35 px-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none handheld:h-11 handheld:text-base ${
        invalid
          ? "border-status-red/70 focus:border-status-red"
          : "border-glass-border focus:border-primary/50"
      }`}
    />
  );
}
