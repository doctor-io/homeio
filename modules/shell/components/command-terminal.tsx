"use client";

import type { TerminalOutputLine } from "@/lib/shared/contracts/terminal";
import { useTerminalCommand } from "@/modules/shell/hooks/useTerminalCommand";
import { ChevronRight, Copy, Download, Search, X } from "@/components/icons/platform-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FocusEvent,
} from "react";

type TermLine = {
  type: "input" | "output" | "error" | "info" | "welcome";
  content: string;
  prompt?: string;
};

type TerminalCommandRequest = {
  id: number;
  command: string;
} | null;

const HOSTNAME = "home-server";
const USER = "homeio";

/** Maximum lines kept in the scrollback buffer to avoid DOM bloat. */
const MAX_SCROLLBACK_LINES = 2000;

/**
 * Commands available for Tab completion.
 * Keep in sync with ALLOWED_COMMANDS in lib/server/modules/terminal/service.ts
 */
const COMPLETABLE_COMMANDS = [
  "help",
  "ls",
  "cd",
  "pwd",
  "cat",
  "echo",
  "whoami",
  "hostname",
  "uname",
  "uptime",
  "df",
  "free",
  "docker",
  "ping",
  "ip",
  "date",
  "history",
  "clear",
];

function toPromptPath(cwd: string) {
  if (!cwd.startsWith("/home/")) return cwd;
  const segments = cwd.split("/");
  if (segments.length < 3) return cwd;
  const homePrefix = `/home/${segments[2]}`;
  if (cwd === homePrefix) return "~";
  if (cwd.startsWith(`${homePrefix}/`)) {
    return `~${cwd.slice(homePrefix.length)}`;
  }
  return cwd;
}

function getPrompt(cwd: string) {
  return `${USER}@${HOSTNAME}:${toPromptPath(cwd)}$`;
}

function mapOutputLine(line: TerminalOutputLine): TermLine {
  return { type: line.type, content: line.content };
}

function linesToText(lines: TermLine[]): string {
  return lines
    .map((line) => {
      if (line.type === "input") return `${line.prompt ?? ""} ${line.content}`;
      return line.content;
    })
    .join("\n");
}

/**
 * The command terminal: one command at a time over HTTP, limited to an allow
 * list. Only used where the interactive terminal is not available (#58).
 */
