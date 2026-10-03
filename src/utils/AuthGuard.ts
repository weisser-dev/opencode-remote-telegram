import type { Context } from 'grammy';
import { getBotConfig } from '../services/ConfigService.js';

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Fail-closed: an empty/missing allowlist authorizes NOBODY.
 */
export function isUserAllowed(userId: number | undefined, allowedUserIds: readonly number[] | undefined): boolean {
  if (userId === undefined || !Number.isSafeInteger(userId)) return false;
  if (!allowedUserIds || allowedUserIds.length === 0) return false;
  return allowedUserIds.includes(userId);
}

export function isAuthorized(ctx: Context): boolean {
  const config = getBotConfig();
  if (!config) return false;
  return isUserAllowed(ctx.from?.id, config.allowedUserIds);
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
