/**
 * I1 Digital business cards & QR networking
 *
 * One card per user (optional businessId). Public resolve by short code/slug.
 * QR payload is a deep link (zynkup://card/:code) or https web URL.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import { z } from 'zod';

export type CardTheme = 'navy' | 'cyan' | 'magenta' | 'lime' | 'sunset';

export type DigitalCard = {
  id: string;
  ownerUserId: string;
  code: string;
  displayName: string;
  title: string;
  businessName: string;
  phone: string;
  /** WhatsApp or ZynkUp handle (e.g. @name or +233…) */
  handle: string;
  email: string;
  bio: string;
  avatarUrl: string;
  theme: CardTheme;
  businessId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CardsDeps = {
  getDb: () => Promise<Db | null>;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readProfile: (userId: string) => Promise<{
    id: string;
    name: string;
    username?: string;
    avatar?: string;
    about?: string;
    phone?: string;
    businessName?: string;
    photoUri?: string;
    activeBusinessId?: string | null;
  } | null>;
  readUsers: () => Promise<Array<{ id: string; name: string; avatar?: string; phone?: string; username?: string; about?: string }>>;
  webBaseUrl?: string;
};

const THEMES: CardTheme[] = ['navy', 'cyan', 'magenta', 'lime', 'sunset'];
const WEB_BASE_DEFAULT = 'https://zynkup.app';

const seedCards: DigitalCard[] = [];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const slugify = (raw: string) =>
  String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

const randomCode = () => crypto.randomBytes(4).toString('hex');

const updateCardSchema = z.object({
  userId: z.string().min(1).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  title: z.string().trim().max(80).optional(),
  businessName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  handle: z.string().trim().max(80).optional(),
  email: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(400).optional(),
  avatarUrl: z.string().trim().max(2000).optional(),
  theme: z.enum(['navy', 'cyan', 'magenta', 'lime', 'sunset']).optional(),
  businessId: z.string().trim().max(80).nullable().optional(),
  code: z.string().trim().min(3).max(32).optional(),
});

async function ensureCardIndexes(deps: CardsDeps) {
  const db = await deps.getDb();
  if (!db) return;
  try {
    await db.collection('digitalCards').createIndex(
      { ownerUserId: 1 },
      { unique: true, name: 'digitalCards_ownerUserId' },
    );
    await db.collection('digitalCards').createIndex(
      { code: 1 },
      { unique: true, name: 'digitalCards_code' },
    );
  } catch {
    // Index may already exist.
  }
}

async function findCardByOwner(deps: CardsDeps, ownerUserId: string) {
  const db = await deps.getDb();
  if (!db) return seedCards.find((item) => item.ownerUserId === ownerUserId) ?? null;
  return db.collection<DigitalCard>('digitalCards').findOne({ ownerUserId }, { projection: { _id: 0 } });
}

async function findCardByCode(deps: CardsDeps, code: string) {
  const normalized = slugify(code) || code.trim().toLowerCase();
  if (!normalized) return null;
  const db = await deps.getDb();
  if (!db) {
    return seedCards.find((item) => item.code === normalized) ?? null;
  }
  return db.collection<DigitalCard>('digitalCards').findOne({ code: normalized }, { projection: { _id: 0 } });
}

async function saveCard(deps: CardsDeps, card: DigitalCard) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedCards, card);
  await db.collection<DigitalCard>('digitalCards').updateOne({ id: card.id }, { $set: card }, { upsert: true });
  return card;
}

async function codeAvailable(deps: CardsDeps, code: string, exceptOwnerId?: string) {
  const existing = await findCardByCode(deps, code);
  if (!existing) return true;
  if (exceptOwnerId && existing.ownerUserId === exceptOwnerId) return true;
  return false;
}

async function allocateCode(deps: CardsDeps, preferred: string, ownerUserId: string) {
  const base = slugify(preferred) || randomCode();
  if (await codeAvailable(deps, base, ownerUserId)) return base;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `${base.slice(0, 24)}-${randomCode().slice(0, 4)}`;
    if (await codeAvailable(deps, candidate, ownerUserId)) return candidate;
  }
  return `${randomCode()}${randomCode()}`.slice(0, 16);
}

const webBaseFor = (deps: CardsDeps) =>
  (deps.webBaseUrl || process.env.WEB_BASE_URL || process.env.REACT_APP_WEB_BASE_URL || WEB_BASE_DEFAULT)
    .replace(/\/+$/, '');

