/**
 * I2 Loyalty points and rewards
 *
 * Per-business (or per-seller) points ledger only — NOT a cash wallet,
 * NOT redeemable for MoMo / cash. Earn on completed orders; redeem creates
 * a pending offline fulfilment request for the seller.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type LoyaltyEarnMode = 'per_currency' | 'flat_per_order';

export type LoyaltyProgram = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  earnMode: LoyaltyEarnMode;
  /** Points awarded per 1 unit of currency (when earnMode=per_currency). */
  pointsPerCurrency: number;
  /** Flat points per completed order (when earnMode=flat_per_order). */
  flatPointsPerOrder: number;
  termsNote: string;
  createdAt: string;
  updatedAt: string;
};

export type LoyaltyBalance = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  customerUserId: string;
  pointsBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
};

export type LoyaltyLedgerKind =
  | 'earn_order'
  | 'adjust'
  | 'redeem'
  | 'redeem_cancel'
  | 'reversal';

export type LoyaltyLedgerEntry = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  customerUserId: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  kind: LoyaltyLedgerKind;
  orderId?: string | null;
  redemptionId?: string | null;
  byUserId: string;
  createdAt: string;
};

export type LoyaltyReward = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  name: string;
  pointsCost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LoyaltyRedemptionStatus = 'pending' | 'fulfilled' | 'cancelled';

export type LoyaltyRedemption = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  customerUserId: string;
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  status: LoyaltyRedemptionStatus;
  createdAt: string;
  updatedAt: string;
  fulfilledAt?: string | null;
  cancelledAt?: string | null;
};

export type LoyaltyOrderSnapshot = {
  id: string;
  buyerUserId: string;
  sellerUserId: string;
  businessId?: string | null;
  totalAmount: number;
  currency: string;
  state: string;
};

export type LoyaltyDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  /** Resolve display name for leaderboard rows. */
  resolveUserName?: (userId: string) => Promise<string | null>;
  /** Optional: confirm seller may manage this businessId. */
  canManageBusiness?: (userId: string, businessId: string | null | undefined) => Promise<boolean>;
};

export const LOYALTY_POINTS_NOTE =
  'Loyalty points only — not cash, and not redeemable for MoMo or any cash payout. Rewards are fulfilled offline by the business.';

const DEFAULT_TERMS =
  'Earn points on completed orders. Points are a thank-you from the business, not money. Rewards are fulfilled in-store or offline — never as Mobile Money cash.';

const seedPrograms: LoyaltyProgram[] = [];
const seedBalances: LoyaltyBalance[] = [];
const seedLedger: LoyaltyLedgerEntry[] = [];
const seedRewards: LoyaltyReward[] = [];
const seedRedemptions: LoyaltyRedemption[] = [];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const sameScope = (
  a: { ownerUserId: string; businessId?: string | null },
  ownerUserId: string,
  businessId?: string | null,
) => {
  if (a.ownerUserId !== ownerUserId) return false;
  const left = a.businessId || null;
  const right = businessId || null;
  return left === right;
};

async function ensureLoyaltyIndexes(deps: LoyaltyDeps) {
  const db = await deps.getDb();
  if (!db) return;
  try {
    await db.collection('loyaltyPrograms').createIndex(
      { ownerUserId: 1, businessId: 1 },
      { unique: true, name: 'loyaltyPrograms_owner_business' },
    );
    await db.collection('loyaltyBalances').createIndex(
      { ownerUserId: 1, businessId: 1, customerUserId: 1 },
      { unique: true, name: 'loyaltyBalances_scope_customer' },
    );
    await db.collection('loyaltyLedger').createIndex(
      { orderId: 1, kind: 1 },
      { unique: true, partialFilterExpression: { orderId: { $type: 'string' }, kind: 'earn_order' }, name: 'loyaltyLedger_earn_order' },
    );
    await db.collection('loyaltyLedger').createIndex(
      { ownerUserId: 1, customerUserId: 1, createdAt: -1 },
      { name: 'loyaltyLedger_owner_customer' },
    );
    await db.collection('loyaltyRewards').createIndex(
      { ownerUserId: 1, businessId: 1, createdAt: -1 },
      { name: 'loyaltyRewards_owner' },
    );
    await db.collection('loyaltyRedemptions').createIndex(
      { ownerUserId: 1, status: 1, createdAt: -1 },
      { name: 'loyaltyRedemptions_owner_status' },
    );
  } catch {
    // Indexes may already exist.
  }
}

