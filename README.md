# Discord Data Explorer

Offline CLI tool (`ddex`) that analyses a Discord GDPR data export and reports the words you type most often.
Similar-sounding words (e.g. `haha`, `hahah`, `hahsha`) are automatically clustered together.

All processing is entirely local, no network calls are made.

## Download

Pre-built standalone binaries are available on the [releases page](../../releases). No runtime or dependencies required: just download and run.

Releases are created automatically when a new version is merged. Each release includes a `CHANGELOG.md` entry describing what changed.

| Platform            | File                    |
| ------------------- | ----------------------- |
| Linux x64           | `ddex-linux-x64`        |
| Linux ARM64         | `ddex-linux-arm64`      |
| macOS Intel         | `ddex-macos-x64`        |
| macOS Apple Silicon | `ddex-macos-arm64`      |
| Windows x64         | `ddex-windows-x64.exe`  |

On macOS/Linux you may need to mark the binary as executable:

```sh
chmod +x ddex-*
```

## Getting your Discord data package

1. Open Discord → **User Settings** → **Data & Privacy** → **Request Your Data**
2. Discord emails you a download link (usually within 30 days)
3. Download the `.zip`: pass it directly to `ddex`

> **Your files are never modified.**
> If a `.zip` is provided it is extracted to a temporary directory which is deleted immediately after processing.

## Usage

```
ddex <command> [options]

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
```

### `ddex words`

```
ddex words <path-to-export> [options]

Arguments:
  path-to-export          Path to your Discord data package.
                          Accepts a directory (unzipped export) or a .zip file.

Options:
  --top <n>               Show top N word groups (default: 10)
  --include-stop-words    Include stop words in results (filtered by default)
  --language <codes>      Comma-separated stop-word language codes (default: eng)
                          Supports 62 languages, e.g. eng, swe, deu, fra
  --output <file>         Write results to a file (.json for JSON, anything else for plain text)
  --help, -h              Show this help message
```

### Examples

```sh
# Show top 20 words
ddex words ~/Downloads/package.zip --top 20

# Pass an already-unzipped export directory
ddex words ~/Downloads/package/ --top 20

# Save results to a JSON file
ddex words ~/Downloads/package.zip --output results.json

# Filter stop words for both English and Swedish
ddex words ~/Downloads/package.zip --language eng,swe

# Include stop words (the, a, is, …) in the results
ddex words ~/Downloads/package.zip --include-stop-words
```

### `ddex prediction`

```
ddex prediction <path-to-export>

Arguments:
  path-to-export   Path to your Discord data package.
                   Accepts a directory (unzipped export) or a .zip file.

Options:
  --help, -h       Show this help message
```

Example output:

```
Discord's demographic predictions
──────────────────────────────────
Age group:  25-34      (72.3% confidence)
Gender:     male       (89.2% confidence)
```

Example usage:

```sh
ddex prediction ~/Downloads/package.zip
ddex prediction ~/Downloads/package/
```

### `ddex spent`

Show how much you have spent on Discord (Nitro, gifts, store purchases).

```sh
ddex spent ~/Downloads/package.zip
```

### `ddex people`

Show your social graph: friend count, DM partner count, top DM contacts, and voice call statistics.

```sh
ddex people ~/Downloads/package.zip
```

### `ddex servers`

Show server and channel activity: top servers and text channels by message count, top voice channels by time.

```sh
ddex servers ~/Downloads/package.zip
```

### `ddex time`

Show temporal activity patterns: message heatmap by day/hour, monthly activity, session stats and OS breakdown.

```sh
ddex time ~/Downloads/package.zip
```

### `ddex emojis`

Show your most-used emojis in messages and reactions given (from analytics).

```sh
ddex emojis ~/Downloads/package.zip
```

### `ddex attachments`

Show attachment activity: total attachments sent and top channels by attachment count.

```sh
ddex attachments ~/Downloads/package.zip
```

### `ddex stats`

Show a full summary dashboard aggregating highlights from all other commands in a single pass.

```sh
ddex stats ~/Downloads/package.zip
```

---

## Development

### Requirements