export const cardLinksFor = (deps: CardsDeps, code: string) => {
  const deepLink = `zynkup://card/${code}`;
  const webUrl = `${webBaseFor(deps)}/?card=${encodeURIComponent(code)}`;
  return {
    deepLink,
    webUrl,
    /** Prefer deep link for in-app scan; scanners that only open https still get webUrl. */
    qrPayload: deepLink,
  };
};

const publicCardView = (card: DigitalCard, deps: CardsDeps) => {
  const links = cardLinksFor(deps, card.code);
  return {
    code: card.code,
    displayName: card.displayName,
    title: card.title,
    businessName: card.businessName,
    phone: card.phone,
    handle: card.handle,
    email: card.email || undefined,
    bio: card.bio,
    avatarUrl: card.avatarUrl,
    theme: card.theme,
    ownerUserId: card.ownerUserId,
    businessId: card.businessId ?? null,
    ...links,
  };
};

async function ensureCardForUser(deps: CardsDeps, userId: string): Promise<DigitalCard> {
  const existing = await findCardByOwner(deps, userId);
  if (existing) return existing;

  const profile = await deps.readProfile(userId);
  const users = await deps.readUsers();
  const user = users.find((entry) => entry.id === userId);
  const displayName = (profile?.name || user?.name || 'ZynkUp').trim().slice(0, 80) || 'ZynkUp';
  const username = (profile?.username || user?.username || '').replace(/^@/, '');
  const stamp = nowIso();
  const code = await allocateCode(deps, username || displayName, userId);

  const card: DigitalCard = {
    id: newId('card'),
    ownerUserId: userId,
    code,
    displayName,
    title: '',
    businessName: (profile?.businessName || '').trim().slice(0, 120),
    phone: (profile?.phone || user?.phone || '').trim().slice(0, 32),
    handle: username ? `@${username}` : '',
    email: '',
    bio: (profile?.about || user?.about || '').trim().slice(0, 400),
    avatarUrl: (profile?.photoUri || profile?.avatar || user?.avatar || '').trim().slice(0, 2000),
    theme: 'navy',
    businessId: profile?.activeBusinessId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  return saveCard(deps, card);
}

const resolveUserId = async (deps: CardsDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

export const registerCardsApi = (app: Express, deps: CardsDeps) => {
  void ensureCardIndexes(deps);

  /** Own card (creates defaults from profile on first access). */
  app.get('/api/cards/me', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const users = await deps.readUsers();
    if (!users.some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const card = await ensureCardForUser(deps, userId);
    const links = cardLinksFor(deps, card.code);
    return res.json({ card, ...links });
  });

  /** Update own card fields (and optional custom short code). */
  app.put('/api/cards/me', async (req, res) => {
    const parseResult = updateCardSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid card fields',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const users = await deps.readUsers();
    if (!users.some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const card = await ensureCardForUser(deps, userId);
    const changes = parseResult.data;
    if (changes.code) {
      const nextCode = slugify(changes.code);
      if (!nextCode || nextCode.length < 3) {
        return res.status(400).json({ error: 'Code must be at least 3 letters or numbers' });
      }
      if (!(await codeAvailable(deps, nextCode, userId))) {
        return res.status(409).json({ error: 'That card code is already taken' });
      }
      card.code = nextCode;
    }

    if (changes.displayName !== undefined) card.displayName = changes.displayName;
    if (changes.title !== undefined) card.title = changes.title;
    if (changes.businessName !== undefined) card.businessName = changes.businessName;
    if (changes.phone !== undefined) card.phone = changes.phone;
    if (changes.handle !== undefined) card.handle = changes.handle;
    if (changes.email !== undefined) card.email = changes.email;
    if (changes.bio !== undefined) card.bio = changes.bio;
    if (changes.avatarUrl !== undefined) card.avatarUrl = changes.avatarUrl;
    if (changes.theme !== undefined) card.theme = changes.theme;
    if (changes.businessId !== undefined) card.businessId = changes.businessId;
    card.updatedAt = nowIso();

    await saveCard(deps, card);
    const links = cardLinksFor(deps, card.code);
    return res.json({ card, ...links });
  });

  /** Public card by short code / slug — no auth required. */
  app.get('/api/cards/:code', async (req, res) => {
    const code = param(req.params.code);
    if (!code || code === 'me') {
      return res.status(400).json({ error: 'Missing card code' });
    }
    const card = await findCardByCode(deps, code);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    return res.json({ card: publicCardView(card, deps) });
  });
};

export const CARD_THEMES = THEMES;
