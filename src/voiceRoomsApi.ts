/**
 * D2 Live Voice Rooms
 *
 * Audio architecture (Phase 1):
 * - Mesh WebRTC among active publishers only (host, moderators, speakers).
 * - capacitySpeakers defaults to 8 so mesh stays tractable until an SFU lands.
 * - Listeners do NOT publish audio. They may receive speaker streams as recvonly
 *   peers (signaling stays generic: offer/answer/ice between allowed endpoints).
 * - Server rejects voice:signal offers from listeners (non-publishers).
 * - SFU can replace mesh later without changing the REST role model.
 *
 * Client reconnect hint: on socket disconnect while in a live room, show a
 * "Reconnecting…" state and re-emit voice:join after reconnect (optional
 * voice:reconnecting may be emitted by peers observing a leave without end).
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

export type VoiceRoomPrivacy = 'public' | 'private' | 'invite-only';
export type VoiceRoomStatus = 'live' | 'ended';
export type VoiceRoomRole = 'host' | 'moderator' | 'speaker' | 'listener';
export type VoiceParticipantState = 'active' | 'left' | 'removed' | 'blocked';

export type VoiceRoom = {
  id: string;
  title: string;
  description: string;
  rules: string;
  privacy: VoiceRoomPrivacy;
  communityId?: string | null;
  hostUserId: string;
  status: VoiceRoomStatus;
  capacityListeners: number;
  capacitySpeakers: number;
  /** Recording is always off in Phase 1 — do not enable. */
  recordingEnabled: false;
  createdAt: string;
  endedAt?: string | null;
  updatedAt: string;
};

export type VoiceRoomParticipant = {
  id: string;
  roomId: string;
  userId: string;
  role: VoiceRoomRole;
  handRaised: boolean;
  handRaisedAt?: string | null;
  /** Server-enforced mute desire. Listeners stay muted until promoted. */
  muted: boolean;
  /** When true, participant cannot clear muted themselves (host/mod force mute). */
  forceMuted: boolean;
  blocked: boolean;
  joinedAt: string;
  leftAt?: string | null;
  state: VoiceParticipantState;
};

export type VoiceRoomInvite = {
  id: string;
  token: string;
  roomId: string;
  createdByUserId: string;
  /** Role hint on accept — never host; typically listener. */
  role: Exclude<VoiceRoomRole, 'host'>;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
};

export type VoiceRoomAuditEvent = {
  id: string;
  roomId: string;
  actorUserId: string;
  action: string;
  detail: string;
  targetUserId?: string | null;
  createdAt: string;
};

export type VoiceRoomsDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readUsers: () => Promise<Array<{ id: string; name: string; avatar?: string }>>;
};

const DEFAULT_CAPACITY_LISTENERS = 50;
const DEFAULT_CAPACITY_SPEAKERS = 8;

/** Roles that may publish audio / send SDP offers in Phase 1 mesh. */
const PUBLISHER_ROLES: VoiceRoomRole[] = ['host', 'moderator', 'speaker'];

const ROLE_RANK: Record<VoiceRoomRole, number> = {
  host: 4,
  moderator: 3,
  speaker: 2,
  listener: 1,
};

const seedRooms: VoiceRoom[] = [];
const seedParticipants: VoiceRoomParticipant[] = [];
const seedInvites: VoiceRoomInvite[] = [];
const seedAudit: VoiceRoomAuditEvent[] = [];

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

const roleAtLeast = (role: VoiceRoomRole, minimum: VoiceRoomRole) => ROLE_RANK[role] >= ROLE_RANK[minimum];
const isPublisherRole = (role: VoiceRoomRole) => PUBLISHER_ROLES.includes(role);

const createRoomSchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional().default(''),
  rules: z.string().trim().max(4000).optional().default(''),
  privacy: z.enum(['public', 'private', 'invite-only']).optional().default('public'),
  communityId: z.string().min(1).max(80).optional().nullable(),
  capacity: z
    .object({
      listeners: z.number().int().min(1).max(500).optional(),
      speakers: z.number().int().min(1).max(8).optional(),
    })
    .optional(),
});

const userOnlySchema = z.object({
  userId: z.string().min(1).optional(),
});

const joinSchema = z.object({
  userId: z.string().min(1).optional(),
  inviteToken: z.string().min(6).max(80).optional(),
});

const inviteSchema = z.object({
  userId: z.string().min(1).optional(),
  role: z.enum(['moderator', 'speaker', 'listener']).optional().default('listener'),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 90).optional(),
});

const acceptInviteSchema = z.object({
  userId: z.string().min(1).optional(),
});

const removeSchema = z.object({
  userId: z.string().min(1).optional(),
  block: z.boolean().optional().default(false),
});

const muteSchema = z.object({
  userId: z.string().min(1).optional(),
  muted: z.boolean().optional().default(true),
});

const reportSchema = z.object({
  userId: z.string().min(1).optional(),
  reason: z.string().trim().min(4).max(280),
  targetUserId: z.string().min(1).max(80).optional(),
});

