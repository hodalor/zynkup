import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import './App.css';

type View = 'chats' | 'calls' | 'catalog' | 'settings' | 'updates' | 'communities' | 'voiceRooms' | 'games' | 'events' | 'pay';
type PayPanel = 'home' | 'send' | 'request' | 'split' | 'topup' | 'orders' | 'history';
type PayHistoryItem = {
  id: string;
  title: string;
  time: string;
  amount: string;
  positive: boolean;
  status?: string;
  authorizationUrl?: string | null;
  orderId?: string | null;
  paymentRequestId?: string | null;
};
type PaymentShare = {
  userId: string;
  phone?: string;
  name?: string;
  amount: number;
  status: string;
  paymentId?: string | null;
  authorizationUrl?: string | null;
  paidAt?: string | null;
};
type PaymentRequestRecord = {
  id: string;
  kind: 'request' | 'split';
  creatorUserId: string;
  recipientUserId: string;
  amount: number;
  currency: string;
  note?: string;
  chatId?: string | null;
  shares: PaymentShare[];
  status: string;
  createdAt: string;
  updatedAt: string;
};
type ReceiptState = 'pending' | 'sent' | 'delivered' | 'read';

type OutboxMessageBody = {
  chatId: string;
  senderId: string;
  clientRef: string;
  kind: string;
  text: string;
  mediaUrls?: string[];
  replyToMessageId?: string;
  replyPreview?: string;
  anonymous?: boolean;
  durationSeconds?: number;
  viewOnce?: boolean;
};

type OutboxEntry = {
  clientRef: string;
  body: OutboxMessageBody;
};
type SettingsPanelId =
  | 'favorites'
  | 'myCard'
  | 'business'
  | 'history'
  | 'account'
  | 'privacy'
  | 'blocked'
  | 'chats'
  | 'notifications'
  | 'storage'
  | 'help'
  | '';

type DigitalCardState = {
  id?: string;
  code: string;
  displayName: string;
  title: string;
  businessName: string;
  phone: string;
  handle: string;
  email: string;
  bio: string;
  avatarUrl: string;
  theme: 'navy' | 'cyan' | 'magenta' | 'lime' | 'sunset';
};

const WEB_BASE_URL = process.env.REACT_APP_WEB_BASE_URL || 'https://zynkup.app';
const CARD_THEME_OPTIONS: Array<{ id: DigitalCardState['theme']; label: string }> = [
  { id: 'navy', label: 'Navy' },
  { id: 'cyan', label: 'Cyan' },
  { id: 'magenta', label: 'Magenta' },
  { id: 'lime', label: 'Lime' },
  { id: 'sunset', label: 'Sunset' },
];

type ReportReasonId = 'spam' | 'harassment' | 'scam' | 'inappropriate' | 'impersonation' | 'other';

type ReportTargetState = {
  targetUserId?: string;
  targetPhone?: string;
  messageId?: string;
  chatId?: string;
  name?: string;
};

type BlockedContact = {
  id: string;
  name: string;
  phone?: string;
  username?: string;
  photoUri?: string;
};

type ReactionKind = 'standard' | 'animated' | 'sound';

type ReactionCatalogEntry = {
  id: string;
  emoji: string;
  label: string;
  kind: ReactionKind;
  animationKey?: string;
  soundKey?: string;
  fallbackEmoji: string;
};

type MessageReaction = {
  userId: string;
  emoji: string;
  reactionId?: string;
  reactedAt: string;
};

type MessageReactionAction = 'add' | 'remove' | 'replace';

type Message = {
  id: string;
  clientRef?: string;
  sender: 'me' | 'other';
  senderId?: string;
  kind: 'text' | 'image' | 'voice' | 'file' | 'video' | 'call';
  text: string;
  time: string;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  durationLabel?: string;
  receiptState?: ReceiptState;
  replyToMessageId?: string;
  replyPreview?: string;
  callKind?: 'audio' | 'video';
  callState?: 'missed' | 'declined' | 'completed';
  deletedForEveryone?: boolean;
  automated?: boolean;
  anonymous?: boolean;
  documentId?: string;
  documentKind?: 'quotation' | 'invoice';
  transcript?: string;
  transcriptStatus?: 'pending' | 'ready' | 'failed' | 'unavailable';
  transcriptLanguage?: string;
  transcriptUpdatedAt?: string;
  transcriptNotice?: string;
  reactions?: MessageReaction[];
  viewOnce?: boolean;
  viewOnceOpenedAt?: string;
  viewOnceOpenedBy?: string;
  protectedMedia?: boolean;
};

type TranslateLanguage = 'en' | 'tw' | 'ga' | 'ee' | 'pcm';

type MessageTranslation = {
  translatedText: string;
  targetLanguage: TranslateLanguage;
  partial?: boolean;
  needsProvider?: boolean;
  notice?: string;
  method?: string;
};

type Chat = {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: number;
  presence: string;
  lastSeenAt?: string;
  peerUserId?: string;
  kind?: 'direct' | 'group';
  communityId?: string;
  allowAnonymous?: boolean;
  participants?: string[];
  adminIds?: string[];
  reactionSoundMutedBy?: string[];
};

type BadgeType = 'helpful' | 'welcoming' | 'fast_support';
type BadgeSource = 'moderator' | 'system';

type BadgeDefinition = {
  badgeType: BadgeType;
  label: string;
  description: string;
  rules: string;
};

type GroupBadgePublic = {
  id: string;
  chatId: string;
  userId: string;
  badgeType: BadgeType;
  source: BadgeSource;
  awardedBy?: string | null;
  note?: string | null;
  createdAt: string;
  revokedAt?: string | null;
};

type GroupBadgeSettingsPublic = {
  enabled: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
};

type GroupBadgesPayload = {
  settings: GroupBadgeSettingsPublic;
  badges: GroupBadgePublic[];
  definitions: BadgeDefinition[];
};

type CommunityPrivacy = 'public' | 'private' | 'invite-only';
type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';
type MembershipState = 'active' | 'pending' | 'banned' | 'left';
type ModerationState = 'pending' | 'reviewed' | 'dismissed' | 'actioned';

type VoiceRoomPrivacy = 'public' | 'private' | 'invite-only';
type VoiceRoomStatus = 'live' | 'ended';
type VoiceRoomRole = 'host' | 'moderator' | 'speaker' | 'listener';
type VoiceParticipantState = 'active' | 'left' | 'removed' | 'blocked';

type VoiceRoomPreview = {
  id: string;
  title: string;
  description: string;
  privacy: VoiceRoomPrivacy;
  communityId?: string | null;
  hostUserId: string;
  status: VoiceRoomStatus;
  capacityListeners: number;
  capacitySpeakers: number;
  recordingEnabled: false;
  createdAt: string;
  endedAt?: string | null;
  updatedAt: string;
  myRole: VoiceRoomRole | null;
  myState: VoiceParticipantState | null;
  muted: boolean;
  handRaised: boolean;
  private?: boolean;
  rules?: string;
};

type VoiceRoomParticipant = {
  id: string;
  roomId: string;
  userId: string;
  role: VoiceRoomRole;
  handRaised: boolean;
  handRaisedAt?: string | null;
  muted: boolean;
  forceMuted: boolean;
  blocked: boolean;
  joinedAt: string;
  leftAt?: string | null;
  state: VoiceParticipantState;
  name?: string;
  avatar?: string;
};

type GameKind =
  | 'quiz-battle'
  | 'would-you-rather'
  | 'memory-match'
  | 'word-builder'
  | 'emoji-guess'
  | 'trivia'
  | 'meme-vote';

type GamePlayerStatus = 'invited' | 'joined' | 'left' | 'finished';
type GameSessionStatus = 'lobby' | 'active' | 'finished' | 'cancelled';
type GameScreen = 'list' | 'invite' | 'lobby' | 'play' | 'finished';

type GameCatalogEntry = {
  id: string;
  slug: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  comingSoon: boolean;
  kind: GameKind;
};

type GamePlayerPublic = {
  userId: string;
  status: GamePlayerStatus;
  score: number;
  answers: Record<string, number>;
};

type GameRoundPublic = {
  index: number;
  kind: 'quiz' | 'wyr';
  prompt: string;
  options: string[];
  correctAnswerIndex?: number;
};

type GameResultsSummary = {
  kind: GameKind;
  winnerUserIds: string[];
  scores: Array<{ userId: string; score: number }>;
  agreementPercent?: number;
  funSummary?: string;
  pointsNote: string;
};

type GameSessionPublic = {
  id: string;
  gameId: string;
  gameSlug: string;
  kind: GameKind;
  status: GameSessionStatus;
  hostUserId: string;
  chatId?: string | null;
  players: GamePlayerPublic[];
  roundIndex: number;
  roundStartedAt?: string | null;
  roundTimeoutMs: number;
  rounds: Array<GameRoundPublic | null>;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  results?: GameResultsSummary | null;
  pointsNote?: string;
};

type GameLeaderboardRow = {
  rank: number;
  userId: string;
  name: string;
  avatar: string;
  points: number;
  gamesPlayed: number;
  wins: number;
  pointsLabel?: string;
};

type GamePendingInvite = {
  sessionId: string;
  session: GameSessionPublic;
  fromUserId: string;
  gameSlug: string;
  title: string;
};

type GameRoundResultPayload = {
  roundIndex: number;
  round?: GameRoundPublic | null;
  picks: Array<{ userId: string; answerIndex: number | null }>;
  players: Array<{ userId: string; status: GamePlayerStatus; score: number }>;
};

type EventStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';
type EventRsvpStatus = 'interested' | 'going' | 'cancelled';
type EventScreen = 'list' | 'create' | 'detail';

type EventRsvpSummary = {
  status: EventRsvpStatus;
  updatedAt?: string;
};

type EventAttendee = {
  id: string;
  eventId: string;
  userId: string;
  status: EventRsvpStatus;
  createdAt: string;
  updatedAt: string;
  name?: string;
  avatar?: string;
};

type CommunityEventPublic = {
  id: string;
  title: string;
  description: string;
  hostUserId: string;
  communityId?: string | null;
  chatId?: string | null;
  voiceRoomId?: string | null;
  createVoiceOnStart?: boolean;
  startsAt: string;
  endsAt?: string | null;
  timezone: string;
  startsAtLocal: string;
  endsAtLocal?: string | null;
  capacity: number;
  status: EventStatus;
  reminderMinutes: number[];
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  myRsvp?: EventRsvpStatus | EventRsvpSummary | null;
  goingCount?: number;
  interestedCount?: number;
  spotsRemaining?: number;
  attendees?: EventAttendee[];
};

type EventAlertModal = {
  kind: 'reminder' | 'starting' | 'cancelled';
  eventId: string;
  title: string;
  message: string;
  startsAtLocal?: string;
  minutesBefore?: number;
  chatId?: string | null;
  voiceRoomId?: string | null;
};

const eventMyRsvpStatus = (
  event: Pick<CommunityEventPublic, 'myRsvp'> | null | undefined,
): EventRsvpStatus | null => {
  if (!event?.myRsvp) return null;
  if (typeof event.myRsvp === 'string') return event.myRsvp;
  return event.myRsvp.status ?? null;
};

