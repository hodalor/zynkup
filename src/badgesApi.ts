/**
 * B5 Group contribution indicators & badges
 *
 * Admins opt in per group (default off). Badges recognise helpful contribution —
 * never raw message volume. System hints are light; moderator award is the
 * primary reliable path. Privacy: members only see badge types (no scores).
 * Do not shame quieter members. Exclude spam / deleted / bot / abusive content.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type BadgeType = 'helpful' | 'welcoming' | 'fast_support';
export type BadgeSource = 'moderator' | 'system';
export type BadgeReportStatus = 'pending' | 'reviewed' | 'dismissed';

export type GroupBadgeSettings = {
  chatId: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};

export type GroupBadge = {
  id: string;
  chatId: string;
  userId: string;
  badgeType: BadgeType;
  source: BadgeSource;
  awardedBy?: string;
  note?: string;
  createdAt: string;
  revokedAt?: string | null;
};

export type GroupBadgeReport = {
  id: string;
  chatId: string;
  badgeId: string;
  reporterUserId: string;
  reason: string;
  status: BadgeReportStatus;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
};

/** Soft join signal for welcoming heuristics (optional). */
export type GroupMemberJoin = {
  id: string;
  chatId: string;
  userId: string;
  addedBy: string;
  joinedAt: string;
};

type BadgeChat = {
  id: string;
  kind: 'direct' | 'group';
  participants: string[];
  adminIds?: string[];
  [key: string]: unknown;
};

type BadgeMessage = {
  id: string;
  chatId: string;
  senderId: string;
  text?: string;
  kind?: string;
  sentAt: string;
  deletedForEveryone?: boolean;
  deletedFor?: string[];
  automated?: boolean;
  autoReplySource?: string;
  anonymous?: boolean;
  replyToMessageId?: string;
  reactions?: Array<{
    userId: string;
    emoji: string;
    reactionId?: string;
    reactedAt: string;
  }>;
  /** Soft moderation flags when present. */
  abusive?: boolean;
  flaggedAbusive?: boolean;
  spam?: boolean;
  isBot?: boolean;
  [key: string]: unknown;
};

export type BadgesDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readChats: () => Promise<BadgeChat[]>;
  readMessages: () => Promise<BadgeMessage[]>;
};

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const HELPFUL_MIN_REACTIONS = 3;
const HELPFUL_MIN_DISTINCT_REACTORS = 2;
const FAST_SUPPORT_WINDOW_MS = 5 * 60 * 1000;
const FAST_SUPPORT_MIN_REPLIES = 3;
/** Cap system awards per type per recompute to avoid noise. */
const SYSTEM_AWARD_CAP_PER_TYPE = 10;
const WELCOME_RESPONDER_WINDOW_MS = 30 * 60 * 1000;
const WELCOME_FIRST_N = 3;

const HELP_KEYWORDS =
  /\b(help|how (do|can|to)|anyone know|can someone|could someone|please help|need help|support|assist|stuck|question)\b/i;

const BADGE_DEFINITIONS: Array<{
  badgeType: BadgeType;
  label: string;
  description: string;
  rules: string;
}> = [
  {
    badgeType: 'helpful',
    label: 'Helpful',
    description: 'Recognised for contributions others appreciate.',
    rules:
      'Moderator award, or system: receive ≥3 message reactions from ≥2 distinct users in the last 14 days in this group (reactions on your messages). Excludes automated, deleted, bot, and abusive messages. Not based on message volume.',
  },
  {
    badgeType: 'welcoming',
    label: 'Welcoming',
    description: 'Recognised for greeting and including new members.',
    rules:
      'Moderator award, or system when join signals exist: among the first 3 human responders after a new member is added (within 30 minutes). If join signals are weak/unavailable, welcoming is moderator-only.',
  },
  {
    badgeType: 'fast_support',
    label: 'Fast Support',
    description: 'Recognised for timely replies to questions.',
    rules:
      'Moderator award, or system: replied within 5 minutes to ≥3 messages that look like questions (? or help keywords) in the last 14 days. Heuristics are simple and capped. Never awarded from total message count alone.',
  },
];

