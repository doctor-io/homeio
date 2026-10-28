import { describe, expect, it } from "vitest";
import { formatClockTime } from "@/lib/desktop/clock-format";

describe("clock format", () => {
  const sample = new Date("2026-10-26T15:30:00.000Z");

  it("uses 24-hour time when timeFormat is 24h", () => {
    const formatted = formatClockTime(sample, {
      locale: "en-US",
      timeFormat: "24h",
    });

    expect(formatted).not.toMatch(/AM|PM/i);
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });

  it("uses 12-hour time when timeFormat is 12h", () => {
    const formatted = formatClockTime(sample, {
      locale: "en-US",
      timeFormat: "12h",
    });

    expect(formatted).toMatch(/AM|PM/i);
  });
});
