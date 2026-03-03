import { readdirSync } from "fs";
import { join } from "path";
import type { Progress } from "./progress.js";
import type { ChannelMeta } from "./metadata.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const isUnknownArray = (v: unknown): v is unknown[] => Array.isArray(v);

const hasMessagesArray = (v: unknown): v is { messages: unknown[] } =>
  isRecord(v) && isUnknownArray(v.messages);

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
export const analyzeMessages = async (
  exportDir: string,
  analyzers: MessageAnalyzer[],
  channels: Map<string, ChannelMeta>,
  prog: Progress,
): Promise<number> => {
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
  const BATCH = 8;

  for (let i = 0; i < channelDirs.length; i += BATCH) {
    const batch = channelDirs.slice(i, i + BATCH);

    // Read + parse all files in the batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (dirEntry) => {
        const channelDir = join(messagesDir, dirEntry.name);
        const channelId = dirEntry.name.slice(1);

        const fileEntries = readdirSync(channelDir, { withFileTypes: true });
        const msgFile = fileEntries.find(
          (e) => e.isFile() && e.name.toLowerCase() === "messages.json",
        );
        if (!msgFile) return null;

        const filePath = join(channelDir, msgFile.name);
        const raw = (await Bun.file(filePath).json()) as unknown;

        let rows: unknown[];
        if (isUnknownArray(raw)) {
          rows = raw;
        } else if (hasMessagesArray(raw)) {
          rows = raw.messages;
        } else {
          return null;
        }

        const channelMeta: ChannelMeta = channels.get(channelId) ?? {
          id: channelId,
          name: dirEntry.name,
          isDM: false,
          isGroupDM: false,
          dmPartnerId: null,
          guildId: null,
          guildName: null,
        };

        return { rows, channelMeta, channelId };
      }),
    );

    prog.update(`  Parsing ${Math.min(i + BATCH, channelDirs.length)}/${channelDirs.length}`);

    // Dispatch to analyzers (serial — analyzers may have shared state)
    for (const result of batchResults) {
      if (!result) continue;
      const { rows, channelMeta, channelId } = result;
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const r = row;
        const contents = typeof r["Contents"] === "string" ? r["Contents"] : "";
        if (!contents) continue;

        const msgRow: MessageRow = {
          id: typeof r["ID"] === "string" ? r["ID"] : "",
          timestamp: new Date(typeof r["Timestamp"] === "string" ? r["Timestamp"] : ""),
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
  }

  prog.done(`Parsed ${totalMessages.toLocaleString()} messages`);
  return totalMessages;
};
