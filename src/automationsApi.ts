/**
 * I5 Workflow automation builder (v1 rules engine)
 *
 * Simple per-owner rules: trigger → action. Message-like actions stay draft_only
 * (never auto-send). Fires store a run log and emit `automation:fired`.
 */

import crypto from 'crypto';
import type { Express, Request } from 'express';
import type { Db } from 'mongodb';
import type { Server } from 'socket.io';
import { z } from 'zod';

export type AutomationTrigger =
  | 'new_message'
  | 'new_order'
  | 'low_stock'
  | 'payment_request_paid';

export type AutomationAction =
  | 'draft_reply_template'
  | 'notify_owner'
  | 'create_reminder'
  | 'label_chat';

export type AutomationRule = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  /** Template / draft body; also used as reminder note when action=create_reminder. */
  templateText: string;
  /** Tag applied when action=label_chat (falls back to templateText). */
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  ruleId: string;
  ownerUserId: string;
  businessId?: string | null;
  trigger: AutomationTrigger;
  action: AutomationAction;
  status: 'fired' | 'draft_ready' | 'notified' | 'reminder_set' | 'labeled';
  summary: string;
  draftText?: string;
  chatId?: string | null;
  messageId?: string | null;
  orderId?: string | null;
  paymentRequestId?: string | null;
  catalogItemId?: string | null;
  customerId?: string | null;
  labelApplied?: string | null;
  /** Always false — message actions never auto-send. */
  autoSend: false;
  createdAt: string;
};

export type AutomationCustomer = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
  customerUserId?: string | null;
  displayName: string;
  phone?: string;
  tags: string[];
  notes: Array<{ id: string; text: string; byUserId: string; createdAt: string }>;
  followUpAt?: string | null;
  followUpNote?: string;
  marketingConsent: 'unknown' | 'opted_in' | 'opted_out';
  marketingConsentUpdatedAt?: string | null;
  orderIds: string[];
  lastOrderAt?: string | null;
  orderCount: number;
  totalSpent: number;
  currency?: string;
  chatId?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationsDeps = {
  getDb: () => Promise<Db | null>;
  io: Server;
  resolveRequestUserId: (req: Request) => Promise<string>;
  notifyOfflineUser?: (
    userId: string,
    title: string,
    body: string,
    data: Record<string, string>,
    channel: 'messages' | 'calls',
  ) => Promise<boolean>;
  findCustomer?: (params: {
    sellerUserId: string;
    customerUserId?: string | null;
    chatId?: string | null;
    businessId?: string | null;
  }) => Promise<AutomationCustomer | null>;
  saveCustomer?: (customer: AutomationCustomer) => Promise<AutomationCustomer>;
  ensureCustomer?: (params: {
    sellerUserId: string;
    customerUserId?: string | null;
    chatId?: string | null;
    businessId?: string | null;
    displayName?: string;
  }) => Promise<AutomationCustomer | null>;
};

const TRIGGERS: AutomationTrigger[] = [
  'new_message',
  'new_order',
  'low_stock',
  'payment_request_paid',
];

const ACTIONS: AutomationAction[] = [
  'draft_reply_template',
  'notify_owner',
  'create_reminder',
  'label_chat',
];

