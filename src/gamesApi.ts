/**
 * D4 In-app Games
 *
 * Lightweight multiplayer sessions (quiz battle, would-you-rather) with
 * server-authoritative scoring. Points are cosmetic only — never cash or P2W.
 * Session state is persisted so clients can reconnect mid-game.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

export type GameKind =
  | 'quiz-battle'
  | 'would-you-rather'
  | 'memory-match'
  | 'word-builder'
  | 'emoji-guess'
  | 'trivia'
  | 'meme-vote';

export type GameCatalogEntry = {
  id: string;
  slug: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  comingSoon: boolean;
  kind: GameKind;
};

export type GamePlayerStatus = 'invited' | 'joined' | 'left' | 'finished';
export type GameSessionStatus = 'lobby' | 'active' | 'finished' | 'cancelled';

export type GamePlayer = {
  userId: string;
  status: GamePlayerStatus;
  score: number;
  answers: Record<string, number>;
};

export type QuizRoundPayload = {
  index: number;
  kind: 'quiz';
  prompt: string;
  options: string[];
  /** Server-only until the round resolves. */
  correctAnswerIndex: number;
};

export type WyrRoundPayload = {
  index: number;
  kind: 'wyr';
  prompt: string;
  options: [string, string];
};

export type GameRoundPayload = QuizRoundPayload | WyrRoundPayload;

export type GameResultsSummary = {
  kind: GameKind;
  winnerUserIds: string[];
  scores: Array<{ userId: string; score: number }>;
  /** Would-you-rather: share of rounds where all active players agreed. */
  agreementPercent?: number;
  funSummary?: string;
  /** Cosmetics label for clients. */
  pointsNote: string;
};

export type GameSession = {
  id: string;
  gameId: string;
  gameSlug: string;
  kind: GameKind;
  status: GameSessionStatus;
  hostUserId: string;
  chatId?: string | null;
  players: GamePlayer[];
  roundIndex: number;
  rounds: GameRoundPayload[];
  roundStartedAt?: string | null;
  roundTimeoutMs: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  results?: GameResultsSummary | null;
};

export type GameScore = {
  userId: string;
  /** Cosmetic lifetime points only — not redeemable, not cash. */
  points: number;
  gamesPlayed: number;
  wins: number;
  updatedAt: string;
};

export type GamesDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readUsers: () => Promise<Array<{ id: string; name: string; avatar?: string }>>;
  /** Persist a system-style chat summary when a session finishes with chatId. */
  persistGameResultMessage?: (input: {
    chatId: string;
    hostUserId: string;
    text: string;
    sessionId: string;
  }) => Promise<void>;
};

const ROUND_TIMEOUT_MS = 30_000;
const ROUNDS_PER_GAME = 5;
/** Lifetime cosmetics: +10 per session point, +25 win bonus. */
const LIFETIME_POINTS_PER_SESSION_POINT = 10;
const LIFETIME_WIN_BONUS = 25;
const POINTS_NOTE = 'Cosmetic points only — no cash, gambling, or pay-to-win.';

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) => String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const seedCatalog: GameCatalogEntry[] = [
  {
    id: 'gcat-quiz-battle',
    slug: 'quiz-battle',
    title: 'Quiz Battle',
    description: 'Five multiple-choice questions. Race friends for the high score.',
    minPlayers: 2,
    maxPlayers: 4,
    comingSoon: false,
    kind: 'quiz-battle',
  },
  {
    id: 'gcat-would-you-rather',
    slug: 'would-you-rather',
    title: 'Would You Rather',
    description: 'Five A/B choices. No wrong answers — compare picks and agreement.',
    minPlayers: 2,
    maxPlayers: 6,
    comingSoon: false,
    kind: 'would-you-rather',
  },
  {
    id: 'gcat-memory-match',
    slug: 'memory-match',
    title: 'Memory Match',
    description: 'Flip cards and find pairs. Coming soon.',
    minPlayers: 2,
    maxPlayers: 4,
    comingSoon: true,
    kind: 'memory-match',
  },
  {
    id: 'gcat-word-builder',
    slug: 'word-builder',
    title: 'Word Builder',
    description: 'Build words from shared letters. Coming soon.',
    minPlayers: 2,
    maxPlayers: 4,
    comingSoon: true,
    kind: 'word-builder',
  },
  {
    id: 'gcat-emoji-guess',
    slug: 'emoji-guess',
    title: 'Emoji Guess',
    description: 'Decode emoji puzzles together. Coming soon.',
    minPlayers: 2,
    maxPlayers: 6,
    comingSoon: true,
    kind: 'emoji-guess',
  },
  {
    id: 'gcat-trivia',
    slug: 'trivia',
    title: 'Trivia Night',
    description: 'Themed trivia rounds. Coming soon.',
    minPlayers: 2,
    maxPlayers: 8,
    comingSoon: true,
    kind: 'trivia',
  },
  {
    id: 'gcat-meme-vote',
    slug: 'meme-vote',
    title: 'Meme Vote',
    description: 'Caption battles and friendly votes. Coming soon.',
    minPlayers: 2,
    maxPlayers: 8,
    comingSoon: true,
    kind: 'meme-vote',
  },
];