async function findProgram(
  deps: LoyaltyDeps,
  ownerUserId: string,
  businessId?: string | null,
): Promise<LoyaltyProgram | null> {
  const db = await deps.getDb();
  const biz = businessId || null;
  if (!db) {
    return (
      seedPrograms.find((entry) => sameScope(entry, ownerUserId, biz))
      ?? null
    );
  }
  return db.collection<LoyaltyProgram>('loyaltyPrograms').findOne(
    { ownerUserId, businessId: biz },
    { projection: { _id: 0 } },
  );
}

async function saveProgram(deps: LoyaltyDeps, program: LoyaltyProgram) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedPrograms, program);
  await db
    .collection<LoyaltyProgram>('loyaltyPrograms')
    .updateOne({ id: program.id }, { $set: program }, { upsert: true });
  return program;
}

async function ensureProgram(
  deps: LoyaltyDeps,
  ownerUserId: string,
  businessId?: string | null,
): Promise<LoyaltyProgram> {
  const existing = await findProgram(deps, ownerUserId, businessId);
  if (existing) return existing;
  const stamp = nowIso();
  const program: LoyaltyProgram = {
    id: newId('loyprog'),
    ownerUserId,
    businessId: businessId || null,
    enabled: false,
    earnMode: 'per_currency',
    pointsPerCurrency: 1,
    flatPointsPerOrder: 10,
    termsNote: DEFAULT_TERMS,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return saveProgram(deps, program);
}

async function findBalance(
  deps: LoyaltyDeps,
  ownerUserId: string,
  customerUserId: string,
  businessId?: string | null,
): Promise<LoyaltyBalance | null> {
  const db = await deps.getDb();
  const biz = businessId || null;
  if (!db) {
    return (
      seedBalances.find(
        (entry) =>
          sameScope(entry, ownerUserId, biz) && entry.customerUserId === customerUserId,
      ) ?? null
    );
  }
  return db.collection<LoyaltyBalance>('loyaltyBalances').findOne(
    { ownerUserId, businessId: biz, customerUserId },
    { projection: { _id: 0 } },
  );
}

async function saveBalance(deps: LoyaltyDeps, balance: LoyaltyBalance) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedBalances, balance);
  await db
    .collection<LoyaltyBalance>('loyaltyBalances')
    .updateOne({ id: balance.id }, { $set: balance }, { upsert: true });
  return balance;
}

async function ensureBalance(
  deps: LoyaltyDeps,
  ownerUserId: string,
  customerUserId: string,
  businessId?: string | null,
): Promise<LoyaltyBalance> {
  const existing = await findBalance(deps, ownerUserId, customerUserId, businessId);
  if (existing) return existing;
  const stamp = nowIso();
  let displayName: string | undefined;
  if (deps.resolveUserName) {
    displayName = (await deps.resolveUserName(customerUserId)) || undefined;
  }
  const balance: LoyaltyBalance = {
    id: newId('loybal'),
    ownerUserId,
    businessId: businessId || null,
    customerUserId,
    pointsBalance: 0,
    lifetimeEarned: 0,
    lifetimeRedeemed: 0,
    displayName,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return saveBalance(deps, balance);
}

async function saveLedger(deps: LoyaltyDeps, entry: LoyaltyLedgerEntry) {
  const db = await deps.getDb();
  if (!db) {
    seedLedger.unshift(entry);
    if (seedLedger.length > 2000) seedLedger.length = 2000;
    return entry;
  }
  await db.collection<LoyaltyLedgerEntry>('loyaltyLedger').insertOne(entry);
  return entry;
}

async function findEarnForOrder(deps: LoyaltyDeps, orderId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedLedger.find((entry) => entry.orderId === orderId && entry.kind === 'earn_order') ?? null;
  }
  return db.collection<LoyaltyLedgerEntry>('loyaltyLedger').findOne(
    { orderId, kind: 'earn_order' },
    { projection: { _id: 0 } },
  );
}

async function findReversalForOrder(deps: LoyaltyDeps, orderId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedLedger.find((entry) => entry.orderId === orderId && entry.kind === 'reversal') ?? null;
  }
  return db.collection<LoyaltyLedgerEntry>('loyaltyLedger').findOne(
    { orderId, kind: 'reversal' },
    { projection: { _id: 0 } },
  );
}

