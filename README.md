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
ddex <path-to-export> [options]

Arguments:
  path-to-export      Path to your Discord data package.
                      Accepts a directory (unzipped export) or a .zip file.

Options:
  --top <n>               Show top N word groups (default: 10)
  --include-stop-words    Include stop words in results (filtered by default)
  --language <codes>      Comma-separated stop-word language codes (default: eng)
                          Supports 62 languages, e.g. eng, swe, deu, fra
  --output <file>         Write results to a file (.json for JSON, anything else for plain text)
  --help                  Show this help message
```

### Examples

```sh
# Show top 20 words
ddex ~/Downloads/package.zip --top 20

# Pass an already-unzipped export directory
ddex ~/Downloads/package/ --top 20

# Save results to a JSON file
ddex ~/Downloads/package.zip --output results.json

# Filter stop words for both English and Swedish
ddex ~/Downloads/package.zip --language eng,swe

# Include stop words (the, a, is, …) in the results
ddex ~/Downloads/package.zip --include-stop-words
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
2. **Parse**: every `messages/c*/messages.csv` file in the export is streamed row by row
3. **Tokenise**: Discord mentions, URLs, emoji, and markdown are stripped; text is lowercased and split into words (≥ 2 chars, non-numeric)
4. **Count**: word frequencies are accumulated in an in-memory SQLite database, so memory usage stays flat regardless of message history size
5. **Filter**: stop words are removed using the [`stopword`](https://www.npmjs.com/package/stopword) package (62 languages supported, default: `eng`)
6. **Cluster**: words are grouped by Double Metaphone phonetic key, then further merged by Levenshtein edit distance (threshold: `max(1, floor(len/3))`)
7. **Output**: groups are ranked by total count; the most frequent variant is used as the display name

### Project structure

```
src/
  index.ts        CLI entry point and argument parsing
  extractor.ts    ZIP detection and extraction to temp dir
  parser.ts       Walk export directory, stream messages.csv files
  tokenizer.ts    Strip noise, split into word tokens
  stopwords.ts    Stop-word filtering via the stopword package (62 languages)
  db.ts           SQLite-backed word frequency store (bun:sqlite)
  grouper.ts      Phonetic + edit-distance fuzzy clustering
  formatter.ts    Console and file output formatting
  progress.ts     TTY-aware progress reporter (writes to stderr)
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
