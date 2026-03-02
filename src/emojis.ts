import type { Progress } from "./progress.js";
import type { MessageRow, MessageAnalyzer } from "./analyze.js";
import { analyzeMessages } from "./analyze.js";
import { scanAnalytics, type AnalyticsCollector } from "./analytics.js";
import { loadAllChannels, loadUserData } from "./metadata.js";
import { resolveExport } from "./extractor.js";

const UNICODE_EMOJI_RE = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu;
const CUSTOM_EMOJI_RE = /<a?:(\w+):\d+>/g;
const DIVIDER = "─".repeat(54);

/** Extract all emoji strings from a message text. Returns Unicode emoji chars and `:name:` for custom. */
export function parseEmojisFromText(text: string): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(UNICODE_EMOJI_RE)) {
    results.push(match[1]!);
  }
  for (const match of text.matchAll(CUSTOM_EMOJI_RE)) {
    results.push(`:${match[1]}:`);
  }
  return results;
}

class EmojiMessageAnalyzer implements MessageAnalyzer {
  readonly counts = new Map<string, number>();

  onMessage(row: MessageRow): void {
    for (const emoji of parseEmojisFromText(row.contents)) {
      this.counts.set(emoji, (this.counts.get(emoji) ?? 0) + 1);
    }
  }
}

class ReactionCollector implements AnalyticsCollector {
  readonly eventTypes = new Set(["add_reaction"]);
  readonly counts = new Map<string, number>();
  readonly isCustom = new Map<string, boolean>();
  analyticsFound = false;

  onEvent(event: Record<string, unknown>): void {
    this.analyticsFound = true;
    const name =
      typeof event["extra_field_1"] === "string" && event["extra_field_1"]
        ? event["extra_field_1"]
        : typeof event["emoji_name"] === "string"
          ? event["emoji_name"]
          : null;
    if (!name) return;

    const custom =
      typeof event["extra_field_2"] === "string" ? event["extra_field_2"] === "1" : false;

    const key = custom ? `:${name}:` : name;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (custom) this.isCustom.set(key, true);
  }
}

const topN = <T>(map: Map<T, number>, n: number): Array<[T, number]> =>
  [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function printEmojiTable(rows: Array<[string, number]>, customSet: Set<string> | null): void {
  console.log("  #   Emoji             Count");
  for (let i = 0; i < rows.length; i++) {
    const [emoji, count] = rows[i]!;
    const rank = String(i + 1).padStart(3);
    // Emoji/name column: pad to 16 chars (emojis may be wide; use string length)
    const emojiCol = emoji.padEnd(16);
    const countCol = count.toLocaleString().padStart(7);
    const custom = customSet?.has(emoji) ? "  (custom)" : "";
    console.log(`  ${rank}   ${emojiCol}  ${countCol}${custom}`);
  }
}

export async function runEmojis(exportPath: string, prog: Progress): Promise<void> {
  const { exportDir, cleanup } = await resolveExport(exportPath, prog);

  try {
    const userData = await loadUserData(exportDir);
    const channels = await loadAllChannels(exportDir, userData);

    const emojiAnalyzer = new EmojiMessageAnalyzer();
    const reactionCollector = new ReactionCollector();

    prog.phase("Scanning emoji data");

    await Promise.all([
      analyzeMessages(exportDir, [emojiAnalyzer], channels, prog),
      scanAnalytics(exportDir, [reactionCollector], prog),
    ]);

    prog.done("Scan complete");

    const totalEmojis = [...emojiAnalyzer.counts.values()].reduce((a, b) => a + b, 0);
    const topEmojis = topN(emojiAnalyzer.counts, 10);
    const customEmojis = new Set<string>(
      [...emojiAnalyzer.counts.keys()].filter((k) => k.startsWith(":")),
    );

    console.log("\nEmoji Usage");
    console.log(DIVIDER);

    console.log("\nSent in messages");
    console.log(`  Total emojis used: ${totalEmojis.toLocaleString()}`);

    if (topEmojis.length > 0) {
      console.log(`\n  Top ${Math.min(10, topEmojis.length)} emojis`);
      printEmojiTable(topEmojis, customEmojis);
    }

    console.log("\nReactions given  (from analytics)");

    if (!reactionCollector.analyticsFound) {
      console.log("  (Not available — no analytics file found)");
    } else {
      const totalReactions = [...reactionCollector.counts.values()].reduce((a, b) => a + b, 0);
      console.log(`  Total reactions: ${totalReactions.toLocaleString()}`);

      const topReactions = topN(reactionCollector.counts, 10);
      if (topReactions.length > 0) {
        const customReactions = new Set(
          [...reactionCollector.isCustom.entries()].filter(([, v]) => v).map(([k]) => k),
        );
        console.log(`\n  Top ${Math.min(10, topReactions.length)} reaction emojis`);
        printEmojiTable(topReactions, customReactions);
      }
    }

    console.log();
  } finally {
    await cleanup();
  }
}
