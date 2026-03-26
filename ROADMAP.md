# Roadmap

## v1.1.0 — OpenCode Desktop Integration (released)

- [x] Auto-discover projects from OpenCode Desktop
- [x] `/desktop_projects` — browse Desktop projects with metadata
- [x] `/desktop_sessions` — view recent Desktop sessions
- [x] `/desktop_pinned` — show Desktop sidebar projects
- [x] Enriched project list with icon colors and pinned status
- [x] Auto-enable Desktop discovery when Desktop is installed

## v1.2.0 — Observability

- [ ] Session history — show last N prompts/responses for current project
- [ ] Cost tracking over time (daily/weekly summary via `/costs`)
- [ ] File logging improvements (log rotation, configurable retention)

## v2.0.0 — Advanced

- [ ] OpenCode plugin integration (if OpenCode plugin API stabilizes)
- [ ] Multiple simultaneous coding sessions (one per project)
- [ ] Webhook mode (instead of polling) for production deployments
- [ ] Docker image for self-hosting
- [ ] Resume Desktop sessions — continue a coding session started in Desktop from Telegram

## Ideas (unplanned)

- [ ] GitHub notifications — PR created, CI status pushed to Telegram
- [ ] Project scaffolding — `/new_project` with templates (Vite, Next.js, etc.)
- [ ] Sync model selection between Desktop and Telegram
- [ ] Desktop file tree browsing from Telegram
