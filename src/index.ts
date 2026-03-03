#!/usr/bin/env bun
import { parseExport } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { isStopWord, buildStopWordSet, SUPPORTED_LANGUAGES } from "./stopwords.js";
import { cluster } from "./grouper.js";
import { formatConsole, writeOutput } from "./formatter.js";
import { createWordDb } from "./db.js";
import { resolveExport, ExportFilter } from "./extractor.js";
import { runPrediction } from "./predictor.js";
import { runSpent } from "./spent.js";
import { runPeople } from "./people.js";
import { runServers } from "./servers.js";
import { runTime } from "./time.js";
import { runEmojis } from "./emojis.js";
import { runAttachments } from "./attachments.js";
import { runStats } from "./stats.js";
import { createProgress } from "./progress.js";
import { showHelp, exitError, requireExportPath } from "./cmd.js";
import { version } from "../package.json";

const HELP = `
Usage: ddex <command> [options]

Commands:
  words        Analyse your most-used words in a Discord export
  prediction   Show Discord's predicted age group and gender
  spent        Show how much you have spent on Discord
  people       Show your social graph and DM statistics
  servers      Show your server and channel activity
  time         Show your temporal activity patterns
  emojis       Show your emoji usage and reactions
  attachments  Show your attachment activity
  stats        Show a full summary dashboard of your Discord activity

Options:
  --version, -V   Print version and exit
  --help, -h      Show this help message
`.trim();

const WORDS_HELP = `
Usage: ddex words <path-to-export> [options]

Arguments:
  path-to-export          Path to your Discord data package.
                          Accepts a directory (unzipped export) or a .zip file.

Options:
  --top <n>               Show top N word groups (default: 10)
  --include-stop-words    Include stop words in results (filtered by default)
  --language <codes>      Comma-separated stop-word language codes (default: eng)
                          Supported: ${SUPPORTED_LANGUAGES.join(", ")}
  --output <file>         Also write results to a file (JSON or plain text based on extension)
  --help, -h              Show this help message
`.trim();

const PREDICTION_HELP = `
Usage: ddex prediction <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const SPENT_HELP = `
Usage: ddex spent <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const PEOPLE_HELP = `
Usage: ddex people <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const SERVERS_HELP = `
Usage: ddex servers <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const TIME_HELP = `
Usage: ddex time <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const EMOJIS_HELP = `
Usage: ddex emojis <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const ATTACHMENTS_HELP = `
Usage: ddex attachments <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const STATS_HELP = `
Usage: ddex stats <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
`.trim();

const parseWordsArgs = (args: string[]) => {
  let exportPath: string | undefined;
  let top = 10;
  let filterStopWords = true;
  let languages = ["eng"];
  let outputFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      showHelp(WORDS_HELP);
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
      exitError(`Unknown option: ${arg}`, WORDS_HELP);
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
    exitError("Error: path-to-export is required\n", WORDS_HELP);
  }

  return { exportPath, top, filterStopWords, languages, outputFile };
};

const runWords = async (args: string[]) => {
  const { exportPath, top, filterStopWords, languages, outputFile } = parseWordsArgs(args);
  const prog = createProgress();
  const stopWords = filterStopWords ? buildStopWordSet(languages) : new Set<string>();

  const { exportDir, cleanup } = await resolveExport(exportPath, prog, ExportFilter.messages);

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

const runPredictionCmd = async (args: string[]) => {
  const exportPath = requireExportPath(args, PREDICTION_HELP);

  const prog = createProgress();
  const result = await runPrediction(exportPath, prog);

  const lines = ["\nDiscord's demographic predictions", "─".repeat(34)];

  if (result.age) {
    const pct = (result.age.probability * 100).toFixed(1);
    lines.push(`Age group:  ${result.age.value.padEnd(10)} (${pct}% confidence)`);
  } else {
    lines.push("Age group:  not found");
  }

  if (result.gender) {
    const pct = (result.gender.probability * 100).toFixed(1);
    lines.push(`Gender:     ${result.gender.value.padEnd(10)} (${pct}% confidence)`);
  } else {
    lines.push("Gender:     not found");
  }

  console.log(lines.join("\n"));
};

const main = async () => {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.error(HELP);
    process.exit(1);
  }

  if (cmd === "--help" || cmd === "-h") {
    showHelp(HELP);
  }

  if (cmd === "--version" || cmd === "-V") {
    console.log(version);
    process.exit(0);
  }

  if (cmd === "words") {
    await runWords(args.slice(1));
    return;
  }

  if (cmd === "prediction") {
    await runPredictionCmd(args.slice(1));
    return;
  }

  if (cmd === "spent") {
    const exportPath = requireExportPath(args.slice(1), SPENT_HELP);
    const prog = createProgress();
    await runSpent(exportPath, prog);
    return;
  }

  if (cmd === "people") {
    const exportPath = requireExportPath(args.slice(1), PEOPLE_HELP);
    const prog = createProgress();
    await runPeople(exportPath, prog);
    return;
  }

  if (cmd === "servers") {
    const exportPath = requireExportPath(args.slice(1), SERVERS_HELP);
    const prog = createProgress();
    await runServers(exportPath, prog);
    return;
  }

  if (cmd === "time") {
    const exportPath = requireExportPath(args.slice(1), TIME_HELP);
    const prog = createProgress();
    await runTime(exportPath, prog);
    return;
  }

  if (cmd === "emojis") {
    const exportPath = requireExportPath(args.slice(1), EMOJIS_HELP);
    const prog = createProgress();
    await runEmojis(exportPath, prog);
    return;
  }

  if (cmd === "attachments") {
    const exportPath = requireExportPath(args.slice(1), ATTACHMENTS_HELP);
    const prog = createProgress();
    await runAttachments(exportPath, prog);
    return;
  }

  if (cmd === "stats") {
    const exportPath = requireExportPath(args.slice(1), STATS_HELP);
    const prog = createProgress();
    await runStats(exportPath, prog);
    return;
  }

  exitError(`Unknown command: ${cmd}\n`, HELP);
};

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