const seedSessions: GameSession[] = [];
const seedScores: GameScore[] = [];

/** In-memory round timers keyed by sessionId:roundIndex. */
const roundTimers = new Map<string, NodeJS.Timeout>();

const QUIZ_BANK: Array<{ prompt: string; options: string[]; correctAnswerIndex: number }> = [
  {
    prompt: 'What is the capital city of Ghana?',
    options: ['Kumasi', 'Accra', 'Tamale', 'Cape Coast'],
    correctAnswerIndex: 1,
  },
  {
    prompt: 'Which planet is known as the Red Planet?',
    options: ['Venus', 'Jupiter', 'Mars', 'Mercury'],
    correctAnswerIndex: 2,
  },
  {
    prompt: 'HTML is primarily used to…',
    options: ['Style pages', 'Structure web content', 'Query databases', 'Compile apps'],
    correctAnswerIndex: 1,
  },
  {
    prompt: 'The Nile River flows mainly through which continent?',
    options: ['Asia', 'Europe', 'Africa', 'South America'],
    correctAnswerIndex: 2,
  },
  {
    prompt: 'How many bits are in one byte?',
    options: ['4', '8', '16', '32'],
    correctAnswerIndex: 1,
  },
  {
    prompt: 'Which ocean borders Ghana’s southern coast?',
    options: ['Indian Ocean', 'Pacific Ocean', 'Arctic Ocean', 'Atlantic Ocean'],
    correctAnswerIndex: 3,
  },
  {
    prompt: 'What does Wi‑Fi commonly provide?',
    options: ['Wireless network access', 'Printer ink', 'Battery power', 'GPS satellites'],
    correctAnswerIndex: 0,
  },
  {
    prompt: 'Which animal is often called the “king of the jungle”?',
    options: ['Elephant', 'Lion', 'Giraffe', 'Zebra'],
    correctAnswerIndex: 1,
  },
  {
    prompt: 'In programming, a “bug” usually means…',
    options: ['A virus scanner', 'An error in code', 'A hardware fan', 'A type of emoji'],
    correctAnswerIndex: 1,
  },
  {
    prompt: 'Accra is located in which African region?',
    options: ['North Africa', 'East Africa', 'West Africa', 'Southern Africa'],
    correctAnswerIndex: 2,
  },
];

const WYR_BANK: Array<{ prompt: string; options: [string, string] }> = [
  {
    prompt: 'Would you rather…',
    options: ['Always have perfect Wi‑Fi', 'Always have a full phone battery'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Visit Accra for a food tour', 'Visit Cape Coast for the beaches'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Learn a new coding language', 'Learn a new musical instrument'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Only listen to podcasts', 'Only listen to music'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Have a personal chef', 'Have a personal trainer'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Travel by train across Africa', 'Travel by boat along the coast'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Be early to everything', 'Never get stuck in traffic'],
  },
  {
    prompt: 'Would you rather…',
    options: ['Message only in emojis for a day', 'Voice-note only for a day'],
  },
];

const createSessionSchema = z.object({
  userId: z.string().min(1).optional(),
  gameSlug: z.string().trim().min(2).max(80),
  chatId: z.string().min(1).max(80).optional().nullable(),
  inviteUserIds: z.array(z.string().min(1).max(80)).max(20).optional().default([]),
});

const userOnlySchema = z.object({
  userId: z.string().min(1).optional(),
});

const answerSchema = z.object({
  userId: z.string().min(1).optional(),
  roundIndex: z.number().int().min(0).max(50),
  answerIndex: z.number().int().min(0).max(20),
});

const resolveUserId = async (deps: GamesDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

const sessionChannel = (sessionId: string) => `game:${sessionId}`;
const timerKey = (sessionId: string, roundIndex: number) => `${sessionId}:${roundIndex}`;

const clearRoundTimer = (sessionId: string, roundIndex: number) => {
  const key = timerKey(sessionId, roundIndex);
  const existing = roundTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    roundTimers.delete(key);
  }
};

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const pickQuizRounds = (): QuizRoundPayload[] =>
  shuffle(QUIZ_BANK)
    .slice(0, ROUNDS_PER_GAME)
    .map((item, index) => ({
      index,
      kind: 'quiz' as const,
      prompt: item.prompt,
      options: item.options,
      correctAnswerIndex: item.correctAnswerIndex,
    }));

const pickWyrRounds = (): WyrRoundPayload[] =>
  shuffle(WYR_BANK)
    .slice(0, ROUNDS_PER_GAME)
    .map((item, index) => ({
      index,
      kind: 'wyr' as const,
      prompt: item.prompt,
      options: item.options,
    }));

async function ensureCatalogSeeded(deps: GamesDeps) {
  const db = await deps.getDb();
  if (!db) return;
  const collection = db.collection<GameCatalogEntry>('gameCatalog');
  const count = await collection.countDocuments();
  if (count > 0) return;
  await collection.insertMany(seedCatalog.map((entry) => ({ ...entry })));
}

