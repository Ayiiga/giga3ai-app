import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

const BILLING_DAYS: Record<string, number> = {
  monthly: 30,
  yearly: 365,
};

const PLAN_BENEFITS: Record<string, { entitlement: string; bonusCredits: number; displayName: string }> = {
  "ghc-40-monthly": { entitlement: "pro", bonusCredits: 80, displayName: "Pro Monthly" },
  "ghc-80-monthly": { entitlement: "pro-plus", bonusCredits: 160, displayName: "Pro Plus Monthly" },
  "ghc-150-monthly": { entitlement: "pro-max", bonusCredits: 300, displayName: "Pro Max Monthly" },
  "ghc-420-yearly": { entitlement: "pro", bonusCredits: 1200, displayName: "Pro Yearly" },
  "ghc-840-yearly": { entitlement: "pro-plus", bonusCredits: 2400, displayName: "Pro Plus Yearly" },
  "ghc-1575-yearly": { entitlement: "pro-max", bonusCredits: 4800, displayName: "Pro Max Yearly" },
};

function billingWindowMs(plan: string) {
  const days = BILLING_DAYS[plan] ?? 30;
  return days * 24 * 60 * 60 * 1000;
}

function normalizeEmail(email?: string | null) {
  return email ? email.trim().toLowerCase() : null;
}

function planKeyFromReference(reference: string, fallbackPlan: string) {
  const match = reference.match(/giga3_sub_([a-z0-9-]+)/i);
  return match?.[1] ?? fallbackPlan;
}

function getPlanBenefits(plan: string, billingPeriod: string | null | undefined) {
  const normalizedPlan = planKeyFromReference(plan, plan);
  const defaults = PLAN_BENEFITS[normalizedPlan] ?? {
    entitlement: "pro",
    bonusCredits: billingPeriod === "yearly" ? 1200 : 80,
    displayName: billingPeriod === "yearly" ? "Pro Yearly" : "Pro Monthly",
  };
  return defaults;
}

function parsePaymentRecord(rawRecord: string) {
  const match = rawRecord.match(/Payment of\s+([0-9]+(?:\.[0-9]+)?)\s+from\s+([^\[]+)\s+\[([^\]]+)\]/i);
  if (!match) return null;
  return {
    amount: Number(match[1]),
    email: normalizeEmail(match[2]) ?? undefined,
    reference: match[3].trim(),
  };
}

async function getReceiptByReference(ctx: any, reference: string) {
  return await ctx.db
    .query("paymentReceipts")
    .withIndex("by_reference", (q: any) => q.eq("reference", reference))
    .unique();
}

async function upsertPaymentReceipt(
  ctx: any,
  entry: {
    userId: string;
    email?: string | null;
    reference: string;
    provider: string;
    plan: string;
    amount: number;
    currency: string;
    status: "pending" | "verified" | "failed";
    subscriptionId?: any;
    verifiedAt?: number;
    reason?: string;
    rawRecord?: string;
  }
) {
  const existing = await getReceiptByReference(ctx, entry.reference);
  const clean = {
    userId: entry.userId,
    email: normalizeEmail(entry.email) ?? undefined,
    reference: entry.reference,
    provider: entry.provider,
    plan: entry.plan,
    amount: entry.amount,
    currency: entry.currency,
    status: entry.status,
    subscriptionId: entry.subscriptionId,
    verifiedAt: entry.verifiedAt,
    reason: entry.reason,
    rawRecord: entry.rawRecord,
  };

  if (existing) {
    await ctx.db.patch(existing._id, clean);
    return existing._id;
  }

  return await ctx.db.insert("paymentReceipts", clean);
}

async function writeSubscriptionHistory(ctx: any, entry: {
  userId: string;
  email?: string | null;
  subscriptionId?: any;
  eventType: string;
  plan: string;
  amount: number;
  currency: string;
  reference?: string;
  source: string;
  status: string;
  note?: string;
}) {
  return await ctx.db.insert("subscriptionHistory", {
    userId: entry.userId,
    email: normalizeEmail(entry.email) ?? undefined,
    subscriptionId: entry.subscriptionId,
    eventType: entry.eventType,
    plan: entry.plan,
    amount: entry.amount,
    currency: entry.currency,
    reference: entry.reference,
    source: entry.source,
    status: entry.status,
    note: entry.note,
    createdAt: Date.now(),
  });
}

