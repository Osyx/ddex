import { describe, expect, test } from "bun:test";
import { truncate, renderBar } from "../../src/display.js";

describe("truncate", () => {
  test("leaves short strings unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });
  test("truncates at exact limit with ellipsis", () => {
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
  });
  test("does not truncate when exactly at limit", () => {
    expect(truncate("abcde", 5)).toBe("abcde");
  });
  test("handles maxLen of 1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });
  test("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });
});

describe("renderBar", () => {
  test("returns empty string for zero max", () => {
    expect(renderBar(5, 0, 20)).toBe("");
  });
  test("full bar at max value", () => {
    expect(renderBar(10, 10, 10)).toBe("█".repeat(10));
  });
  test("half bar at half value", () => {
    expect(renderBar(5, 10, 10)).toBe("█".repeat(5));
  });
  test("very small value rounds to zero bars", () => {
    expect(renderBar(1, 10000, 10).length).toBe(0);
  });
});