const isoToDatetimeLocal = (iso: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const datetimeLocalToIso = (value: string) => {
  if (!value.trim()) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const defaultEventTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const VOICE_PUBLISHER_ROLES: VoiceRoomRole[] = ['host', 'moderator', 'speaker'];
const isVoicePublisherRole = (role: VoiceRoomRole | null | undefined) =>
  Boolean(role && VOICE_PUBLISHER_ROLES.includes(role));
const voiceRoleAtLeast = (role: VoiceRoomRole | null | undefined, minimum: VoiceRoomRole) => {
  const rank: Record<VoiceRoomRole, number> = { host: 4, moderator: 3, speaker: 2, listener: 1 };
  if (!role) return false;
  return rank[role] >= rank[minimum];
};

type CommunityPreview = {
  id: string;
  name: string;
  description: string;
  privacy: CommunityPrivacy;
  avatarUrl: string;
  memberCount: number;
  pinnedRules?: boolean;
  myRole: CommunityRole | null;
  myState: MembershipState | null;
  muted: boolean;
  rules?: string;
  private?: boolean;
  limited?: boolean;
  ownerUserId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type CommunityMembership = {
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
  name?: string;
  avatar?: string;
};

type CommunityRoomPermissions = {
  viewRoles: CommunityRole[];
  postRoles: CommunityRole[];
};

type CommunityRoom = {
  id: string;
  communityId: string;
  chatId: string;
  title: string;
  topic: string;
  permissions: CommunityRoomPermissions;
  pinnedRules: string;
  isAnnouncement: boolean;
  allowAnonymous?: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  canPost?: boolean;
  chat?: any;
};

type CommunityInvite = {
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

type CommunityJoinRequest = {
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

type CommunityReport = {
  id: string;
  communityId: string;
  roomId?: string | null;
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

type CommunityAuditEvent = {
  id: string;
  communityId: string;
  actorUserId: string;
  action: string;
  detail: string;
  targetUserId?: string | null;
  roomId?: string | null;
  createdAt: string;
};

type CallState = 'ringing' | 'ongoing' | 'completed' | 'missed' | 'declined';
type CallConnectionUiState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';
type CallQuality = 'good' | 'fair' | 'poor';

type CallItem = {
  id: string;
  participantIds: string[];
  initiatorId: string;
  kind: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  state: CallState;
  startedAt: string;
  durationSeconds: number;
  answeredAt?: string;
  endedAt?: string;
  peerUserId?: string;
  peerName: string;
};

type CatalogProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';

type CatalogVariant = {
  id?: string;
  name: string;
  options: string[];
};

type CatalogItem = {
  id: string;
  sellerId: string;
  title: string;
  price: string;
  priceAmount: number;
  currency: string;
  seller: string;
  category: string;
  description: string;
  imageUrl: string;
  imageUrls: string[];
  stockQuantity: number;
  trackStock: boolean;
  costPrice: number | null;
  lowStockThreshold: number;
  status: CatalogProductStatus;
  variants: CatalogVariant[];
  isPublic: boolean;
  availabilityUpdatedAt: string;
};

type OrderState =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'dispatched'
  | 'completed'
  | 'cancelled'
  | 'refunded';

type CommerceOrder = {
  id: string;
  buyerUserId: string;
  sellerUserId: string;
  totalAmount: number;
  currency: string;
  state: OrderState;
  items: Array<{ title: string; quantity: number; price: number }>;
  deliveryReference?: string | null;
  fulfilmentNote?: string | null;
  courier?: string | null;
  trackingCode?: string | null;
  estimatedDelivery?: string | null;
  history?: Array<{ state: OrderState; at: string; byUserId: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
};

type OrderTrackingView = {
  orderId: string;
  state: OrderState;
  courier: string | null;
  trackingCode: string | null;
  estimatedDelivery: string | null;
  fulfilmentNote: string | null;
  deliveryReference: string | null;
  history: Array<{ state: OrderState; at: string; byUserId: string; note?: string }>;
  updatedAt: string;
  source: 'manual';
};

type AiTone = 'polite' | 'concise' | 'professional' | 'friendly' | 'apologetic';

type AiAssistantTask = 'draft' | 'rewrite' | 'summarise' | 'translate' | 'suggest_reply' | 'explain';
type MeetingAssistMode = 'prep' | 'followup' | 'agenda' | 'notes';

type AiSuggestionChip = {
  id: string;
  text: string;
  tone?: AiTone;
  reason?: string;
};

type BusinessAiConfig = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  autoSend: boolean;
  policyText: string;
  deliveryPolicy: string;
  refundPolicy: string;
  faq: Array<{ question: string; answer: string }>;
  createdAt: string;
  updatedAt: string;
};

type BusinessAiAskResult = {
  answer: string;
  confidence?: string;
  source?: string;
  escalate?: boolean;
  disclosure?: string;
  notice?: string;
  autoSend?: boolean;
};

type TwinAllowedTask =
  | 'draft_reply'
  | 'organise_enquiry'
  | 'create_reminder'
  | 'prepare_quotation'
  | 'answer_hours';

type TwinPermissionTier = 'draft_only' | 'auto_routine';

type TwinDataSource = 'catalog' | 'hours' | 'faq' | 'policies' | 'crm';

type AiTwinConfig = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  displayName: string;
  permissionTier: TwinPermissionTier;
  allowedTasks: TwinAllowedTask[];
  dataSources: TwinDataSource[];
  operatingHoursText: string;
  dailyActionLimit: number;
  blockedActions: string[];
  createdAt: string;
  updatedAt: string;
};

type AiTwinAction = {
  id: string;
  twinId: string;
  ownerUserId: string;
  task: TwinAllowedTask | 'blocked_attempt';
  status: 'proposed' | 'approved' | 'rejected' | 'executed_draft' | 'blocked';
  summary: string;
  draftText?: string;
  requiresApproval: boolean;
  chatId?: string | null;
  messageId?: string | null;
  inputPreview?: string;
  result?: string;
  createdAt: string;
  decidedAt?: string | null;
  decidedByUserId?: string | null;
};

type AiTwinCapabilities = {
  may: string[];
  mayNot: string[];
};

type ScamSignal = {
  code: string;
  label: string;
  severity: 'low' | 'medium' | 'high';
};

type ScamWarningInfo = {
  risky: boolean;
  severity: 'low' | 'medium' | 'high';
  signals: ScamSignal[];
  advice: string | null;
};

type SummarizeScope = 'unread' | 'recent';

type ChatSummaryItem = {
  messageId: string;
  text: string;
  sentAt?: string;
  senderId?: string;
  suggested?: boolean;
};

type ChatSummary = {
  overview: string;
  questions: ChatSummaryItem[];
  decisions: ChatSummaryItem[];
  actionSuggestions: ChatSummaryItem[];
  highlights: ChatSummaryItem[];
  messageCount?: number;
  method?: string;
  notice?: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

type SaleReceipt = {
  id: string;
  receiptNumber: string;
  orderId: string;
  buyerUserId?: string;
  sellerUserId?: string;
  buyerName: string;
  sellerName: string;
  businessName: string;
  totalAmount: number;
  currency: string;
  state: string;
  items: Array<{ title: string; quantity: number; price: number }>;
  paymentMethod?: string;
  paymentReference?: string;
  disputeNote?: string | null;
  disputeByUserId?: string | null;
  disputedAt?: string | null;
  issuedAt: string;
  createdAt: string;
};

type SalesDashboard = {
  period: string;
  periodStart?: string;
  periodEnd?: string;
  currency: string;
  lastUpdatedAt?: string;
  estimated?: boolean;
  canSeeFinance: boolean;
  metrics?: {
    pendingOrders?: number;
    confirmedSalesCount?: number;
    lowStockCount?: number;
    grossSales?: number;
    refunds?: number;
    netSales?: number;
    cashReceived?: number;
    costOfGoodsSold?: number | null;
    grossProfit?: number | null;
    grossProfitAvailable?: boolean;
    grossProfitNote?: string;
  };
  topProducts?: Array<{ catalogItemId?: string; title: string; units: number; revenue?: number }>;
  lowStock?: Array<{ id: string; title: string; stockQuantity: number; lowStockThreshold: number }>;
};

type HomeSummary = {
  identity: 'personal' | 'business';
  businessId?: string | null;
  lastUpdatedAt?: string;
  counts?: {
    unreadChats?: number;
    unreadMessages?: number;
    unreadBusinessChats?: number;
    unreadBusinessMessages?: number;
    pendingChatRequests?: number;
    upcomingEvents?: number;
    liveStatusesFromOthers?: number;
    openPaymentRequests?: number;
    pendingBuyerOrders?: number;
    pendingSellerOrders?: number;
    lowStockCount?: number;
    unpaidInvoices?: number;
    catalogCount?: number;
  };
};

type InventoryAlert = {
  id: string;
  catalogItemId?: string;
  title?: string;
  stockQuantity?: number;
  lowStockThreshold?: number;
  reviewedAt?: string | null;
  createdAt?: string;
};

type MarketingConsent = 'unknown' | 'opted_in' | 'opted_out';

type CustomerNote = {
  id: string;
  text: string;
  byUserId: string;
  createdAt: string;
};

type BusinessCustomer = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
  customerUserId?: string | null;
  displayName: string;
  phone?: string;
  tags: string[];
  notes: CustomerNote[];
  followUpAt?: string | null;
  followUpNote?: string;
  marketingConsent: MarketingConsent;
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

type CustomerOrderSummary = {
  id: string;
  state: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  itemTitle?: string;
  courier?: string | null;
  trackingCode?: string | null;
  estimatedDelivery?: string | null;
  deliveryReference?: string | null;
  fulfilmentNote?: string | null;
};

type CustomerPreference = {
  customerId: string;
  sellerUserId: string;
  businessId?: string | null;
  marketingConsent: MarketingConsent;
  marketingConsentUpdatedAt?: string | null;
  displayNameOnSellerSide?: string;
};

type AutoReplyRule = {
  id: string;
  keywords: string[];
  response: string;
  enabled: boolean;
};

type AutoReplyConfig = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  greetingEnabled: boolean;
  greetingText: string;
  awayEnabled: boolean;
  awayText: string;
  hoursText: string;
  humanHandoverKeywords: string[];
  rules: AutoReplyRule[];
  cooldownSeconds: number;
  pausedChatIds: string[];
  createdAt: string;
  updatedAt: string;
};

type AutoReplyLog = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
  chatId: string;
  customerUserId: string;
  triggerMessageId: string;
  replyMessageId: string;
  source: 'greeting' | 'away' | 'hours' | 'rule' | 'handover';
  ruleId?: string | null;
  createdAt: string;
};

type CommerceDocKind = 'quotation' | 'invoice';
type CommerceDocState =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'paid'
  | 'overdue'
  | 'voided';

type CommerceDocLine = {
  id?: string;
  title: string;
  quantity: number;
  unitPrice: number;
  amount?: number;
};

type CommerceDocument = {
  id: string;
  kind: CommerceDocKind;
  number: string;
  sellerUserId: string;
  customerUserId?: string | null;
  customerName: string;
  chatId?: string | null;
  currency: string;
  lines: CommerceDocLine[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  paymentTerms?: string;
  expiresAt?: string | null;
  dueAt?: string | null;
  state: CommerceDocState;
  createdAt: string;
  updatedAt: string;
};

type BroadcastSegment = 'opted_in' | 'repeat_buyers' | 'all_customers' | 'tag';

type BroadcastCampaign = {
  id: string;
  sellerUserId: string;
  text: string;
  segment: BroadcastSegment;
  tag?: string | null;
  status: 'draft' | 'sending' | 'sent' | 'cancelled' | 'failed';
  audienceCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BroadcastAudiencePreview = {
  opted_in: number;
  repeat_buyers: number;
  all_customers: number;
};

type BusinessHubTab =
  | 'catalog'
  | 'dashboard'
  | 'orders'
  | 'receipts'
  | 'inventory'
  | 'customers'
  | 'autoreplies'
  | 'automations'
  | 'loyalty'
  | 'documents'
  | 'broadcasts'
  | 'ai'
  | 'twin';

type AutomationTrigger = 'new_message' | 'new_order' | 'low_stock' | 'payment_request_paid';
type AutomationAction =
  | 'draft_reply_template'
  | 'notify_owner'
  | 'create_reminder'
  | 'label_chat';

type AutomationRule = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  templateText: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type AutomationRun = {
  id: string;
  ruleId: string;
  ownerUserId: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  status: string;
  summary: string;
  draftText?: string;
  chatId?: string | null;
  autoSend: false;
  createdAt: string;
};

type LoyaltyEarnMode = 'per_currency' | 'flat_per_order';

type LoyaltyProgram = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  earnMode: LoyaltyEarnMode;
  pointsPerCurrency: number;
  flatPointsPerOrder: number;
  termsNote: string;
  updatedAt?: string;
};

type LoyaltyBalance = {
  id?: string;
  ownerUserId: string;
  businessId?: string | null;
  customerUserId: string;
  pointsBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  displayName?: string;
};

type LoyaltyReward = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  name: string;
  pointsCost: number;
  active: boolean;
};

type LoyaltyRedemption = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  customerUserId: string;
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  status: 'pending' | 'fulfilled' | 'cancelled';
  createdAt: string;
};

type StatusItem = {
  id: string;
  userId: string;
  text: string;
  assets: Array<{ id?: string; url: string; caption?: string; kind?: 'image' | 'video' | 'document' }>;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  reactions?: Array<{ userId: string; emoji: string; reactedAt: string }>;
  comments?: Array<{ id: string; userId: string; text: string; createdAt: string; updatedAt?: string }>;
  views?: Array<{ userId: string; viewedAt: string }>;
  createdAt: string;
};

type StatusViewer = {
  userId: string;
  name: string;
  avatar: string;
  viewedAt: string;
};

type StatusReactor = {
  userId: string;
  name: string;
  avatar: string;
  emoji: string;
  reactedAt: string;
};

type ProfileState = {
  name: string;
  about: string;
  phone: string;
  photoUrl: string;
  currency: string;
  profileVideoUri: string;
  profileVideoPosterUri: string;
  profileVideoDurationSeconds: number;
  blockedUserIds: string[];
};

type AppUser = {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  presence?: string;
  lastSeenAt?: string;
  photoUri?: string;
  profileVideoUri?: string;
  profileVideoPosterUri?: string;
  profileVideoDurationSeconds?: number;
};

type LinkedDevice = {
  id: string;
  deviceId: string;
  userId: string;
  platform: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
};

type UpdateGroup = {
  userId: string;
  name: string;
  avatar: string;
  latestAt: string | null;
  items: Array<{
    id: string;
    text: string;
    assets: Array<{ url: string; kind?: 'image' | 'video' | 'document'; caption?: string }>;
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: number;
    reactions?: Array<{ userId: string; emoji: string; reactedAt: string }>;
    comments?: Array<{ id: string; userId: string; text: string; createdAt: string; updatedAt?: string }>;
    views?: Array<{ userId: string; viewedAt: string }>;
    createdAt: string;
  }>;
};

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://zynkup-api-597625475865.europe-west9.run.app';
const AI_TONES: AiTone[] = ['polite', 'concise', 'professional', 'friendly', 'apologetic'];
const AI_ASSISTANT_TASKS: Array<{ id: AiAssistantTask; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'suggest_reply', label: 'Suggest reply' },
  { id: 'summarise', label: 'Summarise' },
  { id: 'translate', label: 'Translate' },
  { id: 'explain', label: 'Explain' },
];
const MEETING_ASSIST_MODES: Array<{ id: MeetingAssistMode; label: string }> = [
  { id: 'prep', label: 'Prep' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'notes', label: 'Notes' },
];
const TWIN_ALLOWED_TASKS: Array<{ id: TwinAllowedTask; label: string }> = [
  { id: 'draft_reply', label: 'Draft replies' },
  { id: 'organise_enquiry', label: 'Organise enquiries' },
  { id: 'create_reminder', label: 'Create reminders' },
  { id: 'prepare_quotation', label: 'Prepare quotation drafts' },
  { id: 'answer_hours', label: 'Answer hours' },
];
const TWIN_DATA_SOURCES: Array<{ id: TwinDataSource; label: string }> = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'hours', label: 'Hours' },
  { id: 'faq', label: 'FAQ' },
  { id: 'policies', label: 'Policies' },
  { id: 'crm', label: 'CRM' },
];
const TWIN_HARD_BLOCK_LABELS: Record<string, string> = {
  send_money: 'Send money',
  approve_refund: 'Approve refunds',
  invent_price: 'Invent prices',
  promise_discount: 'Promise discounts',
  auto_send_without_disclosure: 'Auto-send without disclosure',
  impersonate_owner_secretly: 'Impersonate the owner secretly',
};
const TRANSLATE_LANGUAGES: Array<{ id: TranslateLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'tw', label: 'Twi' },
  { id: 'ga', label: 'Ga' },
  { id: 'ee', label: 'Ewe' },
  { id: 'pcm', label: 'Pidgin (pcm)' },
];
const DEVICE_STORAGE_KEY = 'zynkup-web-device-id';
const SETTINGS_STORAGE_KEY = 'zynkup-web-app-settings';
const FAVORITES_STORAGE_KEY = 'zynkup-web-favorite-chats';
const MUTED_CHATS_STORAGE_KEY = 'zynkup-web-muted-chats';
const ARCHIVED_CHATS_STORAGE_KEY = 'zynkup-web-archived-chats';
const REACTION_SOUND_MUTED_STORAGE_KEY = 'zynkup-web-reaction-sound-muted-chats';
const OUTBOX_STORAGE_KEY = 'zynkup-web-outbox';
const OUTBOX_BACKOFF_MS = [2000, 5000, 15000, 30000];
const WAITING_FOR_CONNECTION = 'Waiting for connection';

const isPaymentOutboxBody = (body: OutboxMessageBody | Record<string, unknown>) => {
  const kind = String((body as OutboxMessageBody).kind || '');
  if (/pay|momo|payment|checkout|order-pay/i.test(kind)) {
    return true;
  }
  const record = body as Record<string, unknown>;
  return Boolean(record.paymentAction || record.paymentReference || record.paymentMethod);
};

