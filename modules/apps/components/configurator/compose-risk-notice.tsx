"use client";

export type ComposeRisk = {
  code: string;
  service: string;
  detail: string;
};

type ComposeRiskNoticeProps = {
  risks: ComposeRisk[];
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Shown when the server refuses an install until the host-level access a
 * compose file asks for has been seen. The point is that the user reads the
 * list, so it is spelled out per service rather than summarised.
 */
export function ComposeRiskNotice({
  risks,
  isBusy = false,
  onConfirm,
  onCancel,
}: ComposeRiskNoticeProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm host access"
      className="rounded-lg border border-status-amber/40 bg-status-amber/10 px-3 py-2.5"
    >
      <p className="text-xs font-medium text-status-amber">
        This app asks for privileged access to your server
      </p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {risks.map((risk) => (
          <li key={`${risk.service}-${risk.code}`} className="text-2xs text-status-amber/90">
            <span className="font-medium text-status-amber">{risk.service}</span>
            {" — "}
            {risk.detail}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-2xs text-status-amber/80">
        Install it only if you trust the source.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isBusy}
          className="cursor-pointer rounded-md border border-status-amber/50 bg-status-amber/20 px-2.5 py-1 text-2xs font-medium text-status-amber transition-colors hover:bg-status-amber/30 disabled:opacity-60"
        >
          {isBusy ? "Installing…" : "I understand, install anyway"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="cursor-pointer rounded-md border border-glass-border px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