const moderatorSchema = z.object({
  userId: z.string().min(1).optional(),
});

const resolveUserId = async (deps: VoiceRoomsDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

async function readAllRooms(deps: VoiceRoomsDeps) {
  const db = await deps.getDb();
  if (!db) return [...seedRooms];
  return db.collection<VoiceRoom>('voiceRooms').find({}, { projection: { _id: 0 } }).toArray();
}

async function findRoom(deps: VoiceRoomsDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedRooms.find((item) => item.id === id) ?? null;
  return db.collection<VoiceRoom>('voiceRooms').findOne({ id }, { projection: { _id: 0 } });
}

async function saveRoom(deps: VoiceRoomsDeps, room: VoiceRoom) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedRooms, room);
  await db.collection<VoiceRoom>('voiceRooms').updateOne({ id: room.id }, { $set: room }, { upsert: true });
  return room;
}

async function readParticipants(
  deps: VoiceRoomsDeps,
  filter: Partial<VoiceRoomParticipant> | DocumentLike = {},
) {
  const db = await deps.getDb();
  if (!db) {
    return seedParticipants.filter((item) =>
      Object.entries(filter).every(([key, value]) => (item as Record<string, unknown>)[key] === value));
  }
  return db
    .collection<VoiceRoomParticipant>('voiceRoomParticipants')
    .find(filter as DocumentLike, { projection: { _id: 0 } })
    .toArray();
}

async function findParticipant(deps: VoiceRoomsDeps, roomId: string, userId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedParticipants.find((item) => item.roomId === roomId && item.userId === userId) ?? null;
  }
  return db.collection<VoiceRoomParticipant>('voiceRoomParticipants').findOne(
    { roomId, userId },
    { projection: { _id: 0 } },
  );
}

async function saveParticipant(deps: VoiceRoomsDeps, participant: VoiceRoomParticipant) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedParticipants, participant);
  await db.collection<VoiceRoomParticipant>('voiceRoomParticipants').updateOne(
    { id: participant.id },
    { $set: participant },
    { upsert: true },
  );
  return participant;
}

async function findInviteByToken(deps: VoiceRoomsDeps, token: string) {
  const db = await deps.getDb();
  if (!db) return seedInvites.find((item) => item.token === token) ?? null;
  return db.collection<VoiceRoomInvite>('voiceRoomInvites').findOne({ token }, { projection: { _id: 0 } });
}

async function saveInvite(deps: VoiceRoomsDeps, invite: VoiceRoomInvite) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedInvites, invite);
  await db.collection<VoiceRoomInvite>('voiceRoomInvites').updateOne(
    { id: invite.id },
    { $set: invite },
    { upsert: true },
  );
  return invite;
}

async function appendAudit(
  deps: VoiceRoomsDeps,
  event: Omit<VoiceRoomAuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
) {
  const row: VoiceRoomAuditEvent = {
    id: event.id || newId('vraud'),
    roomId: event.roomId,
    actorUserId: event.actorUserId,
    action: event.action,
    detail: event.detail,
    targetUserId: event.targetUserId ?? null,
    createdAt: event.createdAt || nowIso(),
  };
  const db = await deps.getDb();
  if (!db) {
    seedAudit.unshift(row);
    return row;
  }
  await db.collection<VoiceRoomAuditEvent>('voiceRoomAudit').insertOne(row);
  return row;
}

const activeParticipant = (participant: VoiceRoomParticipant | null | undefined) =>
  participant?.state === 'active' ? participant : null;

const canModerate = (role: VoiceRoomRole) => roleAtLeast(role, 'moderator');

const countActiveListeners = (participants: VoiceRoomParticipant[]) =>
  participants.filter((item) => item.state === 'active').length;

const countActivePublishers = (participants: VoiceRoomParticipant[]) =>
  participants.filter((item) => item.state === 'active' && isPublisherRole(item.role)).length;

const publicRoomPreview = (room: VoiceRoom, participant?: VoiceRoomParticipant | null) => ({
  id: room.id,
  title: room.title,
  description: room.description,
  privacy: room.privacy,
  communityId: room.communityId ?? null,
  hostUserId: room.hostUserId,
  status: room.status,
  capacityListeners: room.capacityListeners,
  capacitySpeakers: room.capacitySpeakers,
  recordingEnabled: false as const,
  createdAt: room.createdAt,
  endedAt: room.endedAt ?? null,
  updatedAt: room.updatedAt,
  myRole: activeParticipant(participant)?.role ?? null,
  myState: participant?.state ?? null,
  muted: Boolean(activeParticipant(participant)?.muted),
  handRaised: Boolean(activeParticipant(participant)?.handRaised),
});

/** Private / invite-only rooms must not leak title/description to outsiders. */
const privateRoomTeaser = (room: VoiceRoom) => ({
  id: room.id,
  title: 'Private voice room',
  description: '',
  privacy: room.privacy,
  communityId: null as string | null,
  hostUserId: '',
  status: room.status,
  capacityListeners: room.capacityListeners,
  capacitySpeakers: room.capacitySpeakers,
  recordingEnabled: false as const,
  createdAt: room.createdAt,
  endedAt: room.endedAt ?? null,
  updatedAt: room.updatedAt,
  myRole: null as VoiceRoomRole | null,
  myState: null as VoiceParticipantState | null,
  muted: false,
  handRaised: false,
  private: true,
});

