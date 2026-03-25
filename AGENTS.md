# AGENTS.md — Rules for AI Agents

This file contains rules for any AI agent working on this repository.

## Project overview

**opencode-remote-telegram** is a Telegram bot that lets you control [OpenCode](https://opencode.ai) from your phone.

- **Language:** TypeScript (ESM, Node.js ≥ 22)
- **Build:** `tsc` (no bundler)
- **Test:** `vitest`
- **Package manager:** npm
- **Entry point:** `src/cli.ts`
- **Config location:** `~/.config/opencode-remote-telegram/`

## Architecture

```
src/
├── cli.ts                  # CLI entry point (commander)
├── bot.ts                  # Grammy bot setup, middleware, command routing
├── handlers/
│   ├── ExecutionHandler.ts # Prompt execution, SSE, stats, queue, /undo, /diff
│   ├── InfoHandlers.ts     # /start, /help, /status, /clear, /new_project
│   ├── ModelHandler.ts     # /list_models, model inline keyboards
│   ├── ProjectHandler.ts   # /list_projects, project inline keyboards
│   └── VibeCodingHandler.ts# /vibe_coding, /stop_coding state management
├── services/
│   ├── ConfigService.ts    # Config persistence (~/.config/...)
│   ├── DataStore.ts        # Persistent state (project, model, history, costs)
│   ├── ModelService.ts     # opencode models CLI wrapper + cache
│   ├── ServeManager.ts     # opencode serve lifecycle, idle timeout, auth
│   ├── SessionManager.ts   # Session create, prompt send, system prompt
│   └── SSEClient.ts        # EventSource with auto-reconnect
├── setup/
│   ├── SetupWizard.ts      # Interactive 4-step setup
│   └── ConnectionTest.ts   # opencode-remote-telegram test
├── types/
│   └── index.ts            # Shared TypeScript interfaces
└── utils/
    ├── AuthGuard.ts        # Telegram user authorization
    ├── AuthHelper.ts       # Basic Auth headers for serve
    ├── LoadingMessages.ts  # Witty rotating messages
    ├── Logger.ts           # Console + file logger with timestamps
    ├── Pricing.ts          # Token cost estimation (Claude/GPT pricing)
    └── TelegramFormatter.ts# Markdown→HTML conversion, message splitting
```

## NEVER include real credentials

- No API tokens, passwords, or secrets in code or commits
- Use clearly fake placeholders: `1234567890:ABCdef...example`
- Config files with real values live in `~/.config/` — never in the repo
- See `.gitignore` — no `.env` files are committed

## Telegram formatting rules

Telegram does NOT support markdown tables. All model output goes through `TelegramFormatter.ts`:
- `**bold**` → `<b>`
- `` `code` `` → `<code>`
- ```` ``` ```` → `<pre>`
- Markdown tables → `<pre>` (monospace)
- Messages >4096 chars are split at newline boundaries
- Each chunk gets balanced `<pre>` tags

The `SessionManager` prepends a system prompt that instructs models to format output for Telegram (no tables, short paragraphs, code in fenced blocks).

## Testing

```bash
npm test                    # vitest
npm run build               # tsc — must pass with no errors
opencode-remote-telegram test  # integration test (needs opencode in PATH)
```

## Release process

1. Update `CHANGELOG.md`
2. Go to GitHub Actions → "Release & Publish to npm" → Run workflow
3. Enter version (e.g. `1.1.0`) → pipeline builds, tests, publishes to npm, creates git tag + GitHub release
4. Never auto-publish — always manual trigger
