type ComposeEditorViewProps = {
  composeDraft: string;
  onChange: (next: string) => void;
  parseError: string | null;
};

export function ComposeEditorView({ composeDraft, onChange, parseError }: ComposeEditorViewProps) {
  return (
    <section className="min-h-0 flex-1 overflow-hidden px-4 py-3 handheld:flex handheld:flex-col handheld:overflow-y-auto handheld:overscroll-contain handheld:px-[var(--mobile-gutter)]">
      <div className="mb-2 rounded-lg border border-glass-border bg-secondary/25 px-2.5 py-1.5 text-2xs text-muted-foreground">
        Docker Compose is the source of truth. Classic fields are derived from this draft.
      </div>

      {parseError ? (
        <div className="mb-2 rounded-lg border border-status-red/40 bg-status-red/10 px-2.5 py-1.5 text-2xs text-status-red">
          Unable to parse compose: {parseError}
        </div>
      ) : null}

      <textarea
        aria-label="Docker Compose"
        value={composeDraft}
        onChange={(event) => onChange(event.target.value)}
        className="h-[calc(100%-2rem)] w-full resize-none rounded-lg border border-glass-border bg-secondary/20 p-2.5 font-mono text-xs leading-4 text-foreground outline-none focus:border-primary/50 handheld:h-auto handheld:min-h-16 handheld:flex-1 handheld:leading-snug"
      />
    </section>
  );
}
