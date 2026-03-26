import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import { DataStore } from '../services/DataStore.js';
import { ProjectHandler } from './ProjectHandler.js';
import { ModelHandler } from './ModelHandler.js';
import { ModelService } from '../services/ModelService.js';
import { discoverProjects, getProjectsBasePath, isDesktopDiscoveryEnabled } from '../services/ConfigService.js';
import { desktopStateExists } from '../services/DesktopService.js';
import { log } from '../utils/Logger.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── /start ───────────────────────────────────────────────────────────────────

export class StartHandler {
  static async handle(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const firstName = ctx.from?.first_name ?? 'there';
    const isNew = !DataStore.hasSeenOnboarding(threadId);
    const projects = discoverProjects();
    const models = ModelService.getModels();

    // No projects AND no models → likely not configured at all
    if (projects.length === 0 && models.length === 0) {
      await ctx.reply(
        `👋 Hey ${firstName}!\n\n` +
        `⚠️ No projects and no models found.\n\n` +
        `Please run in your terminal:\n` +
        `\`opencode-remote-telegram setup\`\n\n` +
        `After setup, run:\n` +
        `\`opencode-remote-telegram test\`\n` +
        `to verify the connection to OpenCode works.`,
      );
      return;
    }

    if (isNew) {
      DataStore.markOnboardingSeen(threadId);

      const kb = new InlineKeyboard()
        .text('📁 Pick a project', 'quick:sps')
        .text('🤖 Pick a model', 'quick:lm')
        .row()
        .text('📦 Clone a repo', 'quick:new_project')
        .text('❓ Help', 'quick:help');

      if (desktopStateExists()) {
        kb.row().text('🖥 Desktop projects', 'quick:desktop');
      }

      await ctx.reply(
        `👋 Hey ${firstName}, welcome to opencode-remote-telegram!\n\n` +
        `I let you control OpenCode from your phone.\n\n` +
        `What I can do:\n` +
        `• Pick a project → /list_projects\n` +
        `• Pick an AI model → /list_models\n` +
        `• Start a coding session → /vibe_coding\n` +
        `• Clone a new repo → /new_project\n` +
        `• Run git diff → /diff\n` +
        `• Show token stats → /show_stats\n\n` +
        (projects.length > 0
          ? `✅ ${projects.length} project(s) detected. Start by picking one below.`
          : `⚠️ No projects found. Use "Clone a repo" or run \`opencode-remote-telegram setup\` in your terminal.`),
        { reply_markup: kb },
      );
    } else {
      const alias = DataStore.getProject(threadId);
      const model = DataStore.getModel(threadId);

      // If project is set but no model → prompt for model
      if (alias && !model) {
        await ctx.reply(`👋 Hey ${firstName}!\n\nProject: ${alias}\n\n🤖 Which model do you want to use?`);
        await ModelHandler.listClickable(ctx);
        return;
      }

      const kb = new InlineKeyboard()
        .text('📁 Projects', 'quick:sps')
        .text('🤖 Models', 'quick:lm')
        .row()
        .text('🎧 Vibe Coding', 'quick:vibe')
        .text('📊 Status', 'quick:status');

      await ctx.reply(
        `👋 Hey ${firstName}!\n\n` +
        `Project: ${alias ?? '—'}\n` +
        `Model: ${model ?? 'default'}\n` +
        `Projects available: ${projects.length}`,
        { reply_markup: kb },
      );
    }
  }
}

// ─── /help ────────────────────────────────────────────────────────────────────

export class HelpHandler {
  static async handle(ctx: Context): Promise<void> {
    await ctx.reply(
      `📖 Commands\n\n` +
      `Projects\n` +
      `/list_projects — pick a project\n` +
      `/new_project — clone a GitHub repo\n\n` +
      `Desktop Integration\n` +
      `/desktop_projects — projects from OpenCode Desktop\n` +
      `/desktop_sessions — recent Desktop sessions\n` +
      `/desktop_pinned — Desktop sidebar projects\n\n` +
      `Models\n` +
      `/list_models — pick a model\n\n` +
      `Coding\n` +
      `/vibe_coding — start passthrough session\n` +
      `/stop_coding — stop session\n` +
      `/interrupt — interrupt running task\n` +
      `/diff — git diff --stat HEAD\n` +
      `/undo — revert last git commit (soft)\n\n` +
      `Queue\n` +
      `/queue_list — show queued prompts\n` +
      `/queue_clear — clear queue\n` +
      `/queue_settings — configure queue behavior\n\n` +
      `Stats & History\n` +
      `/show_stats — show token stats after responses\n` +
      `/hide_stats — hide stats\n` +
      `/history — last 10 prompts with cost\n` +
      `/costs — daily & weekly cost summary\n\n` +
      `Info\n` +
      `/status — current project, model & queue\n` +
      `/clear — reset project, model & settings\n` +
      `/help — this message`,
    );
  }
}

// ─── /clear ───────────────────────────────────────────────────────────────────

export class ClearHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    DataStore.clearAll(threadId);
    await ctx.reply('🗑 Cleared — project, model, queue and settings reset.\n\nUse /start to begin fresh.');
  }
}

// ─── /status ──────────────────────────────────────────────────────────────────

export class StatusHandler {
  static async show(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);

    const alias = DataStore.getProject(threadId);
    const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;
    const model = DataStore.getModel(threadId) ?? 'default';
    const queue = DataStore.getQueue(threadId);
    const stats = DataStore.isStatsEnabled(threadId);
    const settings = DataStore.getQueueSettings(threadId);

    const kb = new InlineKeyboard()
      .text('📁 Switch Project', 'quick:sps')
      .text('🤖 Switch Model', 'quick:lm');

