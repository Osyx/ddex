import AdmZip from "adm-zip";
import { randomBytes } from "crypto";
import { rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Progress } from "./progress.js";

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

  if (!input.endsWith(".zip")) {
    throw new Error(`Input must be a directory or a .zip file, got: ${input}`);
  }

  const tempDir = join(tmpdir(), `discord-mcd-${randomBytes(8).toString("hex")}`);
  prog.phase("Extracting ZIP");

  const zip = new AdmZip(input);
  const entries = zip.getEntries();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    prog.update(`  Extracting ${i + 1}/${entries.length}: ${entry.entryName}`);
    zip.extractEntryTo(entry, tempDir, true, true);
  }

  prog.done(`Extracted ${entries.length} files to temp dir`);

  return {
    exportDir: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
};
