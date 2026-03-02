import { createWriteStream, mkdirSync } from "fs";
import { rm, stat } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { dirname, join, resolve as resolvePath, sep } from "path";
import yauzl from "yauzl";
import type { Progress } from "./progress.js";

const isMessageEntryPath = (entryName: string): boolean => {
  const lower = entryName.toLowerCase();
  return lower.endsWith("/messages.csv") || lower.endsWith("/messages.json");
};

const extractMessageFiles = (zipPath: string, destDir: string, prog: Progress): Promise<void> =>
  new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr || !zipfile) return reject(openErr ?? new Error("Failed to open ZIP"));

      const total = zipfile.entryCount;
      let i = 0;

      zipfile.readEntry();

      zipfile.on("entry", (entry: yauzl.Entry) => {
        i++;
        const isDir = entry.fileName.endsWith("/");

        if (isDir || !isMessageEntryPath(entry.fileName)) {
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

  const tempDir = join(tmpdir(), `discord-mcd-${randomUUID()}`);
  prog.phase("Extracting ZIP");

  await extractMessageFiles(input, tempDir, prog);

  prog.done("Extracted message files");

  return {
    exportDir: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
};
