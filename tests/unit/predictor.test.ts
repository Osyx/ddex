import { describe, expect, test } from "bun:test";
import { join } from "path";
import { findPrediction, findEventsFile, runPrediction } from "../../src/predictor.js";
import { createProgress } from "../../src/progress.js";

const FIXTURE_DIR = join(import.meta.dirname, "../fixtures/analytics");

// ─── findPrediction ────────────────────────────────────────────────────────────

describe("findPrediction", () => {
  test("returns null for non-object input", () => {
    expect(findPrediction(null, "predicted_age")).toBeNull();
    expect(findPrediction("string", "predicted_age")).toBeNull();
    expect(findPrediction(42, "predicted_age")).toBeNull();
  });

  test("extracts prediction from top-level object", () => {
    const obj = { predicted_age: "25-34", probability: 0.7234567890123456 };
    const result = findPrediction(obj, "predicted_age");
    expect(result).not.toBeNull();
    expect(result?.value).toBe("25-34");
    expect(result?.probability).toBeCloseTo(0.7234567890123456);
  });

  test("extracts prediction from nested object", () => {
    const obj = {
      event_type: "analytics",
      payload: { predicted_age: "18-24", probability: 0.65 },
    };
    const result = findPrediction(obj, "predicted_age");
    expect(result?.value).toBe("18-24");
    expect(result?.probability).toBeCloseTo(0.65);
  });

  test("extracts prediction from inside an array", () => {
    const obj = [{ event: "other" }, { predicted_gender: "female", probability: 0.91 }];
    const result = findPrediction(obj, "predicted_gender");
    expect(result?.value).toBe("female");
    expect(result?.probability).toBeCloseTo(0.91);
  });

  test("returns null when target key is missing", () => {
    const obj = { something_else: "25-34", probability: 0.8 };
    expect(findPrediction(obj, "predicted_age")).toBeNull();
  });

  test("returns null when probability is missing", () => {
    const obj = { predicted_age: "25-34" };
    expect(findPrediction(obj, "predicted_age")).toBeNull();
  });
});

// ─── findEventsFile ─────────────────────────────────────────────────────────────

describe("findEventsFile", () => {
  test("finds the events file in the fixture directory", () => {
    const result = findEventsFile(FIXTURE_DIR);
    expect(result).not.toBeUndefined();
    expect(result).toMatch(/events-\d{4}-00000-of-00001\.json$/i);
  });

  test("returns undefined when no package dir exists", () => {
    expect(findEventsFile("/tmp")).toBeUndefined();
  });

  test("returns undefined for a non-existent path", () => {
    expect(findEventsFile("/nonexistent/path")).toBeUndefined();
  });
});

// ─── runPrediction ─────────────────────────────────────────────────────────────

describe("runPrediction", () => {
  test("extracts age and gender from fixture directory", async () => {
    const prog = createProgress();
    const result = await runPrediction(FIXTURE_DIR, prog);
    expect(result.age).not.toBeNull();
    expect(result.age?.value).toBe("25-34");
    expect(result.age?.probability).toBeCloseTo(0.7234567890123456);
    expect(result.gender).not.toBeNull();
    expect(result.gender?.value).toBe("male");
    expect(result.gender?.probability).toBeCloseTo(0.8923456789012345);
  });

  test("throws when path does not exist", async () => {
    const prog = createProgress();
    await expect(runPrediction("/nonexistent/path", prog)).rejects.toThrow("Path not found");
  });

  test("throws when analytics file is missing from directory", async () => {
    const prog = createProgress();
    await expect(runPrediction(import.meta.dirname, prog)).rejects.toThrow(
      "Analytics events file not found",
    );
  });

  test("throws for non-directory non-zip input", async () => {
    const prog = createProgress();
    const eventsFile = join(
      FIXTURE_DIR,
      "package/Activity/analytics/events-2025-00000-of-00001.json",
    );
    await expect(runPrediction(eventsFile, prog)).rejects.toThrow(
      "must be a directory or a .zip file",
    );
  });
});
