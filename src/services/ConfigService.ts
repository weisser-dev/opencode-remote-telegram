import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { BotConfig, ProjectConfig } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.config', 'opencode-remote-telegram');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFile(): string {
  return CONFIG_FILE;
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

// ─── First-run detection ──────────────────────────────────────────────────────

/**
 * Returns true if no config file exists yet — triggers setup wizard on first run.
 */
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_FILE);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function load(): Partial<BotConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(patch: Partial<BotConfig>): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...load(), ...patch }, null, 2), 'utf-8');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getBotConfig(): BotConfig | null {
  const stored = load();

  // Env vars override stored config — useful for CI/container deployments
  const token = process.env.TELEGRAM_BOT_TOKEN ?? stored.telegramToken;
  if (!token) return null;

  const rawIds = process.env.TELEGRAM_ALLOWED_USER_IDS ?? '';
  const allowedUserIds = rawIds
    ? rawIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : (stored.allowedUserIds ?? []);

  const projectsBasePath = process.env.PROJECTS_BASE_PATH
    ? expandHome(process.env.PROJECTS_BASE_PATH)
    : stored.projectsBasePath ? expandHome(stored.projectsBasePath) : undefined;

  const openCodeConfigPath = process.env.OPENCODE_CONFIG_PATH
    ? expandHome(process.env.OPENCODE_CONFIG_PATH)
    : stored.openCodeConfigPath ? expandHome(stored.openCodeConfigPath) : undefined;

  return {
    telegramToken: token,
    allowedUserIds,
    projectsBasePath,
    openCodeConfigPath,
    useGlobalConfig: stored.useGlobalConfig ?? true,
  };
}

export function hasBotConfig(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN ?? load().telegramToken);
}

export function getProjectsBasePath(): string | undefined {
  const env = process.env.PROJECTS_BASE_PATH;
  if (env) return expandHome(env);
  const stored = load().projectsBasePath;
  return stored ? expandHome(stored) : undefined;
}

export function getOpenCodeConfigPath(): string | undefined {
  const env = process.env.OPENCODE_CONFIG_PATH;
  if (env) return expandHome(env);
  const stored = load().openCodeConfigPath;
  return stored ? expandHome(stored) : undefined;
}

export function isUsingGlobalConfig(): boolean {
  return load().useGlobalConfig ?? true;
}

// ─── Project discovery ────────────────────────────────────────────────────────

export function discoverProjects(): ProjectConfig[] {
  const basePath = getProjectsBasePath();
  if (!basePath || !existsSync(basePath)) return [];

  try {
    return readdirSync(basePath)
      .filter(e => !e.startsWith('.') && e !== 'node_modules')
      .filter(e => { try { return statSync(join(basePath, e)).isDirectory(); } catch { return false; } })
      .map(e => ({ alias: e, path: join(basePath, e) }))
      .sort((a, b) => a.alias.localeCompare(b.alias));
  } catch {
    return [];
  }
}