const seedSettings: GroupBadgeSettings[] = [];
const seedBadges: GroupBadge[] = [];
const seedReports: GroupBadgeReport[] = [];
const seedJoins: GroupMemberJoin[] = [];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const chatAdmins = (chat: BadgeChat) =>
  (chat.adminIds?.length ? chat.adminIds : chat.participants.slice(0, 1));

const resolveUserId = async (deps: BadgesDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

const settingsSchema = z.object({
  userId: z.string().min(1).optional(),
  enabled: z.boolean(),
});

const awardSchema = z.object({
  userId: z.string().min(1).optional(),
  targetUserId: z.string().min(1),
  badgeType: z.enum(['helpful', 'welcoming', 'fast_support']),
  note: z.string().trim().max(280).optional(),
});

const reportSchema = z.object({
  userId: z.string().min(1).optional(),
  reason: z.string().trim().min(3).max(500),
});

const recomputeSchema = z.object({
  userId: z.string().min(1).optional(),
});

const userOnlySchema = z.object({
  userId: z.string().min(1).optional(),
});

async function ensureBadgeIndexes(deps: BadgesDeps) {
  const db = await deps.getDb();
  if (!db) return;
  try {
    await db.collection('groupBadgeSettings').createIndex(
      { chatId: 1 },
      { unique: true, name: 'groupBadgeSettings_chatId' },
    );
    await db.collection('groupBadges').createIndex(
      { chatId: 1, userId: 1, badgeType: 1 },
      { name: 'groupBadges_chat_user_type' },
    );
    await db.collection('groupBadgeReports').createIndex(
      { chatId: 1, status: 1, createdAt: -1 },
      { name: 'groupBadgeReports_chat_status' },
    );
    await db.collection('groupMemberJoins').createIndex(
      { chatId: 1, joinedAt: -1 },
      { name: 'groupMemberJoins_chat_joinedAt' },
    );
  } catch {
    // Index may already exist or Mongo unavailable mid-startup.
  }
}

async function findGroupChat(deps: BadgesDeps, chatId: string): Promise<BadgeChat | null> {
  const chats = await deps.readChats();
  const chat = chats.find((entry) => entry.id === chatId) ?? null;
  if (!chat || chat.kind !== 'group') return null;
  return chat;
}

async function getSettings(deps: BadgesDeps, chatId: string): Promise<GroupBadgeSettings> {
  const db = await deps.getDb();
  if (!db) {
    return (
      seedSettings.find((item) => item.chatId === chatId) ?? {
        chatId,
        enabled: false,
        updatedAt: nowIso(),
        updatedBy: '',
      }
    );
  }
  const found = await db.collection<GroupBadgeSettings>('groupBadgeSettings').findOne(
    { chatId },
    { projection: { _id: 0 } },
  );
  return found ?? {
    chatId,
    enabled: false,
    updatedAt: nowIso(),
    updatedBy: '',
  };
}

async function saveSettings(deps: BadgesDeps, settings: GroupBadgeSettings) {
  const db = await deps.getDb();
  if (!db) {
    const index = seedSettings.findIndex((item) => item.chatId === settings.chatId);
    if (index >= 0) seedSettings[index] = settings;
    else seedSettings.unshift(settings);
    return settings;
  }
  await db.collection<GroupBadgeSettings>('groupBadgeSettings').updateOne(
    { chatId: settings.chatId },
    { $set: settings },
    { upsert: true },
  );
  return settings;
}

async function readBadges(
  deps: BadgesDeps,
  filter: Partial<GroupBadge> & { revokedAt?: string | null } = {},
): Promise<GroupBadge[]> {
  const db = await deps.getDb();
  if (!db) {
    return seedBadges.filter((item) =>
      Object.entries(filter).every(([key, value]) => {
        if (key === 'revokedAt' && value === null) return !item.revokedAt;
        return (item as Record<string, unknown>)[key] === value;
      }));
  }
  const query: Record<string, unknown> = { ...filter };
  if (filter.revokedAt === null) {
    query.$or = [{ revokedAt: null }, { revokedAt: { $exists: false } }];
    delete query.revokedAt;
  }
  return db.collection<GroupBadge>('groupBadges').find(query, { projection: { _id: 0 } }).toArray();
}

async function findBadge(deps: BadgesDeps, badgeId: string): Promise<GroupBadge | null> {
  const db = await deps.getDb();
  if (!db) return seedBadges.find((item) => item.id === badgeId) ?? null;
  return db.collection<GroupBadge>('groupBadges').findOne({ id: badgeId }, { projection: { _id: 0 } });
}

async function saveBadge(deps: BadgesDeps, badge: GroupBadge) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedBadges, badge);
  await db.collection<GroupBadge>('groupBadges').updateOne({ id: badge.id }, { $set: badge }, { upsert: true });
  return badge;
}

