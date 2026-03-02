# Security Policy

## Offline-only tool

discord-mcd is a fully offline CLI tool. It reads files from your local disk and makes no network requests at any point. Your Discord data export never leaves your machine.

## Reporting a vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately using GitHub's built-in vulnerability reporting feature:

1. Go to [github.com/Osyx/discord-mcd/security/advisories/new](https://github.com/Osyx/discord-mcd/security/advisories/new), or
2. Navigate to the repository on GitHub, then: **Security** tab > **Advisories** > **Report a vulnerability**.

You will receive a response as soon as possible. Please include as much detail as you can: a description of the issue, steps to reproduce, and the potential impact.

## Scope

Because discord-mcd is a local CLI tool with no network access, the following are considered in scope for security reports:

- Vulnerabilities in dependencies that could be exploited via a crafted input file.
- Any behaviour that causes the tool to read from or write to locations outside of the provided input path and the system's designated temp directory.
- Officially (by Discord) crafted `.zip` or CSV files that cause unintended behavior (e.g. path traversal during extraction, excessive memory or CPU usage, crashes).

The following are **not** considered security vulnerabilities for this project:

- Issues that require physical access to the user's machine.
- Maliciously crafted `.zip` or CSV files that cause unintended behavior (e.g. path traversal during extraction, excessive memory or CPU usage, crashes). Please file these as bugs, while the user never should trust anything other than official packages, we can do our best to prevent it from happening.
- The tool reporting incorrect word counts or clustering results (these are bugs, not security issues, and can be filed as regular issues).
- Denial-of-service via extremely large but otherwise well-formed input files (out of scope for a local tool, though performance bug reports are welcome).
