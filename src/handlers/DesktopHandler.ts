import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import {
  getDesktopSessions,
  getDesktopProjectInfos,
  getDesktopPinnedProjects,
  getDesktopLastProject,
  desktopStateExists,
} from '../services/DesktopService.js';
import { DataStore } from '../services/DataStore.js';
import { isDesktopDiscoveryEnabled } from '../services/ConfigService.js';
import { log } from '../utils/Logger.js';

// ─── Icon color → emoji mapping ──────────────────────────────────────────────

const COLOR_EMOJI: Record<string, string> = {
  red: '🔴', orange: '🟠', yellow: '🟡', lime: '🟢', green: '🟢',
  mint: '🟢', cyan: '🔵', blue: '🔵', purple: '🟣', pink: '🩷',
};

function colorDot(color?: string): string {
  if (!color) return '⚪';
  return COLOR_EMOJI[color.toLowerCase()] ?? '⚪';
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── /desktop_projects — show Desktop project registry ───────────────────────

export class DesktopHandler {
  /** /desktop_projects — rich project list from Desktop */
  static async listProjects(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;

    if (!desktopStateExists()) {
      await ctx.reply(
        'OpenCode Desktop not detected on this machine.\n\n' +
        'Install it from https://opencode.ai and open some projects — ' +
        'they will automatically appear here.',
      );
      return;
    }

    const infos = getDesktopProjectInfos();
    if (infos.length === 0) {
      await ctx.reply('No projects found in OpenCode Desktop.');
      return;
    }

    const threadId = getThreadId(ctx);
    const currentAlias = DataStore.getProject(threadId);

    const lines = infos.map(p => {
      const dot = colorDot(p.iconColor);
      const pin = p.pinned ? '📌 ' : '';
      const active = p.isLastActive ? ' [active]' : '';
      const current = p.alias === currentAlias ? ' << current' : '';
      const lastUsed = p.lastSessionAt ? ` (${relativeTime(p.lastSessionAt)})` : '';
      return `${dot} ${pin}${p.alias}${active}${current}${lastUsed}\n   ${p.path}`;
    });

    const kb = new InlineKeyboard();
    // Add buttons for the top 8 projects
    for (const p of infos.slice(0, 8)) {
      const pin = p.pinned ? '📌 ' : '';
      const dot = colorDot(p.iconColor);
      const label = p.alias === currentAlias
        ? `✅ ${dot} ${pin}${p.alias}`
        : `${dot} ${pin}${p.alias}`;
      kb.text(label, `dtp:${p.alias}`).row();
    }

    await ctx.reply(
      `🖥 OpenCode Desktop Projects (${infos.length})\n\n${lines.join('\n\n')}`,
      { reply_markup: kb },
    );
  }

  /** Callback for desktop project selection buttons */
  static async handleProjectCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data ?? '';
    const alias = data.startsWith('dtp:') ? data.slice(4) : undefined;
    if (!alias) { await ctx.answerCallbackQuery(); return; }

    const infos = getDesktopProjectInfos();
    const project = infos.find(p => p.alias === alias);
    if (!project) {
      await ctx.answerCallbackQuery('Project not found.');
      return;
    }

    DataStore.setProject(threadId, alias);
    await ctx.answerCallbackQuery(`Switched to ${alias}`);
    await ctx.editMessageText(
      `✅ Project: ${alias}\n${project.path}`,
    );
    log.info(`[desktop] switched to ${alias}`);
  }

  /** /desktop_sessions — show recent Desktop sessions */
  static async listSessions(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;

    if (!desktopStateExists()) {
      await ctx.reply(
        'OpenCode Desktop not detected on this machine.\n\n' +
        'Install it from https://opencode.ai — recent sessions will appear here.',
      );
      return;
    }

    const sessions = getDesktopSessions();
    if (sessions.length === 0) {
      await ctx.reply('No recent sessions found in OpenCode Desktop.');
      return;
    }

    const lines = sessions.map((s, i) => {
      const active = s.isLastActive ? ' [active]' : '';
      const time = relativeTime(s.lastActiveAt);
      const date = new Date(s.lastActiveAt).toLocaleString('en-GB', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      return `${i + 1}. ${s.alias}${active}\n   ${date} (${time})\n   ${s.sessionId}`;
    });

    const kb = new InlineKeyboard();
    for (const s of sessions.slice(0, 6)) {
      const label = s.isLastActive
        ? `✅ ${s.alias} (${relativeTime(s.lastActiveAt)})`
        : `${s.alias} (${relativeTime(s.lastActiveAt)})`;
      kb.text(label, `dts:${s.alias}`).row();
    }

    await ctx.reply(
      `🖥 Desktop Sessions (${sessions.length})\n\n${lines.join('\n\n')}`,
      { reply_markup: kb },
    );
  }

  /** Callback for desktop session buttons — switches to that project */
  static async handleSessionCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data ?? '';
    const alias = data.startsWith('dts:') ? data.slice(4) : undefined;
    if (!alias) { await ctx.answerCallbackQuery(); return; }

    DataStore.setProject(threadId, alias);
    await ctx.answerCallbackQuery(`Switched to ${alias}`);
    await ctx.editMessageText(`✅ Project: ${alias}\n\nUse /vibe_coding to start coding!`);
    log.info(`[desktop] session switch to ${alias}`);
  }

  /** /desktop_pinned — show projects pinned in Desktop sidebar */
  static async listPinned(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;

    if (!desktopStateExists()) {
      await ctx.reply('OpenCode Desktop not detected on this machine.');
      return;
    }

    const pinned = getDesktopPinnedProjects();
    const lastProject = getDesktopLastProject();

    if (pinned.length === 0) {
      await ctx.reply('No projects currently open in the Desktop sidebar.');
      return;
    }

    const threadId = getThreadId(ctx);
    const currentAlias = DataStore.getProject(threadId);

    const lines = pinned.map(p => {
      const active = p.path === lastProject ? ' [active]' : '';
      const current = p.alias === currentAlias ? ' << current' : '';
      return `📌 ${p.alias}${active}${current}\n   ${p.path}`;
    });

    const kb = new InlineKeyboard();
    for (const p of pinned) {
      const label = p.alias === currentAlias ? `✅ ${p.alias}` : p.alias;
      kb.text(label, `dtp:${p.alias}`).row();
    }

    await ctx.reply(
      `📌 Desktop Sidebar (${pinned.length})\n\n${lines.join('\n\n')}`,
      { reply_markup: kb },
    );
  }
}
