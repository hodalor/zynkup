import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type CommunityPrivacy = 'public' | 'private' | 'invite-only';
export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';
export type MembershipState = 'active' | 'pending' | 'banned' | 'left';
export type ModerationState = 'pending' | 'reviewed' | 'dismissed' | 'actioned';

export type CommunityRoomPermissions = {
  /** Roles allowed to view this room. Empty = all active members. */
  viewRoles: CommunityRole[];
  /** Roles allowed to post. Empty = all active members. */
  postRoles: CommunityRole[];
};

export type Community = {
  id: string;
  name: string;
  description: string;
  rules: string;
  privacy: CommunityPrivacy;
  avatarUrl: string;
  ownerUserId: string;
  pinnedRules: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CommunityMembership = {
  id: string;
  communityId: string;
  userId: string;
  role: CommunityRole;
  state: MembershipState;
  muted: boolean;
  mutedAt?: string | null;
  joinedAt?: string | null;
  leftAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityRoom = {
  id: string;
  communityId: string;
  chatId: string;
  title: string;
  topic: string;
  permissions: CommunityRoomPermissions;
  pinnedRules: string;
  isAnnouncement: boolean;
  /** When true, members may send messages marked anonymous in this room. Default false. */
  allowAnonymous: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityInvite = {
  id: string;
  communityId: string;
  token: string;
  createdByUserId: string;
  role: CommunityRole;
  maxUses: number | null;
  uses: number;
  expiresAt: string | null;
  createdAt: string;
};

export type CommunityJoinRequest = {
  id: string;
  communityId: string;
  userId: string;
  note: string;
  state: 'pending' | 'approved' | 'rejected';
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityReport = {
  id: string;
  communityId: string;
  roomId?: string | null;
  messageId?: string | null;
  reporterUserId: string;
  reason: string;
  targetUserId?: string | null;
  state: ModerationState;
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunityAuditEvent = {
  id: string;
  communityId: string;
  actorUserId: string;
  action: string;
  detail: string;
  targetUserId?: string | null;
  roomId?: string | null;
  messageId?: string | null;
  chatId?: string | null;
  createdAt: string;
};

export type CommunityChat = {
  id: string;
  title: string;
  kind: 'group';
  participants: string[];
  adminIds?: string[];
  unreadCount: number;
  unreadByUser?: Record<string, number>;
  lastMessagePreview: string;
  updatedAt: string;
  space?: string;
  communityId?: string;
  /** Synced from linked community room; default false for non-community groups. */
  allowAnonymous?: boolean;
};

export type CommunitiesDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readUsers: () => Promise<Array<{ id: string; name: string; avatar?: string }>>;
  usersHaveBlock: (leftUserId: string, rightUserId: string) => Promise<boolean>;
  saveChatRecord: (chat: CommunityChat) => Promise<CommunityChat>;
  readChats: () => Promise<CommunityChat[]>;
  deleteChatById?: (chatId: string) => Promise<void>;
};

const ROLE_RANK: Record<CommunityRole, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

const ALL_ROLES: CommunityRole[] = ['owner', 'admin', 'moderator', 'member'];
const ADMIN_PLUS: CommunityRole[] = ['owner', 'admin'];

const seedCommunities: Community[] = [];
const seedMemberships: CommunityMembership[] = [];
const seedRooms: CommunityRoom[] = [];
const seedInvites: CommunityInvite[] = [];
const seedJoinRequests: CommunityJoinRequest[] = [];
const seedReports: CommunityReport[] = [];
const seedAudit: CommunityAuditEvent[] = [];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;

const roleAtLeast = (role: CommunityRole, minimum: CommunityRole) => ROLE_RANK[role] >= ROLE_RANK[minimum];

const defaultRoomPermissions = (isAnnouncement: boolean): CommunityRoomPermissions => ({
  viewRoles: [],
  postRoles: isAnnouncement ? [...ADMIN_PLUS] : [],
});

const createCommunitySchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional().default(''),
  rules: z.string().trim().max(4000).optional().default(''),
  privacy: z.enum(['public', 'private', 'invite-only']).default('public'),
  avatarUrl: z.string().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    'Avatar must be an uploaded https URL',
  ).optional().default(''),
});

const updateCommunitySchema = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  rules: z.string().trim().max(4000).optional(),
  privacy: z.enum(['public', 'private', 'invite-only']).optional(),
  avatarUrl: z.string().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    'Avatar must be an uploaded https URL',
  ).optional(),
  pinnedRules: z.boolean().optional(),
});

const joinSchema = z.object({
  userId: z.string().min(1).optional(),
  note: z.string().trim().max(280).optional().default(''),
  inviteToken: z.string().min(6).max(80).optional(),
});

const leaveSchema = z.object({
  userId: z.string().min(1).optional(),
});

const inviteSchema = z.object({
  userId: z.string().min(1).optional(),
  role: z.enum(['admin', 'moderator', 'member']).optional().default('member'),
  maxUses: z.number().int().min(1).max(10000).nullable().optional(),
  expiresInHours: z.number().int().min(1).max(24 * 90).optional(),
});

const acceptInviteSchema = z.object({
  userId: z.string().min(1).optional(),
});

const setRoleSchema = z.object({
  userId: z.string().min(1).optional(),
  role: z.enum(['admin', 'moderator', 'member']),
});

const removeMemberSchema = z.object({
  userId: z.string().min(1).optional(),
});

const reviewJoinSchema = z.object({
  userId: z.string().min(1).optional(),
});

const createRoomSchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(80),
  topic: z.string().trim().max(200).optional().default(''),
  isAnnouncement: z.boolean().optional().default(false),
  allowAnonymous: z.boolean().optional().default(false),
  pinnedRules: z.string().trim().max(2000).optional().default(''),
  permissions: z.object({
    viewRoles: z.array(z.enum(['owner', 'admin', 'moderator', 'member'])).optional(),
    postRoles: z.array(z.enum(['owner', 'admin', 'moderator', 'member'])).optional(),
  }).optional(),
});

const updateRoomSchema = z.object({
  userId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().max(200).optional(),
  pinnedRules: z.string().trim().max(2000).optional(),
  isAnnouncement: z.boolean().optional(),
  allowAnonymous: z.boolean().optional(),
  permissions: z.object({
    viewRoles: z.array(z.enum(['owner', 'admin', 'moderator', 'member'])).optional(),
    postRoles: z.array(z.enum(['owner', 'admin', 'moderator', 'member'])).optional(),
  }).optional(),
});

