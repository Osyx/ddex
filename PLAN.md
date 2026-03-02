# ddex — Planned Features

Each feature maps to a new subcommand (`ddex <command> <path-to-export>`).
All commands accept both a directory and a `.zip` file, consistent with existing subcommands.
All Discord GDPR exports are JSON-only; CSV support has been dropped.

## Confirmed export structure

From the Discord export README:

```
Account/
  user.json         User identity + relationships[] + payments[]
Activity/
  Analytics/
    events-YYYY-00000-of-00001.json   JSONL analytics (one JSON object per line)
Messages/
  index.json        { channel_id: "channel name or null" }
  c<id>/
    channel.json    Channel metadata (see schemas below)
    messages.json   Array of message objects (requesting user's messages only)
Servers/
  index.json        { guild_id: "Server Name" }
  <guild_id>/
    guild.json      (content unknown)
```

> **Localization note**: Root folder names (`Account/`, `Messages/`, etc.) may be translated (e.g. `Compte/` in French). File discovery must use case-insensitive regex matching.

### `messages.json` — message object schema

```json
{
  "Timestamp": "2023-01-15 14:30:00",
  "Contents": "Hello world",
  "Attachments": "(unknown)",
  "ID": "(present)"
}
```

- Only the requesting user's own messages are present — **no author field is needed or exists for filtering**
- `Timestamp` and `Contents` are capitalized

### `channel.json` — DM channel

```json
{
  "recipients": ["user_id_1", "user_id_2"]
}
```

- Exactly 2 entries = 1:1 DM. The other user's ID = `recipients` with the user's own ID removed.
- `recipients` with ≠ 2 entries = group DM (skip for now).

### `channel.json` — server text channel

```json
{
  "guild": {
    "id": "guild_id_string",
    "name": "Guild Name"
  }
}
```

### `messages/index.json`

```json
{
  "123456789": "Direct Message with Username",
  "987654321": "some-channel-name",
  "111111111": null
}
```

- DMs identified by prefix `"Direct Message with"` (length 20 — strip to get the username)
- Null values = skip
- Old-style usernames may end in `#0000` — strip the discriminator for display

### `Account/user.json` — key fields

```json
{
  "id": "123456789012345678",
  "username": "username",
  "discriminator": "1234",
  "display_name": "Display Name",
  "email": "user@example.com",
  "avatar_hash": "abc123",
  "relationships": [
    {
      "id": "other_user_id",
      "user": { "username": "friend", "discriminator": "0", "avatar": "hash" },
      "display_name": "Friend Name"
    }
  ],
  "payments": [
    {
      "id": "payment_id",
      "amount": 999,
      "currency": "usd",
      "created_at": "2023-01-15T14:30:00+00:00",
      "description": "Discord Nitro Monthly"
    }
  ]
}
```

- `amount` is in **cents** (INTEGER) — divide by 100 for display; `payment_date` stored as `'YYYY-MM-DD'`
- Relationship `avatar` field is keyed `avatar` (not `avatar_hash`) inside the nested `user` object
- Relationship `type` field (friend/blocked/pending) exists in Discord's API but **not confirmed in the export**;
- `email` field confirmed present in `user.json` (source: `tasks.py` user data block)

### `Servers/index.json`

```json
{ "guild_id_1": "Server Name 1", "guild_id_2": "Server Name 2" }
```

### Analytics events file — format & event types

One JSON object per line (JSONL). Key fields:

```json
{
  "event_type": "join_voice_channel",
  "timestamp": "\"2023-01-15 14:30:00\"",
  "client_track_timestamp": "\"2023-01-15 14:30:05\"",
  "channel_id": "123456789012345678",
  "guild_id": "123456789012345678",
  "emoji_name": "👍",
  "emoji_id": "123456789012345678",
  "user_id": "123456789012345678",
  "os": "windows"
}
```

