import { readdirSync, createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import type { Progress } from "./progress.js";

export interface AnalyticsCollector {
  eventTypes: Set<string>;
  onEvent(event: Record<string, unknown>): void;
}

const EVENTS_FILE_RE = /^events-\d{4}-00000-of-00001\.json$/i;

const findDirCI = (parent: string, name: string): string | undefined => {
  try {
    const entries = readdirSync(parent, { withFileTypes: true });
    const match = entries.find(
      (e) => e.isDirectory() && e.name.toLowerCase() === name.toLowerCase(),
    );
    return match ? join(parent, match.name) : undefined;
  } catch {
    return undefined;
  }
};

/** Find the analytics events JSONL file under exportDir (case-insensitive). */
export const findEventsFile = (exportDir: string): string | undefined => {
  const pkg = findDirCI(exportDir, "package");
  if (!pkg) return undefined;
  const activity = findDirCI(pkg, "activity");
  if (!activity) return undefined;
  const analytics = findDirCI(activity, "analytics");
  if (!analytics) return undefined;
  try {
    const entries = readdirSync(analytics);
    const match = entries.find((e) => EVENTS_FILE_RE.test(e));
    return match ? join(analytics, match) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Scan the analytics events JSONL file, dispatching each event to matching collectors.
 * Returns total lines scanned.
 */
export async function scanAnalytics(
  exportDir: string,
  collectors: AnalyticsCollector[],
  prog: Progress,
): Promise<number> {
  const eventsPath = findEventsFile(exportDir);
  if (!eventsPath) return 0;

  // Build event_type → collectors[] dispatch map for O(1) lookup
  const dispatch = new Map<string, AnalyticsCollector[]>();
  for (const collector of collectors) {
    for (const eventType of collector.eventTypes) {
      const list = dispatch.get(eventType) ?? [];
      list.push(collector);
      dispatch.set(eventType, list);
    }
  }

  const allEventTypes = [...dispatch.keys()];

  const stream = createReadStream(eventsPath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lines = 0;

  for await (const line of rl) {
    lines++;
    if (lines % 500_000 === 0) {
      prog.update(`  Scanned ${(lines / 1_000_000).toFixed(1)}M lines...`);
    }

    if (!allEventTypes.some((et) => line.includes(et))) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const eventType = typeof parsed.event_type === "string" ? parsed.event_type : null;
    if (!eventType) continue;

    const matching = dispatch.get(eventType);
    if (matching) {
      for (const collector of matching) {
        collector.onEvent(parsed);
      }
    }
  }

  rl.close();
  return lines;
}

/**
 * Parse an analytics timestamp value.
 * The raw value is a string like `'"2023-01-15 14:30:00"'` — strip leading `"` before parsing.
 */
export function parseAnalyticsTimestamp(ts: unknown): Date | null {
  if (typeof ts !== "string" || ts.length < 2) return null;
  const d = new Date(ts.slice(1));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Pair voice join/leave events into sessions.
 * Joins and leaves are sorted per channel, matched greedily, and sessions > 24h are discarded.
 */
export function buildVoiceSessions(
  joins: Array<{ ts: Date; channelId: string; guildId: string | null }>,
  leaves: Array<{ ts: Date; channelId: string }>,
): Array<{ channelId: string; guildId: string | null; durationMs: number }> {
  const joinsByChannel = new Map<
    string,
    Array<{ ts: Date; channelId: string; guildId: string | null }>
  >();
  for (const j of joins) {
    const arr = joinsByChannel.get(j.channelId) ?? [];
    arr.push(j);
    joinsByChannel.set(j.channelId, arr);
  }
  for (const arr of joinsByChannel.values()) {
    arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  const leavesByChannel = new Map<string, Array<{ ts: Date; channelId: string }>>();
  for (const l of leaves) {
    const arr = leavesByChannel.get(l.channelId) ?? [];
    arr.push(l);
    leavesByChannel.set(l.channelId, arr);
  }
  for (const arr of leavesByChannel.values()) {
    arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
  const sessions: Array<{ channelId: string; guildId: string | null; durationMs: number }> = [];

  for (const [channelId, channelJoins] of joinsByChannel) {
    const channelLeaves = leavesByChannel.get(channelId) ?? [];
    let leaveIdx = 0;

    for (const join of channelJoins) {
      // Advance past leaves that occurred before or at this join
      while (leaveIdx < channelLeaves.length && channelLeaves[leaveIdx]!.ts <= join.ts) {
        leaveIdx++;
      }
      if (leaveIdx >= channelLeaves.length) break;

      const leave = channelLeaves[leaveIdx]!;
      leaveIdx++;

      const durationMs = leave.ts.getTime() - join.ts.getTime();
      if (durationMs <= MAX_DURATION_MS) {
        sessions.push({ channelId, guildId: join.guildId, durationMs });
      }
    }
  }

  return sessions;
}
