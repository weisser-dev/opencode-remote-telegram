import { existsSync } from 'fs';
import { join, delimiter } from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { getOpenCodeConfigPath } from './ConfigService.js';
import { log } from '../utils/Logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServeInstance {
  port: number;
  username: string;
  password: string;
  process: ReturnType<typeof spawn>;
  startTime: number;
  exited: boolean;
  exitCode?: number | null;
  exitError?: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastActivity: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── State ────────────────────────────────────────────────────────────────────

const instances = new Map<string, ServeInstance>();

/** Returns the auth credentials for a given port, or undefined if not found. */
export function getAuthForPort(port: number): { username: string; password: string } | undefined {
  for (const inst of instances.values()) {
    if (inst.port === port) return { username: inst.username, password: inst.password };
  }
  return undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOpencodeCommandCandidates(): string[] {
  return ['opencode'];
}

function resolveCommandFromPath(command: string, pathValue?: string): string | undefined {
  if (!pathValue) return undefined;
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const resolved = join(entry, command);
    if (existsSync(resolved)) return resolved;
  }
  return undefined;
}

function resolveOpencodeCommand(env: NodeJS.ProcessEnv): string {
  const pathValue = env.PATH ?? env.Path;
  for (const command of getOpencodeCommandCandidates()) {
    const resolved = resolveCommandFromPath(command, pathValue);
    if (resolved) return resolved;
  }
  return getOpencodeCommandCandidates()[0];
}

function formatSpawnError(error: Error, command: string, projectPath: string): string {
  const err = error as NodeJS.ErrnoException;
  if (!existsSync(projectPath)) {
    return `Project path does not exist or is not accessible: ${projectPath}`;
  }
  if (err.code === 'ENOENT') {
    return `OpenCode executable not found: ${command}. Ensure opencode is installed and in PATH.`;
  }
  if (err.code === 'EACCES') {
    return `OpenCode executable is not accessible: ${command}. Check file permissions.`;
  }
  return err.message || 'Failed to spawn opencode process';
}

async function findAvailablePort(start = 14097): Promise<number> {
  const { createServer } = await import('net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(start, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === 'object' && addr ? addr.port : start));
    });
    server.on('error', () => findAvailablePort(start + 1).then(resolve).catch(reject));
  });
}

function instanceKey(projectPath: string): string {
  return projectPath;
}

