import type { Context } from 'grammy';
import { getBotConfig } from '../services/ConfigService.js';

// ─── Auth guard ───────────────────────────────────────────────────────────────

export function isAuthorized(ctx: Context): boolean {
  const config = getBotConfig();
  if (!config) return false;
  if (config.allowedUserIds.length === 0) return true; // open if no list configured
  const userId = ctx.from?.id;
  return userId !== undefined && config.allowedUserIds.includes(userId);
}

export async function rejectUnauthorized(ctx: Context): Promise<boolean> {
  if (!isAuthorized(ctx)) {
    await ctx.reply('⛔ Unauthorized.');
    return true;
  }
  return false;
}

// ─── Thread ID helper ─────────────────────────────────────────────────────────

export function getThreadId(ctx: Context): string {
  const chatId = ctx.chat?.id ?? 0;
  const topicId = ctx.message?.message_thread_id;
  return topicId ? `${chatId}:${topicId}` : String(chatId);
}
