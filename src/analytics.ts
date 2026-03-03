import { readdirSync } from "fs";
import { join } from "path";
import type { Progress } from "./progress.js";

export interface AnalyticsCollector {
  eventTypes: Set<string>;
  onEvent(event: Record<string, unknown>): void;
}

const EVENTS_FILE_RE = /^events-\d{4}-00000-of-00001\.json$/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

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

/** Find all analytics events JSONL files under exportDir/Activity/* (case-insensitive). */
export const findEventsFiles = (exportDir: string): string[] => {
  const activity = findDirCI(exportDir, "activity");
  if (!activity) return [];
  try {
    const subDirs = readdirSync(activity, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(activity, e.name));
    const found: string[] = [];
    for (const dir of subDirs) {
      try {
        const entries = readdirSync(dir);
        const match = entries.find((e) => EVENTS_FILE_RE.test(e));
        if (match) found.push(join(dir, match));
      } catch {
        // skip unreadable subdirs
      }
    }
    return found;
  } catch {
    return [];
  }
};

/** @deprecated Use findEventsFiles. Kept for backward compatibility. */
export const findEventsFile = (exportDir: string): string | undefined =>
  findEventsFiles(exportDir)[0];

/**
 * Scan all analytics events JSONL files, dispatching each event to matching collectors.
 * Returns total lines scanned.
 */
export const scanAnalytics = async (
  exportDir: string,
  collectors: AnalyticsCollector[],
  prog: Progress,
): Promise<number> => {
  const eventsPaths = findEventsFiles(exportDir);
  if (eventsPaths.length === 0) return 0;

  // Build event_type → collectors[] dispatch map for O(1) lookup
  const dispatch = new Map<string, AnalyticsCollector[]>();
  for (const collector of collectors) {
    for (const eventType of collector.eventTypes) {
      const list = dispatch.get(eventType) ?? [];
      list.push(collector);
      dispatch.set(eventType, list);
    }
  }

  // Precompile a regex to extract event_type value without full JSON.parse
  const eventTypeRe = /"event_type":"([^"]+)"/;
  let totalLines = 0;

  for (const eventsPath of eventsPaths) {
    const text = await Bun.file(eventsPath).text();
    const lines = text.split("\n");

    for (const line of lines) {
      if (!line) continue;
      totalLines++;
      if (totalLines % 500_000 === 0) {
        prog.update(`  Scanned ${(totalLines / 1_000_000).toFixed(1)}M lines...`);
      }

      // Extract event_type cheaply before doing full JSON.parse
      const etMatch = eventTypeRe.exec(line);
      if (!etMatch) continue;
      const eventType = etMatch[1]!;

      const matching = dispatch.get(eventType);
      if (!matching) continue;

      let parsed: Record<string, unknown> | undefined;
      try {
        const p: unknown = JSON.parse(line);
        if (isRecord(p)) {
          parsed = p;
        }
      } catch {
        continue;
      }
      if (!parsed) continue;

      for (const collector of matching) {
        collector.onEvent(parsed);
      }
    }
  }

  return totalLines;
};

/**
 * Parse an analytics timestamp value.
 * The raw value is a string like `'"2023-01-15 14:30:00"'` — strip leading `"` before parsing.
 */
export const parseAnalyticsTimestamp = (ts: unknown): Date | null => {
  if (typeof ts !== "string" || ts.length < 2) return null;
  const d = new Date(ts.slice(1));
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Pair voice join/leave events into sessions.
 * Joins and leaves are sorted per channel, matched greedily, and sessions > 24h are discarded.
 */
export const buildVoiceSessions = (
  joins: { ts: Date; channelId: string; guildId: string | null }[],
  leaves: { ts: Date; channelId: string }[],
): { channelId: string; guildId: string | null; durationMs: number }[] => {
  const joinsByChannel = new Map<
    string,
    { ts: Date; channelId: string; guildId: string | null }[]
  >();
  for (const j of joins) {
    const arr = joinsByChannel.get(j.channelId) ?? [];
    arr.push(j);
    joinsByChannel.set(j.channelId, arr);
  }
  for (const arr of joinsByChannel.values()) {
    arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  const leavesByChannel = new Map<string, { ts: Date; channelId: string }[]>();
  for (const l of leaves) {
    const arr = leavesByChannel.get(l.channelId) ?? [];
    arr.push(l);
    leavesByChannel.set(l.channelId, arr);
  }
  for (const arr of leavesByChannel.values()) {
    arr.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
  const sessions: { channelId: string; guildId: string | null; durationMs: number }[] = [];

  for (const [channelId, channelJoins] of joinsByChannel) {
    const channelLeaves = leavesByChannel.get(channelId) ?? [];
    let leaveIdx = 0;

    for (const jv of channelJoins) {
      // Advance past leaves that occurred before or at this join
      while (leaveIdx < channelLeaves.length && channelLeaves[leaveIdx]!.ts <= jv.ts) {
        leaveIdx++;
      }
      if (leaveIdx >= channelLeaves.length) break;

      const leave = channelLeaves[leaveIdx]!;
      leaveIdx++;

      const durationMs = leave.ts.getTime() - jv.ts.getTime();
      if (durationMs <= MAX_DURATION_MS) {
        sessions.push({ channelId, guildId: jv.guildId, durationMs });
      }
    }
  }

  return sessions;
};