async function readCatalog(deps: GamesDeps): Promise<GameCatalogEntry[]> {
  const db = await deps.getDb();
  if (!db) return seedCatalog.map((entry) => ({ ...entry }));
  await ensureCatalogSeeded(deps);
  const rows = await db.collection<GameCatalogEntry>('gameCatalog').find({}, { projection: { _id: 0 } }).toArray();
  return rows.length ? rows : seedCatalog.map((entry) => ({ ...entry }));
}

async function findCatalogBySlug(deps: GamesDeps, slug: string) {
  const catalog = await readCatalog(deps);
  return catalog.find((entry) => entry.slug === slug) ?? null;
}

async function findSession(deps: GamesDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedSessions.find((item) => item.id === id) ?? null;
  return db.collection<GameSession>('gameSessions').findOne({ id }, { projection: { _id: 0 } });
}

async function saveSession(deps: GamesDeps, session: GameSession) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedSessions, session);
  await db.collection<GameSession>('gameSessions').updateOne({ id: session.id }, { $set: session }, { upsert: true });
  return session;
}

async function findSessionsForUser(deps: GamesDeps, userId: string) {
  const db = await deps.getDb();
  const filterActive = (session: GameSession) =>
    session.players.some((player) => player.userId === userId)
    && (session.status === 'lobby' || session.status === 'active'
      || (session.status === 'finished' && session.finishedAt
        && Date.now() - Date.parse(session.finishedAt) < 7 * 24 * 60 * 60 * 1000));

  if (!db) {
    return seedSessions
      .filter(filterActive)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 40);
  }

  const rows = await db
    .collection<GameSession>('gameSessions')
    .find({ 'players.userId': userId }, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(80)
    .toArray();
  return rows.filter(filterActive).slice(0, 40);
}

async function findScore(deps: GamesDeps, userId: string) {
  const db = await deps.getDb();
  if (!db) return seedScores.find((item) => item.userId === userId) ?? null;
  return db.collection<GameScore>('gameScores').findOne({ userId }, { projection: { _id: 0 } });
}

async function saveScore(deps: GamesDeps, score: GameScore) {
  const db = await deps.getDb();
  if (!db) {
    const index = seedScores.findIndex((item) => item.userId === score.userId);
    if (index >= 0) seedScores[index] = score;
    else seedScores.unshift(score);
    return score;
  }
  await db.collection<GameScore>('gameScores').updateOne(
    { userId: score.userId },
    { $set: score },
    { upsert: true },
  );
  return score;
}

async function readLeaderboard(deps: GamesDeps, limit = 25) {
  const db = await deps.getDb();
  if (!db) {
    return [...seedScores].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, limit);
  }
  return db
    .collection<GameScore>('gameScores')
    .find({}, { projection: { _id: 0 } })
    .sort({ points: -1, wins: -1 })
    .limit(limit)
    .toArray();
}

const activePlayers = (session: GameSession) =>
  session.players.filter((player) => player.status === 'joined' || player.status === 'finished');

const joinedPlayers = (session: GameSession) =>
  session.players.filter((player) => player.status === 'joined');

const findPlayer = (session: GameSession, userId: string) =>
  session.players.find((player) => player.userId === userId);

const emitToUser = (deps: GamesDeps, userId: string, event: string, payload: unknown) => {
  deps.io.to(`user:${userId}`).emit(event, payload);
};

const emitSession = (deps: GamesDeps, session: GameSession, action?: string) => {
  const publicSession = toPublicSession(session);
  const payload = { session: publicSession, action: action || 'updated' };
  deps.io.to(sessionChannel(session.id)).emit('game:session', payload);
  for (const player of session.players) {
    if (player.status === 'left') continue;
    emitToUser(deps, player.userId, 'game:session', payload);
  }
};

const emitRound = (deps: GamesDeps, session: GameSession, extra?: Record<string, unknown>) => {
  const payload = {
    sessionId: session.id,
    roundIndex: session.roundIndex,
    round: publicRound(session.rounds[session.roundIndex], false),
    roundStartedAt: session.roundStartedAt,
    roundTimeoutMs: session.roundTimeoutMs,
    session: toPublicSession(session),
    ...extra,
  };
  deps.io.to(sessionChannel(session.id)).emit('game:round', payload);
  for (const player of activePlayers(session)) {
    emitToUser(deps, player.userId, 'game:round', payload);
  }
};

const emitFinished = (deps: GamesDeps, session: GameSession) => {
  const payload = {
    sessionId: session.id,
    session: toPublicSession(session),
    results: session.results,
  };
  deps.io.to(sessionChannel(session.id)).emit('game:finished', payload);
  for (const player of session.players) {
    if (player.status === 'left' && player.userId !== session.hostUserId) continue;
    emitToUser(deps, player.userId, 'game:finished', payload);
  }
};

const publicRound = (round: GameRoundPayload | undefined, includeCorrect: boolean) => {
  if (!round) return null;
  if (round.kind === 'quiz') {
    return {
      index: round.index,
      kind: round.kind,
      prompt: round.prompt,
      options: round.options,
      ...(includeCorrect ? { correctAnswerIndex: round.correctAnswerIndex } : {}),
    };
  }
  return {
    index: round.index,
    kind: round.kind,
    prompt: round.prompt,
    options: round.options,
  };
};

