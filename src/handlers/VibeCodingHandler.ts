import type { Context } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import { DataStore } from '../services/DataStore.js';
import { ProjectHandler } from './ProjectHandler.js';
import { ModelHandler } from './ModelHandler.js';

// ─── Active vibe-coding sessions ──────────────────────────────────────────────

const vibeSessions = new Set<string>();

export class VibeCodingHandler {
  static isActive(threadId: string): boolean {
    return vibeSessions.has(threadId);
  }

  static activate(threadId: string): void {
    vibeSessions.add(threadId);
  }

  static deactivate(threadId: string): void {
    vibeSessions.delete(threadId);
  }

  /** /vibe_coding */
  static async start(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);

    const alias = DataStore.getProject(threadId);
    const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;
    if (!alias || !projectPath) {
      await ctx.reply(
        '⚠️ No project selected.\n\nUse /sps to pick a project first.',
      );
      return;
    }

    const model = DataStore.getModel(threadId) ?? 'default';
    VibeCodingHandler.activate(threadId);

    await ctx.reply(
      `🎧 Vibe Coding started!\n\n` +
      `Project: ${alias}\n` +
      `Path: ${projectPath}\n` +
      `Model: ${model}\n\n` +
      `Just type what you want me to do — no commands needed.\n` +
      `I'll send everything straight to OpenCode.\n\n` +
      `To switch project: /switch_project <name>\n` +
      `To switch model: /switch_model <name>\n` +
      `To stop: /stop_coding`,
    );
  }

  /** /stop_coding */
  static async stop(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    VibeCodingHandler.deactivate(threadId);
    await ctx.reply('⏹ Vibe Coding stopped.');
  }
}