async function readReports(
  deps: BadgesDeps,
  filter: Partial<GroupBadgeReport> = {},
): Promise<GroupBadgeReport[]> {
  const db = await deps.getDb();
  if (!db) {
    return seedReports.filter((item) =>
      Object.entries(filter).every(([key, value]) => (item as Record<string, unknown>)[key] === value));
  }
  return db.collection<GroupBadgeReport>('groupBadgeReports').find(filter, { projection: { _id: 0 } }).toArray();
}

async function saveReport(deps: BadgesDeps, report: GroupBadgeReport) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedReports, report);
  await db.collection<GroupBadgeReport>('groupBadgeReports').updateOne(
    { id: report.id },
    { $set: report },
    { upsert: true },
  );
  return report;
}

async function readJoins(deps: BadgesDeps, chatId: string): Promise<GroupMemberJoin[]> {
  const db = await deps.getDb();
  if (!db) return seedJoins.filter((item) => item.chatId === chatId);
  return db.collection<GroupMemberJoin>('groupMemberJoins')
    .find({ chatId }, { projection: { _id: 0 } })
    .sort({ joinedAt: -1 })
    .limit(200)
    .toArray();
}

async function saveJoin(deps: BadgesDeps, join: GroupMemberJoin) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedJoins, join);
  await db.collection<GroupMemberJoin>('groupMemberJoins').updateOne(
    { id: join.id },
    { $set: join },
    { upsert: true },
  );
  return join;
}

/** Public badge fields — never expose numeric scores. */
const publicBadge = (badge: GroupBadge) => ({
  id: badge.id,
  chatId: badge.chatId,
  userId: badge.userId,
  badgeType: badge.badgeType,
  source: badge.source,
  awardedBy: badge.awardedBy ?? null,
  note: badge.note ?? null,
  createdAt: badge.createdAt,
  revokedAt: badge.revokedAt ?? null,
});

const emitBadgeUpdated = (
  deps: BadgesDeps,
  chat: BadgeChat,
  payload: Record<string, unknown>,
) => {
  for (const participantId of chat.participants) {
    deps.io.to(`user:${participantId}`).emit('badge:updated', {
      chatId: chat.id,
      ...payload,
    });
  }
};

const isScorableMessage = (message: BadgeMessage): boolean => {
  if (message.deletedForEveryone) return false;
  if (message.automated) return false;
  if (message.isBot) return false;
  if (message.anonymous) return false;
  if (message.abusive || message.flaggedAbusive || message.spam) return false;
  if (message.senderId === 'anonymous' || message.senderId === 'system' || message.senderId === 'bot') {
    return false;
  }
  if (message.autoReplySource) return false;
  if (message.kind === 'call') return false;
  return true;
};

const looksLikeQuestion = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\?/.test(trimmed)) return true;
  return HELP_KEYWORDS.test(trimmed);
};

const activeBadgeOfType = (
  badges: GroupBadge[],
  userId: string,
  badgeType: BadgeType,
) => badges.find(
  (badge) =>
    badge.userId === userId
    && badge.badgeType === badgeType
    && !badge.revokedAt,
);

