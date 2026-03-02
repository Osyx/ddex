/**
 * Binary integration test — builds the CLI binary for the current platform
 * and runs it against the test fixture to verify end-to-end behaviour.
 *
 * Run with: bun test tests/binary.test.ts
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { platform } from "os";

const FIXTURE = join(import.meta.dirname, "../fixtures/export");
const ANALYTICS_FIXTURE = join(import.meta.dirname, "../fixtures/analytics");
const BINARY = platform() === "win32" ? "./ddex.exe" : "./ddex";

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
    const result = run(["words", FIXTURE]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("programming");
  });

  test("top word is 'programming' (appears most in fixture)", () => {
    const result = run(["words", FIXTURE]);
    expect(result.status).toBe(0);
    // First ranked word should be programming (6 occurrences)
    const lines = result.stdout.split("\n").filter((l) => /^\s*\d+\./.test(l));
    expect(lines[0]).toContain("programming");
  });

  test("--top limits number of results", () => {
    const result = run(["words", FIXTURE, "--top", "2"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Top 2");
  });

  test("--include-stop-words includes common words like 'is'", () => {
    const withStopWords = run(["words", FIXTURE, "--include-stop-words", "--top", "20"]);
    const withoutStopWords = run(["words", FIXTURE]);
    expect(withStopWords.status).toBe(0);
    // "is" appears 3x in fixture - should appear with stop words included
    expect(withStopWords.stdout).toContain("is");
    // Without stop words "is" should not appear as a ranked result
    const withoutLines = withoutStopWords.stdout.split("\n").filter((l) => /^\s*\d+\./.test(l));
    expect(withoutLines.every((l) => !l.includes(" is "))).toBe(true);
  });

  test("--output writes a text file", async () => {
    const outPath = join(tmpdir(), `ddex-test-${Date.now()}.txt`);
    try {
      const result = run(["words", FIXTURE, "--output", outPath]);
      expect(result.status).toBe(0);
      expect(existsSync(outPath)).toBe(true);
      const content = await Bun.file(outPath).text();
      expect(content).toContain("programming");
    } finally {
      if (existsSync(outPath)) rmSync(outPath);
    }
  });

  test("--output writes a JSON file", async () => {
    const outPath = join(tmpdir(), `ddex-test-${Date.now()}.json`);
    try {
      const result = run(["words", FIXTURE, "--output", outPath]);
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

  test("exits non-zero when no command is provided", () => {
    const result = run([]);
    expect(result.status).not.toBe(0);
  });

  test("exits non-zero for unknown command", () => {
    const result = run(["unknown-command"]);
    expect(result.status).not.toBe(0);
  });

  test("exits non-zero when no path is provided to words", () => {
    const result = run(["words"]);
    expect(result.status).not.toBe(0);
  });

  test("handles Swedish characters and real-world Discord format", () => {
    const result = run(["words", FIXTURE, "--language", "swe,eng", "--top", "20"]);
    expect(result.status).toBe(0);
    // Swedish words from the fixture should appear
    expect(result.stdout).toContain("nyår");
    // Discord emoji-only messages should produce no tokens (not crash)
    expect(result.stdout).toContain("messages processed");
  });

  test("accepts a ZIP file", async () => {
    // Create a ZIP of the fixture using jszip
    const JSZip = (await import("jszip")).default;
    const { readFileSync, readdirSync, statSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const zipPath = join(tmpdir(), `ddex-test-${Date.now()}.zip`);
    try {
      const zip = new JSZip();
      const addDir = (dir: string, zipDir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = pathJoin(dir, entry);
          const rel = zipDir ? `${zipDir}/${entry}` : entry;
          if (statSync(full).isDirectory()) {
            addDir(full, rel);
          } else {
            zip.file(rel, readFileSync(full));
          }
        }
      };
      addDir(FIXTURE, "");
      const buf = await zip.generateAsync({ type: "nodebuffer" });
      require("fs").writeFileSync(zipPath, buf);

      const result = run(["words", zipPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("programming");
    } finally {
      if (existsSync(zipPath)) rmSync(zipPath);
    }
  });
});

describe("prediction command", () => {
  test("shows predicted age and gender from fixture", () => {
    const result = run(["prediction", ANALYTICS_FIXTURE]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("25-34");
    expect(result.stdout).toContain("male");
    expect(result.stdout).toContain("confidence");
  });

  test("--help exits 0 and prints usage", () => {
    const result = run(["prediction", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage");
  });

  test("exits non-zero when no path is provided", () => {
    const result = run(["prediction"]);
    expect(result.status).not.toBe(0);
  });
});
