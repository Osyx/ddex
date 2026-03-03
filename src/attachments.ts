import type { Progress } from "./progress.js";
import type { MessageRow, MessageAnalyzer } from "./analyze.js";
import { analyzeMessages } from "./analyze.js";
import { loadAllChannels, loadUserData } from "./metadata.js";
import { resolveExport, ExportFilter } from "./extractor.js";
import type { ChannelMeta } from "./metadata.js";
import { termWidth, printOutput } from "./display.js";

const DM_PREFIX = "Direct Message with ";

/** Split an Attachments field string into individual attachment URLs/entries. */
export function splitAttachments(field: string): string[] {
  if (!field.trim()) return [];
  return field
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface ChannelAttachmentStats {
  meta: ChannelMeta;
  messagesWithAttachments: number;
  totalAttachments: number;
}

export class AttachmentsAnalyzer implements MessageAnalyzer {
  messagesWithAttachments = 0;
  totalAttachments = 0;
  readonly channelStats = new Map<string, ChannelAttachmentStats>();

  onMessage(row: MessageRow): void {
    const parts = splitAttachments(row.attachments);
    if (parts.length === 0) return;

    this.messagesWithAttachments++;
    this.totalAttachments += parts.length;

    const existing = this.channelStats.get(row.channelId);
    if (existing) {
      existing.messagesWithAttachments++;
      existing.totalAttachments += parts.length;
    } else {
      this.channelStats.set(row.channelId, {
        meta: row.channelMeta,
        messagesWithAttachments: 1,
        totalAttachments: parts.length,
      });
    }
  }
}

function channelDisplayName(meta: ChannelMeta): string {
  if (meta.isDM) return "Direct Message";
  return meta.name.startsWith("#") ? meta.name : `#${meta.name}`;
}

function serverOrPartner(meta: ChannelMeta): string {
  if (meta.isDM) {
    // Use partner name from raw channel name when available
    if (meta.name.startsWith(DM_PREFIX)) {
      return meta.name.slice(DM_PREFIX.length);
    }
    return "DM";
  }
  return meta.guildName ?? meta.guildId ?? "Unknown Server";
}

export async function runAttachments(exportPath: string, prog: Progress): Promise<void> {
  const { exportDir, cleanup } = await resolveExport(exportPath, prog, ExportFilter.messages);

  try {
    const userData = await loadUserData(exportDir);
    const channels = await loadAllChannels(exportDir, userData);

    const analyzer = new AttachmentsAnalyzer();

    prog.phase("Scanning attachments");
    await analyzeMessages(exportDir, [analyzer], channels, prog);
    prog.done("Scan complete");

    const w = termWidth();
    const divider = "─".repeat(Math.min(w, 54));
    const topChannels = [...analyzer.channelStats.values()]
      .sort((a, b) => b.totalAttachments - a.totalAttachments)
      .slice(0, 10);

    const msgLabel = "Messages with attachments:";
    const attLabel = "Total attachments sent:";
    const labelWidth = Math.max(msgLabel.length, attLabel.length) + 2;

    const lines: string[] = [
      "",
      "Attachment Activity",
      divider,
      "",
      "Totals",
      `  ${msgLabel.padEnd(labelWidth)} ${analyzer.messagesWithAttachments.toLocaleString()}`,
      `  ${attLabel.padEnd(labelWidth)} ${analyzer.totalAttachments.toLocaleString()}`,
      "",
      "Top 10 Channels by attachments",
      `  ${"#".padStart(3)}   ${"Channel".padEnd(24)}  ${"Server / DM Partner".padEnd(22)}  Attachments`,
    ];

    for (let i = 0; i < topChannels.length; i++) {
      const stat = topChannels[i]!;
      const rank = String(i + 1).padStart(3);
      const channel = channelDisplayName(stat.meta).padEnd(24);
      const server = serverOrPartner(stat.meta).padEnd(22);
      const count = stat.totalAttachments.toLocaleString().padStart(11);
      lines.push(`  ${rank}   ${channel}  ${server}  ${count}`);
    }

    lines.push("");
    printOutput(lines);
  } finally {
    await cleanup();
  }
}
