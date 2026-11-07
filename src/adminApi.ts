import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import type { Db } from 'mongodb';
import { z } from 'zod';

type UserRow = {
  id: string;
  name: string;
  phone: string;
  avatar?: string;
  about?: string;
  presence?: string;
  lastSeenAt?: string;
  isBusiness?: boolean;
};

type ProfileRow = {
  id: string;
  name?: string;
  username?: string;
  phone?: string;
  countryCode?: string;
  about?: string;
  businessName?: string;
  currency?: string;
  blocked?: boolean;
  blockedUntil?: string | null;
  pinHash?: string | null;
};

export type AdminDeps = {
  getDb: () => Promise<Db | null>;
  readUsers: () => Promise<UserRow[]>;
  readProfiles: () => Promise<ProfileRow[]>;
  readMessages: () => Promise<Array<{ id: string; chatId: string; senderId: string; text: string; sentAt: string; kind?: string; anonymous?: boolean }>>;
  readCalls: () => Promise<Array<{ id: string; participantIds: string[]; initiatorId?: string; kind: string; state: string; startedAt: string; durationSeconds?: number }>>;
  readStatuses: () => Promise<Array<{ id: string; userId: string; text: string; audience: string; createdAt: string; expiresAt?: string }>>;
  readCatalogItems: () => Promise<Array<Record<string, unknown>>>;
  updateProfile: (userId: string, changes: Record<string, unknown>) => Promise<unknown>;
  countryKeyFor: (user?: { phone?: string }, profile?: { countryCode?: string; phone?: string } | null) => string;
  hashPin: (pin: string) => string;
};

const COUNTRY_NAME: Record<string, string> = {
  '233': 'Ghana',
  '260': 'Zambia',
  '234': 'Nigeria',
  '254': 'Kenya',
  '256': 'Uganda',
  '255': 'Tanzania',
  '250': 'Rwanda',
  '27': 'South Africa',
  '44': 'United Kingdom',
  '1': 'United States',
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4).max(120),
});

const blockSchema = z.object({
  phone: z.string().min(6).max(30),
  reason: z.string().max(240).optional(),
  until: z.string().datetime().nullable().optional(),
  userId: z.string().optional(),
});

const configSchema = z.object({
  anonymousDailyLimit: z.number().int().min(0).max(100).optional(),
  bannerText: z.string().max(400).optional(),
  bannerActive: z.boolean().optional(),
});

const boostSchema = z.object({
  days: z.number().int().min(1).max(90),
  boostText: z.string().max(180).optional(),
});

const pinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
});

const announceSchema = z.object({
  title: z.string().min(2).max(80),
  body: z.string().min(2).max(1000),
});

export type AppConfig = {
  id: 'global';
  anonymousDailyLimit: number;
  bannerText: string;
  bannerActive: boolean;
};

const defaultConfig = (): AppConfig => ({
  id: 'global',
  anonymousDailyLimit: 5,
  bannerText: '',
  bannerActive: false,
});

const adminSecret = () => process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_PASSWORD || 'zynkup-local-admin';

const signToken = (email: string) => {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const body = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', adminSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
};

