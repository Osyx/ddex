# ddex — Feature Plan & Notes

All commands accept both a directory and a `.zip` file.
All Discord GDPR exports are JSON-only; CSV support has been dropped.

## Implementation status

| Command | Status | Source file |
|---|---|---|
| `ddex enrich` | 🔲 Planned | `src/enrich.ts` (future) |

Core infrastructure modules added alongside the commands:
- `src/metadata.ts` — case-insensitive loaders for `user.json`, channel/server indexes
- `src/analytics.ts` — multi-event JSONL streaming scanner + `buildVoiceSessions`
- `src/analyze.ts` — single-pass multi-analyzer message engine
- `src/extractor.ts` — generalized ZIP extraction (all files)

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

- All commands follow the pattern: `src/<command>.ts`, route in `src/index.ts`, help constant, unit + integration tests, fixtures under `tests/fixtures/`, README updated.
- **Missing data strategy**: print `(not available in this export)` for absent data; never error-exit.
- ASCII charts are hand-rolled (no extra dependency).

---

# API investigation — `ddex enrich` 🔲 (planned)

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

## All activity event_types in December 2025:
"event_type":"accepted_instant_invite"
"event_type":"account_link_step"
"event_type":"ack_community_messages"
"event_type":"ack_messages"
"event_type":"active_channels_loaded"
"event_type":"activities_center_control_tray_button_hovered"
"event_type":"activities_mini_shelf_hovered"
"event_type":"activities_restricted_csp_violation"
"event_type":"activities_shelf_weighted_top_n_sampled"
"event_type":"activities_whats_new_clicked"
"event_type":"activities_whats_new_opened"
"event_type":"activity_card_clicked"
"event_type":"activity_cards_viewed"
"event_type":"activity_device_thermal_state_changed"
"event_type":"activity_handshake"
"event_type":"activity_handshake_timed_out"
"event_type":"activity_iframe_mount"
"event_type":"activity_iframe_unmount"
"event_type":"activity_internal_action_bobble_league"
"event_type":"activity_internal_action_chess"
"event_type":"activity_internal_action_kwim"
"event_type":"activity_internal_action_landio"
"event_type":"activity_internal_action_letter_league"
"event_type":"activity_internal_action_sketch_heads"
"event_type":"activity_internal_action_wagons"
"event_type":"activity_internal_action_watch_together"
"event_type":"activity_internal_client_status"
"event_type":"activity_internal_launch_step_completed"
"event_type":"activity_internal_menu_interaction"
"event_type":"activity_internal_persistent_state_changed"
"event_type":"activity_report_problem"
"event_type":"activity_session_joined"
"event_type":"activity_session_left"
"event_type":"activity_shelf_close"
"event_type":"activity_updated"
"event_type":"add_channel_recipient"
"event_type":"ad_decision_business_rule_stage_decision"                                                                 "event_type":"ad_decision_business_rule_stage_decision_v2"                                                              "event_type":"ad_decision_filter_stage_decision"                                                                        "event_type":"ad_decision_filter_stage_decision_v2"                                                                     "event_type":"ad_decision_final_selector_stage_decision"                                                                "event_type":"ad_decision_final_selector_stage_decision_v2"                                                             "event_type":"ad_decision_pipeline_decision"                                                                            "event_type":"ad_decision_pipeline_decision_v2"                                                                         "event_type":"ad_decision_provider_stage_decision"                                                                      "event_type":"ad_decision_provider_stage_decision_v2"                                                                   "event_type":"ad_decision_stage_decision"                                                                               "event_type":"add_reaction"                                                                                             "event_type":"ad_identifier_fetched"                                                                                    "event_type":"ad_request_user_traits"                                                                                   "event_type":"ads_auction_ml_data"                                                                                      "event_type":"ads_auction_participant"
"event_type":"ads_measurement_worker_comparison_log"                                                                    "event_type":"ad_user_fetch_duration"                                                                                   "event_type":"advertiser_experiments_exposed"                                                                           "event_type":"af_dm_visited"                                                                                            "event_type":"af_exited"                                                                                                "event_type":"affinity_user"                                                                                            "event_type":"af_loaded"                                                                                                "event_type":"af_user_popout_opened"                                                                                    "event_type":"af_viewed"                                                                                                "event_type":"ai_endpoint_requested"                                                                                    "event_type":"android_hardware_survey"                                                                                  "event_type":"android_jank_stats"                                                                                       "event_type":"announcement_message_link_clicked"                                                                        "event_type":"announcement_message_viewed"                                                                              "event_type":"app_back_forward_navigated"                                                                               "event_type":"app_background"                                                                                           "event_type":"app_crashed"                                                                                              "event_type":"app_crashed_datadog_debug"                                                                                "event_type":"app_directory_carousel_image_loaded"                                                                      "event_type":"app_directory_category_clicked"                                                                           "event_type":"app_directory_collection_item_clicked"                                                                    "event_type":"app_directory_collection_scrolled"                                                                        "event_type":"app_directory_collection_viewed"                                                                          "event_type":"app_directory_opened"                                                                                     "event_type":"app_directory_page_scrolled"
"event_type":"app_directory_page_viewed"                                                                                "event_type":"app_directory_profile_embed_url_clicked"                                                                  "event_type":"app_directory_profile_tab_clicked"                                                                        "event_type":"app_directory_recommendation_clicked"                                                                     "event_type":"app_directory_searched"                                                                                   "event_type":"app_directory_search_result_clicked"                                                                      "event_type":"app_directory_search_started"                                                                             "event_type":"app_disk_usage_updated"                                                                                   "event_type":"app_dms_quick_launcher_clicked"                                                                           "event_type":"app_dms_quick_launcher_hidden"                                                                            "event_type":"app_dms_quick_launcher_impression"                                                                        "event_type":"app_embed_clicked"                                                                                        "event_type":"app_embed_viewed"                                                                                         "event_type":"app_exception_thrown"                                                                                     "event_type":"app_first_launched"                                                                                       "event_type":"app_first_login"                                                                                          "event_type":"app_icon_updated"                                                                                         "event_type":"app_image_recs_menu_viewed"                                                                               "event_type":"app_js_stalled"                                                                                           "event_type":"app_landing_viewed"                                                                                       "event_type":"app_launch_completed"                                                                                     "event_type":"app_launcher_activity_item_selected"                                                                      "event_type":"app_launcher_closed"                                                                                      "event_type":"app_launcher_command_closed"                                                                              "event_type":"app_launcher_empty_state_encountered"                                                                     "event_type":"app_launcher_entrypoint_button_clicked"
"event_type":"app_launcher_expanded"                                                                                    "event_type":"app_launcher_frecents_seen"                                                                               "event_type":"app_launcher_oauth2_authorize_opened"                                                                     "event_type":"app_launcher_oauth2_authorize_succeeded"                                                                  "event_type":"app_launcher_search_focused"                                                                              "event_type":"app_launcher_search_query_typed"                                                                          "event_type":"application_add_to_server_clicked"                                                                        "event_type":"application_closed"                                                                                       "event_type":"application_command_browser_jumped"                                                                       "event_type":"application_command_browser_opened"                                                                       "event_type":"application_command_browser_scrolled"                                                                     "event_type":"application_command_cache_fetch"
"event_type":"application_command_load_timing"                                                                          "event_type":"application_command_optional_option_added"                                                                "event_type":"application_command_optional_option_removed"                                                              "event_type":"application_command_option_string_autocomplete_performance"                                               "event_type":"application_command_performance"                                                                          "event_type":"application_command_search_open_timing"                                                                   "event_type":"application_command_section_selected"                                                                     "event_type":"application_command_selected"                                                                             "event_type":"application_command_top_of_funnel"                                                                        "event_type":"application_command_used"                                                                                 "event_type":"application_command_validation_failed"                                                                    "event_type":"application_created"
"event_type":"application_deleted"                                                                                      "event_type":"application_opened"                                                                                       "event_type":"application_updated"                                                                                      "event_type":"apply_apple_receipt_request_received"                                                                     "event_type":"app_manage_cta_clicked"                                                                                   "event_type":"app_modules_updated"                                                                                      "event_type":"app_native_crash"                                                                                         "event_type":"app_network_usage"                                                                                        "event_type":"app_notice_closed"                                                                                        "event_type":"app_notice_displayed"                                                                                     "event_type":"app_notice_primary_cta_opened"                                                                            "event_type":"app_notice_viewed"
"event_type":"app_oauth2_link_embed_url_clicked"                                                                        "event_type":"app_opened"                                                                                               "event_type":"app_ui_viewed"                                                                                            "event_type":"app_ui_viewed2"                                                                                           "event_type":"app_web_perf_startup_metrics"                                                                             "event_type":"attachment_upload_finished"                                                                               "event_type":"attachment_upload_started"                                                                                "event_type":"att_eligibility_checked"                                                                                  "event_type":"audio_device_module_error"                                                                                "event_type":"audio_input_initialized"                                                                                  "event_type":"audio_local_soundboard_mute_toggled"                                                                      "event_type":"authorized_app_connected"                                                                                 "event_type":"authorized_app_granted"                                                                                   "event_type":"authorized_app_removed"
"event_type":"automated_message_dismissed"                                                                              "event_type":"automated_message_received"                                                                               "event_type":"auto_suggest_displayed"                                                                                   "event_type":"auto_suggest_expression_selected"                                                                         "event_type":"av_error_reported"                                                                                        "event_type":"background_sync_completed"                                                                                "event_type":"boost_perk_allocation_created"                                                                            "event_type":"broadcast_list_visited"                                                                                   "event_type":"browser_handoff_succeeded"                                                                                "event_type":"burst_credit_balance_changed"                                                                             "event_type":"burst_credit_changed"                                                                                     "event_type":"cache_store_cache_skipped"                                                                                "event_type":"call_button_clicked"                                                                                      "event_type":"callkit_clicked"                                                                                          "event_type":"call_menu_item_interacted"                                                                                "event_type":"call_missed"
"event_type":"call_report_problem"                                                                                      "event_type":"can_open_url_requested"                                                                                   "event_type":"captcha_event"                                                                                            "event_type":"captcha_served"                                                                                           "event_type":"cdm_load_status"                                                                                          "event_type":"cdm_ready_complete"                                                                                       "event_type":"change_log_closed"                                                                                        "event_type":"change_log_cta_clicked"                                                                                   "event_type":"change_log_opened"                                                                                        "event_type":"change_log_video_interacted"                                                                              "event_type":"change_log_video_played"                                                                                  "event_type":"change_log_video_unmute"                                                                                  "event_type":"change_marketing_locale"                                                                                  "event_type":"channel_autocomplete_open"                                                                                "event_type":"channel_autocomplete_selected"                                                                            "event_type":"channel_back_navigated"                                                                                   "event_type":"channel_banner_cta_clicked"                                                                               "event_type":"channel_banner_viewed"
"event_type":"channel_deleted"                                                                                          "event_type":"channel_icon_edit_progressed"                                                                             "event_type":"channel_list_end_reached"                                                                                 "event_type":"channel_list_unread_badge_viewed"                                                                         "event_type":"channel_list_updated"                                                                                     "event_type":"channel_notice_closed"                                                                                    "event_type":"channel_notice_cta_clicked"                                                                               "event_type":"channel_notice_viewed"                                                                                    "event_type":"channel_opened"                                                                                           "event_type":"channel_permissions_overwrite_updated"                                                                    "event_type":"channel_permissions_page_viewed"                                                                          "event_type":"channel_position_updated"                                                                                 "event_type":"channel_sidebar_resized"                                                                                  "event_type":"channel_sidebar_viewed"                                                                                   "event_type":"channel_updated"                                                                                          "event_type":"chat_context_bar_action_canceled"                                                                         "event_type":"chat_input_component_viewed"                                                                              "event_type":"chat_input_omni_button_action"                                                                            "event_type":"checkpoint_card_clicked"
"event_type":"checkpoint_closed"                                                                                        "event_type":"checkpoint_started"                                                                                       "event_type":"checkpoint_step_viewed"                                                                                   "event_type":"claim_account"                                                                                            "event_type":"clan_apply_waitlist"                                                                                      "event_type":"clan_profile_viewed"                                                                                      "event_type":"clear_hang_status"                                                                                        "event_type":"clicker_game_completed"                                                                                   "event_type":"clicker_game_launched"                                                                                    "event_type":"click_landing_cta"                                                                                        "event_type":"client_ad_heartbeat"                                                                                      "event_type":"client_ad_heartbeat_termination"                                                                          "event_type":"client_heartbeat"                                                                                         "event_type":"client_telemetry"                                                                                         "event_type":"client_theme_preview_closed"                                                                              "event_type":"client_theme_preview_viewed"                                                                              "event_type":"client_theme_updated"
"event_type":"clip_save_keybind_pressed"                                                                                "event_type":"clips_hardware_classification"                                                                            "event_type":"clips_settings_updated"                                                                                   "event_type":"close_popout"                                                                                             "event_type":"close_tutorial"                                                                                           "event_type":"collectibles_gifting_shop_item_clicked"                                                                   "event_type":"collectibles_premium_sku_claimed"                                                                         "event_type":"collectibles_share_link_button_clicked"                                                                   "event_type":"collectibles_shop_element_clicked"                                                                        "event_type":"collectibles_shop_perf_tracked"                                                                           "event_type":"collectibles_shop_scrolled"                                                                               "event_type":"collectibles_shop_viewed"                                                                                 "event_type":"collectibles_tile_impression"
"event_type":"commands_migration_finished"                                                                              "event_type":"commands_migration_started"                                                                               "event_type":"connected_account_initiated"                                                                              "event_type":"connected_account_viewed"                                                                                 "event_type":"connection_resumed"                                                                                       "event_type":"connections_xbox_relink_coachmark_clicked"                                                                "event_type":"connections_xbox_relink_coachmark_viewed"                                                                 "event_type":"console_activity_update"                                                                                  "event_type":"console_game_sampled"                                                                                     "event_type":"contact_invite_sent"                                                                                      "event_type":"contact_sync_toggled"                                                                                     "event_type":"content_inventory_reaction_popout_emoji_clicked"                                                          "event_type":"context_menu_image_copied"                                                                                "event_type":"context_menu_image_saved"                                                                                 "event_type":"context_menu_image_save_failed"                                                                           "event_type":"context_menu_link_copied"                                                                                 "event_type":"context_menu_link_opened"                                                                                 "event_type":"copy_instant_invite"                                                                                      "event_type":"create_channel"                                                                                           "event_type":"create_dm_user_list_clicked"
"event_type":"create_emoji"                                                                                             "event_type":"create_guild"                                                                                             "event_type":"create_guild_viewed"                                                                                      "event_type":"create_instant_invite"                                                                                    "event_type":"create_oauth2_application"                                                                                "event_type":"create_sticker"                                                                                           "event_type":"custom_status_updated"                                                                                    "event_type":"custom_theme_reset_button_clicked"                                                                        "event_type":"custom_themes_editor_controls_changed"                                                                    "event_type":"custom_themes_surprise_button_clicked"                                                                    "event_type":"data_request_completed"                                                                                   "event_type":"data_request_initiated"                                                                                   "event_type":"debug_missing_string"                                                                                     "event_type":"deep_link_received"                                                                                       "event_type":"delete_emoji"
"event_type":"delete_guild"                                                                                             "event_type":"delete_sticker"                                                                                           "event_type":"desktop_perf_heartbeat"                                                                                   "event_type":"desktop_tti"                                                                                              "event_type":"detect_platform_account"                                                                                  "event_type":"device_link_step"                                                                                         "event_type":"devices_list_show_more_clicked"                                                                           "event_type":"dev_portal_auth_url_copied"                                                                               "event_type":"dev_portal_page_viewed"                                                                                   "event_type":"dev_portal_rp_viz_used"                                                                                   "event_type":"discovery_quest_tab_clicked"                                                                              "event_type":"dismissible_content_dismissed"                                                                            "event_type":"dismissible_content_shown"                                                                                "event_type":"dismissible_content_shown_before_connection_open"                                                         "event_type":"display_name_styles_applied"                                                                              "event_type":"display_name_styles_color_selected"
"event_type":"display_name_styles_from_settings"                                                                        "event_type":"display_name_styles_theme_toggle"                                                                         "event_type":"dm_list_viewed"                                                                                           "event_type":"dm_profile_toggled"                                                                                       "event_type":"dm_profile_viewed"                                                                                        "event_type":"dm_safety_coachmark_action"                                                                               "event_type":"domain_migrated"                                                                                          "event_type":"download_app"                                                                                             "event_type":"drops_opted_out_read_repaired"                                                                            "event_type":"drops_quest_enrolled"                                                                                     "event_type":"email_opened"                                                                                             "event_type":"email_sent"                                                                                               "event_type":"emoji_file_resized"                                                                                       "event_type":"emoji_picker_button_hovered"                                                                              "event_type":"emoji_upload_completed"                                                                                   "event_type":"emoji_upload_file_size_limit_exceeded"
"event_type":"emoji_upload_started"                                                                                     "event_type":"emoji_upsell_popout_more_emojis_opened"                                                                   "event_type":"enable_notifications"                                                                                     "event_type":"experiment_guild_triggered"                                                                               "event_type":"experiment_guild_triggered_fallback"                                                                      "event_type":"experiment_guild_triggered_ignored"                                                                       "event_type":"experiment_user_evaluation_exposed"                                                                       "event_type":"experiment_user_triggered"                                                                                "event_type":"experiment_user_triggered_fallback"                                                                       "event_type":"experiment_user_triggered_ignored"                                                                        "event_type":"explicit_media_redactable_messages_loaded"                                                                "event_type":"explicit_media_retroactive_scan_complete"                                                                 "event_type":"explicit_media_scan_client_timed_out"                                                                     "event_type":"expression_favorited"                                                                                     "event_type":"expression_picker_category_collapse_toggled"                                                              "event_type":"expression_picker_category_selected"
"event_type":"expression_picker_expression_focus"                                                                       "event_type":"expression_picker_expression_selected"                                                                    "event_type":"expression_picker_opened"                                                                                 "event_type":"expression_picker_soundboard_sounds_loaded"                                                               "event_type":"expression_picker_tab_clicked"                                                                            "event_type":"expression_tooltip_viewed"                                                                                "event_type":"external_dynamic_link_received"                                                                           "event_type":"external_payment_succeeded"                                                                               "event_type":"external_share_opened"                                                                                    "event_type":"failed_message_resolved"                                                                                  "event_type":"family_center_viewed"                                                                                     "event_type":"feed_item_interacted"                                                                                     "event_type":"feed_item_seen_batch"                                                                                     "event_type":"feed_loaded"                                                                                              "event_type":"feed_shown"                                                                                               "event_type":"fetch_user_offer_started"                                                                                 "event_type":"file_size_limit_exceeded"
"event_type":"file_upload_alert_viewed"                                                                                 "event_type":"forum_channel_create_new_post_clicked"                                                                    "event_type":"forum_channel_media_uploader_clicked"                                                                     "event_type":"forum_channel_more_posts_loaded"                                                                          "event_type":"forum_channel_new_post_draft_created"                                                                     "event_type":"forum_channel_post_clicked"                                                                               "event_type":"forum_channel_post_created"                                                                               "event_type":"forum_channel_scrolled"
"event_type":"forum_channel_seen_batch"
"event_type":"forum_channel_tag_filter_clicked"
"event_type":"forward_add_recipient"
"event_type":"forward_breadcrumb_clicked"
"event_type":"forward_copy_link"
"event_type":"forward_edit_context_message"
"event_type":"forward_edit_search"
"event_type":"forward_message_cancelled"
"event_type":"forward_message_sent"
"event_type":"forward_message_started"
"event_type":"friend_add_viewed"
"event_type":"friend_finder_initial_loaded"
"event_type":"friend_request_failed"
"event_type":"friends_list_clicked"
"event_type":"friends_list_viewed"
"event_type":"friend_suggestion_skipped"
"event_type":"friend_sync_performed"
"event_type":"game_detected"
"event_type":"game_detection_comparison"
"event_type":"game_news_changed"
"event_type":"game_news_opened"
"event_type":"game_opened"
"event_type":"game_profile_close"
"event_type":"game_profile_entry_point_available"
"event_type":"game_profile_open"
"event_type":"gateway_bridge_timeout"
"event_type":"gateway_connect_skipped"
"event_type":"gateway_socket_reset"
"event_type":"gdm_edit_interacted"
"event_type":"gif_favorited"
"event_type":"gift_category_select_modal_opened"
"event_type":"gift_code_copied"
"event_type":"gift_code_created"
"event_type":"gift_code_resolved"
"event_type":"gift_code_revoked"
"event_type":"gift_code_sent"
"event_type":"gif_unfavorited"
"event_type":"global_discovery_entrypoint_clicked"
"event_type":"global_discovery_servers_viewed"
"event_type":"global_discovery_viewed"
"event_type":"guild_bot_added"
"event_type":"guild_channel_highlights_loaded"
"event_type":"guild_channel_resync_requested"
"event_type":"guild_clicked"
"event_type":"guild_creation_intent_selected"
"event_type":"guild_default_dms_updated"
"event_type":"guild_discovery_exited"
"event_type":"guild_discovery_guild_join_clicked"
"event_type":"guild_discovery_guild_selected"
"event_type":"guild_discovery_viewed"
"event_type":"guild_dropdown_menu_viewed"
"event_type":"guild_folder_clicked"
"event_type":"guild_folder_created"
"event_type":"guild_joined"
"event_type":"guild_joined_pending"
"event_type":"guild_join_request_created"
"event_type":"guild_limit_reached"
"event_type":"guild_lurk_started"
"event_type":"guild_members_pruned"
"event_type":"guild_member_updated"
"event_type":"guild_mod_view_opened"
"event_type":"guild_onboarding_loaded"
"event_type":"guild_onboarding_requirements_failed"
"event_type":"guild_onboarding_step_completed"
"event_type":"guild_onboarding_step_viewed"
"event_type":"guild_outage_viewed"
"event_type":"guild_profile_viewed"
"event_type":"guild_role_updated"
"event_type":"guild_scheduled_event_created"
"event_type":"guild_scheduled_event_deleted"
"event_type":"guild_scheduled_event_ended"
"event_type":"guild_scheduled_event_started"
"event_type":"guild_scheduled_event_subscribed"
"event_type":"guild_scheduled_event_unsubscribed"
"event_type":"guild_scheduled_event_updated"
"event_type":"guilds_dock_all_servers_viewed"
"event_type":"guilds_dock_item_clicked"
"event_type":"guilds_dock_opened"
"event_type":"guild_settings_discovery_viewed"
"event_type":"guild_settings_onboarding_edit_page_clicked"
"event_type":"guild_settings_onboarding_updated"
"event_type":"guild_settings_updated"
"event_type":"guild_tag_updated"
"event_type":"guild_template_link_updated"
"event_type":"guild_template_selected"
"event_type":"guild_viewed"
"event_type":"guild_welcome_screen_option_selected"
"event_type":"hardware_detected"
"event_type":"headless_task_completed"
"event_type":"headless_task_invoked"
"event_type":"help_clicked"
"event_type":"highlights_test_loaded"
"event_type":"home_backgrounded"
"event_type":"home_events_loaded"
"event_type":"home_exited"
"event_type":"home_feedback_prompt_viewed"
"event_type":"home_first_scroll_started"
"event_type":"home_opened"
"event_type":"home_panel_viewed"
"event_type":"hook_result"
"event_type":"hotspot_hidden"
"event_type":"hover_menu_opened"
"event_type":"hypesquad_subscription_updated"
"event_type":"iar_feedback_modal_viewed"
"event_type":"iar_feedback_submitted"
"event_type":"iar_modal_close"
"event_type":"iar_modal_open"
"event_type":"ignore_friend_suggestion"
"event_type":"ignore_user_confirmed"
"event_type":"ignore_user_feedback_submitted"
"event_type":"image_hovered"
"event_type":"image_video_data_settings_updated"
"event_type":"impression_activities"
"event_type":"impression_activities_happening_now"
"event_type":"impression_activity_details"
"event_type":"impression_activity_shelf"
"event_type":"impression_app_launcher_badge"
"event_type":"impression_app_launcher_home_activity_item"
"event_type":"impression_app_launcher_item"
"event_type":"impression_app_launcher_search_results_item"
"event_type":"impression_app_launcher_section"
"event_type":"impression_audio_device_menu"
"event_type":"impression_boost_shop_opened"
"event_type":"impression_call_tile_context_menu"
"event_type":"impression_channel_add_info"
"event_type":"impression_channel_add_members"
"event_type":"impression_channel_call_video_grid_view"
"event_type":"impression_cloud_play_cta"
"event_type":"impression_contact_sync_input_name"
"event_type":"impression_contact_sync_start"
"event_type":"impression_contact_sync_suggestions"
"event_type":"impression_custom_themes_appearance_settings_banner"
"event_type":"impression_display_name_styles_modal"
"event_type":"impression_dm_list_right_click_menu_shown"
"event_type":"impression_double_tap_react_upsell"
"event_type":"impression_embedded_activity_happening_now"
"event_type":"impression_enable_creator_monetization_waitlist_landing"
"event_type":"impression_guild_add_customize"
"event_type":"impression_guild_add_intent_selection"
"event_type":"impression_guild_add_landing"
"event_type":"impression_guild_invite"
"event_type":"impression_guild_invite_search"
"event_type":"impression_guilds_empty_nux"
"event_type":"impression_guild_settings_access"
"event_type":"impression_guild_settings_audit_log"
"event_type":"impression_guild_settings_bans"
"event_type":"impression_guild_settings_boost_perks"
"event_type":"impression_guild_settings_boost_status"
"event_type":"impression_guild_settings_channels"
"event_type":"impression_guild_settings_community_overview"
"event_type":"impression_guild_settings_community_welcome"
"event_type":"impression_guild_settings_discovery"
"event_type":"impression_guild_settings_emoji"
"event_type":"impression_guild_settings_enable_community"
"event_type":"impression_guild_settings_engagement"
"event_type":"impression_guild_settings_integration"
"event_type":"impression_guild_settings_invites"
"event_type":"impression_guild_settings_invites_v2"
"event_type":"impression_guild_settings_landing"
"event_type":"impression_guild_settings_members"
"event_type":"impression_guild_settings_member_verification"
"event_type":"impression_guild_settings_moderation"
"event_type":"impression_guild_settings_overview"
"event_type":"impression_guild_settings_partner"
"event_type":"impression_guild_settings_profile"
"event_type":"impression_guild_settings_roles"
"event_type":"impression_guild_settings_security"
"event_type":"impression_guild_settings_soundboard"
"event_type":"impression_guild_settings_stickers"
"event_type":"impression_guild_settings_tag"
"event_type":"impression_guild_settings_template"
"event_type":"impression_guild_settings_vanity_url"
"event_type":"impression_guild_settings_webhooks"
"event_type":"impression_guild_settings_widget"
"event_type":"impression_guild_shop_page"
"event_type":"impression_hub_email_signup"
"event_type":"impression_ignore_user_confirmation"
"event_type":"impression_invite_accept"
"event_type":"impression_masked_link_modal"
"event_type":"impression_modal_root_legacy"
"event_type":"impression_multi_account_switch_landing"
"event_type":"impression_notification_center_landing"
"event_type":"impression_perk_discoverability_card"
"event_type":"impression_poll_editor_viewed"
"event_type":"impression_pomelo_landing"
"event_type":"impression_push_notification_preprompt"
"event_type":"impression_quest_home"
"event_type":"impression_request_review_modal"
"event_type":"impression_role_create_add_members"
"event_type":"impression_role_create_display"
"event_type":"impression_role_create_permissions"
"event_type":"impression_snowsgiving"
"event_type":"impression_soundboard_popout"
"event_type":"impression_stream_feedback_modal"
"event_type":"impression_user_agreements"
"event_type":"impression_user_login"
"event_type":"impression_user_settings_connections"
"event_type":"impression_user_settings_sessions"
"event_type":"impression_user_welcome"
"event_type":"impression_user_you_screen"
"event_type":"impression_voice_feedback_modal"
"event_type":"in_app_camera_used"
"event_type":"in_app_notification_clicked"
"event_type":"inbox_channel_acked"
"event_type":"inbox_channel_clicked"
"event_type":"inbox_channel_collapsed"
"event_type":"initial_cache_loaded"
"event_type":"input_mute_toggled"
"event_type":"instant_invite_option_clicked"
"event_type":"instant_invite_shared"
"event_type":"integration_added"
"event_type":"integration_removed"
"event_type":"interactible_ui_loaded"
"event_type":"interaction_modal_submitted"
"event_type":"inventory_guild_settings"
"event_type":"invite_accept_dismissed"
"event_type":"invite_accept_join_settings_expanded"
"event_type":"invite_app_invoked"
"event_type":"invite_embed_actioned"
"event_type":"invite_opened"
"event_type":"invite_sent"
"event_type":"invite_server_clicked"
"event_type":"invite_suggestion_opened"
"event_type":"invite_viewed"
"event_type":"ios_metric_kit_payload_received"
"event_type":"join_call"
"event_type":"join_guild_viewed"
"event_type":"join_thread"
"event_type":"join_voice_channel"
"event_type":"jump"
"event_type":"keyboard_mode_toggled"
"event_type":"keyboard_shortcut_used"
"event_type":"kv_field_trial_executed"
"event_type":"launch_game"
"event_type":"launchpad_opened"
"event_type":"launchpad_searched"
"event_type":"leave_guild"
"event_type":"leave_thread"
"event_type":"leave_voice_channel"
"event_type":"libdiscore_loaded"
"event_type":"libdiscore_slow_timers"
"event_type":"library_scanning_enabled"
"event_type":"library_viewed"
"event_type":"link_clicked"
"event_type":"local_settings_updated"
"event_type":"local_voice_settings_loaded"
"event_type":"login_attempted"
"event_type":"login_failed"
"event_type":"login_successful"
"event_type":"login_viewed"
"event_type":"mailing_list_contact_update_failed"
"event_type":"main_navigation_menu"
"event_type":"mark_as_read"
"event_type":"masked_link_modal_clicked"
"event_type":"media_attachment_playback_ended"
"event_type":"media_attachment_playback_started"
"event_type":"media_device_changed"
"event_type":"media_download_button_tapped"
"event_type":"media_output_volume_changed"
"event_type":"media_picker_action_sheet_engaged"
"event_type":"media_picker_infinite_scroll_paged"
"event_type":"media_play_finished"
"event_type":"media_session_joined"
"event_type":"media_viewer_download_button_tapped"
"event_type":"media_viewer_link_opened"
"event_type":"media_viewer_session_completed"
"event_type":"media_viewer_share_button_tapped"
"event_type":"memberlist_content_feed_expander_toggled"
"event_type":"memberlist_content_feed_hidden_toggled"
"event_type":"member_list_notice_closed"
"event_type":"member_list_notice_viewed"
"event_type":"member_list_swipe_peek"
"event_type":"member_list_swipe_toggled"
"event_type":"member_list_toggled"
"event_type":"member_list_viewed"
"event_type":"message_action_sheet_opened"
"event_type":"message_action_sheet_option_pressed"
"event_type":"message_attachment_updated"
"event_type":"message_component_used"
"event_type":"message_composer_opened"
"event_type":"message_composer_search_result_clicked"
"event_type":"message_composer_transitioned"
"event_type":"message_deleted"
"event_type":"message_edited"
"event_type":"message_edit_up_arrow"
"event_type":"message_embeds_action_completed"
"event_type":"message_embeds_resolved"
"event_type":"message_length_limit_reached"
"event_type":"message_link_copied"
"event_type":"message_menu_time_to_close"
"event_type":"message_menu_time_to_select"
"event_type":"message_popout_menu_opened_desktop"
"event_type":"message_reported"
"event_type":"message_request_action"
"event_type":"message_request_create"
"event_type":"message_request_preview_viewed"
"event_type":"message_scanned"
"event_type":"message_sent_with_attachments"
"event_type":"message_shortcut_action_sent"
"event_type":"messages_search_started"
"event_type":"message_swipe_action_sent"
"event_type":"mic_testing_started"
"event_type":"mic_testing_stopped"
"event_type":"mktg_page_cta_clicked"
"event_type":"mktg_page_viewed"
"event_type":"mobile_nitro_home_perks_carousel_scrolled"
"event_type":"mobile_nitro_home_tab_switched"
"event_type":"mobile_ota_asset_download_attempt"
"event_type":"mobile_ota_check_attempt"
"event_type":"mobile_overlay_closed"
"event_type":"mobile_overlay_opened"
"event_type":"mobile_overlay_toggled"
"event_type":"mobile_redesign_feedback"
"event_type":"mobile_redesign_toggled"
"event_type":"modal_dismissed"
"event_type":"mod_dash_members_table_viewed"
"event_type":"mod_dash_search_members"
"event_type":"moderation_action"
"event_type":"my_account_page_tab_navigate"
"event_type":"name_submitted"
"event_type":"native_echo_cancellation_configured"
"event_type":"native_share_sheet_app_clicked"
"event_type":"nav_drawer_opened"
"event_type":"network_action_channel_create"
"event_type":"network_action_detectable_applications_fetch"
"event_type":"network_action_email_settings_fetch"
"event_type":"network_action_email_settings_update"
"event_type":"network_action_embedded_activities_fetch_shelf"
"event_type":"network_action_embedded_activities_launch"
"event_type":"network_action_guild_create"
"event_type":"network_action_hub_email_verify_send"
"event_type":"network_action_invite_resolve"
"event_type":"network_action_notification_center_page_fetch"
"event_type":"network_action_pomelo_attempt"
"event_type":"network_action_pomelo_create"
"event_type":"network_action_quest_heartbeat"
"event_type":"network_action_quest_video_progress"
"event_type":"network_action_stream_notify"
"event_type":"network_action_user_accept_agreements"
"event_type":"network_action_user_communication_disabled_update"
"event_type":"network_action_user_contacts_sync"
"event_type":"network_action_user_login"
"event_type":"network_action_user_login_mfa"
"event_type":"network_action_user_logout"
"event_type":"network_action_user_register_device_token"
"event_type":"network_action_user_settings_update"
"event_type":"network_action_user_survey_fetch"
"event_type":"network_action_user_survey_seen"
"event_type":"nitro_home_navigation"
"event_type":"nitro_tab_badge_shown"
"event_type":"nitro_tab_visited"
"event_type":"noise_cancellation_link_clicked"
"event_type":"notification_action"
"event_type":"notification_canceled"
"event_type":"notification_center_action"
"event_type":"notification_center_create"
"event_type":"notification_center_loaded"
"event_type":"notification_clicked"
"event_type":"notification_device_token_update"
"event_type":"notification_permission_preprompt_acked"
"event_type":"notification_permission_status"
"event_type":"notification_rendered"
"event_type":"notification_report_submitted"
"event_type":"notification_request_published"
"event_type":"notification_request_received"
"event_type":"notification_sent"
"event_type":"notification_settings_clicked"
"event_type":"notification_settings_updated"
"event_type":"notification_viewed"
"event_type":"notify_stream_setting_update"
"event_type":"now_playing_card_hovered"
"event_type":"nuo_transition"
"event_type":"oauth2_authorize_accepted"
"event_type":"oauth2_authorize_step_viewed"
"event_type":"oauth2_authorize_success_go_to_guild_clicked"
"event_type":"oauth2_authorize_success_open_app_clicked"
"event_type":"oauth2_authorize_success_viewed"
"event_type":"oauth2_authorize_viewed"
"event_type":"open_modal"
"event_type":"open_popout"
"event_type":"orb_balance_action_sheet_action"
"event_type":"orbs_entrypoint_clicked"
"event_type":"outbound_promotion_code_claimed"
"event_type":"outbound_promotion_notice_clicked"
"event_type":"overlay_game_invite_notification_shown"
"event_type":"overlay_hook_result"
"event_type":"overlay_initialized"
"event_type":"overlay_layout_updated"
"event_type":"overlay_locked"
"event_type":"overlay_perf_info"
"event_type":"overlay_pin_toggled"
"event_type":"overlay_settings_updated"
"event_type":"overlay_toggled"
"event_type":"overlay_unlocked"
"event_type":"overlay_usage_notification_stats"
"event_type":"overlay_usage_stats"
"event_type":"party_voice_activity_viewed"
"event_type":"patch_me_request"
"event_type":"payment_attempted"
"event_type":"payment_exception"
"event_type":"payment_failed"
"event_type":"payment_flow_canceled"
"event_type":"payment_flow_completed"
"event_type":"payment_flow_failed"
"event_type":"payment_flow_loaded"
"event_type":"payment_flow_started"
"event_type":"payment_flow_step"
"event_type":"payment_flow_succeeded"
"event_type":"payment_receipt_email_sent"
"event_type":"payment_source_added"
"event_type":"payment_succeeded"
"event_type":"paypal_notification_received"
"event_type":"perk_discoverability_card_cta_clicked"
"event_type":"permissions_acked"
"event_type":"permissions_requested"
"event_type":"phone_verification_code_confirm_succeeded"
"event_type":"phone_verification_code_request_attempted"
"event_type":"phone_verification_code_request_succeeded"
"event_type":"pin_limit_reached"
"event_type":"pin_message"
"event_type":"poggermode_settings_updated"
"event_type":"poll_completed"
"event_type":"poll_creation_cancelled"
"event_type":"poll_message_created"
"event_type":"poll_show_results_clicked"
"event_type":"poll_vote_added"
"event_type":"poll_vote_removed"
"event_type":"poll_vote_selected"
"event_type":"pomelo_edit_step_viewed"
"event_type":"post_gateway_connect_skipped"
"event_type":"premium_canceled"
"event_type":"premium_education_viewed"
"event_type":"premium_entitlement_dual_read_matched"
"event_type":"premium_feature_try_out"
"event_type":"premium_feature_tutorial_steps"
"event_type":"premium_feature_usage_v2"
"event_type":"premium_gift_upsell_viewed"
"event_type":"premium_guild_promotion_opened"
"event_type":"premium_guild_subscription_canceled"
"event_type":"premium_guild_subscription_created"
"event_type":"premium_guild_subscription_cta_clicked"
"event_type":"premium_guild_subscription_removed"
"event_type":"premium_guild_upsell_viewed"
"event_type":"premium_marketing_campaign_claim_modal_open_attempted"
"event_type":"premium_marketing_campaign_entitlement_created_ingested"
"event_type":"premium_marketing_campaign_redemption_card_clicked"
"event_type":"premium_marketing_page_exited"
"event_type":"premium_marketing_page_viewed"
"event_type":"premium_marketing_perk_card_flipped"
"event_type":"premium_marketing_surface_reached_bottom"
"event_type":"premium_marketing_what_is_new_card_hovered"
"event_type":"premium_page_opened"
"event_type":"premium_promotion_opened"
"event_type":"premium_purchase_completed"
"event_type":"premium_purchase_started"
"event_type":"premium_removed"
"event_type":"premium_subscription_reminder_email_attempt"
"event_type":"premium_upsell_viewed"
"event_type":"privacy_control_updated"
"event_type":"promotion_reward_redemption_attempted"
"event_type":"promotion_viewed"
"event_type":"push_notification_incoming"
"event_type":"push_notification_processed"
"event_type":"push_notification_queue_flushed"
"event_type":"push_notification_received"
"event_type":"quest_bar_mode_changed"
"event_type":"quest_bar_render_delay"
"event_type":"quest_bar_render_performance_measured"
"event_type":"quest_content_clicked"
"event_type":"quest_content_dismissed"
"event_type":"quest_content_loaded"
"event_type":"quest_content_rendering_failure"
"event_type":"quest_content_viewed"
"event_type":"quest_content_view_time"
"event_type":"quest_decision_received"
"event_type":"quest_decision_roundtrip"
"event_type":"quest_decision_roundtrip_error"
"event_type":"quest_delivered"
"event_type":"quest_delivery_blocked"
"event_type":"quest_eligibility_checked"
"event_type":"quest_eligible_for_survey"
"event_type":"quest_embed_fallback_viewed"
"event_type":"quest_enrolled"
"event_type":"quest_home_filters_changed"
"event_type":"quest_home_sort_method_changed"
"event_type":"quest_hover"
"event_type":"quest_hover_off"
"event_type":"quest_link_shared_v2"
"event_type":"quest_measurement_event_processed"
"event_type":"quest_progress"
"event_type":"quest_reward_claimed"
"event_type":"quest_targeting_result"
"event_type":"quest_video_app_focused"
"event_type":"quest_video_app_unfocused"
"event_type":"quest_video_buffering_ended"
"event_type":"quest_video_buffering_started"
"event_type":"quest_video_error"
"event_type":"quest_video_fullscreen_exited"
"event_type":"quest_video_loading_ended"
"event_type":"quest_video_loading_started"
"event_type":"quest_video_modal_closed"
"event_type":"quest_video_paused"
"event_type":"quest_video_progressed"
"event_type":"quest_video_resumed"
"event_type":"quest_video_segment_watched"
"event_type":"quest_video_time_to_first_frame"
"event_type":"quest_video_volume_changed"
"event_type":"quickswitcher_closed"
"event_type":"quickswitcher_opened"
"event_type":"quickswitcher_result_selected"
"event_type":"ranking_item_interacted"
"event_type":"ranking_items_seen"
"event_type":"reaction_action_sheet_opened"
"event_type":"reaction_picker_opened"
"event_type":"reaction_picker_tab_clicked"
"event_type":"ready_payload_received"
"event_type":"realtime_message_created"
"event_type":"receive_friend_suggestion"
"event_type":"receiver_first_frame_delivered"
"event_type":"redactable_message_loaded"
"event_type":"redeemed_holiday_prize"
"event_type":"redesign_nav_bar_clicked"
"event_type":"redesign_nav_bar_rendered"
"event_type":"referral_program_share_cta_clicked"
"event_type":"referral_program_share_modal_cta_clicked"
"event_type":"referral_window_created"
"event_type":"register"
"event_type":"relationship_metadata_updated"
"event_type":"relationship_sync_flow"
"event_type":"remix_downloaded"
"event_type":"remixing_action_undone"
"event_type":"remixing_component_added"
"event_type":"remixing_component_tool_opened"
"event_type":"remixing_surface_exited"
"event_type":"remixing_surface_opened"
"event_type":"remix_sent"
"event_type":"remix_surface_exit_modal"
"event_type":"remote_auth_cancel"
"event_type":"remote_auth_confirm"
"event_type":"remote_auth_init"
"event_type":"remote_auth_login"
"event_type":"remote_command_sent"
"event_type":"remove_channel_recipient"
"event_type":"remove_reaction"
"event_type":"reply_message_started"
"event_type":"reply_started"
"event_type":"resolve_invite"
"event_type":"review_request_deferred"
"event_type":"review_request_eligibility_checked"
"event_type":"review_request_show_attempted"
"event_type":"ring_call"
"event_type":"ring_call_accepted"
"event_type":"ring_call_declined"
"event_type":"role_page_viewed"
"event_type":"role_subscription_listing_upsell_page_viewed_v3"
"event_type":"role_subscription_purchase_system_message_clicked"
"event_type":"role_template_selected"
"event_type":"route_unmount"
"event_type":"rpc_command_sent"
"event_type":"rpc_server_error_caught"
"event_type":"rpc_subscription_requested"
"event_type":"rtc_panel_viewed"
"event_type":"running_game_card_state_changed"
"event_type":"running_game_heartbeat"
"event_type":"running_game_override_added"
"event_type":"safety_hub_viewed"
"event_type":"safety_settings_notice_action"
"event_type":"screenshare_finished"
"event_type":"search_bar_viewed"
"event_type":"search_closed"
"event_type":"search_empty_message_result_mobile"
"event_type":"search_empty_result_mobile"
"event_type":"search_input_cleared"
"event_type":"search_messages_autocomplete_clicked"
"event_type":"search_opened"
"event_type":"search_opened_mobile"
"event_type":"search_result_clicked_mobile"
"event_type":"search_result_empty"
"event_type":"search_result_expanded"
"event_type":"search_result_page_changed"
"event_type":"search_result_returned_mobile"
"event_type":"search_result_selected"
"event_type":"search_results_feedback_entrypoint_viewed"
"event_type":"search_result_sort_changed"
"event_type":"search_result_viewed"
"event_type":"search_started"
"event_type":"search_started_mobile"
"event_type":"search_user_list_started"
"event_type":"search_v2_closed"
"event_type":"search_v2_filter_add"
"event_type":"search_v2_filter_remove"
"event_type":"search_v2_filters_applied"
"event_type":"search_v2_history_clicked"
"event_type":"search_v2_indexing_viewed"
"event_type":"search_v2_jump_to_message"
"event_type":"search_v2_opened"
"event_type":"search_v2_result_clicked"
"event_type":"search_v2_result_counts_viewed"
"event_type":"search_v2_result_empty"
"event_type":"search_v2_result_messages_empty"
"event_type":"search_v2_results_viewed"
"event_type":"search_v2_results_viewed_aggregate"
"event_type":"search_v2_started"
"event_type":"search_v2_tab_selected"
"event_type":"secure_frames_transition"
"event_type":"self_deafen_toggled"
"event_type":"send_message"
"event_type":"send_message_failure"
"event_type":"send_message_queued"
"event_type":"send_message_roundtrip"
"event_type":"server_guide_action_completed"
"event_type":"server_guide_channel_selected"
"event_type":"server_guide_viewed"
"event_type":"server_setup_cta_clicked"
"event_type":"session_end"
"event_type":"session_start"
"event_type":"session_start_client"
"event_type":"session_start_success"
"event_type":"set_hang_status"
"event_type":"settings_pane_viewed"
"event_type":"share_message_sent"
"event_type":"share_nitro_flow_steps"
"event_type":"share_sheet_action"
"event_type":"show_tutorial"
"event_type":"sku_entitlement_created"
"event_type":"sku_entitlement_updated"
"event_type":"slash_command_used"
"event_type":"slayer_launch_game"
"event_type":"snowsgiving_page_cta_clicked"
"event_type":"soundboard_sound_uploaded"
"event_type":"soundmoji_play"
"event_type":"soundpack_updated"
"event_type":"soundshare_attached"
"event_type":"soundshare_failed"
"event_type":"soundshare_transmitting"
"event_type":"spotify_button_clicked"
"event_type":"spotify_listen_along_ended"
"event_type":"spotify_listen_along_started"
"event_type":"stage_discovery_exited"
"event_type":"stage_discovery_loaded"
"event_type":"stage_discovery_reloaded"
"event_type":"start_call"
"event_type":"start_listening"
"event_type":"start_speaking"
"event_type":"sticker_attached"
"event_type":"stickers_in_autocomplete_toggled"
"event_type":"sticker_suggestions_enabled_toggled"
"event_type":"sticker_upload_completed"
"event_type":"sticker_upload_started"
"event_type":"stop_ringing_call"
"event_type":"stop_speaking"
"event_type":"store_directory_browse_viewed"
"event_type":"store_directory_card_interacted"
"event_type":"store_directory_exited"
"event_type":"store_directory_hero_viewed"
"event_type":"store_directory_viewed"
"event_type":"store_listing_exited"
"event_type":"store_listing_media_scrolled"
"event_type":"store_listing_viewed"
"event_type":"streamer_first_frame_encrypted"
"event_type":"streamer_mode_toggle"
"event_type":"stream_report_problem"
"event_type":"stream_settings_update"
"event_type":"stream_warning_triggered"
"event_type":"subscription_lazy_sync_user_perks"
"event_type":"subscription_period_scheduled"
"event_type":"subscription_plan_updated"
"event_type":"subscription_removed"
"event_type":"subscription_update_attempt"
"event_type":"super_reaction_balance_viewed"
"event_type":"team_member_added"
"event_type":"text_area_cta_clicked"
"event_type":"text_copied"
"event_type":"text_in_voice_opened"
"event_type":"thread_browser_tab_changed"
"event_type":"thread_creation_started"
"event_type":"thread_notification_settings_updated"
"event_type":"thread_nudge_shown"
"event_type":"tiered_tenure_badge_clicked"
"event_type":"time_spent"
"event_type":"time_spent_wip"
"event_type":"tooltip_viewed"
"event_type":"transaction_completed"
"event_type":"unique_username_migrated"
"event_type":"update_connected_account"
"event_type":"update_game_relationship"
"event_type":"update_note"
"event_type":"update_relationship"
"event_type":"updater_metrics_combined"
"event_type":"updater_metrics_download"
"event_type":"updater_metrics_install"
"event_type":"updater_metrics_transition_status"
"event_type":"update_soundboard_settings"
"event_type":"update_sticker"
"event_type":"update_streamer_mode_settings"
"event_type":"update_user_settings"
"event_type":"update_user_settings_local"
"event_type":"upsell_clicked"
"event_type":"upsell_viewed"
"event_type":"user_account_updated"
"event_type":"user_adopted_guild_identity"
"event_type":"user_attribution_received"
"event_type":"user_avatar_updated"
"event_type":"user_custom_call_sound_setting_updated"
"event_type":"user_discovery_updated"
"event_type":"user_fingerprint_changed"
"event_type":"user_flow_transition"
"event_type":"user_friend_finder_updated"
"event_type":"user_ignored_action"
"event_type":"user_integration_removed"
"event_type":"user_merge_operation_completed"
"event_type":"user_merge_operation_created"
"event_type":"username_reservation_claimed"
"event_type":"user_premium_guild_subscription_slot_created"
"event_type":"user_profile_action"
"event_type":"user_profile_activity_action"
"event_type":"user_profile_activity_joined"
"event_type":"user_profile_badge_hovered"
"event_type":"user_profile_badge_pressed"
"event_type":"user_profile_edit_action"
"event_type":"user_profile_edit_saved"
"event_type":"user_profile_report_game_detection"
"event_type":"user_profile_updated"
"event_type":"user_profile_wishlist_action"
"event_type":"user_remediation_action"
"event_type":"user_report_submitted"
"event_type":"user_resurrection_notification_sent_supplemental"
"event_type":"user_settings_game_detection_toggle"
"event_type":"user_settings_keybind_updated"
"event_type":"user_settings_merch_link_clicked"
"event_type":"user_settings_merch_link_confirmed"
"event_type":"user_settings_search_press"
"event_type":"user_settings_search_result_press"
"event_type":"user_settings_swipe_to_reply_toggle"
"event_type":"user_status_updated"
"event_type":"user_voice_activity_viewed"
"event_type":"vc_tile_activities_entry_point_closed"
"event_type":"vc_tile_activities_entry_point_viewed"
"event_type":"verify_enqueue_requested"
"event_type":"verify_enqueue_succeeded"
"event_type":"video_background_added"
"event_type":"video_effect_updated"
"event_type":"video_event_times"
"event_type":"videohook_initialized"
"event_type":"video_input_initialized"
"event_type":"video_input_toggled"
"event_type":"video_layout_toggled"
"event_type":"video_spinner_shown"
"event_type":"video_spinner_shown_v2"
"event_type":"video_stream_ended"
"event_type":"video_stream_started"
"event_type":"video_toggled"
"event_type":"view_as_roles_selected"
"event_type":"view_hang_status"
"event_type":"view_premium_app_storefront"
"event_type":"view_voice_channel"
"event_type":"voice_activity_threshold_changed"
"event_type":"voice_bottom_sheet_expanded"
"event_type":"voice_channel_effect_bar_viewed"
"event_type":"voice_channel_effect_emoji_picker_expanded"
"event_type":"voice_channel_effect_fancy_animation_toggled"
"event_type":"voice_channel_effect_sent"
"event_type":"voice_channel_effect_viewed"
"event_type":"voice_channel_game_activity_indicator_set"
"event_type":"voice_channel_topic_set"
"event_type":"voice_channel_topic_viewed"
"event_type":"voice_codec_detected"
"event_type":"voice_connection_connecting"
"event_type":"voice_connection_failure"
"event_type":"voice_connection_remote_streams_created"
"event_type":"voice_connection_socket_failure"
"event_type":"voice_connection_success"
"event_type":"voice_connection_ttc_collected"
"event_type":"voice_disconnect"
"event_type":"voice_filter_playback_toggled"
"event_type":"voice_message_playback_ended"
"event_type":"voice_message_playback_started"
"event_type":"voice_message_recorded"
"event_type":"voice_panel_tab_opened"
"event_type":"voice_processing"
"event_type":"voice_quality_periodic_stats"
"event_type":"voice_queue_metrics"
"event_type":"webhook_created"
"event_type":"webhook_deleted"
"event_type":"welcome_cta_clicked"
"event_type":"widget_content_shown"
"event_type":"wishlist_updated"
"event_type":"yearly_subscription_reminder_email_attempt"
"event_type":"you_tab_avatar_press"
"event_type":"you_tab_custom_status_press"
"event_type":"you_tab_edit_profile_press"
"event_type":"you_tab_settings_icon_press"
