import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './ConfigService.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

function getStateFile(): string {
  return join(getConfigDir(), 'state.json');
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface ThreadState {
  project?: string;
  model?: string;
  statsEnabled?: boolean;
  continueOnFailure?: boolean;
  seenOnboarding?: boolean;
}

interface HistoryEntry {
  timestamp: number;
  prompt: string;
  responseChars: number;
  model?: string;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  duration?: number;
}

interface State {
  threads: Record<string, ThreadState>;
  history: HistoryEntry[];
}

// ─── Persistence ──────────────────────────────────────────────────────────────

let _state: State | null = null;

function load(): State {
  if (_state) return _state;
  const file = getStateFile();
  if (!existsSync(file)) return (_state = { threads: {}, history: [] });
  try {
    _state = JSON.parse(readFileSync(file, 'utf-8')) as State;
    if (!_state.history) _state.history = [];
    return _state;
  } catch {
    return (_state = { threads: {}, history: [] });
  }
}

function persist(): void {
  writeFileSync(getStateFile(), JSON.stringify(_state, null, 2), 'utf-8');
}

function thread(threadId: string): ThreadState {
  const s = load();
  s.threads[threadId] ??= {};
  return s.threads[threadId];
}

function save(threadId: string, patch: Partial<ThreadState>): void {
  Object.assign(thread(threadId), patch);
  persist();
}

// ─── In-memory only (runtime queues) ─────────────────────────────────────────

import type { QueueItem, QueueSettings } from '../types/index.js';

const queues = new Map<string, QueueItem[]>();

// ─── Public API ───────────────────────────────────────────────────────────────

export class DataStore {
  // Queue (in-memory only — queues don't survive restart intentionally)
  static enqueue(item: QueueItem): void {
    const q = queues.get(item.threadId) ?? [];
    q.push(item);
    queues.set(item.threadId, q);
  }

  static dequeue(threadId: string): QueueItem | undefined {
    const q = queues.get(threadId);
    if (!q?.length) return undefined;
    const item = q.shift();
    queues.set(threadId, q);
    return item;
  }

  static getQueue(threadId: string): QueueItem[] {
    return queues.get(threadId) ?? [];
  }

  static clearQueue(threadId: string): void {
    queues.delete(threadId);
  }

  // Queue settings (persisted)
  static getQueueSettings(threadId: string): QueueSettings {
    return { continueOnFailure: thread(threadId).continueOnFailure ?? false };
  }

  static setQueueSettings(threadId: string, s: QueueSettings): void {
    save(threadId, { continueOnFailure: s.continueOnFailure });
  }

  // Model (persisted)
  static getModel(threadId: string): string | undefined {
    return thread(threadId).model;
  }

  static setModel(threadId: string, model: string): void {
    save(threadId, { model });
  }

  // Project (persisted)
  static getProject(threadId: string): string | undefined {
    return thread(threadId).project;
  }

  static setProject(threadId: string, alias: string): void {
    save(threadId, { project: alias });
  }

  // Stats visibility (persisted)
  static isStatsEnabled(threadId: string): boolean {
    return thread(threadId).statsEnabled ?? false;
  }

  static setStatsEnabled(threadId: string, enabled: boolean): void {
    save(threadId, { statsEnabled: enabled });
  }

  // Onboarding seen (persisted)
  static hasSeenOnboarding(threadId: string): boolean {
    return thread(threadId).seenOnboarding ?? false;
  }

  static markOnboardingSeen(threadId: string): void {
    save(threadId, { seenOnboarding: true });
  }

  // Full reset for /clear
  static clearAll(threadId: string): void {
    queues.delete(threadId);
    const s = load();
    delete s.threads[threadId];
    persist();
  }

  // ─── Session history (persisted) ──────────────────────────────────────────

  static addHistory(entry: {
    prompt: string;
    responseChars: number;
    model?: string;
    cost: number;
    tokensInput: number;
    tokensOutput: number;
    duration?: number;
  }): void {
    const s = load();
    s.history.push({ ...entry, timestamp: Date.now() });
    // Keep max 500 entries
    if (s.history.length > 500) s.history = s.history.slice(-500);
    persist();
  }

  static getHistory(limit = 10): HistoryEntry[] {
    return load().history.slice(-limit);
  }

  // ─── Cost tracking ────────────────────────────────────────────────────────

  static getCostsSince(sinceMs: number): { totalCost: number; totalInput: number; totalOutput: number; count: number } {
    const cutoff = Date.now() - sinceMs;
    const entries = load().history.filter(e => e.timestamp >= cutoff);
    return {
      totalCost: entries.reduce((s, e) => s + e.cost, 0),
      totalInput: entries.reduce((s, e) => s + e.tokensInput, 0),
      totalOutput: entries.reduce((s, e) => s + e.tokensOutput, 0),
      count: entries.length,
    };
  }
}
