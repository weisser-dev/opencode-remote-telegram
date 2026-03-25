import { Bot } from 'grammy';
import pc from 'picocolors';
import { existsSync, readFileSync } from 'fs';
import { getBotConfig, discoverProjects, getOpenCodeConfigPath, getProjectsBasePath } from './services/ConfigService.js';
import { ModelService } from './services/ModelService.js';
import { stopAll } from './services/ServeManager.js';
import { log, enableFileLogging } from './utils/Logger.js';
import { StartHandler, HelpHandler, StatusHandler, ClearHandler, NewProjectHandler, handleQuickCallback } from './handlers/InfoHandlers.js';
import { ModelHandler } from './handlers/ModelHandler.js';
import { ProjectHandler } from './handlers/ProjectHandler.js';
import { VibeCodingHandler } from './handlers/VibeCodingHandler.js';
import {
  InterruptHandler,
  DiffHandler,
  UndoHandler,
  QueueHandler,
  StatsHandler,
  HistoryHandler,
  CostsHandler,
  MessageHandler,
} from './handlers/ExecutionHandler.js';

// ─── Startup summary ──────────────────────────────────────────────────────────

function readDefaultModel(): string | undefined {
  const configPath = getOpenCodeConfigPath();
  if (!configPath || !existsSync(configPath)) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { model?: string };
    return cfg.model;
  } catch {
    return undefined;
  }
}

function printStartupSummary(models: string[]): void {
  const div = pc.dim('─'.repeat(52));
  console.log('');
  console.log(div);
  console.log(`  ${pc.bold(pc.cyan('opencode-remote-telegram'))}`);
  console.log(div);

  const configPath = getOpenCodeConfigPath();
  if (configPath) {
    console.log(`  ${pc.dim('Config')}   ${pc.green('✓')} ${pc.dim(configPath)}`);
  } else {
    console.log(`  ${pc.dim('Config')}   ${pc.yellow('⚠')}  ${pc.yellow('No global config — each project uses its own opencode.json')}`);
  }

  const basePath = getProjectsBasePath();
  const projects = discoverProjects();
  if (projects.length > 0) {
    console.log(`  ${pc.dim('Projects')} ${pc.green('✓')} ${pc.bold(String(projects.length))} detected ${pc.dim(`(${basePath ?? '—'})`)}`);
    for (const p of projects.slice(0, 5)) {
      console.log(`    ${pc.dim('·')} ${pc.cyan(p.alias)}`);
    }
    if (projects.length > 5) console.log(`    ${pc.dim(`… and ${projects.length - 5} more`)}`);
  } else {
    console.log(`  ${pc.dim('Projects')} ${pc.yellow('⚠')}  no projects found ${pc.dim(`(${basePath ?? 'PROJECTS_BASE_PATH not set'})`)}`);
  }

  if (models.length > 0) {
    const providers = [...new Set(models.map(m => m.split('/')[0]))];
    console.log(`  ${pc.dim('Models')}   ${pc.green('✓')} ${pc.bold(String(models.length))} loaded ${pc.dim(`(${providers.join(', ')})`)}`);
    const defaultModel = readDefaultModel() ?? models[0];
    console.log(`  ${pc.dim('Default')}  ${pc.dim('→')} ${pc.cyan(defaultModel)}`);
  } else {
    console.log(`  ${pc.dim('Models')}   ${pc.yellow('⚠')}  no models found — check opencode config & PATH`);
  }

  console.log(div);
  console.log('');
}

// ─── Bot start ────────────────────────────────────────────────────────────────

