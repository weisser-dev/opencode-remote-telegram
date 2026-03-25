/**
 * Model pricing for cost estimation when the provider reports $0.
 * Prices in USD per 1 million tokens (MTok).
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 */

interface ModelPricing {
  input: number;   // $ per MTok
  output: number;  // $ per MTok
  cacheRead: number; // $ per MTok
}

// Model ID patterns → pricing (matched via substring/includes)
const PRICING_TABLE: Array<{ pattern: string; pricing: ModelPricing }> = [
  // Claude Opus 4.6 / 4.5
  { pattern: 'claude-opus-4-6',   pricing: { input: 5,   output: 25,  cacheRead: 0.50 } },
  { pattern: 'claude-opus-4-5',   pricing: { input: 5,   output: 25,  cacheRead: 0.50 } },
  { pattern: 'claude-opus-4.6',   pricing: { input: 5,   output: 25,  cacheRead: 0.50 } },
  { pattern: 'claude-opus-4.5',   pricing: { input: 5,   output: 25,  cacheRead: 0.50 } },
  // Claude Opus 4.1 / 4 / 3
  { pattern: 'claude-opus-4-1',   pricing: { input: 15,  output: 75,  cacheRead: 1.50 } },
  { pattern: 'claude-opus-4-0',   pricing: { input: 15,  output: 75,  cacheRead: 1.50 } },
  { pattern: 'claude-opus-4',     pricing: { input: 15,  output: 75,  cacheRead: 1.50 } },
  { pattern: 'claude-opus-3',     pricing: { input: 15,  output: 75,  cacheRead: 1.50 } },
  // Claude Sonnet 4.x / 3.7
  { pattern: 'claude-sonnet-4',   pricing: { input: 3,   output: 15,  cacheRead: 0.30 } },
  { pattern: 'claude-sonnet-3',   pricing: { input: 3,   output: 15,  cacheRead: 0.30 } },
  // Claude Haiku 4.5
  { pattern: 'claude-haiku-4-5',  pricing: { input: 1,   output: 5,   cacheRead: 0.10 } },
  { pattern: 'claude-haiku-4.5',  pricing: { input: 1,   output: 5,   cacheRead: 0.10 } },
  // Claude Haiku 3.5
  { pattern: 'claude-haiku-3-5',  pricing: { input: 0.8, output: 4,   cacheRead: 0.08 } },
  { pattern: 'claude-haiku-3.5',  pricing: { input: 0.8, output: 4,   cacheRead: 0.08 } },
  // Claude Haiku 3
  { pattern: 'claude-haiku-3',    pricing: { input: 0.25, output: 1.25, cacheRead: 0.03 } },
  // GPT fallbacks (rough estimates)
  { pattern: 'gpt-5',            pricing: { input: 5,   output: 15,  cacheRead: 0.50 } },
  { pattern: 'gpt-4',            pricing: { input: 10,  output: 30,  cacheRead: 1.00 } },
];

function findPricing(modelID?: string): ModelPricing | null {
  if (!modelID) return null;
  const lower = modelID.toLowerCase();
  for (const entry of PRICING_TABLE) {
    if (lower.includes(entry.pattern)) return entry.pricing;
  }
  return null;
}

/**
 * Estimate cost based on token counts and model ID.
 * Returns the estimated cost in USD, or 0 if the model is unknown.
 */
export function estimateCost(
  modelID: string | undefined,
  tokensInput: number,
  tokensOutput: number,
  cacheRead = 0,
): number {
  const pricing = findPricing(modelID);
  if (!pricing) return 0;

  const inputCost = (tokensInput / 1_000_000) * pricing.input;
  const outputCost = (tokensOutput / 1_000_000) * pricing.output;
  const cacheCost = (cacheRead / 1_000_000) * pricing.cacheRead;

  return inputCost + outputCost + cacheCost;
}
