import { parse } from "csv-parse";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { basename } from "path";
import type { Progress } from "./progress.js";

const findMessageFiles = async (dir: string): Promise<string[]> => {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const s = await stat(fullPath);
    if (s.isDirectory()) {
      results.push(...(await findMessageFiles(fullPath)));
    } else if (entry === "messages.csv") {
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
    const messagesDir = join(exportDir, "messages");
    try {
      await stat(messagesDir);
      files = await findMessageFiles(messagesDir);
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

  prog.done(`Parsed ${totalMessages.toLocaleString()} messages from ${total} file(s)`);
  return totalMessages;
};
