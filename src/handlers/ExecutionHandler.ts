import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import { DataStore } from '../services/DataStore.js';
import { spawnServe, waitForReady, getPort, touchActivity } from '../services/ServeManager.js';
import { SessionManager } from '../services/SessionManager.js';
import { SSEClient } from '../services/SSEClient.js';
import { ProjectHandler } from './ProjectHandler.js';
import { VibeCodingHandler } from './VibeCodingHandler.js';
import { log } from '../utils/Logger.js';
import { getRandomLoadingMessage } from '../utils/LoadingMessages.js';
import { formatAndSplit, splitMessage } from '../utils/TelegramFormatter.js';
import { estimateCost } from '../utils/Pricing.js';
import type { MessageUsageInfo } from '../types/index.js';

// ─── Active SSE clients per thread ────────────────────────────────────────────

const activeClients = new Map<string, SSEClient>();

async function safeSend(ctx: Context, text: string): Promise<void> {
  try { await ctx.reply(text); } catch { /* ignore */ }
}

function formatStats(usage: MessageUsageInfo): string {
  const { input, output, cache } = usage.tokens;

  // Use provider cost if available, otherwise estimate from token counts
  let cost = usage.cost;
  if (cost === 0 || cost === undefined) {
    cost = estimateCost(usage.modelID, input, output, cache.read);
  }

  const costStr = cost > 0 ? `$${cost.toFixed(4)}` : '$0.0000';
  const duration = usage.duration ? `${(usage.duration / 1000).toFixed(1)}s` : '—';
  const model = usage.modelID ?? '—';
  return (
    `📊 ${model}\n` +
    `in ${input.toLocaleString()} · out ${output.toLocaleString()}` +
    (cache.read > 0 ? ` · cache ${cache.read.toLocaleString()}` : '') +
    ` · ${costStr} · ${duration}`
  );
}

// ─── Core execution ───────────────────────────────────────────────────────────

export async function runPrompt(ctx: Context, text: string): Promise<void> {
  const threadId = getThreadId(ctx);
  const model = DataStore.getModel(threadId);
  return runPromptWithModel(ctx, text, model);
}

