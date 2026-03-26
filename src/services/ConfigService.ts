import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { BotConfig, ProjectConfig } from '../types/index.js';
import { discoverDesktopProjects, desktopStateExists } from './DesktopService.js';

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

  // Backward compat: single projectsBasePath → array
  const projectsBasePaths = resolveBasePaths(stored);

  const openCodeConfigPath = process.env.OPENCODE_CONFIG_PATH
    ? expandHome(process.env.OPENCODE_CONFIG_PATH)
    : stored.openCodeConfigPath ? expandHome(stored.openCodeConfigPath) : undefined;

  return {
    telegramToken: token,
    allowedUserIds,
    projectsBasePaths,
    openCodeConfigPath,
    useGlobalConfig: stored.useGlobalConfig ?? true,
    discoverDesktopProjects: stored.discoverDesktopProjects,
  };
}

/**
 * Resolves base paths from env, stored array, or legacy single path.
 * Env var PROJECTS_BASE_PATHS (comma-separated) takes precedence,
 * then PROJECTS_BASE_PATH (single, legacy), then stored config.
 */
function resolveBasePaths(stored: Partial<BotConfig>): string[] {
  // Env: new multi-path variable
  const envMulti = process.env.PROJECTS_BASE_PATHS;
  if (envMulti) {
    return envMulti.split(',').map(s => expandHome(s.trim())).filter(Boolean);
  }

  // Env: legacy single path
  const envSingle = process.env.PROJECTS_BASE_PATH;
  if (envSingle) {
    return [expandHome(envSingle)];
  }

  // Stored: new array
  if (stored.projectsBasePaths?.length) {
    return stored.projectsBasePaths.map(p => expandHome(p));
  }

  // Stored: legacy single path
  if (stored.projectsBasePath) {
    return [expandHome(stored.projectsBasePath)];
  }

  return [];
}

export function hasBotConfig(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN ?? load().telegramToken);
}

export function getProjectsBasePaths(): string[] {
  return resolveBasePaths(load());
}

/**
 * @deprecated Use getProjectsBasePaths(). Kept for backward compat in places
 * that only need the first (or only) base path, e.g. cloning.
 */
export function getProjectsBasePath(): string | undefined {
  const paths = getProjectsBasePaths();
  return paths.length > 0 ? paths[0] : undefined;
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

export function isDesktopDiscoveryEnabled(): boolean {
  const stored = load().discoverDesktopProjects;
  // Auto-enable when explicitly set to true, or when not configured but Desktop exists
  if (stored !== undefined) return stored;
  return desktopStateExists();
}

// ─── Project discovery ────────────────────────────────────────────────────────

/**
 * Discovers projects from a single base directory (all subdirectories).
 */
function discoverFromFolder(basePath: string): ProjectConfig[] {
  if (!existsSync(basePath)) return [];

  try {
    return readdirSync(basePath)
      .filter(e => !e.startsWith('.') && e !== 'node_modules')
      .filter(e => { try { return statSync(join(basePath, e)).isDirectory(); } catch { return false; } })
      .map(e => ({ alias: e, path: join(basePath, e), source: 'folder' as const }))
      .sort((a, b) => a.alias.localeCompare(b.alias));
  } catch {
    return [];
  }
}

/**
 * Discovers all projects from all configured sources:
 *  1. All projectsBasePaths (subdirectory scanning)
 *  2. OpenCode Desktop project registry (if enabled)
 *
 * Deduplicates by path — folder sources take precedence over desktop sources.
 */
export function discoverProjects(): ProjectConfig[] {
  const seen = new Map<string, ProjectConfig>();

  // 1. Folder-based discovery from all configured base paths
  for (const basePath of getProjectsBasePaths()) {
    for (const project of discoverFromFolder(basePath)) {
      if (!seen.has(project.path)) {
        seen.set(project.path, project);
      }
    }
  }

  // 2. Desktop discovery (if enabled)
  if (isDesktopDiscoveryEnabled()) {
    for (const project of discoverDesktopProjects()) {
      if (!seen.has(project.path)) {
        seen.set(project.path, project);
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.alias.localeCompare(b.alias));
}