const roomChannel = (roomId: string) => `voice:${roomId}`;

const emitRoom = (deps: VoiceRoomsDeps, room: VoiceRoom) => {
  deps.io.to(roomChannel(room.id)).emit('voice:room', { room: publicRoomPreview(room) });
};

const emitParticipants = async (deps: VoiceRoomsDeps, roomId: string, delta?: VoiceRoomParticipant | null) => {
  const participants = await readParticipants(deps, { roomId, state: 'active' });
  const users = await deps.readUsers();
  const byId = new Map(users.map((user) => [user.id, user]));
  const enriched = participants.map((item) => ({
    ...item,
    name: byId.get(item.userId)?.name || '',
    avatar: byId.get(item.userId)?.avatar || '',
  }));
  deps.io.to(roomChannel(roomId)).emit('voice:participants', {
    roomId,
    participants: enriched,
    delta: delta
      ? {
          ...delta,
          name: byId.get(delta.userId)?.name || '',
          avatar: byId.get(delta.userId)?.avatar || '',
        }
      : null,
  });
};

const emitEnded = (deps: VoiceRoomsDeps, room: VoiceRoom) => {
  deps.io.to(roomChannel(room.id)).emit('voice:ended', {
    roomId: room.id,
    room: publicRoomPreview(room),
  });
};

const emitToUser = (deps: VoiceRoomsDeps, userId: string, event: string, payload: unknown) => {
  deps.io.to(`user:${userId}`).emit(event, payload);
};

async function endRoom(
  deps: VoiceRoomsDeps,
  room: VoiceRoom,
  actorUserId: string,
  detail: string,
) {
  const stamp = nowIso();
  const next: VoiceRoom = {
    ...room,
    status: 'ended',
    endedAt: stamp,
    updatedAt: stamp,
    recordingEnabled: false,
  };
  await saveRoom(deps, next);

  const active = await readParticipants(deps, { roomId: room.id, state: 'active' });
  for (const participant of active) {
    await saveParticipant(deps, {
      ...participant,
      state: 'left',
      leftAt: stamp,
      handRaised: false,
      handRaisedAt: null,
    });
  }

  await appendAudit(deps, {
    roomId: room.id,
    actorUserId,
    action: 'room.ended',
    detail,
  });
  emitEnded(deps, next);
  emitRoom(deps, next);
  return next;
}

/**
 * Host-leave policy:
 * 1. Prefer transfer host to an active moderator (oldest joined).
 * 2. Else transfer to an active speaker (oldest joined).
 * 3. Else end the room safely (no remaining publishers / sole host).
 */
async function transferHostOrEnd(
  deps: VoiceRoomsDeps,
  room: VoiceRoom,
  leavingHost: VoiceRoomParticipant,
) {
  const stamp = nowIso();
  const active = (await readParticipants(deps, { roomId: room.id, state: 'active' }))
    .filter((item) => item.userId !== leavingHost.userId);

  const successor =
    active
      .filter((item) => item.role === 'moderator')
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]
    || active
      .filter((item) => item.role === 'speaker')
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]
    || null;

  const leftHost: VoiceRoomParticipant = {
    ...leavingHost,
    state: 'left',
    leftAt: stamp,
    handRaised: false,
    handRaisedAt: null,
    muted: true,
  };
  await saveParticipant(deps, leftHost);

  if (!successor) {
    return {
      room: await endRoom(deps, room, leavingHost.userId, 'Host left with no successor'),
      participant: leftHost,
      transferred: false as const,
    };
  }

  const promoted: VoiceRoomParticipant = {
    ...successor,
    role: 'host',
    muted: false,
    forceMuted: false,
    handRaised: false,
    handRaisedAt: null,
  };
  await saveParticipant(deps, promoted);

  const nextRoom: VoiceRoom = {
    ...room,
    hostUserId: promoted.userId,
    updatedAt: stamp,
    recordingEnabled: false,
  };
  await saveRoom(deps, nextRoom);

  await appendAudit(deps, {
    roomId: room.id,
    actorUserId: leavingHost.userId,
    action: 'host.transferred',
    detail: `Host left; transferred to ${promoted.userId}`,
    targetUserId: promoted.userId,
  });

  emitRoom(deps, nextRoom);
  await emitParticipants(deps, room.id, promoted);
  emitToUser(deps, promoted.userId, 'voice:room', {
    room: publicRoomPreview(nextRoom, promoted),
    action: 'host_transferred',
  });

  return { room: nextRoom, participant: leftHost, transferred: true as const, successor: promoted };
}

