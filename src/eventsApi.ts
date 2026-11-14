/**
 * D5 Events & scheduled community sessions
 *
 * Free events only — no tickets, deposits, or payments.
 * Hosts create timezone-aware sessions; users RSVP interested/going.
 * Attend (going) is capacity-capped; interested is soft/unlimited.
 * Reminders run in-process; cancelled/ended events never remind.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type EventStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
export type EventRsvpStatus = 'interested' | 'going' | 'cancelled';

export type CommunityEvent = {
  id: string;
  title: string;
  description: string;
  hostUserId: string;
  communityId?: string | null;
  chatId?: string | null;
  voiceRoomId?: string | null;
  /** When true, client may create/link a voice room at start; server soft-stores voiceRoomId if provided. */
  createVoiceOnStart?: boolean;
  /** ISO UTC start instant. */
  startsAt: string;
  /** ISO UTC end instant (optional). */
  endsAt?: string | null;
  /** IANA timezone string, e.g. Africa/Accra — always returned clearly in API fields. */
  timezone: string;
  /** Hard cap for status=going RSVPs. */
  capacity: number;
  status: EventStatus;
  /** Minutes before startsAt to send reminders. */
  reminderMinutes: number[];
  /** Set once when event:starting has been emitted. */
  startingNotifiedAt?: string | null;
  /** Host-only reminder keys already sent (when host has no active RSVP). */
  hostRemindedFor?: string[];
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
};

export type EventRsvp = {
  id: string;
  eventId: string;
  userId: string;
  status: EventRsvpStatus;
  /** Reminder keys already sent, e.g. "60", "15". */
  remindedFor: string[];
  createdAt: string;
  updatedAt: string;
};

export type EventsDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readUsers: () => Promise<Array<{ id: string; name: string; avatar?: string }>>;
};

const DEFAULT_REMINDER_MINUTES = [60, 15];
const REMINDER_SCAN_MS = 60_000;
const STARTING_WINDOW_MS = 60_000;

const seedEvents: CommunityEvent[] = [];
const seedRsvps: EventRsvp[] = [];

type DocumentLike = Record<string, unknown>;

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const isValidTimeZone = (tz: string) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const ianaTimezone = z.string().trim().min(1).max(80).refine(
  isValidTimeZone,
  'Must be a valid IANA timezone (e.g. Africa/Accra)',
);

const isoDateTime = z.string().trim().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Must be a valid ISO date/time',
);

const createEventSchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(4000).optional().default(''),
  startsAt: isoDateTime,
  endsAt: isoDateTime.optional().nullable(),
  timezone: ianaTimezone,
  capacity: z.number().int().min(1).max(100_000),
  communityId: z.string().min(1).max(80).optional().nullable(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  voiceRoomId: z.string().min(1).max(80).optional().nullable(),
  createVoiceOnStart: z.boolean().optional().default(false),
  reminderMinutes: z.array(z.number().int().min(1).max(7 * 24 * 60)).max(10).optional(),
});

const updateEventSchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional().nullable(),
  timezone: ianaTimezone.optional(),
  capacity: z.number().int().min(1).max(100_000).optional(),
  communityId: z.string().min(1).max(80).optional().nullable(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  voiceRoomId: z.string().min(1).max(80).optional().nullable(),
  createVoiceOnStart: z.boolean().optional(),
  reminderMinutes: z.array(z.number().int().min(1).max(7 * 24 * 60)).max(10).optional(),
});

const userOnlySchema = z.object({
  userId: z.string().min(1).optional(),
});

const rsvpSchema = z.object({
  userId: z.string().min(1).optional(),
  status: z.enum(['interested', 'going', 'cancelled']),
});

const startEventSchema = z.object({
  userId: z.string().min(1).optional(),
  voiceRoomId: z.string().min(1).max(80).optional().nullable(),
  chatId: z.string().min(1).max(80).optional().nullable(),
});