const seedRules: AutomationRule[] = [];
const seedRuns: AutomationRun[] = [];

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}${Date.now()}${crypto.randomBytes(3).toString('hex')}`;
const param = (value: string | string[] | undefined) =>
  String(Array.isArray(value) ? value[0] : value || '');

const upsertSeed = <T extends { id: string }>(list: T[], item: T) => {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.unshift(item);
  return item;
};

const createRuleSchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  trigger: z.enum(['new_message', 'new_order', 'low_stock', 'payment_request_paid']),
  action: z.enum(['draft_reply_template', 'notify_owner', 'create_reminder', 'label_chat']),
  templateText: z.string().trim().max(2000).optional(),
  label: z.string().trim().max(60).optional(),
  enabled: z.boolean().optional(),
});

const patchRuleSchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  trigger: z.enum(['new_message', 'new_order', 'low_stock', 'payment_request_paid']).optional(),
  action: z
    .enum(['draft_reply_template', 'notify_owner', 'create_reminder', 'label_chat'])
    .optional(),
  templateText: z.string().trim().max(2000).optional(),
  label: z.string().trim().max(60).optional(),
  enabled: z.boolean().optional(),
});

async function ensureIndexes(deps: AutomationsDeps) {
  const db = await deps.getDb();
  if (!db) return;
  try {
    await db.collection('automations').createIndex({ ownerUserId: 1 }, { name: 'automations_owner' });
    await db
      .collection('automations')
      .createIndex({ ownerUserId: 1, trigger: 1, enabled: 1 }, { name: 'automations_trigger' });
    await db
      .collection('automationRuns')
      .createIndex({ ownerUserId: 1, createdAt: -1 }, { name: 'automationRuns_owner' });
  } catch {
    // Indexes may already exist.
  }
}

async function readRulesForOwner(
  deps: AutomationsDeps,
  ownerUserId: string,
  businessId?: string | null,
) {
  const db = await deps.getDb();
  if (!db) {
    return seedRules.filter((rule) => {
      if (rule.ownerUserId !== ownerUserId) return false;
      if (businessId) return rule.businessId === businessId || !rule.businessId;
      return true;
    });
  }
  const filter: Record<string, unknown> = { ownerUserId };
  if (businessId) {
    filter.$or = [{ businessId }, { businessId: null }, { businessId: { $exists: false } }];
  }
  return db
    .collection<AutomationRule>('automations')
    .find(filter, { projection: { _id: 0 } })
    .sort({ updatedAt: -1 })
    .toArray();
}

async function findRuleById(deps: AutomationsDeps, id: string) {
  const db = await deps.getDb();
  if (!db) return seedRules.find((rule) => rule.id === id) ?? null;
  return db.collection<AutomationRule>('automations').findOne({ id }, { projection: { _id: 0 } });
}

async function saveRule(deps: AutomationsDeps, rule: AutomationRule) {
  const db = await deps.getDb();
  if (!db) return upsertSeed(seedRules, rule);
  await db.collection<AutomationRule>('automations').updateOne({ id: rule.id }, { $set: rule }, { upsert: true });
  return rule;
}

async function deleteRule(deps: AutomationsDeps, id: string) {
  const db = await deps.getDb();
  if (!db) {
    const index = seedRules.findIndex((rule) => rule.id === id);
    if (index >= 0) seedRules.splice(index, 1);
    return;
  }
  await db.collection('automations').deleteOne({ id });
}

async function saveRun(deps: AutomationsDeps, run: AutomationRun) {
  const db = await deps.getDb();
  if (!db) {
    seedRuns.unshift(run);
    if (seedRuns.length > 500) seedRuns.length = 500;
    return run;
  }
  await db.collection<AutomationRun>('automationRuns').insertOne(run);
  return run;
}

async function readRunsForOwner(deps: AutomationsDeps, ownerUserId: string, limit = 50) {
  const db = await deps.getDb();
  if (!db) return seedRuns.filter((run) => run.ownerUserId === ownerUserId).slice(0, limit);
  return db
    .collection<AutomationRun>('automationRuns')
    .find({ ownerUserId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

const defaultNameFor = (trigger: AutomationTrigger, action: AutomationAction) => {
  const triggerLabel: Record<AutomationTrigger, string> = {
    new_message: 'New message',
    new_order: 'New order',
    low_stock: 'Low stock',
    payment_request_paid: 'Payment paid',
  };
  const actionLabel: Record<AutomationAction, string> = {
    draft_reply_template: 'draft reply',
    notify_owner: 'notify me',
    create_reminder: 'create reminder',
    label_chat: 'label chat',
  };
  return `${triggerLabel[trigger]} → ${actionLabel[action]}`;
};

const renderTemplate = (template: string, vars: Record<string, string>) => {
  let text = template || '';
  for (const [key, value] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), value);
  }
  return text.trim();
};

const emitToOwner = (
  deps: AutomationsDeps,
  ownerUserId: string,
  event: string,
  payload: Record<string, unknown>,
) => {
  deps.io.to(`user:${ownerUserId}`).emit(event, payload);
};

export type EvaluateAutomationParams = {
  ownerUserId: string;
  businessId?: string | null;
  trigger: AutomationTrigger;
  chatId?: string | null;
  messageId?: string | null;
  orderId?: string | null;
  paymentRequestId?: string | null;
  catalogItemId?: string | null;
  customerUserId?: string | null;
  customerDisplayName?: string;
  contextSummary?: string;
  templateVars?: Record<string, string>;
};

/**
 * Evaluate enabled rules for a trigger. Safe to call fire-and-forget from server hooks.
 * draft_reply_template never sends a message — only stores draftText on the run.
 */
export async function evaluateAutomations(
  deps: AutomationsDeps,
  params: EvaluateAutomationParams,
): Promise<AutomationRun[]> {
  const ownerUserId = (params.ownerUserId || '').trim();
  if (!ownerUserId || !TRIGGERS.includes(params.trigger)) return [];

  let rules: AutomationRule[] = [];
  try {
    rules = await readRulesForOwner(deps, ownerUserId, params.businessId || null);
  } catch {
    return [];
  }

  const matching = rules.filter(
    (rule) => rule.enabled !== false && rule.trigger === params.trigger && ACTIONS.includes(rule.action),
  );
  if (!matching.length) return [];

  const vars: Record<string, string> = {
    name: params.customerDisplayName || 'Customer',
    summary: params.contextSummary || '',
    orderId: params.orderId || '',
    chatId: params.chatId || '',
    ...(params.templateVars || {}),
  };

  const runs: AutomationRun[] = [];
  for (const rule of matching) {
    try {
      const run = await fireRule(deps, rule, params, vars);
      if (run) runs.push(run);
    } catch {
      // Never fail the primary event because automation failed.
    }
  }
  return runs;
}

async function fireRule(
  deps: AutomationsDeps,
  rule: AutomationRule,
  params: EvaluateAutomationParams,
  vars: Record<string, string>,
): Promise<AutomationRun | null> {
  const stamp = nowIso();
  const rendered = renderTemplate(rule.templateText || '', vars);
  let status: AutomationRun['status'] = 'fired';
  let summary = `Automation “${rule.name}” fired`;
  let draftText: string | undefined;
  let customerId: string | null = null;
  let labelApplied: string | null = null;

  if (rule.action === 'draft_reply_template') {
    draftText =
      rendered
      || `Thanks for reaching out — we'll get back to you shortly.`;
    // Prefix so owners know this is an automation draft, not a sent message.
    if (!/^Automated draft/i.test(draftText)) {
      draftText = `Automated draft (workflow — not sent):\n\n${draftText}`;
    }
    status = 'draft_ready';
    summary = `Draft ready for review (never auto-sent)`;
  } else if (rule.action === 'notify_owner') {
    status = 'notified';
    summary = rendered || params.contextSummary || `Automation: ${rule.name}`;
    if (deps.notifyOfflineUser) {
      void deps.notifyOfflineUser(
        rule.ownerUserId,
        'Automation',
        summary.slice(0, 180),
        {
          type: 'automation',
          ruleId: rule.id,
          trigger: rule.trigger,
          chatId: params.chatId || '',
        },
        'messages',
      );
    }
  } else if (rule.action === 'create_reminder') {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const note = rendered || `Follow up (${rule.name})`;
    let customer: AutomationCustomer | null = null;
    if (deps.findCustomer) {
      customer = await deps.findCustomer({
        sellerUserId: rule.ownerUserId,
        customerUserId: params.customerUserId,
        chatId: params.chatId,
        businessId: rule.businessId || params.businessId,
      });
    }
    if (!customer && deps.ensureCustomer) {
      customer = await deps.ensureCustomer({
        sellerUserId: rule.ownerUserId,
        customerUserId: params.customerUserId,
        chatId: params.chatId,
        businessId: rule.businessId || params.businessId,
        displayName: params.customerDisplayName || 'Customer',
      });
    }
    if (customer && deps.saveCustomer) {
      const next: AutomationCustomer = {
        ...customer,
        followUpAt,
        followUpNote: note.slice(0, 400),
        chatId: customer.chatId || params.chatId || null,
        updatedAt: stamp,
      };
      await deps.saveCustomer(next);
      customerId = next.id;
      status = 'reminder_set';
      summary = `Reminder set for ${new Date(followUpAt).toLocaleString()}`;
    } else {
      status = 'fired';
      summary = 'Reminder skipped — no customer record';
    }
  } else if (rule.action === 'label_chat') {
    const tag = (rule.label || rendered || 'automation').trim().slice(0, 40);
    let customer: AutomationCustomer | null = null;
    if (deps.findCustomer) {
      customer = await deps.findCustomer({
        sellerUserId: rule.ownerUserId,
        customerUserId: params.customerUserId,
        chatId: params.chatId,
        businessId: rule.businessId || params.businessId,
      });
    }
    if (!customer && deps.ensureCustomer) {
      customer = await deps.ensureCustomer({
        sellerUserId: rule.ownerUserId,
        customerUserId: params.customerUserId,
        chatId: params.chatId,
        businessId: rule.businessId || params.businessId,
        displayName: params.customerDisplayName || 'Customer',
      });
    }
    if (customer && deps.saveCustomer && tag) {
      const tags = Array.from(new Set([...(customer.tags || []), tag])).slice(0, 24);
      const next: AutomationCustomer = {
        ...customer,
        tags,
        chatId: customer.chatId || params.chatId || null,
        updatedAt: stamp,
      };
      await deps.saveCustomer(next);
      customerId = next.id;
      labelApplied = tag;
      status = 'labeled';
      summary = `Labeled “${tag}”`;
    } else {
      status = 'fired';
      summary = 'Label skipped — no customer record';
    }
  }

  const run: AutomationRun = {
    id: newId('arun'),
    ruleId: rule.id,
    ownerUserId: rule.ownerUserId,
    businessId: rule.businessId || params.businessId || null,
    trigger: rule.trigger,
    action: rule.action,
    status,
    summary,
    draftText,
    chatId: params.chatId || null,
    messageId: params.messageId || null,
    orderId: params.orderId || null,
    paymentRequestId: params.paymentRequestId || null,
    catalogItemId: params.catalogItemId || null,
    customerId,
    labelApplied,
    autoSend: false,
    createdAt: stamp,
  };

  await saveRun(deps, run);
  emitToOwner(deps, rule.ownerUserId, 'automation:fired', {
    run,
    rule: { id: rule.id, name: rule.name, trigger: rule.trigger, action: rule.action },
    autoSend: false,
  });
  return run;
}

