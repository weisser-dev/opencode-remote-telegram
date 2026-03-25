import pc from 'picocolors';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../services/ConfigService.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

function prefix(level: LogLevel): string {
  const ts = pc.dim(timestamp());
  switch (level) {
    case 'info':  return `${ts} ${pc.cyan('[INFO] ')}`;
    case 'warn':  return `${ts} ${pc.yellow('[WARN] ')}`;
    case 'error': return `${ts} ${pc.red('[ERROR]')}`;
    case 'debug': return `${ts} ${pc.dim('[DEBUG]')}`;
  }
}

// ─── File logging ─────────────────────────────────────────────────────────────

let fileLoggingEnabled = false;
let logDir = '';

export function enableFileLogging(): void {
  logDir = join(getConfigDir(), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  fileLoggingEnabled = true;
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(logDir, `${date}.log`);
}

function writeToFile(level: string, message: string): void {
  if (!fileLoggingEnabled) return;
  try {
    const line = `${isoTimestamp()} [${level.toUpperCase().padEnd(5)}] ${message}\n`;
    appendFileSync(getLogFile(), line, 'utf-8');
  } catch { /* non-critical — don't crash the bot for a log write */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const log = {
  info: (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    console.log(prefix('info'), msg);
    writeToFile('INFO', msg);
  },
  warn: (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    console.warn(prefix('warn'), msg);
    writeToFile('WARN', msg);
  },
  error: (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    console.error(prefix('error'), msg);
    writeToFile('ERROR', msg);
  },
  debug: (...args: unknown[]) => {
    const msg = args.map(String).join(' ');
    if (process.env.DEBUG) console.log(prefix('debug'), msg);
    writeToFile('DEBUG', msg);
  },
};