const resolveUserId = async (deps: EventsDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

const emitToUser = (deps: EventsDeps, userId: string, event: string, payload: unknown) => {
  deps.io.to(`user:${userId}`).emit(event, payload);
};

async function ensureEventIndexes(deps: EventsDeps) {
  const db = await deps.getDb();
  if (!db) return;
  try {
    await db.collection('eventRsvps').createIndex(
      { eventId: 1, userId: 1 },
      { unique: true, name: 'eventRsvps_eventId_userId' },
    );
    await db.collection('events').createIndex(
      { startsAt: 1, status: 1 },
      { name: 'events_startsAt_status' },
    );
  } catch {
    // Index may already exist or Mongo unavailable mid-startup.
  }
}

async function findEvent(deps: EventsDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedEvents.find((item) => item.id === id) ?? null;
  return db.collection<CommunityEvent>('events').findOne({ id }, { projection: { _id: 0 } });
}

async function saveEvent(deps: EventsDeps, event: CommunityEvent) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedEvents, event);
  await db.collection<CommunityEvent>('events').updateOne({ id: event.id }, { $set: event }, { upsert: true });
  return event;
}

async function readEvents(
  deps: EventsDeps,
  filter: DocumentLike = {},
) {
  const db = await deps.getDb();
  if (!db) {
    return seedEvents.filter((item) =>
      Object.entries(filter).every(([key, value]) => (item as Record<string, unknown>)[key] === value));
  }
  return db.collection<CommunityEvent>('events').find(filter, { projection: { _id: 0 } }).toArray();
}

async function findRsvp(deps: EventsDeps, eventId: string, userId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedRsvps.find((item) => item.eventId === eventId && item.userId === userId) ?? null;
  }
  return db.collection<EventRsvp>('eventRsvps').findOne(
    { eventId, userId },
    { projection: { _id: 0 } },
  );
}

async function saveRsvp(deps: EventsDeps, rsvp: EventRsvp) {
  const db = await deps.getDb();
  if (!db) {
    const index = seedRsvps.findIndex((item) => item.eventId === rsvp.eventId && item.userId === rsvp.userId);
    if (index >= 0) seedRsvps[index] = rsvp;
    else seedRsvps.unshift(rsvp);
    return rsvp;
  }
  await db.collection<EventRsvp>('eventRsvps').updateOne(
    { eventId: rsvp.eventId, userId: rsvp.userId },
    { $set: rsvp },
    { upsert: true },
  );
  return rsvp;
}

async function readRsvps(
  deps: EventsDeps,
  filter: Partial<EventRsvp> | DocumentLike = {},
) {
  const db = await deps.getDb();
  if (!db) {
    return seedRsvps.filter((item) =>
      Object.entries(filter).every(([key, value]) => (item as Record<string, unknown>)[key] === value));
  }
  return db.collection<EventRsvp>('eventRsvps').find(filter as DocumentLike, { projection: { _id: 0 } }).toArray();
}

async function countRsvpsByStatus(deps: EventsDeps, eventId: string, status: EventRsvpStatus) {
  const db = await deps.getDb();
  if (!db) {
    return seedRsvps.filter((item) => item.eventId === eventId && item.status === status).length;
  }
  return db.collection<EventRsvp>('eventRsvps').countDocuments({ eventId, status });
}

type CommunityMemberLite = {
  userId: string;
  role: string;
  state: string;
};

async function findActiveCommunityMembership(
  deps: EventsDeps,
  communityId: string,
  userId: string,
): Promise<CommunityMemberLite | null> {
  const db = await deps.getDb();
  if (!db) return null;
  const membership = await db.collection<CommunityMemberLite>('communityMembers').findOne(
    { communityId, userId, state: 'active' },
    { projection: { _id: 0, userId: 1, role: 1, state: 1 } },
  );
  return membership ?? null;
}

const ROLE_RANK: Record<string, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

