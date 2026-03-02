import { readdirSync } from "fs";
import { join } from "path";
import type { Progress } from "./progress.js";
import type { ChannelMeta } from "./metadata.js";

export interface MessageRow {
  id: string;
  timestamp: Date;
  contents: string;
  attachments: string;
  channelId: string;
  channelMeta: ChannelMeta;
}

export interface MessageAnalyzer {
  onMessage(row: MessageRow): void;
}

/** Run all analyzers in a single pass over all messages.json files. Returns total message count. */
export async function analyzeMessages(
  exportDir: string,
  analyzers: MessageAnalyzer[],
  channels: Map<string, ChannelMeta>,
  prog: Progress,
): Promise<number> {
  let msgDirName: string | undefined;
  try {
    const entries = readdirSync(exportDir, { withFileTypes: true });
    const match = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === "messages");
    msgDirName = match?.name;
  } catch {
    return 0;
  }

  if (!msgDirName) return 0;
  const messagesDir = join(exportDir, msgDirName);

  const channelDirs = readdirSync(messagesDir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && /^c\d+$/i.test(e.name),
  );

  prog.phase("Parsing messages");
  let totalMessages = 0;

  for (let i = 0; i < channelDirs.length; i++) {
    const dirEntry = channelDirs[i]!;
    const channelDir = join(messagesDir, dirEntry.name);
    const channelId = dirEntry.name.slice(1); // strip leading 'c'

    // Find messages.json case-insensitively
    const fileEntries = readdirSync(channelDir, { withFileTypes: true });
    const msgFile = fileEntries.find((e) => e.isFile() && e.name.toLowerCase() === "messages.json");
    if (!msgFile) continue;

    prog.update(`  Parsing ${i + 1}/${channelDirs.length}: ${dirEntry.name}`);

    const filePath = join(channelDir, msgFile.name);
    const raw = (await Bun.file(filePath).json()) as unknown;

    let rows: unknown[];
    if (Array.isArray(raw)) {
      rows = raw;
    } else if (
      typeof raw === "object" &&
      raw !== null &&
      "messages" in raw &&
      Array.isArray((raw as Record<string, unknown>).messages)
    ) {
      rows = (raw as Record<string, unknown[]>).messages;
    } else {
      continue;
    }

    const channelMeta: ChannelMeta = channels.get(channelId) ?? {
      id: channelId,
      name: dirEntry.name,
      isDM: false,
      dmPartnerId: null,
      guildId: null,
      guildName: null,
    };

    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const contents = typeof r["Contents"] === "string" ? r["Contents"] : "";
      if (!contents) continue;

      const msgRow: MessageRow = {
        id: String(r["ID"] ?? ""),
        timestamp: new Date(String(r["Timestamp"] ?? "")),
        contents,
        attachments: typeof r["Attachments"] === "string" ? r["Attachments"] : "",
        channelId,
        channelMeta,
      };

      for (const analyzer of analyzers) {
        analyzer.onMessage(msgRow);
      }
      totalMessages++;
    }
  }

  prog.done(`Parsed ${totalMessages.toLocaleString()} messages`);
  return totalMessages;
}
