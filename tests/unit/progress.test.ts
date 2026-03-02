import { describe, expect, test } from "bun:test";
import { createProgress } from "../../src/progress.js";

const captureStderr = (fn: () => void): string[] => {
  const captured: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s: string) => {
    captured.push(s);
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
};

describe("createProgress", () => {
  test("phase() writes '▶ <msg>...\\n' to stderr", () => {
    const prog = createProgress();
    const captured = captureStderr(() => prog.phase("Loading"));
    expect(captured).toEqual(["▶ Loading...\n"]);
  });

  test("done() writes '✓ <msg>\\n' to stderr", () => {
    const prog = createProgress();
    const captured = captureStderr(() => prog.done("Finished"));
    // TTY mode prefixes \r; non-TTY doesn't — both end with "✓ Finished\n"
    expect(captured[0]).toContain("✓ Finished\n");
  });

  test("error() writes '✗ <msg>\\n' to stderr", () => {
    const prog = createProgress();
    const captured = captureStderr(() => prog.error("Something went wrong"));
    expect(captured).toEqual(["✗ Something went wrong\n"]);
  });

  test("update() in non-TTY mode writes '<msg>\\n' to stderr", () => {
    // process.stderr.isTTY is falsy in test environment
    const prog = createProgress();
    const captured = captureStderr(() => prog.update("Progress 50%"));
    // In non-TTY mode the module-level isTTY is false, so plain line is written
    expect(captured[0]).toContain("Progress 50%");
  });
});