async function assertAdmin(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (email !== "ayiiga3@gmail.com") {
    throw new Error("Admin access required");
  }
}

// ─── Get active subscription for a user ──────────────

export const getActive = query({
  args: { userId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("subscriptions"),
      plan: v.string(),
      amount: v.number(),
      currency: v.string(),
      status: v.string(),
      startDate: v.number(),
      expiryDate: v.number(),
      billingPeriod: v.union(v.string(), v.null()),
      renewalCount: v.number(),
      nextBillingAt: v.union(v.number(), v.null()),
      entitlement: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      lastPaymentReference: v.union(v.string(), v.null()),
      lastPaymentEmail: v.union(v.string(), v.null()),
      lastPaymentAt: v.union(v.number(), v.null()),
      lastPaymentStatus: v.union(v.string(), v.null()),
      failedPaymentCount: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();

    const active = subs.find((s: any) => s.status === "active" && s.expiryDate > now);
    if (!active) return null;

    return {
      _id: active._id,
      plan: active.plan,
      amount: active.amount,
      currency: active.currency,
      status: active.status,
      startDate: active.startDate,
      expiryDate: active.expiryDate,
      billingPeriod: active.billingPeriod ?? null,
      renewalCount: active.renewalCount ?? 0,
      nextBillingAt: active.nextBillingAt ?? null,
      entitlement: active.entitlement ?? null,
      email: active.email ?? null,
      lastPaymentReference: active.lastPaymentReference ?? null,
      lastPaymentEmail: active.lastPaymentEmail ?? null,
      lastPaymentAt: active.lastPaymentAt ?? null,
      lastPaymentStatus: active.lastPaymentStatus ?? null,
      failedPaymentCount: active.failedPaymentCount ?? 0,
    };
  },
});

export const getHistory = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("subscriptionHistory"),
      _creationTime: v.number(),
      userId: v.string(),
      email: v.union(v.string(), v.null()),
      subscriptionId: v.union(v.id("subscriptions"), v.null()),
      eventType: v.string(),
      plan: v.string(),
      amount: v.number(),
      currency: v.string(),
      reference: v.union(v.string(), v.null()),
      source: v.string(),
      status: v.string(),
      note: v.union(v.string(), v.null()),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("subscriptionHistory")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
    return rows.map((row: any) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      userId: row.userId,
      email: row.email ?? null,
      subscriptionId: row.subscriptionId ?? null,
      eventType: row.eventType,
      plan: row.plan,
      amount: row.amount,
      currency: row.currency,
      reference: row.reference ?? null,
      source: row.source,
      status: row.status,
      note: row.note ?? null,
      createdAt: row.createdAt,
    }));
  },
});

