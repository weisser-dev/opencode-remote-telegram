# opencode-remote-telegram

> Control [OpenCode](https://opencode.ai) from your phone via Telegram.

You know controlling an agent tool via Telegram from OpenClaw? Or asking OpenCode from Discord? This is the solution for **OpenCode from Telegram**.

**npm:** [npmjs.com/package/opencode-remote-telegram](https://www.npmjs.com/package/opencode-remote-telegram)
**GitHub:** [github.com/weisser-dev/opencode-remote-telegram](https://github.com/weisser-dev/opencode-remote-telegram)

---

## Quickstart

```bash
npm install -g opencode-remote-telegram
opencode-remote-telegram start
```

On first run, the setup wizard launches automatically and walks you through everything step by step.

---

## CLI

```
Usage: opencode-remote-telegram [options] [command]

Options:
  -v, --version   Show version number
  -d, --debug     Enable debug logging
  --verbose       Alias for --debug
  -h, --help      Display help

Commands:
  start           Start the Telegram bot
  setup           Run the interactive setup wizard
  test            Test connection to OpenCode (models, serve, prompt)
```

### Examples

```bash
# First-time setup (or re-configure)
opencode-remote-telegram setup

# Verify everything works before going to Telegram
opencode-remote-telegram test

# Start the bot
opencode-remote-telegram start

# Start with debug logging (logs every in/out message)
opencode-remote-telegram --debug start
```

---

## Setup wizard

```bash
opencode-remote-telegram setup
```

The wizard covers four steps:

**1. Telegram Bot Token**
- Open Telegram → search for **@BotFather**
- Send `/newbot` and follow the instructions
- Copy the token (looks like `1234567890:ABCdef…`) and paste it in
- The token is stored in `~/.config/opencode-remote-telegram/config.json` — never committed to any repo

**2. Access control**
- Find your Telegram user ID by messaging **@userinfobot**
- Enter your ID (and any others you want to allow)
- Leave empty to allow anyone — not recommended for public bots

**3. Projects base directory**
- Point to the folder that contains your projects
- Every subdirectory is auto-discovered as a project
- Example: `~/Projects` → discovers `~/Projects/my-app`, `~/Projects/api`, …

**4. OpenCode config**

When starting a coding session, `opencode-remote-telegram` runs `opencode serve` in your project directory. OpenCode will look for an `opencode.json` there — but project-level configs often lack provider credentials (`baseURL`, `apiKey`) and will fail with `"undefined/chat/completions"`.

**Recommended:** use a single global config for all projects.

Place your `opencode.json` here and it will always be loaded first, overriding any project-level config:
```
~/.config/opencode-remote-telegram/opencode.json
```

---

## Configuration

All config is stored in `~/.config/opencode-remote-telegram/`. No `.env` file needed.

| File | Purpose |
|---|---|
| `config.json` | Bot token, allowed users, project path, opencode config path |
| `opencode.json` | Global OpenCode config (providers, models, credentials) |
| `state.json` | Persisted state (selected project/model per chat, settings) |

Environment variables override the stored config — useful for CI or Docker:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS` | Comma-separated Telegram user IDs |
| `PROJECTS_BASE_PATH` | Base directory for project discovery |
| `OPENCODE_CONFIG_PATH` | Path to a global opencode.json |
| `HTTPS_PROXY` | HTTP/HTTPS proxy |

---

## Telegram Commands

### Projects
| Command | Description |
|---|---|
| `/list_projects` | Inline keyboard — tap to switch project |
| `/new_project` | Clone a GitHub repo interactively |
| `/switch_project <alias>` | Switch project by name |

### Models
| Command | Description |
|---|---|
| `/list_models` | Inline keyboard — tap to switch model |
| `/switch_model <name>` | Switch model by name |

### Coding
| Command | Description |
|---|---|
| `/vibe_coding` | Start a passthrough coding session |
| `/stop_coding` | Stop the current session |
| `/interrupt` | Interrupt a running task |
| `/diff` | Show `git diff --stat HEAD` for current project |
| `/undo` | Revert last git commit (soft reset, with confirmation) |

### Queue
| Command | Description |
|---|---|
| `/queue_list` | Show queued prompts |
| `/queue_clear` | Clear the queue |
| `/queue_settings` | Toggle continue-on-failure (inline button) |

### Stats & History
| Command | Description |
|---|---|
| `/show_stats` | Show token count, cost and duration after each response |
| `/hide_stats` | Hide stats |
| `/history` | Last 10 prompts with model, cost and response size |
| `/costs` | Daily and weekly cost summary |

### Info & Settings
| Command | Description |
|---|---|
| `/status` | Current project, model, queue and settings |
| `/clear` | Reset project, model, queue and all settings |
| `/help` | All commands |
| `/start` | Welcome / onboarding |

---

## How it works

```
Your Phone (Telegram)
        │
        ▼
opencode-remote-telegram
        │  spawns per project, on demand
        │  per-instance random Basic Auth
        │  idle timeout: 10 min
        ▼
opencode serve  (HTTP API + SSE streaming)
        │
        ▼
Your Codebase
```

1. The bot spawns `opencode serve` when you start a coding session
2. Each instance gets a randomly generated password — no static credentials
3. Prompts are forwarded via the OpenCode HTTP API
4. Responses stream back in real time via SSE (`message.part.delta`)
5. A thinking indicator (🤔) shows while the model is working
6. Switching projects stops the old serve and starts a new one
7. After 10 minutes without interaction, the serve is stopped automatically

---

## Onboarding flow

On first `/start`, the bot shows an interactive welcome with inline buttons:

```
/start → Pick a project (button) → Pick a model (button) → Start /vibe_coding (button)
```

If no projects or models are found, the bot directs you to run `setup` and `test` in the terminal first.

---

## Debug logging

```bash
# Via flag
opencode-remote-telegram --debug start

# Via environment variable
DEBUG=1 opencode-remote-telegram start
```

Debug output shows every incoming message, command, callback and outgoing reply:
```
07:07:41 [DEBUG] [in] @user command: /vibe_coding
07:07:41 [DEBUG] [in] @user text: "fix the auth bug"
07:07:42 [DEBUG] [out] → @user: "🤔 Let me have a look…"
07:07:44 [DEBUG] [out] → @user: "I found the issue in…"
```

---

## Requirements

- Node.js ≥ 22
- [opencode](https://opencode.ai) installed and in `PATH`
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

---

## Inspired by

This project was inspired by [RoundTable02/remote-opencode](https://github.com/RoundTable02/remote-opencode) — if you're looking for a way to control OpenCode via **Discord** instead of Telegram, check it out.

---

## License

MIT