const resolveUserId = async (deps: AutomationsDeps, req: Request, bodyUserId?: string) => {
  if (bodyUserId?.trim()) return bodyUserId.trim();
  return deps.resolveRequestUserId(req);
};

export const registerAutomationsApi = (app: Express, deps: AutomationsDeps) => {
  void ensureIndexes(deps);

  app.get('/api/automations', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const businessId =
      typeof req.query.businessId === 'string' ? req.query.businessId : null;
    const rules = await readRulesForOwner(deps, userId, businessId);
    return res.json({
      rules,
      triggers: TRIGGERS,
      actions: ACTIONS,
      notice: 'Message actions stay draft_only — never auto-send.',
    });
  });

  app.get('/api/automations/logs', async (req, res) => {
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string' ? req.query.userId : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const logs = await readRunsForOwner(deps, userId, 100);
    return res.json({ logs });
  });

  app.post('/api/automations', async (req, res) => {
    const parseResult = createRuleSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid automation rule',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const stamp = nowIso();
    const rule: AutomationRule = {
      id: newId('auto'),
      ownerUserId: userId,
      businessId: parseResult.data.businessId ?? null,
      name:
        parseResult.data.name?.trim()
        || defaultNameFor(parseResult.data.trigger, parseResult.data.action),
      trigger: parseResult.data.trigger,
      action: parseResult.data.action,
      templateText: (parseResult.data.templateText || '').trim().slice(0, 2000),
      label: (parseResult.data.label || '').trim().slice(0, 60),
      enabled: parseResult.data.enabled !== false,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await saveRule(deps, rule);
    emitToOwner(deps, userId, 'automation:updated', { rule, change: 'created' });
    return res.status(201).json({ rule, autoSend: false });
  });

  app.patch('/api/automations/:id', async (req, res) => {
    const id = param(req.params.id);
    if (!id) return res.status(400).json({ error: 'Missing rule id' });
    const parseResult = patchRuleSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid automation patch',
        details: z.flattenError(parseResult.error),
      });
    }
    const userId = await resolveUserId(deps, req, parseResult.data.userId);
    if (!userId) return res.status(400).json({ error: 'Missing user' });

    const existing = await findRuleById(deps, id);
    if (!existing || existing.ownerUserId !== userId) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const next: AutomationRule = {
      ...existing,
      businessId:
        parseResult.data.businessId === undefined
          ? existing.businessId
          : parseResult.data.businessId,
      name: parseResult.data.name?.trim() || existing.name,
      trigger: parseResult.data.trigger ?? existing.trigger,
      action: parseResult.data.action ?? existing.action,
      templateText:
        parseResult.data.templateText === undefined
          ? existing.templateText
          : parseResult.data.templateText.trim().slice(0, 2000),
      label:
        parseResult.data.label === undefined
          ? existing.label
          : parseResult.data.label.trim().slice(0, 60),
      enabled:
        parseResult.data.enabled === undefined ? existing.enabled : parseResult.data.enabled,
      updatedAt: nowIso(),
    };
    await saveRule(deps, next);
    emitToOwner(deps, userId, 'automation:updated', { rule: next, change: 'updated' });
    return res.json({ rule: next, autoSend: false });
  });

  app.delete('/api/automations/:id', async (req, res) => {
    const id = param(req.params.id);
    const userId = await resolveUserId(
      deps,
      req,
      typeof req.query.userId === 'string'
        ? req.query.userId
        : typeof req.body?.userId === 'string'
          ? req.body.userId
          : undefined,
    );
    if (!userId) return res.status(400).json({ error: 'Missing user' });
    const existing = await findRuleById(deps, id);
    if (!existing || existing.ownerUserId !== userId) {
      return res.status(404).json({ error: 'Automation not found' });
    }
    await deleteRule(deps, id);
    emitToOwner(deps, userId, 'automation:updated', { rule: existing, change: 'deleted' });
    return res.json({ ok: true, id });
  });
};

export const AUTOMATION_TRIGGERS = TRIGGERS;
export const AUTOMATION_ACTIONS = ACTIONS;
