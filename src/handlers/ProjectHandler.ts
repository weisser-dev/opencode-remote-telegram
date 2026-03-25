import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import { discoverProjects } from '../services/ConfigService.js';
import { DataStore } from '../services/DataStore.js';
import { ModelHandler } from './ModelHandler.js';
import { stopAllExcept } from '../services/ServeManager.js';
import { log } from '../utils/Logger.js';

// ─── Shortcut registry (still used for /sp1 text shortcuts) ──────────────────

const projectShortcuts = new Map<string, string[]>();

export class ProjectHandler {
  /** /sps — inline keyboard with project buttons */
  static async listClickable(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const projects = discoverProjects();

    if (projects.length === 0) {
      await ctx.reply('No projects found. Check your PROJECTS_BASE_PATH setting or use /new_project.');
      return;
    }

    const current = DataStore.getProject(threadId);
    projectShortcuts.set(threadId, projects.map(p => p.alias));

    const kb = new InlineKeyboard();
    for (const p of projects) {
      const label = p.alias === current ? `✅ ${p.alias}` : p.alias;
      kb.text(label, `sp:${p.alias}`).row();
    }

    await ctx.reply('Select a project:', { reply_markup: kb });
  }

  /** Callback for inline project buttons */
  static async handleCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data ?? '';
    const alias = data.startsWith('sp:') ? data.slice(3) : undefined;

    if (!alias) { await ctx.answerCallbackQuery(); return; }

    const projects = discoverProjects();
    const project = projects.find(p => p.alias === alias);
    if (!project) {
      await ctx.answerCallbackQuery('Project not found.');
      return;
    }

    DataStore.setProject(threadId, alias);
    await ctx.answerCallbackQuery(`Switched to ${alias}`);
    await ctx.editMessageText(
      `✅ Project: ${alias}\n${project.path}`,
    );

    // Stop old serve instances — only keep the new project's if running
    stopAllExcept(project.path);
    log.info(`[project] switched to ${alias}`);

    // If no model selected yet, prompt for one
    if (!DataStore.getModel(threadId)) {
      await ctx.reply('🤖 Which model do you want to use?');
      await ModelHandler.listClickable(ctx);
    } else {
      await ModelHandler.listClickable(ctx);
    }
  }

  /** /list_projects — inline keyboard (same as /sps) */
  static async listReadable(ctx: Context): Promise<void> {
    return ProjectHandler.listClickable(ctx);
  }

  /** /switch_project <alias> */
  static async switchProject(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const text = ctx.message?.text ?? '';

    const parts = text.split(/\s+/);
    const alias = parts.slice(1).join(' ').trim();
    if (!alias) {
      await ProjectHandler.listClickable(ctx);
      return;
    }

    const projects = discoverProjects();
    const project = projects.find(p => p.alias === alias);
    if (!project) {
      await ctx.reply(`Project '${alias}' not found.\nUse /sps to see available projects.`);
      return;
    }

    DataStore.setProject(threadId, alias);
    await ctx.reply(`✅ Project: ${alias}\n${project.path}\n\nType /vibe_coding to start coding!`);
  }

  /** Resolve alias → path */
  static resolve(alias: string): string | undefined {
    return discoverProjects().find(p => p.alias === alias)?.path;
  }
}