const canModerateEvent = async (
  deps: EventsDeps,
  event: CommunityEvent,
  userId: string,
) => {
  if (event.hostUserId === userId) return true;
  if (!event.communityId) return false;
  const membership = await findActiveCommunityMembership(deps, event.communityId, userId);
  if (!membership) return false;
  return (ROLE_RANK[membership.role] ?? 0) >= ROLE_RANK.moderator;
};

/** Local wall-clock label in the event timezone for API clarity. */
const formatInTimezone = (isoUtc: string, timezone: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
};

const publicEventFields = (event: CommunityEvent) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  hostUserId: event.hostUserId,
  communityId: event.communityId ?? null,
  chatId: event.chatId ?? null,
  voiceRoomId: event.voiceRoomId ?? null,
  createVoiceOnStart: Boolean(event.createVoiceOnStart),
  startsAt: event.startsAt,
  endsAt: event.endsAt ?? null,
  /** IANA timezone — wall clock for this event. */
  timezone: event.timezone,
  startsAtLocal: formatInTimezone(event.startsAt, event.timezone),
  endsAtLocal: event.endsAt ? formatInTimezone(event.endsAt, event.timezone) : null,
  capacity: event.capacity,
  status: event.status,
  reminderMinutes: [...(event.reminderMinutes?.length ? event.reminderMinutes : DEFAULT_REMINDER_MINUTES)],
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  cancelledAt: event.cancelledAt ?? null,
});

async function notifyEventAudience(
  deps: EventsDeps,
  event: CommunityEvent,
  socketEvent: string,
  payload: unknown,
) {
  const rsvps = await readRsvps(deps, { eventId: event.id });
  const recipients = new Set<string>([event.hostUserId]);
  for (const rsvp of rsvps) {
    if (rsvp.status === 'cancelled') continue;
    recipients.add(rsvp.userId);
  }
  for (const userId of recipients) {
    emitToUser(deps, userId, socketEvent, payload);
  }
}

async function assertCanRsvpCommunity(
  deps: EventsDeps,
  event: CommunityEvent,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!event.communityId) return { ok: true };
  if (event.hostUserId === userId) return { ok: true };
  const membership = await findActiveCommunityMembership(deps, event.communityId, userId);
  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: 'Active community membership is required to RSVP to this event.',
    };
  }
  return { ok: true };
}