export function CommandTerminal({
  commandRequest = null,
  readOnly = false,
}: {
  commandRequest?: TerminalCommandRequest;
  readOnly?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const [lines, setLines] = useState<TermLine[]>([
    {
      type: "welcome",
      content: `Welcome to Home Server Terminal
Commands are executed on the backend in non-interactive mode.

Type 'help' for available commands.
Shortcuts: Ctrl+C interrupt  Ctrl+L clear  Ctrl+F search  Ctrl+W delete word`,
    },
  ]);
  const [currentInput, setCurrentInput] = useState("");
  const [cwd, setCwd] = useState("~");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  /** Whether the input element is currently focused. */
  const [isFocused, setIsFocused] = useState(false);

  /** Search state */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const lastCommandRequestIdRef = useRef<number | null>(null);
  const executionQueueRef = useRef(Promise.resolve());

  /** AbortController for the in-flight HTTP request. */
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Pending cursor position to restore after a state-triggered re-render.
   * Used by readline shortcuts (Ctrl+W, Ctrl+K, Ctrl+U) that change the
   * input value AND need to reposition the cursor.
   */
  const nextCursorPosRef = useRef<number | null>(null);

  /** Tab completion session: tracks the partial input and candidate list. */
  const tabStateRef = useRef<{
    partial: string;
    matches: string[];
    idx: number;
  } | null>(null);

  const { executeCommand, isExecuting } = useTerminalCommand();

  // ── Scroll to bottom instantly on new output ──────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // ── Restore cursor position after value changes (readline shortcuts) ───────
  useEffect(() => {
    if (nextCursorPosRef.current !== null && inputRef.current) {
      const pos = nextCursorPosRef.current;
      nextCursorPosRef.current = null;
      inputRef.current.setSelectionRange(pos, pos);
    }
  }, [currentInput]);

  // ── Auto-focus when execution finishes ─────────────────────────────────────
  useEffect(() => {
    if (!isExecuting && !readOnly) {
      inputRef.current?.focus();
    }
  }, [isExecuting, readOnly]);

  // ── Focus search input when panel opens ───────────────────────────────────
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [searchOpen]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // ── Search match indices (memoised) ───────────────────────────────────────
  const searchMatchLineIndices = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return lines.reduce<number[]>((acc, line, i) => {
      if (line.content.toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }, [lines, searchQuery]);

  // ── Scroll to current search match ────────────────────────────────────────
  useEffect(() => {
    if (!searchOpen || searchMatchLineIndices.length === 0) return;
    const lineIdx = searchMatchLineIndices[searchMatchIndex];
    scrollRef.current
      ?.querySelector(`[data-line-index="${lineIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [searchMatchIndex, searchOpen, searchMatchLineIndices]);

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  const scheduleFocusInput = useCallback(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
    }
    focusFrameRef.current = requestAnimationFrame(() => {
      inputRef.current?.focus();
      focusFrameRef.current = null;
    });
  }, []);

  const focusInput = useCallback(() => {
    if (readOnly) return;
    inputRef.current?.focus();
  }, [readOnly]);

  function handleInputBlur(event: FocusEvent<HTMLInputElement>) {
    setIsFocused(false);
    if (readOnly) return;
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && rootRef.current?.contains(nextTarget)) return;
    scheduleFocusInput();
  }

  /** Append lines to the output buffer, respecting the scrollback cap. */
  const appendLines = useCallback((newLines: TermLine[]) => {
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_SCROLLBACK_LINES
        ? combined.slice(combined.length - MAX_SCROLLBACK_LINES)
        : combined;
    });
  }, []);

  function navigateSearchMatch(direction: "prev" | "next") {
    if (searchMatchLineIndices.length === 0) return;
    const len = searchMatchLineIndices.length;
    setSearchMatchIndex((idx) =>
      direction === "next" ? (idx + 1) % len : (idx - 1 + len) % len,
    );
  }

  function handleCopyAll() {
    void navigator.clipboard.writeText(linesToText(lines));
  }

  function handleDownloadTranscript() {
    const blob = new Blob([linesToText(lines)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `terminal-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Command execution
  // ─────────────────────────────────────────────────────────────────────────

  const runCommand = useCallback(
    async (inputValue: string) => {
      const input = inputValue.trim();
      if (!input) return;

      if (input === "clear") {
        setLines([]);
        setCommandHistory((prev) => [...prev, input]);
        setHistoryIndex(-1);
        return;
      }

      const history = [...commandHistory, input];
      appendLines([{ type: "input", content: input, prompt: getPrompt(cwd) }]);
      setCommandHistory(history);
      setHistoryIndex(-1);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const result = await executeCommand(
          { command: input, cwd, history },
          controller.signal,
        );
        abortControllerRef.current = null;

        setCwd(result.cwd);

        if (result.lines.some((line) => line.content === "__CLEAR__")) {
          setLines([]);
          return;
        }

        const outputLines = result.lines.map(mapOutputLine);
        if (outputLines.length > 0) {
          appendLines(outputLines);
        }
      } catch (error) {
        abortControllerRef.current = null;
        if (error instanceof Error && error.name === "AbortError") return;
        appendLines([
          {
            type: "error",
            content:
              error instanceof Error
                ? error.message
                : "Failed to execute command",
          },
        ]);
      }
    },
    [commandHistory, cwd, executeCommand, appendLines],
  );

  const enqueueCommand = useCallback(
    (value: string) => {
      executionQueueRef.current = executionQueueRef.current
        .then(() => runCommand(value))
        .catch(() => undefined);
    },
    [runCommand],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Form / keyboard handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    tabStateRef.current = null;
    enqueueCommand(currentInput);
    setCurrentInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const ctrl = e.ctrlKey || e.metaKey;

    // ── Ctrl+C — interrupt or clear input ───────────────────────────────
    if (e.key === "c" && ctrl) {
      e.preventDefault();
      tabStateRef.current = null;
      if (isExecuting) {
        abortControllerRef.current?.abort();
        appendLines([{ type: "input", content: "^C", prompt: getPrompt(cwd) }]);
      } else {
        appendLines([
          {
            type: "input",
            content: `${currentInput}^C`,
            prompt: getPrompt(cwd),
          },
        ]);
        setCurrentInput("");
        setHistoryIndex(-1);
      }
      return;
    }

    // ── Ctrl+F — toggle search panel ────────────────────────────────────
    if (e.key === "f" && ctrl) {
      e.preventDefault();
      setSearchOpen((open) => !open);
      return;
    }

    // ── Ctrl+L — clear ──────────────────────────────────────────────────
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
      return;
    }

    // ── Ctrl+A — move cursor to beginning of line ────────────────────────
    if (e.key === "a" && e.ctrlKey) {
      e.preventDefault();
      inputRef.current?.setSelectionRange(0, 0);
      return;
    }

    // ── Ctrl+E — move cursor to end of line ─────────────────────────────
    if (e.key === "e" && e.ctrlKey) {
      e.preventDefault();
      const len = currentInput.length;
      inputRef.current?.setSelectionRange(len, len);
      return;
    }

    // ── Ctrl+W — delete word before cursor ──────────────────────────────
    if (e.key === "w" && e.ctrlKey) {
      e.preventDefault();
      tabStateRef.current = null;
      const pos = inputRef.current?.selectionStart ?? currentInput.length;
      const before = currentInput.slice(0, pos);
      const after = currentInput.slice(pos);
      const newBefore = before.replace(/\s*\S+$/, "");
      nextCursorPosRef.current = newBefore.length;
      setCurrentInput(newBefore + after);
      return;
    }

    // ── Ctrl+K — delete from cursor to end of line ──────────────────────
    if (e.key === "k" && e.ctrlKey) {
      e.preventDefault();
      tabStateRef.current = null;
      const pos = inputRef.current?.selectionStart ?? currentInput.length;
      nextCursorPosRef.current = pos;
      setCurrentInput(currentInput.slice(0, pos));
      return;
    }

    // ── Ctrl+U — delete from cursor to beginning of line ────────────────
    if (e.key === "u" && e.ctrlKey) {
      e.preventDefault();
      tabStateRef.current = null;
      const pos = inputRef.current?.selectionStart ?? currentInput.length;
      nextCursorPosRef.current = 0;
      setCurrentInput(currentInput.slice(pos));
      return;
    }

    // ── ArrowUp — history previous ──────────────────────────────────────
    if (e.key === "ArrowUp") {
      e.preventDefault();
      tabStateRef.current = null;
      if (commandHistory.length === 0) return;
      const next =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setCurrentInput(commandHistory[next]);
      return;
    }

    // ── ArrowDown — history next ─────────────────────────────────────────
    if (e.key === "ArrowDown") {
      e.preventDefault();
      tabStateRef.current = null;
      if (historyIndex === -1) return;
      const next = historyIndex + 1;
      if (next >= commandHistory.length) {
        setHistoryIndex(-1);
        setCurrentInput("");
        return;
      }
      setHistoryIndex(next);
      setCurrentInput(commandHistory[next]);
      return;
    }

    // ── Tab — command completion with cycling ────────────────────────────
    if (e.key === "Tab") {
      e.preventDefault();

      // Continue an existing completion session (cycle to next match)
      if (tabStateRef.current) {
        const { matches, idx } = tabStateRef.current;
        if (matches.length === 0) return;
        const nextIdx = (idx + 1) % matches.length;
        tabStateRef.current.idx = nextIdx;
        setCurrentInput(`${matches[nextIdx]} `);
        return;
      }

      // Start a new completion session
      const partial = currentInput.trim();
      if (!partial) return;

      const matches = COMPLETABLE_COMMANDS.filter((cmd) =>
        cmd.startsWith(partial),
      );
      if (matches.length === 0) return;

      if (matches.length === 1) {
        setCurrentInput(`${matches[0]} `);
        return;
      }

      // Multiple matches: show them and start cycling from the first
      tabStateRef.current = { partial, matches, idx: 0 };
      appendLines([{ type: "info", content: matches.join("  ") }]);
      setCurrentInput(`${matches[0]} `);
      return;
    }

    // Reset tab state on any other key
    tabStateRef.current = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // External commandRequest prop (injected from outside, e.g. App Store)
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!commandRequest) return;
    if (lastCommandRequestIdRef.current === commandRequest.id) return;
    lastCommandRequestIdRef.current = commandRequest.id;
    enqueueCommand(commandRequest.command);
    setCurrentInput("");
  }, [commandRequest, enqueueCommand]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-card/90 select-text handheld:bg-[var(--mobile-canvas)]">
      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-popover/70 px-3 py-1.5 handheld:border-[var(--mobile-divider)] handheld:bg-[var(--mobile-panel)] handheld:px-[var(--mobile-gutter)] handheld:py-0.5">
        {/* Status indicator dot */}
        <span
          className={`size-2 shrink-0 rounded-[var(--radius)] transition-colors ${
            isExecuting
              ? "bg-status-yellow animate-pulse"
              : isFocused
                ? "bg-status-green animate-pulse"
                : "bg-muted-foreground/30"
          }`}
        />
        <ChevronRight className="size-3 text-muted-foreground shrink-0" />
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={`${USER}@${HOSTNAME}`}>
          {USER}@{HOSTNAME}
        </span>

        {/* Right-side action buttons */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSearchOpen((o) => !o)}
                className={`rounded p-1 transition-colors cursor-pointer handheld:grid handheld:size-11 handheld:place-items-center ${
                  searchOpen
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Search terminal output"
              >
                <Search className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Search output (Ctrl+F)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopyAll}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer handheld:grid handheld:size-11 handheld:place-items-center"
                aria-label="Copy all terminal output"
              >
                <Copy className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Copy all output</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleDownloadTranscript}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer handheld:grid handheld:size-11 handheld:place-items-center"
                aria-label="Download terminal transcript"
              >
                <Download className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>Download transcript</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Search bar (shown when searchOpen) ───────────────────────────── */}
      {searchOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-glass-border bg-popover/50 px-3 py-1.5 handheld:gap-1 handheld:px-[var(--mobile-gutter)] handheld:py-0.5">
          <Search className="size-3.5 text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchMatchIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
                scheduleFocusInput();
              } else if (e.key === "Enter") {
                navigateSearchMatch(e.shiftKey ? "prev" : "next");
              } else if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setSearchOpen(false);
                setSearchQuery("");
                scheduleFocusInput();
              }
            }}
            placeholder="Search output…"
            aria-label="Search output"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground handheld:min-h-11 handheld:text-base"
            spellCheck={false}
          />

          {searchQuery.trim() && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground handheld:sr-only" role="status">
              {searchMatchLineIndices.length > 0
                ? `${searchMatchIndex + 1}/${searchMatchLineIndices.length}`
                : "no matches"}
            </span>
          )}

          <div className="flex items-center">
            <button
              onClick={() => navigateSearchMatch("prev")}
              className="rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer handheld:size-11"
              title="Previous match (Shift+Enter)"
            >
              ↑
            </button>
            <button
              onClick={() => navigateSearchMatch("next")}
              className="rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer handheld:size-11"
              title="Next match (Enter)"
            >
              ↓
            </button>
          </div>

          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
              scheduleFocusInput();
            }}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer handheld:grid handheld:size-11 handheld:place-items-center"
            aria-label="Close search"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── Output area ──────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-sm leading-5 cursor-text handheld:overscroll-contain handheld:px-[var(--mobile-gutter)]"
        onClick={readOnly ? undefined : focusInput}
      >
        {lines.map((line, index) => {
          const isSearchHit =
            searchQuery.trim() !== "" &&
            line.content.toLowerCase().includes(searchQuery.toLowerCase());
          const isCurrentHit =
            isSearchHit && searchMatchLineIndices[searchMatchIndex] === index;

          return (
            <div
              key={index}
              data-line-index={index}
              className={`whitespace-pre-wrap break-all ${
                isCurrentHit
                  ? "bg-primary/20 rounded"
                  : isSearchHit
                    ? "bg-primary/10 rounded"
                    : ""
              }`}
            >
              {line.type === "welcome" && (
                <span className="text-primary/80">{line.content}</span>
              )}
              {line.type === "input" && (
                <div>
                  <span className="text-status-green">{line.prompt}</span>{" "}
                  <span className="text-foreground">{line.content}</span>
                </div>
              )}
              {line.type === "output" && (
                <span className="text-foreground/90">{line.content}</span>
              )}
              {line.type === "error" && (
                <span className="text-status-red">{line.content}</span>
              )}
              {line.type === "info" && (
                <span className="text-primary/70">{line.content}</span>
              )}
            </div>
          );
        })}

        {readOnly ? (
          <div className="pt-2 text-xs text-muted-foreground">
            Read-only mode. Command input is disabled.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-center">
            <span className="text-status-green shrink-0 handheld:max-w-[45%] handheld:truncate">{getPrompt(cwd)}</span>
            <span>&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              value={currentInput}
              onChange={(event) => {
                setCurrentInput(event.target.value);
                tabStateRef.current = null;
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={handleInputBlur}
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none font-mono text-sm caret-primary handheld:min-h-11 handheld:text-base"
              aria-label="Terminal command"
              enterKeyHint="send"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
            />
          </form>
        )}
      </div>

      {/* ── Status bar ───────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-t border-glass-border bg-popover/70 px-4 py-1.5 font-mono text-xs text-muted-foreground">
        <span
          className={
            isExecuting
              ? "text-status-yellow animate-pulse"
              : readOnly
                ? ""
                : "text-status-green/70"
          }
        >
          {isExecuting ? "running…" : readOnly ? "read-only" : "ready"}
        </span>
        <span>{toPromptPath(cwd)}</span>
        <span>{commandHistory.length} cmds</span>
      </div>
    </div>
  );
}