/** Client-safe session: hide future/current correct answers until round resolves. */
export const toPublicSession = (session: GameSession) => {
  const resolvedThrough =
    session.status === 'finished' || session.status === 'cancelled'
      ? session.rounds.length
      : session.roundIndex;

  return {
    id: session.id,
    gameId: session.gameId,
    gameSlug: session.gameSlug,
    kind: session.kind,
    status: session.status,
    hostUserId: session.hostUserId,
    chatId: session.chatId ?? null,
    players: session.players.map((player) => ({
      userId: player.userId,
      status: player.status,
      score: player.score,
      answers: { ...player.answers },
    })),
    roundIndex: session.roundIndex,
    roundStartedAt: session.roundStartedAt ?? null,
    roundTimeoutMs: session.roundTimeoutMs,
    rounds: session.rounds.map((round) =>
      publicRound(round, round.index < resolvedThrough || session.status === 'finished')),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    finishedAt: session.finishedAt ?? null,
    results: session.results ?? null,
    pointsNote: POINTS_NOTE,
  };
};

const allActiveAnswered = (session: GameSession, roundIndex: number) => {
  const key = String(roundIndex);
  const players = joinedPlayers(session);
  if (!players.length) return true;
  return players.every((player) => Object.prototype.hasOwnProperty.call(player.answers, key));
};

const roundTimedOut = (session: GameSession) => {
  if (!session.roundStartedAt || session.status !== 'active') return false;
  return Date.now() - Date.parse(session.roundStartedAt) >= session.roundTimeoutMs;
};

async function applyLifetimeScores(
  deps: GamesDeps,
  session: GameSession,
  winnerUserIds: string[],
) {
  const stamp = nowIso();
  for (const player of activePlayers(session)) {
    const existing = (await findScore(deps, player.userId)) || {
      userId: player.userId,
      points: 0,
      gamesPlayed: 0,
      wins: 0,
      updatedAt: stamp,
    };
    const won = winnerUserIds.includes(player.userId);
    const next: GameScore = {
      userId: player.userId,
      points: existing.points
        + player.score * LIFETIME_POINTS_PER_SESSION_POINT
        + (won ? LIFETIME_WIN_BONUS : 0),
      gamesPlayed: existing.gamesPlayed + 1,
      wins: existing.wins + (won ? 1 : 0),
      updatedAt: stamp,
    };
    await saveScore(deps, next);
  }
}

function buildQuizResults(session: GameSession): GameResultsSummary {
  const players = activePlayers(session);
  const scores = players
    .map((player) => ({ userId: player.userId, score: player.score }))
    .sort((a, b) => b.score - a.score);
  const top = scores[0]?.score ?? 0;
  const winnerUserIds = scores.filter((entry) => entry.score === top && top > 0).map((entry) => entry.userId);
  if (!winnerUserIds.length && scores.length) {
    // All zero — everyone tied as participants, no exclusive winner.
    winnerUserIds.push(...scores.map((entry) => entry.userId));
  }
  return {
    kind: 'quiz-battle',
    winnerUserIds,
    scores,
    funSummary: winnerUserIds.length === 1
      ? `Quiz Battle complete — ${winnerUserIds[0]} leads with ${top} correct!`
      : `Quiz Battle complete — tie at ${top} correct.`,
    pointsNote: POINTS_NOTE,
  };
}

function buildWyrResults(session: GameSession): GameResultsSummary {
  const players = activePlayers(session);
  let agreeingRounds = 0;
  for (let i = 0; i < session.rounds.length; i += 1) {
    const key = String(i);
    const picks = players
      .map((player) => player.answers[key])
      .filter((value) => typeof value === 'number');
    if (picks.length < 2) continue;
    if (picks.every((pick) => pick === picks[0])) agreeingRounds += 1;
  }
  const agreementPercent = session.rounds.length
    ? Math.round((agreeingRounds / session.rounds.length) * 100)
    : 0;

  // Fun score: how often each player matched the majority pick that round.
  const scored = players.map((player) => {
    let score = 0;
    for (let i = 0; i < session.rounds.length; i += 1) {
      const key = String(i);
      const picks = players
        .map((p) => p.answers[key])
        .filter((value) => typeof value === 'number') as number[];
      if (picks.length < 2) continue;
      const counts = new Map<number, number>();
      for (const pick of picks) counts.set(pick, (counts.get(pick) || 0) + 1);
      let majority = picks[0];
      let majorityCount = 0;
      for (const [pick, count] of counts) {
        if (count > majorityCount) {
          majority = pick;
          majorityCount = count;
        }
      }
      if (player.answers[key] === majority) score += 1;
    }
    return { userId: player.userId, score };
  });

  const withScores: GameSession = {
    ...session,
    players: session.players.map((player) => {
      const found = scored.find((entry) => entry.userId === player.userId);
      return found ? { ...player, score: found.score, status: 'finished' as const } : player;
    }),
  };
  Object.assign(session, { players: withScores.players });

  const scores = scored.sort((a, b) => b.score - a.score);
  const top = scores[0]?.score ?? 0;
  const winnerUserIds = scores.filter((entry) => entry.score === top).map((entry) => entry.userId);
  const vibe =
    agreementPercent >= 80 ? 'You are basically the same person.'
      : agreementPercent >= 50 ? 'Solid agreement — fun overlap!'
        : 'Chaos mode — delightfully different picks.';

  return {
    kind: 'would-you-rather',
    winnerUserIds,
    scores,
    agreementPercent,
    funSummary: `Would You Rather: ${agreementPercent}% agreement. ${vibe}`,
    pointsNote: POINTS_NOTE,
  };
}

