import { getCacheKey, getCached, setCache } from './responseCache';
import type { ToolTier } from './tools';

const API_URL = 'https://api.a0.dev/ai/llm';

// Tier-based configuration
const TIER_CONFIG: Record<ToolTier, { timeoutMs: number; retries: number }> = {
  light: { timeoutMs: 35_000, retries: 2 },   // slower networks need more time + retries
  heavy: { timeoutMs: 45_000, retries: 2 },    // complex tasks with extra resilience
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function getRetryDelayMs(attempt: number, tier: ToolTier) {
  const base = tier === 'light' ? 1200 : 900;
  return base * Math.pow(2, attempt);
}

function isRetryableError(err: any): boolean {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.name === 'AbortError' ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('failed to fetch') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('api returned 5')
  );
}

// ─── Generation Lock ──────────────────────────────────────────────────────────
// Prevents concurrent AI requests (one at a time per user)
let _generating = false;

export function isGenerating(): boolean {
  return _generating;
}

// ─── Prompt Validation ────────────────────────────────────────────────────────
const MAX_PROMPT_LENGTH = 3000;
const MIN_PROMPT_LENGTH = 2;

export function validatePrompt(prompt: string): { valid: boolean; error?: string } {
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_PROMPT_LENGTH) {
    return { valid: false, error: 'Prompt is too short. Please provide more detail.' };
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return { valid: false, error: `Prompt is too long (${trimmed.length} chars). Please shorten to under ${MAX_PROMPT_LENGTH} characters.` };
  }
  return { valid: true };
}

// ─── Fetch with Timeout ───────────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const AbortControllerImpl = (globalThis as any).AbortController;
  const fetchImpl = (globalThis as any).fetch;
  const controller = new AbortControllerImpl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Core LLM Call ────────────────────────────────────────────────────────────
async function callLLM(
  messages: Array<{ role: string; content: any }>,
  tier: ToolTier = 'heavy'
): Promise<string> {
  const config = TIER_CONFIG[tier];
  let lastError: any;

  for (let attempt = 0; attempt <= config.retries; attempt++) {
    try {
      const response = await fetchWithTimeout(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      }, config.timeoutMs);

      if (!response.ok) {
        const error = new Error(`API returned ${response.status}`);
        (error as any).status = response.status;
        throw error;
      }

      const data = await response.json();
      const completion = data.completion;

      if (!completion || typeof completion !== 'string' || completion.trim().length === 0) {
        throw new Error('Empty completion received');
      }

      return completion;
    } catch (err: any) {
      lastError = err;
      const shouldRetry = attempt < config.retries && isRetryableError(err);
      if (!shouldRetry) {
        if (err?.name === 'AbortError') {
          throw new Error('Request timed out. Please check your connection and try again.');
        }
        if (typeof err?.status === 'number' && RETRYABLE_STATUS.has(err.status)) {
          throw new Error('Service is temporarily busy. Please try again in a moment.');
        }
        break;
      }
      await new Promise((r) => setTimeout(r, getRetryDelayMs(attempt, tier)));
    }
  }

  const fallbackMessage = tier === 'light'
    ? 'Request failed on a weak connection. Please retry with a stronger signal.'
    : 'Failed to generate response';
  throw lastError || new Error(fallbackMessage);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type GenerateOptions = {
  tier?: ToolTier;
  maxOutput?: string;   // Output limit instruction appended to system prompt
  skipCache?: boolean;  // Force fresh generation (e.g., regenerate)
};

/**
 * Generate text with caching, locking, and tier-based optimization.
 * Returns { text, cached } so the UI can indicate cache hits.
 */
export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options: GenerateOptions = {}
): Promise<{ text: string; cached: boolean }> {
  const { tier = 'heavy', maxOutput = '', skipCache = false } = options;

  // Build final system prompt with output limit
  let finalSystem = systemPrompt;
  if (maxOutput) {
    finalSystem += '\n\n' + maxOutput;
  }

  // Check cache first (unless skipping)
  const cacheKey = getCacheKey(finalSystem, userPrompt);
  if (!skipCache) {
    const cached = getCached(cacheKey);
    if (cached) {
      return { text: cached, cached: true };
    }
  }

  // Acquire generation lock
  if (_generating) {
    throw new Error('A generation is already in progress. Please wait.');
  }
  _generating = true;

  try {
    const text = await callLLM([
      { role: 'system', content: finalSystem },
      { role: 'user', content: userPrompt.trim() },
    ], tier);

    // Cache the result
    setCache(cacheKey, text);

    return { text, cached: false };
  } finally {
    _generating = false;
  }
}

/**
 * Generate text from an image input. Not cached (images are unique).
 */
export async function generateTextWithImage(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  options: GenerateOptions = {}
): Promise<{ text: string; cached: boolean }> {
  const { tier = 'heavy', maxOutput = '' } = options;

  let finalSystem = systemPrompt;
  if (maxOutput) {
    finalSystem += '\n\n' + maxOutput;
  }

  if (_generating) {
    throw new Error('A generation is already in progress. Please wait.');
  }
  _generating = true;

  try {
    const text = await callLLM([
      { role: 'system', content: finalSystem },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
          {
            type: 'text',
            text: userPrompt || 'Analyze this image and provide detailed writing assistance based on what you see.',
          },
        ],
      },
    ], tier);

    return { text, cached: false };
  } finally {
    _generating = false;
  }
}

/**
 * Get image generation URL. Images are generated server-side via URL params,
 * so no caching or locking needed.
 */
export function getImageUrl(prompt: string, seed?: number): string {
  const trimmed = prompt.trim();
  const params = [`text=${encodeURIComponent(trimmed)}`, 'aspect=1%3A1'];
  if (seed !== undefined) params.push(`seed=${encodeURIComponent(String(seed))}`);
  return `https://api.a0.dev/assets/image?${params.join('&')}`;
}