async function runPromptWithModel(ctx: Context, text: string, model: string | undefined): Promise<void> {
  const threadId = getThreadId(ctx);
  const alias = DataStore.getProject(threadId);
  const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;

  if (!alias || !projectPath) {
    await ctx.reply('⚠️ No project selected. Use /sps to pick a project first.');
    return;
  }

  const settings = DataStore.getQueueSettings(threadId);
  const showStats = DataStore.isStatsEnabled(threadId);

  // Disconnect any existing SSE client
  activeClients.get(threadId)?.disconnect();
  activeClients.delete(threadId);

  let accumulatedText = '';
  let waitingMsg: Awaited<ReturnType<typeof ctx.reply>> | null = null;
  let thinkingInterval: ReturnType<typeof setInterval> | null = null;

  try {
    const user = ctx.from?.username ?? ctx.from?.id ?? 'unknown';
    const displayModel = model ?? 'default';
    log.info(`[prompt] user=${user} project=${alias} model=${displayModel} text=${JSON.stringify(text.slice(0, 80))}`);

    // Only show "Starting" if serve is not already running
    const alreadyRunning = !!getPort(projectPath);
    if (!alreadyRunning) {
      waitingMsg = await ctx.reply('⏳ Starting OpenCode server…');
    }

    const port = await spawnServe(projectPath);
    await waitForReady(port, projectPath);
    touchActivity(projectPath);
    log.info(`[serve] port=${port} ready (was already running: ${alreadyRunning})`);

    const sessionId = await SessionManager.create(port);
    log.info(`[session] id=${sessionId}`);

    const sseClient = new SSEClient();
    activeClients.set(threadId, sseClient);

    // Rotating loading messages while the model is busy
    let thinkingStarted = false;
    sseClient.onThinking(async () => {
      if (thinkingStarted) return; // only handle the first busy event
      thinkingStarted = true;

      if (!waitingMsg) {
        waitingMsg = await ctx.reply(getRandomLoadingMessage());
      }
      if (!thinkingInterval) {
        thinkingInterval = setInterval(async () => {
          if (!waitingMsg) {
            if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
            return;
          }
          try {
            await ctx.api.editMessageText(waitingMsg!.chat.id, waitingMsg!.message_id, getRandomLoadingMessage());
          } catch { /* ignore */ }
        }, 4000);
      }
    });

    // Collect text silently — no live streaming, only show final result
    sseClient.onText(delta => { accumulatedText += delta; });

    // Buffer final usage — sent only once after session.idle
    let pendingUsage: import('../types/index.js').MessageUsageInfo | null = null;
    sseClient.onUsage(usage => { pendingUsage = usage; });

    sseClient.onIdle(async () => {
      if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
      log.info(`[response] session=${sessionId} chars=${accumulatedText.length}`);

      // Delete loading message
      if (waitingMsg) {
        try { await ctx.api.deleteMessage(waitingMsg.chat.id, waitingMsg.message_id); } catch { /* ignore */ }
        waitingMsg = null;
      }

      const finalText = accumulatedText || '✅ Done.';

      // Send final response with proper formatting (HTML <pre> for tables/code)
      const formatted = formatAndSplit(finalText);
      for (const chunk of formatted) {
        try {
          await ctx.reply(chunk.text, chunk.parseMode ? { parse_mode: chunk.parseMode } : undefined);
        } catch {
          // If HTML parsing fails, fall back to plain text
          try { await ctx.reply(chunk.text.replace(/<\/?pre>/g, '')); } catch { /* give up */ }
        }
      }

      // Stats only after full response
      if (showStats && pendingUsage) {
        try { await ctx.reply(formatStats(pendingUsage)); } catch { /* ignore */ }
      }

      // Record in history
      if (pendingUsage) {
        let cost = pendingUsage.cost;
        if (cost === 0 || cost === undefined) {
          cost = estimateCost(pendingUsage.modelID, pendingUsage.tokens.input, pendingUsage.tokens.output, pendingUsage.tokens.cache.read);
        }
        DataStore.addHistory({
          prompt: text.slice(0, 200),
          responseChars: accumulatedText.length,
          model: pendingUsage.modelID,
          cost,
          tokensInput: pendingUsage.tokens.input,
          tokensOutput: pendingUsage.tokens.output,
          duration: pendingUsage.duration,
        });
      }

      sseClient.disconnect();
      activeClients.delete(threadId);

      const next = DataStore.dequeue(threadId);
      if (next) await runPrompt(ctx, next.text);
    });

    sseClient.onError(async (_sid, errorInfo) => {
      if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
      const msg = errorInfo.data?.message ?? errorInfo.name ?? 'Unknown error';

      if (msg.includes('Model not found') && model) {
        log.warn(`[retry] model=${model} not found — retrying with server default`);
        sseClient.disconnect();
        activeClients.delete(threadId);
        accumulatedText = '';
        await runPromptWithModel(ctx, text, undefined);
        return;
      }

      if (waitingMsg) {
        try { await ctx.api.deleteMessage(waitingMsg.chat.id, waitingMsg.message_id); } catch { /* ignore */ }
        waitingMsg = null;
      }
      await safeSend(ctx, `Error: ${msg}`);
      sseClient.disconnect();
      activeClients.delete(threadId);

      if (settings.continueOnFailure) {
        const next = DataStore.dequeue(threadId);
        if (next) await runPrompt(ctx, next.text);
      } else {
        DataStore.clearQueue(threadId);
        await safeSend(ctx, 'Execution failed. Queue cleared. Use /queue_settings to change this behavior.');
      }
    });

    sseClient.onConnectionError(async (err) => {
      if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
      if (waitingMsg) {
        try { await ctx.api.deleteMessage(waitingMsg.chat.id, waitingMsg.message_id); } catch { /* ignore */ }
        waitingMsg = null;
      }
      await safeSend(ctx, `Connection error: ${err.message}`);
      sseClient.disconnect();
      activeClients.delete(threadId);
    });

    sseClient.connect(`http://127.0.0.1:${port}`, port);
    await SessionManager.sendPrompt(port, sessionId, text, model);

  } catch (err) {
    if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
    if (waitingMsg) {
      try { await ctx.api.deleteMessage(waitingMsg.chat.id, waitingMsg.message_id); } catch { /* ignore */ }
    }
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await safeSend(ctx, `OpenCode execution failed: ${msg}`);
    DataStore.clearQueue(threadId);
    await safeSend(ctx, 'Execution failed. Queue cleared. Use /queue_settings to change this behavior.');
  }
}

// ─── /interrupt ───────────────────────────────────────────────────────────────

export class InterruptHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const client = activeClients.get(threadId);
    if (client) {
      client.disconnect();
      activeClients.delete(threadId);
      await ctx.reply('🛑 Interrupted.');
    } else {
      await ctx.reply('No active session to interrupt.');
    }
  }
}

// ─── /diff ────────────────────────────────────────────────────────────────────

