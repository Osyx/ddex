import { parse } from "csv-parse";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { basename } from "path";
import type { Progress } from "./progress.js";

const isMessageFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower === "messages.csv" || lower === "messages.json";
};

const findMessageFiles = async (dir: string): Promise<string[]> => {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      results.push(...(await findMessageFiles(fullPath)));
    } else if (isMessageFile(entry)) {
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
    try {
      if (messagesDir) await stat(messagesDir);
      files = await findMessageFiles(messagesDir ?? exportDir);
    } catch {
      files = await findMessageFiles(exportDir);
    }
  }

  prog.phase("Parsing messages");
  const total = files.length;
  let totalMessages = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    if (file === undefined) continue;
    prog.update(`  Parsing ${fileIndex + 1}/${total}: ${basename(file)}`);

    if (file.toLowerCase().endsWith(".json")) {
      const raw = (await Bun.file(file).json()) as unknown;
      const rows: unknown[] = Array.isArray(raw) ? raw : [];
      for (const row of rows) {
        if (typeof row !== "object" || row === null) continue;
        const pairs = Object.entries(row);
        const content = pairs.find(
          ([k]) => k === "Contents" || k === "contents" || k === "content",
        )?.[1];
        const msg = typeof content === "string" ? content : "";
        if (msg) {
          onContent(msg);
          totalMessages++;
        }
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        const parser = parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });

        parser.on("data", (row: Record<string, string>) => {
          const content = row["Contents"] ?? row["contents"] ?? "";
          if (content) {
            onContent(content);
            totalMessages++;
          }
        });
        parser.on("error", reject);
        parser.on("end", resolve);

        createReadStream(file).pipe(parser);
      });
    }
  }

  prog.done(`Parsed ${totalMessages.toLocaleString()} messages from ${total} file(s)`);
  return totalMessages;
};