export const applyVerifiedPayment = mutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    plan: v.string(),
    amount: v.number(),
    currency: v.string(),
    paystackReference: v.string(),
    billingPeriod: v.optional(v.string()),
    source: v.optional(v.string()),
    rawRecord: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    subscriptionId: v.union(v.id("subscriptions"), v.null()),
    plan: v.string(),
    entitlement: v.string(),
    expiryDate: v.number(),
    creditsGranted: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedEmail = normalizeEmail(args.email);
    const period = args.billingPeriod ?? (args.plan.includes("year") ? "yearly" : "monthly");
    const planKey = planKeyFromReference(args.paystackReference, args.plan);
    const benefits = getPlanBenefits(planKey, period);

    const existingReceipt = await getReceiptByReference(ctx, args.paystackReference);
    if (existingReceipt?.status === "verified" && existingReceipt.subscriptionId) {
      const existingSubscription = await ctx.db.get(existingReceipt.subscriptionId);
      if (existingSubscription) {
        return {
          success: true,
          subscriptionId: existingSubscription._id,
          plan: existingSubscription.plan,
          entitlement: existingSubscription.entitlement ?? benefits.entitlement,
          expiryDate: existingSubscription.expiryDate,
          creditsGranted: 0,
        };
      }
    }

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();
    const active = existing.find((sub: any) => sub.status === "active" && sub.expiryDate > now) ?? null;
    const baseExpiry = active && active.expiryDate > now ? active.expiryDate : now;
    const expiryDate = baseExpiry + billingWindowMs(period);
    const nextBillingAt = expiryDate;

    for (const sub of existing) {
      if (sub.status === "active") {
        await ctx.db.patch(sub._id, { status: "expired", updatedAt: now });
      }
    }

    let subscriptionId: any = active?._id ?? null;
    if (active) {
      await ctx.db.patch(active._id, {
        plan: planKey,
        amount: args.amount,
        currency: args.currency,
        paystackReference: args.paystackReference,
        status: "active",
        expiryDate,
        billingPeriod: period,
        renewalCount: (active.renewalCount ?? 0) + 1,
        nextBillingAt,
        entitlement: benefits.entitlement,
        email: normalizedEmail ?? active.email ?? undefined,
        lastPaymentReference: args.paystackReference,
        lastPaymentEmail: normalizedEmail ?? active.lastPaymentEmail ?? undefined,
        lastPaymentAt: now,
        lastPaymentStatus: "success",
        failedPaymentCount: 0,
        source: args.source ?? "paystack",
        updatedAt: now,
      });
    } else {
      subscriptionId = await ctx.db.insert("subscriptions", {
        userId: args.userId,
        plan: planKey,
        amount: args.amount,
        currency: args.currency,
        paystackReference: args.paystackReference,
        status: "active",
        startDate: now,
        expiryDate,
        billingPeriod: period,
        renewalCount: 0,
        nextBillingAt,
        entitlement: benefits.entitlement,
        email: normalizedEmail ?? undefined,
        lastPaymentReference: args.paystackReference,
        lastPaymentEmail: normalizedEmail ?? undefined,
        lastPaymentAt: now,
        lastPaymentStatus: "success",
        failedPaymentCount: 0,
        source: args.source ?? "paystack",
        updatedAt: now,
      });
    }

    await upsertPaymentReceipt(ctx, {
      userId: args.userId,
      email: normalizedEmail,
      reference: args.paystackReference,
      provider: args.source ?? "paystack",
      plan: planKey,
      amount: args.amount,
      currency: args.currency,
      status: "verified",
      subscriptionId,
      verifiedAt: now,
      rawRecord: args.rawRecord,
    });

    await writeSubscriptionHistory(ctx, {
      userId: args.userId,
      email: normalizedEmail,
      subscriptionId,
      eventType: active ? "renewal" : "activation",
      plan: planKey,
      amount: args.amount,
      currency: args.currency,
      reference: args.paystackReference,
      source: args.source ?? "paystack",
      status: "success",
      note: benefits.displayName,
    });

    const creditGrant = benefits.bonusCredits;
    if (creditGrant > 0) {
      const creditsToGrant: number = await ctx.runQuery(internal.credits.getCreditsForAmountInternal, {
        amountGhs: args.amount,
        reference: args.paystackReference,
      });
      await ctx.runMutation(internal.credits.grantCreditsInternal, {
        userId: args.userId,
        amount: creditsToGrant > 0 ? creditsToGrant : creditGrant,
        source: "subscription-bonus",
        reference: args.paystackReference,
        note: `Automatic credits for ${benefits.displayName}`,
      });
    }

    return {
      success: true,
      subscriptionId,
      plan: planKey,
      entitlement: benefits.entitlement,
      expiryDate,
      creditsGranted: creditGrant,
    };
  },
});

export const applyVerifiedPaymentInternal = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    plan: v.string(),
    amount: v.number(),
    currency: v.string(),
    paystackReference: v.string(),
    billingPeriod: v.optional(v.string()),
    source: v.optional(v.string()),
    rawRecord: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    subscriptionId: v.union(v.id("subscriptions"), v.null()),
    plan: v.string(),
    entitlement: v.string(),
    expiryDate: v.number(),
    creditsGranted: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.subscriptions.applyVerifiedPayment, args);
  },
});

