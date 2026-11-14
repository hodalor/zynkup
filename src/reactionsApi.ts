/**
 * B4 Animated / sound-enabled reactions
 *
 * Curated catalog of standard, animated, and sound-keyed reactions.
 * Sound keys are procedural cue names (laugh, clap, pop, …) — clients map
 * them to short licensed/OS cues or stay silent. No binary assets ship here.
 * Clients must not autoplay reaction sound; respect profile + per-chat mute.
 *
 * Per-chat reaction-sound mute can also be kept entirely client-side; the
 * optional POST /api/chats/:chatId/reaction-sound-mute endpoint is a convenience
 * sync for multi-device.
 */

import type { Express, Request } from 'express';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type ReactionKind = 'standard' | 'animated' | 'sound';

export type ReactionCatalogEntry = {
  id: string;
  emoji: string;
  label: string;
  kind: ReactionKind;
  animationKey?: string;
  soundKey?: string;
  fallbackEmoji: string;
};

export type MessageReaction = {
  userId: string;
  emoji: string;
  reactionId?: string;
  reactedAt: string;
};

export type MessageReactionAction = 'add' | 'remove' | 'replace';

export type MessageReactionEvent = {
  messageId: string;
  chatId: string;
  reactions: MessageReaction[];
  reactorUserId: string;
  emoji: string;
  action: MessageReactionAction;
};

type ReactableMessage = {
  id: string;
  chatId: string;
  reactions?: MessageReaction[];
  deletedForEveryone?: boolean;
  deletedFor?: string[];
  [key: string]: unknown;
};

type ReactableChat = {
  id: string;
  participants: string[];
  reactionSoundMutedBy?: string[];
  updatedAt?: string;
  [key: string]: unknown;
};

export type ReactionsDeps = {
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  readMessages: () => Promise<ReactableMessage[]>;
  saveMessageUpdate: (message: ReactableMessage) => Promise<ReactableMessage>;
  readChats: () => Promise<ReactableChat[]>;
  saveChatRecord: (chat: ReactableChat) => Promise<ReactableChat>;
  presentMessage: (message: ReactableMessage, viewerId: string) => ReactableMessage;
};

/** Procedural cue keys only — no copyrighted audio files in the repo. */
export const REACTION_CATALOG: ReactionCatalogEntry[] = [
  {
    id: 'heart',
    emoji: '❤️',
    label: 'Love',
    kind: 'animated',
    animationKey: 'pulse',
    fallbackEmoji: '❤️',
  },
  {
    id: 'laugh',
    emoji: '😂',
    label: 'Laugh',
    kind: 'sound',
    soundKey: 'laugh',
    animationKey: 'bounce',
    fallbackEmoji: '😂',
  },
  {
    id: 'fire',
    emoji: '🔥',
    label: 'Fire',
    kind: 'animated',
    animationKey: 'flicker',
    fallbackEmoji: '🔥',
  },
  {
    id: 'clap',
    emoji: '👏',
    label: 'Clap',
    kind: 'sound',
    soundKey: 'clap',
    animationKey: 'clap',
    fallbackEmoji: '👏',
  },
  {
    id: 'wow',
    emoji: '😮',
    label: 'Wow',
    kind: 'standard',
    fallbackEmoji: '😮',
  },
  {
    id: 'cry',
    emoji: '😢',
    label: 'Sad',
    kind: 'standard',
    fallbackEmoji: '😢',
  },
  {
    id: 'party',
    emoji: '🎉',
    label: 'Celebrate',
    kind: 'animated',
    animationKey: 'confetti',
    soundKey: 'party',
    fallbackEmoji: '🎉',
  },
  {
    id: 'pray',
    emoji: '🙏',
    label: 'Thanks',
    kind: 'standard',
    fallbackEmoji: '🙏',
  },
  {
    id: 'thumbs',
    emoji: '👍',
    label: 'Like',
    kind: 'standard',
    fallbackEmoji: '👍',
  },
  {
    id: 'sparkle',
    emoji: '✨',
    label: 'Sparkle',
    kind: 'animated',
    animationKey: 'sparkle',
    fallbackEmoji: '✨',
  },
  {
    id: 'pop',
    emoji: '💥',
    label: 'Pop',
    kind: 'sound',
    soundKey: 'pop',
    animationKey: 'pop',
    fallbackEmoji: '💥',
  },
  {
    id: 'hundred',
    emoji: '💯',
    label: 'Hundred',
    kind: 'standard',
    fallbackEmoji: '💯',
  },
];

