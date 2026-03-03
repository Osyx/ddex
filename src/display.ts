/** Returns the terminal width, defaulting to 80 if not a TTY or unavailable. */
export const termWidth = (): number => process.stdout.columns || 80;

/**
 * Truncates a string to fit within `maxLen` characters.
 * If truncated, replaces the last character with `…`.
 */
export const truncate = (str: string, maxLen: number): string => {
  if (maxLen < 1) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
};

/** Prints an array of lines to stdout, each truncated to the terminal width. */
export const printOutput = (lines: string[]): void => {
  const w = termWidth();
  console.log(lines.map((l) => truncate(l, w)).join("\n"));
};

/**
 * Returns a horizontal rule string scaled to the terminal width.
 * @param char The character to repeat (default: "─")
 * @param maxWidth Cap the rule at this width (default: terminal width)
 */
export const rule = (char = "─", maxWidth?: number): string => {
  const w = Math.min(termWidth(), maxWidth ?? Infinity);
  return char.repeat(Math.max(1, w));
};

/**
 * Builds an ASCII bar of block characters scaled to `maxBarWidth`.
 * @param value The value for this bar
 * @param maxValue The maximum value (bar for this = full width)
 * @param maxBarWidth Maximum bar width in characters
 */
export const renderBar = (value: number, maxValue: number, maxBarWidth: number): string => {
  if (maxValue === 0) return "";
  const len = Math.round((value / maxValue) * maxBarWidth);
  return "█".repeat(Math.max(0, len));
};
