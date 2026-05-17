import { mutation, internalQuery, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const ADMIN_EMAIL = 'ayiiga3@gmail.com';

// ─── Set a platform setting (one-time setup) ─────────

export const setSetting = mutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Not authenticated');
    }

    const profile = await ctx.db
      .query("accountProfiles")
      .withIndex("by_authId", (q: any) => q.eq("authId", identity.subject))
      .unique();
    const email = profile?.email?.trim().toLowerCase();
    if (email !== ADMIN_EMAIL) {
      throw new Error('Not authorized');
    }

    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q: any) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("platformSettings", { key: args.key, value: args.value });
    }
    return null;
  },
});

export const setInternalSetting = internalMutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q: any) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("platformSettings", { key: args.key, value: args.value });
    }
    return null;
  },
});

// ─── Get a setting (internal only — server-side access) ──

export const getSetting = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q: any) => q.eq("key", args.key))
      .first();
    return row?.value ?? null;
  },
});

export const getOpenAIStatus = query({
  args: {},
  returns: v.union(
    v.object({
      configured: v.boolean(),
      model: v.union(v.string(), v.null()),
      lastVerifiedAt: v.union(v.number(), v.null()),
      lastVerifiedStatus: v.union(v.string(), v.null()),
      lastVerifiedMessage: v.union(v.string(), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const profile = await ctx.db
      .query("accountProfiles")
      .withIndex("by_authId", (q: any) => q.eq("authId", identity.subject))
      .unique();
    const email = profile?.email?.trim().toLowerCase();
    if (email !== ADMIN_EMAIL) return null;

    const [apiKey, model, verifiedAt, verifiedStatus, verifiedMessage] = await Promise.all([
      ctx.db
        .query("platformSettings")
        .withIndex("by_key", (q: any) => q.eq("key", "OPENAI_API_KEY"))
        .first(),
      ctx.db
        .query("platformSettings")
        .withIndex("by_key", (q: any) => q.eq("key", "OPENAI_MODEL"))
        .first(),
      ctx.db
        .query("platformSettings")
        .withIndex("by_key", (q: any) => q.eq("key", "OPENAI_LAST_VERIFIED_AT"))
        .first(),
      ctx.db
        .query("platformSettings")
        .withIndex("by_key", (q: any) => q.eq("key", "OPENAI_LAST_VERIFIED_STATUS"))
        .first(),
      ctx.db
        .query("platformSettings")
        .withIndex("by_key", (q: any) => q.eq("key", "OPENAI_LAST_VERIFIED_MESSAGE"))
        .first(),
    ]);

    return {
      configured: !!apiKey?.value,
      model: model?.value ?? null,
      lastVerifiedAt: verifiedAt?.value ? Number(verifiedAt.value) : null,
      lastVerifiedStatus: verifiedStatus?.value ?? null,
      lastVerifiedMessage: verifiedMessage?.value ?? null,
    };
  },
});

// ─── Get Paystack public key (safe to expose — it's a public key) ──

export const getPaystackPublicKey = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("platformSettings")
      .withIndex("by_key", (q: any) => q.eq("key", "PAYSTACK_PUBLIC_KEY"))
      .first();
    return row?.value ?? null;
  },
});