import { describe, expect, it } from "vitest";
import {
  accumulateRestart,
  createDeliberateStopTracker,
  isCrash,
  parseContainerEvent,
  stateForEvent,
} from "@/lib/server/modules/apps/health-watchdog";

function event(action: string, attributes: Record<string, string> = {}, time = 1787200000) {
  return JSON.stringify({
    Type: "container",
    Action: action,
    time,
    Actor: { ID: "abc123", Attributes: { name: "jellyfin-web-1", ...attributes } },
  });
}

describe("parseContainerEvent", () => {
  it("reads a container event", () => {
    const parsed = parseContainerEvent(
      event("die", { exitCode: "137", "com.docker.compose.project": "jellyfin" }),
    );

    expect(parsed).toMatchObject({
      action: "die",
      containerId: "abc123",
      containerName: "jellyfin-web-1",
      project: "jellyfin",
      exitCode: 137,
    });
  });

  it("ignores keep-alive blank lines", () => {
    expect(parseContainerEvent("")).toBeNull();
    expect(parseContainerEvent("   ")).toBeNull();
  });

  it("ignores malformed JSON rather than throwing mid-stream", () => {
    expect(parseContainerEvent("{not json")).toBeNull();
  });

  it("ignores non-container events", () => {
    expect(
      parseContainerEvent(JSON.stringify({ Type: "network", Action: "connect" })),
    ).toBeNull();
  });

  it("strips the detail Docker appends to some actions", () => {
    const parsed = parseContainerEvent(event("health_status: unhealthy"));

    expect(parsed?.action).toBe("health_status");
  });

  it("marks a SIGTERM stop as deliberate", () => {
    const parsed = parseContainerEvent(event("die", { signal: "15", exitCode: "143" }));

    expect(parsed?.wasDeliberate).toBe(true);
  });
});

describe("stateForEvent", () => {
  const base = parseContainerEvent(event("start"))!;

  it("treats a start as healthy", () => {
    expect(stateForEvent({ ...base, action: "start" })).toBe("healthy");
  });

  it("treats a restart as restarting", () => {
    expect(stateForEvent({ ...base, action: "restart" })).toBe("restarting");
  });

  it("treats a non-zero exit as unhealthy", () => {
    expect(stateForEvent({ ...base, action: "die", exitCode: 1 })).toBe("unhealthy");
  });

  it("does not call a clean exit unhealthy", () => {
    expect(stateForEvent({ ...base, action: "die", exitCode: 0 })).toBe("unknown");
  });

  it("has no opinion on events it does not model", () => {
    expect(stateForEvent({ ...base, action: "exec_create" })).toBeNull();
  });
});

describe("isCrash", () => {
  const base = parseContainerEvent(event("die"))!;

  it("counts an unexpected non-zero exit", () => {
    expect(isCrash({ ...base, action: "die", exitCode: 137, wasDeliberate: false })).toBe(true);
  });

  it("does not count a stop the user asked for", () => {
    // The rule the whole feature rests on: a container you stopped stays stopped.
    expect(isCrash({ ...base, action: "die", exitCode: 143, wasDeliberate: true })).toBe(false);
  });

  it("does not count a clean exit", () => {
    expect(isCrash({ ...base, action: "die", exitCode: 0, wasDeliberate: false })).toBe(false);
  });
});

describe("accumulateRestart", () => {
  const start = new Date("2026-08-30T10:00:00Z");

  it("opens a window on the first crash", () => {
    const result = accumulateRestart({ count: 0, startedAt: null }, start, 10, 3);

    expect(result.window).toEqual({ count: 1, startedAt: start });
    expect(result.budgetSpent).toBe(false);
  });

  it("counts crashes inside the window", () => {
    const later = new Date(start.getTime() + 60_000);
    const result = accumulateRestart({ count: 2, startedAt: start }, later, 10, 3);

    expect(result.window.count).toBe(3);
    expect(result.budgetSpent).toBe(false);
  });

  it("reports the budget spent once the count passes the limit", () => {
    const later = new Date(start.getTime() + 60_000);
    const result = accumulateRestart({ count: 3, startedAt: start }, later, 10, 3);

    expect(result.budgetSpent).toBe(true);
  });

  it("starts a fresh window after the old one lapses", () => {
    // An app that crashed twice last week is not in a crash loop today.
    const muchLater = new Date(start.getTime() + 11 * 60_000);
    const result = accumulateRestart({ count: 3, startedAt: start }, muchLater, 10, 3);

    expect(result.window).toEqual({ count: 1, startedAt: muchLater });
    expect(result.budgetSpent).toBe(false);
  });
});

describe("a deliberate stop is not a crash (D-16)", () => {
  function event(action: string, id: string, exitCode: number | null, at = new Date("2026-09-17T12:00:00Z")) {
    return {
      action,
      containerId: id,
      containerName: "app-1",
      project: "app",
      exitCode,
      wasDeliberate: action === "kill",
      at,
    };
  }

  it("marks a die that follows a stop", () => {
    // Measured from Docker's own stream on a plain `docker stop`: kill
    // signal=15, kill signal=9, stop, then die with no signal and exitCode 137.
    // Read alone that die is a crash, so auto-heal put the app straight back up.
    const mark = createDeliberateStopTracker();

    mark(event("stop", "abc", null));
    const died = mark(event("die", "abc", 137));

    expect(died.wasDeliberate).toBe(true);
    expect(isCrash(died)).toBe(false);
  });

  it("still calls a real crash a crash", () => {
    // The control: nothing stopped this one, it just exited non-zero.
    const mark = createDeliberateStopTracker();

    const died = mark(event("die", "def", 1));

    expect(died.wasDeliberate).toBe(false);
    expect(isCrash(died)).toBe(true);
  });

  it("does not carry a stop over to a later, unrelated death", () => {
    const mark = createDeliberateStopTracker();

    mark(event("stop", "abc", null));
    mark(event("die", "abc", 137));
    const crashedLater = mark(event("die", "abc", 137));

    expect(isCrash(crashedLater)).toBe(true);
  });

  it("forgets a stop that never produced a death", () => {
    // Otherwise a container stopped once would be exempt for the life of the
    // process, and a crash days later would be read as deliberate.
    const mark = createDeliberateStopTracker(60_000);

    mark(event("stop", "abc", null, new Date("2026-09-17T12:00:00Z")));
    const muchLater = mark(event("die", "abc", 137, new Date("2026-09-17T12:05:00Z")));

    expect(isCrash(muchLater)).toBe(true);
  });

  it("keeps stops apart per container", () => {
    const mark = createDeliberateStopTracker();

    mark(event("stop", "abc", null));
    const other = mark(event("die", "zzz", 137));

    expect(isCrash(other)).toBe(true);
  });
});
