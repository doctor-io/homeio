import type { DockerRunState } from "@/modules/apps/components/configurator/configurator-mapper";

type DockerRunViewProps = {
  state: DockerRunState;
  onChange: (state: DockerRunState) => void;
};

export function DockerRunView({ state, onChange }: DockerRunViewProps) {
  const update = (patch: Partial<DockerRunState>) => {
    onChange({ ...state, ...patch });
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 handheld:overscroll-contain handheld:px-[var(--mobile-gutter)]">
      <p className="mb-3 text-2xs text-muted-foreground">
        Docker Run is available for custom installs only. Paste a full <code>docker run ...</code>{" "}
        command here; <code>docker pull ...</code> is not supported in this tab. Web UI
        metadata is derived from the published ports in the command.
      </p>

      <div className="space-y-3">
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          App Name
          <input
            aria-label="App Name"
            required
            value={state.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="My App"
            className="h-9 rounded-lg border border-glass-border bg-secondary/35 px-2.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Icon URL
          <input
            aria-label="Icon URL"
            value={state.iconUrl}
            onChange={(event) => update({ iconUrl: event.target.value })}
            placeholder="https://..."
            className="h-9 rounded-lg border border-glass-border bg-secondary/35 px-2.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Repository URL (optional)
          <input
            aria-label="Repository URL"
            value={state.repositoryUrl}
            onChange={(event) => update({ repositoryUrl: event.target.value })}
            placeholder="https://github.com/owner/repo"
            className="h-9 rounded-lg border border-glass-border bg-secondary/35 px-2.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
        </label>

        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Docker Run Command
          <textarea
            aria-label="Docker Run"
            required
            rows={9}
            value={state.source}
            onChange={(event) => update({ source: event.target.value })}
            placeholder="docker run --name myapp -p 8080:80 nginx:latest"
            className="resize-y rounded-lg border border-glass-border bg-secondary/20 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
          />
        </label>
      </div>
    </section>
  );
}
