# AGENTS.md — ddex (Discord Data Explorer)

This file is for AI agents and contributors. It documents project conventions, architecture decisions, and the patterns to follow when making changes.

---

## Project identity

- **Name**: Discord Data Explorer / **ddex**
- **Binary**: `ddex` (or `ddex.exe` on Windows)
- **Purpose**: Offline CLI tool that analyses a Discord GDPR data export. No network calls; all processing is local.
- **Runtime**: [Bun](https://bun.sh) ≥ 1.3, TypeScript, compiled to a self-contained standalone binary.
- **License**: GPL-3.0

---

## Build & test commands

```sh
bun install                  # install dependencies
bun run build                # compile binary for current platform → ./ddex
bun run test                 # unit tests only
bun run test:integration     # build binary then run integration tests
bun run ci                   # format:check + lint + unit tests + integration tests
bun run check                # oxlint type-aware lint + type-check
bun run format               # auto-format with oxfmt
bun run format:check         # check formatting without writing
```

> **Before merging**: `bun run ci` must pass. The pre-commit hook runs `oxfmt --check` automatically via lefthook.

Cross-platform build targets (output → `dist/`):

```sh
bun run build:all            # all five platforms
bun run build:linux-x64
bun run build:macos-arm64
bun run build:windows-x64
# etc.
```

---

## Repository layout

```
src/
  index.ts        CLI entry point — argument parsing, subcommand dispatch, help text
  cmd.ts          Shared CLI utilities: showHelp(), exitError(), requireExportPath()
  extractor.ts    ZIP detection, extraction to temp dir, path-traversal guard
  parser.ts       Walk Messages/c*/messages.json, parse arrays, yield message objects
  tokenizer.ts    Strip Discord noise (mentions, URLs, emoji, markdown), tokenise words
  stopwords.ts    Stop-word filtering (62 languages via the stopword package)
  db.ts           SQLite-backed word frequency store (bun:sqlite, in-memory)
  grouper.ts      Phonetic + Levenshtein fuzzy word clustering
  formatter.ts    Console and file output formatting
  progress.ts     TTY-aware progress reporter (writes to stderr)
  predictor.ts    Locate + stream the analytics JSONL file; extract demographic predictions
  types.ts        Shared TypeScript interfaces

tests/
  unit/           One test file per source module
  integration/    binary.test.ts — builds the binary and tests it end-to-end
  fixtures/
    export/       Minimal Discord export directory for words/integration tests
    analytics/    Minimal analytics JSONL fixture for prediction tests
```

---

## Subcommand pattern

Each subcommand follows this convention:

| Piece | Location | Notes |
|-------|----------|-------|
| Logic | `src/<command>.ts` | Analysis + formatting; exports a `run<Command>Cmd(args)` function |
| Route | `src/index.ts` | `else if (cmd === "<command>") await run<Command>Cmd(rest)` |
| Help text | `src/index.ts` | `const <COMMAND>_HELP = \`...\`.trim()` constant at the top |
| Unit tests | `tests/unit/<command>.test.ts` | Test exported functions in isolation |
| Integration | `tests/integration/binary.test.ts` | Add cases that invoke the compiled binary |
| Fixtures | `tests/fixtures/` | Minimal JSON data; all fixtures are JSON (no CSV) |
| Docs | `README.md` | Add usage docs under a `### \`ddex <command>\`` heading |

### Shared utilities (`src/cmd.ts`)

```typescript
showHelp(helpText: string): never          // print help and exit 0
exitError(msg: string, help?: string): never // print error to stderr and exit 1
requireExportPath(args, helpText): string  // extract positional path arg, handle --help
```

Use these in every subcommand — do not call `process.exit` or `console.error` directly.

### Export resolution

All subcommands that accept an export path call:

```typescript
const { exportDir, cleanup } = await resolveExport(exportPath, prog);
try {
  // ... use exportDir ...
} finally {
  cleanup();
}
```

`resolveExport` handles both directory exports and `.zip` files (extracts to a temp dir).

> **Important**: `resolveExport` currently only extracts `*/messages.json` from ZIPs. For new commands needing other files (`user.json`, `Servers/index.json`, analytics), it must be generalised with a filter predicate before those commands will work with ZIP inputs.

---

## Commit conventions

- **Format**: [Conventional Commits](https://www.conventionalcommits.org/) — `type: short description`
- **One-liner only** — no body, no bullet points, no extended description
- **Common types**: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`

Examples of correct commit messages:
```
feat: add servers subcommand
fix: handle missing analytics file gracefully
refactor: extract voice session pairing to analytics.ts
```

---

## Code style

- **TypeScript** — strict types throughout; avoid `any`; prefer `unknown` with narrowing
- **Formatting**: `oxfmt` (auto-checked by pre-commit hook; run `bun run format` to fix)
- **Linting**: `oxlint` with type-aware rules (`bun run check`)
- **No `console.error`/`process.exit` in subcommand logic** — use `cmd.ts` utilities
- **Comments**: only where the logic needs clarification; do not describe what is obvious

---

## Architecture decisions

### Offline-first

ddex makes **no network calls** by default. The planned `ddex enrich` subcommand will be the only exception, and it must be explicitly invoked by the user.

### Standalone binary

`bun build --compile --minify` produces a self-contained binary. This means:
- Keep dependencies minimal — every package adds to binary size
- Prefer Bun built-ins (`bun:sqlite`, `Bun.file`, `Bun.sleep`) over npm packages
- Do not add a full Discord.js library; use `discord-api-types` for types only

### JSON-only

Discord exports are JSON-only. CSV support was dropped entirely. All test fixtures are `.json`.

### Single-pass multi-analyzer engine (for new commands)

Rather than re-reading message files once per command, the planned architecture is:

```typescript
analyzeMessages(exportDir, analyzers[], progress)
  → for each message row → call all registered analyzer functions
```

`stats` registers all analyzers and runs them in one pass. Concurrently:

```typescript
const [msgResults, analyticsResults] = await Promise.all([
  analyzeMessages(exportDir, messageAnalyzers, prog),
  scanAnalytics(analyticsPath, analyticsCollectors, prog),
]);
```

### Analytics streaming pattern

The analytics file can be 6+ GB. Follow the pattern established in `predictor.ts`:

1. String `includes()` pre-check before `JSON.parse` — skip irrelevant lines cheaply
2. Line-by-line streaming via `readline` — constant memory
3. Early-exit once all targets are found (where applicable)

For multi-event analytics scanners, build an `event_type → collectors[]` dispatch map so each line is only parsed once regardless of how many event types are registered.

### In-memory SQLite for accumulation

Use `bun:sqlite` in-memory databases for accumulating counts during analysis (see `db.ts`). Batch inserts in transactions. Do not use disk-backed SQLite unless implementing a future persistent cache.

---

## Discord export format — quick reference

### File structure

```
Account/user.json          → id, username, email, avatar_hash, relationships[], payments[]
Activity/Analytics/
  events-YYYY-00000-of-00001.json  → JSONL analytics (one JSON object per line)
Messages/
  index.json               → { channel_id: "Direct Message with X" | "channel-name" | null }
  c<channel_id>/
    channel.json           → { recipients: [id1, id2] } (DM) | { guild: {id, name} } (server)
    messages.json          → array of { ID, Timestamp, Contents, Attachments }
Servers/
  index.json               → { guild_id: "Server Name" }
  <guild_id>/guild.json    → (present but content unconfirmed; not needed for current commands)
```

> **Localization**: root folder names may be translated (e.g. `Compte/` in French). Always use case-insensitive regex for path discovery — never hardcode `Account/`, `Messages/`, etc.

### Key schema facts

- `messages.json` contains **only the requesting user's messages** — no author field, no received messages
- `Timestamp` and `Contents` keys are capitalized; so are `ID` and `Attachments`
- `payments[].amount` is in **cents** (INTEGER) — divide by 100 to display
- Relationship `avatar` is nested as `relationship.user.avatar` (not `avatar_hash`)
- DM channel: `channel.json` has `recipients` array; exactly 2 = 1:1 DM; ≠2 = group DM (skip)
- Server channel: `channel.json` has `guild: {id, name}` instead of `recipients`

### Analytics JSONL

- One JSON object per line; not a JSON array
- **Timestamp quirk**: values have a leading `"` inside the string — parse from index 1: `ts.slice(1)`
- Regular timestamps (e.g. `payments[].created_at`) are standard ISO 8601 — no quirk
- For voice events, prefer `client_track_timestamp` over `timestamp`; fall back if value is the string `"null"`

### Analytics event types

| Event | Key fields | Purpose |
|-------|-----------|---------|
| `join_voice_channel` / `leave_voice_channel` | `channel_id`, `guild_id`, `client_track_timestamp` | Voice session duration (pair join→leave; discard >24 h) |
| `session_start` / `session_end` | `timestamp`, `os` | App session duration + OS breakdown |
| `guild_joined` | `guild_id` | Guild join count |
| `add_reaction` | `channel_id`, `emoji_name`, `emoji_id` | Reactions given; custom if `emoji_id` present |
| `application_command_used` | `application_id`, `guild_id` | Bot/slash command usage |
| `app_opened` | `os` | App open count + OS |
| `notification_clicked` | — | Notification clicks |
| Simple counters | — | `email_opened`, `login_successful`, `user_avatar_updated`, `app_crashed`, `oauth2_authorize_accepted`, `remote_auth_login`, `captcha_served`, `voice_message_recorded`, `message_reported`, `message_edited`, `premium_upsell_viewed` |

`message_sent` is **synthetic** — generated, not from the analytics file.

### What does NOT exist in the export

- Messages received from other users
- Reactions received
- Incoming vs. outgoing call distinction
- `Activities/`, `Ads/`, `Programs/` — not useful for ddex

---

## Planned subcommands (see PLAN.md)

The following subcommands are planned but not yet implemented. PLAN.md has full specs.

| Command | Summary |
|---------|---------|
| `ddex people` | Social graph: friends, DM partners, top DM contacts, voice call hours |
| `ddex spent` | Money spent on Discord (from `payments[]`) |
| `ddex servers` | Top servers and channels by message count; voice channel time |
| `ddex time` | Message heatmap, notification clicks, session stats, OS breakdown |
| `ddex emojis` | Top emojis in messages + reactions given |
| `ddex attachments` | Attachment counts per channel (format TBD — field unconfirmed) |
| `ddex stats` | Single-pass summary dashboard across all the above |
| `ddex enrich` | Online enrichment: resolve user IDs via Discord bot token; cache CDN images |
