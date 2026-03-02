import { describe, expect, test } from "bun:test";
import { SUPPORTED_LANGUAGES, buildStopWordSet, isStopWord } from "../../src/stopwords.js";

describe("buildStopWordSet", () => {
  test("returns a Set for a known language", () => {
    const set = buildStopWordSet(["eng"]);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBeGreaterThan(0);
  });

  test("filters common English stop words", () => {
    const set = buildStopWordSet(["eng"]);
    expect(set.has("the")).toBe(true);
    expect(set.has("is")).toBe(true);
    expect(set.has("and")).toBe(true);
    expect(set.has("a")).toBe(true);
  });

  test("filters common Swedish stop words", () => {
    const set = buildStopWordSet(["swe"]);
    expect(set.has("och")).toBe(true);
    expect(set.has("att")).toBe(true);
    expect(set.has("det")).toBe(true);
  });

  test("merges multiple languages", () => {
    const eng = buildStopWordSet(["eng"]);
    const swe = buildStopWordSet(["swe"]);
    const both = buildStopWordSet(["eng", "swe"]);
    expect(both.size).toBeGreaterThanOrEqual(eng.size);
    expect(both.size).toBeGreaterThanOrEqual(swe.size);
    expect(both.has("the")).toBe(true);
    expect(both.has("och")).toBe(true);
  });

  test("throws on unknown language code", () => {
    expect(() => buildStopWordSet(["xyz"])).toThrow('Unsupported language code: "xyz"');
  });

  test("error message lists supported languages", () => {
    expect(() => buildStopWordSet(["xyz"])).toThrow("Supported codes:");
  });

  test("is case-insensitive (stores lowercase)", () => {
    const set = buildStopWordSet(["eng"]);
    for (const word of set) {
      expect(word).toBe(word.toLowerCase());
    }
  });
});

describe("isStopWord", () => {
  test("returns true for a stop word", () => {
    const set = buildStopWordSet(["eng"]);
    expect(isStopWord("the", set)).toBe(true);
  });

  test("returns false for a non-stop word", () => {
    const set = buildStopWordSet(["eng"]);
    expect(isStopWord("programming", set)).toBe(false);
  });

  test("is case-insensitive", () => {
    const set = buildStopWordSet(["eng"]);
    expect(isStopWord("THE", set)).toBe(true);
    expect(isStopWord("The", set)).toBe(true);
  });
});

describe("SUPPORTED_LANGUAGES", () => {
  test("is a sorted array", () => {
    const sorted = [...SUPPORTED_LANGUAGES].toSorted();
    expect(SUPPORTED_LANGUAGES).toEqual(sorted);
  });

  test("includes eng and swe", () => {
    expect(SUPPORTED_LANGUAGES).toContain("eng");
    expect(SUPPORTED_LANGUAGES).toContain("swe");
  });

  test("has more than 10 languages", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(10);
  });
});
