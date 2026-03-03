import { resolveExport, ExportFilter } from "./extractor.js";
import { loadUserData, loadAllChannels } from "./metadata.js";
import type { UserData, ChannelMeta } from "./metadata.js";
import { analyzeMessages } from "./analyze.js";
import type { MessageAnalyzer, MessageRow } from "./analyze.js";
import { scanAnalytics, buildVoiceSessions, parseAnalyticsTimestamp } from "./analytics.js";
import type { AnalyticsCollector } from "./analytics.js";
import type { Progress } from "./progress.js";
import { termWidth } from "./display.js";

const DM_PREFIX = "Direct Message with ";
const MENTION_RE = /<@(\d+)>/g;

class PeopleMessageAnalyzer implements MessageAnalyzer {
  readonly channelMsgCounts = new Map<string, number>();
  readonly mentionedUserIds = new Set<string>();

  onMessage(row: MessageRow): void {
    if (row.channelMeta.isDM) {
      this.channelMsgCounts.set(row.channelId, (this.channelMsgCounts.get(row.channelId) ?? 0) + 1);
    }
    MENTION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MENTION_RE.exec(row.contents)) !== null) {
      this.mentionedUserIds.add(match[1]!);
    }
  }
}

class VoiceCollector implements AnalyticsCollector {
  readonly eventTypes = new Set(["join_voice_channel", "leave_voice_channel"]);
  readonly joins: { ts: Date; channelId: string; guildId: string | null }[] = [];
  readonly leaves: { ts: Date; channelId: string }[] = [];

  onEvent(event: Record<string, unknown>): void {
    const channelId = typeof event.channel_id === "string" ? event.channel_id : null;
    if (!channelId) return;

    const tsRaw = event.client_track_timestamp ?? event.timestamp;
    const ts = parseAnalyticsTimestamp(tsRaw);
    if (!ts) return;

    if (event.event_type === "join_voice_channel") {
      const guildId = typeof event.guild_id === "string" ? event.guild_id : null;
      this.joins.push({ ts, channelId, guildId });
    } else {
      this.leaves.push({ ts, channelId });
    }
  }
}

/**
 * Counts DM calls by tracking "Disconnect" button clicks in DM channels
 * (channel_type=1, no guild_id). Works on newer exports that lack join/leave events.
 */
class DMCallCollector implements AnalyticsCollector {
  readonly eventTypes = new Set(["call_button_clicked"]);
  /** channelId → number of DM calls disconnected (proxy for calls made) */
  readonly callsByChannel = new Map<string, number>();
  total = 0;

  onEvent(event: Record<string, unknown>): void {
    // Only count Disconnect clicks in DM channels (type 1, no guild)
    if (event.button_name !== "Disconnect") return;
    if (event.guild_id !== undefined && event.guild_id !== null) return;
    if (event.channel_type !== "1") return;
    const channelId = typeof event.channel_id === "string" ? event.channel_id : null;
    if (!channelId) return;
    this.callsByChannel.set(channelId, (this.callsByChannel.get(channelId) ?? 0) + 1);
    this.total++;
  }
}

export interface PeopleStats {
  friendCount: number;
  dmChannelCount: number;
  mentionedCount: number;
  distinctInteractions: number;
  voiceCallsJoined: number;
  totalDmVoiceHours: number;
  topDmPartners: { name: string; messages: number; calls: number }[];
}

