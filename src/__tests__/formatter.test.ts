import { describe, expect, test } from "bun:test";
import { formatConsole } from "../formatter.js";
import type { WordGroup } from "../types.js";

const makeGroup = (
  canonical: string,
  total: number,
  variants?: { word: string; count: number }[],
): WordGroup => ({
  canonical,
  total,
  variants: variants ?? [{ word: canonical, count: total }],
});

describe("formatConsole", () => {
  test("includes header with group count and message count", () => {
    const groups = [makeGroup("hello", 5)];
    const output = formatConsole(groups, 100);
    expect(output).toContain("Top 1");
    expect(output).toContain("100");
  });

  test("includes canonical word", () => {
    const groups = [makeGroup("programming", 42)];
    const output = formatConsole(groups, 10);
    expect(output).toContain("programming");
  });

  test("includes total count", () => {
    const groups = [makeGroup("hello", 99)];
    const output = formatConsole(groups, 10);
    expect(output).toContain("99");
  });

  test("includes rank numbers", () => {
    const groups = [makeGroup("foo", 3), makeGroup("bar", 2), makeGroup("baz", 1)];
    const output = formatConsole(groups, 10);
    expect(output).toContain("1.");
    expect(output).toContain("2.");
    expect(output).toContain("3.");
  });

  test("includes variant words and counts", () => {
    const groups = [
      makeGroup("colour", 10, [
        { word: "colour", count: 6 },
        { word: "color", count: 4 },
      ]),
    ];
    const output = formatConsole(groups, 50);
    expect(output).toContain("colour×6");
    expect(output).toContain("color×4");
  });

  test("handles multiple groups", () => {
    const groups = [makeGroup("hello", 5), makeGroup("world", 3)];
    const output = formatConsole(groups, 20);
    expect(output).toContain("hello");
    expect(output).toContain("world");
  });

  test("handles large message counts with locale formatting", () => {
    const groups = [makeGroup("word", 1)];
    const output = formatConsole(groups, 1_000_000);
    // Locale-formatted number should appear (e.g. 1,000,000 or 1.000.000)
    expect(output).toContain("000");
  });
});
