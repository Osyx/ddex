import { readdir, stat } from "fs/promises";
import { join } from "path";
import { basename } from "path";
import type { Progress } from "./progress.js";

const isMessageFile = (name: string): boolean => name.toLowerCase() === "messages.json";

const isRecord = (val: unknown): val is Record<string, unknown> =>
  typeof val === "object" && val !== null && !Array.isArray(val);

const findMessageFiles = async (dir: string): Promise<string[]> => {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findMessageFiles(fullPath)));
    } else if (isMessageFile(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
};

export const parseExport = async (
  exportDir: string,
  onContent: (content: string) => void,
  prog: Progress,
): Promise<number> => {
  const s = await stat(exportDir);
  let files: string[];

  if (!s.isDirectory()) {
    files = [exportDir];
  } else {
    const entries = await readdir(exportDir);
    const msgDirEntry = entries.find((e) => e.toLowerCase() === "messages");
    const messagesDir = msgDirEntry ? join(exportDir, msgDirEntry) : null;
    files = await findMessageFiles(messagesDir ?? exportDir);
  }

  prog.phase("Parsing messages");
  const total = files.length;
  let totalMessages = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    if (file === undefined) continue;
    prog.update(`  Parsing ${fileIndex + 1}/${total}: ${basename(file)}`);

    const bunFile = Bun.file(file);
    if (bunFile.size > 512 * 1024 * 1024) {
      process.stderr.write(`Warning: ${file} is over 512 MB, processing may be slow.\n`);
    }
    const raw = (await bunFile.json()) as unknown;
    let rows: unknown[];
    if (Array.isArray(raw)) {
      rows = raw;
    } else if (isRecord(raw)) {
      const msgs = raw.messages;
      if (!Array.isArray(msgs)) {
        process.stderr.write(`Warning: ${file} does not contain a top-level array, skipping.\n`);
        continue;
      }
      rows = msgs;
    } else {
      process.stderr.write(`Warning: ${file} does not contain a top-level array, skipping.\n`);
      continue;
    }
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const content = row["Contents"] ?? row["contents"] ?? row["content"];
      const msg = typeof content === "string" ? content : "";
      if (msg) {
        onContent(msg);
        totalMessages++;
      }
    }
  }

  prog.done(`Parsed ${totalMessages.toLocaleString()} messages from ${total} file(s)`);
  return totalMessages;
};