async function finishSession(deps: GamesDeps, session: GameSession) {
  clearRoundTimer(session.id, session.roundIndex);
  const stamp = nowIso();

  let results: GameResultsSummary;
  if (session.kind === 'would-you-rather') {
    results = buildWyrResults(session);
  } else {
    results = buildQuizResults(session);
  }

  const next: GameSession = {
    ...session,
    status: 'finished',
    finishedAt: stamp,
    updatedAt: stamp,
    players: session.players.map((player) => (
      player.status === 'joined' || player.status === 'finished'
        ? { ...player, status: 'finished' as const }
        : player
    )),
    results,
  };
  await saveSession(deps, next);
  await applyLifetimeScores(deps, next, results.winnerUserIds);
  emitFinished(deps, next);
  emitSession(deps, next, 'finished');

  if (next.chatId && deps.persistGameResultMessage) {
    const users = await deps.readUsers();
    const nameOf = (userId: string) => users.find((user) => user.id === userId)?.name || userId;
    const scoreLine = results.scores
      .map((entry) => `${nameOf(entry.userId)} ${entry.score}`)
      .join(' · ');
    const winners = results.winnerUserIds.map(nameOf).join(', ');
    const agreement = typeof results.agreementPercent === 'number'
      ? ` · ${results.agreementPercent}% agreement`
      : '';
    const text = `🎮 ${session.kind === 'would-you-rather' ? 'Would You Rather' : 'Quiz Battle'} finished — ${
      results.winnerUserIds.length > 1 ? `Tie: ${winners}` : `Winner: ${winners}`
    }${agreement}. Scores: ${scoreLine}. (${POINTS_NOTE})`;
    try {
      await deps.persistGameResultMessage({
        chatId: next.chatId,
        hostUserId: next.hostUserId,
        text,
        sessionId: next.id,
      });
    } catch {
      // Chat share is best-effort; session results already persisted.
    }
  }

  return next;
}

