import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createWordDb } from "../db.js";
import type { WordDb } from "../db.js";

describe("createWordDb", () => {
  let db: WordDb;

  beforeEach(() => {
    db = createWordDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("starts with empty word counts", () => {
    expect(db.getWordCounts().size).toBe(0);
  });

  test("adds a single token", () => {
    db.addTokens(["hello"]);
    const counts = db.getWordCounts();
    expect(counts.get("hello")).toBe(1);
  });

  test("increments count for duplicate tokens", () => {
    db.addTokens(["hello", "hello", "hello"]);
    const counts = db.getWordCounts();
    expect(counts.get("hello")).toBe(3);
  });

  test("tracks multiple distinct tokens", () => {
    db.addTokens(["foo", "bar", "baz"]);
    const counts = db.getWordCounts();
    expect(counts.get("foo")).toBe(1);
    expect(counts.get("bar")).toBe(1);
    expect(counts.get("baz")).toBe(1);
    expect(counts.size).toBe(3);
  });

  test("accumulates across multiple addTokens calls", () => {
    db.addTokens(["hello"]);
    db.addTokens(["hello"]);
    db.addTokens(["world"]);
    const counts = db.getWordCounts();
    expect(counts.get("hello")).toBe(2);
    expect(counts.get("world")).toBe(1);
  });

  test("handles empty token array without error", () => {
    expect(() => db.addTokens([])).not.toThrow();
    expect(db.getWordCounts().size).toBe(0);
  });

  test("returns a Map from getWordCounts", () => {
    db.addTokens(["test"]);
    expect(db.getWordCounts()).toBeInstanceOf(Map);
  });

  test("handles large number of tokens", () => {
    const tokens = Array.from({ length: 1000 }, (_, i) => `word${i % 100}`);
    db.addTokens(tokens);
    const counts = db.getWordCounts();
    expect(counts.size).toBe(100);
    for (const count of counts.values()) {
      expect(count).toBe(10);
    }
  });
});