export class DiffHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const alias = DataStore.getProject(threadId);
    const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;

    if (!projectPath) {
      await ctx.reply('No project selected. Use /list_projects first.');
      return;
    }

    try {
      const { execSync } = await import('child_process');
      const diff = execSync('git diff --stat HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (!diff) {
        await ctx.reply('No changes.');
        return;
      }
      const chunks = splitMessage(`\`\`\`\n${diff}\n\`\`\``);
      for (const chunk of chunks) await ctx.reply(chunk);
    } catch (err) {
      await ctx.reply(`Failed to get diff: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
}

// ─── /undo — revert last git commit ──────────────────────────────────────────

export class UndoHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const alias = DataStore.getProject(threadId);
    const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;

    if (!projectPath) {
      await ctx.reply('No project selected. Use /list_projects first.');
      return;
    }

    try {
      const { execSync } = await import('child_process');

      // Get last commit info first
      const lastCommit = execSync('git log -1 --oneline', {
        cwd: projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (!lastCommit) {
        await ctx.reply('No commits to undo.');
        return;
      }

      const kb = new InlineKeyboard()
        .text('✅ Yes, undo it', `undo:confirm:${threadId}`)
        .text('❌ Cancel', 'undo:cancel');

      await ctx.reply(
        `⚠️ Undo last commit?\n\n\`${lastCommit}\`\n\nThis runs \`git reset --soft HEAD~1\` — changes stay staged.`,
        { reply_markup: kb },
      );
    } catch (err) {
      await ctx.reply(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  static async handleCallback(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data ?? '';
    await ctx.answerCallbackQuery();

    if (data === 'undo:cancel') {
      await ctx.editMessageText('Cancelled.');
      return;
    }

    if (data.startsWith('undo:confirm:')) {
      const threadId = data.slice('undo:confirm:'.length);
      const alias = DataStore.getProject(threadId);
      const projectPath = alias ? ProjectHandler.resolve(alias) : undefined;

      if (!projectPath) {
        await ctx.editMessageText('⚠️ Project not found.');
        return;
      }

      try {
        const { execSync } = await import('child_process');
        execSync('git reset --soft HEAD~1', { cwd: projectPath, timeout: 5000 });
        const status = execSync('git status --short', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();

        await ctx.editMessageText(
          `✅ Last commit undone. Changes are staged.\n\n\`\`\`\n${status || 'Clean'}\n\`\`\``,
        );
        log.info(`[undo] ${alias}: reset --soft HEAD~1`);
      } catch (err) {
        await ctx.editMessageText(`❌ Undo failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
  }
}

// ─── /queue_list / /queue_clear / /queue_settings ─────────────────────────────

export class QueueHandler {
  static async list(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const queue = DataStore.getQueue(threadId);
    if (queue.length === 0) {
      await ctx.reply('Queue is empty.');
      return;
    }
    const lines = queue.map((item, i) => `${i + 1}. ${item.text.slice(0, 80)}`);
    await ctx.reply(`Queue (${queue.length} items):\n\n${lines.join('\n')}`);
  }

  static async clear(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    DataStore.clearQueue(threadId);
    await ctx.reply('Queue cleared.');
  }

  static async settings(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const current = DataStore.getQueueSettings(threadId);

    const kb = new InlineKeyboard()
      .text(
        current.continueOnFailure ? '✅ Continue on failure: ON' : '❌ Continue on failure: OFF',
        'queue:toggle_continue',
      );

    await ctx.reply('Queue settings:', { reply_markup: kb });
  }

  static async handleCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data;
    if (data === 'queue:toggle_continue') {
      const current = DataStore.getQueueSettings(threadId);
      DataStore.setQueueSettings(threadId, { continueOnFailure: !current.continueOnFailure });
      const updated = DataStore.getQueueSettings(threadId);
      const kb = new InlineKeyboard()
        .text(
          updated.continueOnFailure ? '✅ Continue on failure: ON' : '❌ Continue on failure: OFF',
          'queue:toggle_continue',
        );
      await ctx.editMessageText('Queue settings:', { reply_markup: kb });
    }
    await ctx.answerCallbackQuery();
  }
}

// ─── /show_stats / /hide_stats ────────────────────────────────────────────────

export class StatsHandler {
  static async show(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    DataStore.setStatsEnabled(getThreadId(ctx), true);
    await ctx.reply('📊 Stats enabled — token count, cost and duration will appear after each response.');
  }

  static async hide(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    DataStore.setStatsEnabled(getThreadId(ctx), false);
    await ctx.reply('Stats hidden.');
  }
}

// ─── /history — show last N prompts/responses ─────────────────────────────────

export class HistoryHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const entries = DataStore.getHistory(10);
    if (entries.length === 0) {
      await ctx.reply('No history yet. Start a /vibe_coding session and send some prompts.');
      return;
    }

    const lines = entries.map((e, i) => {
      const time = new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const model = e.model ?? '—';
      const cost = e.cost > 0 ? `$${e.cost.toFixed(4)}` : '$0';
      return `${entries.length - i}. [${time}] ${model}\n   "${e.prompt.slice(0, 60)}${e.prompt.length > 60 ? '…' : ''}"\n   → ${e.responseChars} chars · ${cost}`;
    }).reverse();

    const chunks = splitMessage(`📜 Last ${entries.length} prompts:\n\n${lines.join('\n\n')}`);
    for (const chunk of chunks) await ctx.reply(chunk);
  }
}

// ─── /costs — daily/weekly cost summary ───────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export class CostsHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;

    const today = DataStore.getCostsSince(ONE_DAY_MS);
    const week = DataStore.getCostsSince(ONE_WEEK_MS);

    if (week.count === 0) {
      await ctx.reply('No usage recorded yet. Start a /vibe_coding session and send some prompts.');
      return;
    }

    await ctx.reply(
      `💰 Cost Summary\n\n` +
      `Today (${today.count} prompts):\n` +
      `  Cost: $${today.totalCost.toFixed(4)}\n` +
      `  Input: ${today.totalInput.toLocaleString()} tokens\n` +
      `  Output: ${today.totalOutput.toLocaleString()} tokens\n\n` +
      `This week (${week.count} prompts):\n` +
      `  Cost: $${week.totalCost.toFixed(4)}\n` +
      `  Input: ${week.totalInput.toLocaleString()} tokens\n` +
      `  Output: ${week.totalOutput.toLocaleString()} tokens`,
    );
  }
}

// ─── Pending message storage for resume-with-message flow ─────────────────────

const pendingMessages = new Map<string, string>();

// ─── message passthrough (vibe coding) ───────────────────────────────────────

export class MessageHandler {
  static async handle(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const text = ctx.message?.text;
    if (!text || text.startsWith('/')) return;

    // Vibe coding is active — pass through
    if (VibeCodingHandler.isActive(threadId)) {
      const queue = DataStore.getQueue(threadId);
      if (queue.length > 0) {
        DataStore.enqueue({ threadId, chatId: ctx.chat!.id, text });
        await ctx.reply(`Queued (position ${queue.length + 1}).`);
        return;
      }
      await runPrompt(ctx, text);
      return;
    }

    // Vibe coding is NOT active — store message and offer options
    pendingMessages.set(threadId, text);
    const alias = DataStore.getProject(threadId);
    const model = DataStore.getModel(threadId);

    if (alias && model) {
      const kb = new InlineKeyboard()
        .text('🎧 Start & send this message', 'resume:send')
        .row()
        .text('✅ Just start coding', 'resume:yes')
        .text('❌ No', 'resume:no');

      await ctx.reply(
        `💤 Vibe coding is not active.\n\n` +
        `Project: ${alias}\n` +
        `Model: ${model}\n\n` +
        `Your message: "${text.slice(0, 100)}${text.length > 100 ? '…' : ''}"`,
        { reply_markup: kb },
      );
    } else if (alias) {
      const kb = new InlineKeyboard()
        .text('🤖 Pick a model', 'quick:lm')
        .text('❓ Help', 'quick:help');

      await ctx.reply(
        `💤 Vibe coding is not active.\n\n` +
        `Project: ${alias}\nModel: not set\n\nPick a model first:`,
        { reply_markup: kb },
      );
    } else {
      const kb = new InlineKeyboard()
        .text('📁 Pick a project', 'quick:sps')
        .text('❓ Help', 'quick:help');

      await ctx.reply(
        `💤 Vibe coding is not active.\n\nNo project selected. What do you want to do?`,
        { reply_markup: kb },
      );
    }
  }

  /** Callback handler for resume:yes / resume:no / resume:send */
  static async handleResumeCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data ?? '';
    await ctx.answerCallbackQuery();

    if (data === 'resume:send') {
      const pendingText = pendingMessages.get(threadId);
      pendingMessages.delete(threadId);
      VibeCodingHandler.activate(threadId);
      const alias = DataStore.getProject(threadId) ?? '—';
      const model = DataStore.getModel(threadId) ?? 'default';
      await ctx.editMessageText(
        `🎧 Vibe Coding started!\n\nProject: ${alias}\nModel: ${model}`,
      );
      if (pendingText) {
        await runPrompt(ctx, pendingText);
      }
    } else if (data === 'resume:yes') {
      pendingMessages.delete(threadId);
      VibeCodingHandler.activate(threadId);
      const alias = DataStore.getProject(threadId) ?? '—';
      const model = DataStore.getModel(threadId) ?? 'default';
      await ctx.editMessageText(
        `🎧 Vibe Coding resumed!\n\nProject: ${alias}\nModel: ${model}\n\nJust type what you want me to do.`,
      );
    } else if (data === 'resume:no') {
      pendingMessages.delete(threadId);
      const kb = new InlineKeyboard()
        .text('📁 Projects', 'quick:sps')
        .text('🤖 Models', 'quick:lm')
        .row()
        .text('❓ Help', 'quick:help')
        .text('📊 Status', 'quick:status');

      await ctx.editMessageText(
        'OK! What do you want to do instead?',
        { reply_markup: kb },
      );
    }
  }
}
