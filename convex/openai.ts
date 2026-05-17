"use node";

import { action } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

const tierValidator = v.union(v.literal('light'), v.literal('heavy'));
const photoPromptValidator = v.string();
const IMAGE_EDIT_MODEL = 'gpt-image-1';

function getSystemPrompt(systemPrompt: string, maxOutput?: string) {
  return maxOutput ? `${systemPrompt}\n\n${maxOutput}` : systemPrompt;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20000) {
  const AbortControllerImpl = (globalThis as any).AbortController;
  const controller = new AbortControllerImpl();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await globalThis.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const generateText = action({
  args: {
    systemPrompt: v.string(),
    userPrompt: v.string(),
    tier: v.optional(tierValidator),
    maxOutput: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.runQuery(internal.settings.getSetting, { key: 'OPENAI_API_KEY' });
    if (!apiKey) {
      return 'OpenAI API key is not configured yet.';
    }

    const model = (await ctx.runQuery(internal.settings.getSetting, { key: 'OPENAI_MODEL' })) || 'gpt-4o-mini';
    const timeoutMs = args.tier === 'light' ? 15000 : 30000;
    const response = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: getSystemPrompt(args.systemPrompt, args.maxOutput) },
            { role: 'user', content: args.userPrompt.trim() },
          ],
          temperature: 0.7,
        }),
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('OpenAI returned an empty completion.');
    }
    return text;
  },
});

export const testConnection = action({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    message: v.string(),
    model: v.union(v.string(), v.null()),
    verifiedAt: v.number(),
  }),
  handler: async (ctx) => {
    const apiKey = await ctx.runQuery(internal.settings.getSetting, { key: 'OPENAI_API_KEY' });
    const model = (await ctx.runQuery(internal.settings.getSetting, { key: 'OPENAI_MODEL' })) || 'gpt-4o-mini';
    const verifiedAt = Date.now();

    if (!apiKey) {
      const message = 'OpenAI API key is not configured.';
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_STATUS', value: 'Failed' });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_MESSAGE', value: message });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_AT', value: String(verifiedAt) });
      return { ok: false, message, model, verifiedAt };
    }

    try {
      const response = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Reply with OK only.' },
              { role: 'user', content: 'ping' },
            ],
            temperature: 0,
            max_tokens: 1,
          }),
        },
        12000
      );

      if (!response.ok) {
        const payload = await readJsonResponse(response);
        const message = payload?.error?.message || `OpenAI test failed with status ${response.status}`;
        await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_STATUS', value: 'Failed' });
        await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_MESSAGE', value: message });
        await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_AT', value: String(verifiedAt) });
        return { ok: false, message, model, verifiedAt };
      }

      const completion = await readJsonResponse(response);
      const text = completion?.choices?.[0]?.message?.content?.trim() || 'OK';

      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_STATUS', value: 'Verified' });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_MESSAGE', value: text });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_AT', value: String(verifiedAt) });
      return { ok: true, message: text, model, verifiedAt };
    } catch (error: any) {
      const message = error?.message || 'Unable to verify OpenAI connection.';
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_STATUS', value: 'Failed' });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_MESSAGE', value: message });
      await ctx.runMutation(internal.settings.setInternalSetting, { key: 'OPENAI_LAST_VERIFIED_AT', value: String(verifiedAt) });
      return { ok: false, message, model, verifiedAt };
    }
  },
});

export const enhancePhoto = action({
  args: {
    imageBase64: v.string(),
    prompt: photoPromptValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const apiKey = await ctx.runQuery(internal.settings.getSetting, { key: 'OPENAI_API_KEY' });
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured.');
    }

    const cleanBase64 = args.imageBase64.trim();
    const dataUrl = cleanBase64.includes(',') ? cleanBase64 : `data:image/jpeg;base64,${cleanBase64}`;
    const response = await fetchWithTimeout(
      'https://api.openai.com/v1/images/edits',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: IMAGE_EDIT_MODEL,
          images: [{ image_url: dataUrl }],
          prompt: args.prompt.trim(),
          input_fidelity: 'high',
          output_format: 'png',
          moderation: 'auto',
          size: '1024x1024',
        }),
      },
      45000
    );

    if (!response.ok) {
      const payload = await readJsonResponse(response);
      const message = payload?.error?.message || `OpenAI photo edit failed with status ${response.status}`;
      throw new Error(message);
    }

    const payload = await readJsonResponse(response);
    const b64Json = payload?.data?.[0]?.b64_json || payload?.output?.[0]?.b64_json || payload?.b64_json;
    const url = payload?.data?.[0]?.url || payload?.output?.[0]?.url || payload?.url;

    if (b64Json) {
      return `data:image/png;base64,${b64Json}`;
    }
    if (url) {
      return url;
    }

    throw new Error('OpenAI returned no edited image.');
  },
});