async function advanceOrFinish(deps: GamesDeps, session: GameSession) {
  clearRoundTimer(session.id, session.roundIndex);
  const round = session.rounds[session.roundIndex];
  const answerKey = String(session.roundIndex);

  const picks = joinedPlayers(session).map((player) => ({
    userId: player.userId,
    answerIndex: Object.prototype.hasOwnProperty.call(player.answers, answerKey)
      ? player.answers[answerKey]
      : null,
  }));

  let nextPlayers = session.players;
  if (round?.kind === 'quiz') {
    nextPlayers = session.players.map((player) => {
      if (player.status !== 'joined') return player;
      const answered = Object.prototype.hasOwnProperty.call(player.answers, answerKey);
      if (!answered) return player;
      const correct = player.answers[answerKey] === round.correctAnswerIndex;
      return correct ? { ...player, score: player.score + 1 } : player;
    });
  }

  const afterScore: GameSession = {
    ...session,
    players: nextPlayers,
    updatedAt: nowIso(),
  };

  const roundResultPayload = {
    roundIndex: session.roundIndex,
    round: publicRound(round, true),
    picks,
    players: afterScore.players.map((player) => ({
      userId: player.userId,
      status: player.status,
      score: player.score,
    })),
  };
  deps.io.to(sessionChannel(session.id)).emit('game:round', {
    ...roundResultPayload,
    phase: 'result',
    session: toPublicSession(afterScore),
  });
  for (const player of activePlayers(afterScore)) {
    emitToUser(deps, player.userId, 'game:round', {
      ...roundResultPayload,
      phase: 'result',
      session: toPublicSession(afterScore),
    });
  }

  if (session.roundIndex >= session.rounds.length - 1) {
    return finishSession(deps, afterScore);
  }

  const nextIndex = session.roundIndex + 1;
  const advanced: GameSession = {
    ...afterScore,
    roundIndex: nextIndex,
    roundStartedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveSession(deps, advanced);
  scheduleRoundTimeout(deps, advanced);
  emitSession(deps, advanced, 'round');
  emitRound(deps, advanced, { phase: 'prompt' });
  return advanced;
}

function scheduleRoundTimeout(deps: GamesDeps, session: GameSession) {
  clearRoundTimer(session.id, session.roundIndex);
  const key = timerKey(session.id, session.roundIndex);
  const roundIndex = session.roundIndex;
  const handle = setTimeout(() => {
    void (async () => {
      try {
        const current = await findSession(deps, session.id);
        if (!current || current.status !== 'active') return;
        if (current.roundIndex !== roundIndex) return;
        if (allActiveAnswered(current, roundIndex) || roundTimedOut(current)) {
          await advanceOrFinish(deps, current);
        }
      } catch {
        // ignore timer errors
      }
    })();
  }, session.roundTimeoutMs + 50);
  roundTimers.set(key, handle);
}

/** If a round already timed out (e.g. after reconnect), resolve it. */
async function maybeResolveStaleRound(deps: GamesDeps, session: GameSession) {
  if (session.status !== 'active') return session;
  if (!allActiveAnswered(session, session.roundIndex) && !roundTimedOut(session)) {
    return session;
  }
  return advanceOrFinish(deps, session);
}

export const registerGamesApi = (app: Express, deps: GamesDeps) => {
  app.get('/api/games', async (_req, res) => {
    const games = await readCatalog(deps);
    return res.json({
      games,
      pointsNote: POINTS_NOTE,
    });
  });

  app.get('/api/games/leaderboard', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    const rows = await readLeaderboard(deps);
    const users = await deps.readUsers();
    const byId = new Map(users.map((user) => [user.id, user]));
    const leaderboard = rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId,
      name: byId.get(row.userId)?.name || '',
      avatar: byId.get(row.userId)?.avatar || '',
      points: row.points,
      gamesPlayed: row.gamesPlayed,
      wins: row.wins,
      pointsLabel: 'Cosmetic points (not cash)',
    }));
    const mine = userId ? (await findScore(deps, userId)) : null;
    return res.json({
      leaderboard,
      mine: mine
        ? {
            ...mine,
            pointsLabel: 'Cosmetic points (not cash)',
            name: byId.get(mine.userId)?.name || '',
            avatar: byId.get(mine.userId)?.avatar || '',
          }
        : null,
      pointsNote: POINTS_NOTE,
    });
  });

  app.get('/api/games/sessions/mine', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const sessions = await findSessionsForUser(deps, userId);
    const resolved: GameSession[] = [];
    for (const session of sessions) {
      resolved.push(await maybeResolveStaleRound(deps, session));
    }
    return res.json({
      sessions: resolved.map(toPublicSession),
      pointsNote: POINTS_NOTE,
    });
  });

  app.post('/api/games/sessions', async (req, res) => {
    const parseResult = createSessionSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid session create payload.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const users = await deps.readUsers();
    if (!users.some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const catalog = await findCatalogBySlug(deps, parseResult.data.gameSlug);
    if (!catalog) return res.status(404).json({ error: 'Game not found' });
    if (catalog.comingSoon) {
      return res.status(403).json({ error: 'This game is coming soon.' });
    }

    const inviteUserIds = [...new Set((parseResult.data.inviteUserIds || []).filter((id) => id !== userId))];
    if (1 + inviteUserIds.length > catalog.maxPlayers) {
      return res.status(400).json({
        error: `This game allows at most ${catalog.maxPlayers} players.`,
      });
    }
    for (const inviteId of inviteUserIds) {
      if (!users.some((user) => user.id === inviteId)) {
        return res.status(404).json({ error: `Invite user not found: ${inviteId}` });
      }
    }

    const stamp = nowIso();
    const players: GamePlayer[] = [
      { userId, status: 'joined', score: 0, answers: {} },
      ...inviteUserIds.map((inviteId) => ({
        userId: inviteId,
        status: 'invited' as const,
        score: 0,
        answers: {},
      })),
    ];

    const session: GameSession = {
      id: newId('gs'),
      gameId: catalog.id,
      gameSlug: catalog.slug,
      kind: catalog.kind,
      status: 'lobby',
      hostUserId: userId,
      chatId: parseResult.data.chatId || null,
      players,
      roundIndex: 0,
      rounds: [],
      roundStartedAt: null,
      roundTimeoutMs: ROUND_TIMEOUT_MS,
      createdAt: stamp,
      updatedAt: stamp,
      finishedAt: null,
      results: null,
    };
    await saveSession(deps, session);

    const publicSession = toPublicSession(session);
    for (const inviteId of inviteUserIds) {
      emitToUser(deps, inviteId, 'game:invite', {
        sessionId: session.id,
        session: publicSession,
        fromUserId: userId,
        gameSlug: catalog.slug,
        title: catalog.title,
      });
    }
    emitSession(deps, session, 'created');

    return res.status(201).json({ session: publicSession });
  });

  app.get('/api/games/sessions/:id', async (req, res) => {
    const userId = await resolveUserId(deps, req, typeof req.query.userId === 'string' ? req.query.userId : undefined);
    let session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session = await maybeResolveStaleRound(deps, session);

    if (userId) {
      const player = findPlayer(session, userId);
      if (!player && session.hostUserId !== userId) {
        return res.status(403).json({ error: 'You are not part of this session.' });
      }
    }

    return res.json({ session: toPublicSession(session) });
  });

  app.post('/api/games/sessions/:id/join', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid join payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    if (!(await deps.readUsers()).some((user) => user.id === userId)) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'lobby') {
      return res.status(409).json({ error: 'This session is not accepting joins.' });
    }

    const catalog = await findCatalogBySlug(deps, session.gameSlug);
    const maxPlayers = catalog?.maxPlayers ?? 4;
    const existing = findPlayer(session, userId);
    if (existing?.status === 'joined') {
      return res.json({ session: toPublicSession(session), alreadyJoined: true });
    }

    const joinedCount = joinedPlayers(session).length;
    if (!existing && joinedCount >= maxPlayers) {
      return res.status(409).json({ error: `This game is full (max ${maxPlayers}).` });
    }

    const stamp = nowIso();
    let players: GamePlayer[];
    if (existing) {
      players = session.players.map((player) =>
        player.userId === userId
          ? { ...player, status: 'joined' as const }
          : player);
    } else {
      players = [
        ...session.players,
        { userId, status: 'joined', score: 0, answers: {} },
      ];
    }

    if (players.filter((player) => player.status === 'joined').length > maxPlayers) {
      return res.status(409).json({ error: `This game is full (max ${maxPlayers}).` });
    }

    const next: GameSession = { ...session, players, updatedAt: stamp };
    await saveSession(deps, next);
    emitSession(deps, next, 'joined');
    return res.json({ session: toPublicSession(next) });
  });

  app.post('/api/games/sessions/:id/decline', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid decline payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status !== 'lobby') {
      return res.status(409).json({ error: 'This session is no longer in lobby.' });
    }
    if (session.hostUserId === userId) {
      return res.status(400).json({ error: 'Host cannot decline — cancel the session instead.' });
    }

    const existing = findPlayer(session, userId);
    if (!existing) return res.status(404).json({ error: 'You were not invited to this session.' });
    if (existing.status === 'left') {
      return res.json({ session: toPublicSession(session), alreadyDeclined: true });
    }

    const next: GameSession = {
      ...session,
      players: session.players.map((player) =>
        player.userId === userId ? { ...player, status: 'left' as const } : player),
      updatedAt: nowIso(),
    };
    await saveSession(deps, next);
    emitSession(deps, next, 'declined');
    return res.json({ session: toPublicSession(next) });
  });

  app.post('/api/games/sessions/:id/start', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid start payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can start this game.' });
    }
    if (session.status !== 'lobby') {
      return res.status(409).json({ error: 'Session already started or closed.' });
    }

    const catalog = await findCatalogBySlug(deps, session.gameSlug);
    if (!catalog || catalog.comingSoon) {
      return res.status(403).json({ error: 'This game cannot be started.' });
    }
    const joined = joinedPlayers(session);
    if (joined.length < catalog.minPlayers) {
      return res.status(400).json({
        error: `Need at least ${catalog.minPlayers} joined players to start.`,
      });
    }
    if (joined.length > catalog.maxPlayers) {
      return res.status(400).json({
        error: `Too many players (max ${catalog.maxPlayers}).`,
      });
    }

    const rounds = catalog.kind === 'would-you-rather' ? pickWyrRounds() : pickQuizRounds();
    const stamp = nowIso();
    const next: GameSession = {
      ...session,
      status: 'active',
      rounds,
      roundIndex: 0,
      roundStartedAt: stamp,
      updatedAt: stamp,
      // Drop invitees who never joined from the active set (keep as invited for history).
      players: session.players.map((player) =>
        player.status === 'invited' ? { ...player, status: 'left' as const } : player),
    };
    await saveSession(deps, next);
    scheduleRoundTimeout(deps, next);
    emitSession(deps, next, 'started');
    emitRound(deps, next, { phase: 'prompt' });
    return res.json({ session: toPublicSession(next) });
  });

  app.post('/api/games/sessions/:id/answer', async (req, res) => {
    const parseResult = answerSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid answer payload.',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    let session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session = await maybeResolveStaleRound(deps, session);

    if (session.status !== 'active') {
      return res.status(409).json({
        error: session.status === 'finished' ? 'Session already finished.' : 'Session is not active.',
      });
    }

    const player = findPlayer(session, userId);
    if (!player || player.status !== 'joined') {
      return res.status(403).json({ error: 'Only joined players can answer.' });
    }
    if (parseResult.data.roundIndex !== session.roundIndex) {
      return res.status(409).json({
        error: 'Wrong round.',
        currentRoundIndex: session.roundIndex,
      });
    }
    if (roundTimedOut(session)) {
      const resolved = await advanceOrFinish(deps, session);
      return res.status(409).json({
        error: 'Round timed out.',
        session: toPublicSession(resolved),
      });
    }

    const round = session.rounds[session.roundIndex];
    if (!round) return res.status(500).json({ error: 'Round missing.' });
    if (parseResult.data.answerIndex < 0 || parseResult.data.answerIndex >= round.options.length) {
      return res.status(400).json({ error: 'Invalid answer index.' });
    }

    const answerKey = String(session.roundIndex);
    if (Object.prototype.hasOwnProperty.call(player.answers, answerKey)) {
      return res.status(409).json({ error: 'Already answered this round.' });
    }

    // Server scores only after round resolves — never trust client final scores.
    const nextPlayers = session.players.map((entry) => {
      if (entry.userId !== userId) return entry;
      return {
        ...entry,
        answers: { ...entry.answers, [answerKey]: parseResult.data.answerIndex },
      };
    });
    let next: GameSession = {
      ...session,
      players: nextPlayers,
      updatedAt: nowIso(),
    };
    await saveSession(deps, next);
    emitSession(deps, next, 'answered');

    if (allActiveAnswered(next, session.roundIndex)) {
      next = await advanceOrFinish(deps, next);
    }

    return res.json({
      session: toPublicSession(next),
      accepted: true,
      // Reveal correctness only after the round advances (or immediately in result phase).
      correctAnswerIndex:
        next.status !== 'active' || next.roundIndex !== session.roundIndex
          ? (round.kind === 'quiz' ? round.correctAnswerIndex : undefined)
          : undefined,
    });
  });

  app.post('/api/games/sessions/:id/leave', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid leave payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    let session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const player = findPlayer(session, userId);
    if (!player || player.status === 'left') {
      return res.json({ session: toPublicSession(session), alreadyLeft: true });
    }

    if (session.hostUserId === userId && (session.status === 'lobby' || session.status === 'active')) {
      clearRoundTimer(session.id, session.roundIndex);
      const cancelled: GameSession = {
        ...session,
        status: 'cancelled',
        finishedAt: nowIso(),
        updatedAt: nowIso(),
        players: session.players.map((entry) =>
          entry.userId === userId ? { ...entry, status: 'left' as const } : entry),
      };
      await saveSession(deps, cancelled);
      emitSession(deps, cancelled, 'cancelled');
      return res.json({ session: toPublicSession(cancelled), cancelled: true });
    }

    const next: GameSession = {
      ...session,
      players: session.players.map((entry) =>
        entry.userId === userId ? { ...entry, status: 'left' as const } : entry),
      updatedAt: nowIso(),
    };
    await saveSession(deps, next);

    if (session.status === 'active') {
      const remaining = joinedPlayers(next);
      if (remaining.length === 0) {
        clearRoundTimer(next.id, next.roundIndex);
        const cancelled: GameSession = {
          ...next,
          status: 'cancelled',
          finishedAt: nowIso(),
          updatedAt: nowIso(),
        };
        await saveSession(deps, cancelled);
        emitSession(deps, cancelled, 'cancelled');
        return res.json({ session: toPublicSession(cancelled), cancelled: true });
      }
      if (allActiveAnswered(next, next.roundIndex)) {
        session = await advanceOrFinish(deps, next);
        return res.json({ session: toPublicSession(session) });
      }
    }

    emitSession(deps, next, 'left');
    return res.json({ session: toPublicSession(next) });
  });

  app.post('/api/games/sessions/:id/cancel', async (req, res) => {
    const parseResult = userOnlySchema.safeParse(req.body ?? {});
    if (!parseResult.success) return res.status(400).json({ error: 'Invalid cancel payload.' });
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const session = await findSession(deps, param(req.params.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.hostUserId !== userId) {
      return res.status(403).json({ error: 'Only the host can cancel this session.' });
    }
    if (session.status === 'finished' || session.status === 'cancelled') {
      return res.json({ session: toPublicSession(session), alreadyClosed: true });
    }

    clearRoundTimer(session.id, session.roundIndex);
    const next: GameSession = {
      ...session,
      status: 'cancelled',
      finishedAt: nowIso(),
      updatedAt: nowIso(),
    };
    await saveSession(deps, next);
    emitSession(deps, next, 'cancelled');
    return res.json({ session: toPublicSession(next) });
  });

  registerGameSocketHandlers(deps);
};

