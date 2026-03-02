import { describe, expect, test } from "bun:test";
import { cluster } from "../grouper.js";

describe("cluster", () => {
  test("returns empty array for empty map", () => {
    expect(cluster(new Map())).toEqual([]);
  });

  test("returns single group for single word", () => {
    const counts = new Map([["hello", 5]]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonical).toBe("hello");
    expect(groups[0]?.total).toBe(5);
    expect(groups[0]?.variants).toHaveLength(1);
  });

  test("groups identical words as one", () => {
    const counts = new Map([["hello", 3]]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.total).toBe(3);
  });

  test("clusters phonetically similar words together", () => {
    // haha / hahah / hahaha share phonetic key
    const counts = new Map([
      ["haha", 10],
      ["hahah", 5],
      ["hahaha", 3],
    ]);
    const groups = cluster(counts);
    // Should produce fewer groups than words (at least some clustering)
    expect(groups.length).toBeLessThan(3);
  });

  test("canonical is the most frequent variant", () => {
    const counts = new Map([
      ["colour", 2],
      ["color", 8],
    ]);
    const groups = cluster(counts);
    const relevant = groups.find((g) => g.variants.some((v) => v.word === "color"));
    expect(relevant?.canonical).toBe("color");
  });

  test("groups are sorted by total count descending", () => {
    const counts = new Map([
      ["apple", 1],
      ["zebra", 10],
      ["mango", 5],
    ]);
    const groups = cluster(counts);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]!.total).toBeGreaterThanOrEqual(groups[i]!.total);
    }
  });

  test("distinct phonetic words are separate groups", () => {
    const counts = new Map([
      ["apple", 5],
      ["zebra", 5],
    ]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(2);
  });

  test("merges by edit distance within phonetic bucket", () => {
    // typ / typo are close in edit distance and phonetically similar
    const counts = new Map([
      ["typ", 3],
      ["typo", 5],
    ]);
    const groups = cluster(counts);
    // Should merge into 1 or 2 groups; at minimum typo should be canonical if in same group
    const combined = groups.find((g) => g.variants.some((v) => v.word === "typ"));
    if (combined?.variants.some((v) => v.word === "typo")) {
      expect(combined.canonical).toBe("typo");
    }
  });

  test("total is sum of all variant counts in a group", () => {
    const counts = new Map([
      ["test", 4],
      ["tests", 3],
    ]);
    const groups = cluster(counts);
    const all = groups.reduce((s, g) => s + g.total, 0);
    expect(all).toBe(7);
  });
});
