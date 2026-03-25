import { execSync, exec } from 'child_process';
import { getOpenCodeConfigPath } from './ConfigService.js';

// ─── Cache ────────────────────────────────────────────────────────────────────

let cachedModels: string[] = [];
let cacheTimestamp = 0;
let refreshInFlight = false;
const CACHE_TTL_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const globalConfig = getOpenCodeConfigPath();
  if (globalConfig) env.OPENCODE_CONFIG_PATH = globalConfig;
  return env;
}

function parseOutput(output: string): string[] {
  return output
    .split('\n')
    .map(m => m.trim().replace(/\r/g, ''))
    .filter(m => m.length > 0);
}

function refreshAsync(): void {
  if (refreshInFlight) return;
  refreshInFlight = true;
  exec('opencode models', { encoding: 'utf-8', timeout: 5000, env: buildEnv() }, (err, stdout) => {
    refreshInFlight = false;
    if (!err && stdout) {
      cachedModels = parseOutput(stdout);
      cacheTimestamp = Date.now();
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class ModelService {
  /**
   * Returns the cached model list, refreshing synchronously on first call
   * and asynchronously when the TTL expires.
   */
  static getModels(): string[] {
    const now = Date.now();
    if (cachedModels.length === 0) {
      try {
        const output = execSync('opencode models', {
          encoding: 'utf-8',
          timeout: 5000,
          env: buildEnv(),
        });
        cachedModels = parseOutput(output);
        cacheTimestamp = now;
      } catch { /* silent — empty list returned */ }
    } else if (now - cacheTimestamp > CACHE_TTL_MS) {
      refreshAsync();
    }
    return cachedModels;
  }

  /**
   * Parses "providerID/modelID" into its parts.
   * Returns null if the string has no slash.
   */
  static parseModelString(model: string): { providerID: string; modelID: string } | null {
    const clean = model.trim().replace(/\r/g, '');
    const idx = clean.indexOf('/');
    if (idx === -1) return null;
    return {
      providerID: clean.slice(0, idx),
      modelID: clean.slice(idx + 1),
    };
  }

  /** Invalidate the cache (e.g. after config changes). */
  static invalidate(): void {
    cachedModels = [];
    cacheTimestamp = 0;
  }
}
