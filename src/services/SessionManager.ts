import { getAuthHeaders } from '../utils/AuthHelper.js';
import { ModelService } from './ModelService.js';

// ─── System prompt for Telegram-friendly output ───────────────────────────────

const TELEGRAM_SYSTEM_PREFIX = [
  'Your response will be displayed in a Telegram chat. Follow these formatting rules strictly:',
  '- Use short paragraphs. No walls of text.',
  '- For code: use fenced code blocks (```language ... ```). Always specify the language.',
  '- For inline code or file names: use single backticks (`like this`).',
  '- NEVER use markdown tables (|...|). Instead use plain text lists or code blocks.',
  '- For tabular data: use a fenced code block with aligned columns.',
  '- Use **bold** for emphasis, not headings.',
  '- Do not use ### headings — use **bold text** on its own line instead.',
  '- Keep lists short with - bullet points.',
  '- No HTML tags in your response.',
  '- Be concise. The user is on a phone.',
].join('\n');

// ─── Types ────────────────────────────────────────────────────────────────────

interface PromptBody {
  parts: { type: string; text: string }[];
  model?: { providerID: string; modelID: string };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class SessionManager {
  static async create(port: number): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/session`, {
      method: 'POST',
      headers: { ...getAuthHeaders(port), 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
    const data = await res.json() as { id?: string };
    if (!data.id) throw new Error('Invalid session response: missing id');
    return data.id;
  }

  static async validate(port: number, sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/session/${sessionId}`, {
        headers: getAuthHeaders(port),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async sendPrompt(
    port: number,
    sessionId: string,
    text: string,
    model?: string,
  ): Promise<void> {
    // Prepend Telegram formatting instructions to every prompt
    const fullText = `${TELEGRAM_SYSTEM_PREFIX}\n\n---\n\n${text}`;
    const body: PromptBody = { parts: [{ type: 'text', text: fullText }] };

    if (model) {
      const parsed = ModelService.parseModelString(model);
      if (parsed) body.model = parsed;
    }

    const res = await fetch(`http://127.0.0.1:${port}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { ...getAuthHeaders(port), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Failed to send prompt: ${res.status} ${res.statusText} — ${detail}`);
    }
  }

  static async abort(port: number, sessionId: string): Promise<void> {
    try {
      await fetch(`http://127.0.0.1:${port}/session/${sessionId}/abort`, {
        method: 'POST',
        headers: getAuthHeaders(port),
      });
    } catch { /* ignore */ }
  }
}
