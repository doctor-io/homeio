"use client";

type ImportUrlViewProps = {
  url: string;
  ref: string;
  name: string;
  onChange: (next: { url?: string; ref?: string; name?: string }) => void;
};

/**
 * Imports a compose file the user did not write. The fetch happens server-side
 * (the browser cannot read most raw hosts directly, and the guards belong on
 * the server anyway) — this view only collects where to look.
 */
export function ImportUrlView({ url, ref: sourceRef, name, onChange }: ImportUrlViewProps) {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-url" className="text-2xs font-medium text-muted-foreground">
          Compose file URL
        </label>
        <input
          id="import-url"
          value={url}
          onChange={(event) => onChange({ url: event.target.value })}
          placeholder="https://raw.githubusercontent.com/owner/repo/main/docker-compose.yml"
          spellCheck={false}
          className="rounded-lg border border-glass-border bg-black/20 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
        />
        <p className="text-2xs text-muted-foreground">
          Point at the raw file, not the repository page. Private networks are refused unless
          your server allows LAN sources.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-name" className="text-2xs font-medium text-muted-foreground">
          App name
        </label>
        <input
          id="import-name"
          value={name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Taken from the URL when left empty"
          className="rounded-lg border border-glass-border bg-black/20 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="import-ref" className="text-2xs font-medium text-muted-foreground">
          Pin to a commit or tag <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <input
          id="import-ref"
          value={sourceRef}
          onChange={(event) => onChange({ ref: event.target.value })}
          placeholder="9f2c1ab"
          spellCheck={false}
          className="rounded-lg border border-glass-border bg-black/20 px-2.5 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/50"
        />
        <p className="text-2xs text-muted-foreground">
          Recorded with the app so a later re-import can tell whether upstream changed.
        </p>
      </div>
    </div>
  );
}