export async function startBot(): Promise<void> {
  const config = getBotConfig();
  if (!config) {
    throw new Error(
      'No Telegram bot token found.\n' +
      'Run "opencode-remote-telegram setup" or set TELEGRAM_BOT_TOKEN in your environment.',
    );
  }

  const bot = new Bot(config.telegramToken);

  // ── Debug middleware — logs every incoming update and outgoing reply ────────
  bot.use(async (ctx, next) => {
    const user = ctx.from?.username ?? ctx.from?.id ?? '?';

    if (ctx.message?.text) {
      const text = ctx.message.text;
      if (text.startsWith('/')) {
        log.debug(`[in] @${user} command: ${text}`);
      } else {
        log.debug(`[in] @${user} text: ${JSON.stringify(text.slice(0, 100))}`);
      }
    } else if (ctx.callbackQuery?.data) {
      log.debug(`[in] @${user} callback: ${ctx.callbackQuery.data}`);
    }

    // Intercept ctx.reply to log outgoing messages
    const originalReply = ctx.reply.bind(ctx);
    ctx.reply = async (text: string, other?: Parameters<typeof ctx.reply>[1]) => {
      log.debug(`[out] → @${user}: ${JSON.stringify(String(text).slice(0, 120))}`);
      return originalReply(text, other);
    };

    await next();
  });

  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command('start', ctx => StartHandler.handle(ctx));
  bot.command('help', ctx => HelpHandler.handle(ctx));

  bot.command('sps', ctx => ProjectHandler.listClickable(ctx));
  bot.command('list_projects', ctx => ProjectHandler.listReadable(ctx));
  bot.command('switch_project', ctx => ProjectHandler.switchProject(ctx));
  bot.command('sp', ctx => ProjectHandler.switchProject(ctx));
  bot.command('new_project', ctx => NewProjectHandler.handle(ctx));

  bot.command('lm', ctx => ModelHandler.listClickable(ctx));
  bot.command('list_models', ctx => ModelHandler.listReadable(ctx));
  bot.command('switch_model', ctx => ModelHandler.switchModel(ctx));

  bot.command('vibe_coding', ctx => VibeCodingHandler.start(ctx));
  bot.command('stop_coding', ctx => VibeCodingHandler.stop(ctx));
  bot.command('code', ctx => VibeCodingHandler.start(ctx));

  bot.command('status', ctx => StatusHandler.show(ctx));
  bot.command('interrupt', ctx => InterruptHandler.handle(ctx));
  bot.command('diff', ctx => DiffHandler.handle(ctx));
  bot.command('undo', ctx => UndoHandler.handle(ctx));
  bot.command('queue_list', ctx => QueueHandler.list(ctx));
  bot.command('queue_clear', ctx => QueueHandler.clear(ctx));
  bot.command('queue_settings', ctx => QueueHandler.settings(ctx));
  bot.command('show_stats', ctx => StatsHandler.show(ctx));
  bot.command('hide_stats', ctx => StatsHandler.hide(ctx));
  bot.command('history', ctx => HistoryHandler.handle(ctx));
  bot.command('costs', ctx => CostsHandler.handle(ctx));
  bot.command('clear', ctx => ClearHandler.handle(ctx));

  // ── Inline keyboard callbacks ──────────────────────────────────────────────
  bot.callbackQuery(/^quick:/, ctx => handleQuickCallback(ctx));
  bot.callbackQuery(/^sp:/, ctx => ProjectHandler.handleCallback(ctx));
  bot.callbackQuery(/^lm:/, ctx => ModelHandler.handleCallback(ctx));
  bot.callbackQuery(/^clone:/, ctx => NewProjectHandler.handleCallback(ctx));
  bot.callbackQuery(/^queue:/, ctx => QueueHandler.handleCallback(ctx));
  bot.callbackQuery(/^resume:/, ctx => MessageHandler.handleResumeCallback(ctx));
  bot.callbackQuery(/^undo:/, ctx => UndoHandler.handleCallback(ctx));

  // ── Text shortcuts (legacy /sp1, /sm1 still work) ─────────────────────────
  bot.hears(/^\/sp\d+/, ctx => ProjectHandler.switchProject(ctx));
  bot.hears(/^\/sm\d+/, ctx => ModelHandler.switchModel(ctx));

  // ── Message passthrough ────────────────────────────────────────────────────
  bot.on('message:text', async ctx => {
    // New project wizard intercepts messages first
    const threadId = `${ctx.chat.id}${ctx.message?.message_thread_id ? `:${ctx.message.message_thread_id}` : ''}`;
    if (NewProjectHandler.isAwaiting(threadId)) {
      await NewProjectHandler.handleMessage(ctx);
      return;
    }
    await MessageHandler.handle(ctx);
  });

  bot.catch(err => {
    log.error(`bot error: ${err.message}`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal: string) => {
    log.warn(`${signal} received — shutting down`);
    stopAll();
    bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Pre-warm model cache ───────────────────────────────────────────────────
  enableFileLogging();
  let models: string[] = [];
  try { models = ModelService.getModels(); } catch { /* non-fatal */ }

  printStartupSummary(models);

  log.info('connecting to Telegram…');
  await bot.start({
    onStart: info => {
      log.info(`connected as @${info.username}`);
      console.log('');
    },
  });
}