const catalogById = new Map(REACTION_CATALOG.map((entry) => [entry.id, entry]));
const catalogByEmoji = new Map(REACTION_CATALOG.map((entry) => [entry.emoji, entry]));

export const findReactionById = (reactionId: string) => catalogById.get(reactionId) ?? null;

export const findReactionByEmoji = (emoji: string) => catalogByEmoji.get(emoji) ?? null;

/** Allow curated catalog entries or a short custom emoji grapheme (static fallback). */
export const isAllowedReactionEmoji = (emoji: string) => {
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 8) return false;
  if (catalogByEmoji.has(trimmed)) return true;
  // Reject obvious non-emoji text (whitespace / control / bare ASCII words).
  if (/^[\x00-\x7F]+$/.test(trimmed) && !/^[\u2600-\u27BF]$/.test(trimmed)) {
    return false;
  }
  return true;
};

export type ResolvedReaction = {
  emoji: string;
  reactionId?: string;
};

export const resolveReactionSelection = (input: {
  emoji?: string;
  reactionId?: string;
}): { ok: true; value: ResolvedReaction } | { ok: false; error: string } => {
  if (input.reactionId) {
    const entry = findReactionById(input.reactionId);
    if (!entry) return { ok: false, error: 'Unknown reactionId' };
    return { ok: true, value: { emoji: entry.emoji, reactionId: entry.id } };
  }
  const emoji = (input.emoji || '').trim();
  if (!emoji) return { ok: false, error: 'Provide emoji or reactionId' };
  if (!isAllowedReactionEmoji(emoji)) {
    return { ok: false, error: 'Invalid emoji reaction' };
  }
  const entry = findReactionByEmoji(emoji);
  return {
    ok: true,
    value: {
      emoji,
      reactionId: entry?.id,
    },
  };
};

const toggleMessageReactionSchema = z
  .object({
    userId: z.string().min(1).optional(),
    emoji: z.string().min(1).max(8).optional(),
    reactionId: z.string().min(1).max(40).optional(),
  })
  .refine((value) => Boolean(value.emoji?.trim() || value.reactionId?.trim()), {
    message: 'Provide emoji or reactionId',
  });

const clearMessageReactionSchema = z.object({
  userId: z.string().min(1).optional(),
});

const reactionSoundMuteSchema = z.object({
  userId: z.string().min(1).optional(),
  muted: z.boolean(),
});

const applyToggle = (
  reactions: MessageReaction[],
  userId: string,
  selection: ResolvedReaction,
): { reactions: MessageReaction[]; action: MessageReactionAction; emoji: string } => {
  const existing = reactions.find((reaction) => reaction.userId === userId);
  const withoutMine = reactions.filter((reaction) => reaction.userId !== userId);

  if (existing && existing.emoji === selection.emoji) {
    return { reactions: withoutMine, action: 'remove', emoji: selection.emoji };
  }

  const next: MessageReaction = {
    userId,
    emoji: selection.emoji,
    reactedAt: new Date().toISOString(),
  };
  if (selection.reactionId) next.reactionId = selection.reactionId;

  return {
    reactions: [...withoutMine, next],
    action: existing ? 'replace' : 'add',
    emoji: selection.emoji,
  };
};

const emitReaction = (
  deps: ReactionsDeps,
  chat: ReactableChat,
  message: ReactableMessage,
  payload: Omit<MessageReactionEvent, 'messageId' | 'chatId' | 'reactions'> & {
    reactions: MessageReaction[];
  },
) => {
  const event: MessageReactionEvent = {
    messageId: message.id,
    chatId: chat.id,
    reactions: payload.reactions,
    reactorUserId: payload.reactorUserId,
    emoji: payload.emoji,
    action: payload.action,
  };
  for (const participantId of chat.participants) {
    deps.io.to(`user:${participantId}`).emit('message:reaction', {
      ...event,
      message: deps.presentMessage({ ...message, reactions: payload.reactions }, participantId),
    });
  }
};