> **Timestamp quirk**: analytics timestamps have a leading `"` character inside the JSON string (e.g. `"\"2023-01-15 14:30:00\""`) — parse from index 1.

**Event types**:

| Event type | Key fields | Used for |
|---|---|---|
| `join_voice_channel` | `channel_id`, `guild_id`, `client_track_timestamp`/`timestamp` | Voice duration |
| `leave_voice_channel` | same | Voice duration |
| `session_start` | `timestamp`, `os` | App session duration |
| `session_end` | `timestamp` | App session duration |
| `guild_joined` | `timestamp`, `guild_id` | Guild join history |
| `add_reaction` | `timestamp`, `channel_id`, `emoji_name`, `emoji_id` (custom if present) | Reactions given; `extra_field_1`=emoji_name, `extra_field_2`=`'1'` if custom |
| `notification_clicked` | `timestamp` | Notification click count |
| `app_opened` | `timestamp`, `os` | App opens; `extra_field_1`=os |
| `email_opened` | `timestamp` | Emails received |
| `login_successful` | `timestamp` | Logins |
| `user_avatar_updated` | `timestamp` | Avatar changes |
| `app_crashed` | `timestamp` | App crashes (also catches `app_native_crash`) |
| `oauth2_authorize_accepted` | `timestamp` | OAuth2 authorisations |
| `remote_auth_login` | `timestamp` | QR-code logins |
| `captcha_served` | `timestamp` | CAPTCHAs completed |
| `voice_message_recorded` | `timestamp` | Voice messages sent |
| `message_reported` | `timestamp` | Messages reported |
| `message_edited` | `timestamp` | Edits |
| `premium_upsell_viewed` | `timestamp` | Nitro ads seen |
| `application_command_used` | `timestamp`, `application_id`, `guild_id` | Slash command usage |
| `dev_portal_page_viewed` | `timestamp`, `page_name` | Dev portal views |
| `application_created` | `timestamp` | Apps created |
| `message_sent` | N/A | **Synthetic** — generated from `messages.json`, NOT from analytics JSONL |

