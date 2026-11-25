---
type: Contract
title: Label placeholders
description: The {token} placeholders that fill the panel label (bar-format) and the extra popup rows (tooltip-format), shared and per vendor.
tags: [pure-modules]
generated:
  by: claude/opus-5-5
  at: 2026-11-25T15:00:00Z
sources:
  - id: format
    title: lib/format.js
    resource: lib/format.js
  - id: config
    title: prefs/general.js
    resource: prefs/general.js
  - id: openrouter
    title: lib/vendors/openrouter/parser.js
    resource: lib/vendors/openrouter/parser.js
  - id: deepseek
    title: lib/vendors/deepseek/parser.js
    resource: lib/vendors/deepseek/parser.js
  - id: ollama
    title: lib/vendors/ollama/parser.js
    resource: lib/vendors/ollama/parser.js
---

# Where they apply

Two settings take `{token}` placeholders, both under *General* in preferences:[^config]

- **Bar format** under *Panel* (`bar-format`, default `{session_pct}% · {session_reset}`). Each pinned vendor fills its own segment.
- **Popup format** under *Popup* (`tooltip-format`, extra popup rows, empty by default). One row per line.

Each vendor's parser fills a map of values; `substitute()` swaps every `{token}` it knows. An unknown token is left as typed, and a window the vendor did not report resolves to an empty string.[^format] With **Pace arrows** on, the session arrow is appended to the label, unless the format already places a pace token.[^format]

# Shared tokens

Every vendor provides:

| Token | Value |
| --- | --- |
| `{icon}`, `{vendor_short}` | The vendor's icon glyph and short code |
| `{plan}` | Plan name |
| `{session_pct}`, `{weekly_pct}` | Percentage used |
| `{session_reset}`, `{weekly_reset}` | Countdown to the reset, like `4h 05m` |
| `{session_elapsed}`, `{weekly_elapsed}` | Share of the window already passed |
| `{session_pace}`, `{weekly_pace}` | `↑` ahead of pace, `→` on track, `↓` under (only vendors with a reset time) |

OpenRouter and DeepSeek have no usage windows. There `{session_pct}` / `{weekly_pct}` hold the consumed share (OpenRouter) or `0` (DeepSeek), the `*_reset` tokens are `-` and the `*_elapsed` ones `0`.[^openrouter][^deepseek] See [pace](/features/pace.md) for what the arrows mean.

# Vendor tokens

| Vendor | Its own tokens |
| --- | --- |
| Anthropic | `{sonnet_pct}`, `{sonnet_reset}`, `{sonnet_elapsed}`, `{sonnet_pace}`; for each of `session`, `weekly`, `sonnet`: `_pace_indicator`, `_pace_pct`, `_pace_pts`, `_pace_delta`, `_pace_abs_delta`; `{extra_spent}`, `{extra_limit}`, `{extra_pct}`; `{resets_available}` (banked resets), `{resets}` (`2 resets available`) |
| OpenAI | `{oai_plan}`; `{oai_session_*}` and `{oai_weekly_*}` with `_pct`, `_reset`, `_elapsed`, `_pace`, `_pace_indicator`; `{oai_code_review_pct}`, `{oai_credit_balance}`, `{oai_local_msgs}`, `{oai_cloud_msgs}`; `{oai_resets_available}`, `{oai_resets}` |
| Z.AI | `{zai_plan}`; `{zai_session_*}`, `{zai_weekly_*}`, `{zai_mcp_*}` with `_pct`, `_reset`, `_elapsed`, `_pace`, `_pace_indicator` |
| OpenRouter | `{or_label}`, `{or_balance}`, `{or_total}`, `{or_used}`, `{or_used_today}`, `{or_used_week}`, `{or_used_month}`, `{or_consumed_pct}`, `{or_free_tier}`, `{or_limit}`, `{or_limit_remaining}` |
| DeepSeek | `{ds_balance}`, `{ds_granted}`, `{ds_topped_up}`, `{ds_available}`, `{currency}` |
| Kimi | `{kimi_plan}`, `{kimi_window_pct}`, `{kimi_window_reset}`, `{kimi_weekly_pct}`, `{kimi_weekly_reset}`, `{kimi_monthly_pct}`, `{kimi_monthly_reset}` |
| Ollama Cloud | `{oll_plan}`; `{oll_session_*}`, `{oll_weekly_*}`, `{oll_monthly_*}` with `_pct`, `_reset`, `_elapsed`, `_pace`, `_pace_indicator`; on a credits plan `{oll_balance}`, `{oll_allowance}`, `{oll_purchased}`; `{oll_cost}` is always `-`, kept so older formats render[^ollama] |
| Custom provider | `{custom_plan}`, `{custom_<i>_pct}`, `{custom_<i>_reset}` for each metric, counting from 0 ([custom provider setup](/features/custom-provider-setup.md)) |

# Examples

| Format | Shows |
| --- | --- |
| `{session_pct}% · {session_reset}` | `42% · 3h 12m` |
| `{session_pct}%` | `42%` (compact, good with several pinned vendors) |
| `{session_pct}% {session_pace} · W {weekly_pct}%` | `42% ↑ · W 18%` |
