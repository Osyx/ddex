/** Prints help to stdout and exits 0. */
export const showHelp = (helpText: string): never => {
  console.log(helpText);
  process.exit(0);
};

/** Prints an error message (and optional help) to stderr and exits 1. */
export const exitError = (msg: string, helpText?: string): never => {
  console.error(msg);
  if (helpText) console.error(helpText);
  process.exit(1);
};

/**
 * Finds the export path in a subcommand's args, handling --help/-h and
 * the missing-path error. For use in subcommands whose only positional
 * argument is the export path.
 */
export const requireExportPath = (args: string[], helpText: string): string => {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") showHelp(helpText);
  }
  const path =
    args.find((a) => !a.startsWith("-")) ??
    exitError("Error: path-to-export is required\n", helpText);
  return path;
};