const muteSchema = z.object({
  userId: z.string().min(1).optional(),
  muted: z.boolean().optional().default(true),
});

const reportSchema = z.object({
  userId: z.string().min(1).optional(),
  reason: z.string().trim().min(4).max(280),
  roomId: z.string().min(1).max(80).optional(),
  messageId: z.string().min(1).max(80).optional(),
  targetUserId: z.string().min(1).max(80).optional(),
});

const moderationReviewSchema = z.object({
  userId: z.string().min(1).optional(),
  state: z.enum(['reviewed', 'dismissed', 'actioned']),
  reviewNote: z.string().trim().max(280).optional().default(''),
});

const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

async function readAllCommunities(deps: CommunitiesDeps) {
  const db = await deps.getDb();
  if (!db) return [...seedCommunities];
  return db.collection<Community>('communities').find({}, { projection: { _id: 0 } }).toArray();
}

async function findCommunity(deps: CommunitiesDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedCommunities.find((item) => item.id === id) ?? null;
  return db.collection<Community>('communities').findOne({ id }, { projection: { _id: 0 } });
}

async function saveCommunity(deps: CommunitiesDeps, community: Community) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedCommunities, community);
  await db.collection<Community>('communities').updateOne({ id: community.id }, { $set: community }, { upsert: true });
  return community;
}

async function readMemberships(deps: CommunitiesDeps, filter: Partial<CommunityMembership> = {}) {
  const db = await deps.getDb();
  if (!db) {
    return seedMemberships.filter((item) =>
      Object.entries(filter).every(([key, value]) => (item as Record<string, unknown>)[key] === value));
  }
  return db.collection<CommunityMembership>('communityMembers').find(filter as DocumentLike, { projection: { _id: 0 } }).toArray();
}

type DocumentLike = Record<string, unknown>;

async function findMembership(deps: CommunitiesDeps, communityId: string, userId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedMemberships.find((item) => item.communityId === communityId && item.userId === userId) ?? null;
  }
  return db.collection<CommunityMembership>('communityMembers').findOne(
    { communityId, userId },
    { projection: { _id: 0 } },
  );
}

async function saveMembership(deps: CommunitiesDeps, membership: CommunityMembership) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedMemberships, membership);
  await db.collection<CommunityMembership>('communityMembers').updateOne(
    { id: membership.id },
    { $set: membership },
    { upsert: true },
  );
  return membership;
}

const withRoomDefaults = (room: CommunityRoom): CommunityRoom => ({
  ...room,
  allowAnonymous: Boolean(room.allowAnonymous),
  permissions: room.permissions ?? { viewRoles: [], postRoles: [] },
});

async function readRooms(deps: CommunitiesDeps, communityId: string) {
  const db = await deps.getDb();
  const rooms = !db
    ? seedRooms.filter((item) => item.communityId === communityId)
    : await db.collection<CommunityRoom>('communityRooms').find({ communityId }, { projection: { _id: 0 } }).toArray();
  return rooms.map(withRoomDefaults);
}

async function findRoom(deps: CommunitiesDeps, communityId: string, roomId: string) {
  const db = await deps.getDb();
  const room = !db
    ? seedRooms.find((item) => item.communityId === communityId && item.id === roomId) ?? null
    : await db.collection<CommunityRoom>('communityRooms').findOne(
      { communityId, id: roomId },
      { projection: { _id: 0 } },
    );
  return room ? withRoomDefaults(room) : null;
}

async function findRoomByChatId(deps: CommunitiesDeps, chatId: string) {
  const db = await deps.getDb();
  const room = !db
    ? seedRooms.find((item) => item.chatId === chatId) ?? null
    : await db.collection<CommunityRoom>('communityRooms').findOne({ chatId }, { projection: { _id: 0 } });
  return room ? withRoomDefaults(room) : null;
}

async function saveRoom(deps: CommunitiesDeps, room: CommunityRoom) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedRooms, room);
  await db.collection<CommunityRoom>('communityRooms').updateOne({ id: room.id }, { $set: room }, { upsert: true });
  return room;
}

async function saveInvite(deps: CommunitiesDeps, invite: CommunityInvite) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedInvites, invite);
  await db.collection<CommunityInvite>('communityInvites').updateOne({ id: invite.id }, { $set: invite }, { upsert: true });
  return invite;
}

async function findInviteByToken(deps: CommunitiesDeps, token: string) {
  const db = await deps.getDb();
  if (!db) return seedInvites.find((item) => item.token === token) ?? null;
  return db.collection<CommunityInvite>('communityInvites').findOne({ token }, { projection: { _id: 0 } });
}

async function saveJoinRequest(deps: CommunitiesDeps, request: CommunityJoinRequest) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedJoinRequests, request);
  await db.collection<CommunityJoinRequest>('communityJoinRequests').updateOne(
    { id: request.id },
    { $set: request },
    { upsert: true },
  );
  return request;
}

async function findJoinRequest(deps: CommunitiesDeps, communityId: string, requestId: string) {
  const db = await deps.getDb();
  if (!db) {
    return seedJoinRequests.find((item) => item.communityId === communityId && item.id === requestId) ?? null;
  }
  return db.collection<CommunityJoinRequest>('communityJoinRequests').findOne(
    { communityId, id: requestId },
    { projection: { _id: 0 } },
  );
}

async function saveReport(deps: CommunitiesDeps, report: CommunityReport) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedReports, report);
  await db.collection<CommunityReport>('communityReports').updateOne({ id: report.id }, { $set: report }, { upsert: true });
  return report;
}

async function appendAudit(deps: CommunitiesDeps, event: Omit<CommunityAuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) {
  const row: CommunityAuditEvent = {
    id: event.id || newId('caud'),
    communityId: event.communityId,
    actorUserId: event.actorUserId,
    action: event.action,
    detail: event.detail,
    targetUserId: event.targetUserId ?? null,
    roomId: event.roomId ?? null,
    messageId: event.messageId ?? null,
    chatId: event.chatId ?? null,
    createdAt: event.createdAt || nowIso(),
  };
  const db = await deps.getDb();
  if (!db) {
    seedAudit.unshift(row);
    return row;
  }
  await db.collection<CommunityAuditEvent>('communityAudit').insertOne(row);
  return row;
}

