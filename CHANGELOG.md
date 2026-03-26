# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] — 2026-03-26

First published npm release with OpenCode Desktop integration.

This is the same feature set as 1.1.0 but with the correct version pushed to the npm registry.

### Install / Update

```bash
npm install -g @weisser-dev/opencode-remote-telegram
```

### What's new since 1.0.0

See [1.1.0](#110--2026-03-26) below for the full feature list.

## [1.1.0] — 2026-03-26

### OpenCode Desktop Integration

Full integration with [OpenCode Desktop](https://opencode.ai) — projects you open in the Desktop app automatically appear in the Telegram bot.

#### New commands
- `/desktop_projects` — browse all Desktop projects with icon colors, pinned status, and last-used timestamps; tap to switch
- `/desktop_sessions` — view recent Desktop coding sessions sorted by last active time
- `/desktop_pinned` — show projects currently open in the Desktop sidebar

#### New service: `DesktopService.ts`
- Reads OpenCode Desktop state from `~/Library/Application Support/ai.opencode.desktop/opencode.global.dat` (macOS) or `~/.config/ai.opencode.desktop/` (Linux)
- Parses `globalSync.project`, `server`, and `layout.page` keys for project registry, pinned projects, and session history
- Live reading on every request — new projects in Desktop appear instantly in the bot

#### Improvements
- **Auto-discovery**: Desktop project discovery is now enabled by default when OpenCode Desktop is installed (no need to run `setup` again)
- **Enriched project list**: `/list_projects` buttons now show icon color dots and pinned status from Desktop
- **`/start` onboarding**: shows a "Desktop projects" quick button when Desktop is detected
- **`/help`**: lists the new Desktop Integration commands

#### Bug fix
- Fixed `discoverDesktopProjects()` parsing — the Desktop state wraps the project array in `{ "value": [...] }`, but the old code tried to parse it as a flat array. Projects from Desktop now actually appear.

#### Types
- Added `DesktopProjectInfo` and `DesktopSessionInfo` interfaces

## [1.0.0] — 2026-03-25

Initial release. Built with OpenCode & Claude Sonnet (Codex).

### Core
- **Telegram bot** for remote OpenCode CLI access
- **Interactive setup wizard** with first-run detection — config stored in `~/.config/opencode-remote-telegram/`
- **Global opencode.json** support — place at `~/.config/opencode-remote-telegram/opencode.json`
- **Per-instance random Basic Auth** for `opencode serve` — no static credentials
- **`opencode-remote-telegram test`** — CLI command to verify config, models, serve and prompt
- **`-d` / `--debug` / `--verbose`** flags — logs every in/out message
- **CI pipeline** (GitHub Actions) — build + test on push, no auto-publish

### UX & Streaming
- **True SSE streaming** via `message.part.delta` events
- **Rotating loading messages** while model is working (tools, reasoning)
- **Message splitting** for responses >4096 chars (Telegram limit)
- **SSE auto-reconnect** — exponential backoff, up to 5 retries
- **Inline keyboards** for project and model selection — tap to switch
- **Onboarding** — first `/start` shows welcome with feature overview and inline buttons
- **Resume prompt** — if vibe coding is inactive, bot offers to resume with last settings
- **Idle timeout** (10 min) — serve stops automatically when no interaction
- **Project switch** stops old serve instances, starts new one on demand
- **Model-not-found auto-retry** — falls back to server default

### Commands
- `/list_projects` / `/list_models` — inline keyboard tap-to-switch
- `/new_project` — clone wizard: GitHub URL → confirm dir → `git clone` → auto-select
- `/vibe_coding` / `/stop_coding` — passthrough coding session
- `/interrupt` — stop running task
- `/diff` — `git diff --stat HEAD`
- `/undo` — revert last git commit (soft reset, with confirmation)
- `/show_stats` / `/hide_stats` — token count, cost, duration after each response
- `/history` — last 10 prompts with cost
- `/costs` — daily & weekly cost summary
- `/queue_list` / `/queue_clear` / `/queue_settings`
- `/status` / `/clear` / `/help` / `/start`

### Observability
- **File logging** — daily log files at `~/.config/opencode-remote-telegram/logs/`
- **Session history** — persisted prompt/response/cost records (max 500)
- **Cost tracking** — aggregated by day and week via `/costs`
- **Debug middleware** — every incoming/outgoing event logged with `[in]`/`[out]` prefix

### Persistent state (`state.json`)
- Selected project and model survive restarts
- Stats enabled/disabled, queue settings, onboarding seen flag
- Prompt history with cost data

### Inspired by
- [RoundTable02/remote-opencode](https://github.com/RoundTable02/remote-opencode) — Discord variant