async function awardSystemBadge(
  deps: BadgesDeps,
  chat: BadgeChat,
  userId: string,
  badgeType: BadgeType,
  existing: GroupBadge[],
): Promise<GroupBadge | null> {
  if (!chat.participants.includes(userId)) return null;
  if (activeBadgeOfType(existing, userId, badgeType)) return null;
  const badge: GroupBadge = {
    id: newId('gbadge'),
    chatId: chat.id,
    userId,
    badgeType,
    source: 'system',
    createdAt: nowIso(),
    revokedAt: null,
  };
  await saveBadge(deps, badge);
  return badge;
}

/**
 * Light system pass. Never uses total message count alone.
 * Returns awarded badges (no scores exposed).
 */
async function recomputeSystemBadges(
  deps: BadgesDeps,
  chat: BadgeChat,
): Promise<{ awarded: GroupBadge[]; notes: string[] }> {
  const notes: string[] = [];
  const awarded: GroupBadge[] = [];
  const existing = await readBadges(deps, { chatId: chat.id });
  const cutoff = Date.now() - WINDOW_MS;
  const messages = (await deps.readMessages())
    .filter((entry) => entry.chatId === chat.id && isScorableMessage(entry))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  // --- helpful: ≥3 reactions from ≥2 distinct users on their messages (14d) ---
  const helpfulCandidates: string[] = [];
  const bySender = new Map<string, BadgeMessage[]>();
  for (const message of messages) {
    const sentMs = Date.parse(message.sentAt);
    if (Number.isNaN(sentMs) || sentMs < cutoff) continue;
    const list = bySender.get(message.senderId) || [];
    list.push(message);
    bySender.set(message.senderId, list);
  }
  for (const [userId, userMessages] of bySender) {
    if (!chat.participants.includes(userId)) continue;
    const reactors = new Set<string>();
    let reactionCount = 0;
    for (const message of userMessages) {
      for (const reaction of message.reactions || []) {
        if (!reaction.userId || reaction.userId === userId) continue;
        if (!chat.participants.includes(reaction.userId)) continue;
        const reactedMs = Date.parse(reaction.reactedAt || message.sentAt);
        if (Number.isNaN(reactedMs) || reactedMs < cutoff) continue;
        reactors.add(reaction.userId);
        reactionCount += 1;
      }
    }
    if (
      reactionCount >= HELPFUL_MIN_REACTIONS
      && reactors.size >= HELPFUL_MIN_DISTINCT_REACTORS
    ) {
      helpfulCandidates.push(userId);
    }
  }
  helpfulCandidates.sort();
  for (const userId of helpfulCandidates.slice(0, SYSTEM_AWARD_CAP_PER_TYPE)) {
    const badge = await awardSystemBadge(deps, chat, userId, 'helpful', [...existing, ...awarded]);
    if (badge) awarded.push(badge);
  }
  notes.push(`helpful: ${helpfulCandidates.length} candidate(s), capped at ${SYSTEM_AWARD_CAP_PER_TYPE}`);

  // --- fast_support: ≥3 question-replies within 5 minutes (14d) ---
  const questionMessages = messages.filter((entry) => {
    const sentMs = Date.parse(entry.sentAt);
    if (Number.isNaN(sentMs) || sentMs < cutoff) return false;
    return looksLikeQuestion(entry.text || '');
  });
  const fastCounts = new Map<string, number>();
  for (const question of questionMessages) {
    const qMs = Date.parse(question.sentAt);
    if (Number.isNaN(qMs)) continue;
    const responders = new Set<string>();
    for (const candidate of messages) {
      if (candidate.id === question.id) continue;
      if (candidate.senderId === question.senderId) continue;
      const cMs = Date.parse(candidate.sentAt);
      if (Number.isNaN(cMs) || cMs < qMs || cMs - qMs > FAST_SUPPORT_WINDOW_MS) continue;
      // Prefer reply thread when present; otherwise chronological reply in window.
      const isThreaded = candidate.replyToMessageId === question.id;
      const isSoonAfter = !candidate.replyToMessageId && cMs - qMs <= FAST_SUPPORT_WINDOW_MS;
      if (!isThreaded && !isSoonAfter) continue;
      if (responders.has(candidate.senderId)) continue;
      responders.add(candidate.senderId);
      fastCounts.set(candidate.senderId, (fastCounts.get(candidate.senderId) || 0) + 1);
    }
  }
  const fastCandidates = [...fastCounts.entries()]
    .filter(([, count]) => count >= FAST_SUPPORT_MIN_REPLIES)
    .map(([userId]) => userId)
    .filter((userId) => chat.participants.includes(userId))
    .sort();
  for (const userId of fastCandidates.slice(0, SYSTEM_AWARD_CAP_PER_TYPE)) {
    const badge = await awardSystemBadge(deps, chat, userId, 'fast_support', [...existing, ...awarded]);
    if (badge) awarded.push(badge);
  }
  notes.push(`fast_support: ${fastCandidates.length} candidate(s), capped at ${SYSTEM_AWARD_CAP_PER_TYPE}`);

  // --- welcoming: first 3 human responders after join (if join signals exist) ---
  const joins = await readJoins(deps, chat.id);
  const recentJoins = joins.filter((join) => {
    const ms = Date.parse(join.joinedAt);
    return !Number.isNaN(ms) && ms >= cutoff;
  });
  if (!recentJoins.length) {
    notes.push('welcoming: no join signals — moderator-only for this pass');
  } else {
    const welcomeCounts = new Map<string, number>();
    for (const join of recentJoins) {
      const joinMs = Date.parse(join.joinedAt);
      if (Number.isNaN(joinMs)) continue;
      const responders: string[] = [];
      for (const message of messages) {
        if (message.senderId === join.userId) continue;
        const sentMs = Date.parse(message.sentAt);
        if (Number.isNaN(sentMs) || sentMs < joinMs) continue;
        if (sentMs - joinMs > WELCOME_RESPONDER_WINDOW_MS) break;
        if (!isScorableMessage(message)) continue;
        if (responders.includes(message.senderId)) continue;
        responders.push(message.senderId);
        if (responders.length >= WELCOME_FIRST_N) break;
      }
      for (const userId of responders) {
        welcomeCounts.set(userId, (welcomeCounts.get(userId) || 0) + 1);
      }
    }
    // Award anyone who was among first-3 responders at least once (capped).
    const welcomeCandidates = [...welcomeCounts.keys()]
      .filter((userId) => chat.participants.includes(userId))
      .sort();
    for (const userId of welcomeCandidates.slice(0, SYSTEM_AWARD_CAP_PER_TYPE)) {
      const badge = await awardSystemBadge(deps, chat, userId, 'welcoming', [...existing, ...awarded]);
      if (badge) awarded.push(badge);
    }
    notes.push(
      `welcoming: ${recentJoins.length} join(s), ${welcomeCandidates.length} candidate(s), capped at ${SYSTEM_AWARD_CAP_PER_TYPE}`,
    );
  }

  return { awarded, notes };
}