const readStoredOutbox = (): OutboxEntry[] => {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is OutboxEntry =>
      Boolean(
        entry
        && typeof entry.clientRef === 'string'
        && entry.body
        && typeof entry.body === 'object'
        && typeof entry.body.chatId === 'string'
        && typeof entry.body.clientRef === 'string'
        && !isPaymentOutboxBody(entry.body),
      ),
    );
  } catch {
    return [];
  }
};

const messageFromOutboxEntry = (entry: OutboxEntry, userId: string): Message => {
  const kindRaw = entry.body.kind;
  const kind: Message['kind'] =
    kindRaw === 'image'
    || kindRaw === 'voice'
    || kindRaw === 'file'
    || kindRaw === 'video'
    || kindRaw === 'call'
      ? kindRaw
      : 'text';
  const mediaUrl = entry.body.mediaUrls?.[0];
  return {
    id: `local-${entry.clientRef}`,
    clientRef: entry.clientRef,
    sender: 'me',
    senderId: typeof entry.body.senderId === 'string' ? entry.body.senderId : userId,
    kind,
    text: typeof entry.body.text === 'string' ? entry.body.text : '',
    time: WAITING_FOR_CONNECTION,
    imageUrl: kind === 'image' ? mediaUrl : undefined,
    audioUrl: kind === 'voice' ? mediaUrl : undefined,
    videoUrl: kind === 'video' ? mediaUrl : undefined,
    durationLabel: entry.body.durationSeconds
      ? `0:${String(entry.body.durationSeconds).padStart(2, '0')}`
      : undefined,
    receiptState: 'pending',
    replyToMessageId: entry.body.replyToMessageId,
    replyPreview: entry.body.replyPreview,
    anonymous: Boolean(entry.body.anonymous),
  };
};

const mergeOutboxIntoMessages = (
  base: Record<string, Message[]>,
  entries: OutboxEntry[],
  userId: string,
): Record<string, Message[]> => {
  const next: Record<string, Message[]> = { ...base };
  entries.forEach((entry) => {
    const chatId = entry.body.chatId;
    if (!chatId || isPaymentOutboxBody(entry.body)) {
      return;
    }
    const list = next[chatId] ?? [];
    if (list.some((item) => item.clientRef === entry.clientRef)) {
      return;
    }
    next[chatId] = [...list, messageFromOutboxEntry(entry, userId)];
  });
  return next;
};
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const STATUS_REACTIONS = ['❤️', '👍', '👎', '🔥', '😂'];
const PROFILE_VIDEO_MAX_SECONDS = 6;

const DEFAULT_APP_SETTINGS = {
  enterIsSend: true,
  mediaAutoDownload: true,
  messageNotifications: true,
  showNotificationPreview: true,
  conversationTones: true,
  saveToCameraRoll: false,
  lowDataMode: false,
  /** Prefer still profile photos over short looping videos (bandwidth / battery). */
  dataSaver: false,
  lastSeenPrivacy: 'everyone' as const,
  profilePhotoPrivacy: 'everyone' as const,
  profileVideoPrivacy: 'everyone' as const,
  aboutPrivacy: 'everyone' as const,
  statusPrivacy: 'contacts' as const,
  readReceiptsEnabled: true,
  appLockEnabled: false,
  /** Reaction sound cues — off by default; never autoplay on history load. */
  reactionSoundEnabled: false,
  reactionAnimationEnabled: true,
  preferredLanguage: 'en' as TranslateLanguage,
};

const SETTINGS_MENU: Array<{ id: Exclude<SettingsPanelId, ''>; title: string; subtitle: string }> = [
  { id: 'favorites', title: 'Favorites', subtitle: 'Pin important chats to the top' },
  { id: 'myCard', title: 'My card', subtitle: 'Digital card and QR for networking' },
  { id: 'business', title: 'Business tools', subtitle: 'Catalog, customers, invoices, quotations, broadcasts, and sales' },
  { id: 'history', title: 'Chat history', subtitle: 'Export or clear conversations' },
  { id: 'account', title: 'Account', subtitle: 'Profile and security' },
  { id: 'privacy', title: 'Privacy', subtitle: 'Last seen, read receipts, marketing' },
  { id: 'blocked', title: 'Blocked contacts', subtitle: 'People you blocked' },
  { id: 'chats', title: 'Chats', subtitle: 'Enter is send and media' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Message alerts and previews' },
  { id: 'storage', title: 'Storage and data', subtitle: 'Network usage and cache' },
  { id: 'help', title: 'Help and feedback', subtitle: 'FAQ and support' },
];

const REPORT_REASON_OPTIONS: Array<{ id: ReportReasonId; label: string }> = [
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'scam', label: 'Scam or fraud' },
  { id: 'inappropriate', label: 'Inappropriate content' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'other', label: 'Something else' },
];

const initialChats: Chat[] = [];

const initialCatalogItems: CatalogItem[] = [];

const categories = ['All', 'Fashion', 'Phones', 'Home', 'Electronics'];
const emojiChoices = ['😀', '😂', '🤣', '😍', '🔥', '🙏', '🎉', '❤️'];

const formatClock = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

/** Still used in chat lists / avatars — never the looping video. */
const stillAvatarUri = (input: {
  photoUri?: string;
  photoUrl?: string;
  profileVideoPosterUri?: string;
}) => input.profileVideoPosterUri || input.photoUri || input.photoUrl || '';

const probeVideoDurationSeconds = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const seconds = Number.isFinite(video.duration) ? Math.ceil(video.duration) : 0;
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video duration'));
    };
    video.src = url;
  });

const captureVideoPosterBlob = (file: File): Promise<Blob | null> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const cleanup = () => URL.revokeObjectURL(url);
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 480;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width || !canvas.height) {
          cleanup();
          resolve(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            resolve(blob);
          },
          'image/jpeg',
          0.85,
        );
      } catch {
        cleanup();
        resolve(null);
      }
    };
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.1, Math.max(0, (video.duration || 1) * 0.05));
      } catch {
        cleanup();
        resolve(null);
      }
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
  });

const mapCatalogItemFromServer = (item: any, usersList: AppUser[] = [], fallbackSeller = 'Seller'): CatalogItem => {
  const currency = item.currency ?? 'GHS';
  const priceAmount = Number(item.priceAmount ?? item.price ?? 0);
  return {
    id: item.id,
    sellerId: item.sellerId ?? '',
    title: item.title ?? '',
    price: `${currency} ${priceAmount}`,
    priceAmount,
    currency,
    seller: usersList.find((user) => user.id === item.sellerId)?.name ?? fallbackSeller,
    category: item.category ?? '',
    description: item.description ?? '',
    imageUrl: item.imageUrls?.[0] ?? item.imageUrl ?? '',
    imageUrls: item.imageUrls ?? (item.imageUrl ? [item.imageUrl] : []),
    stockQuantity: item.stockQuantity ?? 0,
    trackStock: item.trackStock !== false,
    costPrice: item.costPrice == null ? null : Number(item.costPrice),
    lowStockThreshold: item.lowStockThreshold ?? 2,
    status: (item.status as CatalogProductStatus) || (item.takenDown ? 'archived' : 'active'),
    variants: item.variants ?? [],
    isPublic: Boolean(item.isPublic),
    availabilityUpdatedAt: item.availabilityUpdatedAt || item.updatedAt || '',
  };
};

const isCatalogLowStock = (item: CatalogItem) =>
  item.trackStock !== false && Number(item.stockQuantity ?? 0) <= Number(item.lowStockThreshold ?? 2);

