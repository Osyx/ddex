import { resolveExport, ExportFilter } from "./extractor.js";
import { loadAllChannels, loadServersIndex, loadUserData } from "./metadata.js";
import { analyzeMessages, type MessageAnalyzer, type MessageRow } from "./analyze.js";
import {
  scanAnalytics,
  buildVoiceSessions,
  parseAnalyticsTimestamp,
  type AnalyticsCollector,
} from "./analytics.js";
import type { Progress } from "./progress.js";
import { termWidth, printOutput } from "./display.js";

const lpad = (s: string, w: number): string => s.padStart(w);
const rpad = (s: string, w: number): string => s.padEnd(w);

/** Analyzer that counts messages per channelId. */
export class MessageCountAnalyzer implements MessageAnalyzer {
  counts = new Map<string, number>();
  onMessage(row: MessageRow): void {
    this.counts.set(row.channelId, (this.counts.get(row.channelId) ?? 0) + 1);
  }
}

/** Try client_track_timestamp (leading-quote format) then plain ISO timestamp. */
function parseEventTimestamp(event: Record<string, unknown>): Date | null {
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
}

/** Analytics collector for join/leave voice channel events. */
export class VoiceCollector implements AnalyticsCollector {
  eventTypes = new Set(["join_voice_channel", "leave_voice_channel"]);
  joins: Array<{ ts: Date; channelId: string; guildId: string | null }> = [];
  leaves: Array<{ ts: Date; channelId: string }> = [];
  joinCount = 0;

  onEvent(event: Record<string, unknown>): void {
    const type = event.event_type as string;
    const channelId = typeof event.channel_id === "string" ? event.channel_id : "";
    if (!channelId) return;
    const ts = parseEventTimestamp(event);
    if (!ts) return;

    if (type === "join_voice_channel") {
      const guildId = typeof event.guild_id === "string" ? event.guild_id : null;
      this.joins.push({ ts, channelId, guildId });
      this.joinCount++;
    } else {
      this.leaves.push({ ts, channelId });
    }
  }
}

