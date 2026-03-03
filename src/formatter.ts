import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { WordGroup } from "./types.js";
import { termWidth, truncate } from "./display.js";

const formatVariants = (variants: WordGroup["variants"]): string => {
  return variants.map((v) => `${v.word}×${v.count}`).join("  ");
};

export const formatConsole = (groups: WordGroup[], totalMessages: number): string => {
  const width = termWidth();
  const lines: string[] = [
    `\nTop ${groups.length} words (${totalMessages.toLocaleString()} messages processed)\n`,
  ];

  groups.forEach((g, i) => {
    const rank = String(i + 1).padStart(2, " ");
    const canonical = g.canonical.padEnd(16, " ");
    const prefix = `${rank}. ${canonical} (total: ${g.total})   variants: `;
    const variantsStr = formatVariants(g.variants);
    const full = prefix + variantsStr;
    lines.push(truncate(full, width));
  });

  return lines.join("\n");
};

export const writeOutput = (filePath: string, groups: WordGroup[], totalMessages: number): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  if (filePath.endsWith(".json")) {
    const data = { totalMessages, groups };
    writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } else {
    writeFileSync(filePath, formatConsole(groups, totalMessages), "utf-8");
  }
};
