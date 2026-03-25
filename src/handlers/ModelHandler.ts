import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { rejectUnauthorized, getThreadId } from '../utils/AuthGuard.js';
import { ModelService } from '../services/ModelService.js';
import { DataStore } from '../services/DataStore.js';

export class ModelHandler {
  /** /lm — inline keyboard with model buttons */
  static async listClickable(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const models = ModelService.getModels();

    if (models.length === 0) {
      await ctx.reply('No models found. Make sure opencode is installed and configured.');
      return;
    }

    const current = DataStore.getModel(threadId) ?? '';

    // Group by provider
    const groups: Record<string, string[]> = {};
    for (const m of models) {
      const provider = m.split('/')[0];
      (groups[provider] ??= []).push(m);
    }

    const kb = new InlineKeyboard();
    for (const [, list] of Object.entries(groups)) {
      for (const m of list) {
        const shortName = m.split('/').slice(1).join('/');
        const label = m === current ? `✅ ${shortName}` : shortName;
        kb.text(label.slice(0, 64), `lm:${m}`).row();
      }
    }

    await ctx.reply('Select a model:', { reply_markup: kb });
  }

  /** Callback for inline model buttons */
  static async handleCallback(ctx: Context): Promise<void> {
    const threadId = getThreadId(ctx);
    const data = ctx.callbackQuery?.data ?? '';
    const model = data.startsWith('lm:') ? data.slice(3) : undefined;

    if (!model) { await ctx.answerCallbackQuery(); return; }

    DataStore.setModel(threadId, model);
    await ctx.answerCallbackQuery(`Switched to ${model}`);

    const kb = new InlineKeyboard()
      .text('🎧 Start /vibe_coding', 'quick:vibe');

    await ctx.editMessageText(
      `✅ Model: ${model}`,
      { reply_markup: kb },
    );
  }

  /** /list_models — inline keyboard (same as /lm) */
  static async listReadable(ctx: Context): Promise<void> {
    return ModelHandler.listClickable(ctx);
  }

  /** /switch_model <name> */
  static async switchModel(ctx: Context): Promise<void> {
    if (await rejectUnauthorized(ctx)) return;
    const threadId = getThreadId(ctx);
    const text = ctx.message?.text ?? '';

    const parts = text.split(/\s+/);
    const modelName = parts.slice(1).join(' ').trim();
    if (!modelName) {
      await ModelHandler.listClickable(ctx);
      return;
    }

    const available = ModelService.getModels();
    if (available.length > 0 && !available.includes(modelName)) {
      await ctx.reply(`Model '${modelName}' not found.\nUse /lm to see what's available.`);
      return;
    }

    DataStore.setModel(threadId, modelName);
    await ctx.reply(`✅ Model: ${modelName}\n\nType /vibe_coding to start coding!`);
  }

  /** Returns current model label for display */
  static getShortcutLabel(_threadId: string, modelName: string): string {
    return modelName;
  }
}