function cleanupInstance(key: string): void {
  instances.delete(key);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function spawnServe(projectPath: string): Promise<number> {
  const key = instanceKey(projectPath);
  const existing = instances.get(key);

  if (existing && !existing.exited) return existing.port;
  if (existing?.exited) cleanupInstance(key);

  const port = await findAvailablePort();
  const args = ['serve', '--port', port.toString()];

  // Generate a random per-instance username/password for Basic Auth
  const username = 'opencode-remote';
  const password = randomBytes(24).toString('hex');

  // Always pass the global opencode config if configured — prevents projects
  // with a local opencode.json from overriding provider credentials
  const env: NodeJS.ProcessEnv = { ...process.env };
  const globalConfig = getOpenCodeConfigPath();
  if (globalConfig) {
    env.OPENCODE_CONFIG_PATH = globalConfig;
  }
  env.OPENCODE_SERVER_USERNAME = username;
  env.OPENCODE_SERVER_PASSWORD = password;

  const command = resolveOpencodeCommand(env);

  log.info(`[serve] spawning: ${command} ${args.join(' ')}`);
  log.info(`[serve] cwd: ${projectPath}`);
  if (globalConfig) log.info(`[serve] config: ${globalConfig}`);

  const child = spawn(command, args, {
    cwd: projectPath,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const instance: ServeInstance = {
    port,
    username,
    password,
    process: child,
    startTime: Date.now(),
    exited: false,
    lastActivity: Date.now(),
  };
  instances.set(key, instance);
  resetIdleTimer(key);

  let stderr = '';
  let stdout = '';

  child.stdout?.on('data', (d: Buffer) => {
    const t = d.toString().trim();
    stdout = (stdout + t).slice(-2000);
    log.info(`[serve:${port}] ${t}`);
  });
  child.stderr?.on('data', (d: Buffer) => {
    const t = d.toString().trim();
    stderr = (stderr + t).slice(-2000);
    log.warn(`[serve:${port}] ${t}`);
  });
  child.on('exit', (code) => {
    const inst = instances.get(key);
    if (!inst) return;
    inst.exited = true;
    inst.exitCode = code;
    if (code !== 0 && code !== null) {
      inst.exitError = stderr.trim() || stdout.trim() || `Process exited with code ${code}`;
      log.error(`[serve:${port}] exited with code ${code}: ${inst.exitError}`);
    } else {
      log.info(`[serve:${port}] process exited cleanly`);
    }
  });
  child.on('error', (error) => {
    const msg = formatSpawnError(error, command, projectPath);
    log.error(`[serve:${port}] spawn error: ${msg}`);
    const inst = instances.get(key);
    if (inst) { inst.exited = true; inst.exitError = msg; }
  });

  return port;
}

export async function waitForReady(
  port: number,
  projectPath: string,
  timeout = 30_000,
): Promise<void> {
  const key = instanceKey(projectPath);
  const url = `http://127.0.0.1:${port}/session`;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const inst = instances.get(key);
    if (inst?.exited) {
      const msg = inst.exitError ?? `opencode serve exited with code ${inst.exitCode}`;
      cleanupInstance(key);
      throw new Error(`opencode serve failed to start: ${msg}`);
    }
    try {
      const res = await fetch(url);
      // 200 or 401 both mean the server is up
      if (res.ok || res.status === 401) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }

  const inst = instances.get(key);
  if (inst?.exited) {
    const msg = inst.exitError ?? `opencode serve exited with code ${inst.exitCode}`;
    cleanupInstance(key);
    throw new Error(`opencode serve failed to start: ${msg}`);
  }
  throw new Error(`Service at port ${port} failed to become ready within ${timeout}ms.`);
}

// ─── Idle timer ───────────────────────────────────────────────────────────────

function resetIdleTimer(key: string): void {
  const inst = instances.get(key);
  if (!inst) return;
  if (inst.idleTimer) clearTimeout(inst.idleTimer);
  inst.idleTimer = setTimeout(() => {
    const i = instances.get(key);
    if (i && !i.exited) {
      log.info(`[serve:${i.port}] idle timeout (${IDLE_TIMEOUT_MS / 1000}s) — stopping`);
      try { i.process.kill(); } catch { /* ignore */ }
      cleanupInstance(key);
    }
  }, IDLE_TIMEOUT_MS);
}

/** Call after every user interaction to keep the serve alive. */
export function touchActivity(projectPath: string): void {
  const key = instanceKey(projectPath);
  const inst = instances.get(key);
  if (!inst) return;
  inst.lastActivity = Date.now();
  resetIdleTimer(key);
}

/** Stop all serve instances except the given project (used on project switch). */
export function stopAllExcept(keepProjectPath?: string): void {
  for (const [key, inst] of instances) {
    if (keepProjectPath && key === instanceKey(keepProjectPath)) continue;
    log.info(`[serve:${inst.port}] stopping (project switched)`);
    if (inst.idleTimer) clearTimeout(inst.idleTimer);
    try { inst.process.kill(); } catch { /* ignore */ }
    instances.delete(key);
  }
}

export function getPort(projectPath: string): number | undefined {
  return instances.get(instanceKey(projectPath))?.port;
}

export function stopServe(projectPath: string): boolean {
  const key = instanceKey(projectPath);
  const inst = instances.get(key);
  if (!inst) return false;
  if (inst.idleTimer) clearTimeout(inst.idleTimer);
  inst.process.kill();
  cleanupInstance(key);
  return true;
}

export function stopAll(): void {
  for (const [key, inst] of instances) {
    if (inst.idleTimer) clearTimeout(inst.idleTimer);
    try { inst.process.kill(); } catch { /* ignore */ }
    instances.delete(key);
  }
}
