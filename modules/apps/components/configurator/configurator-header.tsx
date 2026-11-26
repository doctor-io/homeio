import { X } from "@/components/icons/platform-icons";

import type { ConfiguratorView } from "@/modules/apps/components/configurator/configurator-mapper";

type ConfiguratorHeaderProps = {
  title: string;
  activeView: ConfiguratorView;
  views: ConfiguratorView[];
  onViewChange: (view: ConfiguratorView) => void;
  onClose?: () => void;
  withinMobileWindow?: boolean;
};

function formatViewLabel(view: ConfiguratorView) {
  if (view === "classic") return "Classic";
  if (view === "compose") return "Docker Compose";
  return "Docker Run";
}

export function ConfiguratorHeader({
  title,
  activeView,
  views,
  onViewChange,
  onClose,
  withinMobileWindow,
}: ConfiguratorHeaderProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-glass-border px-4 py-3 handheld:px-[var(--mobile-gutter)] handheld:py-2">
      <div className="min-w-0">
        {!withinMobileWindow && <h3 className="mb-2 truncate text-lg font-semibold text-foreground">{title}</h3>}
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={activeView === view}
              onClick={() => onViewChange(view)}
              className={`min-h-11 cursor-pointer rounded-md border px-2.5 py-1 text-2xs md:min-h-0 handheld:min-h-11 handheld:text-xs font-medium transition-colors ${
                activeView === view
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-glass-border text-muted-foreground hover:bg-secondary/45 hover:text-foreground"
              }`}
            >
              {formatViewLabel(view)}
            </button>
          ))}
        </div>
      </div>
      {onClose && !withinMobileWindow ? (
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-glass-border p-1.5 md:min-h-0 md:min-w-0 handheld:min-h-11 handheld:min-w-11 text-muted-foreground transition-colors hover:bg-secondary/45 hover:text-foreground"
          aria-label="Close configurator"
          title="Close"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </header>
  );
}