export const recordFailedPayment = mutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    plan: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    paystackReference: v.optional(v.string()),
    reason: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), failedPaymentCount: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedEmail = normalizeEmail(args.email);
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .collect();
    const latest = rows[0] ?? null;
    if (latest) {
      await ctx.db.patch(latest._id, {
        failedPaymentCount: (latest.failedPaymentCount ?? 0) + 1,
        lastPaymentReference: args.paystackReference ?? latest.lastPaymentReference ?? undefined,
        lastPaymentEmail: normalizedEmail ?? latest.lastPaymentEmail ?? undefined,
        lastPaymentAt: now,
        lastPaymentStatus: "failed",
        updatedAt: now,
      });
    }

    if (args.paystackReference) {
      await upsertPaymentReceipt(ctx, {
        userId: args.userId,
        email: normalizedEmail,
        reference: args.paystackReference,
        provider: args.source ?? "paystack",
        plan: args.plan ?? latest?.plan ?? "unknown",
        amount: args.amount ?? 0,
        currency: args.currency ?? "GHS",
        status: "failed",
        reason: args.reason ?? "Payment verification failed",
        rawRecord: args.reason,
      });
    }

    await writeSubscriptionHistory(ctx, {
      userId: args.userId,
      email: normalizedEmail,
      subscriptionId: latest?._id ?? undefined,
      eventType: "failed_payment",
      plan: args.plan ?? latest?.plan ?? "unknown",
      amount: args.amount ?? 0,
      currency: args.currency ?? "GHS",
      reference: args.paystackReference,
      source: args.source ?? "paystack",
      status: "failed",
      note: args.reason ?? "Payment verification failed",
    });

    return { success: true, failedPaymentCount: (latest?.failedPaymentCount ?? 0) + 1 };
  },
});

export const recordFailedPaymentInternal = internalMutation({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    plan: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    paystackReference: v.optional(v.string()),
    reason: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean(), failedPaymentCount: v.number() }),
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.subscriptions.recordFailedPayment, args);
  },
});

// ─── Create subscription after payment ───────────────

export const create = mutation({
  args: {
    userId: v.string(),
    plan: v.string(),
    amount: v.number(),
    currency: v.string(),
    paystackReference: v.string(),
    billingPeriod: v.optional(v.string()),
    entitlement: v.optional(v.string()),
  },
  returns: v.id("subscriptions"),
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(internal.subscriptions.applyVerifiedPaymentInternal, {
      userId: args.userId,
      plan: args.plan,
      amount: args.amount,
      currency: args.currency,
      paystackReference: args.paystackReference,
      billingPeriod: args.billingPeriod,
      source: "legacy-create",
    });
    return result.subscriptionId ?? (await ctx.db.insert("subscriptions", {
      userId: args.userId,
      plan: args.plan,
      amount: args.amount,
      currency: args.currency,
      paystackReference: args.paystackReference,
      status: "active",
      startDate: Date.now(),
      expiryDate: Date.now() + billingWindowMs(args.billingPeriod ?? "monthly"),
      billingPeriod: args.billingPeriod ?? "monthly",
      renewalCount: 0,
      nextBillingAt: Date.now() + billingWindowMs(args.billingPeriod ?? "monthly"),
      entitlement: args.entitlement ?? args.plan,
      updatedAt: Date.now(),
    }));
  },
});

// ─── Renew subscription ─────────────────────────────

export const renew = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    paystackReference: v.string(),
    amount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return null;
    const now = Date.now();
    const period = sub.billingPeriod ?? "monthly";
    const baseExpiry = sub.expiryDate > now ? sub.expiryDate : now;
    const nextExpiry = baseExpiry + billingWindowMs(period);
    const benefits = getPlanBenefits(sub.plan, period);

    await ctx.db.patch(sub._id, {
      status: "active",
      paystackReference: args.paystackReference,
      amount: args.amount,
      expiryDate: nextExpiry,
      nextBillingAt: nextExpiry,
      renewalCount: (sub.renewalCount ?? 0) + 1,
      lastPaymentReference: args.paystackReference,
      lastPaymentAt: now,
      lastPaymentStatus: "success",
      failedPaymentCount: 0,
      entitlement: benefits.entitlement,
      updatedAt: now,
    });
    await writeSubscriptionHistory(ctx, {
      userId: sub.userId,
      email: sub.email ?? null,
      subscriptionId: sub._id,
      eventType: "renewal",
      plan: sub.plan,
      amount: args.amount,
      currency: sub.currency,
      reference: args.paystackReference,
      source: "paystack",
      status: "success",
      note: benefits.displayName,
    });
    return null;
  },
});

// ─── Expire due subscriptions ───────────────────────