function registerGameSocketHandlers(deps: GamesDeps) {
  deps.io.on('connection', (socket: Socket) => {
    socket.on(
      'game:join',
      async (payload: { sessionId?: string; userId?: string } = {}) => {
        try {
          const sessionId = String(payload.sessionId || '');
          const userId = String(payload.userId || '');
          if (!sessionId || !userId) return;

          const session = await findSession(deps, sessionId);
          if (!session) {
            socket.emit('game:session', { action: 'join_rejected', error: 'Session not found' });
            return;
          }
          const player = findPlayer(session, userId);
          if (!player && session.hostUserId !== userId) {
            socket.emit('game:session', {
              action: 'join_rejected',
              error: 'Not a player in this session.',
            });
            return;
          }

          socket.join(sessionChannel(sessionId));
          socket.join(`user:${userId}`);
          socket.data.gameSessionId = sessionId;
          socket.data.gameUserId = userId;

          const current = await maybeResolveStaleRound(deps, session);
          socket.emit('game:session', {
            session: toPublicSession(current),
            action: 'joined_room',
          });
          if (current.status === 'active') {
            socket.emit('game:round', {
              sessionId: current.id,
              roundIndex: current.roundIndex,
              round: publicRound(current.rounds[current.roundIndex], false),
              roundStartedAt: current.roundStartedAt,
              roundTimeoutMs: current.roundTimeoutMs,
              phase: 'prompt',
              session: toPublicSession(current),
            });
          }
          if (current.status === 'finished') {
            socket.emit('game:finished', {
              sessionId: current.id,
              session: toPublicSession(current),
              results: current.results,
            });
          }
        } catch {
          // ignore malformed join
        }
      },
    );

    socket.on(
      'game:leave',
      (payload: { sessionId?: string } = {}) => {
        const sessionId = String(payload.sessionId || socket.data.gameSessionId || '');
        if (!sessionId) return;
        socket.leave(sessionChannel(sessionId));
        if (socket.data.gameSessionId === sessionId) {
          socket.data.gameSessionId = undefined;
        }
      },
    );
  });
}
