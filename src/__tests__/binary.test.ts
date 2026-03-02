/**
 * Binary integration test — builds the CLI binary for the current platform
 * and runs it against the test fixture to verify end-to-end behaviour.
 *
 * Run with: bun test src/__tests__/binary.test.ts
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { platform } from "os";

const FIXTURE = join(import.meta.dirname, "../../tests/fixtures/export");
const BINARY = platform() === "win32" ? "./discord-mcd.exe" : "./discord-mcd";

const run = (args: string[]): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync(BINARY, args, { encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
};

beforeAll(() => {
  if (!existsSync(BINARY)) {
    console.log("Building binary...");
    const result = spawnSync("bun", ["run", "build"], { encoding: "utf8", stdio: "inherit" });
    if (result.status !== 0) throw new Error("Binary build failed");
  }
});

describe("binary smoke tests", () => {
  test("exits 0 and produces output for valid export directory", () => {
    const result = run([FIXTURE]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("programming");
  });

  test("top word is 'programming' (appears most in fixture)", () => {
    const result = run([FIXTURE]);
    expect(result.status).toBe(0);
    // First ranked word should be programming (6 occurrences)
    const lines = result.stdout.split("\n").filter((l) => /^\s*\d+\./.test(l));
    expect(lines[0]).toContain("programming");
  });

  test("--top limits number of results", () => {
    const result = run([FIXTURE, "--top", "2"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Top 2");
  });

  test("--include-stop-words includes common words like 'is'", () => {
    const withStopWords = run([FIXTURE, "--include-stop-words", "--top", "20"]);
    const withoutStopWords = run([FIXTURE]);
    expect(withStopWords.status).toBe(0);
    // "is" appears 3x in fixture - should appear with stop words included
    expect(withStopWords.stdout).toContain("is");
    // Without stop words "is" should not appear as a ranked result
    const withoutLines = withoutStopWords.stdout.split("\n").filter((l) => /^\s*\d+\./.test(l));
    expect(withoutLines.every((l) => !l.includes(" is "))).toBe(true);
  });

  test("--output writes a text file", async () => {
    const outPath = join(tmpdir(), `discord-mcd-test-${Date.now()}.txt`);
    try {
      const result = run([FIXTURE, "--output", outPath]);
      expect(result.status).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const content = await Bun.file(outPath).text();
      expect(content).toContain("programming");
    } finally {
      if (existsSync(outPath)) rmSync(outPath);
    }
  });

  test("--output writes a JSON file", async () => {
    const outPath = join(tmpdir(), `discord-mcd-test-${Date.now()}.json`);
    try {
      const result = run([FIXTURE, "--output", outPath]);
      expect(result.status).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const json = JSON.parse(await Bun.file(outPath).text());
      expect(json).toHaveProperty("groups");
      expect(json).toHaveProperty("totalMessages");
      expect(json.groups[0].canonical).toBe("programming");
    } finally {
      if (existsSync(outPath)) rmSync(outPath);
    }
  });

  test("--help exits 0 and prints usage", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage");
  });

  test("exits non-zero when no path is provided", () => {
    const result = run([]);
    expect(result.status).not.toBe(0);
  });

  test("exits non-zero for unknown flag", () => {
    const result = run(["--unknown-flag"]);
    expect(result.status).not.toBe(0);
  });

  test("handles Swedish characters and real-world Discord format", () => {
    const result = run([FIXTURE, "--language", "swe,eng", "--top", "20"]);
    expect(result.status).toBe(0);
    // Swedish words from the fixture should appear
    expect(result.stdout).toContain("nyår");
    // Discord emoji-only messages should produce no tokens (not crash)
    expect(result.stdout).toContain("messages processed");
  });

  test("accepts a ZIP file", async () => {
    // Create a ZIP of the fixture using adm-zip
    const AdmZip = (await import("adm-zip")).default;
    const zipPath = join(tmpdir(), `discord-mcd-test-${Date.now()}.zip`);
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(FIXTURE);
      zip.writeZip(zipPath);

      const result = run([zipPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("programming");
    } finally {
      if (existsSync(zipPath)) rmSync(zipPath);
    }
  });
});
