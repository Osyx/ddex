# Contributing to Discord Data Explorer

Thank you for your interest in contributing! This document explains how to get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3

## Fork and clone

1. Fork the repository on GitHub.
2. Clone your fork:

```sh
git clone https://github.com/<your-username>/ddex.git
cd ddex
```

3. Add the upstream remote:

```sh
git remote add upstream https://github.com/Osyx/ddex.git
```

## Install dependencies

```sh
bun install
```

## Development workflow

Run the CLI directly without compiling:

```sh
bun run src/index.ts
```

## Running tests

Unit tests:

```sh
bun run test
```

Integration tests (builds the binary first, then runs end-to-end tests):

```sh
bun run test:integration
```

Or run everything at once (format check, lint, unit tests, integration tests):

```sh
bun run ci
```

## Linting and formatting

Lint + type-check with [oxlint](https://oxlint.rs):

```sh
bun run check
```

Format source files with [oxfmt](https://github.com/nicolo-ribaudo/oxfmt):

```sh
bun run format
```

## Commit message format

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Commit messages **must** follow this format because [release-please](https://github.com/googleapis/release-please) reads them to determine the next version and generate the changelog automatically.

```
<type>(<optional scope>): <short description>
```

Accepted types:

| Type       | When to use                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | A new feature (triggers a minor version bump)    |
| `fix`      | A bug fix (triggers a patch version bump)        |
| `docs`     | Documentation-only changes                       |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests                         |
| `chore`    | Maintenance tasks (deps, tooling, config)        |
| `ci`       | Changes to CI/CD workflows                       |
| `perf`     | Performance improvements                         |
| `revert`   | Revert a previous commit                         |

Breaking changes: append `!` after the type or add `BREAKING CHANGE:` in the footer. This triggers a major version bump.

Examples:

```
feat: add --min-count flag to filter low-frequency words
fix: handle ZIP files with non-UTF-8 filenames
docs: update README with new --language examples
feat!: rename --top flag to --limit
```

A [commitlint](https://commitlint.js.org) check runs on every pull request and will block merging if the commit messages do not conform.

## Pull request process

1. Branch from `main`:

```sh
git checkout -b feat/my-new-feature
```

2. Make your changes, keeping commits small and focused.
3. Ensure all CI checks pass locally before opening a PR:

```sh
bun run ci
```

4. Open a pull request against `main`. Fill in the PR template.
5. All required CI checks must pass before merging.

## Building binaries

> These are built automatically for releases, but if you want to build your own, see below.

Build for your current platform:

```sh
bun run build
```

Cross-platform builds (output goes to `dist/`):

```sh
bun run build:linux-x64      # Linux x64
bun run build:linux-arm64    # Linux ARM64
bun run build:macos-x64      # macOS Intel
bun run build:macos-arm64    # macOS Apple Silicon
bun run build:windows-x64    # Windows x64 (.exe)
bun run build:all            # All of the above
```
