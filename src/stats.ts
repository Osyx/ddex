import { resolveExport } from "./extractor.js";
import { loadUserData, loadAllChannels, loadServersIndex } from "./metadata.js";
import { analyzeMessages } from "./analyze.js";
import type { MessageAnalyzer, MessageRow } from "./analyze.js";
import { scanAnalytics } from "./analytics.js";
import type { AnalyticsCollector } from "./analytics.js";
import { MessageCountAnalyzer } from "./servers.js";
import {
  TemporalAnalyzer,
  renderBar,
  VoiceTimeCollector,
  NotificationCollector,
  SessionCollector,
} from "./time.js";
import { EmojiMessageAnalyzer, ReactionCollector } from "./emojis.js";
import { AttachmentsAnalyzer } from "./attachments.js";
import type { Progress } from "./progress.js";
import { termWidth, printOutput } from "./display.js";
const TOP = 24; // max months to show in activity chart

/** Tracks unique active days (YYYY-MM-DD). */
class DayCounter implements MessageAnalyzer {
  readonly days = new Set<string>();
  onMessage(row: MessageRow): void {
    if (!isNaN(row.timestamp.getTime())) {
      this.days.add(row.timestamp.toISOString().slice(0, 10));
    }
  }
}

/** Counts named analytics event types. */
class CounterCollector implements AnalyticsCollector {
  readonly eventTypes: Set<string>;
  private readonly counts = new Map<string, number>();

  constructor(types: string[]) {
    this.eventTypes = new Set(types);
    for (const t of types) this.counts.set(t, 0);
  }

  onEvent(event: Record<string, unknown>): void {
    const type = typeof event.event_type === "string" ? event.event_type : "";
    if (this.counts.has(type)) {
      this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
    }
  }

  get(type: string): number {
    return this.counts.get(type) ?? 0;
  }
}

/** Counts DM calls via call_button_clicked Disconnect events. */
class DmCallCounter implements AnalyticsCollector {
  readonly eventTypes = new Set(["call_button_clicked"]);
  total = 0;

  onEvent(event: Record<string, unknown>): void {
    if (event.button_name !== "Disconnect") return;
    if (event.guild_id !== undefined && event.guild_id !== null) return;
    if (event.channel_type !== "1") return;
    this.total++;
  }
}

const hl = (label: string, value: string, suffix = ""): string =>
  `  ${label.padEnd(22)}${value.padStart(8)}${suffix ? `   ${suffix}` : ""}`;

const twoCol = (l1: string, v1: string, l2: string, v2: string): string =>
  `  ${l1.padEnd(25)}${v1.padStart(7)}   ${l2.padEnd(25)}${v2.padStart(7)}`;