async function assertCanJoin(
  deps: VoiceRoomsDeps,
  room: VoiceRoom,
  userId: string,
  inviteToken?: string,
): Promise<{ ok: true; invite?: VoiceRoomInvite | null } | { ok: false; status: number; error: string }> {
  if (room.status !== 'live') {
    return { ok: false, status: 410, error: 'This voice room has ended.' };
  }

  const existing = await findParticipant(deps, room.id, userId);
  if (existing?.blocked || existing?.state === 'blocked') {
    return { ok: false, status: 403, error: 'You are blocked from this voice room.' };
  }

  let invite: VoiceRoomInvite | null = null;
  if (inviteToken) {
    invite = await findInviteByToken(deps, inviteToken);
    if (!invite || invite.roomId !== room.id) {
      return { ok: false, status: 404, error: 'Invite not found' };
    }
    if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
      return { ok: false, status: 410, error: 'This invite has expired.' };
    }
    if (invite.maxUses != null && invite.uses >= invite.maxUses) {
      return { ok: false, status: 410, error: 'This invite has been used up.' };
    }
  }

  if (room.privacy === 'private' || room.privacy === 'invite-only') {
    const isHost = room.hostUserId === userId;
    const wasActive = existing?.state === 'active';
    if (!isHost && !wasActive && !invite) {
      return {
        ok: false,
        status: 403,
        error: room.privacy === 'invite-only'
          ? 'An invite is required to join this room.'
          : 'This voice room is private.',
      };
    }
  }

  if (existing?.state === 'active') {
    return { ok: true, invite };
  }

  const active = await readParticipants(deps, { roomId: room.id, state: 'active' });
  if (countActiveListeners(active) >= room.capacityListeners) {
    return { ok: false, status: 409, error: 'This voice room is full.' };
  }

  return { ok: true, invite };
}

async function joinAsListener(
  deps: VoiceRoomsDeps,
  room: VoiceRoom,
  userId: string,
  invite?: VoiceRoomInvite | null,
) {
  const stamp = nowIso();
  const existing = await findParticipant(deps, room.id, userId);
  // Invite role hint is stored for audit/future use; MVP always joins as listener
  // (muted). Host/mod must approve before anyone publishes.
  void invite?.role;

  const participant: VoiceRoomParticipant = {
    id: existing?.id || newId('vrp'),
    roomId: room.id,
    userId,
    role: 'listener',
    handRaised: false,
    handRaisedAt: null,
    muted: true,
    forceMuted: false,
    blocked: false,
    joinedAt: stamp,
    leftAt: null,
    state: 'active',
  };
  await saveParticipant(deps, participant);

  if (invite) {
    await saveInvite(deps, { ...invite, uses: invite.uses + 1 });
  }

  await appendAudit(deps, {
    roomId: room.id,
    actorUserId: userId,
    action: 'participant.joined',
    detail: 'Joined as listener',
  });

  emitRoom(deps, room);
  await emitParticipants(deps, room.id, participant);
  return participant;
}

const requireLiveRoom = async (deps: VoiceRoomsDeps, roomId: string) => {
  const room = await findRoom(deps, roomId);
  if (!room) return { error: { status: 404, message: 'Voice room not found' } as const };
  if (room.status !== 'live') return { error: { status: 410, message: 'This voice room has ended.' } as const };
  return { room };
};

const requireActive = async (deps: VoiceRoomsDeps, roomId: string, userId: string) => {
  const participant = activeParticipant(await findParticipant(deps, roomId, userId));
  if (!participant) return { error: { status: 403, message: 'You are not in this voice room.' } as const };
  return { participant };
};

