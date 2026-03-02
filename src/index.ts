#!/usr/bin/env bun
import { parseExport } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { isStopWord, buildStopWordSet, SUPPORTED_LANGUAGES } from "./stopwords.js";
import { cluster } from "./grouper.js";
import { formatConsole, writeOutput } from "./formatter.js";
import { createWordDb } from "./db.js";
import { resolveExport } from "./extractor.js";
import { createProgress } from "./progress.js";
import { version } from "../package.json";

const HELP = `
Usage: discord-mcd <path-to-export> [options]

Options:
  --top <n>               Show top N word groups (default: 10)
  --include-stop-words    Include stop words in results (filtered by default)
  --language <codes>      Comma-separated stop-word language codes (default: eng)
                          Supported: ${SUPPORTED_LANGUAGES.join(", ")}
  --output <file>         Also write results to a file (JSON or plain text based on extension)
  --version, -V           Print version and exit
  --help                  Show this help message
`.trim();

const parseArgs = (argv: string[]) => {
  const args = argv.slice(2); // strip bun / node + script
  let exportPath: string | undefined;
  let top = 10;
  let filterStopWords = true;
  let languages = ["eng"];
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--version" || arg === "-V") {
      console.log(version);
      process.exit(0);
    } else if (arg === "--top") {
      const val = args[++i];
      const n = parseInt(val ?? "", 10);
      if (isNaN(n) || n < 1) {
        console.error("--top requires a positive integer");
        process.exit(1);
      }
      top = n;
    } else if (arg === "--include-stop-words") {
      filterStopWords = false;
    } else if (arg === "--language") {
      const val = args[++i];
      if (!val) {
        console.error("--language requires a comma-separated list of language codes");
        process.exit(1);
      }
      languages = val
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
    } else if (arg === "--output") {
      outputFile = args[++i];
      if (!outputFile) {
        console.error("--output requires a file path");
        process.exit(1);
      }
    } else if (!arg.startsWith("-")) {
      exportPath = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      console.error(HELP);
      process.exit(1);
    }
  }

  for (const lang of languages) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      console.error(
        `Unknown language code: "${lang}". Supported: ${SUPPORTED_LANGUAGES.join(", ")}`,
      );
      process.exit(1);
    }
  }

  if (!exportPath) {
    console.error("Error: path-to-export is required\n");
    console.error(HELP);
    process.exit(1);
  }

  return { exportPath, top, filterStopWords, languages, outputFile };
};

const main = async () => {
  const { exportPath, top, filterStopWords, languages, outputFile } = parseArgs(process.argv);
  const prog = createProgress();
  const stopWords = filterStopWords ? buildStopWordSet(languages) : new Set<string>();

  const { exportDir, cleanup } = await resolveExport(exportPath, prog);

  let cleaningUp = false;
  const handleExit = async () => {
    if (cleaningUp) return;
    cleaningUp = true;
    await cleanup();
  };
  process.once("SIGINT", () => {
    void handleExit().then(() => process.exit(1));
  });
  process.once("SIGTERM", () => {
    void handleExit().then(() => process.exit(1));
  });
  process.on("uncaughtException", (err) => {
    prog.error(err.message);
    void handleExit().then(() => process.exit(1));
  });

  const db = createWordDb(":memory:");

  try {
    const totalMessages = await parseExport(
      exportDir,
      (content) => {
        const tokens = tokenize(content);
        const filtered = filterStopWords ? tokens.filter((t) => !isStopWord(t, stopWords)) : tokens;
        db.addTokens(filtered);
      },
      prog,
    );

    prog.phase("Analysing patterns");
    const counts = db.getWordCounts();
    const groups = cluster(counts).slice(0, top);
    prog.done("Analysis complete");

    const output = formatConsole(groups, totalMessages);
    console.log(output);

    if (outputFile) {
      writeOutput(outputFile, groups, totalMessages);
      console.log(`\nResults also written to: ${outputFile}`);
    }
  } finally {
    db.close();
    await handleExit();
  }
};

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