/** Used by message pipeline / moderator reveal flows. */
export const appendCommunityAudit = appendAudit;

export const findCommunityRoomByChatId = findRoomByChatId;

const resolveUserId = async (deps: CommunitiesDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

const activeMembership = (membership: CommunityMembership | null | undefined) =>
  membership?.state === 'active' ? membership : null;

const canViewRoom = (role: CommunityRole, room: CommunityRoom) => {
  const allowed = room.permissions?.viewRoles?.length ? room.permissions.viewRoles : ALL_ROLES;
  return allowed.includes(role);
};

const canPostInRoom = (role: CommunityRole, room: CommunityRoom) => {
  const allowed = room.permissions?.postRoles?.length ? room.permissions.postRoles : ALL_ROLES;
  return allowed.includes(role);
};

const publicPreview = (community: Community, membership?: CommunityMembership | null) => ({
  id: community.id,
  name: community.name,
  description: community.description,
  privacy: community.privacy,
  avatarUrl: community.avatarUrl,
  memberCount: community.memberCount,
  pinnedRules: community.pinnedRules,
  myRole: activeMembership(membership)?.role ?? null,
  myState: membership?.state ?? null,
  muted: Boolean(activeMembership(membership)?.muted),
});

const privateSearchPreview = (community: Community) => ({
  id: community.id,
  name: 'Private community',
  description: '',
  privacy: community.privacy,
  avatarUrl: '',
  memberCount: 0,
  pinnedRules: false,
  myRole: null as CommunityRole | null,
  myState: null as MembershipState | null,
  muted: false,
  private: true,
});

const limitedPrivateDetail = (community: Community, membership?: CommunityMembership | null) => ({
  id: community.id,
  name: community.privacy === 'invite-only' && !membership ? 'Private community' : community.name,
  description: '',
  rules: '',
  privacy: community.privacy,
  avatarUrl: community.privacy === 'public' ? community.avatarUrl : '',
  memberCount: membership?.state === 'active' || membership?.state === 'pending' ? community.memberCount : 0,
  myRole: activeMembership(membership)?.role ?? null,
  myState: membership?.state ?? null,
  muted: Boolean(activeMembership(membership)?.muted),
  limited: true,
});

const emitToMembers = async (
  deps: CommunitiesDeps,
  communityId: string,
  event: string,
  payload: unknown,
  onlyActive = true,
) => {
  const members = await readMemberships(deps, { communityId });
  for (const member of members) {
    if (onlyActive && member.state !== 'active') continue;
    deps.io.to(`user:${member.userId}`).emit(event, payload);
  }
};

const emitToUser = (deps: CommunitiesDeps, userId: string, event: string, payload: unknown) => {
  deps.io.to(`user:${userId}`).emit(event, payload);
};

const recountMembers = async (deps: CommunitiesDeps, community: Community) => {
  const members = await readMemberships(deps, { communityId: community.id, state: 'active' });
  const next = { ...community, memberCount: members.length, updatedAt: nowIso() };
  await saveCommunity(deps, next);
  return next;
};

const createGroupChatForRoom = async (
  deps: CommunitiesDeps,
  input: {
    communityId: string;
    title: string;
    creatorUserId: string;
    participantIds: string[];
    adminIds: string[];
    allowAnonymous?: boolean;
  },
) => {
  const chat: CommunityChat = {
    id: newId('c'),
    title: input.title,
    kind: 'group',
    participants: [...new Set(input.participantIds)],
    adminIds: [...new Set(input.adminIds)],
    unreadCount: 0,
    unreadByUser: {},
    lastMessagePreview: 'Room created',
    updatedAt: nowIso(),
    space: 'personal',
    communityId: input.communityId,
    allowAnonymous: Boolean(input.allowAnonymous),
  };
  return deps.saveChatRecord(chat);
};

const syncRoomParticipants = async (
  deps: CommunitiesDeps,
  communityId: string,
  rooms?: CommunityRoom[],
  memberships?: CommunityMembership[],
) => {
  const roomList = rooms ?? await readRooms(deps, communityId);
  const memberList = memberships ?? await readMemberships(deps, { communityId, state: 'active' });
  const chats = await deps.readChats();
  for (const room of roomList) {
    const chat = chats.find((item) => item.id === room.chatId);
    if (!chat) continue;
    const participants = memberList
      .filter((member) => canViewRoom(member.role, room))
      .map((member) => member.userId);
    const adminIds = memberList
      .filter((member) => roleAtLeast(member.role, 'moderator') && participants.includes(member.userId))
      .map((member) => member.userId);
    const next: CommunityChat = {
      ...chat,
      kind: 'group',
      communityId,
      title: room.title,
      participants: [...new Set(participants)],
      adminIds: adminIds.length ? [...new Set(adminIds)] : chat.adminIds,
      allowAnonymous: Boolean(room.allowAnonymous),
      updatedAt: nowIso(),
    };
    await deps.saveChatRecord(next);
    deps.io.emit('chat:updated', next);
  }
};

const ensureDefaultRooms = async (
  deps: CommunitiesDeps,
  community: Community,
  ownerUserId: string,
) => {
  const existing = await readRooms(deps, community.id);
  if (existing.length) return existing;

  const defaults: Array<{ title: string; topic: string; isAnnouncement: boolean }> = [
    { title: 'Announcements', topic: 'Official updates', isAnnouncement: true },
    { title: 'General', topic: 'Community chat', isAnnouncement: false },
  ];

  const created: CommunityRoom[] = [];
  for (const item of defaults) {
    const chat = await createGroupChatForRoom(deps, {
      communityId: community.id,
      title: item.title,
      creatorUserId: ownerUserId,
      participantIds: [ownerUserId],
      adminIds: [ownerUserId],
    });
    const room: CommunityRoom = {
      id: newId('crm'),
      communityId: community.id,
      chatId: chat.id,
      title: item.title,
      topic: item.topic,
      permissions: defaultRoomPermissions(item.isAnnouncement),
      pinnedRules: item.isAnnouncement ? community.rules : '',
      isAnnouncement: item.isAnnouncement,
      allowAnonymous: false,
      createdByUserId: ownerUserId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    created.push(await saveRoom(deps, room));
    emitToUser(deps, ownerUserId, 'community:room', { communityId: community.id, room, action: 'created' });
    deps.io.emit('chat:created', chat);
  }
  return created;
};

const spamJoinBlocked = async (deps: CommunitiesDeps, communityId: string, userId: string) => {
  const membership = await findMembership(deps, communityId, userId);
  if (!membership?.leftAt) return false;
  const leftAt = Date.parse(membership.leftAt);
  if (Number.isNaN(leftAt)) return false;
  // Rejoin cooldown: 15 minutes after leaving (spam control).
  return Date.now() - leftAt < 15 * 60 * 1000;
};

const spamReportBlocked = async (deps: CommunitiesDeps, reporterUserId: string) => {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const db = await deps.getDb();
  const reports = db
    ? await db.collection<CommunityReport>('communityReports').find({ reporterUserId }, { projection: { _id: 0 } }).toArray()
    : seedReports.filter((item) => item.reporterUserId === reporterUserId);
  const recent = reports.filter((item) => Date.parse(item.createdAt) >= dayAgo);
  return recent.length >= 8;
};

/** Used by message pipeline to enforce announcement / room post roles. */
export const assertCommunityRoomCanPost = async (
  deps: CommunitiesDeps,
  chatId: string,
  senderId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  const room = await findRoomByChatId(deps, chatId);
  if (!room) return { ok: true };
  const membership = activeMembership(await findMembership(deps, room.communityId, senderId));
  if (!membership) {
    return { ok: false, status: 403, error: 'Only community members can post in this room.' };
  }
  if (!canViewRoom(membership.role, room)) {
    return { ok: false, status: 403, error: 'You cannot access this community room.' };
  }
  if (!canPostInRoom(membership.role, room)) {
    return { ok: false, status: 403, error: 'You do not have permission to post in this room.' };
  }
  return { ok: true };
};

/** Moderator+ (or banned check fails) for restricted anonymous author reveal. */
export const actorCanModerateCommunity = async (
  deps: CommunitiesDeps,
  communityId: string,
  userId: string,
): Promise<boolean> => {
  const membership = activeMembership(await findMembership(deps, communityId, userId));
  return Boolean(membership && roleAtLeast(membership.role, 'moderator'));
};

export const mountCommunities = (app: Express, deps: CommunitiesDeps) => {
  app.get('/api/communities/search', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Enter at least 2 characters to search.' });
    }
    const communities = await readAllCommunities(deps);
    const results: unknown[] = [];
    for (const community of communities) {
      const membership = userId ? await findMembership(deps, community.id, userId) : null;
      const isMember = Boolean(activeMembership(membership));
      const nameHit = community.name.toLowerCase().includes(q);
      const descHit = community.description.toLowerCase().includes(q);
      if (community.privacy === 'public') {
        if (nameHit || descHit) results.push(publicPreview(community, membership));
        continue;
      }
      if (isMember) {
        if (nameHit || descHit) results.push(publicPreview(community, membership));
        continue;
      }
      // Private / invite-only: never leak description or real name content in search.
      if (nameHit) results.push(privateSearchPreview(community));
    }
    return res.json({ communities: results.slice(0, 40) });
  });

  app.get('/api/communities/moderation/queue', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const myMods = (await readMemberships(deps, { userId, state: 'active' }))
      .filter((item) => roleAtLeast(item.role, 'moderator'));
    const managedIds = new Set(myMods.map((item) => item.communityId));
    if (!managedIds.size) {
      return res.json({ reports: [], audit: [] });
    }

    const db = await deps.getDb();
    const reports = db
      ? await db.collection<CommunityReport>('communityReports')
        .find({ communityId: { $in: [...managedIds] }, state: 'pending' }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
      : seedReports.filter((item) => managedIds.has(item.communityId) && item.state === 'pending');

    const audit = db
      ? await db.collection<CommunityAuditEvent>('communityAudit')
        .find({ communityId: { $in: [...managedIds] } }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
      : seedAudit.filter((item) => managedIds.has(item.communityId)).slice(0, 100);

    return res.json({ reports, audit });
  });

  app.post('/api/communities/moderation/:reportId/review', async (req, res) => {
    const parseResult = moderationReviewSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid moderation review.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const reportId = param(req.params.reportId);
    const db = await deps.getDb();
    const report = db
      ? await db.collection<CommunityReport>('communityReports').findOne({ id: reportId }, { projection: { _id: 0 } })
      : seedReports.find((item) => item.id === reportId) ?? null;
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const membership = activeMembership(await findMembership(deps, report.communityId, userId));
    if (!membership || !roleAtLeast(membership.role, 'moderator')) {
      return res.status(403).json({ error: 'Only moderators and admins can review reports.' });
    }

    const next: CommunityReport = {
      ...report,
      state: parseResult.data.state,
      reviewedByUserId: userId,
      reviewedAt: nowIso(),
      reviewNote: parseResult.data.reviewNote || '',
      updatedAt: nowIso(),
    };
    await saveReport(deps, next);
    await appendAudit(deps, {
      communityId: report.communityId,
      actorUserId: userId,
      action: 'report.reviewed',
      detail: `${parseResult.data.state}: ${report.reason}`,
      targetUserId: report.reporterUserId,
    });
    return res.json({ report: next });
  });

  app.post('/api/communities/invites/:token/accept', async (req, res) => {
    const parseResult = acceptInviteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid invite accept payload.' });
    }
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

    const community = await findCommunity(deps, invite.communityId);
    if (!community) return res.status(404).json({ error: 'Community not found' });

    if (await spamJoinBlocked(deps, community.id, userId)) {
      return res.status(429).json({ error: 'Please wait a bit before rejoining this community.' });
    }

    let membership = await findMembership(deps, community.id, userId);
    if (membership?.state === 'banned') {
      return res.status(403).json({ error: 'You are banned from this community.' });
    }
    if (membership?.state === 'active') {
      return res.json({ community: publicPreview(community, membership), membership, alreadyMember: true });
    }

    const stamp = nowIso();
    membership = {
      id: membership?.id || newId('cmem'),
      communityId: community.id,
      userId,
      role: invite.role === 'owner' ? 'member' : invite.role,
      state: 'active',
      muted: false,
      mutedAt: null,
      joinedAt: stamp,
      leftAt: null,
      createdAt: membership?.createdAt || stamp,
      updatedAt: stamp,
    };
    await saveMembership(deps, membership);
    const updatedInvite = { ...invite, uses: invite.uses + 1 };
    await saveInvite(deps, updatedInvite);
    const recounted = await recountMembers(deps, community);
    await syncRoomParticipants(deps, community.id);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'member.joined_invite',
      detail: `Accepted invite as ${membership.role}`,
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      membership,
      action: 'joined',
    });
    emitToUser(deps, userId, 'community:updated', { community: publicPreview(recounted, membership) });
    return res.status(201).json({ community: publicPreview(recounted, membership), membership });
  });

  app.get('/api/communities', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const communities = await readAllCommunities(deps);
    const mine: unknown[] = [];
    const discoverable: unknown[] = [];
    for (const community of communities) {
      const membership = await findMembership(deps, community.id, userId);
      if (membership && (membership.state === 'active' || membership.state === 'pending')) {
        mine.push({
          ...publicPreview(community, membership),
          rules: membership.state === 'active' ? community.rules : '',
        });
      }
      if (community.privacy === 'public') {
        discoverable.push(publicPreview(community, membership));
      }
    }
    return res.json({ mine, discoverable });
  });

  app.post('/api/communities', async (req, res) => {
    const parseResult = createCommunitySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Enter a community name and valid settings.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const owner = (await deps.readUsers()).find((user) => user.id === userId);
    if (!owner) return res.status(404).json({ error: 'Account not found' });

    const stamp = nowIso();
    const community: Community = {
      id: newId('com'),
      name: parseResult.data.name,
      description: parseResult.data.description || '',
      rules: parseResult.data.rules || '',
      privacy: parseResult.data.privacy,
      avatarUrl: parseResult.data.avatarUrl || '',
      ownerUserId: userId,
      pinnedRules: Boolean(parseResult.data.rules),
      memberCount: 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveCommunity(deps, community);

    const membership: CommunityMembership = {
      id: newId('cmem'),
      communityId: community.id,
      userId,
      role: 'owner',
      state: 'active',
      muted: false,
      mutedAt: null,
      joinedAt: stamp,
      leftAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveMembership(deps, membership);
    const rooms = await ensureDefaultRooms(deps, community, userId);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'community.created',
      detail: community.name,
    });
    emitToUser(deps, userId, 'community:updated', { community: publicPreview(community, membership), action: 'created' });
    return res.status(201).json({ community, membership, rooms });
  });

  app.get('/api/communities/:id', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = userId ? await findMembership(deps, community.id, userId) : null;
    const isActive = Boolean(activeMembership(membership));

    if (community.privacy === 'public' || isActive) {
      const rooms = isActive
        ? (await readRooms(deps, community.id)).filter((room) => canViewRoom(membership!.role, room))
        : [];
      return res.json({
        community: {
          ...community,
          myRole: activeMembership(membership)?.role ?? null,
          myState: membership?.state ?? null,
          muted: Boolean(activeMembership(membership)?.muted),
        },
        rooms,
        membership: membership ?? null,
      });
    }

    // Private / invite-only: limited fields only (no rules/description leak for strangers).
    if (membership?.state === 'pending') {
      return res.json({
        community: limitedPrivateDetail(community, membership),
        rooms: [],
        membership,
      });
    }
    return res.json({
      community: limitedPrivateDetail(community, membership),
      rooms: [],
      membership: membership ?? null,
    });
  });

  app.put('/api/communities/:id', async (req, res) => {
    const parseResult = updateCommunitySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid community update.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'admin')) {
      return res.status(403).json({ error: 'Only owners and admins can update community settings.' });
    }

    const next: Community = {
      ...community,
      name: parseResult.data.name ?? community.name,
      description: parseResult.data.description ?? community.description,
      rules: parseResult.data.rules ?? community.rules,
      privacy: parseResult.data.privacy ?? community.privacy,
      avatarUrl: parseResult.data.avatarUrl ?? community.avatarUrl,
      pinnedRules: parseResult.data.pinnedRules ?? community.pinnedRules,
      updatedAt: nowIso(),
    };
    await saveCommunity(deps, next);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'community.updated',
      detail: 'Updated settings/rules',
    });
    await emitToMembers(deps, community.id, 'community:updated', { community: next, action: 'updated' }, false);
    return res.json({ community: next });
  });

  app.post('/api/communities/:id/join', async (req, res) => {
    const parseResult = joinSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid join request.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });

    if (await spamJoinBlocked(deps, community.id, userId)) {
      return res.status(429).json({ error: 'Please wait a bit before rejoining this community.' });
    }

    let membership = await findMembership(deps, community.id, userId);
    if (membership?.state === 'banned') {
      return res.status(403).json({ error: 'You are banned from this community.' });
    }
    if (membership?.state === 'active') {
      return res.json({ community: publicPreview(community, membership), membership, alreadyMember: true });
    }

    if (community.privacy === 'invite-only') {
      if (!parseResult.data.inviteToken) {
        return res.status(403).json({ error: 'This community is invite-only. Use an invite link.' });
      }
      const invite = await findInviteByToken(deps, parseResult.data.inviteToken);
      if (!invite || invite.communityId !== community.id) {
        return res.status(404).json({ error: 'Invite not found' });
      }
      if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
        return res.status(410).json({ error: 'This invite has expired.' });
      }
      if (invite.maxUses != null && invite.uses >= invite.maxUses) {
        return res.status(410).json({ error: 'This invite has been used up.' });
      }
      const stamp = nowIso();
      membership = {
        id: membership?.id || newId('cmem'),
        communityId: community.id,
        userId,
        role: invite.role === 'owner' ? 'member' : invite.role,
        state: 'active',
        muted: false,
        mutedAt: null,
        joinedAt: stamp,
        leftAt: null,
        createdAt: membership?.createdAt || stamp,
        updatedAt: stamp,
      };
      await saveMembership(deps, membership);
      await saveInvite(deps, { ...invite, uses: invite.uses + 1 });
      const recounted = await recountMembers(deps, community);
      await syncRoomParticipants(deps, community.id);
      await appendAudit(deps, {
        communityId: community.id,
        actorUserId: userId,
        action: 'member.joined_invite',
        detail: `Joined via invite as ${membership.role}`,
      });
      await emitToMembers(deps, community.id, 'community:membership', {
        communityId: community.id,
        membership,
        action: 'joined',
      });
      return res.status(201).json({ community: publicPreview(recounted, membership), membership });
    }

    if (community.privacy === 'private') {
      const db = await deps.getDb();
      const existingPending = db
        ? await db.collection<CommunityJoinRequest>('communityJoinRequests').findOne(
          { communityId: community.id, userId, state: 'pending' },
          { projection: { _id: 0 } },
        )
        : seedJoinRequests.find((item) => item.communityId === community.id && item.userId === userId && item.state === 'pending') ?? null;
      if (existingPending) {
        return res.json({ request: existingPending, pending: true });
      }
      const stamp = nowIso();
      const request: CommunityJoinRequest = {
        id: newId('cjr'),
        communityId: community.id,
        userId,
        note: parseResult.data.note || '',
        state: 'pending',
        reviewedByUserId: null,
        reviewedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await saveJoinRequest(deps, request);
      membership = {
        id: membership?.id || newId('cmem'),
        communityId: community.id,
        userId,
        role: 'member',
        state: 'pending',
        muted: false,
        mutedAt: null,
        joinedAt: null,
        leftAt: null,
        createdAt: membership?.createdAt || stamp,
        updatedAt: stamp,
      };
      await saveMembership(deps, membership);
      await appendAudit(deps, {
        communityId: community.id,
        actorUserId: userId,
        action: 'join.requested',
        detail: request.note || 'Requested to join',
      });
      const mods = (await readMemberships(deps, { communityId: community.id, state: 'active' }))
        .filter((item) => roleAtLeast(item.role, 'moderator'));
      for (const mod of mods) {
        emitToUser(deps, mod.userId, 'community:membership', {
          communityId: community.id,
          request,
          action: 'join_requested',
        });
      }
      return res.status(202).json({
        request,
        membership,
        community: limitedPrivateDetail(community, membership),
        pending: true,
      });
    }

    // public
    const stamp = nowIso();
    membership = {
      id: membership?.id || newId('cmem'),
      communityId: community.id,
      userId,
      role: 'member',
      state: 'active',
      muted: false,
      mutedAt: null,
      joinedAt: stamp,
      leftAt: null,
      createdAt: membership?.createdAt || stamp,
      updatedAt: stamp,
    };
    await saveMembership(deps, membership);
    const recounted = await recountMembers(deps, community);
    await syncRoomParticipants(deps, community.id);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'member.joined',
      detail: 'Joined public community',
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      membership,
      action: 'joined',
    });
    return res.status(201).json({ community: publicPreview(recounted, membership), membership });
  });

  app.post('/api/communities/:id/leave', async (req, res) => {
    const parseResult = leaveSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid leave payload.' });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = await findMembership(deps, community.id, userId);
    if (!membership || (membership.state !== 'active' && membership.state !== 'pending')) {
      return res.status(404).json({ error: 'You are not in this community.' });
    }
    if (membership.role === 'owner') {
      const owners = (await readMemberships(deps, { communityId: community.id, state: 'active' }))
        .filter((item) => item.role === 'owner');
      if (owners.length <= 1) {
        return res.status(400).json({ error: 'Transfer ownership before leaving as the only owner.' });
      }
    }

    const stamp = nowIso();
    const next: CommunityMembership = {
      ...membership,
      state: 'left',
      leftAt: stamp,
      updatedAt: stamp,
    };
    await saveMembership(deps, next);
    const recounted = await recountMembers(deps, community);
    await syncRoomParticipants(deps, community.id);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'member.left',
      detail: 'Left community',
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      membership: next,
      action: 'left',
    }, false);
    emitToUser(deps, userId, 'community:updated', { community: publicPreview(recounted, next), action: 'left' });
    return res.json({ ok: true, community: publicPreview(recounted, next), membership: next });
  });

  app.post('/api/communities/:id/invites', async (req, res) => {
    const parseResult = inviteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid invite payload.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'admin')) {
      return res.status(403).json({ error: 'Only owners and admins can create invites.' });
    }

    const stamp = nowIso();
    const expiresAt = parseResult.data.expiresInHours
      ? new Date(Date.now() + parseResult.data.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;
    const invite: CommunityInvite = {
      id: newId('cinv'),
      communityId: community.id,
      token: crypto.randomBytes(16).toString('hex'),
      createdByUserId: userId,
      role: parseResult.data.role,
      maxUses: parseResult.data.maxUses ?? null,
      uses: 0,
      expiresAt,
      createdAt: stamp,
    };
    await saveInvite(deps, invite);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'invite.created',
      detail: `role=${invite.role}`,
    });
    return res.status(201).json({ invite });
  });

  app.get('/api/communities/:id/members', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership) {
      return res.status(403).json({ error: 'Only members can view the member list.' });
    }

    const members = await readMemberships(deps, { communityId: community.id, state: 'active' });
    const users = await deps.readUsers();
    const byId = new Map(users.map((user) => [user.id, user]));
    const viewerBlocks = await Promise.all(
      members.map(async (member) => ({
        member,
        blocked: member.userId !== userId ? await deps.usersHaveBlock(userId, member.userId) : false,
      })),
    );
    return res.json({
      members: viewerBlocks
        .filter((entry) => !entry.blocked)
        .map(({ member }) => ({
          ...member,
          name: byId.get(member.userId)?.name || '',
          avatar: byId.get(member.userId)?.avatar || '',
        })),
    });
  });

  app.post('/api/communities/:id/members/:userId/role', async (req, res) => {
    const parseResult = setRoleSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Choose a valid role.', details: z.flattenError(parseResult.error) });
    }
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const actor = activeMembership(await findMembership(deps, community.id, actorId));
    if (!actor || !roleAtLeast(actor.role, 'admin')) {
      return res.status(403).json({ error: 'Only owners and admins can change roles.' });
    }

    const targetUserId = param(req.params.userId);
    const target = activeMembership(await findMembership(deps, community.id, targetUserId));
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Owner role cannot be changed this way.' });
    }
    if (actor.role !== 'owner' && roleAtLeast(target.role, actor.role)) {
      return res.status(403).json({ error: 'You cannot change the role of an equal or higher member.' });
    }
    if (actor.role !== 'owner' && parseResult.data.role === 'admin') {
      return res.status(403).json({ error: 'Only the owner can grant admin.' });
    }

    const next: CommunityMembership = {
      ...target,
      role: parseResult.data.role,
      updatedAt: nowIso(),
    };
    await saveMembership(deps, next);
    await syncRoomParticipants(deps, community.id);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: actorId,
      action: 'member.role',
      detail: `${target.role} → ${next.role}`,
      targetUserId,
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      membership: next,
      action: 'role_changed',
    });
    return res.json({ membership: next });
  });

  app.post('/api/communities/:id/members/:userId/remove', async (req, res) => {
    const parseResult = removeMemberSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid remove payload.' });
    }
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const actor = activeMembership(await findMembership(deps, community.id, actorId));
    if (!actor || !roleAtLeast(actor.role, 'moderator')) {
      return res.status(403).json({ error: 'Only moderators and above can remove members.' });
    }

    const targetUserId = param(req.params.userId);
    if (targetUserId === actorId) {
      return res.status(400).json({ error: 'Use leave to remove yourself.' });
    }
    const target = await findMembership(deps, community.id, targetUserId);
    if (!target || target.state !== 'active') {
      return res.status(404).json({ error: 'Member not found' });
    }
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the owner.' });
    }
    if (!roleAtLeast(actor.role, 'admin') && roleAtLeast(target.role, 'moderator')) {
      return res.status(403).json({ error: 'Moderators cannot remove other moderators or admins.' });
    }
    if (actor.role === 'admin' && target.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot remove other admins.' });
    }

    const next: CommunityMembership = {
      ...target,
      state: 'banned',
      leftAt: nowIso(),
      updatedAt: nowIso(),
    };
    await saveMembership(deps, next);
    const recounted = await recountMembers(deps, community);
    await syncRoomParticipants(deps, community.id);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: actorId,
      action: 'member.removed',
      detail: `Removed ${target.role}`,
      targetUserId,
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      membership: next,
      action: 'removed',
    }, false);
    emitToUser(deps, targetUserId, 'community:updated', {
      community: publicPreview(recounted, next),
      action: 'removed',
    });
    return res.json({ ok: true, membership: next, community: publicPreview(recounted, actor) });
  });

  const reviewJoinRequest = async (req: Request, res: Response, decision: 'approved' | 'rejected') => {
    const parseResult = reviewJoinSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid review payload.' });
    }
    const actorId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!actorId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const actor = activeMembership(await findMembership(deps, community.id, actorId));
    if (!actor || !roleAtLeast(actor.role, 'moderator')) {
      return res.status(403).json({ error: 'Only moderators and above can review join requests.' });
    }

    const request = await findJoinRequest(deps, community.id, param(req.params.requestId));
    if (!request || request.state !== 'pending') {
      return res.status(404).json({ error: 'Join request not found' });
    }

    const stamp = nowIso();
    const nextRequest: CommunityJoinRequest = {
      ...request,
      state: decision,
      reviewedByUserId: actorId,
      reviewedAt: stamp,
      updatedAt: stamp,
    };
    await saveJoinRequest(deps, nextRequest);

    let membership = await findMembership(deps, community.id, request.userId);
    if (decision === 'approved') {
      membership = {
        id: membership?.id || newId('cmem'),
        communityId: community.id,
        userId: request.userId,
        role: 'member',
        state: 'active',
        muted: false,
        mutedAt: null,
        joinedAt: stamp,
        leftAt: null,
        createdAt: membership?.createdAt || stamp,
        updatedAt: stamp,
      };
      await saveMembership(deps, membership);
      await recountMembers(deps, community);
      await syncRoomParticipants(deps, community.id);
    } else if (membership) {
      membership = { ...membership, state: 'left', leftAt: stamp, updatedAt: stamp };
      await saveMembership(deps, membership);
    }

    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: actorId,
      action: decision === 'approved' ? 'join.approved' : 'join.rejected',
      detail: request.note || decision,
      targetUserId: request.userId,
    });
    emitToUser(deps, request.userId, 'community:membership', {
      communityId: community.id,
      request: nextRequest,
      membership,
      action: decision === 'approved' ? 'join_approved' : 'join_rejected',
    });
    await emitToMembers(deps, community.id, 'community:membership', {
      communityId: community.id,
      request: nextRequest,
      membership,
      action: decision === 'approved' ? 'join_approved' : 'join_rejected',
    });
    return res.json({ request: nextRequest, membership });
  };

  app.post('/api/communities/:id/join-requests/:requestId/approve', (req, res) => {
    void reviewJoinRequest(req, res, 'approved');
  });
  app.post('/api/communities/:id/join-requests/:requestId/reject', (req, res) => {
    void reviewJoinRequest(req, res, 'rejected');
  });

  app.get('/api/communities/:id/rooms', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership) {
      return res.status(403).json({ error: 'Only members can view rooms.' });
    }
    const rooms = (await readRooms(deps, community.id)).filter((room) => canViewRoom(membership.role, room));
    const chats = await deps.readChats();
    return res.json({
      rooms: rooms.map((room) => ({
        ...room,
        chat: chats.find((chat) => chat.id === room.chatId) ?? null,
        canPost: canPostInRoom(membership.role, room),
      })),
    });
  });

  app.post('/api/communities/:id/rooms', async (req, res) => {
    const parseResult = createRoomSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Enter a room name.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'admin')) {
      return res.status(403).json({ error: 'Only owners and admins can create rooms.' });
    }

    const isAnnouncement = Boolean(parseResult.data.isAnnouncement);
    const permissions: CommunityRoomPermissions = {
      viewRoles: parseResult.data.permissions?.viewRoles ?? [],
      postRoles: parseResult.data.permissions?.postRoles
        ?? (isAnnouncement ? [...ADMIN_PLUS] : []),
    };

    const activeMembers = await readMemberships(deps, { communityId: community.id, state: 'active' });
    const allowAnonymous = Boolean(parseResult.data.allowAnonymous);
    const previewRoom: CommunityRoom = {
      id: 'preview',
      communityId: community.id,
      chatId: '',
      title: parseResult.data.title,
      topic: parseResult.data.topic || '',
      permissions,
      pinnedRules: parseResult.data.pinnedRules || '',
      isAnnouncement,
      allowAnonymous,
      createdByUserId: userId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const participantIds = activeMembers
      .filter((member) => canViewRoom(member.role, previewRoom))
      .map((member) => member.userId);
    const adminIds = activeMembers
      .filter((member) => roleAtLeast(member.role, 'moderator'))
      .map((member) => member.userId);

    const chat = await createGroupChatForRoom(deps, {
      communityId: community.id,
      title: parseResult.data.title,
      creatorUserId: userId,
      participantIds,
      adminIds: adminIds.length ? adminIds : [userId],
      allowAnonymous,
    });

    const room: CommunityRoom = {
      ...previewRoom,
      id: newId('crm'),
      chatId: chat.id,
    };
    await saveRoom(deps, room);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'room.created',
      detail: room.title,
      roomId: room.id,
    });
    await emitToMembers(deps, community.id, 'community:room', {
      communityId: community.id,
      room,
      action: 'created',
    });
    deps.io.emit('chat:created', chat);
    return res.status(201).json({ room, chat });
  });

  app.put('/api/communities/:id/rooms/:roomId', async (req, res) => {
    const parseResult = updateRoomSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid room update.', details: z.flattenError(parseResult.error) });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'admin')) {
      return res.status(403).json({ error: 'Only owners and admins can update rooms.' });
    }
    const room = await findRoom(deps, community.id, param(req.params.roomId));
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const next: CommunityRoom = {
      ...room,
      title: parseResult.data.title ?? room.title,
      topic: parseResult.data.topic ?? room.topic,
      pinnedRules: parseResult.data.pinnedRules ?? room.pinnedRules,
      isAnnouncement: parseResult.data.isAnnouncement ?? room.isAnnouncement,
      allowAnonymous: parseResult.data.allowAnonymous ?? Boolean(room.allowAnonymous),
      permissions: {
        viewRoles: parseResult.data.permissions?.viewRoles ?? room.permissions.viewRoles,
        postRoles: parseResult.data.permissions?.postRoles ?? room.permissions.postRoles,
      },
      updatedAt: nowIso(),
    };
    await saveRoom(deps, next);
    await syncRoomParticipants(deps, community.id, [next]);
    const chats = await deps.readChats();
    const chat = chats.find((item) => item.id === next.chatId);
    if (chat) {
      const updatedChat = await deps.saveChatRecord({
        ...chat,
        kind: 'group',
        title: next.title,
        communityId: community.id,
        allowAnonymous: next.allowAnonymous,
        updatedAt: nowIso(),
      });
      deps.io.emit('chat:updated', updatedChat);
    }
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'room.updated',
      detail: next.allowAnonymous !== Boolean(room.allowAnonymous)
        ? `${next.title} (anonymous ${next.allowAnonymous ? 'enabled' : 'disabled'})`
        : next.title,
      roomId: next.id,
      chatId: next.chatId,
    });
    await emitToMembers(deps, community.id, 'community:room', {
      communityId: community.id,
      room: next,
      action: 'updated',
    });
    return res.json({ room: next });
  });

  app.post('/api/communities/:id/mute', async (req, res) => {
    const parseResult = muteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid mute payload.' });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership) {
      return res.status(403).json({ error: 'Only members can mute a community.' });
    }
    const muted = parseResult.data.muted !== false;
    const next: CommunityMembership = {
      ...membership,
      muted,
      mutedAt: muted ? nowIso() : null,
      updatedAt: nowIso(),
    };
    await saveMembership(deps, next);
    emitToUser(deps, userId, 'community:membership', {
      communityId: community.id,
      membership: next,
      action: muted ? 'muted' : 'unmuted',
    });
    return res.json({ membership: next });
  });

  app.post('/api/communities/:id/report', async (req, res) => {
    const parseResult = reportSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Tell us why you are reporting this community.' });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });

    if (await spamReportBlocked(deps, userId)) {
      return res.status(429).json({ error: 'Too many reports today. Try again later.' });
    }

    if (parseResult.data.targetUserId && await deps.usersHaveBlock(userId, parseResult.data.targetUserId)) {
      // Still allow reporting blocked users, but do not require interaction.
    }

    const stamp = nowIso();
    const report: CommunityReport = {
      id: newId('crep'),
      communityId: community.id,
      roomId: parseResult.data.roomId || null,
      messageId: parseResult.data.messageId || null,
      reporterUserId: userId,
      reason: parseResult.data.reason,
      targetUserId: parseResult.data.targetUserId || null,
      state: 'pending',
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: '',
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveReport(deps, report);
    await appendAudit(deps, {
      communityId: community.id,
      actorUserId: userId,
      action: 'report.created',
      detail: report.reason,
      targetUserId: report.targetUserId,
      roomId: report.roomId,
    });

    const mods = (await readMemberships(deps, { communityId: community.id, state: 'active' }))
      .filter((item) => roleAtLeast(item.role, 'moderator'));
    for (const mod of mods) {
      emitToUser(deps, mod.userId, 'community:updated', {
        communityId: community.id,
        report,
        action: 'report_created',
      });
    }

    return res.status(201).json({
      report,
      message: 'Community reported',
      tip: 'You can also block unwanted contact from Settings / profile actions.',
    });
  });

  app.get('/api/communities/:id/audit', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'moderator')) {
      return res.status(403).json({ error: 'Only moderators and above can view audit history.' });
    }
    const db = await deps.getDb();
    const audit = db
      ? await db.collection<CommunityAuditEvent>('communityAudit')
        .find({ communityId: community.id }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(200)
        .toArray()
      : seedAudit.filter((item) => item.communityId === community.id).slice(0, 200);
    return res.json({ audit });
  });

  app.get('/api/communities/:id/join-requests', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const community = await findCommunity(deps, param(req.params.id));
    if (!community) return res.status(404).json({ error: 'Community not found' });
    const membership = activeMembership(await findMembership(deps, community.id, userId));
    if (!membership || !roleAtLeast(membership.role, 'moderator')) {
      return res.status(403).json({ error: 'Only moderators and above can view join requests.' });
    }
    const db = await deps.getDb();
    const requests = db
      ? await db.collection<CommunityJoinRequest>('communityJoinRequests')
        .find({ communityId: community.id, state: 'pending' }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .toArray()
      : seedJoinRequests.filter((item) => item.communityId === community.id && item.state === 'pending');
    return res.json({ requests });
  });
};
