import { createWriteStream, mkdirSync } from "fs";
import { rm, stat } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { dirname, join, resolve as resolvePath, sep } from "path";
import yauzl from "yauzl";
import type { Progress } from "./progress.js";

/** Pre-built file filters for common command needs. */
export const ExportFilter = {
  /** Only message JSON files (words, attachments). */
  messages: (f: string) => f.toLowerCase().startsWith("messages/"),
  /** Messages + server index (servers command). */
  messagesAndServers: (f: string) => {
    const l = f.toLowerCase();
    return l.startsWith("messages/") || l.startsWith("servers/");
  },
  /** Messages + analytics events (time, emojis). */
  messagesAndActivity: (f: string) => {
    const l = f.toLowerCase();
    return l.startsWith("messages/") || l.startsWith("activity/");
  },
  /** Account folder only (spent command). */
  account: (f: string) => f.toLowerCase().startsWith("account/"),
  /** Messages + analytics + account (people command). */
  messagesActivityAccount: (f: string) => {
    const l = f.toLowerCase();
    return l.startsWith("messages/") || l.startsWith("activity/") || l.startsWith("account/");
  },
} as const;

const extractFiles = (
  zipPath: string,
  destDir: string,
  prog: Progress,
  filter?: (fileName: string) => boolean,
): Promise<void> =>
  new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) return reject(openErr ?? new Error("Failed to open ZIP"));

      const total = zipfile.entryCount;
      let i = 0;

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        i++;
        const isDir = entry.fileName.endsWith("/");

        if (isDir || (filter && !filter(entry.fileName))) {
          zipfile.readEntry();
          return;
        }

        prog.update(`  Extracting ${i}/${total}: ${entry.fileName}`);

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream)
            return reject(streamErr ?? new Error("Failed to open entry stream"));

          const resolvedDest = resolvePath(destDir);
          const destPath = join(destDir, entry.fileName);
          if (!resolvePath(destPath).startsWith(resolvedDest + sep)) {
            zipfile.readEntry(); // skip malicious entry silently
            return;
          }
          mkdirSync(dirname(destPath), { recursive: true });

          const writeStream = createWriteStream(destPath);
          writeStream.on("error", reject);
          writeStream.on("finish", () => zipfile.readEntry());
          readStream.on("error", reject);
          readStream.pipe(writeStream);
        });
      });

      zipfile.on("end", resolve);
      zipfile.on("error", reject);
    });
  });

export const resolveExport = async (
  input: string,
  prog: Progress,
  filter?: (fileName: string) => boolean,
  keepUnzipped = process.env.DDEX_KEEP_UNZIPPED === "1",
): Promise<{ exportDir: string; cleanup: () => Promise<void> }> => {
  const s = await stat(input);

  if (s.isDirectory()) {
    return {
      exportDir: input,
      cleanup: async () => {
        /* no-op: user dir, never deleted */
      },
    };
  }

  if (!input.toLowerCase().endsWith(".zip")) {
    throw new Error(`Input must be a directory or a .zip file, got: ${input}`);
  }

  const tempDir = join(tmpdir(), `ddex-${randomUUID()}`);
  prog.phase("Extracting ZIP");

  await extractFiles(input, tempDir, prog, filter);

  prog.done("Extracted message files");

  if (!keepUnzipped) {
    process.stderr.write(
      `\x1b[2m  Tip: pass --keep-unzipped to reuse this extraction next time\x1b[0m\n`,
    );
  } else {
    process.stderr.write(`  Keeping unzipped export at: ${tempDir}\n`);
  }

  return {
    exportDir: tempDir,
    cleanup: async () => {
      if (!keepUnzipped) {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  };
};