export const expireDue = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const subs = await ctx.db.query("subscriptions").take(100);
    let expired = 0;
    for (const sub of subs) {
      if (sub.status === "active" && sub.expiryDate <= now) {
        await ctx.db.patch(sub._id, { status: "expired" });
        expired += 1;
      }
    }
    return expired;
  },
});

// ─── Cancel subscription ─────────────────────────────

export const cancel = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, { status: "cancelled" });
    return null;
  },
});

// ─── Verify by reference (after payment) ─────────────

export const getByReference = query({
  args: { reference: v.string() },
  returns: v.union(v.id("subscriptions"), v.null()),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_reference", (q: any) => q.eq("paystackReference", args.reference))
      .first();
    return sub?._id ?? null;
  },
});

export const listPaymentReceipts = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("paymentReceipts"),
      _creationTime: v.number(),
      userId: v.string(),
      email: v.union(v.string(), v.null()),
      reference: v.string(),
      provider: v.string(),
      plan: v.string(),
      amount: v.number(),
      currency: v.string(),
      status: v.string(),
      subscriptionId: v.union(v.id("subscriptions"), v.null()),
      verifiedAt: v.union(v.number(), v.null()),
      reason: v.union(v.string(), v.null()),
      rawRecord: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const rows = await ctx.db.query("paymentReceipts").withIndex("by_status", (q: any) => q.eq("status", "pending")).take(limit);
    return rows.map((row: any) => ({
      _id: row._id,
      _creationTime: row._creationTime,
      userId: row.userId,
      email: row.email ?? null,
      reference: row.reference,
      provider: row.provider,
      plan: row.plan,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      subscriptionId: row.subscriptionId ?? null,
      verifiedAt: row.verifiedAt ?? null,
      reason: row.reason ?? null,
      rawRecord: row.rawRecord ?? null,
    }));
  },
});

export const adminResolvePaymentRecord = mutation({
  args: { rawRecord: v.string() },
  returns: v.object({ success: v.boolean(), reference: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const parsed = parsePaymentRecord(args.rawRecord);
    if (!parsed) {
      return { success: false, reference: null };
    }
    const plan = planKeyFromReference(parsed.reference, parsed.amount >= 40 ? "ghc-40-monthly" : "ghc-40-monthly");
    const user = await ctx.db
      .query("accountProfiles")
      .withIndex("by_email", (q: any) => q.eq("email", parsed.email ?? ""))
      .unique();
    if (!user) {
      await upsertPaymentReceipt(ctx, {
        userId: parsed.email ?? "unknown",
        email: parsed.email,
        reference: parsed.reference,
        provider: "manual",
        plan,
        amount: parsed.amount,
        currency: "GHS",
        status: "pending",
        rawRecord: args.rawRecord,
      });
      return { success: false, reference: parsed.reference };
    }

    await ctx.runMutation(internal.subscriptions.applyVerifiedPaymentInternal, {
      userId: user.authId,
      email: parsed.email,
      plan,
      amount: parsed.amount,
      currency: "GHS",
      paystackReference: parsed.reference,
      billingPeriod: "monthly",
      source: "admin-manual",
      rawRecord: args.rawRecord,
    });
    return { success: true, reference: parsed.reference };
  },
});

export const applyPaymentRecordInternal = internalMutation({
  args: { rawRecord: v.string() },
  returns: v.object({
    success: v.boolean(),
    reference: v.union(v.string(), v.null()),
    userId: v.union(v.string(), v.null()),
    plan: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const parsed = parsePaymentRecord(args.rawRecord);
    if (!parsed) {
      return { success: false, reference: null, userId: null, plan: null };
    }

    const plan = planKeyFromReference(parsed.reference, "ghc-40-monthly");
    const user = await ctx.runQuery(internal.users.getUserByEmail, {
      email: parsed.email ?? "",
    });
    if (!user) {
      return { success: false, reference: parsed.reference, userId: null, plan };
    }

    await ctx.runMutation(internal.subscriptions.applyVerifiedPaymentInternal, {
      userId: user.userId,
      email: parsed.email,
      plan,
      amount: parsed.amount,
      currency: "GHS",
      paystackReference: parsed.reference,
      billingPeriod: plan.includes("year") ? "yearly" : "monthly",
      source: "manual-auto",
      rawRecord: args.rawRecord,
    });

    return {
      success: true,
      reference: parsed.reference,
      userId: user.userId,
      plan,
    };
  },
});