const formatRelative = (value: string | null) => {
  if (!value) {
    return 'No recent updates';
  }

  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.round(minutes / 60)}h ago`;
};

const formatDurationLabel = (seconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
};

/** Fallback STUN-only config for voice rooms and when ICE fetch fails. Never hardcode TURN secrets. */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const WEBRTC_CONFIGURATION: RTCConfiguration = {
  iceServers: FALLBACK_ICE_SERVERS,
  iceCandidatePoolSize: 4,
};

const buildFallbackRtcConfig = (): RTCConfiguration => ({
  iceServers: FALLBACK_ICE_SERVERS,
  iceCandidatePoolSize: 4,
});

const mapRtcStatesToCallConnection = (
  connectionState: RTCPeerConnectionState,
  iceConnectionState: RTCIceConnectionState,
): CallConnectionUiState => {
  if (connectionState === 'failed' || iceConnectionState === 'failed') return 'failed';
  if (connectionState === 'closed' || iceConnectionState === 'closed') return 'closed';
  if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
    return 'reconnecting';
  }
  if (
    connectionState === 'connected'
    && (iceConnectionState === 'connected' || iceConnectionState === 'completed')
  ) {
    return 'connected';
  }
  // new / connecting / checking — not "Connected" and not a recovery banner yet
  return 'connecting';
};

const classifyCallQuality = (rttMs?: number, packetLossPct?: number): CallQuality => {
  const rtt = rttMs ?? 0;
  const loss = packetLossPct ?? 0;
  if (rtt >= 400 || loss >= 8) return 'poor';
  if (rtt >= 200 || loss >= 3) return 'fair';
  return 'good';
};

const callQualityLabel = (quality: CallQuality | null) => {
  if (quality === 'good') return 'Good';
  if (quality === 'fair') return 'Fair';
  if (quality === 'poor') return 'Poor';
  return null;
};

const getChatTitle = (chat: any, userId: string, userList: AppUser[]) => {
  if (chat.kind !== 'direct') {
    return chat.title;
  }

  const peerId = (chat.participants ?? []).find((participantId: string) => participantId !== userId);
  return userList.find((user) => user.id === peerId)?.name ?? chat.title;
};

const mapChatFromServer = (chat: any, userId: string, userList: AppUser[]) => {
  const peerUserId = chat.kind === 'direct'
    ? (chat.participants ?? []).find((participantId: string) => participantId !== userId)
    : undefined;
  const peer = peerUserId ? userList.find((user) => user.id === peerUserId) : undefined;
  return {
    id: chat.id,
    name: getChatTitle(chat, userId, userList),
    preview: chat.lastMessagePreview,
    time: formatClock(chat.updatedAt ?? new Date().toISOString()),
    unread: chat.unreadCount ?? 0,
    presence: peer?.presence ?? 'offline',
    lastSeenAt: peer?.lastSeenAt,
    peerUserId,
    kind: chat.kind === 'group' || chat.kind === 'direct' ? chat.kind : undefined,
    communityId: typeof chat.communityId === 'string' ? chat.communityId : undefined,
    allowAnonymous: Boolean(chat.allowAnonymous),
    participants: Array.isArray(chat.participants)
      ? chat.participants.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
    adminIds: Array.isArray(chat.adminIds)
      ? chat.adminIds.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
    reactionSoundMutedBy: Array.isArray(chat.reactionSoundMutedBy)
      ? chat.reactionSoundMutedBy.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
  };
};

const BADGE_TYPE_OPTIONS: BadgeType[] = ['helpful', 'welcoming', 'fast_support'];

const badgeShortLabel = (badgeType: BadgeType, definitions?: BadgeDefinition[]) => {
  const match = definitions?.find((item) => item.badgeType === badgeType);
  if (match?.label) return match.label;
  if (badgeType === 'fast_support') return 'Fast Support';
  if (badgeType === 'welcoming') return 'Welcoming';
  return 'Helpful';
};

const mapMessageReactions = (raw: unknown): MessageReaction[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const mapped = raw
    .map((entry): MessageReaction | null => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as Record<string, unknown>;
      if (typeof item.userId !== 'string' || typeof item.emoji !== 'string') return null;
      return {
        userId: item.userId,
        emoji: item.emoji,
        reactedAt: typeof item.reactedAt === 'string' ? item.reactedAt : new Date().toISOString(),
        reactionId: typeof item.reactionId === 'string' ? item.reactionId : undefined,
      };
    })
    .filter((entry): entry is MessageReaction => Boolean(entry));
  return mapped;
};

const mapServerMessage = (message: any, userId: string): Message => ({
  id: message.id,
  clientRef: message.clientRef,
  sender: message.senderId === userId ? 'me' : 'other',
  senderId: typeof message.senderId === 'string' ? message.senderId : undefined,
  kind: message.deletedForEveryone
    ? 'text'
    : message.kind === 'emoji'
      ? 'text'
      : message.kind,
  text: message.text,
  time: formatClock(message.sentAt),
  imageUrl: message.deletedForEveryone ? undefined : message.mediaUrls?.[0],
  audioUrl: message.deletedForEveryone ? undefined : message.mediaUrls?.[0],
  videoUrl: message.deletedForEveryone
    ? undefined
    : message.kind === 'video'
      ? message.mediaUrls?.[0]
      : undefined,
  durationLabel: message.durationSeconds
    ? `0:${String(message.durationSeconds).padStart(2, '0')}`
    : undefined,
  receiptState: message.state,
  replyToMessageId: message.replyToMessageId,
  replyPreview: message.replyPreview,
  callKind: message.callKind,
  callState: message.callState,
  deletedForEveryone: Boolean(message.deletedForEveryone),
  automated: Boolean(message.automated),
  anonymous: Boolean(message.anonymous) || message.senderId === 'anonymous',
  documentId: message.documentId || undefined,
  documentKind: message.documentKind === 'quotation' || message.documentKind === 'invoice'
    ? message.documentKind
    : undefined,
  transcript: typeof message.transcript === 'string' ? message.transcript : undefined,
  transcriptStatus:
    message.transcriptStatus === 'pending'
    || message.transcriptStatus === 'ready'
    || message.transcriptStatus === 'failed'
    || message.transcriptStatus === 'unavailable'
      ? message.transcriptStatus
      : undefined,
  transcriptLanguage: typeof message.transcriptLanguage === 'string' ? message.transcriptLanguage : undefined,
  transcriptUpdatedAt: typeof message.transcriptUpdatedAt === 'string' ? message.transcriptUpdatedAt : undefined,
  reactions: mapMessageReactions(message.reactions),
  viewOnce: Boolean(message.viewOnce),
  viewOnceOpenedAt: typeof message.viewOnceOpenedAt === 'string' ? message.viewOnceOpenedAt : undefined,
  viewOnceOpenedBy: typeof message.viewOnceOpenedBy === 'string' ? message.viewOnceOpenedBy : undefined,
  protectedMedia: Boolean(message.protectedMedia || message.viewOnce),
});

const describeCallMessage = (message: Message) => {
  const video = message.callKind === 'video';
  const noun = video ? 'video call' : 'voice call';
  const state = message.callState
    || (/missed/i.test(message.text || '') ? 'missed' : /declined/i.test(message.text || '') ? 'declined' : 'completed');
  const outgoing = message.sender === 'me';
  const label = !outgoing && state === 'missed'
    ? `Missed ${noun}`
    : !outgoing && state === 'declined'
      ? `Declined ${noun}`
      : `${outgoing ? 'Outgoing' : 'Incoming'} ${noun}`;
  return { label, alert: state === 'missed' || state === 'declined', arrow: outgoing ? '↗' : '↙' };
};

let webAudioContext: AudioContext | null = null;
const ensureWebAudioContext = () => {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!webAudioContext) webAudioContext = new Ctx();
  void webAudioContext.resume().catch(() => undefined);
  return webAudioContext;
};

const playWebCue = (kind: 'message' | 'call') => {
  const ctx = ensureWebAudioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = kind === 'call' ? 740 : 988;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (kind === 'call' ? 0.7 : 0.18));
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + (kind === 'call' ? 0.72 : 0.2));
};

/** Procedural short beeps mapped from catalog soundKey — no binary assets. */
const playReactionSoundCue = (soundKey: string) => {
  const ctx = ensureWebAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const beep = (freq: number, start: number, duration: number, type: OscillatorType = 'sine', peak = 0.07) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now + start);
    oscillator.stop(now + start + duration + 0.02);
  };
  switch (soundKey) {
    case 'laugh':
      beep(520, 0, 0.09, 'triangle', 0.06);
      beep(640, 0.1, 0.09, 'triangle', 0.05);
      beep(480, 0.2, 0.12, 'triangle', 0.05);
      break;
    case 'clap':
      beep(180, 0, 0.05, 'square', 0.04);
      beep(220, 0.08, 0.05, 'square', 0.035);
      beep(160, 0.16, 0.06, 'square', 0.03);
      break;
    case 'party':
      beep(523, 0, 0.08, 'sine', 0.06);
      beep(659, 0.09, 0.08, 'sine', 0.06);
      beep(784, 0.18, 0.1, 'sine', 0.055);
      break;
    case 'pop':
      beep(320, 0, 0.04, 'sine', 0.08);
      beep(140, 0.03, 0.08, 'triangle', 0.04);
      break;
    default:
      beep(660, 0, 0.1, 'sine', 0.05);
      break;
  }
};

type ReactionChip = {
  key: string;
  emoji: string;
  reactionId?: string;
  count: number;
  mine: boolean;
  animated: boolean;
  soundKey?: string;
};

const buildReactionChips = (
  reactions: MessageReaction[] | undefined,
  catalog: ReactionCatalogEntry[],
  currentUserId: string,
): ReactionChip[] => {
  if (!reactions?.length) return [];
  const byKey = new Map<string, ReactionChip>();
  for (const reaction of reactions) {
    const entry =
      (reaction.reactionId ? catalog.find((item) => item.id === reaction.reactionId) : undefined)
      || catalog.find((item) => item.emoji === reaction.emoji);
    const key = reaction.reactionId || reaction.emoji;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.mine = existing.mine || reaction.userId === currentUserId;
      continue;
    }
    byKey.set(key, {
      key,
      emoji: entry?.fallbackEmoji || entry?.emoji || reaction.emoji,
      reactionId: entry?.id || reaction.reactionId,
      count: 1,
      mine: reaction.userId === currentUserId,
      animated: Boolean(entry && entry.kind !== 'standard' && entry.animationKey),
      soundKey: entry?.soundKey,
    });
  }
  return Array.from(byKey.values());
};

const mapCallFromServer = (call: any, userId: string, userList: AppUser[]): CallItem => {
  const peerUserId = (call.participantIds ?? []).find((participantId: string) => participantId !== userId);
  const peerName = userList.find((user) => user.id === peerUserId)?.name ?? 'Call';
  return {
    id: call.id,
    participantIds: call.participantIds ?? [],
    initiatorId: call.initiatorId ?? call.participantIds?.[0] ?? userId,
    kind: call.kind,
    direction: call.initiatorId === userId ? 'outgoing' : 'incoming',
    state: call.state,
    startedAt: call.startedAt,
    durationSeconds: call.durationSeconds ?? 0,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    peerUserId,
    peerName,
  };
};

function App() {
  const [activeView, setActiveView] = useState<View>('chats');
  const [selectedChatId, setSelectedChatId] = useState<string>('');
  const [messageDraft, setMessageDraft] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('All');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(initialCatalogItems);
  const [communitiesMine, setCommunitiesMine] = useState<CommunityPreview[]>([]);
  const [communitiesDiscover, setCommunitiesDiscover] = useState<CommunityPreview[]>([]);
  const [communitiesSearchQuery, setCommunitiesSearchQuery] = useState('');
  const [communitiesSearchResults, setCommunitiesSearchResults] = useState<CommunityPreview[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');
  const [communityDetail, setCommunityDetail] = useState<CommunityPreview | null>(null);
  const [communityMembership, setCommunityMembership] = useState<CommunityMembership | null>(null);
  const [communityRooms, setCommunityRooms] = useState<CommunityRoom[]>([]);
  const [communityMembers, setCommunityMembers] = useState<CommunityMembership[]>([]);
  const [communityJoinRequests, setCommunityJoinRequests] = useState<CommunityJoinRequest[]>([]);
  const [communityAudit, setCommunityAudit] = useState<CommunityAuditEvent[]>([]);
  const [communityModReports, setCommunityModReports] = useState<CommunityReport[]>([]);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityNotice, setCommunityNotice] = useState('');
  const [communityInviteTokenDraft, setCommunityInviteTokenDraft] = useState('');
  const [communityCreatedInviteToken, setCommunityCreatedInviteToken] = useState('');
  const [communityReportReason, setCommunityReportReason] = useState('');
  const [communityJoinNote, setCommunityJoinNote] = useState('');
  const [communityCreateForm, setCommunityCreateForm] = useState({
    name: '',
    description: '',
    rules: '',
    privacy: 'public' as CommunityPrivacy,
    avatarUrl: '',
  });
  const [communityEditForm, setCommunityEditForm] = useState({
    name: '',
    description: '',
    rules: '',
    privacy: 'public' as CommunityPrivacy,
    avatarUrl: '',
    pinnedRules: false,
  });
  const [communityRoomForm, setCommunityRoomForm] = useState({
    title: '',
    topic: '',
    isAnnouncement: false,
    allowAnonymous: false,
  });
  const [anonymousCompose, setAnonymousCompose] = useState(false);
  const [anonymousDisclosureAccepted, setAnonymousDisclosureAccepted] = useState(false);
  const [anonymousDisclosureOpen, setAnonymousDisclosureOpen] = useState(false);
  const [anonymousRemaining, setAnonymousRemaining] = useState<number | null>(null);
  const [anonymousRevealResult, setAnonymousRevealResult] = useState<{
    authorName?: string;
    authorUserId: string;
    notice?: string;
  } | null>(null);
  const [anonymousRevealBusy, setAnonymousRevealBusy] = useState(false);
  const [communityDetailTab, setCommunityDetailTab] = useState<'overview' | 'members' | 'requests' | 'moderation' | 'settings'>('overview');
  const selectedCommunityIdRef = useRef('');
  const [voiceRoomsMine, setVoiceRoomsMine] = useState<VoiceRoomPreview[]>([]);
  const [voiceRoomsLivePublic, setVoiceRoomsLivePublic] = useState<VoiceRoomPreview[]>([]);
  const [activeVoiceRoom, setActiveVoiceRoom] = useState<VoiceRoomPreview | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceRoomParticipant[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceReconnecting, setVoiceReconnecting] = useState(false);
  const [voiceMicMuted, setVoiceMicMuted] = useState(false);
  const [voiceInviteTokenDraft, setVoiceInviteTokenDraft] = useState('');
  const [voiceCreatedInviteToken, setVoiceCreatedInviteToken] = useState('');
  const [voiceCreateForm, setVoiceCreateForm] = useState({
    title: '',
    description: '',
    rules: '',
    privacy: 'public' as VoiceRoomPrivacy,
  });
  const [gameCatalog, setGameCatalog] = useState<GameCatalogEntry[]>([]);
  const [gameLeaderboard, setGameLeaderboard] = useState<GameLeaderboardRow[]>([]);
  const [gameLeaderboardMine, setGameLeaderboardMine] = useState<{
    userId: string;
    points: number;
    gamesPlayed: number;
    wins: number;
    pointsLabel?: string;
    name?: string;
    avatar?: string;
  } | null>(null);
  const [gamePointsNote, setGamePointsNote] = useState(
    'Cosmetic points only — no cash, gambling, or pay-to-win.',
  );
  const [gameSessionsMine, setGameSessionsMine] = useState<GameSessionPublic[]>([]);
  const [gameScreen, setGameScreen] = useState<GameScreen>('list');
  const [gameSelectedSlug, setGameSelectedSlug] = useState('');
  const [gameInviteSelectedIds, setGameInviteSelectedIds] = useState<string[]>([]);
  const [gameActiveSession, setGameActiveSession] = useState<GameSessionPublic | null>(null);
  const [gameRoundPhase, setGameRoundPhase] = useState<'prompt' | 'result' | null>(null);
  const [gameCurrentRound, setGameCurrentRound] = useState<GameRoundPublic | null>(null);
  const [gameRoundResult, setGameRoundResult] = useState<GameRoundResultPayload | null>(null);
  const [gameRoundMeta, setGameRoundMeta] = useState({
    roundIndex: 0,
    roundStartedAt: null as string | null,
    roundTimeoutMs: 30000,
  });
  const [gameMyAnswerIndex, setGameMyAnswerIndex] = useState<number | null>(null);
  const [gameBusy, setGameBusy] = useState(false);
  const [gameChatId, setGameChatId] = useState<string | null>(null);
  const [gamePendingInvite, setGamePendingInvite] = useState<GamePendingInvite | null>(null);
  const [gameRoundSecondsLeft, setGameRoundSecondsLeft] = useState<number | null>(null);
  const [eventsList, setEventsList] = useState<CommunityEventPublic[]>([]);
  const [eventScreen, setEventScreen] = useState<EventScreen>('list');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventDetail, setEventDetail] = useState<CommunityEventPublic | null>(null);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventNotice, setEventNotice] = useState('');
  const [eventAlert, setEventAlert] = useState<EventAlertModal | null>(null);
  const [eventCreateForm, setEventCreateForm] = useState({
    title: '',
    description: '',
    startsAtLocal: '',
    endsAtLocal: '',
    timezone: defaultEventTimezone(),
    capacity: '50',
    communityId: '',
    chatId: '',
    voiceRoomId: '',
    createVoiceOnStart: false,
  });
  const [eventEditForm, setEventEditForm] = useState({
    title: '',
    description: '',
    startsAtLocal: '',
    endsAtLocal: '',
    timezone: defaultEventTimezone(),
    capacity: '50',
    chatId: '',
    voiceRoomId: '',
    createVoiceOnStart: false,
  });
  const [callSheetVisible, setCallSheetVisible] = useState(false);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [incomingCall, setIncomingCall] = useState<CallItem | null>(null);
  const [activeCall, setActiveCall] = useState<CallItem | null>(null);
  const [activeCallSeconds, setActiveCallSeconds] = useState(0);
  const [localCallStream, setLocalCallStream] = useState<MediaStream | null>(null);
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  const [remoteCameraOff, setRemoteCameraOff] = useState(false);
  const [callLinkState, setCallLinkState] = useState<CallConnectionUiState | null>(null);
  const [callQuality, setCallQuality] = useState<CallQuality | null>(null);
  const [callAudioOnly, setCallAudioOnly] = useState(false);
  const [peerScreenSharing, setPeerScreenSharing] = useState(false);
  const [localScreenSharing, setLocalScreenSharing] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<{
    url: string;
    protectedMedia?: boolean;
    viewOnce?: boolean;
    label?: string;
  } | null>(null);
  const [composeViewOnce, setComposeViewOnce] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [statusText, setStatusText] = useState('');
  const [statusAudience, setStatusAudience] = useState<'contacts' | 'public' | 'marketplace'>('contacts');
  const [statusAssetFiles, setStatusAssetFiles] = useState<File[]>([]);
  const [statusComposerVisible, setStatusComposerVisible] = useState(false);
  const [statusBackgroundColor, setStatusBackgroundColor] = useState('#10233e');
  const [statusFontFamily, setStatusFontFamily] = useState('System');
  const [statusFontSize, setStatusFontSize] = useState(30);
  const [catalogAssetFiles, setCatalogAssetFiles] = useState<File[]>([]);
  const [updatesFeed, setUpdatesFeed] = useState<UpdateGroup[]>([]);
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [activeStatusGroupIndex, setActiveStatusGroupIndex] = useState<number | null>(null);
  const [activeStatusItemIndex, setActiveStatusItemIndex] = useState(0);
  const [statusProgress, setStatusProgress] = useState(0);
  const [statusElapsedMs, setStatusElapsedMs] = useState(0);
  const [statusCommentDraft, setStatusCommentDraft] = useState('');
  const [statusViewers, setStatusViewers] = useState<StatusViewer[]>([]);
  const [statusViewersVisible, setStatusViewersVisible] = useState(false);
  const [statusReactors, setStatusReactors] = useState<StatusReactor[]>([]);
  const [statusReactorsVisible, setStatusReactorsVisible] = useState(false);
  const [statusThreadVisible, setStatusThreadVisible] = useState(false);
  const [statusReplyVisible, setStatusReplyVisible] = useState(false);
  const [statusHoldActive, setStatusHoldActive] = useState(false);
  const [editingStatusCommentId, setEditingStatusCommentId] = useState<string | null>(null);
  const [editingStatusCommentText, setEditingStatusCommentText] = useState('');
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [linkRequestId, setLinkRequestId] = useState('');
  const [linkToken, setLinkToken] = useState('');
  const [linkQrDataUrl, setLinkQrDataUrl] = useState('');
  const [linkStatus, setLinkStatus] = useState<'idle' | 'pending' | 'pin_required' | 'linked' | 'expired'>('idle');
  const [desktopPin, setDesktopPin] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkedDevices, setLinkedDevices] = useState<LinkedDevice[]>([]);
  const [linkedDeviceSlots, setLinkedDeviceSlots] = useState({ linkedCount: 0, limit: 4, remaining: 4 });
  const [profile, setProfile] = useState<ProfileState>({
    name: 'Temwa Lesa',
    about: 'Seller, founder, and product operator.',
    phone: '+260765453163',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    currency: 'GHS',
    profileVideoUri: '',
    profileVideoPosterUri: '',
    profileVideoDurationSeconds: 0,
    blockedUserIds: [],
  });
  const [blockedContacts, setBlockedContacts] = useState<BlockedContact[]>([]);
  const [reportTarget, setReportTarget] = useState<ReportTargetState | null>(null);
  const [reportReason, setReportReason] = useState<ReportReasonId | ''>('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanelId>('account');
  const [digitalCard, setDigitalCard] = useState<DigitalCardState | null>(null);
  const [digitalCardQrDataUrl, setDigitalCardQrDataUrl] = useState('');
  const [digitalCardLinks, setDigitalCardLinks] = useState({ deepLink: '', webUrl: '', qrPayload: '' });
  const [cardBusy, setCardBusy] = useState(false);
  const [businessHubTab, setBusinessHubTab] = useState<BusinessHubTab>('catalog');
  const [salesDashboard, setSalesDashboard] = useState<SalesDashboard | null>(null);
  const [salesDashboardPeriod, setSalesDashboardPeriod] = useState<'today' | '7d' | '30d'>('7d');
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [dismissedHomeCards, setDismissedHomeCards] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('zynkup-web-dismissed-home-cards');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [commerceOrders, setCommerceOrders] = useState<CommerceOrder[]>([]);
  const [buyerOrders, setBuyerOrders] = useState<CommerceOrder[]>([]);
  const [orderDetail, setOrderDetail] = useState<CommerceOrder | null>(null);
  const [orderDeliveryDraft, setOrderDeliveryDraft] = useState({
    courier: '',
    trackingCode: '',
    estimatedDelivery: '',
    fulfilmentNote: '',
  });
  const [payPanel, setPayPanel] = useState<PayPanel>('home');
  const [payForm, setPayForm] = useState({ amount: '', phone: '', note: '', chatId: '' });
  const [payHistoryItems, setPayHistoryItems] = useState<PayHistoryItem[]>([]);
  const [payBusy, setPayBusy] = useState(false);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [saleReceipts, setSaleReceipts] = useState<SaleReceipt[]>([]);
  const [receiptDetail, setReceiptDetail] = useState<SaleReceipt | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [inventoryAlerts, setInventoryAlerts] = useState<InventoryAlert[]>([]);
  const [businessCustomers, setBusinessCustomers] = useState<BusinessCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<BusinessCustomer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<CustomerOrderSummary[]>([]);
  const [customerForm, setCustomerForm] = useState({
    displayName: '',
    phone: '',
    tags: '',
    note: '',
    followUpAt: '',
  });
  const [customerNoteDraft, setCustomerNoteDraft] = useState('');
  const [customerPrefs, setCustomerPrefs] = useState<CustomerPreference[]>([]);
  const [autoReplyConfig, setAutoReplyConfig] = useState<AutoReplyConfig | null>(null);
  const [autoReplyLogs, setAutoReplyLogs] = useState<AutoReplyLog[]>([]);
  const [autoReplyRuleDraft, setAutoReplyRuleDraft] = useState({ keywords: '', response: '' });
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationLogs, setAutomationLogs] = useState<AutomationRun[]>([]);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [automationDraft, setAutomationDraft] = useState({
    name: '',
    trigger: 'new_message' as AutomationTrigger,
    action: 'draft_reply_template' as AutomationAction,
    templateText: '',
    label: '',
  });
  const [loyaltyProgram, setLoyaltyProgram] = useState<LoyaltyProgram | null>(null);
  const [loyaltyBalances, setLoyaltyBalances] = useState<LoyaltyBalance[]>([]);
  const [loyaltyRewards, setLoyaltyRewards] = useState<LoyaltyReward[]>([]);
  const [loyaltyRedemptions, setLoyaltyRedemptions] = useState<LoyaltyRedemption[]>([]);
  const [loyaltyBusy, setLoyaltyBusy] = useState(false);
  const [loyaltyPointsNote, setLoyaltyPointsNote] = useState(
    'Loyalty points only — not cash, and not redeemable for MoMo.',
  );
  const [loyaltyAdjustDraft, setLoyaltyAdjustDraft] = useState({
    customerUserId: '',
    delta: '',
    reason: '',
  });
  const [loyaltyRewardDraft, setLoyaltyRewardDraft] = useState({ name: '', pointsCost: '' });
  const [myLoyaltyBalances, setMyLoyaltyBalances] = useState<LoyaltyBalance[]>([]);
  const [commerceDocuments, setCommerceDocuments] = useState<CommerceDocument[]>([]);
  const [documentKindFilter, setDocumentKindFilter] = useState<'' | CommerceDocKind>('');
  const [documentForm, setDocumentForm] = useState({
    kind: 'quotation' as CommerceDocKind,
    customerName: '',
    customerUserId: '',
    chatId: '',
    notes: '',
    paymentTerms: '',
    discountAmount: '',
    taxAmount: '',
    expiresAt: '',
    dueAt: '',
    sendNow: false,
    lineTitle: '',
    lineQuantity: '1',
    lineUnitPrice: '',
  });
  const [documentExtraLines, setDocumentExtraLines] = useState<Array<{ title: string; quantity: string; unitPrice: string }>>([]);
  const [broadcastCampaigns, setBroadcastCampaigns] = useState<BroadcastCampaign[]>([]);
  const [broadcastAudience, setBroadcastAudience] = useState<BroadcastAudiencePreview>({
    opted_in: 0,
    repeat_buyers: 0,
    all_customers: 0,
  });
  const [broadcastForm, setBroadcastForm] = useState({
    text: '',
    segment: 'opted_in' as BroadcastSegment,
    tag: '',
    sendNow: true,
  });
  const [favoriteChatIds, setFavoriteChatIds] = useState<string[]>([]);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>([]);
  const [archivedChatIds, setArchivedChatIds] = useState<string[]>([]);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [messageActionTarget, setMessageActionTarget] = useState<Message | null>(null);
  const [reactionCatalog, setReactionCatalog] = useState<ReactionCatalogEntry[]>([]);
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [reactionSoundMutedChatIds, setReactionSoundMutedChatIds] = useState<string[]>([]);
  const [bouncingReactionKeys, setBouncingReactionKeys] = useState<Record<string, number>>({});
  const [peerTypingByChat, setPeerTypingByChat] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState('');
  const [aiTone, setAiTone] = useState<AiTone>('polite');
  const [aiSuggestionChips, setAiSuggestionChips] = useState<AiSuggestionChip[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHelperVisible, setAiHelperVisible] = useState(false);
  const [aiHelperTask, setAiHelperTask] = useState<AiAssistantTask>('draft');
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiConsentToShareContext, setAiConsentToShareContext] = useState(false);
  const [aiHelperNotice, setAiHelperNotice] = useState('');
  const [aiHelperResult, setAiHelperResult] = useState('');
  const [meetingAssistVisible, setMeetingAssistVisible] = useState(false);
  const [meetingAssistMode, setMeetingAssistMode] = useState<MeetingAssistMode>('prep');
  const [meetingAssistContext, setMeetingAssistContext] = useState('');
  const [meetingAssistConsent, setMeetingAssistConsent] = useState(false);
  const [meetingAssistBusy, setMeetingAssistBusy] = useState(false);
  const [meetingAssistResult, setMeetingAssistResult] = useState('');
  const [meetingAssistNotice, setMeetingAssistNotice] = useState('');
  const [businessAiConfig, setBusinessAiConfig] = useState<BusinessAiConfig | null>(null);
  const [businessAiFaqDraft, setBusinessAiFaqDraft] = useState({ question: '', answer: '' });
  const [businessAiTestQuestion, setBusinessAiTestQuestion] = useState('');
  const [businessAiAskResult, setBusinessAiAskResult] = useState<BusinessAiAskResult | null>(null);
  const [businessAiBusy, setBusinessAiBusy] = useState(false);
  const [aiTwinConfig, setAiTwinConfig] = useState<AiTwinConfig | null>(null);
  const [aiTwinCapabilities, setAiTwinCapabilities] = useState<AiTwinCapabilities | null>(null);
  const [aiTwinActions, setAiTwinActions] = useState<AiTwinAction[]>([]);
  const [aiTwinBusy, setAiTwinBusy] = useState(false);
  const [aiTwinNotice, setAiTwinNotice] = useState('');
  const [scamWarningsByKey, setScamWarningsByKey] = useState<Record<string, ScamWarningInfo>>({});
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [summaryScope, setSummaryScope] = useState<SummarizeScope>('unread');
  const [chatSummary, setChatSummary] = useState<ChatSummary | null>(null);
  const [summaryNotice, setSummaryNotice] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [groupInfoVisible, setGroupInfoVisible] = useState(false);
  const [groupBadgesByChat, setGroupBadgesByChat] = useState<Record<string, GroupBadgesPayload>>({});
  const [badgeDefinitions, setBadgeDefinitions] = useState<BadgeDefinition[]>([]);
  const [badgesBusy, setBadgesBusy] = useState(false);
  const [badgeAwardTargetUserId, setBadgeAwardTargetUserId] = useState('');
  const [badgeAwardType, setBadgeAwardType] = useState<BadgeType>('helpful');
  const [badgeAwardNote, setBadgeAwardNote] = useState('');
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const [dictationNotice, setDictationNotice] = useState('');
  const [transcribingMessageId, setTranscribingMessageId] = useState<string | null>(null);
  const [translationsByMessageId, setTranslationsByMessageId] = useState<Record<string, MessageTranslation>>({});
  const [translatePickerMessageId, setTranslatePickerMessageId] = useState<string | null>(null);
  const [translateTargetLanguage, setTranslateTargetLanguage] = useState<TranslateLanguage>('en');
  const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [catalogForm, setCatalogForm] = useState({
    title: '',
    price: '',
    category: 'Fashion',
    description: '',
    stockQuantity: '1',
    costPrice: '',
    lowStockThreshold: '2',
    trackStock: true,
    status: 'active' as 'active' | 'draft',
    variantName: '',
    variantOptions: '',
  });
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const profileVideoInputRef = useRef<HTMLInputElement | null>(null);
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  const catalogInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const outboxRef = useRef<OutboxEntry[]>([]);
  const outboxFlushLockRef = useRef(false);
  const outboxBackoffAttemptRef = useRef(0);
  const outboxBackoffTimerRef = useRef<number | null>(null);
  const flushOutboxRef = useRef<() => void>(() => undefined);
  const [outboxCount, setOutboxCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const currentUserIdRef = useRef('');
  const selectedChatIdRef = useRef('');
  const activeViewRef = useRef<View>('chats');
  currentUserIdRef.current = currentUserId;
  selectedChatIdRef.current = selectedChatId;
  activeViewRef.current = activeView;
  selectedCommunityIdRef.current = selectedCommunityId;
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const voicePeerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const voiceLocalStreamRef = useRef<MediaStream | null>(null);
  const voiceRemoteAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const voiceActiveRoomIdRef = useRef('');
  const voiceMyRoleRef = useRef<VoiceRoomRole | null>(null);
  const voiceParticipantsRef = useRef<VoiceRoomParticipant[]>([]);
  const voiceMakingOfferRef = useRef<Set<string>>(new Set());
  const gameActiveSessionIdRef = useRef('');
  const selectedEventIdRef = useRef('');
  selectedEventIdRef.current = selectedEventId;
  const callMediaStreamRef = useRef<MediaStream | null>(null);
  const callRtcConfigRef = useRef<RTCConfiguration | null>(null);
  const callIceRestartCountRef = useRef(0);
  const callIceRestartInFlightRef = useRef(false);
  const callAudioOnlyRef = useRef(false);
  const callLinkStateRef = useRef<CallConnectionUiState | null>(null);
  const callQualityRef = useRef<CallQuality | null>(null);
  const callCameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const callScreenTrackRef = useRef<MediaStreamTrack | null>(null);
  const callMetricsTimerRef = useRef<number | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const applyBootstrapRef = useRef<(payload: any) => void>(() => undefined);
  const refreshGroupBadgesRef = useRef<((chatId: string, userId?: string) => Promise<GroupBadgesPayload | null>) | null>(null);
  const appSettingsRef = useRef(DEFAULT_APP_SETTINGS);
  const mutedChatIdsRef = useRef<string[]>([]);
  const reactionSoundMutedChatIdsRef = useRef<string[]>([]);
  const reactionCatalogRef = useRef<ReactionCatalogEntry[]>([]);
  const updatesFeedRef = useRef<UpdateGroup[]>([]);
  const statusGroupIndexRef = useRef<number | null>(null);
  const statusItemIndexRef = useRef(0);
  const activeCallRef = useRef<CallItem | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const dictateBaseDraftRef = useRef('');
  const dictateFinalRef = useRef('');
  const dictateStoppingRef = useRef(false);
  const focusedMessageTimeoutRef = useRef<number | null>(null);
  const [chatItems, setChatItems] = useState<Chat[]>(initialChats);
  const speechRecognitionSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const host = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    return Boolean(host.SpeechRecognition || host.webkitSpeechRecognition);
  }, []);
  const activeChat = chatItems.find((chat) => chat.id === selectedChatId) ?? chatItems[0] ?? null;
  const messages = activeChat ? messagesByChat[activeChat.id] ?? [] : [];
  const activeStatusGroup = activeStatusGroupIndex === null ? null : updatesFeed[activeStatusGroupIndex] ?? null;
  const activeStatusItem = activeStatusGroup?.items[activeStatusItemIndex] ?? null;
  const activeStatusId = activeStatusItem?.id ?? null;
  const statusPlaybackPaused =
    statusHoldActive ||
    statusThreadVisible ||
    statusReplyVisible ||
    statusViewersVisible ||
    statusReactorsVisible ||
    Boolean(statusCommentDraft.trim()) ||
    Boolean(editingStatusCommentId);
  const visibleChatItems = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    const scoped = chatItems.filter((chat) => {
      const archived = archivedChatIds.includes(chat.id);
      if (showArchivedChats ? !archived : archived) {
        return false;
      }
      if (!query) {
        return true;
      }
      return chat.name.toLowerCase().includes(query) || (chat.preview || '').toLowerCase().includes(query);
    });
    const favorites = scoped.filter((chat) => favoriteChatIds.includes(chat.id));
    const rest = scoped.filter((chat) => !favoriteChatIds.includes(chat.id));
    return [...favorites, ...rest];
  }, [archivedChatIds, chatItems, chatSearchQuery, favoriteChatIds, showArchivedChats]);
  const filteredCatalogItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (item.status === 'archived' || item.status === 'draft') {
        return false;
      }
      const matchesCategory = catalogCategory === 'All' || item.category === catalogCategory;
      const query = catalogSearch.trim().toLowerCase();
      const matchesSearch =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.seller.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [catalogCategory, catalogItems, catalogSearch]);

  const ownCatalogItems = useMemo(
    () => catalogItems.filter((item) => item.sellerId === currentUserId),
    [catalogItems, currentUserId],
  );

  const lowStockOwnItems = useMemo(
    () => ownCatalogItems.filter((item) => item.status !== 'archived' && isCatalogLowStock(item)),
    [ownCatalogItems],
  );

  const attachStreamToVideo = (element: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!element) {
      return;
    }

    if ('srcObject' in element) {
      element.srcObject = stream;
    }
  };

  const resetCallReliabilityUi = () => {
    callIceRestartCountRef.current = 0;
    callIceRestartInFlightRef.current = false;
    callRtcConfigRef.current = null;
    callAudioOnlyRef.current = false;
    callLinkStateRef.current = null;
    callQualityRef.current = null;
    callCameraTrackRef.current = null;
    if (callScreenTrackRef.current) {
      callScreenTrackRef.current.stop();
      callScreenTrackRef.current = null;
    }
    if (callMetricsTimerRef.current) {
      window.clearInterval(callMetricsTimerRef.current);
      callMetricsTimerRef.current = null;
    }
    setCallLinkState(null);
    setCallQuality(null);
    setCallAudioOnly(false);
    setPeerScreenSharing(false);
    setLocalScreenSharing(false);
  };

  const closePeerConnection = () => {
    peerConnectionRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    callMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    callMediaStreamRef.current = null;
    resetCallReliabilityUi();
    setLocalCallStream(null);
    setRemoteCallStream(null);
  };

  const ensureCallMedia = async (kind: 'audio' | 'video') => {
    const existing = callMediaStreamRef.current;
    const liveVideo = existing?.getVideoTracks().some((track) => track.readyState === 'live');
    if (existing && (kind === 'audio' || liveVideo)) {
      return existing;
    }
    if (existing && kind === 'video') {
      const videoOnly = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user' } });
      const videoTrack = videoOnly.getVideoTracks()[0];
      if (!videoTrack) {
        throw new Error('camera');
      }
      existing.addTrack(videoTrack);
      callCameraTrackRef.current = videoTrack;
      callMediaStreamRef.current = existing;
      setLocalCallStream(new MediaStream(existing.getTracks()));
      return existing;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user' } : false,
    });
    const cameraTrack = stream.getVideoTracks()[0];
    if (cameraTrack) {
      callCameraTrackRef.current = cameraTrack;
    }
    callMediaStreamRef.current = stream;
    setLocalCallStream(stream);
    return stream;
  };

  const emitCallSignal = (callId: string, signalType: string, payload: unknown, toUserId?: string) => {
    socketRef.current?.emit('call:signal', {
      callId,
      fromUserId: currentUserId,
      toUserId,
      signalType,
      payload,
    });
  };

  const emitCallConnection = (
    callId: string,
    state: CallConnectionUiState,
    quality?: CallQuality | null,
    peerUserId?: string,
  ) => {
    callLinkStateRef.current = state;
    setCallLinkState(state);
    const payload: {
      callId: string;
      userId: string;
      state: CallConnectionUiState;
      quality?: CallQuality;
    } = {
      callId,
      userId: currentUserIdRef.current || currentUserId,
      state,
    };
    if (quality) {
      payload.quality = quality;
    }
    socketRef.current?.emit('call:connection', payload);
    void peerUserId;
  };

  const fetchCallRtcConfiguration = async (): Promise<RTCConfiguration> => {
    if (callRtcConfigRef.current) {
      return callRtcConfigRef.current;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/calls/ice-servers`);
      if (response.ok) {
        const payload = await response.json();
        const iceServers = Array.isArray(payload?.iceServers) && payload.iceServers.length > 0
          ? (payload.iceServers as RTCIceServer[])
          : FALLBACK_ICE_SERVERS;
        const config: RTCConfiguration = { iceServers, iceCandidatePoolSize: 4 };
        callRtcConfigRef.current = config;
        return config;
      }
    } catch {
      // STUN-only fallback below
    }
    const fallback = buildFallbackRtcConfig();
    callRtcConfigRef.current = fallback;
    return fallback;
  };

  const applyLocalVideoSendEnabled = (enabled: boolean) => {
    const connection = peerConnectionRef.current;
    const cameraTrack = callCameraTrackRef.current
      || callMediaStreamRef.current?.getVideoTracks().find((track) => track !== callScreenTrackRef.current)
      || null;
    if (cameraTrack && !callScreenTrackRef.current) {
      cameraTrack.enabled = enabled && !callCameraOff;
    }
    connection?.getSenders().forEach((sender) => {
      if (sender.track?.kind === 'video' && sender.track !== callScreenTrackRef.current) {
        sender.track.enabled = enabled && !callCameraOff;
      }
    });
  };

  const setCallAudioOnlyMode = (enabled: boolean) => {
    callAudioOnlyRef.current = enabled;
    setCallAudioOnly(enabled);
    applyLocalVideoSendEnabled(!enabled);
  };

  const attemptIceRestart = async (call: CallItem) => {
    const connection = peerConnectionRef.current;
    if (!connection || callIceRestartInFlightRef.current) {
      return;
    }
    if (callIceRestartCountRef.current >= 2) {
      emitCallConnection(call.id, 'failed', callQualityRef.current, call.peerUserId);
      setCallError('Connection failed. End the call and try again.');
      return;
    }
    callIceRestartInFlightRef.current = true;
    callIceRestartCountRef.current += 1;
    emitCallConnection(call.id, 'reconnecting', callQualityRef.current, call.peerUserId);
    emitCallSignal(call.id, 'ice-restart', { attempt: callIceRestartCountRef.current }, call.peerUserId);
    try {
      if (typeof connection.restartIce === 'function') {
        connection.restartIce();
      }
      if (connection.signalingState === 'stable') {
        const offer = await connection.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: call.kind === 'video' && !callAudioOnlyRef.current,
        });
        await connection.setLocalDescription(offer);
        emitCallSignal(call.id, 'offer', offer, call.peerUserId);
      }
    } catch {
      emitCallConnection(call.id, 'failed', callQualityRef.current, call.peerUserId);
      setCallError('Connection failed. End the call and try again.');
    } finally {
      window.setTimeout(() => {
        callIceRestartInFlightRef.current = false;
      }, 2500);
    }
  };

  const sampleAndPostCallMetrics = async (call: CallItem) => {
    const connection = peerConnectionRef.current;
    if (!connection || call.state !== 'ongoing') return;
    try {
      const stats = await connection.getStats();
      let rttMs: number | undefined;
      let packetLoss: number | undefined;
      let bitrateKbps: number | undefined;
      let bytesReceived = 0;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report as RTCStats & { state?: string }).state === 'succeeded') {
          const pair = report as RTCStats & { currentRoundTripTime?: number; availableOutgoingBitrate?: number };
          if (typeof pair.currentRoundTripTime === 'number') {
            rttMs = Math.round(pair.currentRoundTripTime * 1000);
          }
          if (typeof pair.availableOutgoingBitrate === 'number') {
            bitrateKbps = Math.round(pair.availableOutgoingBitrate / 1000);
          }
        }
        if (report.type === 'inbound-rtp') {
          const inbound = report as RTCStats & {
            packetsLost?: number;
            packetsReceived?: number;
            bytesReceived?: number;
          };
          const lost = inbound.packetsLost ?? 0;
          const received = inbound.packetsReceived ?? 0;
          const total = lost + received;
          if (total > 0) {
            packetLoss = Math.min(100, Math.round((lost / total) * 1000) / 10);
          }
          if (typeof inbound.bytesReceived === 'number') {
            bytesReceived += inbound.bytesReceived;
          }
        }
      });
      if (bitrateKbps == null && bytesReceived > 0) {
        bitrateKbps = undefined;
      }
      const quality = classifyCallQuality(rttMs, packetLoss);
      callQualityRef.current = quality;
      setCallQuality(quality);
      if (quality === 'poor' && call.kind === 'video' && !callAudioOnlyRef.current) {
        setCallAudioOnlyMode(true);
        showToast('Switched to audio only for a more stable call.');
      }
      const userId = currentUserIdRef.current || currentUserId;
      await fetch(`${API_BASE_URL}/api/calls/${encodeURIComponent(call.id)}/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          rttMs,
          packetLoss,
          bitrateKbps,
          quality,
        }),
      }).catch(() => undefined);
      if (callLinkStateRef.current === 'connected' || callLinkStateRef.current === 'reconnecting') {
        emitCallConnection(call.id, callLinkStateRef.current, quality, call.peerUserId);
      }
    } catch {
      // ignore stats failures
    }
  };

  const emitScreenShareNotice = (callId: string, active: boolean, peerUserId?: string) => {
    socketRef.current?.emit('call:screen-share', {
      callId,
      userId: currentUserIdRef.current || currentUserId,
      active,
    });
    void peerUserId;
  };

  const stopLocalScreenShare = async () => {
    const call = activeCallRef.current;
    const connection = peerConnectionRef.current;
    const screenTrack = callScreenTrackRef.current;
    if (screenTrack) {
      screenTrack.stop();
      callScreenTrackRef.current = null;
    }
    setLocalScreenSharing(false);
    if (call) {
      emitScreenShareNotice(call.id, false, call.peerUserId);
    }
    if (!connection || !call) return;
    const cameraTrack = callCameraTrackRef.current
      || callMediaStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live')
      || null;
    const sender = connection.getSenders().find((item) => item.track?.kind === 'video' || item.track == null);
    if (sender && cameraTrack && !callAudioOnlyRef.current) {
      await sender.replaceTrack(cameraTrack);
      cameraTrack.enabled = !callCameraOff;
    } else if (sender && (!cameraTrack || callAudioOnlyRef.current)) {
      await sender.replaceTrack(null);
    }
    if (callMediaStreamRef.current) {
      setLocalCallStream(new MediaStream(callMediaStreamRef.current.getTracks()));
    }
  };

  const startLocalScreenShare = async () => {
    const call = activeCallRef.current;
    const connection = peerConnectionRef.current;
    if (!call || !connection || typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      showToast('Screen sharing is not available here.');
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) {
        showToast('Could not start screen share.');
        return;
      }
      callScreenTrackRef.current = screenTrack;
      const sender = connection.getSenders().find((item) => item.track?.kind === 'video')
        || connection.getSenders().find((item) => !item.track);
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        connection.addTrack(screenTrack, display);
      }
      setLocalScreenSharing(true);
      emitScreenShareNotice(call.id, true, call.peerUserId);
      screenTrack.onended = () => {
        void stopLocalScreenShare();
      };
      if (connection.signalingState === 'stable') {
        const offer = await connection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await connection.setLocalDescription(offer);
        emitCallSignal(call.id, 'offer', offer, call.peerUserId);
      }
    } catch {
      showToast('Screen share was cancelled.');
    }
  };

  const ensurePeerConnection = async (call: CallItem) => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const rtcConfig = await fetchCallRtcConfiguration();
    const connection = new RTCPeerConnection(rtcConfig);
    const remoteStream = new MediaStream();
    setRemoteCallStream(remoteStream);
    callIceRestartCountRef.current = 0;
    emitCallConnection(call.id, 'connecting', null, call.peerUserId);

    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        if (!remoteStream.getTracks().some((existing) => existing.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });
      if (!event.streams[0] && event.track && !remoteStream.getTracks().some((existing) => existing.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      setRemoteCallStream(new MediaStream(remoteStream.getTracks()));
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        emitCallSignal(call.id, 'ice-candidate', event.candidate.toJSON(), call.peerUserId);
      }
    };

    const publishConnectionState = () => {
      const ice = connection.iceConnectionState;
      const conn = connection.connectionState;
      const mapped = mapRtcStatesToCallConnection(conn, ice);

      if (mapped === 'connected') {
        callIceRestartCountRef.current = 0;
        callIceRestartInFlightRef.current = false;
        setCallError(null);
        if (callLinkStateRef.current !== 'connected') {
          emitCallConnection(call.id, 'connected', callQualityRef.current, call.peerUserId);
        }
        return;
      }

      if (mapped === 'connecting') {
        if (callLinkStateRef.current !== 'connecting' && callLinkStateRef.current !== 'connected') {
          emitCallConnection(call.id, 'connecting', callQualityRef.current, call.peerUserId);
        }
        return;
      }

      if (mapped === 'closed') {
        if (callLinkStateRef.current !== 'closed') {
          emitCallConnection(call.id, 'closed', callQualityRef.current, call.peerUserId);
        }
        return;
      }

      // failed / reconnecting — attempt ICE restart a couple of times
      if (ice === 'failed' || ice === 'disconnected' || conn === 'failed' || conn === 'disconnected') {
        if (callLinkStateRef.current !== 'reconnecting' && callLinkStateRef.current !== 'failed') {
          emitCallConnection(call.id, 'reconnecting', callQualityRef.current, call.peerUserId);
        }
        void attemptIceRestart(call);
      }
    };

    connection.onconnectionstatechange = publishConnectionState;
    connection.oniceconnectionstatechange = publishConnectionState;

    const localStream = await ensureCallMedia(call.kind);
    localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    if (callAudioOnlyRef.current) {
      applyLocalVideoSendEnabled(false);
    }
    peerConnectionRef.current = connection;
    return connection;
  };

  const uploadFiles = async (files: File[], purpose?: string) => {
    if (!files.length) {
      return [];
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    if (purpose) {
      formData.append('purpose', purpose);
    }

    const response = await fetch(`${API_BASE_URL}/api/uploads`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    const payload = await response.json();
    return (payload.files ?? []).map((file: { url: string }) => file.url);
  };

  const allowProfileVideoPlayback = !appSettings.dataSaver && !prefersReducedMotion;

  const applyProfileFieldsFromServer = useCallback((serverProfile: any, fallback?: Partial<ProfileState>) => {
    if (!serverProfile) {
      return;
    }
    setProfile((current) => ({
      ...current,
      ...fallback,
      name: serverProfile.name ?? fallback?.name ?? current.name,
      about: serverProfile.about ?? fallback?.about ?? current.about,
      phone: serverProfile.phone ?? fallback?.phone ?? current.phone,
      photoUrl:
        serverProfile.photoUri
        || (typeof serverProfile.avatar === 'string' && serverProfile.avatar.startsWith('http')
          ? serverProfile.avatar
          : undefined)
        || fallback?.photoUrl
        || current.photoUrl,
      currency: serverProfile.currency || fallback?.currency || current.currency,
      profileVideoUri: serverProfile.profileVideoUri ?? fallback?.profileVideoUri ?? current.profileVideoUri,
      profileVideoPosterUri:
        serverProfile.profileVideoPosterUri ?? fallback?.profileVideoPosterUri ?? current.profileVideoPosterUri,
      profileVideoDurationSeconds:
        serverProfile.profileVideoDurationSeconds
        ?? fallback?.profileVideoDurationSeconds
        ?? current.profileVideoDurationSeconds,
    }));
  }, []);

  const getStatusItemDuration = (item: UpdateGroup['items'][number]) =>
    item.assets.some((asset) => asset.kind === 'video') ? STATUS_VIDEO_DURATION_MS : STATUS_IMAGE_DURATION_MS;
  const activeStatusDuration = activeStatusItem ? getStatusItemDuration(activeStatusItem) : null;

  const getUserMeta = useCallback((userId: string) => {
    const match = users.find((user) => user.id === userId);
    return {
      name: userId === currentUserId ? 'You' : match?.name ?? userId,
      avatar: match?.avatar ?? (userId === currentUserId ? profile.name.slice(0, 2).toUpperCase() : 'ZU'),
    };
  }, [currentUserId, profile.name, users]);

  const reconcileIncomingMessage = useCallback((chatId: string, incomingMessage: any) => {
    setMessagesByChat((current) => {
      const existing = current[chatId] ?? [];
      const existingIndex = existing.findIndex(
        (item) =>
          item.id === incomingMessage.id ||
          (incomingMessage.clientRef && item.clientRef === incomingMessage.clientRef),
      );
      const mapped = mapServerMessage(incomingMessage, currentUserId);

      if (existingIndex >= 0) {
        const next = [...existing];
        next[existingIndex] = { ...next[existingIndex], ...mapped };
        return { ...current, [chatId]: next };
      }

      return { ...current, [chatId]: [...existing, mapped] };
    });
  }, [currentUserId]);

  const upsertStatus = useCallback((nextStatus: StatusItem) => {
    setStatuses((current) => {
      const index = current.findIndex((item) => item.id === nextStatus.id);
      if (index < 0) {
        return [nextStatus, ...current];
      }
      const next = [...current];
      next[index] = nextStatus;
      return next;
    });

    setUpdatesFeed((current) =>
      current.map((entry) =>
        entry.userId === nextStatus.userId
          ? {
              ...entry,
              latestAt: entry.items.some((item) => item.id === nextStatus.id) ? entry.latestAt : nextStatus.createdAt,
              items: entry.items.some((item) => item.id === nextStatus.id)
                ? entry.items.map((item) => (item.id === nextStatus.id ? nextStatus : item))
                : [nextStatus, ...entry.items],
            }
          : entry,
      ),
    );
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    updatesFeedRef.current = updatesFeed;
  }, [updatesFeed]);

  useEffect(() => {
    statusGroupIndexRef.current = activeStatusGroupIndex;
  }, [activeStatusGroupIndex]);

  useEffect(() => {
    statusItemIndexRef.current = activeStatusItemIndex;
  }, [activeStatusItemIndex]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  const syncReceiptState = async (messageId: string, state: ReceiptState) => {
    await fetch(`${API_BASE_URL}/api/messages/${messageId}/receipt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }).catch(() => undefined);
  };

  const showToast = (message: string, duration = 2200) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = window.setTimeout(() => setToastMessage(''), duration);
  };

  const rememberOutbox = (items: OutboxEntry[]) => {
    const safe = items.filter((entry) => entry?.clientRef && entry.body && !isPaymentOutboxBody(entry.body));
    outboxRef.current = safe;
    setOutboxCount(safe.length);
    try {
      localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Quota / private mode — keep in-memory queue only.
    }
  };

  const clearOutbox = () => {
    if (outboxBackoffTimerRef.current) {
      window.clearTimeout(outboxBackoffTimerRef.current);
      outboxBackoffTimerRef.current = null;
    }
    outboxBackoffAttemptRef.current = 0;
    rememberOutbox([]);
  };

  const scheduleOutboxRetry = () => {
    if (outboxBackoffTimerRef.current) {
      window.clearTimeout(outboxBackoffTimerRef.current);
    }
    const delay = OUTBOX_BACKOFF_MS[
      Math.min(outboxBackoffAttemptRef.current, OUTBOX_BACKOFF_MS.length - 1)
    ];
    outboxBackoffAttemptRef.current += 1;
    outboxBackoffTimerRef.current = window.setTimeout(() => {
      outboxBackoffTimerRef.current = null;
      flushOutboxRef.current();
    }, delay);
  };

  const flushOutbox = async () => {
    if (outboxFlushLockRef.current) {
      return;
    }
    if (!outboxRef.current.length) {
      outboxBackoffAttemptRef.current = 0;
      return;
    }
    outboxFlushLockRef.current = true;
    let networkFailed = false;
    try {
      const queue = [...outboxRef.current];
      for (const entry of queue) {
        if (isPaymentOutboxBody(entry.body)) {
          rememberOutbox(outboxRef.current.filter((item) => item.clientRef !== entry.clientRef));
          continue;
        }
        try {
          const response = await fetch(`${API_BASE_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry.body),
          });
          if (!response.ok) {
            if (response.status === 400 || response.status === 429) {
              const failed = await response.json().catch(() => ({} as { error?: string }));
              showToast(failed.error || 'Message was not sent.');
              rememberOutbox(outboxRef.current.filter((item) => item.clientRef !== entry.clientRef));
              setMessagesByChat((current) => ({
                ...current,
                [entry.body.chatId]: (current[entry.body.chatId] ?? []).filter(
                  (item) => item.clientRef !== entry.clientRef,
                ),
              }));
            } else {
              networkFailed = true;
            }
            continue;
          }
          const payload = await response.json().catch(() => ({} as { message?: any; anonymousRemaining?: number }));
          if (payload.message) {
            reconcileIncomingMessage(entry.body.chatId, payload.message);
          }
          if (typeof payload.anonymousRemaining === 'number') {
            setAnonymousRemaining(payload.anonymousRemaining);
          }
          rememberOutbox(outboxRef.current.filter((item) => item.clientRef !== entry.clientRef));
        } catch {
          networkFailed = true;
        }
      }
    } finally {
      outboxFlushLockRef.current = false;
    }
    if (networkFailed && outboxRef.current.length) {
      scheduleOutboxRetry();
    } else if (!outboxRef.current.length) {
      outboxBackoffAttemptRef.current = 0;
    }
  };
  flushOutboxRef.current = () => {
    void flushOutbox();
  };

  const queueOutgoing = (body: OutboxMessageBody) => {
    if (!body.clientRef || isPaymentOutboxBody(body)) {
      return;
    }
    const entry: OutboxEntry = { clientRef: body.clientRef, body };
    const next = [
      ...outboxRef.current.filter((item) => item.clientRef !== body.clientRef),
      entry,
    ];
    rememberOutbox(next);
    void flushOutbox();
  };

  const rehydrateOutboxIntoThread = (entries = outboxRef.current, userId = currentUserId) => {
    if (!entries.length) {
      return;
    }
    setMessagesByChat((current) => mergeOutboxIntoMessages(current, entries, userId));
  };

  const persistAppSettings = async (nextSettings: typeof DEFAULT_APP_SETTINGS) => {
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  };

  const persistFavorites = (next: string[]) => {
    setFavoriteChatIds(next);
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
  };

  const persistMuted = (next: string[]) => {
    mutedChatIdsRef.current = next;
    setMutedChatIds(next);
    localStorage.setItem(MUTED_CHATS_STORAGE_KEY, JSON.stringify(next));
  };

  const persistArchived = (next: string[]) => {
    setArchivedChatIds(next);
    localStorage.setItem(ARCHIVED_CHATS_STORAGE_KEY, JSON.stringify(next));
  };

  const saveProfileToServer = async (
    overrides: Partial<ProfileState> = {},
    settingsOverrides: Partial<typeof DEFAULT_APP_SETTINGS> = {},
  ) => {
    if (!currentUserId) {
      showToast('Link your phone first to sync settings.');
      return false;
    }
    const nextProfile = { ...profile, ...overrides };
    const nextSettings = { ...appSettingsRef.current, ...settingsOverrides };
    try {
      const response = await fetch(`${API_BASE_URL}/api/profile?userId=${encodeURIComponent(currentUserId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nextProfile.name.trim() || undefined,
          about: nextProfile.about.trim() || 'Hey there! I am using ZynkUp.',
          phone: nextProfile.phone.trim() || undefined,
          photoUri: nextProfile.photoUrl || '',
          profileVideoUri: nextProfile.profileVideoUri || '',
          profileVideoPosterUri: nextProfile.profileVideoPosterUri || '',
          profileVideoDurationSeconds: nextProfile.profileVideoDurationSeconds ?? 0,
          lastSeenPrivacy: nextSettings.lastSeenPrivacy,
          profilePhotoPrivacy: nextSettings.profilePhotoPrivacy,
          profileVideoPrivacy: nextSettings.profileVideoPrivacy,
          aboutPrivacy: nextSettings.aboutPrivacy,
          statusPrivacy: nextSettings.statusPrivacy,
          readReceiptsEnabled: nextSettings.readReceiptsEnabled,
          appLockEnabled: nextSettings.appLockEnabled,
          reactionSoundEnabled: nextSettings.reactionSoundEnabled,
          reactionAnimationEnabled: nextSettings.reactionAnimationEnabled,
          preferredLanguage: (['en', 'tw', 'ga', 'ee', 'pcm'] as TranslateLanguage[]).includes(
            nextSettings.preferredLanguage,
          )
            ? nextSettings.preferredLanguage
            : 'en',
        }),
      });
      if (!response.ok) {
        showToast('Could not save settings.');
        return false;
      }
      const payload = await response.json();
      if (payload.profile) {
        applyProfileFieldsFromServer(payload.profile, nextProfile);
      }
      showToast('Settings saved');
      return true;
    } catch {
      showToast('Network error while saving settings.');
      return false;
    }
  };

  const removeProfileVideo = async () => {
    setProfile((current) => ({
      ...current,
      profileVideoUri: '',
      profileVideoPosterUri: '',
      profileVideoDurationSeconds: 0,
    }));
    await saveProfileToServer({
      profileVideoUri: '',
      profileVideoPosterUri: '',
      profileVideoDurationSeconds: 0,
    });
  };

  const uploadProfileVideo = async (file: File) => {
    showToast('Checking video…');
    try {
      const durationSeconds = await probeVideoDurationSeconds(file);
      if (durationSeconds < 1 || durationSeconds > PROFILE_VIDEO_MAX_SECONDS) {
        showToast(`Profile videos must be 1–${PROFILE_VIDEO_MAX_SECONDS} seconds.`);
        return;
      }
      showToast('Uploading video…');
      const uploaded = await uploadFiles([file], 'profile-video');
      const profileVideoUri = uploaded[0];
      if (!profileVideoUri) {
        showToast('Could not upload profile video.');
        return;
      }

      let profileVideoPosterUri = profile.photoUrl || '';
      if (!profileVideoPosterUri) {
        const posterBlob = await captureVideoPosterBlob(file);
        if (posterBlob) {
          const posterFile = new File([posterBlob], 'profile-video-poster.jpg', { type: 'image/jpeg' });
          const posterUploaded = await uploadFiles([posterFile]);
          profileVideoPosterUri = posterUploaded[0] || '';
        }
      }

      const nextFields = {
        profileVideoUri,
        profileVideoPosterUri,
        profileVideoDurationSeconds: durationSeconds,
      };
      setProfile((current) => ({ ...current, ...nextFields }));
      await saveProfileToServer(nextFields);
    } catch {
      showToast('Could not upload profile video.');
    }
  };

  const updateAppSetting = <K extends keyof typeof DEFAULT_APP_SETTINGS>(
    key: K,
    value: (typeof DEFAULT_APP_SETTINGS)[K],
    options: { syncProfile?: boolean } = {},
  ) => {
    const next = { ...appSettingsRef.current, [key]: value };
    void persistAppSettings(next);
    showToast('Setting updated', 1400);
    if (options.syncProfile) {
      void saveProfileToServer({}, { [key]: value } as Partial<typeof DEFAULT_APP_SETTINGS>);
    }
  };

  const toggleFavoriteChat = (chatId: string) => {
    const exists = favoriteChatIds.includes(chatId);
    persistFavorites(exists ? favoriteChatIds.filter((id) => id !== chatId) : [chatId, ...favoriteChatIds]);
    showToast(exists ? 'Removed from favorites' : 'Added to favorites');
  };

  const toggleMuteChat = (chatId: string) => {
    const exists = mutedChatIds.includes(chatId);
    persistMuted(exists ? mutedChatIds.filter((id) => id !== chatId) : [chatId, ...mutedChatIds]);
    showToast(exists ? 'Chat unmuted' : 'Chat muted');
  };

  const toggleArchiveChat = (chatId: string) => {
    const exists = archivedChatIds.includes(chatId);
    persistArchived(exists ? archivedChatIds.filter((id) => id !== chatId) : [chatId, ...archivedChatIds]);
    showToast(exists ? 'Chat unarchived' : 'Chat archived');
  };

  const refreshBlockedContacts = async (idsOverride?: string[]) => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/users/blocked?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(payload.blocked)) {
        setBlockedContacts(payload.blocked as BlockedContact[]);
        if (Array.isArray(payload.blockedUserIds)) {
          setProfile((current) => ({ ...current, blockedUserIds: payload.blockedUserIds }));
        }
        return;
      }
    } catch {
      // Fall back to local profile ids.
    }
    const ids = idsOverride || profile.blockedUserIds || [];
    setBlockedContacts(
      ids.map((id) => {
        const user = users.find((item) => item.id === id);
        return {
          id,
          name: user?.name || 'Blocked user',
          phone: user?.phone || '',
        };
      }),
    );
  };

  const blockUser = async (targetUserId?: string, targetPhone?: string) => {
    if (!currentUserId || (!targetUserId && !targetPhone) || targetUserId === currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          ...(targetUserId ? { targetUserId } : {}),
          ...(targetPhone ? { targetPhone } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not block this person.');
        return;
      }
      const nextIds = Array.isArray(payload.blockedUserIds) ? payload.blockedUserIds : [];
      setProfile((current) => ({ ...current, blockedUserIds: nextIds }));
      void refreshBlockedContacts(nextIds);
      showToast('Blocked. They can no longer message or call you.');
    } catch {
      showToast('Could not block this person.');
    }
  };

  const unblockUser = async (targetUserId?: string, targetPhone?: string) => {
    if (!currentUserId || (!targetUserId && !targetPhone)) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          ...(targetUserId ? { targetUserId } : {}),
          ...(targetPhone ? { targetPhone } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not unblock this person.');
        return;
      }
      const nextIds = Array.isArray(payload.blockedUserIds) ? payload.blockedUserIds : [];
      setProfile((current) => ({ ...current, blockedUserIds: nextIds }));
      void refreshBlockedContacts(nextIds);
      showToast('Unblocked.');
    } catch {
      showToast('Could not unblock this person.');
    }
  };

  const confirmBlockPeer = (targetUserId?: string, targetPhone?: string, name?: string) => {
    if (!targetUserId && !targetPhone) return;
    const alreadyBlocked = targetUserId ? profile.blockedUserIds.includes(targetUserId) : false;
    const ok = window.confirm(
      alreadyBlocked
        ? 'Unblock this person? They will be able to message and call you again.'
        : `Block ${name || 'this person'}? They will not be able to message or call you.`,
    );
    if (!ok) return;
    if (alreadyBlocked) {
      void unblockUser(targetUserId, targetPhone);
      return;
    }
    void blockUser(targetUserId, targetPhone);
  };

  const openReportSheet = (target: ReportTargetState) => {
    if (!target.targetUserId && !target.targetPhone && !target.messageId) return;
    setReportReason('');
    setReportDetails('');
    setReportTarget(target);
  };

  const submitUserReport = async () => {
    if (!reportTarget || !currentUserId) return;
    if (!reportReason) {
      showToast('Pick a reason for this report.');
      return;
    }
    setReportBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          targetUserId: reportTarget.targetUserId || undefined,
          targetPhone: reportTarget.targetPhone || undefined,
          messageId: reportTarget.messageId || undefined,
          chatId: reportTarget.chatId || undefined,
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not send report.');
        return;
      }
      setReportTarget(null);
      setReportReason('');
      setReportDetails('');
      showToast(payload.message || 'Report sent. Thanks for helping keep ZynkUp safe.');
    } catch {
      showToast('Could not send report.');
    } finally {
      setReportBusy(false);
    }
  };

  const clearChatUnread = (chatId: string) => {
    if (!chatId || !currentUserId) {
      return;
    }
    setChatItems((current) => current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)));
    fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    }).catch(() => undefined);
  };

  const emitTyping = (typing: boolean) => {
    if (!socketRef.current || !selectedChatId || !currentUserId) {
      return;
    }
    socketRef.current.emit('typing:update', {
      chatId: selectedChatId,
      userId: currentUserId,
      typing,
    });
  };

  const getPresenceLabel = (chat: Chat | null) => {
    if (!chat) {
      return 'offline';
    }
    if (peerTypingByChat[chat.id]) {
      return 'typing…';
    }
    const peer = users.find((user) => user.id === chat.peerUserId);
    if (peer?.presence === 'online' || peer?.presence === 'typing') {
      return peer.presence === 'typing' ? 'typing…' : 'online';
    }
    if (peer?.lastSeenAt || chat.lastSeenAt) {
      return `last seen ${formatClock(peer?.lastSeenAt || chat.lastSeenAt || '')}`;
    }
    return chat.presence || 'offline';
  };

  const clearChatHistory = () => {
    if (!window.confirm('Clear all local chat history on this browser?')) {
      return;
    }
    clearOutbox();
    setMessagesByChat({});
    setChatItems((current) => current.map((chat) => ({ ...chat, preview: 'No messages yet', unread: 0, time: '' })));
    showToast('Chat history cleared');
  };

  const deleteMessage = async (message: Message, scope: 'me' | 'everyone' = 'me') => {
    if (!message?.id || !currentUserId || !activeChat) {
      return;
    }
    if (scope === 'me') {
      setMessagesByChat((current) => ({
        ...current,
        [activeChat.id]: (current[activeChat.id] ?? []).filter((item) => item.id !== message.id),
      }));
    }
    const response = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, scope }),
    }).catch(() => null);
    if (!response?.ok && scope === 'everyone') {
      showToast('Could not delete for everyone');
      return;
    }
    showToast(scope === 'everyone' ? 'Deleted for everyone' : 'Deleted for you');
    setMessageActionTarget(null);
  };

  const forwardMessage = async (message: Message) => {
    const peers = chatItems.filter((chat) => chat.id !== activeChat?.id).slice(0, 8);
    if (!peers.length) {
      showToast('No other chat to forward into yet.');
      return;
    }
    const choice = window.prompt(
      `Forward to chat number:\n${peers.map((chat, index) => `${index + 1}. ${chat.name}`).join('\n')}`,
      '1',
    );
    const index = Number(choice) - 1;
    const target = peers[index];
    if (!target) {
      return;
    }
    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: target.id,
        senderId: currentUserId,
        clientRef: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: message.kind === 'image' || message.kind === 'voice' || message.kind === 'video' ? message.kind : 'text',
        text: message.text || 'Forwarded message',
        mediaUrls: [message.imageUrl || message.audioUrl || message.videoUrl].filter(Boolean),
      }),
    }).catch(() => undefined);
    showToast(`Forwarded to ${target.name}`);
    setMessageActionTarget(null);
  };

  const persistReactionSoundMutedChats = (next: string[]) => {
    reactionSoundMutedChatIdsRef.current = next;
    setReactionSoundMutedChatIds(next);
    localStorage.setItem(REACTION_SOUND_MUTED_STORAGE_KEY, JSON.stringify(next));
  };

  const triggerReactionFeedback = (messageId: string, entry: ReactionCatalogEntry | undefined, playSound: boolean) => {
    if (playSound && entry?.soundKey && appSettingsRef.current.reactionSoundEnabled) {
      const chatId = activeChat?.id;
      if (!chatId || !reactionSoundMutedChatIdsRef.current.includes(chatId)) {
        playReactionSoundCue(entry.soundKey);
      }
    }
    if (
      entry
      && entry.kind !== 'standard'
      && appSettingsRef.current.reactionAnimationEnabled
      && !prefersReducedMotion
    ) {
      const bounceKey = `${messageId}:${entry.id || entry.emoji}`;
      setBouncingReactionKeys((current) => ({ ...current, [bounceKey]: Date.now() }));
      window.setTimeout(() => {
        setBouncingReactionKeys((current) => {
          if (!current[bounceKey]) return current;
          const next = { ...current };
          delete next[bounceKey];
          return next;
        });
      }, 700);
    }
  };

  const toggleMessageReaction = async (
    message: Message,
    selection: { emoji?: string; reactionId?: string },
  ) => {
    if (!currentUserId || message.deletedForEveryone) return;
    const entry =
      (selection.reactionId
        ? reactionCatalog.find((item) => item.id === selection.reactionId)
        : undefined)
      || reactionCatalog.find((item) => item.emoji === selection.emoji);
    const mine = (message.reactions || []).find((reaction) => reaction.userId === currentUserId);
    const selectedEmoji = selection.emoji || entry?.emoji;
    const selectedId = selection.reactionId || entry?.id;
    const sameAsMine = Boolean(
      mine
      && (
        (selectedId && mine.reactionId === selectedId)
        || (selectedEmoji && mine.emoji === selectedEmoji)
      ),
    );
    const removing = sameAsMine;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}/reactions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            emoji: selectedEmoji,
            reactionId: selectedId,
          }),
        },
      );
      if (!response.ok) {
        showToast('Could not update reaction.');
        return;
      }
      const payload = await response.json();
      const nextReactions = mapMessageReactions(payload.reactions ?? payload.message?.reactions) ?? [];
      const chatId = activeChat?.id || payload.message?.chatId;
      if (chatId) {
        setMessagesByChat((current) => ({
          ...current,
          [chatId]: (current[chatId] ?? []).map((item) =>
            item.id === message.id ? { ...item, reactions: nextReactions } : item,
          ),
        }));
      }
      if (!removing) {
        triggerReactionFeedback(message.id, entry, true);
      }
      setReactionPickerMessageId(null);
    } catch {
      showToast('Network error while reacting.');
    }
  };

  const toggleReactionSoundMuteForChat = async (chatId: string) => {
    if (!currentUserId || !chatId) return;
    const muted = !reactionSoundMutedChatIds.includes(chatId);
    const next = muted
      ? [...reactionSoundMutedChatIds, chatId]
      : reactionSoundMutedChatIds.filter((id) => id !== chatId);
    persistReactionSoundMutedChats(next);
    showToast(muted ? 'Reaction sounds muted in this chat' : 'Reaction sounds unmuted');
    try {
      await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/reaction-sound-mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, muted }),
      });
    } catch {
      // Client-side mute still applies if sync fails.
    }
  };

  const loadReactionCatalog = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/reactions/catalog`);
      if (!response.ok) return;
      const payload = await response.json();
      const list = Array.isArray(payload.reactions) ? payload.reactions : [];
      const mapped = list
        .map((item: any): ReactionCatalogEntry | null => {
          if (!item || typeof item.id !== 'string' || typeof item.emoji !== 'string') return null;
          const kind: ReactionKind =
            item.kind === 'animated' || item.kind === 'sound' || item.kind === 'standard'
              ? item.kind
              : 'standard';
          return {
            id: item.id,
            emoji: item.emoji,
            label: typeof item.label === 'string' ? item.label : item.emoji,
            kind,
            animationKey: typeof item.animationKey === 'string' ? item.animationKey : undefined,
            soundKey: typeof item.soundKey === 'string' ? item.soundKey : undefined,
            fallbackEmoji:
              typeof item.fallbackEmoji === 'string' ? item.fallbackEmoji : item.emoji,
          };
        })
        .filter((item: ReactionCatalogEntry | null): item is ReactionCatalogEntry => Boolean(item));
      reactionCatalogRef.current = mapped;
      setReactionCatalog(mapped);
    } catch {
      // Catalog is optional until backend is reachable.
    }
  }, []);

  const applyBootstrap = useCallback((payload: any) => {
    setAuthRequired(Boolean(payload.authRequired));
    setCurrentUserId(payload.currentUserId ?? '');
    setCurrentDeviceId(payload.currentDeviceId ?? null);
    const nextUsers = payload.users ?? [];
    setUsers(nextUsers);
    setProfile({
      name: payload.profile?.name ?? 'Temwa Lesa',
      about: payload.profile?.about ?? '',
      phone: payload.profile?.phone ?? '',
      photoUrl:
        payload.profile?.photoUri ||
        (payload.profile?.avatar?.startsWith?.('http')
          ? payload.profile.avatar
          : 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80'),
      currency: payload.profile?.currency || 'GHS',
      profileVideoUri: payload.profile?.profileVideoUri || '',
      profileVideoPosterUri: payload.profile?.profileVideoPosterUri || '',
      profileVideoDurationSeconds: payload.profile?.profileVideoDurationSeconds ?? 0,
      blockedUserIds: Array.isArray(payload.profile?.blockedUserIds) ? payload.profile.blockedUserIds : [],
    });
    if (payload.profile) {
      setAppSettings((current) => {
        const next = {
          ...current,
          lastSeenPrivacy: payload.profile.lastSeenPrivacy ?? current.lastSeenPrivacy,
          profilePhotoPrivacy: payload.profile.profilePhotoPrivacy ?? current.profilePhotoPrivacy,
          profileVideoPrivacy: payload.profile.profileVideoPrivacy ?? current.profileVideoPrivacy,
          aboutPrivacy: payload.profile.aboutPrivacy ?? current.aboutPrivacy,
          statusPrivacy: payload.profile.statusPrivacy ?? current.statusPrivacy,
          readReceiptsEnabled:
            payload.profile.readReceiptsEnabled == null
              ? current.readReceiptsEnabled
              : Boolean(payload.profile.readReceiptsEnabled),
          appLockEnabled:
            payload.profile.appLockEnabled == null
              ? current.appLockEnabled
              : Boolean(payload.profile.appLockEnabled),
          reactionSoundEnabled:
            payload.profile.reactionSoundEnabled == null
              ? current.reactionSoundEnabled
              : Boolean(payload.profile.reactionSoundEnabled),
          reactionAnimationEnabled:
            payload.profile.reactionAnimationEnabled == null
              ? current.reactionAnimationEnabled
              : Boolean(payload.profile.reactionAnimationEnabled),
          preferredLanguage: (['en', 'tw', 'ga', 'ee', 'pcm'] as TranslateLanguage[]).includes(
            payload.profile.preferredLanguage,
          )
            ? payload.profile.preferredLanguage
            : current.preferredLanguage || 'en',
        };
        appSettingsRef.current = next;
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        setTranslateTargetLanguage(next.preferredLanguage || 'en');
        return next;
      });
    }
    const nextChats = (payload.chats ?? []).map((chat: any) => mapChatFromServer(chat, payload.currentUserId ?? '', nextUsers));
    setChatItems(nextChats);
    const viewerId = payload.currentUserId ?? '';
    if (viewerId) {
      const mutedFromServer = nextChats
        .filter((chat: Chat) => (chat.reactionSoundMutedBy || []).includes(viewerId))
        .map((chat: Chat) => chat.id);
      if (mutedFromServer.length) {
        setReactionSoundMutedChatIds((current) => {
          const merged = Array.from(new Set(current.concat(mutedFromServer)));
          reactionSoundMutedChatIdsRef.current = merged;
          localStorage.setItem(REACTION_SOUND_MUTED_STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      }
    }
    setSelectedChatId((current) =>
      nextChats.some((chat: Chat) => chat.id === current) ? current : nextChats[0]?.id ?? '',
    );
    const serverMessages = Object.fromEntries(
      Object.entries(payload.messagesByChat ?? {}).map(([chatId, messageList]) => [
        chatId,
        (messageList as any[]).map((message) => mapServerMessage(message, payload.currentUserId ?? '')),
      ]),
    );
    setMessagesByChat(
      payload.authRequired
        ? serverMessages
        : mergeOutboxIntoMessages(serverMessages, outboxRef.current, payload.currentUserId ?? ''),
    );
    setCatalogItems(
      (payload.catalogItems ?? []).map((item: any) => mapCatalogItemFromServer(item, nextUsers)),
    );
    const nextCalls = (payload.calls ?? []).map((call: any) => mapCallFromServer(call, payload.currentUserId ?? '', nextUsers));
    setCalls(nextCalls);
    const liveCall = nextCalls.find((call: CallItem) => call.state === 'ongoing' || call.state === 'ringing') ?? null;
    setActiveCall(liveCall);
    setIncomingCall(
      nextCalls.find((call: CallItem) => call.state === 'ringing' && call.initiatorId !== (payload.currentUserId ?? '')) ?? null,
    );
    setStatuses(payload.statuses ?? []);
    setUpdatesFeed(payload.updatesFeed ?? []);
    if (payload.authRequired) {
      clearOutbox();
      setLinkStatus((current) => (current === 'pin_required' ? current : 'idle'));
      setDesktopPin('');
      setLinkedDevices([]);
      return;
    }

    setLinkRequestId('');
    setLinkToken('');
    setLinkQrDataUrl('');
    setDesktopPin('');
    setLinkStatus('linked');
    setLinkError('');
  }, []);
  applyBootstrapRef.current = applyBootstrap;

  const fetchLinkedDevices = useCallback(async (userId: string) => {
    if (!userId) {
      setLinkedDevices([]);
      return;
    }

    const response = await fetch(`${API_BASE