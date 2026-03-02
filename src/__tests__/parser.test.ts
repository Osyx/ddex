import { describe, expect, test } from "bun:test";
import { join } from "path";
import { parseExport } from "../parser.js";
import { createProgress } from "../progress.js";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures");

const collect = async (dir: string): Promise<string[]> => {
  const contents: string[] = [];
  await parseExport(dir, (c) => contents.push(c), createProgress());
  return contents;
};

describe("parseExport", () => {
  test("reads CSV messages from lowercase 'messages' directory", async () => {
    const contents = await collect(join(FIXTURES, "export"));
    expect(contents.length).toBe(13);
    expect(contents.some((c) => c.includes("hello"))).toBe(true);
  });

  test("reads JSON messages from uppercase 'Messages' directory", async () => {
    const contents = await collect(join(FIXTURES, "export-json"));
    expect(contents.length).toBe(3);
    expect(contents.some((c) => c.includes("nyår"))).toBe(true);
  });

  test("reads a single CSV file directly", async () => {
    const file = join(FIXTURES, "export/messages/c100000000000000001/messages.csv");
    const contents = await collect(file);
    expect(contents.length).toBe(8);
  });

  test("reads a single JSON file directly", async () => {
    const file = join(FIXTURES, "export-json/Messages/c300000000000000003/messages.json");
    const contents = await collect(file);
    expect(contents.length).toBe(3);
  });

  test("skips rows with empty Contents", async () => {
    // emoji-only row has Contents "<:pout:...>" which is non-empty — only truly blank is skipped
    const contents = await collect(join(FIXTURES, "export"));
    expect(contents.every((c) => c.length > 0)).toBe(true);
  });
});