**Not found in analytics** (confirmed absent): `mention_user`, `guild_left`, `friend_added`, `call_start`/`call_end`, `message_sent` (it's synthetic).

### Voice/call duration calculation

Derived from analytics events — **no separate file**:

1. Collect all `join_voice_channel` / `leave_voice_channel` events per `channel_id`
2. Sort by timestamp; match each join to the next leave
3. `duration = leave_ts − join_ts`; discard sessions > 24 h (noise)
4. Prefer `client_track_timestamp` over `timestamp` (fall back if `null`)

### Reaction data

**Reactions given** come from `add_reaction` analytics events only — they are **not in message files**.
Custom emoji: presence of `emoji_id` field.
**Reactions received** are **not available anywhere** in the GDPR export.

### What does NOT exist in the export (confirmed)

- No per-message author field (only your own messages are in `messages.json`)
- No reactions received data
- No messages received from other users (export contains only your own sent messages)
- `Ads/`, `Activities/`, `Programs/` — unknown

### Still unknown

- Exact `Attachments` field format in message objects (string? array? URL list?)
- Whether reply/reference fields exist in message objects
- Whether `channel.json` has a numeric `type` field (Discord API convention)
- Content of per-server `Servers/<guild_id>/guild.json` files

---

## `ddex people`

Show the user's social graph from their export.

**Totals section**
- Number of friends (from `relationships` data)
- Number of distinct users DMed with
- Number of distinct users mentioned (`<@id>` in messages)
- A combined "total distinct interactions" count
- Number of voice calls (joined voice channels with a DM partner)

**Top 10 DM partners table**
- Rank, username/ID, messages sent by user, voice call hours

**Optional: sentiment score per DM contact**
- Mean VADER compound score (-1.0 to +1.0) of the user's own messages in each DM — labelled "positive/neutral/negative"
- Derived purely from message Contents in `messages.json` (no external model needed)
- Reaction count per DM contact (from `add_reaction` analytics events filtered by `associated_channel_id`)

> **Data sources (confirmed):**
> - `Messages/index.json` + `channel.json` (recipients array) for DM partner identification
> - `messages.json` for per-channel message counts (all messages are from the user)
> - `Account/user.json` → `relationships[]` for contact list
> - `Activity/Analytics` events: `join_voice_channel`/`leave_voice_channel` for call duration (join `voice_sessions.channel_id = dm_channel.channel_id`)
> - `add_reaction` analytics events with `associated_channel_id` matching the DM channel for reaction counts
> - No "received messages" data exists — drop sent/received split; show messages sent per DM partner only

---

## `ddex spent`

Show how much the user has spent on Discord.

- Total amount spent
- Breakdown by category: Nitro subscriptions, gifts sent, store/cosmetic items
- Optionally: per-item or per-transaction list

> **Data sources (confirmed):**
> - `Account/user.json` → `payments[]` array; `amount` in cents

---

## `ddex servers`

Show the user's server activity.

**Totals section**
- Total servers the user is/was in
- Total servers the user has sent at least one message in
- Total distinct text channels written in
- Total voice channel joins

**Top 10 text servers** — server name, message count, guild join count

**Top 10 text channels** — channel name + server name, message count

**Top 10 voice channels** — channel name + server name, hours spent and/or join count
(include if data is available; skip gracefully if not)

**Top bots per server** (optional) — from `application_command_used` analytics events, grouped by `associated_guild_id` + `application_id`

> **Data sources (confirmed):**
> - `Messages/index.json` + `channel.json` → guild name/id per channel
> - `messages.json` message counts per channel
> - `Servers/index.json` → guild ID → name
> - `Activity/Analytics` events: `join_voice_channel`/`leave_voice_channel` pairs for voice duration
> - `guild_joined` analytics events → join count per guild (`associated_guild_id`)
> - `application_command_used` analytics events → `associated_guild_id` + `associated_user_id` (application_id) for bot usage

---

## `ddex time`

Show the user's temporal activity patterns.

- Number of times the user clicked a Discord notification
- **Message-per-hour heatmap**: rows = days of week (Mon–Sun), columns = hours (0–23), value = message count — rendered as an ASCII grid in the terminal
- Total time in calls (voice/video DMs), if data available
- Total time in server voice channels, if data available
- **Session stats**: total and average app session duration (in hours/minutes); usage breakdown by OS (Windows / macOS / Linux / Android / iOS)
- Top hour of day by message count

> **Data sources (confirmed):**
> - `messages.json` `Timestamp` field for the heatmap and top-hour calculation
> - `Activity/Analytics` `notification_clicked` events for click count
> - `join_voice_channel`/`leave_voice_channel` event pairs for voice duration
> - `session_start`/`session_end` event pairs → session duration in minutes + `os` field for device breakdown
>   (discard sessions > 24 h; deduplicate overlapping sessions — same logic as voice sessions)

---

## `ddex emojis`

Show the user's emoji usage.

**Sent in messages**
- Top 10 Unicode and custom emojis used in message text, with counts
- Total emoji count in sent messages

**Reactions given**
- Top 10 emojis the user has reacted with (from `add_reaction` analytics events), with counts
- Total reactions given
- Custom emoji: `emoji_id` field present in the analytics event — emoji name in `extra_field_1`, custom flag in `extra_field_2` (`'1'` = custom, `'0'` = Unicode)
- Distinguish Unicode vs. custom emoji

**Reactions received** — **not available in the GDPR export; drop this section entirely.**

> **Data sources (confirmed):**
> - `messages.json` `Contents` field for emoji parsing (Unicode + `<:name:id>` custom patterns)
> - `Activity/Analytics` `add_reaction` events for reactions given
> - Reactions received and emojis received do not exist in the export

---

## `ddex attachments`

Show the user's file/attachment activity.

**Totals section**
- Total messages sent with at least one attachment
- Total attachments sent
**Total attachments received** — **not available; drop this section.**

> **Data sources (confirmed):**
> - `messages.json` `Attachments` field (exact format TBD — format is unconfirmed)
> - `channel.json` / `Messages/index.json` for channel name resolution
> - Only sent attachments are in the export; received is impossible

---

## `ddex stats`

A summary dashboard that aggregates the highlights from all other commands in
one view. Intended as a quick overview — does not replace the individual
commands.

**Highlighted stats** (one-liners)
- Messages sent (total), average per day
- Friends, distinct DM partners, distinct servers active in
- Total money spent
- Most-messaged user, most-active server, most-active channel
- Most-used emoji
- Total attachments sent
- App opens total and average per day
- Total session time; average session duration

**"Extra stats" counters** (one-line each, from analytics event counts)
- Notifications clicked, logins, avatar updates, CAPTCHAs completed
- Emails received, app crashes, OAuth2 authorisations, voice messages recorded
- Messages reported, messages edited, Nitro ads seen
- Total voice channel time (minutes)

**Activity-over-time chart**
- ASCII chart showing messages per month (or per week) across the full history
- Visually shows whether the user has become more or less active over time

**Cross-category comparison bar chart** (ASCII)
- Relative bars for: messages sent, reactions given, attachments sent, voice hours
- Gives an at-a-glance picture of where the user spends most of their Discord activity

> This command runs the analysis from each subcommand internally. Use the single-pass orchestrator architecture (see Architecture section) so all data is collected in one pass.

---

## Architecture & performance

### Single-pass multi-analysis engine

The biggest risk is **N passes over the same data** — one per command, or one per sub-analysis inside `stats`. For large exports this is unacceptable.

**Solution: refactor `parseExport` into a single-pass multi-analyzer engine.**

```
analyzeMessages(exportDir, analyzers[], prog)
  → for each JSON row → call all registered analyzer functions
```

Each command registers its own analyzer function. `stats` registers all of them. One disk pass, all data collected.

The parser must be extended to yield **full row objects** (not just `contents`), including:
- `id`, `timestamp`, `contents`, `attachments` (from JSON fields — capitalized: `ID`, `Timestamp`, `Contents`, `Attachments`)
- `channelId`, `channelName`, `guildId` (derived from directory structure + `Messages/index.json` + `channel.json`)

```typescript
const [messageResults, analyticsResults] = await Promise.all([
  analyzeMessages(exportDir, messageAnalyzers, prog),
  scanAnalytics(analyticsPath, analyticsCollectors, prog),
]);
```

Extend the existing `predictor.ts` streaming pattern into a **multi-event dispatcher**:

```typescript
interface AnalyticsCollector {
  eventTypes: Set<string>;
  onEvent(event: Record<string, unknown>): void;
}
// build event_type → collectors[] map, dispatch on each line
```

Keep the string `includes()` pre-check before `JSON.parse` — the existing `predictor.ts` pattern — but now skip lines that match none of the registered event types.

### Worker threads: not worth it for JSON messages

- `bun:sqlite` is not thread-safe; sharing a DB across workers requires per-worker DBs + a merge step with little gain
- Each `messages.json` is typically small (hundreds of KB); the serialization overhead of posting rows across worker boundaries would likely exceed the parse cost
- The bottleneck is sequential disk I/O, not CPU; the multi-analyzer pattern already saturates I/O in a single thread

The one valid use of a Worker is to run the analytics scan truly in parallel with JSON message parsing — but `Promise.all` on the main thread already achieves this for I/O-bound work.

### `stats` command: single-pass orchestrator (no cache needed for v1)

`stats` is the orchestrator. It registers analyzers from every sub-command, runs the unified pipeline once, then formats each section. No persistent cache, no re-parsing.

```
resolveExport (generalized to extract all files)
    │
    ├── Message JSON pass (all message analyzers, single pass)
    └── Analytics stream  (all event collectors, in parallel)
         │
         └── Merge → format combined output per section
```

A persistent SQLite cache on disk (`~/.cache/ddex/<export-hash>.db`) is a future optimization if users report slow repeated runs, but adds cache-invalidation complexity and is not needed for v1.

### Bun-specific notes

| Feature | Recommendation |
|---|---|
| `bun:sqlite` in-memory | Use per-analysis accumulator tables; batch inserts in transactions (existing pattern in `db.ts`) |
| `Bun.file().size` | Sum file sizes upfront for accurate byte-progress reporting instead of file-count progress |
| Native JSON parsing | Already fast in Bun; combined with the `includes()` pre-check, analytics scanning is near-optimal |
| SQLite WAL mode | Enable if ever using a persistent disk DB: `PRAGMA journal_mode=WAL` |

### Concrete new source files needed

| File | Purpose |
|---|---|
| `src/metadata.ts` | Parse `messages/index.json`, `user.json`, `relationships/`, `servers/` into typed lookup maps |
| `src/analytics.ts` | Generalized multi-event analytics scanner (extends `predictor.ts` pattern) |
| `src/analyze.ts` | Single-pass multi-analyzer message engine (replaces narrow `parser.ts` + `parseExport`) |
| `src/<command>.ts` | Per-command analyzer factories + formatter (one file per command) |

---

## Implementation notes

- All new commands follow the existing pattern:
  - `src/<command>.ts` for the analysis logic
  - Route in `src/index.ts` via `cmd === "<command>"`
  - Help text constant `<COMMAND>_HELP`
  - Unit tests in `tests/unit/<command>.test.ts`
  - Integration tests in `tests/integration/binary.test.ts`
  - Fixture data under `tests/fixtures/`
  - README updated with usage docs

- **Missing data strategy**: print `(not available in this export)` for sections where data is absent; never error-exit.

- For ASCII charts/tables, evaluate whether a lightweight dependency makes
  sense or whether a hand-rolled renderer is sufficient (keep bundle size in mind
  since ddex compiles to a standalone binary).

---

# API investigation

> **Research date:** 2025-07-17
> **Source:** Full investigation of Discord API docs

## Conclusion: add `ddex enrich` as a separate subcommand

Online enrichment should be a dedicated subcommand, not a `--online-fetch` flag on existing commands, because:

1. It's a distinct operation that fetches and **caches** data for reuse
2. It makes network activity **explicitly opt-in** (ddex is offline-first by identity)
3. Other commands can then auto-detect and use the cache transparently

## Three safe tiers

| Tier | Auth | What it adds | Risk |
|------|------|-------------|------|
| **0 — CDN** | None | Custom emoji images (`cdn.discordapp.com/emojis/{id}.png`) | Zero |
| **1 — Bot token** | User creates free Discord application | `GET /users/{id}` → current username + avatar hash for any user ID; guild widget.json (name, online count — if widget enabled) | None (standard API usage) |
| **2 — OAuth2** | Requires browser redirect + Discord approval for most useful scopes | Current guild list with icons (`guilds` scope) | Medium complexity; `relationships.read` / `dm_channels.read` require Discord approval — impractical |
| **3 — User token (self-bot)** | N/A | Everything in the Discord client | ❌ **ToS violation — account termination risk. ddex must never support this.** |

## What `ddex enrich` does

```bash
ddex enrich <export>               # uses DDEX_DISCORD_TOKEN env var for bot token
ddex enrich <export> --token <tok> # explicit bot token
ddex enrich <export> --cdn-only    # CDN emoji images only; no bot token required
ddex enrich <export> --no-avatars  # skip downloading avatar/emoji images
ddex enrich <export> --force       # re-fetch even if cache exists
```

**Processing pipeline:**

```
1. Collect unique IDs from export
   ├── User IDs: from relationships[], DM recipients[], channel.json
   ├── Guild IDs: from Servers/index.json, channel.json guild objects
   └── Emoji IDs: from add_reaction analytics events

2. CDN fetches (no auth)
   └── Emoji images: cdn.discordapp.com/emojis/{id}.png (static) or .gif (animated)

3. API fetches (if --token provided)
   ├── GET /users/{id} per unique user ID → username, global_name, avatar hash
   └── GET /guilds/{id}/widget.json per guild → name, member count (if widget enabled)

4. CDN avatar downloads (after step 3 provides avatar hashes)
   └── cdn.discordapp.com/avatars/{user_id}/{hash}.png

5. Write enrichment cache
   └── ~/.cache/ddex/{export-hash}/enrichment.json
```

## Key findings

### `GET /users/{user.id}` is the killer feature (bot token, Tier 1)
Returns current `username`, `global_name`, `avatar` hash, `public_flags` (badges) for **any** user ID. One call per unique user; no guild membership required. At 50 req/sec global rate limit, even 2,000 contacts completes in ~40 seconds.

### Attachment URLs are dead (confirmed)
Discord enforced signed CDN URLs in 2024. Old attachment URLs from GDPR exports expire in 24 hours. The `attachments` command cannot check if files are still accessible — drop this idea entirely.

### Avatar hashes for DM partners aren't in the export
`user.json` only contains the requesting user's own avatar hash. To display others' avatars you need `GET /users/{id}` (Tier 1).

### Custom emoji images are free (CDN, Tier 0)
`cdn.discordapp.com/emojis/{emoji_id}.png` requires no authentication. Emoji IDs come from `add_reaction` analytics events. Emoji **names** (for custom emojis) require `GET /guilds/{id}/emojis` with a bot token AND guild membership — not practical for historical guilds.

### Guild widget (no auth) is unreliable
`GET /guilds/{id}/widget.json` requires no auth but only works if the guild admin enabled the widget — rare in practice. Don't rely on it.

### OAuth2 is not worth it for v1
`relationships.read` and `dm_channels.read` require Discord approval for 3rd-party apps. The only freely-available scopes (`identify`, `guilds`) are either redundant with the export or require a browser flow that adds significant UX complexity.

## Enrichment cache schema

```typescript
interface EnrichmentCache {
  version: 1;
  exportHash: string;
  enrichedAt: string;            // ISO timestamp
  users: Record<string, {
    id: string;
    username: string;
    globalName: string | null;
    avatarHash: string | null;
    avatarPath: string | null;   // local path to downloaded image
    publicFlags: number;
    fetchedAt: string;
  }>;
  guilds: Record<string, {
    id: string;
    name: string;
    iconHash: string | null;
    iconPath: string | null;
    memberCount: number | null;  // from widget (may be null)
    fetchedAt: string;
  }>;
  emojis: Record<string, {
    id: string;
    name: string | null;         // null if only CDN image available
    imagePath: string;           // local path to downloaded PNG/GIF
    animated: boolean;
    fetchedAt: string;
  }>;
}
```

## Implementation notes

- Use **native `fetch`** (Bun built-in) + `discord-api-types` for type definitions only (`bun add -D discord-api-types`). No full discord.js library needed.
- Implement a simple rate limiter (~30 lines) reading `X-RateLimit-Remaining` and `Retry-After` headers; respect the 50 req/sec global limit.
- Cache at `~/.cache/ddex/{export-hash}/enrichment.json`; all other commands auto-detect and use it.
- `--concurrency` default: 20 parallel requests.

## What NOT to build

- ❌ User token / self-bot support (ToS violation, account termination risk)
- ❌ OAuth2 flow for v1 (complex UX, restricted scopes need Discord approval)
- ❌ Attachment URL liveness check (URLs expired — no value)
- ❌ Application ID → bot name lookup (requires owning the application)
- ❌ Full discord.js library (adds hundreds of KB to the binary for 3 endpoints)