export async function runServers(exportPath: string, prog: Progress): Promise<void> {
  const { exportDir, cleanup } = await resolveExport(
    exportPath,
    prog,
    ExportFilter.messagesAndServers,
  );
  try {
    prog.phase("Loading metadata");
    const [userData, serversIndex] = await Promise.all([
      loadUserData(exportDir),
      loadServersIndex(exportDir),
    ]);
    const channels = await loadAllChannels(exportDir, userData);

    const msgAnalyzer = new MessageCountAnalyzer();
    const voiceCollector = new VoiceCollector();

    prog.phase("Analyzing data");
    await Promise.all([
      analyzeMessages(exportDir, [msgAnalyzer], channels, prog),
      scanAnalytics(exportDir, [voiceCollector], prog),
    ]);

    // Derive guild/channel stats from message counts
    const guildsWithMessages = new Set<string>();
    const channelsWithMessages = new Set<string>();
    for (const [channelId, count] of msgAnalyzer.counts) {
      if (count > 0) {
        channelsWithMessages.add(channelId);
        const meta = channels.get(channelId);
        if (meta?.guildId) guildsWithMessages.add(meta.guildId);
      }
    }

    // Per-server message totals
    const serverMsgCounts = new Map<string, number>();
    for (const [channelId, count] of msgAnalyzer.counts) {
      const meta = channels.get(channelId);
      if (!meta?.guildId) continue;
      serverMsgCounts.set(meta.guildId, (serverMsgCounts.get(meta.guildId) ?? 0) + count);
    }

    // Server name lookup: index takes priority, fall back to channel.json metadata
    const serverNames = new Map<string, string>(serversIndex);
    for (const meta of channels.values()) {
      if (meta.guildId && meta.guildName && !serverNames.has(meta.guildId)) {
        serverNames.set(meta.guildId, meta.guildName);
      }
    }

    const topServers = [...serverMsgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const topTextChannels = [...msgAnalyzer.counts.entries()]
      .filter(([channelId]) => !channels.get(channelId)?.isDM)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Voice sessions grouped by channel
    const voiceSessions = buildVoiceSessions(voiceCollector.joins, voiceCollector.leaves);
    const voiceByChannel = new Map<
      string,
      { durationMs: number; joins: number; guildId: string | null }
    >();
    for (const s of voiceSessions) {
      const entry = voiceByChannel.get(s.channelId) ?? {
        durationMs: 0,
        joins: 0,
        guildId: s.guildId,
      };
      entry.durationMs += s.durationMs;
      entry.joins++;
      voiceByChannel.set(s.channelId, entry);
    }
    const topVoice = [...voiceByChannel.entries()]
      .sort((a, b) => b[1].durationMs - a[1].durationMs)
      .slice(0, 10);

    const hasAnalytics = voiceCollector.joins.length > 0 || voiceCollector.leaves.length > 0;

    // Build output
    const w = termWidth();
    const sep = "─".repeat(Math.min(w, 51));
    const lines: string[] = [
      "",
      "Server Activity",
      sep,
      "",
      "Totals",
      `  Total servers in export:      ${lpad(serversIndex.size.toLocaleString(), 8)}`,
      `  Servers with messages sent:   ${lpad(guildsWithMessages.size.toLocaleString(), 8)}`,
      `  Text channels written in:     ${lpad(channelsWithMessages.size.toLocaleString(), 8)}`,
      `  Voice channel joins:          ${lpad(voiceCollector.joinCount.toLocaleString(), 8)}`,
      "",
      "Top 10 Servers by messages",
      `  ${rpad("#", 3)} ${rpad("Server", 24)} ${"Messages".padStart(8)}`,
    ];

    if (topServers.length === 0) {
      lines.push("  (no server messages found)");
    } else {
      for (let i = 0; i < topServers.length; i++) {
        const [guildId, count] = topServers[i]!;
        const name = serverNames.get(guildId) ?? guildId;
        lines.push(
          `  ${lpad(String(i + 1), 3)} ${rpad(name, 24)} ${lpad(count.toLocaleString(), 8)}`,
        );
      }
    }

    lines.push("", "Top 10 Text Channels by messages");
    lines.push(
      `  ${rpad("#", 3)} ${rpad("Channel", 24)} ${rpad("Server", 20)} ${"Messages".padStart(8)}`,
    );
    if (topTextChannels.length === 0) {
      lines.push("  (no messages found)");
    } else {
      for (let i = 0; i < topTextChannels.length; i++) {
        const [channelId, count] = topTextChannels[i]!;
        const meta = channels.get(channelId);
        const channelName = meta?.isDM ? meta.name : `#${meta?.name ?? channelId}`;
        const serverName = meta?.guildName ?? meta?.guildId ?? (meta?.isDM ? "(DM)" : "");
        lines.push(
          `  ${lpad(String(i + 1), 3)} ${rpad(channelName, 24)} ${rpad(serverName, 20)} ${lpad(count.toLocaleString(), 8)}`,
        );
      }
    }

    lines.push("", "Top 10 Voice Channels by time");
    if (!hasAnalytics) {
      lines.push("  (not available in this export)");
    } else if (topVoice.length === 0) {
      lines.push("  (no voice sessions found)");
    } else {
      lines.push(
        `  ${rpad("#", 3)} ${rpad("Channel", 24)} ${rpad("Server", 20)} ${"Hours".padStart(7)} ${"Joins".padStart(6)}`,
      );
      for (let i = 0; i < topVoice.length; i++) {
        const [channelId, stats] = topVoice[i]!;
        const meta = channels.get(channelId);
        const channelName = meta?.name ?? channelId;
        const serverName = stats.guildId ? (serverNames.get(stats.guildId) ?? stats.guildId) : "";
        const hours = (stats.durationMs / 3_600_000).toFixed(1) + "h";
        lines.push(
          `  ${lpad(String(i + 1), 3)} ${rpad(channelName, 24)} ${rpad(serverName, 20)} ${lpad(hours, 7)} ${lpad(stats.joins.toLocaleString(), 6)}`,
        );
      }
    }

    lines.push("");
    printOutput(lines);
  } finally {
    await cleanup();
  }
}