export const mountVoiceRooms = (app: Express, deps: VoiceRoomsDeps) => {
  // --- REST -----------------------------------------------------------------

  app.get('/api/voice-rooms', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const rooms = await readAllRooms(deps);
    const mine: ReturnType<typeof publicRoomPreview>[] = [];
    const livePublic: ReturnType<typeof publicRoomPreview>[] = [];

    for (const room of rooms) {
      if (room.status !== 'live') continue;
      const participant = await findParticipant(deps, room.id, userId);
      const inRoom = Boolean(activeParticipant(participant)) || room.hostUserId === userId;
      if (inRoom) {
        mine.push(publicRoomPreview(room, participant));
      }
      if (room.privacy === 'public') {
        livePublic.push(publicRoomPreview(room, participant));
      }
      // Private / invite-only: never appear in the public discover list.
    }

    return res.json({ mine, livePublic });
  });

  app.post('/api/voice-rooms', async (req, res) => {
    const parseResult = createRoomSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Enter a room title and valid settings.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const host = (await deps.readUsers()).find((user) => user.id === userId);
    if (!host) return res.status(404).json({ error: 'Account not found' });

    const stamp = nowIso();
    const room: VoiceRoom = {
      id: newId('vr'),
      title: parseResult.data.title,
      description: parseResult.data.description || '',
      rules: parseResult.data.rules || '',
      privacy: parseResult.data.privacy || 'public',
      communityId: parseResult.data.communityId || null,
      hostUserId: userId,
      status: 'live',
      capacityListeners: parseResult.data.capacity?.listeners ?? DEFAULT_CAPACITY_LISTENERS,
      capacitySpeakers: Math.min(
        parseResult.data.capacity?.speakers ?? DEFAULT_CAPACITY_SPEAKERS,
        DEFAULT_CAPACITY_SPEAKERS,
      ),
      recordingEnabled: false,
      createdAt: stamp,
      endedAt: null,
      updatedAt: stamp,
    };
    await saveRoom(deps, room);

    const hostParticipant: VoiceRoomParticipant = {
      id: newId('vrp'),
      roomId: room.id,
      userId,
      role: 'host',
      handRaised: false,
      handRaisedAt: null,
      muted: false,
      forceMuted: false,
      blocked: false,
      joinedAt: stamp,
      leftAt: null,
      state: 'active',
    };
    await saveParticipant(deps, hostParticipant);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: userId,
      action: 'room.created',
      detail: `Created voice room "${room.title}"`,
    });

    emitToUser(deps, userId, 'voice:room', {
      room: publicRoomPreview(room, hostParticipant),
      action: 'created',
    });

    return res.status(201).json({
      room: publicRoomPreview(room, hostParticipant),
      participant: hostParticipant,
    });
  });

  app.get('/api/voice-rooms/:id', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const room = await findRoom(deps, param(req.params.id));
    if (!room) return res.status(404).json({ error: 'Voice room not found' });

    const participant = userId ? await findParticipant(deps, room.id, userId) : null;
    const inRoom = Boolean(activeParticipant(participant)) || room.hostUserId === userId;

    if (room.privacy !== 'public' && !inRoom) {
      return res.json({ room: privateRoomTeaser(room) });
    }

    return res.json({
      room: {
        ...publicRoomPreview(room, participant),
        rules: inRoom || room.privacy === 'public' ? room.rules : '',
      },
    });
  });

  app.post('/api/voice-rooms/:id/join', async (req, res) => {
    const parseResult = joinSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid join payload.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const roomId = param(req.params.id);
    const roomResult = await requireLiveRoom(deps, roomId);
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;

    const existing = activeParticipant(await findParticipant(deps, room.id, userId));
    if (existing) {
      return res.json({ room: publicRoomPreview(room, existing), participant: existing, alreadyJoined: true });
    }

    const gate = await assertCanJoin(deps, room, userId, parseResult.data.inviteToken);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const participant = await joinAsListener(deps, room, userId, gate.invite);
    return res.status(201).json({ room: publicRoomPreview(room, participant), participant });
  });

  app.post('/api/voice-rooms/:id/leave', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid leave payload.' });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const roomId = param(req.params.id);
    const room = await findRoom(deps, roomId);
    if (!room) return res.status(404).json({ error: 'Voice room not found' });

    const participant = activeParticipant(await findParticipant(deps, room.id, userId));
    if (!participant) {
      return res.json({ ok: true, alreadyLeft: true });
    }

    if (participant.role === 'host' && room.status === 'live') {
      const result = await transferHostOrEnd(deps, room, participant);
      return res.json({
        ok: true,
        room: publicRoomPreview(result.room),
        participant: result.participant,
        hostTransferred: result.transferred,
        ended: result.room.status === 'ended',
      });
    }

    const stamp = nowIso();
    const next: VoiceRoomParticipant = {
      ...participant,
      state: 'left',
      leftAt: stamp,
      handRaised: false,
      handRaisedAt: null,
      muted: true,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: userId,
      action: 'participant.left',
      detail: `Left as ${participant.role}`,
    });
    await emitParticipants(deps, room.id, next);
    return res.json({ ok: true, room: publicRoomPreview(room, next), participant: next });
  });

  app.post('/api/voice-rooms/:id/end', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid end payload.' });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, userId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can end this room.' });
    }

    const ended = await endRoom(deps, room, userId, `Ended by ${actor.participant!.role}`);
    return res.json({ ok: true, room: publicRoomPreview(ended) });
  });

  app.post('/api/voice-rooms/:id/raise-hand', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, userId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    const participant = actor.participant!;
    if (isPublisherRole(participant.role)) {
      return res.status(400).json({ error: 'You already have a speaker seat.' });
    }

    const stamp = nowIso();
    const next: VoiceRoomParticipant = {
      ...participant,
      handRaised: true,
      handRaisedAt: stamp,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: userId,
      action: 'hand.raised',
      detail: 'Raised hand',
    });
    await emitParticipants(deps, room.id, next);
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/lower-hand', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, userId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }

    const next: VoiceRoomParticipant = {
      ...actor.participant!,
      handRaised: false,
      handRaisedAt: null,
    };
    await saveParticipant(deps, next);
    await emitParticipants(deps, room.id, next);
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/speakers/:userId/approve', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, actorId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can approve speakers.' });
    }

    const targetUserId = param(req.params.userId);
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });
    if (isPublisherRole(target.role)) {
      return res.json({ participant: target, alreadySpeaker: true });
    }

    const active = await readParticipants(deps, { roomId: room.id, state: 'active' });
    if (countActivePublishers(active) >= room.capacitySpeakers) {
      return res.status(409).json({
        error: `Speaker capacity reached (${room.capacitySpeakers}). Demote someone first.`,
      });
    }

    const next: VoiceRoomParticipant = {
      ...target,
      role: 'speaker',
      handRaised: false,
      handRaisedAt: null,
      muted: false,
      forceMuted: false,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: 'speaker.approved',
      detail: 'Promoted listener to speaker',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    emitToUser(deps, targetUserId, 'voice:room', {
      room: publicRoomPreview(room, next),
      action: 'speaker_approved',
    });
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/speakers/:userId/reject', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, actorId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can reject raised hands.' });
    }

    const targetUserId = param(req.params.userId);
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });

    const next: VoiceRoomParticipant = {
      ...target,
      handRaised: false,
      handRaisedAt: null,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: 'hand.rejected',
      detail: 'Cleared raised hand',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/speakers/:userId/demote', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, actorId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can demote speakers.' });
    }

    const targetUserId = param(req.params.userId);
    if (targetUserId === room.hostUserId) {
      return res.status(400).json({ error: 'Cannot demote the host. Transfer host or end the room.' });
    }
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });
    if (target.role === 'host') {
      return res.status(400).json({ error: 'Cannot demote the host.' });
    }
    if (target.role === 'moderator' && actor.participant!.role !== 'host') {
      return res.status(403).json({ error: 'Only the host can demote a moderator.' });
    }

    const next: VoiceRoomParticipant = {
      ...target,
      role: 'listener',
      muted: true,
      forceMuted: true,
      handRaised: false,
      handRaisedAt: null,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: 'speaker.demoted',
      detail: 'Demoted to listener (force muted)',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    emitToUser(deps, targetUserId, 'voice:room', {
      room: publicRoomPreview(room, next),
      action: 'speaker_demoted',
    });
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/participants/:userId/mute', async (req, res) => {
    const parseResult = muteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid mute payload.', details: z.flattenError(parseResult.error) });
    }
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const targetUserId = param(req.params.userId);
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });

    const actor = activeParticipant(await findParticipant(deps, room.id, actorId));
    if (!actor) return res.status(403).json({ error: 'You are not in this voice room.' });

    const wantMuted = parseResult.data.muted;
    const isSelf = actorId === targetUserId;

    if (isSelf) {
      // Listeners cannot unmute. Speakers may unmute unless forceMuted.
      if (!wantMuted) {
        if (!isPublisherRole(target.role)) {
          return res.status(403).json({ error: 'Listeners cannot unmute.' });
        }
        if (target.forceMuted) {
          return res.status(403).json({ error: 'You were muted by the host and cannot unmute yet.' });
        }
      }
      const next: VoiceRoomParticipant = {
        ...target,
        muted: wantMuted,
        forceMuted: wantMuted ? target.forceMuted : false,
      };
      await saveParticipant(deps, next);
      await emitParticipants(deps, room.id, next);
      return res.json({ participant: next });
    }

    if (!canModerate(actor.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can mute others.' });
    }
    if (target.role === 'host' && actor.role !== 'host') {
      return res.status(403).json({ error: 'Cannot mute the host.' });
    }

    const next: VoiceRoomParticipant = {
      ...target,
      muted: wantMuted,
      forceMuted: wantMuted,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: wantMuted ? 'participant.muted' : 'participant.unmuted',
      detail: wantMuted ? 'Force muted' : 'Cleared force mute',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/participants/:userId/remove', async (req, res) => {
    const parseResult = removeSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid remove payload.', details: z.flattenError(parseResult.error) });
    }
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, actorId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can remove participants.' });
    }

    const targetUserId = param(req.params.userId);
    if (targetUserId === room.hostUserId || targetUserId === actorId) {
      return res.status(400).json({ error: 'Cannot remove the host (or yourself). Use leave/end instead.' });
    }
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });
    if (target.role === 'moderator' && actor.participant!.role !== 'host') {
      return res.status(403).json({ error: 'Only the host can remove a moderator.' });
    }

    const stamp = nowIso();
    const block = Boolean(parseResult.data.block);
    const next: VoiceRoomParticipant = {
      ...target,
      state: block ? 'blocked' : 'removed',
      blocked: block || target.blocked,
      leftAt: stamp,
      handRaised: false,
      handRaisedAt: null,
      muted: true,
      forceMuted: true,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: block ? 'participant.blocked' : 'participant.removed',
      detail: block ? 'Removed and blocked' : 'Removed from room',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    emitToUser(deps, targetUserId, 'voice:room', {
      room: publicRoomPreview(room, next),
      action: block ? 'blocked' : 'removed',
    });
    deps.io.in(roomChannel(room.id)).fetchSockets().then((sockets) => {
      for (const sock of sockets) {
        if (sock.data?.voiceUserId === targetUserId && sock.data?.voiceRoomId === room.id) {
          sock.leave(roomChannel(room.id));
          sock.data.voiceRoomId = undefined;
        }
      }
    }).catch(() => undefined);
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/moderators/:userId', async (req, res) => {
    const parseResult = moderatorSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid payload.' });
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    if (room.hostUserId !== actorId) {
      return res.status(403).json({ error: 'Only the host can appoint moderators.' });
    }

    const targetUserId = param(req.params.userId);
    const target = activeParticipant(await findParticipant(deps, room.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Participant not found' });
    if (target.role === 'host') {
      return res.status(400).json({ error: 'Host is already the room host.' });
    }

    // Moderator seat counts toward speaker capacity (publisher-capable).
    if (target.role === 'listener') {
      const active = await readParticipants(deps, { roomId: room.id, state: 'active' });
      if (countActivePublishers(active) >= room.capacitySpeakers) {
        return res.status(409).json({
          error: `Speaker capacity reached (${room.capacitySpeakers}). Demote someone first.`,
        });
      }
    }

    const next: VoiceRoomParticipant = {
      ...target,
      role: 'moderator',
      handRaised: false,
      handRaisedAt: null,
      muted: false,
      forceMuted: false,
    };
    await saveParticipant(deps, next);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: actorId,
      action: 'moderator.appointed',
      detail: 'Appointed moderator',
      targetUserId,
    });
    await emitParticipants(deps, room.id, next);
    emitToUser(deps, targetUserId, 'voice:room', {
      room: publicRoomPreview(room, next),
      action: 'moderator_appointed',
    });
    return res.json({ participant: next });
  });

  app.post('/api/voice-rooms/:id/invites', async (req, res) => {
    const parseResult = inviteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid invite payload.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const roomResult = await requireLiveRoom(deps, param(req.params.id));
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;
    const actor = await requireActive(deps, room.id, userId);
    if ('error' in actor && actor.error) {
      return res.status(actor.error.status).json({ error: actor.error.message });
    }
    if (!canModerate(actor.participant!.role)) {
      return res.status(403).json({ error: 'Only the host or a moderator can create invites.' });
    }

    const stamp = nowIso();
    const expiresAt = parseResult.data.expiresInHours
      ? new Date(Date.now() + parseResult.data.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;
    const invite: VoiceRoomInvite = {
      id: newId('vrinv'),
      token: crypto.randomBytes(16).toString('hex'),
      roomId: room.id,
      createdByUserId: userId,
      role: parseResult.data.role,
      maxUses: parseResult.data.maxUses ?? null,
      uses: 0,
      expiresAt,
      createdAt: stamp,
    };
    await saveInvite(deps, invite);
    await appendAudit(deps, {
      roomId: room.id,
      actorUserId: userId,
      action: 'invite.created',
      detail: `roleHint=${invite.role}`,
    });
    return res.status(201).json({ invite });
  });

  app.post('/api/voice-rooms/invites/:token/accept', async (req, res) => {
    const parseResult = acceptInviteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid invite accept payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const invite = await findInviteByToken(deps, param(req.params.token));
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
      return res.status(410).json({ error: 'This invite has expired.' });
    }
    if (invite.maxUses != null && invite.uses >= invite.maxUses) {
      return res.status(410).json({ error: 'This invite has been used up.' });
    }

    const roomResult = await requireLiveRoom(deps, invite.roomId);
    if ('error' in roomResult && roomResult.error) {
      return res.status(roomResult.error.status).json({ error: roomResult.error.message });
    }
    const room = roomResult.room!;

    const existing = activeParticipant(await findParticipant(deps, room.id, userId));
    if (existing) {
      return res.json({
        room: publicRoomPreview(room, existing),
        participant: existing,
        alreadyJoined: true,
      });
    }

    const gate = await assertCanJoin(deps, room, userId, invite.token);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const participant = await joinAsListener(deps, room, userId, invite);
    return res.status(201).json({ room: publicRoomPreview(room, participant), participant });
  });

  app.post('/api/voice-rooms/:id/report', async (req, res) => {
    const parseResult = reportSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid report payload.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const room = await findRoom(deps, param(req.params.id));
    if (!room) return res.status(404).json({ error: 'Voice room not found' });

    const audit = await appendAudit(deps, {
      roomId: room.id,
      actorUserId: userId,
      action: 'room.reported',
      detail: parseResult.data.reason,
      targetUserId: parseResult.data.targetUserId ?? null,
    });

    const mods = (await readParticipants(deps, { roomId: room.id, state: 'active' }))
      .filter((item) => canModerate(item.role));
    for (const mod of mods) {
      emitToUser(deps, mod.userId, 'voice:room', {
        room: publicRoomPreview(room),
        action: 'reported',
        report: audit,
      });
    }

    return res.status(201).json({ ok: true, report: audit });
  });

  app.get('/api/voice-rooms/:id/participants', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const room = await findRoom(deps, param(req.params.id));
    if (!room) return res.status(404).json({ error: 'Voice room not found' });

    const viewer = activeParticipant(await findParticipant(deps, room.id, userId));
    if (!viewer && room.hostUserId !== userId && room.privacy !== 'public') {
      return res.status(403).json({ error: 'Only participants can view this list.' });
    }

    const participants = await readParticipants(deps, { roomId: room.id, state: 'active' });
    const users = await deps.readUsers();
    const byId = new Map(users.map((user) => [user.id, user]));
    return res.json({
      participants: participants.map((item) => ({
        ...item,
        name: byId.get(item.userId)?.name || '',
        avatar: byId.get(item.userId)?.avatar || '',
      })),
    });
  });

  // --- Socket.IO (separate namespace of events from call:*) -------------------
  registerVoiceSocketHandlers(deps);
};