/** Strip legacy discriminator suffixes like #0 or #1234 from usernames. */
const stripDiscriminator = (name: string): string => name.replace(/#\d+$/, "").trim();

export const computePeopleStats = (
  userData: UserData | null,
  channels: Map<string, ChannelMeta>,
  channelMsgCounts: Map<string, number>,
  mentionedUserIds: Set<string>,
  voiceSessions: { channelId: string; guildId: string | null; durationMs: number }[],
  voiceJoinsForDM: number,
  callsByChannel = new Map<string, number>(),
): PeopleStats => {
  const friendCount = userData?.relationships.length ?? 0;

  const dmChannels = [...channels.values()].filter((ch) => ch.isDM);

  // DM voice sessions = sessions with no guild_id (DM calls don't belong to a guild)
  const dmVoiceSessions = voiceSessions.filter((s) => s.guildId === null);
  const totalDmVoiceHours = dmVoiceSessions.reduce((sum, s) => sum + s.durationMs, 0) / 3_600_000;

  // Distinct interactions = union of friend IDs, DM partner IDs, mentioned user IDs
  const friendIds = new Set((userData?.relationships ?? []).map((r) => r.id));
  const dmPartnerIds = new Set(
    dmChannels.map((ch) => ch.dmPartnerId).filter((id): id is string => id !== null),
  );
  const distinctInteractions = new Set([...friendIds, ...dmPartnerIds, ...mentionedUserIds]).size;

  // Top 10 DM partners by message count
  const topDmPartners = dmChannels
    .map((ch) => ({
      name: stripDiscriminator(
        ch.name.startsWith(DM_PREFIX) ? ch.name.slice(DM_PREFIX.length) : ch.name,
      ),
      messages: channelMsgCounts.get(ch.id) ?? 0,
      calls: callsByChannel.get(ch.id) ?? 0,
    }))
    .filter((p) => p.messages > 0)
    .toSorted((a, b) => b.messages - a.messages)
    .slice(0, 10);

  return {
    friendCount,
    dmChannelCount: dmChannels.length,
    mentionedCount: mentionedUserIds.size,
    distinctInteractions,
    voiceCallsJoined: voiceJoinsForDM,
    totalDmVoiceHours,
    topDmPartners,
  };
};

export const buildPeopleOutput = (stats: PeopleStats): string => {
  const w = termWidth();
  const hasCallData = stats.topDmPartners.some((p) => p.calls > 0);
  const lines: string[] = [];
  lines.push("Social Graph");
  lines.push("─".repeat(Math.min(w, 40)));
  lines.push("");
  lines.push("Totals");
  lines.push(`  Friends:              ${stats.friendCount}`);
  lines.push(`  Distinct DM partners: ${stats.dmChannelCount}`);
  lines.push(`  Distinct users mentioned: ${stats.mentionedCount}`);
  lines.push(`  Total distinct interactions: ${stats.distinctInteractions}`);
  lines.push(`  Voice calls joined:   ${stats.voiceCallsJoined}`);
  if (stats.totalDmVoiceHours > 0) {
    lines.push(`  DM voice hours:       ${stats.totalDmVoiceHours.toFixed(1)}h`);
  }
  lines.push("");
  lines.push("Top 10 DM Partners by messages sent");
  if (hasCallData) {
    lines.push(
      `  ${"#".padEnd(3)} ${"Username".padEnd(20)}  ${"Messages".padStart(8)}  ${"Calls".padStart(6)}`,
    );
  } else {
    lines.push(`  ${"#".padEnd(3)} ${"Username".padEnd(20)}  ${"Messages".padStart(8)}`);
  }

  for (let i = 0; i < stats.topDmPartners.length; i++) {
    const p = stats.topDmPartners[i]!;
    const base = `  ${String(i + 1).padEnd(3)} ${p.name.slice(0, 20).padEnd(20)}  ${String(p.messages).padStart(8)}`;
    lines.push(hasCallData ? `${base}  ${String(p.calls).padStart(6)}` : base);
  }

  return lines.map((l) => (l.length > w ? l.slice(0, w - 1) + "…" : l)).join("\n");
};

export const runPeople = async (exportPath: string, prog: Progress): Promise<void> => {
  const { exportDir, cleanup } = await resolveExport(
    exportPath,
    prog,
    ExportFilter.messagesActivityAccount,
  );
  try {
    prog.phase("Loading metadata");
    const userData = await loadUserData(exportDir);
    const channels = await loadAllChannels(exportDir, userData);
    prog.done("Loaded metadata");

    const msgAnalyzer = new PeopleMessageAnalyzer();
    const voiceCollector = new VoiceCollector();
    const dmCallCollector = new DMCallCollector();

    prog.phase("Analysing");
    await Promise.all([
      analyzeMessages(exportDir, [msgAnalyzer], channels, prog),
      scanAnalytics(exportDir, [voiceCollector, dmCallCollector], prog),
    ]);

    // DM voice joins = joins with no guild_id (DM calls don't belong to a guild)
    const voiceJoinsForDM =
      voiceCollector.joins.filter((j) => j.guildId === null).length || dmCallCollector.total;
    const voiceSessions = buildVoiceSessions(voiceCollector.joins, voiceCollector.leaves);

    const stats = computePeopleStats(
      userData,
      channels,
      msgAnalyzer.channelMsgCounts,
      msgAnalyzer.mentionedUserIds,
      voiceSessions,
      voiceJoinsForDM,
      dmCallCollector.callsByChannel,
    );

    console.log(buildPeopleOutput(stats));
  } finally {
    await cleanup();
  }
};