/**
 * Record member join events so welcoming system badges can fire.
 * Call from group member-add flows when available.
 */
export async function recordGroupMemberJoins(
  deps: BadgesDeps,
  input: { chatId: string; addedUserIds: string[]; addedBy: string; joinedAt?: string },
): Promise<GroupMemberJoin[]> {
  const joinedAt = input.joinedAt || nowIso();
  const saved: GroupMemberJoin[] = [];
  for (const userId of input.addedUserIds) {
    const join: GroupMemberJoin = {
      id: newId('gjoin'),
      chatId: input.chatId,
      userId,
      addedBy: input.addedBy,
      joinedAt,
    };
    await saveJoin(deps, join);
    saved.push(join);
  }
  return saved;
}

let badgesDepsRef: BadgesDeps | null = null;

/** Used by server.ts member-add hook without circular imports of internals. */
export const recordGroupMemberJoinsFromServer = async (input: {
  chatId: string;
  addedUserIds: string[];
  addedBy: string;
}) => {
  if (!badgesDepsRef || !input.addedUserIds.length) return;
  await recordGroupMemberJoins(badgesDepsRef, input);
};

export const registerBadgesApi = (app: Express, deps: BadgesDeps) => {
  badgesDepsRef = deps;
  void ensureBadgeIndexes(deps);

  app.get('/api/badges/definitions', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    return res.json({
      badges: BADGE_DEFINITIONS,
      notes: {
        defaultEnabled: false,
        noScoresExposed: true,
        noShamingQuieterMembers: true,
        excludeAutomatedDeletedBotAbusive: true,
        moderatorAwardPrimary: true,
        privacy: 'Only group members can see badges for that group. Behavioural scores are never returned.',
      },
    });
  });

  app.get('/api/groups/:chatId/badges', async (req, res) => {
    const chatId = param(req.params.chatId);
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    const userId = await resolveUserId(
      deps,
      req,
      parseResult.success
        ? parseResult.data.userId
        : (typeof req.query.userId === 'string' ? req.query.userId : undefined),
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'Only group members can view badges.' });
    }

    const settings = await getSettings(deps, chatId);
    if (!settings.enabled) {
      return res.json({
        settings: { enabled: false, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy || null },
        badges: [],
        definitions: BADGE_DEFINITIONS,
      });
    }

    const badges = (await readBadges(deps, { chatId }))
      .filter((badge) => !badge.revokedAt)
      .map(publicBadge);

    return res.json({
      settings: {
        enabled: true,
        updatedAt: settings.updatedAt,
        updatedBy: settings.updatedBy || null,
      },
      badges,
      definitions: BADGE_DEFINITIONS,
    });
  });

  app.put('/api/groups/:chatId/badges/settings', async (req, res) => {
    const chatId = param(req.params.chatId);
    const parseResult = settingsSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid settings payload',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!chatAdmins(chat).includes(userId)) {
      return res.status(403).json({ error: 'Only a group admin can change badge settings.' });
    }

    const settings: GroupBadgeSettings = {
      chatId,
      enabled: parseResult.data.enabled,
      updatedAt: nowIso(),
      updatedBy: userId,
    };
    await saveSettings(deps, settings);
    emitBadgeUpdated(deps, chat, {
      action: 'settings',
      settings: {
        enabled: settings.enabled,
        updatedAt: settings.updatedAt,
        updatedBy: settings.updatedBy,
      },
    });

    return res.json({
      settings: {
        enabled: settings.enabled,
        updatedAt: settings.updatedAt,
        updatedBy: settings.updatedBy,
      },
    });
  });

  app.post('/api/groups/:chatId/badges', async (req, res) => {
    const chatId = param(req.params.chatId);
    const parseResult = awardSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid award payload',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!chatAdmins(chat).includes(userId)) {
      return res.status(403).json({ error: 'Only a group admin can award badges.' });
    }

    const settings = await getSettings(deps, chatId);
    if (!settings.enabled) {
      return res.status(400).json({ error: 'Contribution badges are disabled for this group.' });
    }

    const targetUserId = parseResult.data.targetUserId;
    if (!chat.participants.includes(targetUserId)) {
      return res.status(400).json({ error: 'That person is not in this group.' });
    }

    const existing = await readBadges(deps, { chatId });
    const active = activeBadgeOfType(existing, targetUserId, parseResult.data.badgeType);
    if (active) {
      return res.status(409).json({
        error: 'That member already has this badge.',
        badge: publicBadge(active),
      });
    }

    const badge: GroupBadge = {
      id: newId('gbadge'),
      chatId,
      userId: targetUserId,
      badgeType: parseResult.data.badgeType,
      source: 'moderator',
      awardedBy: userId,
      note: parseResult.data.note,
      createdAt: nowIso(),
      revokedAt: null,
    };
    await saveBadge(deps, badge);
    emitBadgeUpdated(deps, chat, {
      action: 'award',
      badge: publicBadge(badge),
    });

    return res.status(201).json({ badge: publicBadge(badge) });
  });

  app.delete('/api/groups/:chatId/badges/:badgeId', async (req, res) => {
    const chatId = param(req.params.chatId);
    const badgeId = param(req.params.badgeId);
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    const userId = await resolveUserId(
      deps,
      req,
      parseResult.success
        ? parseResult.data.userId
        : (typeof req.query.userId === 'string' ? req.query.userId : undefined),
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!chatAdmins(chat).includes(userId)) {
      return res.status(403).json({ error: 'Only a group admin can revoke badges.' });
    }

    const badge = await findBadge(deps, badgeId);
    if (!badge || badge.chatId !== chatId) {
      return res.status(404).json({ error: 'Badge not found' });
    }
    if (badge.revokedAt) {
      return res.json({ badge: publicBadge(badge), alreadyRevoked: true });
    }

    const revoked: GroupBadge = {
      ...badge,
      revokedAt: nowIso(),
    };
    await saveBadge(deps, revoked);
    emitBadgeUpdated(deps, chat, {
      action: 'revoke',
      badge: publicBadge(revoked),
    });

    return res.json({ badge: publicBadge(revoked) });
  });

  app.post('/api/groups/:chatId/badges/:badgeId/report', async (req, res) => {
    const chatId = param(req.params.chatId);
    const badgeId = param(req.params.badgeId);
    const parseResult = reportSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid report payload',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'Only group members can report badges.' });
    }

    const badge = await findBadge(deps, badgeId);
    if (!badge || badge.chatId !== chatId || badge.revokedAt) {
      return res.status(404).json({ error: 'Badge not found' });
    }

    const pending = (await readReports(deps, { chatId, badgeId, reporterUserId: userId, status: 'pending' }));
    if (pending.length) {
      return res.status(409).json({ error: 'You already reported this badge.', report: pending[0] });
    }

    const report: GroupBadgeReport = {
      id: newId('gbrep'),
      chatId,
      badgeId,
      reporterUserId: userId,
      reason: parseResult.data.reason,
      status: 'pending',
      createdAt: nowIso(),
    };
    await saveReport(deps, report);

    // Notify admins only — do not broadcast report details to all members.
    for (const adminId of chatAdmins(chat)) {
      deps.io.to(`user:${adminId}`).emit('badge:updated', {
        chatId,
        action: 'report',
        reportId: report.id,
        badgeId,
      });
    }

    return res.status(201).json({
      report: {
        id: report.id,
        chatId: report.chatId,
        badgeId: report.badgeId,
        status: report.status,
        createdAt: report.createdAt,
      },
    });
  });

  app.post('/api/groups/:chatId/badges/recompute', async (req, res) => {
    const chatId = param(req.params.chatId);
    const parseResult = recomputeSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid recompute payload',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!chatAdmins(chat).includes(userId)) {
      return res.status(403).json({ error: 'Only a group admin can recompute system badges.' });
    }

    const settings = await getSettings(deps, chatId);
    if (!settings.enabled) {
      return res.status(400).json({ error: 'Contribution badges are disabled for this group.' });
    }

    const { awarded, notes } = await recomputeSystemBadges(deps, chat);
    if (awarded.length) {
      emitBadgeUpdated(deps, chat, {
        action: 'recompute',
        badges: awarded.map(publicBadge),
      });
    }

    return res.json({
      awarded: awarded.map(publicBadge),
      awardedCount: awarded.length,
      notes,
      // Explicitly no scores / rankings.
      privacy: 'No behavioural scores are returned.',
    });
  });

  app.get('/api/groups/:chatId/badges/reports', async (req, res) => {
    const chatId = param(req.params.chatId);
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = await findGroupChat(deps, chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (!chatAdmins(chat).includes(userId)) {
      return res.status(403).json({ error: 'Only a group admin can view badge reports.' });
    }

    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    let reports = await readReports(deps, { chatId });
    if (statusFilter === 'pending' || statusFilter === 'reviewed' || statusFilter === 'dismissed') {
      reports = reports.filter((item) => item.status === statusFilter);
    }
    reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return res.json({
      reports: reports.map((report) => ({
        id: report.id,
        chatId: report.chatId,
        badgeId: report.badgeId,
        reporterUserId: report.reporterUserId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
        reviewedAt: report.reviewedAt ?? null,
        reviewedBy: report.reviewedBy ?? null,
      })),
    });
  });
};