function registerVoiceSocketHandlers(deps: VoiceRoomsDeps) {
  deps.io.on('connection', (socket: Socket) => {
    socket.on(
      'voice:join',
      async (payload: { roomId?: string; userId?: string } = {}) => {
        try {
          const roomId = String(payload.roomId || '');
          const userId = String(payload.userId || '');
          if (!roomId || !userId) return;

          const room = await findRoom(deps, roomId);
          if (!room || room.status !== 'live') {
            socket.emit('voice:ended', { roomId, reason: 'not_live' });
            return;
          }

          const participant = activeParticipant(await findParticipant(deps, roomId, userId));
          if (!participant) {
            socket.emit('voice:room', {
              room: publicRoomPreview(room),
              action: 'join_rejected',
              error: 'Join via REST first.',
            });
            return;
          }

          socket.join(roomChannel(roomId));
          socket.join(`user:${userId}`);
          socket.data.voiceRoomId = roomId;
          socket.data.voiceUserId = userId;

          socket.emit('voice:room', {
            room: publicRoomPreview(room, participant),
            action: 'joined',
          });
          await emitParticipants(deps, roomId);
        } catch {
          // ignore malformed join
        }
      },
    );

    socket.on(
      'voice:leave',
      async (payload: { roomId?: string; userId?: string } = {}) => {
        try {
          const roomId = String(payload.roomId || socket.data.voiceRoomId || '');
          const userId = String(payload.userId || socket.data.voiceUserId || '');
          if (!roomId) return;

          socket.leave(roomChannel(roomId));
          if (socket.data.voiceRoomId === roomId) {
            socket.data.voiceRoomId = undefined;
          }

          // Soft presence hint for peers (REST leave owns durable state).
          if (userId) {
            socket.to(roomChannel(roomId)).emit('voice:reconnecting', {
              roomId,
              userId,
              hint: 'Peer socket left; client may be reconnecting. Durable leave uses REST /leave.',
            });
          }
        } catch {
          // ignore
        }
      },
    );

    socket.on(
      'voice:signal',
      async (payload: {
        roomId?: string;
        fromUserId?: string;
        toUserId?: string;
        signalType?: 'offer' | 'answer' | 'ice-candidate';
        payload?: unknown;
      } = {}) => {
        try {
          const roomId = String(payload.roomId || '');
          const fromUserId = String(payload.fromUserId || '');
          const toUserId = payload.toUserId ? String(payload.toUserId) : undefined;
          const signalType = payload.signalType;
          if (!roomId || !fromUserId || !signalType) return;

          const room = await findRoom(deps, roomId);
          if (!room || room.status !== 'live') return;

          const from = activeParticipant(await findParticipant(deps, roomId, fromUserId));
          if (!from) return;

          // Non-speakers MUST NOT publish. Reject offers from listeners.
          if (signalType === 'offer' && !isPublisherRole(from.role)) {
            socket.emit('voice:room', {
              room: publicRoomPreview(room, from),
              action: 'signal_rejected',
              error: 'Listeners cannot publish audio offers.',
            });
            return;
          }

          // Answers/ICE: allow from any active participant so listeners can be
          // recvonly peers. Offers only from publishers (above).
          if (toUserId) {
            const to = activeParticipant(await findParticipant(deps, roomId, toUserId));
            if (!to) return;
            // Publisher→anyone OK; listener→publisher only for answer/ice.
            if (!isPublisherRole(from.role) && !isPublisherRole(to.role)) {
              return;
            }
          } else if (!isPublisherRole(from.role)) {
            // Broadcast without target only allowed for publishers.
            return;
          }

          const event = {
            roomId,
            fromUserId,
            toUserId,
            signalType,
            payload: payload.payload,
          };

          if (toUserId) {
            deps.io.to(`user:${toUserId}`).emit('voice:signal', event);
          } else {
            socket.to(roomChannel(roomId)).emit('voice:signal', event);
          }
        } catch {
          // ignore
        }
      },
    );

    socket.on('disconnect', () => {
      const roomId = socket.data.voiceRoomId as string | undefined;
      const userId = socket.data.voiceUserId as string | undefined;
      if (roomId && userId) {
        // Hint only — durable leave is REST. Clients should show "Reconnecting…".
        socket.to(roomChannel(roomId)).emit('voice:reconnecting', {
          roomId,
          userId,
          hint: 'Socket disconnected; client should show reconnecting and re-emit voice:join.',
        });
      }
    });
  });
}
