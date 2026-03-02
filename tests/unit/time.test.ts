import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  heatmapCell,
  renderBar,
  buildSessionDurations,
  TemporalAnalyzer,
  SessionCollector,
  runTime,
} from "../../src/time.js";
import { createProgress } from "../../src/progress.js";
import type { ChannelMeta } from "../../src/metadata.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/servers-export");

// ─── heatmapCell ───────────────────────────────────────────────────────────────

describe("heatmapCell", () => {
  test("returns dot for zero", () => {
    expect(heatmapCell(0)).toBe(".");
  });

  test("returns digit for 1-9", () => {
    expect(heatmapCell(1)).toBe("1");
    expect(heatmapCell(9)).toBe("9");
  });

  test("returns asterisk for 10-99", () => {
    expect(heatmapCell(10)).toBe("*");
    expect(heatmapCell(99)).toBe("*");
  });

  test("returns hash for 100+", () => {
    expect(heatmapCell(100)).toBe("#");
    expect(heatmapCell(999)).toBe("#");
  });
});

// ─── renderBar ─────────────────────────────────────────────────────────────────

describe("renderBar", () => {
  test("renders full bar at max value", () => {
    expect(renderBar(100, 100, 10)).toBe("█".repeat(10));
  });

  test("scales bar proportionally", () => {
    const bar = renderBar(50, 100, 10);
    expect(bar).toBe("█".repeat(5));
  });

  test("returns empty string when max is zero", () => {
    expect(renderBar(0, 0, 10)).toBe("");
  });

  test("renders at least 1 char for non-zero count", () => {
    const bar = renderBar(1, 1000, 10);
    expect(bar.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── buildSessionDurations ─────────────────────────────────────────────────────

describe("buildSessionDurations", () => {
  test("pairs start/end events by time order", () => {
    const starts = [{ ts: new Date("2024-01-10T09:00:00Z"), os: "Windows" }];
    const ends = [{ ts: new Date("2024-01-10T11:00:00Z") }];
    const sessions = buildSessionDurations(starts, ends);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.os).toBe("Windows");
    expect(sessions[0]!.durationMs).toBe(2 * 3600 * 1000);
  });

  test("discards sessions longer than 24 hours", () => {
    const starts = [{ ts: new Date("2024-01-10T00:00:00Z"), os: "Linux" }];
    const ends = [{ ts: new Date("2024-01-12T01:00:00Z") }]; // 49h later
    const sessions = buildSessionDurations(starts, ends);
    expect(sessions).toHaveLength(0);
  });

  test("handles multiple sessions correctly", () => {
    const starts = [
      { ts: new Date("2024-01-10T08:00:00Z"), os: "macOS" },
      { ts: new Date("2024-01-10T12:00:00Z"), os: "Windows" },
    ];
    const ends = [
      { ts: new Date("2024-01-10T10:00:00Z") },
      { ts: new Date("2024-01-10T14:00:00Z") },
    ];
    const sessions = buildSessionDurations(starts, ends);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.os).toBe("macOS");
    expect(sessions[1]!.os).toBe("Windows");
  });

  test("returns empty array for empty input", () => {
    expect(buildSessionDurations([], [])).toHaveLength(0);
  });
});

// ─── TemporalAnalyzer ──────────────────────────────────────────────────────────

describe("TemporalAnalyzer", () => {
  const makeMeta = (id: string): ChannelMeta => ({
    id,
    name: `ch-${id}`,
    isDM: false,
    dmPartnerId: null,
    guildId: null,
    guildName: null,
  });

  test("records messages in correct heatmap slot (Mon=day 0)", () => {
    const analyzer = new TemporalAnalyzer();
    // 2024-01-08 is a Monday
    const meta = makeMeta("ch1");
    analyzer.onMessage({
      id: "1",
      timestamp: new Date("2024-01-08T10:00:00"),
      contents: "hi",
      attachments: "",
      channelId: "ch1",
      channelMeta: meta,
    });
    expect(analyzer.heatmap[0]![10]).toBe(1); // Mon, hour 10
  });

  test("records monthly activity", () => {
    const analyzer = new TemporalAnalyzer();
    const meta = makeMeta("ch1");
    for (let day = 1; day <= 3; day++) {
      analyzer.onMessage({
        id: String(day),
        timestamp: new Date(`2024-03-0${day}T12:00:00`),
        contents: "msg",
        attachments: "",
        channelId: "ch1",
        channelMeta: meta,
      });
    }
    expect(analyzer.monthly.get("2024-03")).toBe(3);
  });

  test("skips invalid timestamps", () => {
    const analyzer = new TemporalAnalyzer();
    const meta = makeMeta("ch1");
    analyzer.onMessage({
      id: "1",
      timestamp: new Date("invalid"),
      contents: "msg",
      attachments: "",
      channelId: "ch1",
      channelMeta: meta,
    });
    const total = analyzer.heatmap.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
    expect(analyzer.monthly.size).toBe(0);
  });
});

// ─── SessionCollector ──────────────────────────────────────────────────────────

describe("SessionCollector", () => {
  test("collects session_start with OS from extra_field_1", () => {
    const collector = new SessionCollector();
    collector.onEvent({
      event_type: "session_start",
      timestamp: "2024-01-10T09:00:00.000Z",
      extra_field_1: "Windows",
    });
    expect(collector.starts).toHaveLength(1);
    expect(collector.starts[0]!.os).toBe("Windows");
  });

  test("collects session_start with OS from os field", () => {
    const collector = new SessionCollector();
    collector.onEvent({
      event_type: "session_start",
      timestamp: "2024-01-10T09:00:00.000Z",
      os: "Linux",
    });
    expect(collector.starts[0]!.os).toBe("Linux");
  });

  test("collects session_end events", () => {
    const collector = new SessionCollector();
    collector.onEvent({
      event_type: "session_end",
      timestamp: "2024-01-10T11:00:00.000Z",
    });
    expect(collector.ends).toHaveLength(1);
  });

  test("defaults OS to Unknown when not provided", () => {
    const collector = new SessionCollector();
    collector.onEvent({
      event_type: "session_start",
      timestamp: "2024-01-10T09:00:00.000Z",
    });
    expect(collector.starts[0]!.os).toBe("Unknown");
  });
});

// ─── runTime integration ───────────────────────────────────────────────────────

describe("runTime", () => {
  test("runs on fixture export without throwing", async () => {
    const prog = createProgress();
    await expect(runTime(FIXTURE_DIR, prog)).resolves.toBeUndefined();
  });

  test("throws for non-existent path", async () => {
    const prog = createProgress();
    await expect(runTime("/nonexistent/path", prog)).rejects.toThrow();
  });
});
