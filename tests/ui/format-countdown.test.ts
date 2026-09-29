import { describe, expect, it } from "vitest";
import { formatCountdown } from "../../src/lib/format.ts";

describe("formatCountdown", () => {
  it("counts down in seconds, so a running step visibly ticks", () => {
    expect(formatCountdown(59 * 60_000 + 42_000)).toBe("59:42");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(60_000)).toBe("1:00");
  });

  it("shows hours from an hour up", () => {
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown(90 * 60_000 - 18_000)).toBe("1:29:42");
  });

  it("rounds a partial second up, so it never shows 0:00 before the time is out", () => {
    expect(formatCountdown(59 * 60_000 + 59_001)).toBe("1:00:00");
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});