async function listBalancesForOwner(
  deps: LoyaltyDeps,
  ownerUserId: string,
  businessId?: string | null,
  limit = 50,
): Promise<LoyaltyBalance[]> {
  const db = await deps.getDb();
  const biz = businessId || null;
  if (!db) {
    return seedBalances
      .filter((entry) => sameScope(entry, ownerUserId, biz))
      .sort((a, b) => b.pointsBalance - a.pointsBalance)
      .slice(0, limit);
  }
  return db
    .collection<LoyaltyBalance>('loyaltyBalances')
    .find({ ownerUserId, businessId: biz }, { projection: { _id: 0 } })
    .sort({ pointsBalance: -1 })
    .limit(limit)
    .toArray();
}

async function listLedger(
  deps: LoyaltyDeps,
  ownerUserId: string,
  customerUserId: string,
  businessId?: string | null,
  limit = 40,
): Promise<LoyaltyLedgerEntry[]> {
  const db = await deps.getDb();
  const biz = businessId || null;
  if (!db) {
    return seedLedger
      .filter(
        (entry) =>
          sameScope(entry, ownerUserId, biz) && entry.customerUserId === customerUserId,
      )
      .slice(0, limit);
  }
  return db
    .collection<LoyaltyLedgerEntry>('loyaltyLedger')
    .find({ ownerUserId, businessId: biz, customerUserId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

async function listRewards(
  deps: LoyaltyDeps,
  ownerUserId: string,
  businessId?: string | null,
  activeOnly = false,
): Promise<LoyaltyReward[]> {
  const db = await deps.getDb();
  const biz = businessId || null;
  if (!db) {
    return seedRewards
      .filter(
        (entry) =>
          sameScope(entry, ownerUserId, biz) && (!activeOnly || entry.active !== false),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const filter: Record<string, unknown> = { ownerUserId, businessId: biz };
  if (activeOnly) filter.active = true;
  return db
    .collection<LoyaltyReward>('loyaltyRewards')
    .find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
}

async function findReward(deps: LoyaltyDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedRewards.find((entry) => entry.id === id) ?? null;
  return db.collection<LoyaltyReward>('loyaltyRewards').findOne({ id }, { projection: { _id: 0 } });
}

async function saveReward(deps: LoyaltyDeps, reward: LoyaltyReward) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedRewards, reward);
  await db.collection<LoyaltyReward>('loyaltyRewards').updateOne({ id: reward.id }, { $set: reward }, { upsert: true });
  return reward;
}

async function deleteReward(deps: LoyaltyDeps, id: string) {
  const db = await deps.getDb();
  if (!db) {
    const index = seedRewards.findIndex((entry) => entry.id === id);
    if (index >= 0) seedRewards.splice(index, 1);
    return;
  }
  await db.collection('loyaltyRewards').deleteOne({ id });
}

async function saveRedemption(deps: LoyaltyDeps, redemption: LoyaltyRedemption) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedRedemptions, redemption);
  await db
    .collection<LoyaltyRedemption>('loyaltyRedemptions')
    .updateOne({ id: redemption.id }, { $set: redemption }, { upsert: true });
  return redemption;
}

async function findRedemption(deps: LoyaltyDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedRedemptions.find((entry) => entry.id === id) ?? null;
  return db
    .collection<LoyaltyRedemption>('loyaltyRedemptions')
    .findOne({ id }, { projection: { _id: 0 } });
}

async function listRedemptions(
  deps: LoyaltyDeps,
  filter: {
    ownerUserId?: string;
    customerUserId?: string;
    businessId?: string | null;
    status?: LoyaltyRedemptionStatus;
  },
  limit = 50,
): Promise<LoyaltyRedemption[]> {
  const db = await deps.getDb();
  if (!db) {
    return seedRedemptions
      .filter((entry) => {
        if (filter.ownerUserId && entry.ownerUserId !== filter.ownerUserId) return false;
        if (filter.customerUserId && entry.customerUserId !== filter.customerUserId) return false;
        if (filter.businessId !== undefined) {
          if ((entry.businessId || null) !== (filter.businessId || null)) return false;
        }
        if (filter.status && entry.status !== filter.status) return false;
        return true;
      })
      .slice(0, limit);
  }
  const query: Record<string, unknown> = {};
  if (filter.ownerUserId) query.ownerUserId = filter.ownerUserId;
  if (filter.customerUserId) query.customerUserId = filter.customerUserId;
  if (filter.businessId !== undefined) query.businessId = filter.businessId || null;
  if (filter.status) query.status = filter.status;
  return db
    .collection<LoyaltyRedemption>('loyaltyRedemptions')
    .find(query, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

const computeEarnPoints = (program: LoyaltyProgram, totalAmount: number) => {
  if (!program.enabled) return 0;
  if (program.earnMode === 'flat_per_order') {
    return Math.max(0, Math.floor(Number(program.flatPointsPerOrder) || 0));
  }
  const rate = Number(program.pointsPerCurrency) || 0;
  if (rate <= 0) return 0;
  return Math.max(0, Math.floor(Number(totalAmount) * rate));
};

const applyDelta = async (
  deps: LoyaltyDeps,
  params: {
    ownerUserId: string;
    businessId?: string | null;
    customerUserId: string;
    delta: number;
    reason: string;
    kind: LoyaltyLedgerKind;
    byUserId: string;
    orderId?: string | null;
    redemptionId?: string | null;
  },
): Promise<{ balance: LoyaltyBalance; entry: LoyaltyLedgerEntry } | { error: string }> => {
  if (!params.delta || !Number.isFinite(params.delta)) {
    return { error: 'Delta must be a non-zero number' };
  }
  const delta = Math.trunc(params.delta);
  if (!delta) return { error: 'Delta must be a non-zero integer' };

  const balance = await ensureBalance(
    deps,
    params.ownerUserId,
    params.customerUserId,
    params.businessId,
  );
  const nextPoints = balance.pointsBalance + delta;
  if (nextPoints < 0) {
    return { error: 'Insufficient points balance' };
  }

  const stamp = nowIso();
  const next: LoyaltyBalance = {
    ...balance,
    pointsBalance: nextPoints,
    lifetimeEarned: balance.lifetimeEarned + (delta > 0 ? delta : 0),
    lifetimeRedeemed: balance.lifetimeRedeemed + (delta < 0 ? Math.abs(delta) : 0),
    updatedAt: stamp,
  };
  if (deps.resolveUserName && !next.displayName) {
    next.displayName = (await deps.resolveUserName(params.customerUserId)) || next.displayName;
  }
  await saveBalance(deps, next);

  const entry: LoyaltyLedgerEntry = {
    id: newId('loyled'),
    ownerUserId: params.ownerUserId,
    businessId: params.businessId || null,
    customerUserId: params.customerUserId,
    delta,
    balanceAfter: nextPoints,
    reason: params.reason.slice(0, 240),
    kind: params.kind,
    orderId: params.orderId || null,
    redemptionId: params.redemptionId || null,
    byUserId: params.byUserId,
    createdAt: stamp,
  };
  try {
    await saveLedger(deps, entry);
  } catch (error) {
    // Unique earn_order index may race — treat as already awarded.
    if (params.kind === 'earn_order' && params.orderId) {
      const existing = await findEarnForOrder(deps, params.orderId);
      if (existing) {
        return { error: 'Points already awarded for this order' };
      }
    }
    throw error;
  }

  deps.io.to(`user:${params.ownerUserId}`).emit('loyalty:updated', {
    balance: next,
    entry,
    pointsNote: LOYALTY_POINTS_NOTE,
  });
  deps.io.to(`user:${params.customerUserId}`).emit('loyalty:updated', {
    balance: next,
    entry,
    pointsNote: LOYALTY_POINTS_NOTE,
  });

  return { balance: next, entry };
};

/**
 * Award points when an order becomes completed. Idempotent per order.
 * Safe to call fire-and-forget from the order state machine.
 */
export async function awardLoyaltyForCompletedOrder(
  deps: LoyaltyDeps,
  order: LoyaltyOrderSnapshot,
): Promise<{ awarded: number; balance?: LoyaltyBalance } | null> {
  if (!order?.id || !order.buyerUserId || !order.sellerUserId) return null;
  if (order.state !== 'completed') return null;
  if (order.buyerUserId === order.sellerUserId) return null;

  const existing = await findEarnForOrder(deps, order.id);
  if (existing) return { awarded: 0 };

  const program = await findProgram(deps, order.sellerUserId, order.businessId);
  if (!program || !program.enabled) return null;

  const points = computeEarnPoints(program, order.totalAmount);
  if (points <= 0) return null;

  const result = await applyDelta(deps, {
    ownerUserId: order.sellerUserId,
    businessId: order.businessId,
    customerUserId: order.buyerUserId,
    delta: points,
    reason: `Earned on completed order ${order.id}`,
    kind: 'earn_order',
    byUserId: 'system',
    orderId: order.id,
  });
  if ('error' in result) return { awarded: 0 };
  return { awarded: points, balance: result.balance };
}

/**
 * Reverse previously earned points when an order is refunded. Idempotent.
 */
export async function reverseLoyaltyForRefundedOrder(
  deps: LoyaltyDeps,
  order: LoyaltyOrderSnapshot,
): Promise<{ reversed: number } | null> {
  if (!order?.id) return null;
  const earn = await findEarnForOrder(deps, order.id);
  if (!earn || earn.delta <= 0) return null;
  const already = await findReversalForOrder(deps, order.id);
  if (already) return { reversed: 0 };

  const result = await applyDelta(deps, {
    ownerUserId: earn.ownerUserId,
    businessId: earn.businessId,
    customerUserId: earn.customerUserId,
    delta: -Math.abs(earn.delta),
    reason: `Reversed for refunded order ${order.id}`,
    kind: 'reversal',
    byUserId: 'system',
    orderId: order.id,
  });
  if ('error' in result) {
    // Balance may be too low after redemptions — clamp by zeroing remaining.
    const balance = await ensureBalance(
      deps,
      earn.ownerUserId,
      earn.customerUserId,
      earn.businessId,
    );
    if (balance.pointsBalance <= 0) return { reversed: 0 };
    const clamped = await applyDelta(deps, {
      ownerUserId: earn.ownerUserId,
      businessId: earn.businessId,
      customerUserId: earn.customerUserId,
      delta: -balance.pointsBalance,
      reason: `Partial reversal for refunded order ${order.id} (balance limited)`,
      kind: 'reversal',
      byUserId: 'system',
      orderId: order.id,
    });
    if ('error' in clamped) return { reversed: 0 };
    return { reversed: Math.abs(clamped.entry.delta) };
  }
  return { reversed: Math.abs(result.entry.delta) };
}

const resolveUserId = async (deps: LoyaltyDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

const assertCanManage = async (
  deps: LoyaltyDeps,
  userId: string,
  businessId?: string | null,
) => {
  if (!businessId) return true;
  if (!deps.canManageBusiness) return true;
  return deps.canManageBusiness(userId, businessId);
};

const programSchema = z.object({
  userId: z.string().min(1).optional(),
  businessId: z.string().min(1).max(80).nullable().optional(),
  enabled: z.boolean().optional(),
  earnMode: z.enum(['per_currency', 'flat_per_order']).optional(),
  pointsPerCurrency: z.number().min(0).max(1000).optional(),
  flatPointsPerOrder: z.number().int().min(0).max(100000).optional(),
  termsNote: z.string().trim().max(800).optional(),
});

const adjustSchema = z.object({
  userId: z.string().min(1).optional(),
  businessId: z.string().min(1).max(80).nullable().optional(),
  customerUserId: z.string().min(1),
  delta: z.number().int().refine((value) => value !== 0, 'delta must be non-zero'),
  reason: z.string().trim().min(2).max(240),
});

const rewardCreateSchema = z.object({
  userId: z.string().min(1).optional(),
  businessId: z.string().min(1).max(80).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  pointsCost: z.number().int().min(1).max(1_000_000),
  active: z.boolean().optional(),
});

const rewardPatchSchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  pointsCost: z.number().int().min(1).max(1_000_000).optional(),
  active: z.boolean().optional(),
});

const redeemSchema = z.object({
  userId: z.string().min(1).optional(),
  rewardId: z.string().min(1),
  businessId: z.string().min(1).max(80).nullable().optional(),
  ownerUserId: z.string().min(1).optional(),
});

const redemptionPatchSchema = z.object({
  userId: z.string().min(1).optional(),
  status: z.enum(['fulfilled', 'cancelled']),
});

export const registerLoyaltyApi = (app: Express, deps: LoyaltyDeps) => {
  void ensureLoyaltyIndexes(deps);

  /** Seller: get or create loyalty program settings. */
  app.get('/api/loyalty/program', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId =
      typeof req.query.businessId === 'string' && req.query.businessId.trim()
        ? req.query.businessId.trim()
        : null;
    if (!(await assertCanManage(deps, userId, businessId))) {
      return res.status(403).json({ error: 'You cannot manage this business loyalty program.' });
    }
    const program = await ensureProgram(deps, userId, businessId);
    return res.json({ program, pointsNote: LOYALTY_POINTS_NOTE });
  });

  /** Seller: update earn rate / enable. */
  app.put('/api/loyalty/program', async (req, res) => {
    const parsed = programSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid loyalty program', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId = parsed.data.businessId === undefined ? null : parsed.data.businessId;
    if (!(await assertCanManage(deps, userId, businessId))) {
      return res.status(403).json({ error: 'You cannot manage this business loyalty program.' });
    }
    const program = await ensureProgram(deps, userId, businessId);
    if (parsed.data.enabled !== undefined) program.enabled = parsed.data.enabled;
    if (parsed.data.earnMode !== undefined) program.earnMode = parsed.data.earnMode;
    if (parsed.data.pointsPerCurrency !== undefined) {
      program.pointsPerCurrency = parsed.data.pointsPerCurrency;
    }
    if (parsed.data.flatPointsPerOrder !== undefined) {
      program.flatPointsPerOrder = parsed.data.flatPointsPerOrder;
    }
    if (parsed.data.termsNote !== undefined) program.termsNote = parsed.data.termsNote;
    program.updatedAt = nowIso();
    await saveProgram(deps, program);
    deps.io.to(`user:${userId}`).emit('loyalty:program', { program, pointsNote: LOYALTY_POINTS_NOTE });
    return res.json({ program, pointsNote: LOYALTY_POINTS_NOTE });
  });

  /** Seller: top / all customer balances. Customer: own balance with a seller. */
  app.get('/api/loyalty/balances', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId =
      typeof req.query.businessId === 'string' && req.query.businessId.trim()
        ? req.query.businessId.trim()
        : null;
    const ownerUserId =
      typeof req.query.ownerUserId === 'string' && req.query.ownerUserId.trim()
        ? req.query.ownerUserId.trim()
        : userId;
    const asSeller = ownerUserId === userId;
    if (asSeller) {
      if (!(await assertCanManage(deps, userId, businessId))) {
        return res.status(403).json({ error: 'You cannot view these balances.' });
      }
      const balances = await listBalancesForOwner(deps, userId, businessId, 50);
      return res.json({ balances, pointsNote: LOYALTY_POINTS_NOTE });
    }
    // Buyer viewing their balance with a seller/business
    const balance = await findBalance(deps, ownerUserId, userId, businessId);
    return res.json({
      balances: balance ? [balance] : [],
      balance: balance || {
        ownerUserId,
        businessId,
        customerUserId: userId,
        pointsBalance: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0,
      },
      pointsNote: LOYALTY_POINTS_NOTE,
    });
  });

  app.get('/api/loyalty/balance', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId =
      typeof req.query.businessId === 'string' && req.query.businessId.trim()
        ? req.query.businessId.trim()
        : null;
    const customerUserId =
      typeof req.query.customerUserId === 'string' && req.query.customerUserId.trim()
        ? req.query.customerUserId.trim()
        : userId;
    const ownerUserId =
      typeof req.query.ownerUserId === 'string' && req.query.ownerUserId.trim()
        ? req.query.ownerUserId.trim()
        : userId;

    const isSellerLookingUp = ownerUserId === userId && customerUserId !== userId;
    const isOwnBalance = customerUserId === userId;
    if (!isSellerLookingUp && !isOwnBalance) {
      return res.status(403).json({ error: 'You cannot view this balance.' });
    }
    if (isSellerLookingUp && !(await assertCanManage(deps, userId, businessId))) {
      return res.status(403).json({ error: 'You cannot view this balance.' });
    }

    const scopeOwner = isOwnBalance && !isSellerLookingUp ? ownerUserId : userId;
    const balance =
      (await findBalance(deps, scopeOwner, customerUserId, businessId))
      || {
        id: '',
        ownerUserId: scopeOwner,
        businessId,
        customerUserId,
        pointsBalance: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
    const program = await findProgram(deps, scopeOwner, businessId);
    const ledger =
      typeof req.query.includeLedger === 'string' && req.query.includeLedger === '1'
        ? await listLedger(deps, scopeOwner, customerUserId, businessId)
        : undefined;
    return res.json({
      balance,
      program: program
        ? {
            enabled: program.enabled,
            earnMode: program.earnMode,
            pointsPerCurrency: program.pointsPerCurrency,
            flatPointsPerOrder: program.flatPointsPerOrder,
            termsNote: program.termsNote,
          }
        : null,
      ledger,
      pointsNote: LOYALTY_POINTS_NOTE,
    });
  });

  /** Seller manual adjust (credit or debit). */
  app.post('/api/loyalty/adjust', async (req, res) => {
    const parsed = adjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid adjust request', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId = parsed.data.businessId === undefined ? null : parsed.data.businessId;
    if (!(await assertCanManage(deps, userId, businessId))) {
      return res.status(403).json({ error: 'Only the seller can adjust points.' });
    }
    if (parsed.data.customerUserId === userId) {
      return res.status(400).json({ error: 'Cannot adjust your own loyalty balance.' });
    }
    const result = await applyDelta(deps, {
      ownerUserId: userId,
      businessId,
      customerUserId: parsed.data.customerUserId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      kind: 'adjust',
      byUserId: userId,
    });
    if ('error' in result) return res.status(400).json({ error: result.error });
    return res.json({
      balance: result.balance,
      entry: result.entry,
      pointsNote: LOYALTY_POINTS_NOTE,
    });
  });

  /** List rewards for a program (seller sees all; others see active only). */
  app.get('/api/loyalty/rewards', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    const businessId =
      typeof req.query.businessId === 'string' && req.query.businessId.trim()
        ? req.query.businessId.trim()
        : null;
    const ownerUserId =
      typeof req.query.ownerUserId === 'string' && req.query.ownerUserId.trim()
        ? req.query.ownerUserId.trim()
        : userId;
    if (!ownerUserId) return res.status(400).json({ error: 'Missing owner' });
    const asSeller = Boolean(userId && userId === ownerUserId);
    const rewards = await listRewards(deps, ownerUserId, businessId, !asSeller);
    return res.json({ rewards, pointsNote: LOYALTY_POINTS_NOTE });
  });

  app.post('/api/loyalty/rewards', async (req, res) => {
    const parsed = rewardCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid reward', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId = parsed.data.businessId === undefined ? null : parsed.data.businessId;
    if (!(await assertCanManage(deps, userId, businessId))) {
      return res.status(403).json({ error: 'Only the seller can add rewards.' });
    }
    await ensureProgram(deps, userId, businessId);
    const stamp = nowIso();
    const reward: LoyaltyReward = {
      id: newId('loyrew'),
      ownerUserId: userId,
      businessId,
      name: parsed.data.name,
      pointsCost: parsed.data.pointsCost,
      active: parsed.data.active !== false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveReward(deps, reward);
    deps.io.to(`user:${userId}`).emit('loyalty:reward', { reward });
    return res.json({ reward, pointsNote: LOYALTY_POINTS_NOTE });
  });

  app.patch('/api/loyalty/rewards/:rewardId', async (req, res) => {
    const parsed = rewardPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid reward update', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const reward = await findReward(deps, param(req.params.rewardId));
    if (!reward) return res.status(404).json({ error: 'Reward not found' });
    if (reward.ownerUserId !== userId) {
      return res.status(403).json({ error: 'Only the seller can update this reward.' });
    }
    if (parsed.data.name !== undefined) reward.name = parsed.data.name;
    if (parsed.data.pointsCost !== undefined) reward.pointsCost = parsed.data.pointsCost;
    if (parsed.data.active !== undefined) reward.active = parsed.data.active;
    reward.updatedAt = nowIso();
    await saveReward(deps, reward);
    return res.json({ reward, pointsNote: LOYALTY_POINTS_NOTE });
  });

  app.delete('/api/loyalty/rewards/:rewardId', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const reward = await findReward(deps, param(req.params.rewardId));
    if (!reward) return res.status(404).json({ error: 'Reward not found' });
    if (reward.ownerUserId !== userId) {
      return res.status(403).json({ error: 'Only the seller can remove this reward.' });
    }
    await deleteReward(deps, reward.id);
    return res.json({ ok: true });
  });

  /**
   * Customer requests a reward. Deducts points immediately and creates a
   * pending redemption for the seller to fulfil offline — no money movement.
   */
  app.post('/api/loyalty/redeem', async (req, res) => {
    const parsed = redeemSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid redeem request', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const reward = await findReward(deps, parsed.data.rewardId);
    if (!reward || !reward.active) {
      return res.status(404).json({ error: 'Reward not found or inactive' });
    }
    if (parsed.data.ownerUserId && parsed.data.ownerUserId !== reward.ownerUserId) {
      return res.status(400).json({ error: 'Reward does not belong to that business.' });
    }
    if (
      parsed.data.businessId !== undefined
      && parsed.data.businessId !== null
      && (reward.businessId || null) !== parsed.data.businessId
    ) {
      return res.status(400).json({ error: 'Reward does not belong to that business.' });
    }
    if (reward.ownerUserId === userId) {
      return res.status(400).json({ error: 'Sellers cannot redeem their own rewards.' });
    }

    const stamp = nowIso();
    const redemption: LoyaltyRedemption = {
      id: newId('loyred'),
      ownerUserId: reward.ownerUserId,
      businessId: reward.businessId || null,
      customerUserId: userId,
      rewardId: reward.id,
      rewardName: reward.name,
      pointsCost: reward.pointsCost,
      status: 'pending',
      createdAt: stamp,
      updatedAt: stamp,
      fulfilledAt: null,
      cancelledAt: null,
    };

    const result = await applyDelta(deps, {
      ownerUserId: reward.ownerUserId,
      businessId: reward.businessId,
      customerUserId: userId,
      delta: -reward.pointsCost,
      reason: `Redeem request: ${reward.name}`,
      kind: 'redeem',
      byUserId: userId,
      redemptionId: redemption.id,
    });
    if ('error' in result) return res.status(400).json({ error: result.error });

    await saveRedemption(deps, redemption);
    deps.io.to(`user:${reward.ownerUserId}`).emit('loyalty:redemption', { redemption });
    deps.io.to(`user:${userId}`).emit('loyalty:redemption', { redemption });

    return res.json({
      redemption,
      balance: result.balance,
      pointsNote: LOYALTY_POINTS_NOTE,
      fulfilmentNote: 'Pending — the business will fulfil this reward offline. No money is moved.',
    });
  });

  app.get('/api/loyalty/redemptions', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId =
      typeof req.query.businessId === 'string' && req.query.businessId.trim()
        ? req.query.businessId.trim()
        : undefined;
    const role = typeof req.query.role === 'string' ? req.query.role : 'seller';
    const status =
      typeof req.query.status === 'string'
      && ['pending', 'fulfilled', 'cancelled'].includes(req.query.status)
        ? (req.query.status as LoyaltyRedemptionStatus)
        : undefined;

    const redemptions =
      role === 'buyer'
        ? await listRedemptions(deps, { customerUserId: userId, businessId, status })
        : await listRedemptions(deps, { ownerUserId: userId, businessId, status });

    return res.json({ redemptions, pointsNote: LOYALTY_POINTS_NOTE });
  });

  /** Seller fulfils or cancels a redemption (cancel restores points). */
  app.patch('/api/loyalty/redemptions/:redemptionId', async (req, res) => {
    const parsed = redemptionPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid redemption update', details: parsed.error.flatten() });
    }
    const userId = await resolveUserId(deps, req, parsed.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const redemption = await findRedemption(deps, param(req.params.redemptionId));
    if (!redemption) return res.status(404).json({ error: 'Redemption not found' });
    if (redemption.ownerUserId !== userId) {
      return res.status(403).json({ error: 'Only the seller can update this redemption.' });
    }
    if (redemption.status !== 'pending') {
      return res.status(400).json({ error: `Redemption is already ${redemption.status}.` });
    }

    const stamp = nowIso();
    if (parsed.data.status === 'fulfilled') {
      redemption.status = 'fulfilled';
      redemption.fulfilledAt = stamp;
      redemption.updatedAt = stamp;
      await saveRedemption(deps, redemption);
      deps.io.to(`user:${redemption.ownerUserId}`).emit('loyalty:redemption', { redemption });
      deps.io.to(`user:${redemption.customerUserId}`).emit('loyalty:redemption', { redemption });
      return res.json({
        redemption,
        pointsNote: LOYALTY_POINTS_NOTE,
        fulfilmentNote: 'Marked fulfilled offline. No money was moved.',
      });
    }

    // Cancel — restore points
    const result = await applyDelta(deps, {
      ownerUserId: redemption.ownerUserId,
      businessId: redemption.businessId,
      customerUserId: redemption.customerUserId,
      delta: redemption.pointsCost,
      reason: `Redemption cancelled: ${redemption.rewardName}`,
      kind: 'redeem_cancel',
      byUserId: userId,
      redemptionId: redemption.id,
    });
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    redemption.status = 'cancelled';
    redemption.cancelledAt = stamp;
    redemption.updatedAt = stamp;
    await saveRedemption(deps, redemption);
    deps.io.to(`user:${redemption.ownerUserId}`).emit('loyalty:redemption', { redemption });
    deps.io.to(`user:${redemption.customerUserId}`).emit('loyalty:redemption', { redemption });
    return res.json({
      redemption,
      balance: result.balance,
      pointsNote: LOYALTY_POINTS_NOTE,
    });
  });
};
