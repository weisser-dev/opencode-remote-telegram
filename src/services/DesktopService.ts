import { existsSync, readFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join, basename } from 'path';
import type { ProjectConfig, DesktopProjectInfo, DesktopSessionInfo } from '../types/index.js';

// ─── Types for Desktop state file ─────────────────────────────────────────────

interface GlobalSyncProjectEntry {
  id: string;
  worktree: string;
  vcs?: string;
  icon?: { color: string };
  time?: { created: number; updated: number };
  sandboxes?: unknown[];
}

interface ServerState {
  list: unknown[];
  projects?: {
    local?: Array<{ worktree: string; expanded?: boolean }>;
  };
  lastProject?: {
    local?: string;
  };
}

interface LayoutPageState {
  lastProjectSession?: Record<
    string,
    { directory: string; id: string; at: number }
  >;
}

type DesktopGlobalDat = Record<string, string>;

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Returns the path to the OpenCode Desktop global state file.
 * macOS: ~/Library/Application Support/ai.opencode.desktop/opencode.global.dat
 * Linux: ~/.config/ai.opencode.desktop/opencode.global.dat (XDG)
 */
export function getDesktopStatePath(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'ai.opencode.desktop',
      'opencode.global.dat',
    );
  }
  // Linux / fallback
  const xdgConfig =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(xdgConfig, 'ai.opencode.desktop', 'opencode.global.dat');
}

/**
 * Returns true if the Desktop state file exists on this machine.
 */
export function desktopStateExists(): boolean {
  return existsSync(getDesktopStatePath());
}

// ─── Raw state reader ─────────────────────────────────────────────────────────

/**
 * Reads and parses the Desktop global state file.
 * Returns null if the file doesn't exist or can't be parsed.
 */
function readDesktopState(): DesktopGlobalDat | null {
  const statePath = getDesktopStatePath();
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8')) as DesktopGlobalDat;
  } catch {
    return null;
  }
}

/**
 * Safely parses a JSON string value from the Desktop state.
 */
function parseStateValue<T>(raw: DesktopGlobalDat, key: string): T | null {
  const str = raw[key];
  if (!str) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// ─── Project discovery ────────────────────────────────────────────────────────

/**
 * Reads the OpenCode Desktop project registry (globalSync.project)
 * and returns ProjectConfig entries suitable for the bot.
 */
export function discoverDesktopProjects(): ProjectConfig[] {
  const raw = readDesktopState();
  if (!raw) return [];

  // globalSync.project is a JSON string containing { value: [...] }
  const projectData = parseStateValue<{ value: GlobalSyncProjectEntry[] }>(
    raw,
    'globalSync.project',
  );
  if (!projectData?.value) return [];

  return projectData.value
    .filter(p => p.worktree && p.worktree !== '/' && existsSync(p.worktree))
    .map(p => ({
      alias: basename(p.worktree),
      path: p.worktree,
      source: 'desktop' as const,
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

// ─── Rich project info ────────────────────────────────────────────────────────

/**
 * Returns detailed info for all Desktop projects — including icon color,
 * timestamps, pinned status, and last session info.
 */
export function getDesktopProjectInfos(): DesktopProjectInfo[] {
  const raw = readDesktopState();
  if (!raw) return [];

  const projectData = parseStateValue<{ value: GlobalSyncProjectEntry[] }>(
    raw,
    'globalSync.project',
  );
  const serverState = parseStateValue<ServerState>(raw, 'server');
  const layoutPage = parseStateValue<LayoutPageState>(raw, 'layout.page');

  if (!projectData?.value) return [];

  const pinnedPaths = new Set(
    serverState?.projects?.local?.map(p => p.worktree) ?? [],
  );
  const lastProject = serverState?.lastProject?.local;
  const sessions = layoutPage?.lastProjectSession ?? {};

  return projectData.value
    .filter(p => p.worktree && p.worktree !== '/' && existsSync(p.worktree))
    .map(p => {
      const session = sessions[p.worktree];
      return {
        alias: basename(p.worktree),
        path: p.worktree,
        source: 'desktop' as const,
        iconColor: p.icon?.color,
        createdAt: p.time?.created,
        updatedAt: p.time?.updated,
        pinned: pinnedPaths.has(p.worktree),
        isLastActive: p.worktree === lastProject,
        lastSessionId: session?.id,
        lastSessionAt: session?.at,
      };
    })
    .sort((a, b) => {
      // Sort: last active first, then pinned, then by last session time desc
      if (a.isLastActive && !b.isLastActive) return -1;
      if (!a.isLastActive && b.isLastActive) return 1;
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.lastSessionAt ?? 0) - (a.lastSessionAt ?? 0);
    });
}

// ─── Session history ──────────────────────────────────────────────────────────

/**
 * Returns recent Desktop sessions with project path, session ID and timestamp.
 * Sorted by most recent first.
 */
export function getDesktopSessions(): DesktopSessionInfo[] {
  const raw = readDesktopState();
  if (!raw) return [];

  const layoutPage = parseStateValue<LayoutPageState>(raw, 'layout.page');
  const sessions = layoutPage?.lastProjectSession;
  if (!sessions) return [];

  const serverState = parseStateValue<ServerState>(raw, 'server');
  const lastProject = serverState?.lastProject?.local;

  return Object.entries(sessions)
    .filter(([path]) => existsSync(path))
    .map(([path, info]) => ({
      alias: basename(path),
      path,
      sessionId: info.id,
      lastActiveAt: info.at,
      isLastActive: path === lastProject,
    }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

// ─── Pinned / sidebar projects ────────────────────────────────────────────────

/**
 * Returns the projects currently pinned/open in the Desktop sidebar.
 */
export function getDesktopPinnedProjects(): Array<{
  alias: string;
  path: string;
  expanded: boolean;
}> {
  const raw = readDesktopState();
  if (!raw) return [];

  const serverState = parseStateValue<ServerState>(raw, 'server');
  const locals = serverState?.projects?.local ?? [];

  return locals
    .filter(p => existsSync(p.worktree))
    .map(p => ({
      alias: basename(p.worktree),
      path: p.worktree,
      expanded: p.expanded ?? false,
    }));
}

/**
 * Returns the last active project path from Desktop, or undefined.
 */
export function getDesktopLastProject(): string | undefined {
  const raw = readDesktopState();
  if (!raw) return undefined;

  const serverState = parseStateValue<ServerState>(raw, 'server');
  return serverState?.lastProject?.local;
}