- [Bun](https://bun.sh) ≥ 1.3

### Setup

```sh
git clone https://github.com/Osyx/ddex.git
cd ddex
bun install
```

### Building

**For your current platform:**

```sh
bun run build
```

**Cross-platform builds** (output goes to `dist/`):

```sh
bun run build:linux-x64      # Linux x64
bun run build:linux-arm64    # Linux ARM64 (e.g. Raspberry Pi, AWS Graviton)
bun run build:macos-x64      # macOS Intel
bun run build:macos-arm64    # macOS Apple Silicon (M1/M2/M3)
bun run build:windows-x64    # Windows x64 (.exe)
bun run build:all            # All of the above
```

The resulting binaries are fully standalone.

### Scripts

| Script                      | Description                                     |
| --------------------------- | ----------------------------------------------- |
| `bun run ci`                | Run all checks and tests (format, lint, unit, integration) |
| `bun run test`              | Run unit tests                                  |
| `bun run test:integration`  | Build binary and run integration tests          |
| `bun run check`             | Lint + type-check with oxlint                   |
| `bun run format`            | Format source files with oxfmt                  |
| `bun run format:check`      | Check formatting without writing changes        |
| `bun run build`             | Compile a binary for the current platform       |
| `bun run build:linux-x64`   | Cross-compile for Linux x64 → `dist/`           |
| `bun run build:linux-arm64` | Cross-compile for Linux ARM64 → `dist/`         |
| `bun run build:macos-x64`   | Cross-compile for macOS Intel → `dist/`         |
| `bun run build:macos-arm64` | Cross-compile for macOS Apple Silicon → `dist/` |
| `bun run build:windows-x64` | Cross-compile for Windows x64 → `dist/`         |
| `bun run build:all`         | Build for all platforms → `dist/`               |

### How it works

1. **Extract**: if the input is a `.zip`, it is extracted to a temp directory
2. **Parse**: every `messages/c*/messages.json` file in the export is parsed
3. **Tokenise**: Discord mentions, URLs, emoji, and markdown are stripped; text is lowercased and split into words (≥ 2 chars, non-numeric)
4. **Count**: word frequencies are accumulated in an in-memory SQLite database, so memory usage stays flat regardless of message history size
5. **Filter**: stop words are removed using the [`stopword`](https://www.npmjs.com/package/stopword) package (62 languages supported, default: `eng`)
6. **Cluster**: words are grouped by Double Metaphone phonetic key, then further merged by Levenshtein edit distance (threshold: `max(1, floor(len/3))`)
7. **Output**: groups are ranked by total count; the most frequent variant is used as the display name

### Project structure

```
src/
  index.ts        CLI entry point, argument parsing, and command dispatch
  cmd.ts          Shared CLI utilities
  extractor.ts    ZIP detection and extraction to temp dir
  parser.ts       Walk export directory, parse messages.json files
  tokenizer.ts    Strip noise, split into word tokens
  stopwords.ts    Stop-word filtering via the stopword package (62 languages)
  db.ts           SQLite-backed word frequency store (bun:sqlite)
  grouper.ts      Phonetic + edit-distance fuzzy clustering
  formatter.ts    Console and file output formatting
  progress.ts     TTY-aware progress reporter (writes to stderr)
  predictor.ts    Locate and stream the analytics events file; extract demographic predictions
  analyze.ts      Single-pass multi-analyzer engine for message files
  analytics.ts    Analytics JSONL streaming and collector dispatch
  metadata.ts     Load user.json, channel.json, and index files
  spent.ts        Discord spending summary from payment records
  people.ts       Social graph and DM partner statistics
  servers.ts      Server and channel activity statistics
  time.ts         Temporal activity patterns (heatmap, session stats)
  emojis.ts       Emoji usage in messages and reactions from analytics
  attachments.ts  Attachment activity per channel
  stats.ts        Single-pass summary dashboard aggregating all analyzers
  types.ts        Shared TypeScript interfaces
```

### CI / GitHub Actions

#### `test.yml`: Automated tests

Runs `bun test` (unit tests) on every pull request. Add this as a **required status check** in your branch protection rules (**Settings → Branches → Branch protection rules → Require status checks → `test`**) to enforce that all tests must pass before merging.

#### `binary-test.yml`: Binary integration tests

Runs on every pull request using a matrix of three runners (`ubuntu-latest`, `macos-latest`, `windows-latest`). Each runner builds the platform-specific binary and runs `bun run test:binary` against the test fixture to verify the compiled binary works end-to-end on that OS. Add the `binary-test (ubuntu-latest)`, `binary-test (macos-latest)`, and `binary-test (windows-latest)` jobs as required status checks to enforce cross-platform correctness before merging.

#### `release.yml`: Automated releases

Triggered on every push to `main`.

1. **release-please** analyses conventional commits since the last release and creates (or updates) a _Release PR_ that bumps `package.json` / `CHANGELOG.md` to the next semantic version.
2. When that Release PR is merged, **release-please** tags the commit and creates a GitHub Release.
3. The **build** job then compiles all five platform binaries and uploads them as assets to that release.

**no build runs on regular pushes to `main`**.

Version increments follow [Conventional Commits](https://www.conventionalcommits.org/):

| Commit prefix                 | Version bump |
| ----------------------------- | ------------ |
| `fix:`                        | patch        |
| `feat:`                       | minor        |
| `feat!:` / `BREAKING CHANGE:` | major        |

#### `conventional-commits.yml`: Commit linting

Runs on every pull request and direct push to `main`. Uses `commitlint` with the `@commitlint/config-conventional` preset to reject commits that do not follow the conventional commits format.

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `perf`, `revert`.

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0).

You are free to use, share, and modify this software, provided that:

- **Attribution**: you give appropriate credit and link back to this project
- **ShareAlike**: any derivative work is distributed under the same licence (GPL-3.0 or later)
- **Source disclosure**: if you distribute the software, you must make the full source code available
