import { resolveExport, ExportFilter } from "./extractor.js";
import { loadAllChannels, loadUserData, type ChannelMeta } from "./metadata.js";
import { analyzeMessages, type MessageAnalyzer, type MessageRow } from "./analyze.js";
import {
  scanAnalytics,
  buildVoiceSessions,
  parseAnalyticsTimestamp,
  type AnalyticsCollector,
} from "./analytics.js";
import type { Progress } from "./progress.js";
import { termWidth, printOutput } from "./display.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Try client_track_timestamp (leading-quote format) then plain ISO timestamp. */
const parseEventTimestamp = (event: Record<string, unknown>): Date | null => {
  const cts = event.client_track_timestamp;
  if (typeof cts === "string") {
    const d = parseAnalyticsTimestamp(cts);
    if (d) return d;
  }
  const ts = event.timestamp;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};
/** Scale a heatmap count to a single display character. */
export const heatmapCell = (n: number): string => {
  if (n === 0) return ".";
  if (n < 10) return String(n);
  if (n < 100) return "*";
  return "#";
};
export class TemporalAnalyzer implements MessageAnalyzer {
  /** heatmap[dayOfWeek][hour], Mon=0..Sun=6 */
  heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  monthly = new Map<string, number>();

  onMessage(row: MessageRow): void {
    const ts = row.timestamp;
    if (isNaN(ts.getTime())) return;
    const day = (ts.getDay() + 6) % 7; // shift Sun=0 → Mon=0
    const hour = ts.getHours();
    this.heatmap[day]![hour]!++;
    const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`;
    this.monthly.set(key, (this.monthly.get(key) ?? 0) + 1);
  }
}

/** Collector for notification_clicked events. */
export class NotificationCollector implements AnalyticsCollector {
  eventTypes = new Set(["notification_clicked"]);
  count = 0;
  onEvent(_event: Record<string, unknown>): void {
    this.count++;
  }
}

/** Collector for join/leave voice channel events. */
export class VoiceTimeCollector implements AnalyticsCollector {
  eventTypes = new Set(["join_voice_channel", "leave_voice_channel"]);
  joins: { ts: Date; channelId: string; guildId: string | null }[] = [];
  leaves: { ts: Date; channelId: string }[] = [];

  onEvent(event: Record<string, unknown>): void {
    const type = typeof event.event_type === "string" ? event.event_type : "";
    const channelId = typeof event.channel_id === "string" ? event.channel_id : "";
    if (!channelId) return;
    const ts = parseEventTimestamp(event);
    if (!ts) return;

    if (type === "join_voice_channel") {
      const guildId = typeof event.guild_id === "string" ? event.guild_id : null;
      this.joins.push({ ts, channelId, guildId });
    } else {
      this.leaves.push({ ts, channelId });
    }
  }
}

/** Collector for session_start/session_end events. */
export class SessionCollector implements AnalyticsCollector {
  eventTypes = new Set(["session_start", "session_end"]);
  starts: { ts: Date; os: string }[] = [];
  ends: { ts: Date }[] = [];

  onEvent(event: Record<string, unknown>): void {
    const type = typeof event.event_type === "string" ? event.event_type : "";
    const ts = parseEventTimestamp(event);
    if (!ts) return;

    if (type === "session_start") {
      const os =
        typeof event.extra_field_1 === "string"
          ? event.extra_field_1
          : typeof event.os === "string"
            ? event.os
            : "Unknown";
      this.starts.push({ ts, os });
    } else {
      this.ends.push({ ts });
    }
  }
}

const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/** Pair session starts/ends by time order (greedy). Discards sessions >24h. */
export const buildSessionDurations = (
  starts: { ts: Date; os: string }[],
  ends: { ts: Date }[],
): { os: string; durationMs: number }[] => {
  const sortedStarts = [...starts].toSorted((a, b) => a.ts.getTime() - b.ts.getTime());
  const sortedEnds = [...ends].toSorted((a, b) => a.ts.getTime() - b.ts.getTime());

  const sessions: { os: string; durationMs: number }[] = [];
  let endIdx = 0;

  for (const start of sortedStarts) {
    while (endIdx < sortedEnds.length && sortedEnds[endIdx]!.ts <= start.ts) endIdx++;
    if (endIdx >= sortedEnds.length) break;
    const end = sortedEnds[endIdx]!;
    endIdx++;
    const durationMs = end.ts.getTime() - start.ts.getTime();
    if (durationMs <= MAX_SESSION_MS) {
      sessions.push({ os: start.os, durationMs });
    }
  }

  return sessions;
};

/** Render an ASCII bar scaled to maxWidth chars. */
export const renderBar = (count: number, max: number, maxWidth: number): string => {
  if (max === 0) return "";
  const len = Math.max(1, Math.round((count / max) * maxWidth));
  return "█".repeat(len);
};

const fmtH = (ms: number) => (ms / 3_600_000).toFixed(1) + "h";

export const runTime = async (exportPath: string, prog: Progress): Promise<void> => {
  const { exportDir, cleanup } = await resolveExport(
    exportPath,
    prog,
    ExportFilter.messagesAndActivity,
  );
  try {
    prog.phase("Loading metadata");
    const userData = await loadUserData(exportDir);
    const channels = await loadAllChannels(exportDir, userData);

    const temporalAnalyzer = new TemporalAnalyzer();
    const notifCollector = new NotificationCollector();
    const voiceCollector = new VoiceTimeCollector();
    const sessionCollector = new SessionCollector();

    prog.phase("Analyzing data");
    await Promise.all([
      analyzeMessages(exportDir, [temporalAnalyzer], channels, prog),
      scanAnalytics(exportDir, [notifCollector, voiceCollector, sessionCollector], prog),
    ]);

    const hasAnalytics =
      notifCollector.count > 0 ||
      voiceCollector.joins.length > 0 ||
      sessionCollector.starts.length > 0;

    // Voice time
    const voiceSessions = buildVoiceSessions(voiceCollector.joins, voiceCollector.leaves);
    let totalVoiceMs = 0;
    let totalCallMs = 0;
    for (const s of voiceSessions) {
      totalVoiceMs += s.durationMs;
      const meta: ChannelMeta | undefined = channels.get(s.channelId);
      if (meta?.isDM) totalCallMs += s.durationMs;
    }

    // Session stats
    const sessionDurations = buildSessionDurations(sessionCollector.starts, sessionCollector.ends);
    let totalSessionMs = 0;
    const osSessions = new Map<string, { count: number; durationMs: number }>();
    for (const s of sessionDurations) {
      totalSessionMs += s.durationMs;
      const entry = osSessions.get(s.os) ?? { count: 0, durationMs: 0 };
      entry.count++;
      entry.durationMs += s.durationMs;
      osSessions.set(s.os, entry);
    }
    const sortedOS = [...osSessions.entries()].toSorted((a, b) => b[1].count - a[1].count);

    const w = termWidth();
    const sep = "─".repeat(Math.min(w, 52));
    const lines: string[] = ["", "Temporal Activity", sep, ""];

    if (hasAnalytics) {
      lines.push(
        `  Notification clicks:  ${notifCollector.count.toLocaleString()}`,
        `  Total voice time:     ${fmtH(totalVoiceMs)}`,
        `  Total call time:      ${fmtH(totalCallMs)}  (DM voice channels)`,
        `  Total session time:   ${fmtH(totalSessionMs)}`,
        "",
        "Sessions by OS",
      );
      if (sortedOS.length === 0) {
        lines.push("  (no sessions found)");
      } else {
        for (const [os, stats] of sortedOS) {
          const countStr = stats.count.toLocaleString().padStart(6);
          const hoursStr = fmtH(stats.durationMs).padStart(8);
          lines.push(`  ${os.padEnd(12)} ${countStr} sessions  ${hoursStr}`);
        }
      }
    } else {
      lines.push("  (analytics not available in this export)");
    }

    // Message heatmap — 5 + 24*3 = 77 chars; show all hours, truncation handles narrow terminals
    lines.push("", "Message Activity Heatmap (messages per hour)");
    const hourHeader =
      "     " + Array.from({ length: 24 }, (_, h) => String(h).padStart(3)).join("");
    lines.push(hourHeader);
    for (let d = 0; d < 7; d++) {
      const row = temporalAnalyzer.heatmap[d]!;
      const cells = row.map((n) => heatmapCell(n).padStart(3)).join("");
      lines.push(`${DAY_NAMES[d]}${cells}`);
    }

    // Most active hour
    let maxCount = 0;
    let maxHour = 0;
    for (let h = 0; h < 24; h++) {
      let total = 0;
      for (let d = 0; d < 7; d++) total += temporalAnalyzer.heatmap[d]![h]!;
      if (total > maxCount) {
        maxCount = total;
        maxHour = h;
      }
    }
    if (maxCount > 0) {
      lines.push(
        `\nMost active hour: ${String(maxHour).padStart(2, "0")}:00 (${maxCount.toLocaleString()} messages)`,
      );
    }

    // Monthly activity — bar width scales with terminal
    const barW = Math.max(10, Math.min(40, w - 22));
    lines.push("\nActivity over time (messages per month):");
    const months = [...temporalAnalyzer.monthly.entries()].toSorted((a, b) =>
      a[0].localeCompare(b[0]),
    );
    if (months.length === 0) {
      lines.push("  (no messages)");
    } else {
      const maxMonthly = Math.max(...months.map(([, c]) => c));
      for (const [month, count] of months) {
        const bar = renderBar(count, maxMonthly, barW);
        lines.push(`${month} ${bar} ${count.toLocaleString()}`);
      }
    }

    lines.push("");
    printOutput(lines);
  } finally {
    await cleanup();
  }
};
