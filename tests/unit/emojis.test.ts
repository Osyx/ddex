import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { parseEmojisFromText } from "../../src/emojis.js";
import { runEmojis } from "../../src/emojis.js";
import { createProgress } from "../../src/progress.js";

// ─── parseEmojisFromText ───────────────────────────────────────────────────────

describe("parseEmojisFromText", () => {
  test("extracts Unicode emojis from text", () => {
    const result = parseEmojisFromText("hello 😂 world 👍");
    expect(result).toContain("😂");
    expect(result).toContain("👍");
    expect(result).toHaveLength(2);
  });

  test("extracts custom emojis as :name:", () => {
    const result = parseEmojisFromText("nice <:pout:123456789> work <a:dance:987654321>");
    expect(result).toContain(":pout:");
    expect(result).toContain(":dance:");
    expect(result).toHaveLength(2);
  });

  test("extracts both Unicode and custom emojis together", () => {
    const result = parseEmojisFromText("wow 😀 and <:cool:111222333>");
    expect(result).toContain("😀");
    expect(result).toContain(":cool:");
    expect(result).toHaveLength(2);
  });

  test("returns empty array for text with no emojis", () => {
    expect(parseEmojisFromText("hello world")).toHaveLength(0);
    expect(parseEmojisFromText("")).toHaveLength(0);
    expect(parseEmojisFromText("just some text with numbers 123")).toHaveLength(0);
  });

  test("counts repeated emojis", () => {
    const result = parseEmojisFromText("😂😂😂");
    expect(result).toHaveLength(3);
    expect(result.every((e) => e === "😂")).toBe(true);
  });

  test("does not treat numeric IDs in custom emoji as emojis", () => {
    const result = parseEmojisFromText("<:wave:999000111222>");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(":wave:");
  });
});

// ─── runEmojis integration ─────────────────────────────────────────────────────

describe("runEmojis", () => {
  const makeTempExport = (messages: object[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "ddex-emojis-test-"));
    const msgDir = join(dir, "messages", "c111000000000000001");
    mkdirSync(msgDir, { recursive: true });
    writeFileSync(join(msgDir, "messages.json"), JSON.stringify(messages));
    return dir;
  };

  test("runs without throwing on export with emoji messages", async () => {
    const dir = makeTempExport([
      { ID: "1", Timestamp: "2024-01-01 10:00:00", Contents: "hello 😂 world", Attachments: "" },
      {
        ID: "2",
        Timestamp: "2024-01-01 10:01:00",
        Contents: "<:pout:123456>",
        Attachments: "",
      },
    ]);
    try {
      const prog = createProgress();
      await expect(runEmojis(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("runs without throwing on empty export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ddex-emojis-empty-"));
    mkdirSync(join(dir, "messages"), { recursive: true });
    try {
      const prog = createProgress();
      await expect(runEmojis(dir, prog)).resolves.toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
