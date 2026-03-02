import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import JSZip from "jszip";
import { resolveExport } from "../../src/extractor.js";
import { createProgress } from "../../src/progress.js";

const makeTmpDir = (): string => {
  const dir = join(tmpdir(), `extractor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const makeTmpPath = (suffix: string): string =>
  join(tmpdir(), `extractor-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);

const prog = createProgress();

// Track paths to clean up after each test
const toCleanup: string[] = [];

afterEach(() => {
  for (const p of toCleanup.splice(0)) {
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
});

describe("resolveExport", () => {
  test("directory input: returns exportDir equal to input, cleanup is a no-op", async () => {
    const dir = makeTmpDir();
    toCleanup.push(dir);

    const result = await resolveExport(dir, prog);
    expect(result.exportDir).toBe(dir);

    // cleanup should not delete the directory
    await result.cleanup();
    expect(existsSync(dir)).toBe(true);
  });

  test("non-.zip file: throws error containing 'must be a directory or a .zip file'", async () => {
    const filePath = makeTmpPath(".txt");
    writeFileSync(filePath, "not a zip");
    toCleanup.push(filePath);

    let threw = false;
    try {
      await resolveExport(filePath, prog);
    } catch (e) {
      threw = true;
      expect(e instanceof Error && e.message).toContain("must be a directory or a .zip file");
    }
    expect(threw).toBe(true);
  });

  test("ZIP with message files: extracts messages, cleanup deletes temp dir", async () => {
    const zipPath = makeTmpPath(".zip");
    toCleanup.push(zipPath);

    const zip = new JSZip();
    zip.file(
      "messages/c123/messages.csv",
      "ID,Timestamp,Contents,Attachments\n1,2024-01-01,hello,",
    );
    zip.file("messages/c123/channel.json", '{"id":"123"}');
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    writeFileSync(zipPath, buf);

    const result = await resolveExport(zipPath, prog);
    toCleanup.push(result.exportDir);

    // The temp dir should exist and contain the extracted messages CSV
    expect(existsSync(result.exportDir)).toBe(true);
    expect(existsSync(join(result.exportDir, "messages/c123/messages.csv"))).toBe(true);

    // cleanup should delete the temp dir
    await result.cleanup();
    expect(existsSync(result.exportDir)).toBe(false);
  });

  test("ZIP with no message files: succeeds, temp dir has no message files", async () => {
    const zipPath = makeTmpPath(".zip");
    toCleanup.push(zipPath);

    const zip = new JSZip();
    zip.file("readme.txt", "no messages here");
    zip.file("data/other.json", "{}");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    writeFileSync(zipPath, buf);

    const result = await resolveExport(zipPath, prog);
    toCleanup.push(result.exportDir);

    // Should succeed without throwing
    expect(result.exportDir).toBeTruthy();

    // No messages.csv or messages.json should have been extracted
    const hasMessages =
      existsSync(join(result.exportDir, "messages.csv")) ||
      existsSync(join(result.exportDir, "messages.json"));
    expect(hasMessages).toBe(false);

    await result.cleanup();
  });

  test("ZIP with path-traversal entry: does not write outside temp dir", async () => {
    const zipPath = makeTmpPath(".zip");
    toCleanup.push(zipPath);

    const zip = new JSZip();
    // Legitimate entry
    zip.file("messages/c456/messages.csv", "ID,Timestamp,Contents,Attachments\n1,2024-01-01,safe,");
    // Attempt path-traversal entry (yauzl may reject the ZIP entirely, which is also safe)
    zip.file("../../evil-messages.csv", "ID,Timestamp,Contents,Attachments\n1,2024-01-01,evil,");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    writeFileSync(zipPath, buf);

    // A file written outside any temp dir we control
    const evilPath = join(tmpdir(), "evil-messages.csv");

    let exportDir: string | undefined;
    try {
      const result = await resolveExport(zipPath, prog);
      exportDir = result.exportDir;
      toCleanup.push(exportDir);

      // If extraction succeeded, the legit file should be present
      expect(existsSync(join(exportDir, "messages/c456/messages.csv"))).toBe(true);

      await result.cleanup();
    } catch {
      // yauzl rejecting the entire ZIP because of the bad entry is also a safe outcome
    }

    // In no case should a file have been written outside the temp dir
    expect(existsSync(evilPath)).toBe(false);
  });
});
