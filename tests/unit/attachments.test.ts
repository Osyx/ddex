import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { splitAttachments } from "../../src/attachments.js";
import { runAttachments } from "../../src/attachments.js";
import { createProgress } from "../../src/progress.js";

// ─── splitAttachments ──────────────────────────────────────────────────────────

describe("splitAttachments", () => {
  test("returns empty array for empty string", () => {
    expect(splitAttachments("")).toHaveLength(0);
    expect(splitAttachments("   ")).toHaveLength(0);
  });

  test("returns single item for a single URL", () => {
    const result = splitAttachments("https://cdn.discordapp.com/attachments/123/file.png");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("https://cdn.discordapp.com/attachments/123/file.png");
  });

  test("splits on whitespace", () => {
    const result = splitAttachments(
      "https://cdn.discordapp.com/a/1.png https://cdn.discordapp.com/a/2.jpg",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("1.png");
    expect(result[1]).toContain("2.jpg");
  });

  test("splits on commas", () => {
    const result = splitAttachments("https://example.com/a.png,https://example.com/b.png");
    expect(result).toHaveLength(2);
  });

  test("handles mixed whitespace and commas", () => {
    const result = splitAttachments("a.png , b.png  c.png");
    expect(result).toHaveLength(3);
  });

  test("filters out empty tokens after split", () => {
    const result = splitAttachments("  a.png  ,  ,  b.png  ");
    expect(result).toHaveLength(2);
    expect(result).not.toContain("");
  });
});

// ─── runAttachments integration ────────────────────────────────────────────────

describe("runAttachments", () => {
  const makeTempExport = (messages: object[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "ddex-attachments-test-"));
    const msgDir = join(dir, "messages", "c222000000000000001");
    mkdirSync(msgDir, { recursive: true });
    writeFileSync(join(msgDir, "messages.json"), JSON.stringify(messages));
    return dir;
  };

  test("runs without throwing on messages with attachments", async () => {
    const dir = makeTempExport([
      {
        ID: "1",
        Timestamp: "2024-01-01 10:00:00",
        Contents: "here",
        Attachments: "https://cdn.discordapp.com/attachments/1/file.png",
      },
      {
        ID: "2",
        Timestamp: "2024-01-01 10:01:00",
        Contents: "two files",
        Attachments: "https://cdn.discordapp.com/a/1.png https://cdn.discordapp.com/a/2.jpg",
      },
    ]);
    try {
      const prog = createProgress();
      await runAttachments(dir, prog);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs without throwing when no attachments", async () => {
    const dir = makeTempExport([
      { ID: "1", Timestamp: "2024-01-01 10:00:00", Contents: "just text", Attachments: "" },
    ]);
    try {
      const prog = createProgress();
      await runAttachments(dir, prog);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