export const registerReactionsApi = (app: Express, deps: ReactionsDeps) => {
  app.get('/api/reactions/catalog', (_req, res) => {
    return res.json({
      reactions: REACTION_CATALOG,
      /**
       * Clients map soundKey → short licensed/OS cue or silent.
       * No autoplay: honor reactionSoundEnabled (default false), reduced-motion,
       * global mute, and per-chat mute (client-side and/or reactionSoundMutedBy).
       */
      notes: {
        soundKeysAreProcedural: true,
        noBundledAudio: true,
        defaultReactionSoundEnabled: false,
        defaultReactionAnimationEnabled: true,
        perChatMutePreferClient: true,
        messageIntelligibleWithoutSound: true,
      },
    });
  });

  app.post('/api/messages/:messageId/reactions', async (req, res) => {
    const parseResult = toggleMessageReactionSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid reaction payload',
        details: z.flattenError(parseResult.error),
      });
    }

    const resolved = resolveReactionSelection({
      emoji: parseResult.data.emoji,
      reactionId: parseResult.data.reactionId,
    });
    if (!resolved.ok) {
      return res.status(400).json({ error: resolved.error });
    }

    const userId = parseResult.data.userId || (await deps.resolveRequestUserId(req));
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const message = (await deps.readMessages()).find((entry) => entry.id === req.params.messageId);
    if (!message || message.deletedForEveryone) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (Array.isArray(message.deletedFor) && message.deletedFor.includes(userId)) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const chat = (await deps.readChats()).find((entry) => entry.id === message.chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'You are not in this chat.' });
    }

    const toggled = applyToggle(message.reactions || [], userId, resolved.value);
    const updated: ReactableMessage = {
      ...message,
      reactions: toggled.reactions,
    };
    await deps.saveMessageUpdate(updated);
    emitReaction(deps, chat, updated, {
      reactions: toggled.reactions,
      reactorUserId: userId,
      emoji: toggled.emoji,
      action: toggled.action,
    });

    return res.json({
      message: deps.presentMessage(updated, userId),
      reactions: toggled.reactions,
      action: toggled.action,
    });
  });

  app.delete('/api/messages/:messageId/reactions', async (req, res) => {
    const parseResult = clearMessageReactionSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid reaction clear payload',
        details: z.flattenError(parseResult.error),
      });
    }

    const userId = parseResult.data.userId || (await deps.resolveRequestUserId(req));
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const message = (await deps.readMessages()).find((entry) => entry.id === req.params.messageId);
    if (!message || message.deletedForEveryone) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const chat = (await deps.readChats()).find((entry) => entry.id === message.chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'You are not in this chat.' });
    }

    const existing = (message.reactions || []).find((reaction) => reaction.userId === userId);
    if (!existing) {
      return res.json({
        message: deps.presentMessage(message, userId),
        reactions: message.reactions || [],
        action: 'remove' as const,
      });
    }

    const nextReactions = (message.reactions || []).filter((reaction) => reaction.userId !== userId);
    const updated: ReactableMessage = {
      ...message,
      reactions: nextReactions,
    };
    await deps.saveMessageUpdate(updated);
    emitReaction(deps, chat, updated, {
      reactions: nextReactions,
      reactorUserId: userId,
      emoji: existing.emoji,
      action: 'remove',
    });

    return res.json({
      message: deps.presentMessage(updated, userId),
      reactions: nextReactions,
      action: 'remove' as const,
    });
  });

  /**
   * Optional sync for multi-device. Clients may instead keep per-chat reaction
   * sound mute locally (global mute / reduced-motion stay client-side).
   */
  app.post('/api/chats/:chatId/reaction-sound-mute', async (req, res) => {
    const parseResult = reactionSoundMuteSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid reaction-sound mute payload',
        details: z.flattenError(parseResult.error),
      });
    }

    const userId = parseResult.data.userId || (await deps.resolveRequestUserId(req));
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const chat = (await deps.readChats()).find((entry) => entry.id === req.params.chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const mutedSet = new Set(chat.reactionSoundMutedBy || []);
    if (parseResult.data.muted) mutedSet.add(userId);
    else mutedSet.delete(userId);

    const updated: ReactableChat = {
      ...chat,
      reactionSoundMutedBy: [...mutedSet],
      updatedAt: new Date().toISOString(),
    };
    await deps.saveChatRecord(updated);
    deps.io.to(`user:${userId}`).emit('chat:updated', updated);

    return res.json({
      chat: updated,
      muted: parseResult.data.muted,
      note: 'Per-chat reaction sound mute may also be stored client-side only.',
    });
  });
};