    await ctx.reply(
      `📊 Status\n\n` +
      `Project: ${alias ?? 'none'}\n` +
      `Path: ${projectPath ?? '—'}\n` +
      `Model: ${model}\n` +
      `Queue: ${queue.length} item(s)\n` +
      `Stats: ${stats ? 'on' : 'off'}\n` +
      `Continue on failure: ${settings.continueOnFailure ? 'yes' : 'no'}`,
      { reply_markup: kb },
    );
  }
}

// ─── /new_project ─────────────────────────────────────────────────────────────

interface CloneWizardState {
  step: 'awaiting_url' | 'awaiting_dir';
  url?: string;
}

const cloneWizards = new Map<string, CloneWizardState>();

export class NewProjectHandler {
  static isAwaiting(threadId: string): boolean {
    return cloneWizards.has(threadId);
  }

  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const basePath = getProjectsBasePath();
    cloneWizards.set(threadId, { step: 'awaiting_url' });

    await ctx.reply(
      `📦 Clone a new project\n\n` +
      `Send me the GitHub (or any git) URL to clone.\n` +
      `Example: https://github.com/org/repo\n\n` +
      `The project will be cloned into:\n${basePath ?? '(no base path configured)'}\n\n` +
      `Send /cancel to abort.`,
    );
  }

  static async handleMessage(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const state = cloneWizards.get(threadId);
    if (!state) return;

    const text = ctx.message?.text?.trim() ?? '';

    if (text === '/cancel') {
      cloneWizards.delete(threadId);
      await ctx.reply('Cancelled.');
      return;
    }

    if (state.step === 'awaiting_url') {
      if (!text.match(/^https?:\/\/.+|^git@.+:.+\/.+/)) {
        await ctx.reply('That doesn\'t look like a valid git URL. Try again or send /cancel.');
        return;
      }

      const basePath = getProjectsBasePath();
      if (!basePath) {
        cloneWizards.delete(threadId);
        await ctx.reply('⚠️ No PROJECTS_BASE_PATH configured. Run setup first.');
        return;
      }

      const repoName = text.split('/').pop()?.replace(/\.git$/, '') ?? 'new-project';
      const suggestedPath = join(basePath, repoName);
      cloneWizards.set(threadId, { step: 'awaiting_dir', url: text });

      const kb = new InlineKeyboard()
        .text(`✅ Use "${repoName}"`, `clone:confirm:${repoName}`)
        .row()
        .text('✏️ Use a different name', 'clone:custom_name')
        .text('❌ Cancel', 'clone:cancel');

      await ctx.reply(
        `URL: ${text}\n\nClone into: ${suggestedPath}`,
        { reply_markup: kb },
      );
      return;
    }

    if (state.step === 'awaiting_dir' && state.url) {
      await NewProjectHandler.doClone(ctx, state.url, text, threadId);
    }
  }

  static async handleCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const state = cloneWizards.get(threadId);
    const data = ctx.callbackQuery?.data ?? '';

    if (data === 'clone:cancel') {
      cloneWizards.delete(threadId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('Cancelled.');
      return;
    }

    if (data.startsWith('clone:confirm:') && state?.url) {
      const dirName = data.slice('clone:confirm:'.length);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup();
      await NewProjectHandler.doClone(ctx, state.url, dirName, threadId);
      return;
    }

    if (data === 'clone:custom_name') {
      await ctx.answerCallbackQuery();
      await ctx.reply('Send the directory name to use (just the folder name, not the full path):');
      return;
    }

    await ctx.answerCallbackQuery();
  }

  private static async doClone(ctx: Context, url: string, dirName: string, threadId: string): Promise<void> {
    const basePath = getProjectsBasePath();
    if (!basePath) {
      cloneWizards.delete(threadId);
      await ctx.reply('⚠️ No PROJECTS_BASE_PATH configured.');
      return;
    }

    const targetPath = join(basePath, dirName);

    if (existsSync(targetPath)) {
      await ctx.reply(`⚠️ Directory "${dirName}" already exists. Send a different name or /cancel.`);
      cloneWizards.set(threadId, { step: 'awaiting_dir', url });
      return;
    }

    cloneWizards.delete(threadId);
    const statusMsg = await ctx.reply(`⏳ Cloning ${url}…`);

    try {
      log.info(`[clone] ${url} → ${targetPath}`);
      execSync(`git clone "${url}" "${targetPath}"`, { timeout: 120_000, encoding: 'utf-8' });
      DataStore.setProject(threadId, dirName);
      log.info(`[clone] done → ${dirName}`);

      await ctx.api.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        `✅ Cloned into "${dirName}"!\n\nProject selected automatically. Use /vibe_coding to start.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
      log.error(`[clone] failed: ${msg}`);
      await ctx.api.editMessageText(
        statusMsg.chat.id,
        statusMsg.message_id,
        `❌ Clone failed:\n${msg}`,
      );
    }
  }
}

// ─── Quick action callbacks ───────────────────────────────────────────────────

export async function handleQuickCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? '';
  await ctx.answerCallbackQuery();

  if (data === 'quick:sps') {
    await ProjectHandler.listClickable(ctx);
  } else if (data === 'quick:lm') {
    await ModelHandler.listClickable(ctx);
  } else if (data === 'quick:vibe') {
    const { VibeCodingHandler } = await import('./VibeCodingHandler.js');
    await VibeCodingHandler.start(ctx);
  } else if (data === 'quick:status') {
    await StatusHandler.show(ctx);
  } else if (data === 'quick:new_project') {
    await NewProjectHandler.handle(ctx);
  } else if (data === 'quick:help') {
    await HelpHandler.handle(ctx);
  } else if (data === 'quick:desktop') {
    const { DesktopHandler } = await import('./DesktopHandler.js');
    await DesktopHandler.listProjects(ctx);
  }
}