async function listVisibleEvents(deps: EventsDeps, userId: string, communityId?: string) {
  const now = Date.now();
  const all = await readEvents(deps);
  const myRsvps = await readRsvps(deps, { userId });
  const myEventIds = new Set(
    myRsvps.filter((item) => item.status !== 'cancelled').map((item) => item.eventId),
  );

  const upcomingOrLive = all.filter((event) => {
    if (communityId && event.communityId !== communityId) return false;
    if (event.status === 'cancelled') {
      // Still show cancelled events the user hosts or RSVP'd to (clearly marked).
      return event.hostUserId === userId || myEventIds.has(event.id);
    }
    if (event.status === 'ended') {
      const endedMs = event.endsAt ? Date.parse(event.endsAt) : Date.parse(event.startsAt);
      return (event.hostUserId === userId || myEventIds.has(event.id))
        && !Number.isNaN(endedMs)
        && now - endedMs < 7 * 24 * 60 * 60 * 1000;
    }
    // scheduled | live
    if (event.hostUserId === userId || myEventIds.has(event.id)) return true;
    if (communityId && event.communityId === communityId) return true;
    // Public/community-visible: events without community, or any non-cancelled upcoming.
    if (!event.communityId) return Date.parse(event.startsAt) >= now - 60 * 60 * 1000 || event.status === 'live';
    // Community events appear in community filter; without filter, show to members only via mine,
    // and list community-linked upcoming for discover when user is a member.
    return false;
  });

  // Also include community events for communities the user belongs to.
  const communityLinked = all.filter((event) => {
    if (!event.communityId) return false;
    if (communityId && event.communityId !== communityId) return false;
    if (event.status === 'cancelled' || event.status === 'ended') return false;
    if (event.hostUserId === userId || myEventIds.has(event.id)) return false;
    return true;
  });

  const withMembership: CommunityEvent[] = [];
  for (const event of communityLinked) {
    if (!event.communityId) continue;
    const membership = await findActiveCommunityMembership(deps, event.communityId, userId);
    if (membership) withMembership.push(event);
  }

  const byId = new Map<string, CommunityEvent>();
  for (const event of [...upcomingOrLive, ...withMembership]) {
    byId.set(event.id, event);
  }

  const events = [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const enriched = [];
  for (const event of events) {
    const myRsvp = await findRsvp(deps, event.id, userId);
    const goingCount = await countRsvpsByStatus(deps, event.id, 'going');
    const interestedCount = await countRsvpsByStatus(deps, event.id, 'interested');
    enriched.push({
      ...publicEventFields(event),
      myRsvp: myRsvp && myRsvp.status !== 'cancelled' ? myRsvp.status : null,
      goingCount,
      interestedCount,
      spotsRemaining: Math.max(0, event.capacity - goingCount),
    });
  }
  return enriched;
}

async function processRemindersWithHost(deps: EventsDeps) {
  const now = Date.now();
  const scheduled = await readEvents(deps, { status: 'scheduled' });

  for (const event of scheduled) {
    if (event.status !== 'scheduled') continue;
    const startsAtMs = Date.parse(event.startsAt);
    if (Number.isNaN(startsAtMs)) continue;

    const reminders = event.reminderMinutes?.length
      ? event.reminderMinutes
      : DEFAULT_REMINDER_MINUTES;

    if (
      !event.startingNotifiedAt
      && now >= startsAtMs
      && now < startsAtMs + STARTING_WINDOW_MS
    ) {
      const stamp = nowIso();
      const next: CommunityEvent = { ...event, startingNotifiedAt: stamp, updatedAt: stamp };
      await saveEvent(deps, next);
      await notifyEventAudience(deps, next, 'event:starting', {
        eventId: next.id,
        event: publicEventFields(next),
        startsAt: next.startsAt,
        timezone: next.timezone,
        startsAtLocal: formatInTimezone(next.startsAt, next.timezone),
        joinHints: {
          chatId: next.chatId ?? null,
          voiceRoomId: next.voiceRoomId ?? null,
        },
      });
    }

    const rsvps = (await readRsvps(deps, { eventId: event.id }))
      .filter((item) => item.status === 'going' || item.status === 'interested');

    for (const minutes of reminders) {
      const key = String(minutes);
      const remindAt = startsAtMs - minutes * 60_000;
      if (now < remindAt) continue;

      for (const rsvp of rsvps) {
        if (rsvp.remindedFor?.includes(key)) continue;
        const nextRsvp: EventRsvp = {
          ...rsvp,
          remindedFor: [...new Set([...(rsvp.remindedFor || []), key])],
          updatedAt: nowIso(),
        };
        await saveRsvp(deps, nextRsvp);
        emitToUser(deps, rsvp.userId, 'event:reminder', {
          eventId: event.id,
          minutesBefore: minutes,
          reminderKey: key,
          event: publicEventFields(event),
          startsAt: event.startsAt,
          timezone: event.timezone,
          startsAtLocal: formatInTimezone(event.startsAt, event.timezone),
          rsvpStatus: rsvp.status,
        });
      }

      // Host reminder (if host is not already in active RSVPs).
      const hostInRsvps = rsvps.some((item) => item.userId === event.hostUserId);
      if (!hostInRsvps) {
        const hostKeys = event.hostRemindedFor || [];
        if (!hostKeys.includes(key)) {
          const nextEvent: CommunityEvent = {
            ...event,
            hostRemindedFor: [...hostKeys, key],
            updatedAt: nowIso(),
          };
          await saveEvent(deps, nextEvent);
          emitToUser(deps, event.hostUserId, 'event:reminder', {
            eventId: event.id,
            minutesBefore: minutes,
            reminderKey: key,
            event: publicEventFields(event),
            startsAt: event.startsAt,
            timezone: event.timezone,
            startsAtLocal: formatInTimezone(event.startsAt, event.timezone),
            rsvpStatus: 'host',
          });
        }
      }
    }
  }
}

let reminderTimer: NodeJS.Timeout | null = null;

const startReminderLoop = (deps: EventsDeps) => {
  if (reminderTimer) return;
  const tick = () => {
    void processRemindersWithHost(deps).catch(() => undefined);
  };
  tick();
  reminderTimer = setInterval(tick, REMINDER_SCAN_MS);
  if (typeof reminderTimer.unref === 'function') reminderTimer.unref();
};

export const registerEventsApi = (app: Express, deps: EventsDeps) => {
  void ensureEventIndexes(deps);
  startReminderLoop(deps);

  app.get('/api/events', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const communityId = typeof req.query.communityId === 'string' ? req.query.communityId.trim() : undefined;
    const events = await listVisibleEvents(deps, userId, communityId || undefined);
    return res.json({ events });
  });

  app.post('/api/events', async (req, res) => {
    const parseResult = createEventSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Enter a title, start time, timezone, and capacity.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (parseResult.data.communityId) {
      const membership = await findActiveCommunityMembership(deps, parseResult.data.communityId, userId);
      if (!membership) {
        return res.status(403).json({
          error: 'Active community membership is required to create a community event.',
        });
      }
    }

    if (parseResult.data.endsAt) {
      if (Date.parse(parseResult.data.endsAt) <= Date.parse(parseResult.data.startsAt)) {
        return res.status(400).json({ error: 'endsAt must be after startsAt.' });
      }
    }

    const stamp = nowIso();
    const startsAt = new Date(parseResult.data.startsAt).toISOString();
    const endsAt = parseResult.data.endsAt
      ? new Date(parseResult.data.endsAt).toISOString()
      : null;

    const event: CommunityEvent = {
      id: newId('evt'),
      title: parseResult.data.title,
      description: parseResult.data.description || '',
      hostUserId: userId,
      communityId: parseResult.data.communityId || null,
      chatId: parseResult.data.chatId || null,
      voiceRoomId: parseResult.data.voiceRoomId || null,
      createVoiceOnStart: Boolean(parseResult.data.createVoiceOnStart),
      startsAt,
      endsAt,
      timezone: parseResult.data.timezone,
      capacity: parseResult.data.capacity,
      status: 'scheduled',
      reminderMinutes: parseResult.data.reminderMinutes?.length
        ? [...new Set(parseResult.data.reminderMinutes)].sort((a, b) => b - a)
        : [...DEFAULT_REMINDER_MINUTES],
      startingNotifiedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      cancelledAt: null,
    };
    await saveEvent(deps, event);
    emitToUser(deps, userId, 'event:updated', {
      event: publicEventFields(event),
      action: 'created',
    });
    return res.status(201).json({ event: publicEventFields(event) });
  });

  app.get('/api/events/:id', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (event.communityId && userId && event.hostUserId !== userId) {
      const membership = await findActiveCommunityMembership(deps, event.communityId, userId);
      const myRsvp = userId ? await findRsvp(deps, event.id, userId) : null;
      const hasRsvp = Boolean(myRsvp && myRsvp.status !== 'cancelled');
      if (!membership && !hasRsvp) {
        return res.status(403).json({ error: 'This community event is only visible to members.' });
      }
    }

    const goingCount = await countRsvpsByStatus(deps, event.id, 'going');
    const interestedCount = await countRsvpsByStatus(deps, event.id, 'interested');
    const myRsvp = userId ? await findRsvp(deps, event.id, userId) : null;
    const isHost = Boolean(userId && event.hostUserId === userId);
    const isMod = userId ? await canModerateEvent(deps, event, userId) : false;

    const base = {
      ...publicEventFields(event),
      myRsvp: myRsvp && myRsvp.status !== 'cancelled'
        ? { status: myRsvp.status, updatedAt: myRsvp.updatedAt }
        : null,
      goingCount,
      interestedCount,
      spotsRemaining: Math.max(0, event.capacity - goingCount),
    };

    if (isHost || isMod) {
      const attendees = await readRsvps(deps, { eventId: event.id });
      const users = await deps.readUsers();
      const byId = new Map(users.map((user) => [user.id, user]));
      return res.json({
        event: {
          ...base,
          attendees: attendees
            .filter((item) => item.status !== 'cancelled')
            .map((item) => ({
              ...item,
              name: byId.get(item.userId)?.name || '',
              avatar: byId.get(item.userId)?.avatar || '',
            })),
        },
      });
    }

    return res.json({ event: base });
  });

  app.put('/api/events/:id', async (req, res) => {
    const parseResult = updateEventSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid event update.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can update this event.' });
    }
    if (event.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot update a cancelled event.' });
    }
    if (event.status === 'ended') {
      return res.status(409).json({ error: 'Cannot update an ended event.' });
    }

    const nextStartsAt = parseResult.data.startsAt
      ? new Date(parseResult.data.startsAt).toISOString()
      : event.startsAt;
    const nextEndsAt = parseResult.data.endsAt === undefined
      ? event.endsAt ?? null
      : parseResult.data.endsAt
        ? new Date(parseResult.data.endsAt).toISOString()
        : null;
    if (nextEndsAt && Date.parse(nextEndsAt) <= Date.parse(nextStartsAt)) {
      return res.status(400).json({ error: 'endsAt must be after startsAt.' });
    }

    if (parseResult.data.capacity != null) {
      const goingCount = await countRsvpsByStatus(deps, event.id, 'going');
      if (parseResult.data.capacity < goingCount) {
        return res.status(409).json({
          error: `Capacity cannot be below current going count (${goingCount}).`,
        });
      }
    }

    const titleChanged = parseResult.data.title != null && parseResult.data.title !== event.title;
    const timeChanged = Boolean(
      (parseResult.data.startsAt && nextStartsAt !== event.startsAt)
      || (parseResult.data.timezone && parseResult.data.timezone !== event.timezone)
      || (parseResult.data.endsAt !== undefined && nextEndsAt !== (event.endsAt ?? null)),
    );

    // If start time moves later, clear reminder marks so new windows can fire.
    let rsvpReminderReset = false;
    if (timeChanged && Date.parse(nextStartsAt) > Date.parse(event.startsAt)) {
      rsvpReminderReset = true;
    }

    const next: CommunityEvent = {
      ...event,
      title: parseResult.data.title ?? event.title,
      description: parseResult.data.description ?? event.description,
      startsAt: nextStartsAt,
      endsAt: nextEndsAt,
      timezone: parseResult.data.timezone ?? event.timezone,
      capacity: parseResult.data.capacity ?? event.capacity,
      communityId: parseResult.data.communityId === undefined
        ? event.communityId ?? null
        : parseResult.data.communityId,
      chatId: parseResult.data.chatId === undefined ? event.chatId ?? null : parseResult.data.chatId,
      voiceRoomId: parseResult.data.voiceRoomId === undefined
        ? event.voiceRoomId ?? null
        : parseResult.data.voiceRoomId,
      createVoiceOnStart: parseResult.data.createVoiceOnStart ?? Boolean(event.createVoiceOnStart),
      reminderMinutes: parseResult.data.reminderMinutes?.length
        ? [...new Set(parseResult.data.reminderMinutes)].sort((a, b) => b - a)
        : event.reminderMinutes,
      startingNotifiedAt: timeChanged ? null : event.startingNotifiedAt ?? null,
      updatedAt: nowIso(),
    };
    await saveEvent(deps, next);

    if (rsvpReminderReset) {
      const rsvps = await readRsvps(deps, { eventId: event.id });
      for (const rsvp of rsvps) {
        if (!rsvp.remindedFor?.length) continue;
        await saveRsvp(deps, { ...rsvp, remindedFor: [], updatedAt: nowIso() });
      }
    }

    if (titleChanged || timeChanged) {
      await notifyEventAudience(deps, next, 'event:updated', {
        event: publicEventFields(next),
        action: 'updated',
        changes: {
          title: titleChanged,
          time: timeChanged,
        },
      });
    }

    return res.json({ event: publicEventFields(next) });
  });

  app.post('/api/events/:id/cancel', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid cancel payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can cancel this event.' });
    }
    if (event.status === 'cancelled') {
      return res.json({ event: publicEventFields(event), alreadyCancelled: true });
    }
    if (event.status === 'ended') {
      return res.status(409).json({ error: 'Cannot cancel an ended event.' });
    }

    const stamp = nowIso();
    const next: CommunityEvent = {
      ...event,
      status: 'cancelled',
      cancelledAt: stamp,
      updatedAt: stamp,
    };
    await saveEvent(deps, next);
    await notifyEventAudience(deps, next, 'event:cancelled', {
      event: publicEventFields(next),
      action: 'cancelled',
      cancelledAt: stamp,
      timezone: next.timezone,
    });
    // Also emit event:updated so clients listening for material changes see cancel.
    await notifyEventAudience(deps, next, 'event:updated', {
      event: publicEventFields(next),
      action: 'cancelled',
    });
    return res.json({ event: publicEventFields(next) });
  });

  app.post('/api/events/:id/rsvp', async (req, res) => {
    const parseResult = rsvpSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid RSVP. Use interested, going, or cancelled.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status === 'cancelled') {
      return res.status(409).json({ error: 'This event has been cancelled.' });
    }
    if (event.status === 'ended') {
      return res.status(409).json({ error: 'This event has ended.' });
    }

    const membershipGate = await assertCanRsvpCommunity(deps, event, userId);
    if (!membershipGate.ok) {
      return res.status(membershipGate.status).json({ error: membershipGate.error });
    }

    const existing = await findRsvp(deps, event.id, userId);
    const nextStatus = parseResult.data.status;

    if (nextStatus === 'going') {
      const goingCount = await countRsvpsByStatus(deps, event.id, 'going');
      const alreadyGoing = existing?.status === 'going';
      if (!alreadyGoing && goingCount >= event.capacity) {
        return res.status(409).json({
          error: 'This event is full.',
          capacity: event.capacity,
          goingCount,
        });
      }
    }

    const stamp = nowIso();
    const rsvp: EventRsvp = {
      id: existing?.id || newId('ersvp'),
      eventId: event.id,
      userId,
      status: nextStatus,
      remindedFor: existing?.remindedFor || [],
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
    };
    await saveRsvp(deps, rsvp);

    const goingCount = await countRsvpsByStatus(deps, event.id, 'going');
    const interestedCount = await countRsvpsByStatus(deps, event.id, 'interested');

    emitToUser(deps, event.hostUserId, 'event:updated', {
      event: publicEventFields(event),
      action: 'rsvp',
      rsvp: { userId, status: nextStatus },
      goingCount,
      interestedCount,
    });

    return res.json({
      rsvp: {
        id: rsvp.id,
        eventId: rsvp.eventId,
        userId: rsvp.userId,
        status: rsvp.status,
        updatedAt: rsvp.updatedAt,
      },
      event: {
        ...publicEventFields(event),
        myRsvp: nextStatus === 'cancelled' ? null : nextStatus,
        goingCount,
        interestedCount,
        spotsRemaining: Math.max(0, event.capacity - goingCount),
      },
    });
  });

  app.post('/api/events/:id/start', async (req, res) => {
    const parseResult = startEventSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid start payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can start this event.' });
    }
    if (event.status === 'cancelled') {
      return res.status(409).json({ error: 'Cannot start a cancelled event.' });
    }
    if (event.status === 'ended') {
      return res.status(409).json({ error: 'Event already ended.' });
    }
    if (event.status === 'live') {
      return res.json({
        event: publicEventFields(event),
        alreadyLive: true,
        joinHints: {
          chatId: event.chatId ?? null,
          voiceRoomId: event.voiceRoomId ?? null,
        },
      });
    }

    const stamp = nowIso();
    const next: CommunityEvent = {
      ...event,
      status: 'live',
      chatId: parseResult.data.chatId === undefined ? event.chatId ?? null : parseResult.data.chatId,
      voiceRoomId: parseResult.data.voiceRoomId === undefined
        ? event.voiceRoomId ?? null
        : parseResult.data.voiceRoomId,
      startingNotifiedAt: event.startingNotifiedAt || stamp,
      updatedAt: stamp,
    };
    await saveEvent(deps, next);

    const joinHints = {
      chatId: next.chatId ?? null,
      voiceRoomId: next.voiceRoomId ?? null,
      createVoiceOnStart: Boolean(next.createVoiceOnStart),
      note: next.voiceRoomId
        ? 'Join the linked voice room.'
        : next.createVoiceOnStart
          ? 'Create or link a voice room via PUT/start with voiceRoomId (voiceRoomsApi owns creation).'
          : next.chatId
            ? 'Join the linked chat.'
            : 'No chat or voice room linked yet.',
    };

    await notifyEventAudience(deps, next, 'event:starting', {
      eventId: next.id,
      event: publicEventFields(next),
      startsAt: next.startsAt,
      timezone: next.timezone,
      startsAtLocal: formatInTimezone(next.startsAt, next.timezone),
      joinHints,
    });
    await notifyEventAudience(deps, next, 'event:updated', {
      event: publicEventFields(next),
      action: 'live',
      joinHints,
    });

    return res.json({
      event: publicEventFields(next),
      joinHints,
    });
  });

  app.post('/api/events/:id/end', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid end payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can end this event.' });
    }
    if (event.status === 'cancelled') {
      return res.status(409).json({ error: 'Event is cancelled.' });
    }
    if (event.status === 'ended') {
      return res.json({ event: publicEventFields(event), alreadyEnded: true });
    }

    const stamp = nowIso();
    const next: CommunityEvent = {
      ...event,
      status: 'ended',
      endsAt: event.endsAt || stamp,
      updatedAt: stamp,
    };
    await saveEvent(deps, next);
    await notifyEventAudience(deps, next, 'event:updated', {
      event: publicEventFields(next),
      action: 'ended',
    });
    return res.json({ event: publicEventFields(next) });
  });

  app.get('/api/events/:id/attendees', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const event = await findEvent(deps, param(req.params.id));
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const isHost = event.hostUserId === userId;
    const isMod = await canModerateEvent(deps, event, userId);
    if (!isHost && !isMod) {
      return res.status(403).json({ error: 'Only the host (or community mods) can view full attendee lists.' });
    }

    const attendees = await readRsvps(deps, { eventId: event.id });
    const users = await deps.readUsers();
    const byId = new Map(users.map((user) => [user.id, user]));
    const goingCount = attendees.filter((item) => item.status === 'going').length;
    const interestedCount = attendees.filter((item) => item.status === 'interested').length;

    return res.json({
      eventId: event.id,
      goingCount,
      interestedCount,
      attendees: attendees
        .filter((item) => item.status !== 'cancelled')
        .map((item) => ({
          id: item.id,
          eventId: item.eventId,
          userId: item.userId,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          name: byId.get(item.userId)?.name || '',
          avatar: byId.get(item.userId)?.avatar || '',
        })),
    });
  });
};

/** Test helper / manual trigger for reminder scan. */
export const runEventReminderScan = processRemindersWithHost;
