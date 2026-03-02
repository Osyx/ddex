import { describe, expect, test } from "bun:test";
import { cluster } from "../../src/grouper.js";

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
    // longer words (> 3 chars normalised) with edit distance 1 should merge
    const counts = new Map([
      ["colour", 8],
      ["color", 2],
    ]);
    const groups = cluster(counts);
    const combined = groups.find((g) => g.variants.some((v) => v.word === "colour"));
    expect(combined?.variants.some((v) => v.word === "color")).toBe(true);
    expect(combined?.canonical).toBe("colour");
  });

  test("does not merge very short words (<=2 chars) with edit distance 1", () => {
    // "hi" and "ha" share phonetic key H but are too short to fuzz
    const counts = new Map([
      ["hi", 5],
      ["ha", 3],
    ]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(2);
  });

  test("merges 3-char phonetic variants like lol/lul", () => {
    const counts = new Map([
      ["lol", 10],
      ["lul", 3],
    ]);
    const groups = cluster(counts);
    const combined = groups.find((g) => g.variants.some((v) => v.word === "lol"));
    expect(combined?.variants.some((v) => v.word === "lul")).toBe(true);
  });

  test("merges yeah/yea (one is prefix of the other)", () => {
    const counts = new Map([
      ["yeah", 10],
      ["yea", 6],
    ]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonical).toBe("yeah");
  });

  test("does not merge across large length differences", () => {
    // tror / terror share phonetic key TRR but edit distance 2 exceeds threshold for maxLen 6
    const counts = new Map([
      ["tror", 10],
      ["terror", 5],
    ]);
    const groups = cluster(counts);
    expect(groups).toHaveLength(2);
  });

  test("normalises repeated characters to merge elongations", () => {
    // niiice (3 i's) normalises to niice before comparing with nice
    const counts = new Map([
      ["nice", 10],
      ["niiice", 3],
    ]);
    const groups = cluster(counts);
    const combined = groups.find((g) => g.variants.some((v) => v.word === "nice"));
    expect(combined?.variants.some((v) => v.word === "niiice")).toBe(true);
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
