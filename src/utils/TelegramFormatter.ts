/**
 * Telegram message formatter.
 *
 * Converts OpenCode markdown-style output to Telegram HTML.
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">
 * Telegram does NOT support: markdown tables, nested <pre>
 *
 * Strategy:
 * - Fenced code blocks (```) → <pre>
 * - Inline code (`) → <code>
 * - **bold** → <b>
 * - _italic_ (but not snake_case) → <i>
 * - [text](url) → <a href="url">text</a>
 * - Markdown tables (|...|) → <pre> (monospace only option)
 * - Everything else: escape HTML entities, send as plain HTML
 */

const TELEGRAM_MAX_LENGTH = 4096;
const PRE_OVERHEAD = 15; // <pre></pre> + margin

// ─── HTML escaping ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Markdown → Telegram HTML conversion ──────────────────────────────────────

function convertMarkdownToTelegramHtml(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Fenced code blocks ────────────────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // Close code block
        result.push(`<pre>${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
        codeBlockLines = [];
        inCodeBlock = false;
        codeBlockLang = '';
      } else {
        // Flush any pending table
        if (inTable) { flushTable(result, tableLines); tableLines = []; inTable = false; }
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // ── Markdown tables ───────────────────────────────────────────────────
    if (/^\s*\|.*\|\s*$/.test(line)) {
      // Skip separator rows (|---|---|)
      if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) {
        inTable = true;
        continue;
      }
      inTable = true;
      tableLines.push(line);
      continue;
    }

    // If we were in a table and this line isn't a table row, flush it
    if (inTable) {
      flushTable(result, tableLines);
      tableLines = [];
      inTable = false;
    }

    // ── Headings ──────────────────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      result.push(`<b>${escapeHtml(headingMatch[2])}</b>`);
      continue;
    }

    // ── Horizontal rules ──────────────────────────────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line)) {
      result.push('—');
      continue;
    }

    // ── Normal line — convert inline formatting ───────────────────────────
    result.push(convertInlineFormatting(line));
  }

  // Flush remaining
  if (inCodeBlock && codeBlockLines.length > 0) {
    result.push(`<pre>${escapeHtml(codeBlockLines.join('\n'))}</pre>`);
  }
  if (inTable && tableLines.length > 0) {
    flushTable(result, tableLines);
  }

  return result.join('\n');
}

function flushTable(result: string[], tableLines: string[]): void {
  if (tableLines.length === 0) return;
  // Render table as monospace <pre> — the only way in Telegram
  const formatted = tableLines.map(line => {
    // Clean up pipe formatting for better monospace rendering
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').trim();
  }).join('\n');
  result.push(`<pre>${escapeHtml(formatted)}</pre>`);
}

function convertInlineFormatting(line: string): string {
  let result = escapeHtml(line);

  // Inline code: `text` → <code>text</code> (must be done FIRST before bold/italic)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* → <i>text</i> (but not ** which is bold)
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');

  // Links: [text](url) → <a href="url">text</a>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // List items: - text → • text
  result = result.replace(/^(\s*)[-*]\s+/, '$1• ');

  return result;
}

// ─── Message splitting ────────────────────────────────────────────────────────

function splitAtNewlines(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxLen;

    // Try paragraph break first
    const lastPara = remaining.lastIndexOf('\n\n', maxLen);
    if (lastPara > maxLen * 0.3) {
      splitAt = lastPara + 2;
    } else {
      // Try newline (safe for tables — never splits mid-row)
      const lastNl = remaining.lastIndexOf('\n', maxLen);
      if (lastNl > maxLen * 0.3) {
        splitAt = lastNl + 1;
      } else {
        const lastSpace = remaining.lastIndexOf(' ', maxLen);
        if (lastSpace > maxLen * 0.3) {
          splitAt = lastSpace + 1;
        }
      }
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

/**
 * Ensure every chunk has balanced <pre> tags.
 * If a chunk starts inside a <pre> from a previous chunk, prepend <pre>.
 * If a chunk ends with an open <pre>, append </pre>.
 */
function balancePreTags(chunks: string[]): string[] {
  return chunks.map(chunk => {
    const opens = (chunk.match(/<pre>/g) ?? []).length;
    const closes = (chunk.match(/<\/pre>/g) ?? []).length;
    if (opens > closes) {
      chunk += '</pre>';
    } else if (closes > opens) {
      chunk = '<pre>' + chunk;
    }
    return chunk;
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert OpenCode output to Telegram-safe HTML chunks.
 * Each chunk is independently valid HTML, ready to send with parse_mode: 'HTML'.
 */
export function formatAndSplit(text: string): Array<{ text: string; parseMode: 'HTML' }> {
  const html = convertMarkdownToTelegramHtml(text);
  const rawChunks = splitAtNewlines(html, TELEGRAM_MAX_LENGTH - 10);
  const balanced = balancePreTags(rawChunks);
  return balanced.map(chunk => ({ text: chunk, parseMode: 'HTML' as const }));
}

// Re-export for backward compat
export function splitMessage(text: string, maxLen = TELEGRAM_MAX_LENGTH): string[] {
  return splitAtNewlines(text, maxLen);
}