const readToken = (header?: string) => {
  const token = header?.replace(/^Bearer\s+/i, '').trim();
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', adminSecret()).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { email?: string; exp?: number };
    if (!parsed.email || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const readAppConfig = async (getDb: AdminDeps['getDb']): Promise<AppConfig> => {
  const db = await getDb();
  if (!db) return defaultConfig();
  const saved = await db.collection<AppConfig>('appConfig').findOne({ id: 'global' }, { projection: { _id: 0 } });
  return { ...defaultConfig(), ...(saved ?? {}) };
};

export const findPhoneBlock = async (getDb: AdminDeps['getDb'], phone: string) => {
  const db = await getDb();
  if (!db) return null;
  const tail = phone.replace(/\D/g, '').slice(-9);
  if (tail.length < 8) return null;
  const blocks = await db.collection('blockedNumbers').find({}, { projection: { _id: 0 } }).toArray();
  const hit = blocks.find((block) => {
    const blockTail = String(block.phone || '').replace(/\D/g, '').slice(-9);
    return blockTail && (blockTail === tail || tail.endsWith(blockTail) || blockTail.endsWith(tail));
  });
  if (!hit) return null;
  if (hit.until && new Date(String(hit.until)).getTime() <= Date.now()) return null;
  return hit;
};

const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const session = readToken(req.header('authorization'));
  if (!session) {
    res.status(401).json({ error: 'Admin sign-in required.' });
    return;
  }
  next();
};

const countryName = (code: string) => COUNTRY_NAME[code] || (code ? `+${code}` : 'Unknown');
const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || '';

export const recordAdminEvent = async (
  getDb: () => Promise<Db | null>,
  event: { level?: string; area: string; message: string; detail?: string },
) => {
  const entry = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: event.level || 'info',
    area: event.area.slice(0, 40),
    message: event.message.slice(0, 300),
    detail: (event.detail || '').slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  const db = await getDb();
  if (!db) return entry;
  await db.collection('adminEvents').insertOne(entry);
  return entry;
};

export const mountAdmin = (app: Express, deps: AdminDeps) => {
  app.post('/api/admin/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Enter the admin email and password.' });
    }
    const email = (process.env.ADMIN_EMAIL || 'admin@zynkup.app').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!password) {
      return res.status(503).json({ error: 'Set ADMIN_EMAIL and ADMIN_PASSWORD on the server before signing in.' });
    }
    const emailOk = parsed.data.email.toLowerCase() === email;
    const passwordOk = crypto.timingSafeEqual(Buffer.from(parsed.data.password.padEnd(200)), Buffer.from(password.padEnd(200)));
    if (!emailOk || !passwordOk) {
      return res.status(401).json({ error: 'Those admin details do not match.' });
    }
    return res.json({ token: signToken(email), email });
  });

  app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
    const [users, profiles, messages, calls, statuses, catalog, db] = await Promise.all([
      deps.readUsers(),
      deps.readProfiles(),
      deps.readMessages(),
      deps.readCalls(),
      deps.readStatuses(),
      deps.readCatalogItems(),
      deps.getDb(),
    ]);
    const byCountry: Record<string, number> = {};
    users.forEach((user) => {
      const profile = profiles.find((item) => item.id === user.id);
      const key = deps.countryKeyFor(user, profile);
      const name = countryName(key);
      byCountry[name] = (byCountry[name] || 0) + 1;
    });
    const dayKey = (value: string) => value.slice(0, 10);
    const messageDays: Record<string, number> = {};
    messages.forEach((message) => {
      const key = dayKey(message.sentAt || '');
      if (key) messageDays[key] = (messageDays[key] || 0) + 1;
    });
    const payments = db ? await db.collection('payments').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray() : [];
    const boosts = db ? await db.collection('boostRequests').countDocuments({ state: 'pending' }) : 0;
    const blocks = db ? await db.collection('blockedNumbers').countDocuments({}) : 0;
    return res.json({
      cards: {
        users: users.length,
        messages: messages.length,
        calls: calls.length,
        statuses: statuses.length,
        products: catalog.length,
        pendingBoosts: boosts,
        blockedNumbers: blocks,
        payments: payments.length,
      },
      usersByCountry: Object.entries(byCountry).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      messagesByDay: Object.entries(messageDays).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
      recentPayments: payments,
    });
  });

  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const [users, profiles, messages, calls] = await Promise.all([
      deps.readUsers(),
      deps.readProfiles(),
      deps.readMessages(),
      deps.readCalls(),
    ]);
    const country = String(req.query.country || '');
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = users.map((user) => {
      const profile = profiles.find((item) => item.id === user.id);
      const code = deps.countryKeyFor(user, profile);
      return {
        id: user.id,
        name: user.name,
        phone: user.phone,
        username: profile?.username || '',
        about: profile?.about || user.about || '',
        businessName: profile?.businessName || '',
        currency: profile?.currency || '',
        presence: user.presence || 'offline',
        lastSeenAt: user.lastSeenAt || '',
        countryCode: code,
        country: countryName(code),
        blocked: Boolean(profile?.blocked),
        blockedUntil: profile?.blockedUntil || null,
        messages: messages.filter((item) => item.senderId === user.id).length,
        calls: calls.filter((item) => (item.participantIds || []).includes(user.id)).length,
      };
    }).filter((row) => {
      if (country && row.country !== country && row.countryCode !== country) return false;
      if (!q) return true;
      return [row.name, row.phone, row.username, row.country].join(' ').toLowerCase().includes(q);
    });
    const countries = [...new Set(rows.map((row) => row.country))].sort();
    return res.json({ users: rows, countries });
  });

  app.post('/api/admin/users/:userId/block', requireAdmin, async (req, res) => {
    const parsed = blockSchema.partial().safeParse(req.body ?? {});
    const users = await deps.readUsers();
    const user = users.find((item) => item.id === param(req.params.userId));
    if (!user) return res.status(404).json({ error: 'User not found' });
    const until = parsed.success ? parsed.data.until ?? null : null;
    await deps.updateProfile(user.id, { blocked: true, blockedUntil: until });
    const db = await deps.getDb();
    if (db) {
      await db.collection('blockedNumbers').updateOne(
        { phone: user.phone },
        { $set: { id: `block-${user.id}`, phone: user.phone, userId: user.id, reason: parsed.success ? parsed.data.reason || 'Blocked by admin' : 'Blocked by admin', until, createdAt: new Date().toISOString() } },
        { upsert: true },
      );
    }
    return res.json({ ok: true });
  });

  app.post('/api/admin/users/:userId/unblock', requireAdmin, async (req, res) => {
    const users = await deps.readUsers();
    const user = users.find((item) => item.id === param(req.params.userId));
    if (!user) return res.status(404).json({ error: 'User not found' });
    await deps.updateProfile(user.id, { blocked: false, blockedUntil: null });
    const db = await deps.getDb();
    if (db) await db.collection('blockedNumbers').deleteMany({ userId: user.id });
    return res.json({ ok: true });
  });

  app.post('/api/admin/users/:userId/pin', requireAdmin, async (req, res) => {
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    const users = await deps.readUsers();
    if (!users.some((item) => item.id === param(req.params.userId))) return res.status(404).json({ error: 'User not found' });
    await deps.updateProfile(param(req.params.userId), { pinHash: deps.hashPin(parsed.data.pin), appLockEnabled: true });
    return res.json({ ok: true });
  });

  app.get('/api/admin/blocks', requireAdmin, async (_req, res) => {
    const db = await deps.getDb();
    const blocks = db ? await db.collection('blockedNumbers').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray() : [];
    return res.json({ blocks });
  });

  app.post('/api/admin/blocks', requireAdmin, async (req, res) => {
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter the phone number to block.' });
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    const doc = {
      id: `block-${Date.now()}`,
      phone: parsed.data.phone,
      reason: parsed.data.reason || 'Blocked number',
      until: parsed.data.until ?? null,
      userId: parsed.data.userId || null,
      createdAt: new Date().toISOString(),
    };
    await db.collection('blockedNumbers').insertOne(doc);
    if (parsed.data.userId) {
      await deps.updateProfile(parsed.data.userId, { blocked: true, blockedUntil: doc.until });
    }
    return res.status(201).json({ block: doc });
  });

  app.delete('/api/admin/blocks/:blockId', requireAdmin, async (req, res) => {
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    const existing = await db.collection('blockedNumbers').findOne({ id: param(req.params.blockId) });
    await db.collection('blockedNumbers').deleteOne({ id: param(req.params.blockId) });
    if (existing?.userId) await deps.updateProfile(String(existing.userId), { blocked: false, blockedUntil: null });
    return res.json({ ok: true });
  });

  app.get('/api/admin/config', requireAdmin, async (_req, res) => {
    return res.json({ config: await readAppConfig(deps.getDb) });
  });

  app.patch('/api/admin/config', requireAdmin, async (req, res) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid settings.' });
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    const next = { ...(await readAppConfig(deps.getDb)), ...parsed.data, id: 'global' as const };
    await db.collection('appConfig').updateOne({ id: 'global' }, { $set: next }, { upsert: true });
    return res.json({ config: next });
  });

  app.get('/api/admin/payments', requireAdmin, async (_req, res) => {
    const db = await deps.getDb();
    const payments = db ? await db.collection('payments').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(200).toArray() : [];
    const total = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return res.json({ payments, total, count: payments.length });
  });

  app.get('/api/admin/activity', requireAdmin, async (_req, res) => {
    const [messages, calls, users, db] = await Promise.all([deps.readMessages(), deps.readCalls(), deps.readUsers(), deps.getDb()]);
    const events = db
      ? await db.collection('adminEvents').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(120).toArray()
      : [];
    const nameFor = (id: string) => users.find((user) => user.id === id)?.name || id;
    return res.json({
      events,
      messages: messages.slice(0, 80).map((message) => ({
        ...message,
        text: message.anonymous ? 'Anonymous message' : String(message.text || '').slice(0, 180),
        senderName: message.anonymous ? 'Anonymous' : nameFor(message.senderId),
      })),
      calls: calls.slice(0, 80).map((call) => ({
        ...call,
        initiatorName: nameFor(call.initiatorId || ''),
      })),
    });
  });

  app.get('/api/admin/catalog', requireAdmin, async (_req, res) => {
    const [items, users, db] = await Promise.all([deps.readCatalogItems(), deps.readUsers(), deps.getDb()]);
    const requests = db ? await db.collection('boostRequests').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray() : [];
    const nameFor = (id: string) => users.find((user) => user.id === id)?.name || id;
    return res.json({
      items: items.map((item) => ({ ...item, sellerName: nameFor(String(item.sellerId || '')) })),
      requests: requests.map((request) => ({ ...request, sellerName: nameFor(String(request.userId || '')) })),
    });
  });

  app.post('/api/admin/catalog/:itemId/boost', requireAdmin, async (req, res) => {
    const parsed = boostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose how many days the product stays on top.' });
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    const until = new Date(Date.now() + parsed.data.days * 24 * 60 * 60 * 1000).toISOString();
    const result = await db.collection('catalogItems').updateOne(
      { id: param(req.params.itemId) },
      { $set: { boostedUntil: until, boostText: parsed.data.boostText || 'Featured', updatedAt: new Date().toISOString() } },
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Product not found' });
    await db.collection('boostRequests').updateMany(
      { itemId: param(req.params.itemId), state: 'pending' },
      { $set: { state: 'approved', boostedUntil: until, boostText: parsed.data.boostText || 'Featured' } },
    );
    return res.json({ ok: true, boostedUntil: until });
  });

  app.post('/api/admin/boosts/:requestId/reject', requireAdmin, async (req, res) => {
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    await db.collection('boostRequests').updateOne({ id: param(req.params.requestId) }, { $set: { state: 'rejected' } });
    return res.json({ ok: true });
  });

  app.get('/api/admin/announcements', requireAdmin, async (_req, res) => {
    const db = await deps.getDb();
    const announcements = db ? await db.collection('announcements').find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray() : [];
    return res.json({ announcements, config: await readAppConfig(deps.getDb) });
  });

  app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
    const parsed = announceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Add a title and a message.' });
    const db = await deps.getDb();
    if (!db) return res.status(503).json({ error: 'Database is not connected.' });
    const doc = { id: `note-${Date.now()}`, ...parsed.data, createdAt: new Date().toISOString() };
    await db.collection('announcements').insertOne(doc);
    await db.collection('appConfig').updateOne(
      { id: 'global' },
      { $set: { ...(await readAppConfig(deps.getDb)), bannerText: parsed.data.body, bannerActive: true } },
      { upsert: true },
    );
    return res.status(201).json({ announcement: doc });
  });
};