export async function runStats(exportPath: string, prog: Progress): Promise<void> {
  const { exportDir, cleanup } = await resolveExport(exportPath, prog);
  try {
    prog.phase("Loading metadata");
    const [userData, serversIndex] = await Promise.all([
      loadUserData(exportDir),
      loadServersIndex(exportDir),
    ]);
    const channels = await loadAllChannels(exportDir, userData);
    prog.done("Loaded metadata");

    // Message analyzers
    const msgCounter = new MessageCountAnalyzer();
    const temporal = new TemporalAnalyzer();
    const emojiAnalyzer = new EmojiMessageAnalyzer();
    const attachAnalyzer = new AttachmentsAnalyzer();
    const dayCounter = new DayCounter();

    // Analytics collectors
    const notifCollector = new NotificationCollector();
    const sessionCollector = new SessionCollector();
    const voiceCollector = new VoiceTimeCollector();
    const reactionCollector = new ReactionCollector();
    const dmCallCounter = new DmCallCounter();
    const counterCollector = new CounterCollector([
      "app_opened",
      "login_successful",
      "user_avatar_updated",
      "app_crashed",
      "email_opened",
      "oauth2_authorize_accepted",
      "voice_message_send",
      "message_reported",
      "message_edited",
      "premium_upsell_viewed",
      "captcha_served",
      "voice_message_recorded",
    ]);

    prog.phase("Analysing data");
    const [totalMessages] = await Promise.all([
      analyzeMessages(
        exportDir,
        [msgCounter, temporal, emojiAnalyzer, attachAnalyzer, dayCounter],
        channels,
        prog,
      ),
      scanAnalytics(
        exportDir,
        [
          notifCollector,
          sessionCollector,
          voiceCollector,
          reactionCollector,
          dmCallCounter,
          counterCollector,
        ],
        prog,
      ),
    ]);

    // Determine if analytics data was found
    const hasAnalytics =
      notifCollector.count > 0 ||
      sessionCollector.starts.length > 0 ||
      voiceCollector.joins.length > 0 ||
      reactionCollector.analyticsFound;

    // Voice stats: total call/join count (voice joins + DM calls)
    const voiceJoins = voiceCollector.joins.length;
    const dmCalls = dmCallCounter.total;
    const totalCallsAndJoins = voiceJoins + dmCalls;

    // Server name lookup
    const serverNames = new Map<string, string>(serversIndex);
    for (const meta of channels.values()) {
      if (meta.guildId && meta.guildName && !serverNames.has(meta.guildId)) {
        serverNames.set(meta.guildId, meta.guildName);
      }
    }

    // Server message counts
    const serverMsgCounts = new Map<string, number>();
    for (const [channelId, count] of msgCounter.counts) {
      const meta = channels.get(channelId);
      if (meta?.guildId) {
        serverMsgCounts.set(meta.guildId, (serverMsgCounts.get(meta.guildId) ?? 0) + count);
      }
    }

    // DM partner count (channels that are DMs and have messages)
    const dmPartnerCount = [...channels.values()].filter(
      (ch) => ch.isDM && (msgCounter.counts.get(ch.id) ?? 0) > 0,
    ).length;

    // Servers active in
    const guildsWithMessages = new Set<string>();
    for (const [channelId, count] of msgCounter.counts) {
      if (count > 0) {
        const meta = channels.get(channelId);
        if (meta?.guildId) guildsWithMessages.add(meta.guildId);
      }
    }

    // Most active server
    const topServer = [...serverMsgCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topServerStr = topServer
      ? `${serverNames.get(topServer[0]) ?? topServer[0]} (${topServer[1].toLocaleString()} msgs)`
      : "(none)";

    // Most active server channel (non-DM)
    const topChannel = [...msgCounter.counts.entries()]
      .filter(([channelId]) => !channels.get(channelId)?.isDM)
      .sort((a, b) => b[1] - a[1])[0];
    let topChannelStr = "(none)";
    if (topChannel) {
      const meta = channels.get(topChannel[0]);
      const name = meta ? `#${meta.name}` : topChannel[0];
      const server = meta?.guildName ?? meta?.guildId ?? "";
      topChannelStr = server
        ? `${name} in ${server} (${topChannel[1].toLocaleString()} msgs)`
        : `${name} (${topChannel[1].toLocaleString()} msgs)`;
    }

    // Most active DM partner
    const topDm = [...msgCounter.counts.entries()]
      .filter(([channelId]) => channels.get(channelId)?.isDM)
      .sort((a, b) => b[1] - a[1])[0];
    let topDmStr = "(none)";
    if (topDm) {
      const meta = channels.get(topDm[0]);
      const name = meta?.name.replace(/#\d+$/, "").trim() ?? topDm[0];
      topDmStr = `${name} (${topDm[1].toLocaleString()} msgs)`;
    }

    // Most-used emoji
    const topEmoji = [...emojiAnalyzer.counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topEmojiStr = topEmoji
      ? `${topEmoji[0]} (${topEmoji[1].toLocaleString()} uses)`
      : "(none found)";

    // Total spent
    let totalSpentStr = "(not available)";
    if (userData && userData.payments.length > 0) {
      const totals = new Map<string, number>();
      const virtual = new Map<string, number>();
      for (const p of userData.payments) {
        const cur = p.currency.toUpperCase();
        if (cur === "DISCORD_ORB") {
          virtual.set("Orbs", (virtual.get("Orbs") ?? 0) + p.amount / 100);
        } else {
          totals.set(cur, (totals.get(cur) ?? 0) + p.amount / 100);
        }
      }
      const parts = [...totals.entries()].map(([cur, amt]) => `${amt.toFixed(2)} ${cur}`);
      if (virtual.size > 0) {
        const vParts = [...virtual.entries()].map(([label, amt]) => `${amt.toFixed(0)} ${label}`);
        parts.push(`(${vParts.join(", ")})`);
      }
      totalSpentStr = parts.join(", ");
    }

    // Friends
    const friendCount = userData?.relationships.length ?? 0;

    // Active days / avg per day
    const activeDays = dayCounter.days.size;
    const avgPerDay = activeDays > 0 ? (totalMessages / activeDays).toFixed(1) : "0";
    const avgSuffix = `(avg ${avgPerDay}/day across ${activeDays.toLocaleString()} active days)`;

    // App opens: prefer app_opened event, fall back to session_start count
    const appOpens = hasAnalytics
      ? counterCollector.get("app_opened") || sessionCollector.starts.length
      : null;

    // Build output
    const w = termWidth();
    const rule = "═".repeat(Math.min(w, 62));
    // Bar widths scaled to terminal: monthly chart gets more space, breakdown less
    const monthBarW = Math.max(10, Math.min(40, w - 22));
    const breakBarW = Math.max(5, Math.min(20, w - 42));

    const lines: string[] = [
      "",
      `Discord Data Explorer — Stats Summary`,
      rule,
      "",
      "Highlights",
      hl("Messages sent:", totalMessages.toLocaleString(), avgSuffix),
      hl("Friends:", friendCount.toLocaleString()),
      hl("DM partners:", dmPartnerCount.toLocaleString()),
      hl("Servers active in:", guildsWithMessages.size.toLocaleString()),
      hl("Total spent:", totalSpentStr),
      hl("Most active server:", topServerStr),
      hl("Most active channel:", topChannelStr),
      hl("Most active DM:", topDmStr),
      hl("Most-used emoji:", topEmojiStr),
      hl("Total attachments:", attachAnalyzer.totalAttachments.toLocaleString()),
      hl("App opens:", appOpens !== null ? appOpens.toLocaleString() : "(not available)"),
    ];

    if (hasAnalytics) {
      lines.push(
        "",
        "Extra stats",
        twoCol(
          "Notifications clicked:",
          notifCollector.count.toLocaleString(),
          "Logins:",
          counterCollector.get("login_successful").toLocaleString(),
        ),
        twoCol(
          "Avatar updates:",
          counterCollector.get("user_avatar_updated").toLocaleString(),
          "App crashes:",
          counterCollector.get("app_crashed").toLocaleString(),
        ),
        twoCol(
          "Emails received:",
          counterCollector.get("email_opened").toLocaleString(),
          "OAuth2 authorisations:",
          counterCollector.get("oauth2_authorize_accepted").toLocaleString(),
        ),
        twoCol(
          "Voice messages sent:",
          counterCollector.get("voice_message_send").toLocaleString(),
          "Messages reported:",
          counterCollector.get("message_reported").toLocaleString(),
        ),
        twoCol(
          "Messages edited:",
          counterCollector.get("message_edited").toLocaleString(),
          "Nitro ads seen:",
          counterCollector.get("premium_upsell_viewed").toLocaleString(),
        ),
        twoCol(
          "CAPTCHAs completed:",
          counterCollector.get("captcha_served").toLocaleString(),
          "Voice messages recorded:",
          counterCollector.get("voice_message_recorded").toLocaleString(),
        ),
      );
    }

    // Activity over time
    lines.push("", "Activity over time (messages per month)");
    const months = [...temporal.monthly.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-TOP);
    if (months.length === 0) {
      lines.push("  (no messages)");
    } else {
      const maxMonthly = Math.max(...months.map(([, c]) => c));
      for (const [month, count] of months) {
        const bar = renderBar(count, maxMonthly, monthBarW);
        lines.push(`${month} ${bar} ${count.toLocaleString()}`);
      }
    }

    // Activity breakdown
    const totalReactions = [...reactionCollector.counts.values()].reduce((a, b) => a + b, 0);
    const breakdownItems = [
      { label: "Messages sent", value: totalMessages, display: totalMessages.toLocaleString() },
      { label: "Reactions given", value: totalReactions, display: totalReactions.toLocaleString() },
      {
        label: "Attachments sent",
        value: attachAnalyzer.totalAttachments,
        display: attachAnalyzer.totalAttachments.toLocaleString(),
      },
      {
        label: "Calls & voice joins",
        value: totalCallsAndJoins,
        display: totalCallsAndJoins.toLocaleString(),
      },
    ];
    const maxBreakdown = Math.max(...breakdownItems.map((i) => i.value));
    lines.push("", "Activity breakdown");
    for (const item of breakdownItems) {
      const bar = maxBreakdown > 0 ? renderBar(item.value, maxBreakdown, breakBarW) : "";
      lines.push(`  ${item.label.padEnd(16)} ${bar.padEnd(breakBarW)} ${item.display}`);
    }

    lines.push("", rule, "");
    printOutput(lines);
  } finally {
    await cleanup();
  }
}
