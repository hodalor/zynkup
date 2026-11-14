import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import './App.css';

type View = 'chats' | 'calls' | 'catalog' | 'settings' | 'updates' | 'communities' | 'voiceRooms' | 'games';
type ReceiptState = 'sent' | 'delivered' | 'read';
type SettingsPanelId =
  | 'favorites'
  | 'business'
  | 'history'
  | 'account'
  | 'privacy'
  | 'chats'
  | 'notifications'
  | 'storage'
  | 'help'
  | '';

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
  adminIds?: string[];
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
  createdAt: string;
  updatedAt: string;
};

type AiTone = 'polite' | 'concise' | 'professional' | 'friendly' | 'apologetic';

type AiAssistantTask = 'draft' | 'rewrite' | 'summarise' | 'translate' | 'suggest_reply' | 'explain';

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
  buyerName: string;
  sellerName: string;
  businessName: string;
  totalAmount: number;
  currency: string;
  state: string;
  items: Array<{ title: string; quantity: number; price: number }>;
  paymentMethod?: string;
  paymentReference?: string;
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
  | 'documents'
  | 'broadcasts'
  | 'ai'
  | 'twin';

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

type AppUser = {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  presence?: string;
  lastSeenAt?: string;
  photoUri?: string;
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

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:4000';
const AI_TONES: AiTone[] = ['polite', 'concise', 'professional', 'friendly', 'apologetic'];
const AI_ASSISTANT_TASKS: Array<{ id: AiAssistantTask; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'suggest_reply', label: 'Suggest reply' },
  { id: 'summarise', label: 'Summarise' },
  { id: 'translate', label: 'Translate' },
  { id: 'explain', label: 'Explain' },
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
  { id: 'pcm', label: 'Pidgin' },
];
const DEVICE_STORAGE_KEY = 'zynkup-web-device-id';
const SETTINGS_STORAGE_KEY = 'zynkup-web-app-settings';
const FAVORITES_STORAGE_KEY = 'zynkup-web-favorite-chats';
const MUTED_CHATS_STORAGE_KEY = 'zynkup-web-muted-chats';
const ARCHIVED_CHATS_STORAGE_KEY = 'zynkup-web-archived-chats';
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const STATUS_REACTIONS = ['❤️', '👍', '👎', '🔥', '😂'];

const DEFAULT_APP_SETTINGS = {
  enterIsSend: true,
  mediaAutoDownload: true,
  messageNotifications: true,
  showNotificationPreview: true,
  conversationTones: true,
  saveToCameraRoll: false,
  lowDataMode: false,
  lastSeenPrivacy: 'everyone' as const,
  profilePhotoPrivacy: 'everyone' as const,
  aboutPrivacy: 'everyone' as const,
  statusPrivacy: 'contacts' as const,
  readReceiptsEnabled: true,
  appLockEnabled: false,
};

const SETTINGS_MENU: Array<{ id: Exclude<SettingsPanelId, ''>; title: string; subtitle: string }> = [
  { id: 'favorites', title: 'Favorites', subtitle: 'Pin important chats to the top' },
  { id: 'business', title: 'Business tools', subtitle: 'Catalog, customers, invoices, quotations, broadcasts, and sales' },
  { id: 'history', title: 'Chat history', subtitle: 'Export or clear conversations' },
  { id: 'account', title: 'Account', subtitle: 'Profile and security' },
  { id: 'privacy', title: 'Privacy', subtitle: 'Last seen, read receipts, marketing' },
  { id: 'chats', title: 'Chats', subtitle: 'Enter is send and media' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Message alerts and previews' },
  { id: 'storage', title: 'Storage and data', subtitle: 'Network usage and cache' },
  { id: 'help', title: 'Help and feedback', subtitle: 'FAQ and support' },
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

const WEBRTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
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
    adminIds: Array.isArray(chat.adminIds)
      ? chat.adminIds.filter((id: unknown): id is string => typeof id === 'string')
      : undefined,
  };
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
const playWebCue = (kind: 'message' | 'call') => {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  if (!webAudioContext) webAudioContext = new Ctx();
  const ctx = webAudioContext;
  void ctx.resume().catch(() => undefined);
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
  const [mediaViewer, setMediaViewer] = useState<string | null>(null);
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
  const [profile, setProfile] = useState({
    name: 'Temwa Lesa',
    about: 'Seller, founder, and product operator.',
    phone: '+260765453163',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    currency: 'GHS',
  });
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanelId>('account');
  const [businessHubTab, setBusinessHubTab] = useState<BusinessHubTab>('catalog');
  const [salesDashboard, setSalesDashboard] = useState<SalesDashboard | null>(null);
  const [salesDashboardPeriod, setSalesDashboardPeriod] = useState<'today' | '7d' | '30d'>('7d');
  const [commerceOrders, setCommerceOrders] = useState<CommerceOrder[]>([]);
  const [saleReceipts, setSaleReceipts] = useState<SaleReceipt[]>([]);
  const [receiptDetail, setReceiptDetail] = useState<SaleReceipt | null>(null);
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
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  const catalogInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
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
  const callMediaStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const applyBootstrapRef = useRef<(payload: any) => void>(() => undefined);
  const appSettingsRef = useRef(DEFAULT_APP_SETTINGS);
  const mutedChatIdsRef = useRef<string[]>([]);
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

  const closePeerConnection = () => {
    peerConnectionRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    callMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    callMediaStreamRef.current = null;
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
      callMediaStreamRef.current = existing;
      setLocalCallStream(new MediaStream(existing.getTracks()));
      return existing;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video' ? { facingMode: 'user' } : false,
    });
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

  const ensurePeerConnection = async (call: CallItem) => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const connection = new RTCPeerConnection(WEBRTC_CONFIGURATION);
    const remoteStream = new MediaStream();
    setRemoteCallStream(remoteStream);
    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      setRemoteCallStream(new MediaStream(remoteStream.getTracks()));
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        emitCallSignal(call.id, 'ice-candidate', event.candidate.toJSON(), call.peerUserId);
      }
    };
    const localStream = await ensureCallMedia(call.kind);
    localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    peerConnectionRef.current = connection;
    return connection;
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) {
      return [];
    }

    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });

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
    overrides: Partial<typeof profile> = {},
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
          lastSeenPrivacy: nextSettings.lastSeenPrivacy,
          profilePhotoPrivacy: nextSettings.profilePhotoPrivacy,
          aboutPrivacy: nextSettings.aboutPrivacy,
          statusPrivacy: nextSettings.statusPrivacy,
          readReceiptsEnabled: nextSettings.readReceiptsEnabled,
          appLockEnabled: nextSettings.appLockEnabled,
        }),
      });
      if (!response.ok) {
        showToast('Could not save settings.');
        return false;
      }
      const payload = await response.json();
      if (payload.profile) {
        setProfile((current) => ({
          ...current,
          name: payload.profile.name ?? current.name,
          about: payload.profile.about ?? current.about,
          phone: payload.profile.phone ?? current.phone,
          photoUrl: payload.profile.photoUri || current.photoUrl,
          currency: payload.profile.currency || current.currency,
        }));
      }
      showToast('Settings saved');
      return true;
    } catch {
      showToast('Network error while saving settings.');
      return false;
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
    });
    if (payload.profile) {
      setAppSettings((current) => {
        const next = {
          ...current,
          lastSeenPrivacy: payload.profile.lastSeenPrivacy ?? current.lastSeenPrivacy,
          profilePhotoPrivacy: payload.profile.profilePhotoPrivacy ?? current.profilePhotoPrivacy,
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
        };
        appSettingsRef.current = next;
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    }
    const nextChats = (payload.chats ?? []).map((chat: any) => mapChatFromServer(chat, payload.currentUserId ?? '', nextUsers));
    setChatItems(nextChats);
    setSelectedChatId((current) =>
      nextChats.some((chat: Chat) => chat.id === current) ? current : nextChats[0]?.id ?? '',
    );
    setMessagesByChat(
      Object.fromEntries(
        Object.entries(payload.messagesByChat ?? {}).map(([chatId, messageList]) => [
          chatId,
          (messageList as any[]).map((message) => mapServerMessage(message, payload.currentUserId ?? '')),
        ]),
      ),
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

    const response = await fetch(`${API_BASE_URL}/api/devices?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    setLinkedDevices(payload.devices ?? []);
    setLinkedDeviceSlots({
      linkedCount: payload.linkedCount ?? (payload.devices ?? []).length,
      limit: payload.limit ?? 4,
      remaining: payload.remaining ?? 4,
    });
  }, []);

  const createDesktopLinkRequest = useCallback(async () => {
    if (!authRequired || !currentDeviceId) {
      return;
    }

    setLinkError('');
    setDesktopPin('');
    const response = await fetch(`${API_BASE_URL}/api/link/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: currentDeviceId,
        platform: 'web',
        label: 'Desktop browser',
      }),
    });
    if (!response.ok) {
      setLinkError('Unable to create a QR link right now.');
      return;
    }

    const payload = await response.json();
    let parsedQrPayload: { token?: string } | null = null;
    try {
      parsedQrPayload = JSON.parse(payload.qrPayload ?? '{}');
    } catch {
      parsedQrPayload = null;
    }
    setLinkRequestId(payload.requestId ?? '');
    setLinkToken(parsedQrPayload?.token ?? '');
    setLinkStatus('pending');
    const qrDataUrl = await QRCode.toDataURL(payload.qrPayload ?? '', {
      width: 248,
      margin: 1,
      color: {
        dark: '#0f2f33',
        light: '#f5f7f2',
      },
    });
    setLinkQrDataUrl(qrDataUrl);
  }, [authRequired, currentDeviceId]);

  const verifyDesktopPin = async () => {
    if (!linkRequestId || !linkToken || desktopPin.trim().length !== 4) {
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/link/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: linkRequestId,
        token: linkToken,
        pin: desktopPin.trim(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLinkError(payload.error ?? 'Incorrect pin.');
      return;
    }

    if (payload.session?.deviceId) {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
      setCurrentDeviceId(payload.session.deviceId);
    }
    if (payload.bootstrap) {
      applyBootstrap(payload.bootstrap);
    }
  };

  useEffect(() => {
    if (authRequired && currentDeviceId && !linkRequestId && linkStatus !== 'pending') {
      void createDesktopLinkRequest();
    }
  }, [authRequired, createDesktopLinkRequest, currentDeviceId, linkRequestId, linkStatus]);

  useEffect(() => {
    if (!authRequired || !linkRequestId) {
      return;
    }

    const timer = window.setInterval(() => {
      fetch(`${API_BASE_URL}/api/link/request/${encodeURIComponent(linkRequestId)}`)
        .then((response) => response.json())
        .then((payload) => {
          if (payload.status === 'linked') {
            if (payload.session?.deviceId) {
              window.localStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
              setCurrentDeviceId(payload.session.deviceId);
            }
            if (payload.bootstrap) {
              applyBootstrapRef.current(payload.bootstrap);
            }
            return;
          }

          if (payload.status === 'pin_required') {
            setLinkStatus('pin_required');
            return;
          }

          if (payload.status === 'expired') {
            setLinkStatus('expired');
          }
        })
        .catch(() => undefined);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [authRequired, linkRequestId]);

  useEffect(() => {
    if (!authRequired && currentUserId) {
      void fetchLinkedDevices(currentUserId);
    }
  }, [authRequired, currentUserId, fetchLinkedDevices]);

  const closeStatusViewer = useCallback(() => {
    setActiveStatusGroupIndex(null);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
    setStatusElapsedMs(0);
    setStatusThreadVisible(false);
    setStatusViewersVisible(false);
    setStatusReactorsVisible(false);
    setStatusHoldActive(false);
    setStatusCommentDraft('');
    setEditingStatusCommentId(null);
    setEditingStatusCommentText('');
  }, []);

  const openStatusViewer = (groupIndex: number) => {
    setActiveStatusGroupIndex(groupIndex);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
    setStatusElapsedMs(0);
    setStatusCommentDraft('');
    setStatusViewersVisible(false);
    setStatusReactorsVisible(false);
    setEditingStatusCommentId(null);
  };

  const moveStatus = useCallback((direction: 'next' | 'previous') => {
    const currentGroupIndex = statusGroupIndexRef.current;
    const currentItemIndex = statusItemIndexRef.current;
    const feed = updatesFeedRef.current;

    if (currentGroupIndex === null) {
      return;
    }

    const currentGroup = feed[currentGroupIndex];
    if (!currentGroup) {
      closeStatusViewer();
      return;
    }

    if (direction === 'previous') {
      if (currentItemIndex > 0) {
        setActiveStatusItemIndex((current) => current - 1);
        setStatusProgress(0);
        setStatusElapsedMs(0);
        return;
      }

      if (currentGroupIndex > 0) {
        const previousGroup = feed[currentGroupIndex - 1];
        setActiveStatusGroupIndex(currentGroupIndex - 1);
        setActiveStatusItemIndex(Math.max(0, (previousGroup?.items.length ?? 1) - 1));
        setStatusProgress(0);
        setStatusElapsedMs(0);
      }
      return;
    }

    if (currentItemIndex < currentGroup.items.length - 1) {
      setActiveStatusItemIndex((current) => current + 1);
      setStatusProgress(0);
      setStatusElapsedMs(0);
      return;
    }

    if (currentGroupIndex < feed.length - 1) {
      setActiveStatusGroupIndex(currentGroupIndex + 1);
      setActiveStatusItemIndex(0);
      setStatusProgress(0);
      setStatusElapsedMs(0);
      return;
    }

    closeStatusViewer();
  }, [closeStatusViewer]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapSession = async () => {
      const deviceId = window.localStorage.getItem(DEVICE_STORAGE_KEY) ?? undefined;

      try {
        const response = await fetch(`${API_BASE_URL}/api/session/ensure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            platform: 'web',
            label: 'Web browser',
          }),
        });
        if (!response.ok) {
          throw new Error('Session bootstrap failed');
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        if (payload.session?.deviceId) {
          window.localStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
          setCurrentDeviceId(payload.session.deviceId);
        }
        if (payload.bootstrap) {
          applyBootstrapRef.current(payload.bootstrap);
        }
        return;
      } catch {
        const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
        fetch(`${API_BASE_URL}/api/bootstrap${query}`)
          .then((response) => response.json())
          .then((payload) => {
            if (!cancelled) {
              applyBootstrapRef.current(payload);
            }
          })
          .catch(() => undefined);
      }
    };

    void bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {

    const socket = io(API_BASE_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('system:ready', (payload) => {
      if (payload.bootstrap && !currentDeviceId) {
        applyBootstrapRef.current(payload.bootstrap);
      }
    });
    socket.on('message:new', (message) => {
      reconcileIncomingMessage(message.chatId, message);

      if (message.senderId !== currentUserId) {
        const pageVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
        const viewingChat = pageVisible && activeViewRef.current === 'chats' && message.chatId === selectedChatIdRef.current;
        const settings = appSettingsRef.current;
        void syncReceiptState(
          message.id,
          viewingChat && settings.readReceiptsEnabled ? 'read' : 'delivered',
        );
        if (
          settings.messageNotifications &&
          !viewingChat &&
          !mutedChatIdsRef.current.includes(message.chatId) &&
          typeof Notification !== 'undefined'
        ) {
          const preview = settings.showNotificationPreview
            ? message.text || 'New message'
            : 'New message';
          playWebCue('message');
          if (Notification.permission === 'granted') {
            new Notification('ZynkUp', { body: preview });
          } else {
            showToast(preview);
          }
        } else if (settings.messageNotifications && !viewingChat && !mutedChatIdsRef.current.includes(message.chatId)) {
          playWebCue('message');
          showToast(settings.showNotificationPreview ? message.text || 'New message' : 'New message');
        }
      }
    });
    socket.on('message:scamWarning', (payload: {
      chatId?: string;
      messageId?: string;
      warning?: ScamWarningInfo;
    }) => {
      if (!payload?.chatId || !payload?.messageId || !payload.warning?.risky) {
        return;
      }
      const key = `${payload.chatId}:${payload.messageId}`;
      setScamWarningsByKey((current) => ({ ...current, [key]: payload.warning! }));
      const advice = payload.warning.advice || 'Possible scam signals detected. Do not share PINs or OTPs.';
      showToast(advice, 5000);
    });

    socket.on('message:transcript', (payload: { message?: any }) => {
      const nextMessage = payload?.message;
      if (!nextMessage?.id || !nextMessage?.chatId) {
        return;
      }
      reconcileIncomingMessage(nextMessage.chatId, nextMessage);
    });

    socket.on('message:deleted', ({ message, scope, userId }) => {
      if (!message?.chatId) {
        return;
      }
      if (scope === 'me' && userId !== currentUserId) {
        return;
      }
      if (scope === 'me') {
        setMessagesByChat((current) => ({
          ...current,
          [message.chatId]: (current[message.chatId] ?? []).filter((item) => item.id !== message.id),
        }));
        return;
      }
      reconcileIncomingMessage(message.chatId, message);
    });
    socket.on('typing:update', ({ chatId, userId, typing }) => {
      if (!chatId || userId === currentUserId) {
        return;
      }
      setPeerTypingByChat((current) => ({ ...current, [chatId]: Boolean(typing) }));
    });
    socket.on('presence:changed', ({ userId, presence, lastSeenAt }) => {
      if (!userId) {
        return;
      }
      setUsers((current) =>
        current.map((user) =>
          user.id === userId ? { ...user, presence, lastSeenAt: lastSeenAt ?? user.lastSeenAt } : user,
        ),
      );
      setChatItems((current) =>
        current.map((chat) =>
          chat.peerUserId === userId
            ? { ...chat, presence, lastSeenAt: lastSeenAt ?? chat.lastSeenAt }
            : chat,
        ),
      );
    });
    socket.on('chat:updated', (chat) => {
      if (chat.viewerUserId && chat.viewerUserId !== currentUserId) {
        return;
      }
      setChatItems((current) =>
        current.map((item) =>
          item.id === chat.id
            ? {
                ...item,
                preview: chat.lastMessagePreview,
                unread: chat.unreadCount ?? item.unread,
                time: formatClock(chat.updatedAt),
                kind: chat.kind === 'group' || chat.kind === 'direct' ? chat.kind : item.kind,
                communityId: typeof chat.communityId === 'string' ? chat.communityId : item.communityId,
                allowAnonymous: typeof chat.allowAnonymous === 'boolean'
                  ? chat.allowAnonymous
                  : item.allowAnonymous,
                adminIds: Array.isArray(chat.adminIds)
                  ? chat.adminIds.filter((id: unknown): id is string => typeof id === 'string')
                  : item.adminIds,
              }
            : item,
        ),
      );
    });
    socket.on('chat:created', (chat) => {
      if (!(chat.participants ?? []).includes(currentUserId)) {
        return;
      }

      setChatItems((current) => {
        const mapped = mapChatFromServer(chat, currentUserId, users);
        if (current.some((item) => item.id === mapped.id)) {
          return current;
        }
        return [mapped, ...current];
      });
    });
    socket.on('catalog:itemCreated', (item) => {
      setCatalogItems((current) => {
        if (current.some((entry) => entry.id === item.id)) {
          return current;
        }
        return [mapCatalogItemFromServer(item, users, profile.name), ...current];
      });
    });
    socket.on('catalog:itemUpdated', (item) => {
      if (!item?.id) return;
      setCatalogItems((current) => {
        const mapped = mapCatalogItemFromServer(item, users);
        const exists = current.some((entry) => entry.id === item.id);
        if (!exists) {
          return [mapped, ...current];
        }
        return current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                ...mapped,
                seller: mapped.seller !== 'Seller' ? mapped.seller : entry.seller,
              }
            : entry,
        );
      });
    });
    socket.on('order:created', ({ order }: { order: CommerceOrder }) => {
      if (!order?.id) return;
      setCommerceOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)]);
      if (order.sellerUserId === currentUserIdRef.current) {
        showToast(`New order ${order.id}`);
      }
    });
    socket.on('order:updated', ({ order }: { order: CommerceOrder }) => {
      if (!order?.id) return;
      setCommerceOrders((current) => current.map((entry) => (entry.id === order.id ? order : entry)));
    });
    socket.on('receipt:created', ({ receipt }: { receipt: SaleReceipt }) => {
      if (!receipt?.id) return;
      setSaleReceipts((current) => [receipt, ...current.filter((entry) => entry.id !== receipt.id)]);
      setReceiptDetail((current) => (current?.id === receipt.id ? receipt : current));
    });
    socket.on('inventory:alert', (alert: InventoryAlert) => {
      if (!alert?.id) return;
      setInventoryAlerts((current) => [alert, ...current.filter((entry) => entry.id !== alert.id)]);
      showToast(alert.title ? `Low stock: ${alert.title}` : 'Inventory alert');
    });
    socket.on('customer:updated', ({ customer }: { customer: BusinessCustomer }) => {
      if (!customer?.id) return;
      if (customer.deletedAt) {
        setBusinessCustomers((current) => current.filter((entry) => entry.id !== customer.id));
        setSelectedCustomer((current) => (current?.id === customer.id ? null : current));
        return;
      }
      setBusinessCustomers((current) => [customer, ...current.filter((entry) => entry.id !== customer.id)]);
      setSelectedCustomer((current) => (current?.id === customer.id ? customer : current));
    });
    socket.on('businessAi:updated', ({ config }: { config: BusinessAiConfig }) => {
      if (config) setBusinessAiConfig(config);
    });
    socket.on('twin:updated', ({ config }: { config: AiTwinConfig }) => {
      if (config) setAiTwinConfig(config);
    });
    socket.on('twin:action', ({ action }: { action: AiTwinAction }) => {
      if (!action?.id) return;
      setAiTwinActions((current) => [action, ...current.filter((entry) => entry.id !== action.id)].slice(0, 100));
      if (action.status === 'blocked') {
        showToast(action.summary || 'Twin blocked a risky request', 4000);
      } else if (action.status === 'proposed') {
        showToast(`Twin proposed: ${action.summary}`, 3500);
      }
    });
    socket.on('autoReply:updated', ({ config }: { config: AutoReplyConfig }) => {
      if (config) setAutoReplyConfig(config);
    });
    socket.on('autoReply:sent', ({ log, message: autoMessage }: { log?: AutoReplyLog; message?: any }) => {
      if (log?.id) {
        setAutoReplyLogs((current) => [log, ...current.filter((entry) => entry.id !== log.id)].slice(0, 100));
      }
      if (autoMessage?.chatId && autoMessage?.id) {
        reconcileIncomingMessage(autoMessage.chatId, autoMessage);
      }
    });
    socket.on('document:updated', ({ document }: { document: CommerceDocument }) => {
      if (!document?.id) return;
      setCommerceDocuments((current) => {
        const exists = current.some((entry) => entry.id === document.id);
        if (!exists) return [document, ...current];
        return current.map((entry) => (entry.id === document.id ? document : entry));
      });
    });
    socket.on('broadcast:updated', ({ campaign }: { campaign: BroadcastCampaign }) => {
      if (!campaign?.id) return;
      setBroadcastCampaigns((current) => {
        const exists = current.some((entry) => entry.id === campaign.id);
        if (!exists) return [campaign, ...current];
        return current.map((entry) => (entry.id === campaign.id ? campaign : entry));
      });
    });
    socket.on('call:created', (call) => {
      if ((call.participantIds ?? []).includes(currentUserId)) {
        upsertCall(call);
      }
    });
    socket.on('call:incoming', (call) => {
      if ((call.participantIds ?? []).includes(currentUserIdRef.current)) {
        upsertCall(call, currentUserIdRef.current);
        if (call.initiatorId !== currentUserIdRef.current && call.state === 'ringing') {
          playWebCue('call');
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(call.caller?.name || 'ZynkUp', { body: call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call' });
          }
        }
      }
    });
    socket.on('call:hidden', ({ callId, userId }) => {
      if (callId && userId === currentUserIdRef.current) {
        setCalls((current) => current.filter((item) => item.id !== callId));
      }
    });
    socket.on('call:updated', (call) => {
      if ((call.participantIds ?? []).includes(currentUserId)) {
        upsertCall(call);
      }
    });
    socket.on('call:participantJoined', ({ callId, userId }) => {
      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.id !== callId || currentCall.initiatorId !== currentUserId) {
        return;
      }

      void (async () => {
        try {
          const connection = await ensurePeerConnection(currentCall);
          const offer = await connection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: currentCall.kind === 'video',
          });
          await connection.setLocalDescription(offer);
          emitCallSignal(callId, 'offer', offer, userId);
        } catch {
          setCallError('Unable to start the call media session.');
        }
      })();
    });
    socket.on('call:signal', ({ callId, fromUserId, signalType, payload }) => {
      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.id !== callId) {
        return;
      }

      if (signalType === 'camera') {
        setRemoteCameraOff(payload?.enabled === false);
        return;
      }
      if (signalType === 'video-upgrade') {
        const accept = window.confirm('Switch this call to video?');
        if (!accept) return;
        emitCallSignal(callId, 'video-upgrade-accept', { accepted: true }, fromUserId);
        void enableVideoOnCall().catch(() => setCallError('The camera did not start.'));
        return;
      }
      if (signalType === 'video-upgrade-accept') {
        void enableVideoOnCall().catch(() => setCallError('The camera did not start.'));
        return;
      }

      void (async () => {
        try {
          const connection = await ensurePeerConnection(currentCall);
          if (signalType === 'offer') {
            await connection.setRemoteDescription(new RTCSessionDescription(payload));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            emitCallSignal(callId, 'answer', answer, fromUserId);
            return;
          }

          if (signalType === 'answer') {
            await connection.setRemoteDescription(new RTCSessionDescription(payload));
            return;
          }

          if (signalType === 'ice-candidate' && payload) {
            await connection.addIceCandidate(new RTCIceCandidate(payload));
          }
        } catch {
          setCallError('Call signaling lost sync. Please retry the call.');
        }
      })();
    });
    socket.on('updates:refresh', (feed) => {
      setUpdatesFeed(feed);
    });
    socket.on('status:new', (status) => {
      upsertStatus(status);
    });
    socket.on('status:deleted', ({ statusId }) => {
      setStatuses((current) => current.filter((item) => item.id !== statusId));
      setUpdatesFeed((current) =>
        current
          .map((entry) => ({
            ...entry,
            items: entry.items.filter((item) => item.id !== statusId),
            latestAt:
              entry.items.filter((item) => item.id !== statusId)[0]?.createdAt ?? null,
          }))
          .filter((entry) => entry.items.length > 0),
      );
    });
    socket.on('message:receiptUpdated', (message) => {
      setMessagesByChat((current) => ({
        ...current,
        [message.chatId]: (current[message.chatId] ?? []).map((item) =>
          item.id === message.id
            ? {
                ...item,
                receiptState: message.state,
              }
            : item,
        ),
      }));
    });
    socket.on('status:updated', (status) => {
      upsertStatus(status);
    });

    const joinUser = () => {
      const userId = currentUserIdRef.current;
      if (!userId) return;
      const focused = document.visibilityState === 'visible';
      socket.emit('user:join', { userId, focused });
      socket.emit('user:focus', { focused });
      socket.emit('presence:update', { userId, presence: focused ? 'online' : 'offline' });
    };
    currentUserIdRef.current = currentUserId;
    socket.on('connect', joinUser);
    joinUser();
    const onVisibility = () => {
      socket.emit('user:focus', { focused: document.visibilityState === 'visible' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (currentUserId) {
      socket.emit('presence:update', { userId: currentUserId, presence: 'online' });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (currentUserId) {
        socket.emit('user:focus', { focused: false });
        socket.emit('presence:update', { userId: currentUserId, presence: 'offline' });
      }
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  useEffect(() => {
    try {
      const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      const storedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
      const storedMuted = localStorage.getItem(MUTED_CHATS_STORAGE_KEY);
      const storedArchived = localStorage.getItem(ARCHIVED_CHATS_STORAGE_KEY);
      if (storedSettings) {
        const next = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(storedSettings) };
        appSettingsRef.current = next;
        setAppSettings(next);
      }
      if (storedFavorites) {
        const parsed = JSON.parse(storedFavorites);
        if (Array.isArray(parsed)) {
          setFavoriteChatIds(parsed);
        }
      }
      if (storedMuted) {
        const parsed = JSON.parse(storedMuted);
        if (Array.isArray(parsed)) {
          mutedChatIdsRef.current = parsed;
          setMutedChatIds(parsed);
        }
      }
      if (storedArchived) {
        const parsed = JSON.parse(storedArchived);
        if (Array.isArray(parsed)) {
          setArchivedChatIds(parsed);
        }
      }
    } catch {
      // Keep defaults.
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || activeView !== 'chats' || !selectedChatId) {
      return undefined;
    }
    socket.emit('chat:join', selectedChatId);
    clearChatUnread(selectedChatId);
    return () => {
      socket.emit('chat:leave', selectedChatId);
      emitTyping(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, selectedChatId]);

  useEffect(() => {
    setAiSuggestionChips([]);
    setSummaryVisible(false);
    setChatSummary(null);
    setSummaryNotice('');
    setFocusedMessageId(null);
    setDictationNotice('');
    setAnonymousCompose(false);
    setAnonymousRemaining(null);
  }, [selectedChatId]);

  useEffect(() => {
    const allowed = Boolean(activeChat?.kind === 'group' && activeChat.allowAnonymous);
    if (!allowed) {
      setAnonymousCompose(false);
    }
  }, [activeChat?.id, activeChat?.kind, activeChat?.allowAnonymous]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      if (focusedMessageTimeoutRef.current) {
        window.clearTimeout(focusedMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (document.visibilityState !== 'visible' || activeView !== 'chats' || !appSettings.readReceiptsEnabled) {
      return;
    }

    (messagesByChat[selectedChatId] ?? [])
      .filter((message) => message.sender === 'other' && message.receiptState !== 'read')
      .forEach((message) => {
        void syncReceiptState(message.id, 'read');
      });
  }, [activeView, appSettings.readReceiptsEnabled, messagesByChat, selectedChatId]);

  useEffect(() => {
    if (!activeStatusId) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusId}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    }).catch(() => undefined);
  }, [activeStatusId, currentUserId]);

  useEffect(() => {
    if (!activeStatusId) {
      setStatusProgress(0);
      setStatusElapsedMs(0);
      return;
    }

    setStatusProgress(0);
    setStatusElapsedMs(0);
  }, [activeStatusId]);

  useEffect(() => {
    if (!activeStatusId || !activeStatusDuration || statusPlaybackPaused) {
      return;
    }

    const timer = window.setInterval(() => {
      setStatusElapsedMs((current) => {
        const nextValue = current + 80;
        if (nextValue >= activeStatusDuration) {
          window.clearInterval(timer);
          setStatusProgress(1);
          window.setTimeout(() => moveStatus('next'), 0);
          return activeStatusDuration;
        }

        return nextValue;
      });
    }, 80);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeStatusDuration, activeStatusId, moveStatus, statusPlaybackPaused]);

  useEffect(() => {
    if (!activeStatusDuration) {
      setStatusProgress(0);
      return;
    }

    setStatusProgress(Math.min(1, statusElapsedMs / activeStatusDuration));
  }, [activeStatusDuration, statusElapsedMs]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ongoing') {
      setActiveCallSeconds(0);
      return;
    }

    const baseSeconds = activeCall.durationSeconds ?? 0;
    setActiveCallSeconds(baseSeconds);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setActiveCallSeconds(baseSeconds + Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeCall]);

  useEffect(() => {
    attachStreamToVideo(localVideoRef.current, localCallStream);
  }, [localCallStream, callCameraOff, activeCall?.kind]);

  useEffect(() => {
    attachStreamToVideo(remoteVideoRef.current, remoteCallStream);
  }, [remoteCallStream, remoteCameraOff, activeCall?.kind]);

  useEffect(() => {
    if (!activeCall || !socketRef.current) {
      return;
    }

    setCallError(null);
    socketRef.current.emit('call:join', { callId: activeCall.id, userId: currentUserId });
    if (activeCall.state === 'ringing' || activeCall.state === 'ongoing') {
      void ensureCallMedia(activeCall.kind).catch(() => {
        setCallError('Camera or microphone permission was denied.');
      });
    }

    return () => {
      socketRef.current?.emit('call:leave', { callId: activeCall.id, userId: currentUserId });
      closePeerConnection();
    };
  }, [activeCall, currentUserId]);

  useEffect(() => {
    if (!incomingCall || incomingCall.state !== 'ringing' || incomingCall.initiatorId === currentUserId) {
      return undefined;
    }
    playWebCue('call');
    const timer = window.setInterval(() => playWebCue('call'), 1600);
    return () => window.clearInterval(timer);
  }, [incomingCall, currentUserId]);

  function upsertCall(incomingCallItem: any, overrideUserId?: string, overrideUsers?: AppUser[]) {
    const mapped = mapCallFromServer(incomingCallItem, overrideUserId ?? currentUserId, overrideUsers ?? users);
    setCalls((current) => {
      const existingIndex = current.findIndex((item) => item.id === mapped.id);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = mapped;
        return next;
      }
      return [mapped, ...current];
    });

    if (mapped.state === 'ringing' && mapped.initiatorId !== (overrideUserId ?? currentUserId)) {
      setIncomingCall(mapped);
    }
    if (mapped.state === 'ongoing' || mapped.state === 'ringing') {
      setActiveCall(mapped);
    }
    if (['completed', 'missed', 'declined'].includes(mapped.state)) {
      setActiveCall((current) => (current?.id === mapped.id ? null : current));
      setIncomingCall((current) => (current?.id === mapped.id ? null : current));
    }
  }

  const updateCallState = async (callId: string, state: CallState, durationSeconds?: number) => {
    const response = await fetch(`${API_BASE_URL}/api/calls/${callId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, durationSeconds }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (payload.call) {
      upsertCall(payload.call);
    }
  };

  const setCallAudioMuted = (muted: boolean) => {
    setCallMuted(muted);
    callMediaStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  };

  const setCallVideoEnabled = (enabled: boolean) => {
    setCallCameraOff(!enabled);
    callMediaStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
    const call = activeCallRef.current;
    if (call) emitCallSignal(call.id, 'camera', { enabled }, call.peerUserId);
  };

  const enableVideoOnCall = async () => {
    const connection = peerConnectionRef.current;
    const call = activeCallRef.current;
    if (!connection || !call) return;
    const stream = await ensureCallMedia('video');
    const videoTrack = stream.getVideoTracks().find((track) => track.readyState === 'live');
    if (!videoTrack) throw new Error('camera');
    videoTrack.enabled = true;
    const sender = connection.getSenders().find((item) => item.track?.kind === 'video');
    if (sender) {
      await sender.replaceTrack(videoTrack);
    } else {
      connection.addTrack(videoTrack, stream);
    }
    setCallCameraOff(false);
    setActiveCall((current) => (current ? { ...current, kind: 'video' } : current));
    emitCallSignal(call.id, 'camera', { enabled: true }, call.peerUserId);
    if (connection.signalingState === 'stable') {
      const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await connection.setLocalDescription(offer);
      emitCallSignal(call.id, 'offer', offer, call.peerUserId);
    }
  };

  const startCall = async (kind: 'audio' | 'video', peerUserId = activeChat?.peerUserId) => {
    if (!peerUserId || peerUserId === currentUserId) {
      return;
    }

    setCallSheetVisible(false);
    setCallMuted(false);
    setCallCameraOff(false);
    setRemoteCameraOff(false);
    try {
      await ensureCallMedia(kind);
      setCallError(null);
    } catch {
      setCallError(kind === 'video' ? 'Camera or microphone permission was denied.' : 'Microphone permission was denied.');
      return;
    }
    const response = await fetch(`${API_BASE_URL}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantIds: [currentUserId, peerUserId],
        initiatorId: currentUserId,
        kind,
        direction: 'outgoing',
      }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (payload.call) {
      upsertCall(payload.call);
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) {
      return;
    }

    try {
      await ensureCallMedia(incomingCall.kind);
      setCallError(null);
    } catch {
      setCallError('Camera or microphone permission was denied.');
      return;
    }
    await updateCallState(incomingCall.id, 'ongoing', incomingCall.durationSeconds);
    setIncomingCall(null);
  };

  const endActiveCall = async () => {
    if (!activeCall) {
      return;
    }

    const finalState: CallState = activeCall.state === 'ringing'
      ? (activeCall.initiatorId === currentUserId ? 'missed' : 'declined')
      : 'completed';
    await updateCallState(activeCall.id, finalState, activeCallSeconds);
    closePeerConnection();
  };

  const canComposeAnonymous = Boolean(
    activeChat?.kind === 'group' && activeChat.allowAnonymous,
  );

  const requestAnonymousCompose = (enabled: boolean) => {
    if (!enabled) {
      setAnonymousCompose(false);
      return;
    }
    if (!canComposeAnonymous) {
      return;
    }
    if (anonymousDisclosureAccepted) {
      setAnonymousCompose(true);
      return;
    }
    setAnonymousDisclosureOpen(true);
  };

  const sendMessage = () => {
    if (!messageDraft.trim() || !activeChat) {
      return;
    }

    const sendAnonymous = Boolean(anonymousCompose && canComposeAnonymous);
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      clientRef: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'me',
      senderId: currentUserId,
      kind: 'text',
      text: messageDraft.trim(),
      time: 'Now',
      receiptState: 'sent',
      replyToMessageId: replyTarget?.id,
      replyPreview: replyTarget?.text?.slice(0, 140),
      anonymous: sendAnonymous,
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimistic],
    }));
    emitTyping(false);
    const chatId = activeChat.id;
    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        senderId: currentUserId,
        clientRef: optimistic.clientRef,
        kind: 'text',
        text: messageDraft.trim(),
        mediaUrls: [],
        replyToMessageId: replyTarget?.id,
        replyPreview: replyTarget?.text?.slice(0, 140),
        anonymous: sendAnonymous,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast(payload.error || 'Could not send message');
          return;
        }
        if (typeof payload.anonymousRemaining === 'number') {
          setAnonymousRemaining(payload.anonymousRemaining);
          showToast(
            `${payload.anonymousRemaining} anonymous message${payload.anonymousRemaining === 1 ? '' : 's'} left today in this room`,
            2800,
          );
        }
        if (payload.message) {
          reconcileIncomingMessage(chatId, payload.message);
        }
      })
      .catch(() => undefined);
    setMessageDraft('');
    setReplyTarget(null);
  };

  const moneyLabel = (amount: number | null | undefined, currency = profile.currency || 'GHS') =>
    `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const addCatalogItem = async () => {
    if (!catalogForm.title.trim() || !catalogForm.price.trim()) {
      return;
    }

    const imageUrls = await uploadFiles(catalogAssetFiles).catch(() => []);
    const variantOptions = catalogForm.variantOptions
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const variants =
      catalogForm.variantName.trim() && variantOptions.length
        ? [{ id: `v${Date.now()}`, name: catalogForm.variantName.trim(), options: variantOptions }]
        : [];

    fetch(`${API_BASE_URL}/api/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerId: currentUserId,
        title: catalogForm.title.trim(),
        price: Number.parseFloat(catalogForm.price) || 0,
        currency: profile.currency || 'GHS',
        category: catalogForm.category,
        description: catalogForm.description.trim() || 'New product from this seller.',
        stockQuantity: Number.parseInt(catalogForm.stockQuantity, 10) || 0,
        trackStock: catalogForm.trackStock,
        costPrice: catalogForm.costPrice.trim() === '' ? null : Number.parseFloat(catalogForm.costPrice),
        lowStockThreshold: Number.parseInt(catalogForm.lowStockThreshold, 10) || 2,
        status: catalogForm.status,
        variants,
        isPublic: catalogForm.status === 'active',
        imageUrls: imageUrls.length
          ? imageUrls
          : ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80'],
      }),
    }).catch(() => undefined);

    setCatalogForm({
      title: '',
      price: '',
      category: 'Fashion',
      description: '',
      stockQuantity: '1',
      costPrice: '',
      lowStockThreshold: '2',
      trackStock: true,
      status: 'active',
      variantName: '',
      variantOptions: '',
    });
    setCatalogAssetFiles([]);
    showToast(catalogForm.status === 'draft' ? 'Product saved as draft' : 'Catalog item published');
  };

  const applyCatalogItemUpdate = (item: any) => {
    if (!item?.id) return;
    setCatalogItems((current) => {
      const mapped = mapCatalogItemFromServer(item, users);
      const exists = current.some((entry) => entry.id === item.id);
      if (!exists) return [mapped, ...current];
      return current.map((entry) =>
        entry.id === item.id
          ? { ...entry, ...mapped, seller: mapped.seller !== 'Seller' ? mapped.seller : entry.seller }
          : entry,
      );
    });
  };

  const adjustCatalogStock = async (item: CatalogItem, delta: number) => {
    if (!currentUserId || !delta) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}/stock-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          delta,
          reason: delta > 0 ? 'restock' : 'manual_adjust',
          lowStockThreshold: item.lowStockThreshold,
        }),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (payload.item) {
          applyCatalogItemUpdate(payload.item);
          return;
        }
      }
      const nextStock = Math.max(0, (item.stockQuantity ?? 0) + delta);
      const patchResponse = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockQuantity: nextStock }),
      });
      if (!patchResponse.ok) {
        showToast('Could not update stock');
        return;
      }
      const payload = await patchResponse.json();
      applyCatalogItemUpdate(payload.item);
    } catch {
      showToast('Network error while updating stock');
    }
  };

  const setCatalogItemStatus = async (item: CatalogItem, status: CatalogProductStatus) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        showToast('Could not update product status');
        return;
      }
      const payload = await response.json();
      applyCatalogItemUpdate(payload.item);
      showToast(status === 'archived' ? 'Product archived' : `Product set to ${status}`);
    } catch {
      showToast('Could not update product status');
    }
  };

  const loadSalesDashboard = async (period: 'today' | '7d' | '30d' = salesDashboardPeriod) => {
    if (!currentUserId) return;
    try {
      const query = new URLSearchParams({ userId: currentUserId, period });
      const response = await fetch(`${API_BASE_URL}/api/sales/dashboard?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load sales dashboard');
        return;
      }
      setSalesDashboard(payload);
      setSalesDashboardPeriod((payload.period as 'today' | '7d' | '30d') || period);
    } catch {
      showToast('Could not load sales dashboard');
    }
  };

  const loadCommerceOrders = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders?userId=${encodeURIComponent(currentUserId)}&role=seller`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load orders');
        return;
      }
      setCommerceOrders(payload.orders ?? []);
    } catch {
      showToast('Could not load orders');
    }
  };

  const updateOrderState = async (orderId: string, state: OrderState) => {
    if (!currentUserId) return;
    let deliveryReference: string | undefined;
    let fulfilmentNote: string | undefined;
    if (state === 'dispatched') {
      const referenceInput = window.prompt('Delivery reference (tracking / courier ref)');
      if (referenceInput === null) return;
      const trimmedRef = referenceInput.trim();
      if (!trimmedRef) {
        showToast('Delivery reference is required when marking dispatched');
        return;
      }
      deliveryReference = trimmedRef;
      const noteInput = window.prompt('Fulfilment note (optional)');
      if (noteInput !== null && noteInput.trim()) {
        fulfilmentNote = noteInput.trim();
      }
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          state,
          ...(deliveryReference ? { deliveryReference } : {}),
          ...(fulfilmentNote !== undefined ? { fulfilmentNote } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update order');
        return;
      }
      if (payload.order) {
        setCommerceOrders((current) =>
          current.map((entry) => (entry.id === payload.order.id ? payload.order : entry)),
        );
      }
      if (payload.receipt) {
        setSaleReceipts((current) => [payload.receipt, ...current.filter((entry) => entry.id !== payload.receipt.id)]);
      }
      showToast(`Order marked ${state.replace(/_/g, ' ')}`);
    } catch {
      showToast('Could not update order');
    }
  };

  const runAssistantTask = async (
    task: AiAssistantTask,
    options: { text?: string; prompt?: string; messageId?: string } = {},
  ) => {
    if (!currentUserId || aiBusy) return;
    const needsChatContext =
      task === 'summarise' || task === 'suggest_reply' || Boolean(options.messageId);
    if (needsChatContext && !activeChat) {
      showToast('Open a chat to use this assistant task');
      return;
    }
    if (needsChatContext && !aiConsentToShareContext) {
      setAiHelperVisible(true);
      showToast('Confirm consent to share chat context with the assistant');
      return;
    }

    const text =
      (options.text || '').trim() ||
      (task === 'rewrite' || task === 'translate' || task === 'explain'
        ? messageDraft.trim()
        : '');
    const prompt = (options.prompt || aiHelperPrompt).trim();

    if (task === 'draft' && !prompt && !text) {
      showToast('Describe what to draft');
      return;
    }
    if ((task === 'rewrite' || task === 'translate' || task === 'explain') && !text) {
      showToast(task === 'rewrite' ? 'Add text to rewrite' : task === 'translate' ? 'Add text to translate' : 'Add text to explain');
      return;
    }

    setAiBusy(true);
    setAiHelperNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          task,
          tone: aiTone,
          targetLanguage: translateTargetLanguage,
          prompt: prompt || undefined,
          text: text || undefined,
          chatId: needsChatContext && activeChat ? activeChat.id : undefined,
          messageId: options.messageId,
          consentToShareContext: needsChatContext ? aiConsentToShareContext : false,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.requiresConsent) {
          setAiHelperVisible(true);
        }
        showToast(payload.error || 'Assistant request failed');
        return;
      }

      const notice =
        typeof payload.notice === 'string'
          ? payload.notice
          : 'Draft only — review before sending. The assistant never sends for you.';
      setAiHelperNotice(notice);

      if (task === 'suggest_reply') {
        const suggestions = (payload.suggestions ?? []) as AiSuggestionChip[];
        setAiSuggestionChips(suggestions);
        if (!suggestions.length) showToast('No suggestions available');
        else showToast(notice, 3500);
        return;
      }

      if (task === 'summarise') {
        const summary = (payload.summary ?? null) as ChatSummary | null;
        setChatSummary(summary);
        setSummaryNotice(summary?.notice || notice);
        setSummaryVisible(true);
        setSummaryScope('recent');
        if (notice) showToast(notice, 4000);
        return;
      }

      const resultText =
        typeof payload.result === 'string'
          ? payload.result
          : typeof payload.translatedText === 'string'
            ? payload.translatedText
            : '';

      if (task === 'explain') {
        setAiHelperResult(resultText);
        setAiHelperVisible(true);
        if (notice) showToast(notice, 4000);
        return;
      }

      // draft / rewrite / translate — fill composer draft only, never auto-send
      if (resultText) {
        setMessageDraft(resultText);
        setAiHelperResult(resultText);
        setAiSuggestionChips([]);
        showToast(notice, 3500);
      } else {
        showToast('No draft returned');
      }
    } catch {
      showToast('Assistant request failed');
    } finally {
      setAiBusy(false);
    }
  };

  const requestSuggestedReplies = async () => {
    await runAssistantTask('suggest_reply');
  };

  const requestRewrite = async () => {
    await runAssistantTask('rewrite', { text: messageDraft });
  };

  const loadBusinessAiConfig = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/ai/business?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load business AI');
        return;
      }
      setBusinessAiConfig(payload.config || null);
    } catch {
      showToast('Could not load business AI');
    }
  };

  const saveBusinessAiConfig = async (
    patch: Partial<{
      enabled: boolean;
      policyText: string;
      deliveryPolicy: string;
      refundPolicy: string;
      faq: Array<{ question: string; answer: string }>;
    }> = {},
  ) => {
    if (!currentUserId) return;
    const base = businessAiConfig;
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/business`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          businessId: base?.businessId ?? null,
          enabled: base?.enabled,
          policyText: base?.policyText,
          deliveryPolicy: base?.deliveryPolicy,
          refundPolicy: base?.refundPolicy,
          faq: base?.faq || [],
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save business AI');
        return;
      }
      setBusinessAiConfig(payload.config || null);
      if (typeof patch.enabled === 'boolean') {
        showToast(patch.enabled ? 'Business AI enabled' : 'Business AI paused');
      } else {
        showToast('Business AI saved');
      }
    } catch {
      showToast('Could not save business AI');
    }
  };

  const askBusinessAi = async () => {
    const question = businessAiTestQuestion.trim();
    if (!currentUserId || !question || businessAiBusy) return;
    setBusinessAiBusy(true);
    setBusinessAiAskResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/business/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          sellerUserId: currentUserId,
          businessId: businessAiConfig?.businessId ?? null,
          question,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not ask business AI');
        return;
      }
      setBusinessAiAskResult({
        answer: typeof payload.answer === 'string' ? payload.answer : '',
        confidence: typeof payload.confidence === 'string' ? payload.confidence : undefined,
        source: typeof payload.source === 'string' ? payload.source : undefined,
        escalate: Boolean(payload.escalate),
        disclosure:
          typeof payload.disclosure === 'string'
            ? payload.disclosure
            : 'Automated business assistant. Answers use approved catalogue/policy data only.',
        notice: typeof payload.notice === 'string' ? payload.notice : undefined,
        autoSend: false,
      });
    } catch {
      showToast('Could not ask business AI');
    } finally {
      setBusinessAiBusy(false);
    }
  };

  const upsertTwinAction = (action: AiTwinAction) => {
    if (!action?.id) return;
    setAiTwinActions((current) => [action, ...current.filter((entry) => entry.id !== action.id)].slice(0, 100));
  };

  const fillComposerFromTwinDraft = (draftText?: string, notice?: string) => {
    const text = (draftText || '').trim();
    if (!text) {
      showToast(notice || 'No draft to fill');
      return;
    }
    setMessageDraft(text);
    showToast(notice || 'Filled draft — Twin never auto-sends. Review before sending.', 4000);
  };

  const loadAiTwin = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/ai/twin?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load AI Twin');
        return;
      }
      setAiTwinConfig(payload.config || null);
      setAiTwinCapabilities(payload.capabilities || null);
    } catch {
      showToast('Could not load AI Twin');
    }
  };

  const loadAiTwinActions = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/ai/twin/actions?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load Twin actions');
        return;
      }
      setAiTwinActions(Array.isArray(payload.actions) ? payload.actions : []);
    } catch {
      showToast('Could not load Twin actions');
    }
  };

  const saveAiTwinConfig = async (
    patch: Partial<{
      enabled: boolean;
      displayName: string;
      permissionTier: TwinPermissionTier;
      allowedTasks: TwinAllowedTask[];
      dataSources: TwinDataSource[];
      operatingHoursText: string;
      dailyActionLimit: number;
    }> = {},
  ) => {
    if (!currentUserId) return;
    const base = aiTwinConfig;
    setAiTwinBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/twin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          businessId: base?.businessId ?? null,
          enabled: base?.enabled,
          displayName: base?.displayName,
          permissionTier: base?.permissionTier,
          allowedTasks: base?.allowedTasks,
          dataSources: base?.dataSources,
          operatingHoursText: base?.operatingHoursText,
          dailyActionLimit: base?.dailyActionLimit,
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save AI Twin');
        return;
      }
      setAiTwinConfig(payload.config || null);
      if (typeof patch.enabled === 'boolean') {
        showToast(patch.enabled ? 'AI Twin enabled' : 'AI Twin paused');
      } else {
        showToast('AI Twin settings saved');
      }
    } catch {
      showToast('Could not save AI Twin');
    } finally {
      setAiTwinBusy(false);
    }
  };

  const runAiTwin = async (options: { prompt?: string; messageId?: string } = {}) => {
    if (!currentUserId || aiTwinBusy) return;
    if (!activeChat) {
      showToast('Open a chat to run the Twin');
      return;
    }
    if (aiTwinConfig && !aiTwinConfig.enabled) {
      showToast('AI Twin is paused. Enable it in Business tools → AI Twin.');
      return;
    }
    setAiTwinBusy(true);
    setAiTwinNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/twin/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          event: 'manual',
          chatId: activeChat.id,
          messageId: options.messageId,
          prompt: options.prompt || messageDraft.trim() || undefined,
          businessId: aiTwinConfig?.businessId ?? null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.action) upsertTwinAction(payload.action as AiTwinAction);
        showToast(payload.error || 'Twin run failed');
        return;
      }
      const actions = (Array.isArray(payload.actions) ? payload.actions : []) as AiTwinAction[];
      actions.forEach(upsertTwinAction);
      const notice =
        typeof payload.notice === 'string'
          ? payload.notice
          : 'Draft-only by default. Twin cannot send money, approve refunds, or invent prices.';
      const disclosure =
        typeof payload.disclosure === 'string'
          ? payload.disclosure
          : 'AI Twin drafts are labelled as automated and are not the owner speaking secretly.';
      setAiTwinNotice(`${disclosure} ${notice}`);
      showToast(notice, 4000);
      // Never auto-send — only surface drafts for review / inbox approval
      const draftCandidate = actions.find((entry) => entry.draftText && entry.status === 'proposed');
      if (draftCandidate?.draftText && !draftCandidate.requiresApproval) {
        fillComposerFromTwinDraft(draftCandidate.draftText, notice);
      }
    } catch {
      showToast('Twin run failed');
    } finally {
      setAiTwinBusy(false);
    }
  };

  const decideTwinAction = async (actionId: string, decision: 'approve' | 'reject') => {
    if (!currentUserId || !actionId) return;
    setAiTwinBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/ai/twin/actions/${encodeURIComponent(actionId)}/${decision}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || `Could not ${decision} Twin action`);
        return;
      }
      const updated = payload.action as AiTwinAction | undefined;
      if (updated) upsertTwinAction(updated);
      if (decision === 'approve') {
        const notice =
          typeof payload.notice === 'string'
            ? payload.notice
            : 'Approved draft only. The Twin still does not send the message for you.';
        fillComposerFromTwinDraft(updated?.draftText, notice);
      } else {
        showToast('Twin action rejected');
      }
    } catch {
      showToast(`Could not ${decision} Twin action`);
    } finally {
      setAiTwinBusy(false);
    }
  };

  const mergeMessageTranscript = (chatId: string, serverMessage: any, notice?: string) => {
    if (!chatId || !serverMessage?.id) return;
    reconcileIncomingMessage(chatId, serverMessage);
    if (notice) {
      setMessagesByChat((current) => ({
        ...current,
        [chatId]: (current[chatId] ?? []).map((item) =>
          item.id === serverMessage.id ? { ...item, transcriptNotice: notice } : item,
        ),
      }));
    }
  };

  const requestTranscribe = async (message: Message) => {
    if (!currentUserId || !activeChat || message.kind !== 'voice' || message.deletedForEveryone) return;
    if (transcribingMessageId === message.id) return;
    setTranscribingMessageId(message.id);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}/transcribe`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (payload.message) {
        mergeMessageTranscript(
          activeChat.id,
          payload.message,
          typeof payload.notice === 'string' ? payload.notice : undefined,
        );
      }
      if (!response.ok && response.status !== 503) {
        showToast(payload.error || 'Could not transcribe voice note');
        return;
      }
      if (payload.notice) {
        showToast(payload.notice, 4000);
      } else if (payload.needsProvider) {
        showToast('Speech transcription provider is not configured yet.', 4000);
      } else if (payload.transcript) {
        showToast('Transcript ready', 2200);
      }
    } catch {
      showToast('Could not transcribe voice note');
    } finally {
      setTranscribingMessageId(null);
    }
  };

  const requestTranslate = async (message: Message, targetLanguage: TranslateLanguage = translateTargetLanguage) => {
    const text = (message.text || '').trim();
    if (!currentUserId || !activeChat || !text || message.deletedForEveryone) return;
    if (translatingMessageId === message.id) return;
    setTranslatingMessageId(message.id);
    setTranslatePickerMessageId(message.id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          targetLanguage,
          messageId: message.id,
          chatId: activeChat.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not translate');
        return;
      }
      const translatedText =
        typeof payload.translatedText === 'string' ? payload.translatedText : text;
      const notice =
        typeof payload.notice === 'string'
          ? payload.notice
          : payload.needsProvider
            ? 'Full translation needs a provider. Common phrases can still use the built-in glossary.'
            : payload.partial
              ? 'Partial glossary translation. Review before relying on it.'
              : undefined;
      setTranslationsByMessageId((current) => ({
        ...current,
        [message.id]: {
          translatedText,
          targetLanguage,
          partial: Boolean(payload.partial),
          needsProvider: Boolean(payload.needsProvider),
          notice,
          method: typeof payload.method === 'string' ? payload.method : undefined,
        },
      }));
      if (notice) {
        showToast(notice, 4000);
      }
    } catch {
      showToast('Could not translate');
    } finally {
      setTranslatingMessageId(null);
    }
  };

  const focusSummaryMessage = (messageId: string) => {
    if (!messageId) return;
    const node = document.getElementById(`message-${messageId}`);
    if (!node) {
      showToast('Message is not loaded in this view');
      return;
    }
    setFocusedMessageId(messageId);
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (focusedMessageTimeoutRef.current) {
      window.clearTimeout(focusedMessageTimeoutRef.current);
    }
    focusedMessageTimeoutRef.current = window.setTimeout(() => setFocusedMessageId(null), 2400);
  };

  const requestChatSummary = async (scope: SummarizeScope = summaryScope) => {
    if (!currentUserId || !activeChat || summaryBusy) return;
    setSummaryScope(scope);
    setSummaryVisible(true);
    setSummaryBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          chatId: activeChat.id,
          scope,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not summarise chat');
        return;
      }
      const summary = (payload.summary ?? null) as ChatSummary | null;
      setChatSummary(summary);
      const notice = summary?.notice || payload.notice || '';
      setSummaryNotice(notice);
      if (notice) {
        showToast(notice, 4000);
      }
    } catch {
      showToast('Could not summarise chat');
    } finally {
      setSummaryBusy(false);
    }
  };

  const composeDictationDraft = (base: string, finalText: string, interimText = '') => {
    const parts = [base.trim(), finalText.trim(), interimText.trim()].filter(Boolean);
    return parts.join(parts.length > 1 ? ' ' : '');
  };

  const finishDictation = async (rawText: string) => {
    const text = rawText.trim();
    if (!text) {
      setDictationNotice('Review before send');
      showToast('No speech captured — review before send');
      return;
    }
    if (!currentUserId) {
      setMessageDraft(text);
      setDictationNotice('Review before send');
      showToast('Review before send', 3500);
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/dictate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.text === 'string' && payload.text.trim()) {
        setMessageDraft(payload.text.trim());
        setDictationNotice(payload.notice || 'Review before send');
        showToast(payload.notice || 'Review before send', 4000);
        return;
      }
    } catch {
      // fall through to local draft
    }
    setMessageDraft(text);
    setDictationNotice('Review before send');
    showToast('Review before send', 3500);
  };

  const stopDictation = () => {
    dictateStoppingRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    }
    setIsDictating(false);
  };

  const startDictation = () => {
    if (!speechRecognitionSupported) {
      showToast('Speech recognition unavailable in this browser');
      return;
    }
    if (isDictating) {
      stopDictation();
      return;
    }

    const host = window as Window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const RecognitionCtor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      showToast('Speech recognition unavailable in this browser');
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    dictateBaseDraftRef.current = messageDraft;
    dictateFinalRef.current = '';
    dictateStoppingRef.current = false;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let interim = '';
      let finalChunk = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || '';
        if (result.isFinal) {
          finalChunk += `${transcript} `;
        } else {
          interim += transcript;
        }
      }
      if (finalChunk.trim()) {
        dictateFinalRef.current = [dictateFinalRef.current, finalChunk.trim()].filter(Boolean).join(' ');
      }
      setMessageDraft(
        composeDictationDraft(dictateBaseDraftRef.current, dictateFinalRef.current, interim),
      );
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') {
        return;
      }
      showToast(event.error ? `Dictation error: ${event.error}` : 'Dictation failed');
      setIsDictating(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setIsDictating(false);
      const composed = composeDictationDraft(dictateBaseDraftRef.current, dictateFinalRef.current);
      if (dictateStoppingRef.current || composed.trim()) {
        void finishDictation(composed);
      }
      dictateStoppingRef.current = false;
    };

    try {
      recognition.start();
      setIsDictating(true);
      setDictationNotice('Listening… Review before send');
    } catch {
      showToast('Could not start dictation');
      recognitionRef.current = null;
      setIsDictating(false);
    }
  };

  const toggleDictation = () => {
    if (isDictating) {
      stopDictation();
      return;
    }
    startDictation();
  };

  const loadSaleReceipts = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/receipts?userId=${encodeURIComponent(currentUserId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load receipts');
        return;
      }
      setSaleReceipts(payload.receipts ?? []);
    } catch {
      showToast('Could not load receipts');
    }
  };

  const openReceiptDetail = async (receiptId: string) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/receipts/${encodeURIComponent(receiptId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const local = saleReceipts.find((entry) => entry.id === receiptId) ?? null;
        setReceiptDetail(local);
        return;
      }
      setReceiptDetail(payload.receipt ?? null);
    } catch {
      setReceiptDetail(saleReceipts.find((entry) => entry.id === receiptId) ?? null);
    }
  };

  const loadInventoryAlerts = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/inventory/alerts?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInventoryAlerts([]);
        return;
      }
      setInventoryAlerts(payload.alerts ?? []);
    } catch {
      setInventoryAlerts([]);
    }
  };

  const reviewInventoryAlert = async (alertId: string) => {
    if (!currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/inventory/alerts/${encodeURIComponent(alertId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      if (!response.ok) {
        showToast('Could not mark alert reviewed');
        return;
      }
      setInventoryAlerts((current) =>
        current.map((entry) =>
          entry.id === alertId ? { ...entry, reviewedAt: new Date().toISOString() } : entry,
        ),
      );
      showToast('Alert marked reviewed');
    } catch {
      showToast('Could not mark alert reviewed');
    }
  };

  const loadBusinessCustomers = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load customers');
        return;
      }
      setBusinessCustomers(payload.customers ?? []);
    } catch {
      showToast('Could not load customers');
    }
  };

  const loadAutoReplyConfig = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auto-replies?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setAutoReplyConfig(payload.config || null);
    } catch {
      // ignore
    }
  };

  const loadAutoReplyLogs = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/auto-replies/logs?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setAutoReplyLogs(payload.logs || []);
    } catch {
      // ignore
    }
  };

  const saveAutoReplyConfig = async (
    patch: Partial<{
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
    }> = {},
  ) => {
    if (!currentUserId) return;
    const base = autoReplyConfig;
    try {
      const response = await fetch(`${API_BASE_URL}/api/auto-replies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          enabled: base?.enabled,
          greetingEnabled: base?.greetingEnabled,
          greetingText: base?.greetingText,
          awayEnabled: base?.awayEnabled,
          awayText: base?.awayText,
          hoursText: base?.hoursText,
          humanHandoverKeywords: base?.humanHandoverKeywords,
          rules: base?.rules || [],
          cooldownSeconds: base?.cooldownSeconds,
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save auto-replies');
        return;
      }
      setAutoReplyConfig(payload.config || null);
      showToast('Auto-replies saved');
    } catch {
      showToast('Could not save auto-replies');
    }
  };

  const upsertCommerceDocument = (document: CommerceDocument) => {
    setCommerceDocuments((current) => {
      const exists = current.some((entry) => entry.id === document.id);
      if (!exists) return [document, ...current];
      return current.map((entry) => (entry.id === document.id ? document : entry));
    });
  };

  const loadCommerceDocuments = async (kind: '' | CommerceDocKind = documentKindFilter) => {
    if (!currentUserId) return;
    try {
      const query = new URLSearchParams({ userId: currentUserId });
      if (kind) query.set('kind', kind);
      const response = await fetch(`${API_BASE_URL}/api/documents?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load documents');
        return;
      }
      setCommerceDocuments(payload.documents ?? []);
    } catch {
      showToast('Could not load documents');
    }
  };

  const createCommerceDocument = async () => {
    if (!currentUserId) return;
    const primaryLine = {
      title: documentForm.lineTitle.trim(),
      quantity: Number(documentForm.lineQuantity) || 0,
      unitPrice: Number(documentForm.lineUnitPrice) || 0,
    };
    const extraLines = documentExtraLines
      .map((line) => ({
        title: line.title.trim(),
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
      }))
      .filter((line) => line.title && line.quantity > 0);
    const lines = [primaryLine, ...extraLines].filter((line) => line.title && line.quantity > 0);
    if (!documentForm.customerName.trim() || !lines.length) {
      showToast('Add a customer name and at least one line item');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          kind: documentForm.kind,
          customerName: documentForm.customerName.trim(),
          customerUserId: documentForm.customerUserId || undefined,
          chatId: documentForm.chatId || undefined,
          lines,
          discountAmount: documentForm.discountAmount ? Number(documentForm.discountAmount) : undefined,
          taxAmount: documentForm.taxAmount ? Number(documentForm.taxAmount) : undefined,
          notes: documentForm.notes.trim() || undefined,
          paymentTerms: documentForm.paymentTerms.trim() || undefined,
          expiresAt: documentForm.kind === 'quotation' && documentForm.expiresAt
            ? documentForm.expiresAt
            : undefined,
          dueAt: documentForm.kind === 'invoice' && documentForm.dueAt ? documentForm.dueAt : undefined,
          sendNow: documentForm.sendNow,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not create document');
        return;
      }
      if (payload.document) upsertCommerceDocument(payload.document);
      setDocumentForm({
        kind: documentForm.kind,
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
      setDocumentExtraLines([]);
      showToast(documentForm.sendNow ? 'Document sent' : 'Document saved as draft');
    } catch {
      showToast('Could not create document');
    }
  };

  const runDocumentAction = async (
    documentId: string,
    action: 'send' | 'accept' | 'reject' | 'convert' | 'mark-paid',
    extra: Record<string, unknown> = {},
  ) => {
    if (!currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, ...extra }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || `Could not ${action} document`);
        return;
      }
      if (payload.document) upsertCommerceDocument(payload.document);
      if (payload.quotation) upsertCommerceDocument(payload.quotation);
      if (payload.invoice) upsertCommerceDocument(payload.invoice);
      if (payload.message?.chatId && payload.message?.id) {
        reconcileIncomingMessage(payload.message.chatId, payload.message);
      }
      const actionToasts: Record<typeof action, string> = {
        send: 'Document sent',
        accept: 'Document accepted',
        reject: 'Document rejected',
        convert: 'Converted to invoice',
        'mark-paid': 'Marked paid',
      };
      showToast(actionToasts[action]);
    } catch {
      showToast(`Could not ${action} document`);
    }
  };

  const loadBroadcasts = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/broadcasts?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load broadcasts');
        return;
      }
      setBroadcastCampaigns(payload.campaigns ?? []);
      setBroadcastAudience({
        opted_in: Number(payload.audiencePreview?.opted_in) || 0,
        repeat_buyers: Number(payload.audiencePreview?.repeat_buyers) || 0,
        all_customers: Number(payload.audiencePreview?.all_customers) || 0,
      });
    } catch {
      showToast('Could not load broadcasts');
    }
  };

  const createBroadcast = async () => {
    if (!currentUserId) return;
    const text = broadcastForm.text.trim();
    if (!text) {
      showToast('Write a broadcast message');
      return;
    }
    if (broadcastForm.segment === 'tag' && !broadcastForm.tag.trim()) {
      showToast('Choose a tag for this segment');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          segment: broadcastForm.segment,
          tag: broadcastForm.segment === 'tag' ? broadcastForm.tag.trim() : undefined,
          sendNow: broadcastForm.sendNow,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not send broadcast');
        return;
      }
      if (payload.campaign) {
        setBroadcastCampaigns((current) => [
          payload.campaign,
          ...current.filter((entry) => entry.id !== payload.campaign.id),
        ]);
      }
      setBroadcastForm((current) => ({ ...current, text: '', tag: current.segment === 'tag' ? current.tag : '' }));
      void loadBroadcasts();
      showToast(broadcastForm.sendNow ? 'Broadcast sent' : 'Broadcast saved');
    } catch {
      showToast('Could not send broadcast');
    }
  };

  const cancelBroadcast = async (campaignId: string) => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/broadcasts/${encodeURIComponent(campaignId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not cancel broadcast');
        return;
      }
      if (payload.campaign) {
        setBroadcastCampaigns((current) =>
          current.map((entry) => (entry.id === payload.campaign.id ? payload.campaign : entry)),
        );
      }
      showToast('Broadcast cancelled');
    } catch {
      showToast('Could not cancel broadcast');
    }
  };

  const addAutoReplyRule = async () => {
    const keywords = autoReplyRuleDraft.keywords
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const response = autoReplyRuleDraft.response.trim();
    if (!keywords.length || !response) {
      showToast('Add keywords and a response');
      return;
    }
    const rules: AutoReplyRule[] = [
      ...(autoReplyConfig?.rules || []),
      { id: `rule-${Date.now()}`, keywords, response, enabled: true },
    ];
    setAutoReplyRuleDraft({ keywords: '', response: '' });
    await saveAutoReplyConfig({ rules });
  };

  const removeAutoReplyRule = async (ruleId: string) => {
    const rules = (autoReplyConfig?.rules || []).filter((rule) => rule.id !== ruleId);
    await saveAutoReplyConfig({ rules });
  };

  const loadCustomerDetail = async (customerId: string) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not open customer');
        return;
      }
      setSelectedCustomer(payload.customer ?? null);
      setCustomerOrders(payload.orders ?? []);
      setCustomerNoteDraft('');
    } catch {
      showToast('Could not open customer');
    }
  };

  const createBusinessCustomer = async () => {
    if (!currentUserId) return;
    const displayName = customerForm.displayName.trim();
    if (!displayName) {
      showToast('Add a customer name');
      return;
    }
    const tags = customerForm.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
    const followUpRaw = customerForm.followUpAt.trim();
    const followUpAt = followUpRaw
      ? new Date(followUpRaw).toISOString()
      : undefined;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          displayName,
          phone: customerForm.phone.trim() || undefined,
          tags: tags.length ? tags : undefined,
          note: customerForm.note.trim() || undefined,
          followUpAt,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save customer');
        return;
      }
      if (payload.customer) {
        setBusinessCustomers((current) => [
          payload.customer,
          ...current.filter((entry) => entry.id !== payload.customer.id),
        ]);
      }
      setCustomerForm({ displayName: '', phone: '', tags: '', note: '', followUpAt: '' });
      showToast(payload.existing ? 'Customer record updated' : 'Customer saved');
    } catch {
      showToast('Could not save customer');
    }
  };

  const updateBusinessCustomer = async (
    customerId: string,
    patch: {
      displayName?: string;
      tags?: string[];
      followUpAt?: string | null;
      followUpNote?: string;
      marketingConsent?: 'unknown' | 'opted_out';
    },
  ) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, ...patch }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update customer');
        return;
      }
      if (payload.customer) {
        setSelectedCustomer(payload.customer);
        setBusinessCustomers((current) => [
          payload.customer,
          ...current.filter((entry) => entry.id !== payload.customer.id),
        ]);
      }
      showToast('Customer updated');
    } catch {
      showToast('Could not update customer');
    }
  };

  const addCustomerNote = async (customerId: string) => {
    const text = customerNoteDraft.trim();
    if (!currentUserId || !customerId || !text) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}/notes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, text }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not add note');
        return;
      }
      if (payload.customer) {
        setSelectedCustomer(payload.customer);
        setBusinessCustomers((current) => [
          payload.customer,
          ...current.filter((entry) => entry.id !== payload.customer.id),
        ]);
      }
      setCustomerNoteDraft('');
      showToast('Note added');
    } catch {
      showToast('Could not add note');
    }
  };

  const deleteBusinessCustomer = async (customerId: string) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}?userId=${encodeURIComponent(currentUserId)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not delete customer');
        return;
      }
      setBusinessCustomers((current) => current.filter((entry) => entry.id !== customerId));
      setSelectedCustomer(null);
      setCustomerOrders([]);
      showToast('Customer record removed');
    } catch {
      showToast('Could not delete customer');
    }
  };

  const loadCustomerPreferences = async () => {
    if (!currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/me/customer-preferences?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setCustomerPrefs(payload.preferences ?? []);
    } catch {
      // ignore
    }
  };

  const updateMyMarketingPreference = async (
    customerId: string,
    marketingConsent: 'opted_in' | 'opted_out',
  ) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/me/customer-preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, customerId, marketingConsent }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update preference');
        return;
      }
      setCustomerPrefs((current) =>
        current.map((entry) =>
          entry.customerId === customerId
            ? {
                ...entry,
                marketingConsent: payload.preference?.marketingConsent || marketingConsent,
                marketingConsentUpdatedAt:
                  payload.preference?.marketingConsentUpdatedAt || entry.marketingConsentUpdatedAt,
              }
            : entry,
        ),
      );
      showToast(marketingConsent === 'opted_in' ? 'Opted in to marketing' : 'Opted out of marketing');
    } catch {
      showToast('Could not update preference');
    }
  };

  const shareSalesReport = async () => {
    if (!salesDashboard) return;
    const lines = [
      `ZynkUp sales report (${salesDashboard.period})`,
      `Currency ${salesDashboard.currency}`,
      `Pending orders ${salesDashboard.metrics?.pendingOrders ?? 0}`,
      `Confirmed sales ${salesDashboard.metrics?.confirmedSalesCount ?? 0}`,
      salesDashboard.canSeeFinance
        ? `Gross sales ${salesDashboard.metrics?.grossSales} · Net sales ${salesDashboard.metrics?.netSales} · Cash received ${salesDashboard.metrics?.cashReceived}`
        : null,
      `Low stock ${salesDashboard.metrics?.lowStockCount ?? 0}`,
    ].filter(Boolean) as string[];
    const text = lines.join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('Report copied');
        return;
      }
    } catch {
      // fall through
    }
    showToast(text, 4000);
  };

  const sellerOrderActions = (order: CommerceOrder): Array<[OrderState, string]> => {
    if (order.sellerUserId !== currentUserId) return [];
    switch (order.state) {
      case 'pending_payment':
        return [
          ['paid', 'Mark paid'],
          ['cancelled', 'Cancel'],
        ];
      case 'paid':
        return [
          ['processing', 'Processing'],
          ['cancelled', 'Cancel'],
        ];
      case 'processing':
        return [
          ['dispatched', 'Dispatched'],
          ['cancelled', 'Cancel'],
        ];
      case 'dispatched':
        return [['completed', 'Completed']];
      default:
        return [];
    }
  };

  const openAttachmentChooser = () => {
    attachmentInputRef.current?.click();
  };

  const onAttachmentSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const clientRef = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sendAnonymous = Boolean(anonymousCompose && canComposeAnonymous);
    const message: Message = {
      id: `m${Date.now()}`,
      clientRef,
      sender: 'me',
      senderId: currentUserId,
      kind: file.type.startsWith('image/') ? 'image' : 'file',
      text: file.name,
      time: 'Now',
      imageUrl: file.type.startsWith('image/') ? objectUrl : undefined,
      receiptState: 'sent',
      anonymous: sendAnonymous,
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), message],
    }));
    event.target.value = '';
    const uploadedUrls = await uploadFiles([file]).catch(() => []);
    const chatId = activeChat.id;

    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId,
        senderId: currentUserId,
        clientRef,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        text: file.name,
        mediaUrls: uploadedUrls.length ? uploadedUrls : [objectUrl],
        anonymous: sendAnonymous,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast(payload.error || 'Could not send attachment');
          return;
        }
        if (typeof payload.anonymousRemaining === 'number') {
          setAnonymousRemaining(payload.anonymousRemaining);
        }
        if (payload.message) {
          reconcileIncomingMessage(chatId, payload.message);
        }
      })
      .catch(() => undefined);
  };

  const insertEmoji = (emoji: string) => {
    setMessageDraft((current) => `${current}${emoji}`);
  };

  const startRecording = async () => {
    if (isRecording) {
      return;
    }

    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      window.alert('Voice note recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const durationSeconds = Math.max(1, recordingSeconds);
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        const clientRef = `web-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sendAnonymous = Boolean(anonymousCompose && canComposeAnonymous);
        const chatId = activeChat.id;
        setMessagesByChat((current) => ({
          ...current,
          [chatId]: [
            ...(current[chatId] ?? []),
            {
              id: `m${Date.now()}`,
              clientRef,
              sender: 'me' as const,
              senderId: currentUserId,
              kind: 'voice' as const,
              text: 'Voice note',
              time: 'Now',
              audioUrl,
              durationLabel: formatDurationLabel(durationSeconds),
              receiptState: 'sent' as const,
              anonymous: sendAnonymous,
            },
          ],
        }));
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        uploadFiles([file])
          .then((uploadedUrls) =>
            fetch(`${API_BASE_URL}/api/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId,
                senderId: currentUserId,
                clientRef,
                kind: 'voice',
                text: 'Voice note',
                mediaUrls: uploadedUrls.length ? uploadedUrls : [audioUrl],
                durationSeconds,
                anonymous: sendAnonymous,
              }),
            }).then(async (response) => {
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                showToast(payload.error || 'Could not send voice note');
                return;
              }
              if (typeof payload.anonymousRemaining === 'number') {
                setAnonymousRemaining(payload.anonymousRemaining);
              }
              if (payload.message) {
                reconcileIncomingMessage(chatId, payload.message);
              }
            }),
          )
          .catch(() => undefined);
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setRecordingSeconds(0);
      };

      recorder.start();
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1);
      }, 1000);
      setIsRecording(true);
    } catch {
      window.alert('Microphone permission is required to record voice notes.');
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return;
    }

    mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  const renderDictateButton = () => (
    <button
      className={`composer-icon dictate-button ${isDictating ? 'listening' : ''}`}
      disabled={!speechRecognitionSupported}
      onClick={() => toggleDictation()}
      title={
        speechRecognitionSupported
          ? isDictating
            ? 'Stop dictation'
            : 'Dictate'
          : 'Speech recognition unavailable in this browser'
      }
      type="button"
    >
      {isDictating ? 'Stop' : 'Dictate'}
    </button>
  );

  const renderComposerControls = () => {
    if (messageDraft.trim()) {
      return (
        <div className="composer-actions">
          {renderDictateButton()}
          <button className="send-button" onClick={sendMessage} type="button">
            Send
          </button>
        </div>
      );
    }

    return (
      <div className="composer-actions">
        <button className="composer-icon" onClick={() => insertEmoji('😂')} type="button">
          ☺
        </button>
        <button className="composer-icon" onClick={openAttachmentChooser} type="button">
          ＋
        </button>
        {renderDictateButton()}
        <button
          className={`mic-button ${isRecording ? 'recording' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          type="button"
        >
          {isRecording ? formatDurationLabel(recordingSeconds) : 'Mic'}
        </button>
      </div>
    );
  };

  const renderSummarySection = (
    title: string,
    items: ChatSummaryItem[],
  ) => {
    if (!items.length) return null;
    return (
      <div className="summary-section">
        <h4>{title}</h4>
        <ul>
          {items.map((item) => (
            <li key={`${title}-${item.messageId}-${item.text.slice(0, 24)}`}>
              <button
                onClick={() => focusSummaryMessage(item.messageId)}
                title="Jump to message"
                type="button"
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderReceipt = (message: Message) => {
    if (message.sender !== 'me') {
      return null;
    }

    const glyph = message.receiptState === 'sent' ? '✓' : '✓✓';
    return (
      <span className={`receipt-badge ${message.receiptState ?? 'sent'} aria-hidden`}>
        {glyph}
      </span>
    );
  };

  const submitStatusReaction = (emoji: string) => {
    if (!activeStatusItem) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, emoji }),
    }).catch(() => undefined);
  };

  const submitStatusComment = () => {
    if (!activeStatusItem || !statusCommentDraft.trim()) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, text: statusCommentDraft.trim() }),
    }).catch(() => undefined);
    setStatusCommentDraft('');
    setStatusReplyVisible(false);
  };

  const postStatus = async () => {
    const assetUrls = await uploadFiles(statusAssetFiles).catch((): string[] => []);
    if (!statusText.trim() && !assetUrls.length) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
        text: statusText.trim(),
        backgroundColor: statusBackgroundColor,
        fontFamily: statusFontFamily === 'System' ? undefined : statusFontFamily,
        fontSize: statusFontSize,
        assets: assetUrls.map((url: string) => ({ kind: 'image', url })),
        audience: statusAudience,
      }),
    }).catch(() => undefined);
    setStatusText('');
    setStatusAssetFiles([]);
    setStatusComposerVisible(false);
  };

  const startEditingStatusComment = (commentId: string, text: string) => {
    setEditingStatusCommentId(commentId);
    setEditingStatusCommentText(text);
  };

  const saveStatusCommentEdit = () => {
    if (!activeStatusItem || !editingStatusCommentId || !editingStatusCommentText.trim()) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/comments/${editingStatusCommentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, text: editingStatusCommentText.trim() }),
    }).catch(() => undefined);
    setEditingStatusCommentId(null);
    setEditingStatusCommentText('');
  };

  const deleteStatusComment = (commentId: string) => {
    if (!activeStatusItem) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/comments/${commentId}?userId=${currentUserId}`, {
      method: 'DELETE',
    }).catch(() => undefined);
    if (editingStatusCommentId === commentId) {
      setEditingStatusCommentId(null);
      setEditingStatusCommentText('');
    }
  };

  const openViewerList = () => {
    if (!activeStatusItem) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/viewers`)
      .then((response) => response.json())
      .then((payload) => {
        setStatusViewers(payload.viewers ?? []);
        setStatusViewersVisible(true);
      })
      .catch(() => undefined);
  };

  const openReactorList = () => {
    if (!activeStatusItem) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/reactors`)
      .then((response) => response.json())
      .then((payload) => {
        setStatusReactors(payload.reactors ?? []);
        setStatusReactorsVisible(true);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!statusViewersVisible || !activeStatusItem) {
      return;
    }

    openViewerList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatusItem, activeStatusItem?.views?.length, statusViewersVisible]);

  useEffect(() => {
    if (!statusReactorsVisible || !activeStatusItem) {
      return;
    }

    openReactorList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatusItem, activeStatusItem?.reactions?.length, statusReactorsVisible]);

  const communityRoleAtLeast = (role: CommunityRole | null | undefined, minimum: CommunityRole) => {
    const rank: Record<CommunityRole, number> = { owner: 4, admin: 3, moderator: 2, member: 1 };
    if (!role) return false;
    return rank[role] >= rank[minimum];
  };

  const canRevealAnonymousAuthor = (chat: Chat | null) => {
    if (!chat || chat.kind !== 'group' || !currentUserId) {
      return false;
    }
    if (chat.communityId) {
      const community =
        (communityDetail?.id === chat.communityId ? communityDetail : null)
        || communitiesMine.find((item) => item.id === chat.communityId)
        || null;
      if (communityRoleAtLeast(community?.myRole ?? null, 'moderator')) {
        return true;
      }
      return Array.isArray(chat.adminIds) && chat.adminIds.includes(currentUserId);
    }
    return Array.isArray(chat.adminIds) && chat.adminIds.includes(currentUserId);
  };

  const revealAnonymousAuthor = async (message: Message) => {
    if (!currentUserId || !message.anonymous || !canRevealAnonymousAuthor(activeChat)) {
      return;
    }
    setAnonymousRevealBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}/reveal-author`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not reveal author');
        return;
      }
      setAnonymousRevealResult({
        authorUserId: payload.authorUserId || '',
        authorName: payload.authorName || undefined,
        notice: payload.notice || 'Reveals are logged for moderation accountability.',
      });
      setMessageActionTarget(null);
      showToast(
        `Author: ${payload.authorName || payload.authorUserId || 'Unknown'} · audited`,
        3600,
      );
    } finally {
      setAnonymousRevealBusy(false);
    }
  };

  const communityJson = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const upsertCommunityPreview = (community: CommunityPreview) => {
    const isMine = community.myState === 'active' || community.myState === 'pending';
    setCommunitiesMine((current) => {
      const without = current.filter((item) => item.id !== community.id);
      return isMine ? [community, ...without] : without;
    });
    setCommunitiesDiscover((current) => {
      if (community.privacy !== 'public') {
        return current.filter((item) => item.id !== community.id);
      }
      return [community, ...current.filter((item) => item.id !== community.id)];
    });
    setCommunitiesSearchResults((current) =>
      current.map((item) => (item.id === community.id ? { ...item, ...community } : item)),
    );
    setCommunityDetail((current) => (current?.id === community.id ? { ...current, ...community } : current));
  };

  const ensureChatFromCommunityRoom = (room: CommunityRoom, chatPayload?: any) => {
    const chatId = room.chatId || chatPayload?.id;
    if (!chatId) return;
    const allowAnonymous = Boolean(
      chatPayload?.allowAnonymous ?? room.allowAnonymous,
    );
    setChatItems((current) => {
      const existing = current.find((item) => item.id === chatId);
      if (existing) {
        return current.map((item) =>
          item.id === chatId
            ? {
                ...item,
                kind: 'group' as const,
                name: room.title || item.name,
                communityId: room.communityId || chatPayload?.communityId || item.communityId,
                allowAnonymous,
                adminIds: Array.isArray(chatPayload?.adminIds)
                  ? chatPayload.adminIds.filter((id: unknown): id is string => typeof id === 'string')
                  : item.adminIds,
              }
            : item,
        );
      }
      if (chatPayload) {
        return [mapChatFromServer(chatPayload, currentUserId, users), ...current];
      }
      return [
        {
          id: chatId,
          name: room.title || 'Community room',
          preview: room.topic || 'Community room',
          time: formatClock(room.updatedAt || new Date().toISOString()),
          unread: 0,
          presence: 'offline',
          kind: 'group' as const,
          communityId: room.communityId,
          allowAnonymous,
        },
        ...current,
      ];
    });
  };

  const openCommunityRoomChat = (room: CommunityRoom, chatPayload?: any) => {
    ensureChatFromCommunityRoom(room, chatPayload || room.chat);
    setSelectedChatId(room.chatId);
    setActiveView('chats');
  };

  const loadCommunitiesList = useCallback(async () => {
    if (!currentUserId) return;
    const response = await fetch(`${API_BASE_URL}/api/communities?userId=${encodeURIComponent(currentUserId)}`);
    const payload = await communityJson(response);
    if (!response.ok) {
      setCommunityNotice(payload.error || 'Could not load communities.');
      return;
    }
    setCommunitiesMine(payload.mine ?? []);
    setCommunitiesDiscover(payload.discoverable ?? []);
  }, [currentUserId]);

  const loadCommunityDetail = useCallback(async (communityId: string) => {
    if (!currentUserId || !communityId) return;
    setCommunityBusy(true);
    setCommunityNotice('');
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await communityJson(response);
      if (!response.ok) {
        setCommunityNotice(payload.error || 'Could not load community.');
        return;
      }
      const community = payload.community as CommunityPreview;
      setSelectedCommunityId(communityId);
      setCommunityDetail(community);
      setCommunityMembership(payload.membership ?? null);
      setCommunityRooms(payload.rooms ?? []);
      setCommunityEditForm({
        name: community.name || '',
        description: community.description || '',
        rules: community.rules || '',
        privacy: community.privacy || 'public',
        avatarUrl: community.avatarUrl || '',
        pinnedRules: Boolean(community.pinnedRules),
      });
      setCommunityDetailTab('overview');
      setCommunityCreatedInviteToken('');

      const role = community.myRole;
      const isActive = community.myState === 'active';
      if (isActive) {
        const membersRes = await fetch(
          `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/members?userId=${encodeURIComponent(currentUserId)}`,
        );
        if (membersRes.ok) {
          const membersPayload = await communityJson(membersRes);
          setCommunityMembers(membersPayload.members ?? []);
        } else {
          setCommunityMembers([]);
        }
      } else {
        setCommunityMembers([]);
      }

      if (isActive && communityRoleAtLeast(role, 'moderator')) {
        const [requestsRes, auditRes, modRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/join-requests?userId=${encodeURIComponent(currentUserId)}`),
          fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/audit?userId=${encodeURIComponent(currentUserId)}`),
          fetch(`${API_BASE_URL}/api/communities/moderation/queue?userId=${encodeURIComponent(currentUserId)}`),
        ]);
        if (requestsRes.ok) {
          const requestsPayload = await communityJson(requestsRes);
          setCommunityJoinRequests(requestsPayload.requests ?? []);
        } else {
          setCommunityJoinRequests([]);
        }
        if (auditRes.ok) {
          const auditPayload = await communityJson(auditRes);
          setCommunityAudit(auditPayload.audit ?? []);
        } else {
          setCommunityAudit([]);
        }
        if (modRes.ok) {
          const modPayload = await communityJson(modRes);
          setCommunityModReports((modPayload.reports ?? []).filter((item: CommunityReport) => item.communityId === communityId));
        } else {
          setCommunityModReports([]);
        }
      } else {
        setCommunityJoinRequests([]);
        setCommunityAudit([]);
        setCommunityModReports([]);
      }
    } finally {
      setCommunityBusy(false);
    }
  }, [currentUserId]);

  const searchCommunities = async () => {
    if (!currentUserId) return;
    const q = communitiesSearchQuery.trim();
    if (q.length < 2) {
      setCommunityNotice('Enter at least 2 characters to search.');
      return;
    }
    const response = await fetch(
      `${API_BASE_URL}/api/communities/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(currentUserId)}`,
    );
    const payload = await communityJson(response);
    if (!response.ok) {
      setCommunityNotice(payload.error || 'Search failed.');
      return;
    }
    setCommunitiesSearchResults(payload.communities ?? []);
    setCommunityNotice('');
  };

  const createCommunity = async () => {
    if (!currentUserId) return;
    if (communityCreateForm.name.trim().length < 2) {
      setCommunityNotice('Enter a community name (at least 2 characters).');
      return;
    }
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          name: communityCreateForm.name.trim(),
          description: communityCreateForm.description.trim(),
          rules: communityCreateForm.rules.trim(),
          privacy: communityCreateForm.privacy,
          avatarUrl: communityCreateForm.avatarUrl.trim(),
        }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        setCommunityNotice(payload.error || 'Could not create community.');
        return;
      }
      setCommunityCreateForm({ name: '', description: '', rules: '', privacy: 'public', avatarUrl: '' });
      await loadCommunitiesList();
      if (payload.community?.id) {
        await loadCommunityDetail(payload.community.id);
      }
      (payload.rooms as CommunityRoom[] | undefined)?.forEach((room) => ensureChatFromCommunityRoom(room));
      showToast('Community created');
    } finally {
      setCommunityBusy(false);
    }
  };

  const joinCommunity = async (communityId: string) => {
    if (!currentUserId) return;
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, note: communityJoinNote.trim() }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        setCommunityNotice(payload.error || 'Could not join.');
        showToast(payload.error || 'Could not join');
        return;
      }
      setCommunityJoinNote('');
      showToast(payload.membership?.state === 'pending' ? 'Join request sent' : 'Joined community');
      await loadCommunitiesList();
      await loadCommunityDetail(communityId);
    } finally {
      setCommunityBusy(false);
    }
  };

  const leaveCommunity = async (communityId: string) => {
    if (!currentUserId) return;
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        setCommunityNotice(payload.error || 'Could not leave.');
        showToast(payload.error || 'Could not leave');
        return;
      }
      showToast('Left community');
      await loadCommunitiesList();
      await loadCommunityDetail(communityId);
    } finally {
      setCommunityBusy(false);
    }
  };

  const muteCommunity = async (communityId: string, muted: boolean) => {
    if (!currentUserId) return;
    const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/mute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, muted }),
    });
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not update mute');
      return;
    }
    if (payload.membership) {
      setCommunityMembership(payload.membership);
      setCommunityDetail((current) => (current ? { ...current, muted: Boolean(payload.membership.muted) } : current));
    }
    showToast(muted ? 'Community muted' : 'Community unmuted');
  };

  const reportCommunity = async (communityId: string) => {
    if (!currentUserId) return;
    if (communityReportReason.trim().length < 4) {
      setCommunityNotice('Enter a short reason (at least 4 characters).');
      return;
    }
    const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, reason: communityReportReason.trim() }),
    });
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not report');
      return;
    }
    setCommunityReportReason('');
    showToast(payload.message || 'Community reported');
  };

  const acceptCommunityInvite = async () => {
    if (!currentUserId) return;
    const token = communityInviteTokenDraft.trim();
    if (!token) {
      setCommunityNotice('Paste an invite token first.');
      return;
    }
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        setCommunityNotice(payload.error || 'Invite could not be accepted.');
        showToast(payload.error || 'Invite failed');
        return;
      }
      setCommunityInviteTokenDraft('');
      showToast(payload.alreadyMember ? 'Already a member' : 'Invite accepted');
      await loadCommunitiesList();
      if (payload.community?.id) {
        await loadCommunityDetail(payload.community.id);
      }
    } finally {
      setCommunityBusy(false);
    }
  };

  const createCommunityInvite = async (communityId: string) => {
    if (!currentUserId) return;
    const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, role: 'member' }),
    });
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not create invite');
      return;
    }
    setCommunityCreatedInviteToken(payload.invite?.token || '');
    showToast('Invite token created');
  };

  const saveCommunitySettings = async (communityId: string) => {
    if (!currentUserId) return;
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          name: communityEditForm.name.trim(),
          description: communityEditForm.description.trim(),
          rules: communityEditForm.rules.trim(),
          privacy: communityEditForm.privacy,
          avatarUrl: communityEditForm.avatarUrl.trim(),
          pinnedRules: communityEditForm.pinnedRules,
        }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not save settings');
        return;
      }
      showToast('Settings saved');
      await loadCommunitiesList();
      await loadCommunityDetail(communityId);
    } finally {
      setCommunityBusy(false);
    }
  };

  const createCommunityRoom = async (communityId: string) => {
    if (!currentUserId) return;
    if (!communityRoomForm.title.trim()) {
      setCommunityNotice('Enter a room title.');
      return;
    }
    setCommunityBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          title: communityRoomForm.title.trim(),
          topic: communityRoomForm.topic.trim(),
          isAnnouncement: communityRoomForm.isAnnouncement,
          allowAnonymous: communityRoomForm.allowAnonymous,
        }),
      });
      const payload = await communityJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not create room');
        return;
      }
      setCommunityRoomForm({ title: '', topic: '', isAnnouncement: false, allowAnonymous: false });
      if (payload.room) {
        setCommunityRooms((current) => [payload.room, ...current.filter((item) => item.id !== payload.room.id)]);
        ensureChatFromCommunityRoom(payload.room, payload.chat);
      }
      showToast('Room created');
    } finally {
      setCommunityBusy(false);
    }
  };

  const updateCommunityRoomAllowAnonymous = async (
    communityId: string,
    room: CommunityRoom,
    allowAnonymous: boolean,
  ) => {
    if (!currentUserId) return;
    setCommunityBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/rooms/${encodeURIComponent(room.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            allowAnonymous,
          }),
        },
      );
      const payload = await communityJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not update room');
        return;
      }
      if (payload.room) {
        setCommunityRooms((current) =>
          current.map((item) => (item.id === payload.room.id ? payload.room : item)),
        );
        ensureChatFromCommunityRoom(payload.room);
      }
      showToast(allowAnonymous ? 'Anonymous posting enabled' : 'Anonymous posting disabled');
    } finally {
      setCommunityBusy(false);
    }
  };

  const setCommunityMemberRole = async (communityId: string, targetUserId: string, role: CommunityRole) => {
    if (!currentUserId) return;
    const response = await fetch(
      `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(targetUserId)}/role`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, role }),
      },
    );
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not change role');
      return;
    }
    showToast('Role updated');
    await loadCommunityDetail(communityId);
  };

  const removeCommunityMember = async (communityId: string, targetUserId: string) => {
    if (!currentUserId) return;
    const response = await fetch(
      `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(targetUserId)}/remove`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      },
    );
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not remove member');
      return;
    }
    showToast('Member removed');
    await loadCommunityDetail(communityId);
  };

  const reviewCommunityJoinRequest = async (communityId: string, requestId: string, decision: 'approve' | 'reject') => {
    if (!currentUserId) return;
    const response = await fetch(
      `${API_BASE_URL}/api/communities/${encodeURIComponent(communityId)}/join-requests/${encodeURIComponent(requestId)}/${decision}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      },
    );
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || `Could not ${decision}`);
      return;
    }
    showToast(decision === 'approve' ? 'Request approved' : 'Request rejected');
    await loadCommunityDetail(communityId);
  };

  const reviewCommunityReport = async (reportId: string, state: 'reviewed' | 'dismissed' | 'actioned') => {
    if (!currentUserId) return;
    const response = await fetch(`${API_BASE_URL}/api/communities/moderation/${encodeURIComponent(reportId)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, state }),
    });
    const payload = await communityJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not review report');
      return;
    }
    showToast('Report reviewed');
    if (selectedCommunityId) {
      await loadCommunityDetail(selectedCommunityId);
    }
  };

  useEffect(() => {
    if (activeView === 'communities' && currentUserId) {
      void loadCommunitiesList();
    }
  }, [activeView, currentUserId, loadCommunitiesList]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return undefined;

    const onCommunityUpdated = (payload: {
      community?: CommunityPreview;
      communityId?: string;
      action?: string;
      report?: CommunityReport;
    }) => {
      if (payload.community?.id) {
        upsertCommunityPreview(payload.community);
        if (selectedCommunityIdRef.current === payload.community.id) {
          void loadCommunityDetail(payload.community.id);
        }
      } else if (payload.communityId && selectedCommunityIdRef.current === payload.communityId) {
        void loadCommunityDetail(payload.communityId);
      }
      if (payload.action === 'report_created') {
        showToast('New community report');
      }
      void loadCommunitiesList();
    };

    const onCommunityMembership = (payload: {
      communityId?: string;
      membership?: CommunityMembership;
    }) => {
      if (!payload.communityId) return;
      if (payload.membership?.userId === currentUserIdRef.current) {
        void loadCommunitiesList();
      }
      if (selectedCommunityIdRef.current === payload.communityId) {
        void loadCommunityDetail(payload.communityId);
      }
    };

    const onCommunityRoom = (payload: {
      communityId?: string;
      room?: CommunityRoom;
      action?: string;
    }) => {
      if (!payload.room) return;
      if (selectedCommunityIdRef.current === payload.communityId) {
        setCommunityRooms((current) => {
          const without = current.filter((item) => item.id !== payload.room!.id);
          if (payload.action === 'deleted') return without;
          return [payload.room!, ...without];
        });
      }
      if (payload.action === 'created' || payload.action === 'updated') {
        ensureChatFromCommunityRoom(payload.room);
      }
    };

    socket.on('community:updated', onCommunityUpdated);
    socket.on('community:membership', onCommunityMembership);
    socket.on('community:room', onCommunityRoom);
    return () => {
      socket.off('community:updated', onCommunityUpdated);
      socket.off('community:membership', onCommunityMembership);
      socket.off('community:room', onCommunityRoom);
    };
  }, [currentUserId, loadCommunitiesList, loadCommunityDetail]);

  const voiceJson = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const closeVoicePeer = (peerUserId: string) => {
    const connection = voicePeerConnectionsRef.current.get(peerUserId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
      voicePeerConnectionsRef.current.delete(peerUserId);
    }
    const audio = voiceRemoteAudioRef.current.get(peerUserId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      voiceRemoteAudioRef.current.delete(peerUserId);
    }
    voiceMakingOfferRef.current.delete(peerUserId);
  };

  const cleanupVoiceMesh = (stopLocal = true) => {
    Array.from(voicePeerConnectionsRef.current.keys()).forEach((peerUserId) => closeVoicePeer(peerUserId));
    if (stopLocal) {
      voiceLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceLocalStreamRef.current = null;
    }
  };

  const emitVoiceSignal = (
    roomId: string,
    signalType: 'offer' | 'answer' | 'ice-candidate',
    payload: unknown,
    toUserId: string,
  ) => {
    socketRef.current?.emit('voice:signal', {
      roomId,
      fromUserId: currentUserIdRef.current,
      toUserId,
      signalType,
      payload,
    });
  };

  const ensureVoiceLocalStream = async () => {
    if (voiceLocalStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live')) {
      return voiceLocalStreamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceLocalStreamRef.current = stream;
    return stream;
  };

  const applyVoiceLocalMute = (muted: boolean) => {
    voiceLocalStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    setVoiceMicMuted(muted);
  };

  const ensureVoicePeerConnection = async (peerUserId: string, canPublish: boolean) => {
    const existing = voicePeerConnectionsRef.current.get(peerUserId);
    if (existing) {
      if (canPublish && voiceLocalStreamRef.current) {
        const senders = existing.getSenders();
        const hasAudio = senders.some((sender) => sender.track?.kind === 'audio');
        if (!hasAudio) {
          voiceLocalStreamRef.current.getAudioTracks().forEach((track) => {
            existing.addTrack(track, voiceLocalStreamRef.current!);
          });
        }
      }
      if (!canPublish) {
        existing.getSenders().forEach((sender) => {
          if (sender.track) {
            try {
              existing.removeTrack(sender);
            } catch {
              // ignore
            }
          }
        });
      }
      return existing;
    }

    const roomId = voiceActiveRoomIdRef.current;
    const connection = new RTCPeerConnection(WEBRTC_CONFIGURATION);
    connection.onicecandidate = (event) => {
      if (event.candidate && roomId) {
        emitVoiceSignal(roomId, 'ice-candidate', event.candidate.toJSON(), peerUserId);
      }
    };
    connection.ontrack = (event) => {
      let audio = voiceRemoteAudioRef.current.get(peerUserId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        voiceRemoteAudioRef.current.set(peerUserId, audio);
      }
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        closeVoicePeer(peerUserId);
      }
    };

    if (canPublish) {
      try {
        const localStream = await ensureVoiceLocalStream();
        localStream.getAudioTracks().forEach((track) => connection.addTrack(track, localStream));
      } catch {
        showToast('Microphone unavailable — controls still work');
      }
    } else {
      connection.addTransceiver('audio', { direction: 'recvonly' });
    }

    voicePeerConnectionsRef.current.set(peerUserId, connection);
    return connection;
  };

  const offerVoicePeer = async (peerUserId: string, canPublish: boolean) => {
    if (voiceMakingOfferRef.current.has(peerUserId)) return;
    voiceMakingOfferRef.current.add(peerUserId);
    try {
      const roomId = voiceActiveRoomIdRef.current;
      if (!roomId) return;
      const connection = await ensureVoicePeerConnection(peerUserId, canPublish);
      const offer = await connection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await connection.setLocalDescription(offer);
      emitVoiceSignal(roomId, 'offer', offer, peerUserId);
    } catch {
      showToast('Voice mesh offer failed');
    } finally {
      voiceMakingOfferRef.current.delete(peerUserId);
    }
  };

  const syncVoiceMesh = async (participants: VoiceRoomParticipant[]) => {
    const me = currentUserIdRef.current;
    const roomId = voiceActiveRoomIdRef.current;
    if (!me || !roomId) return;

    const myPart = participants.find((item) => item.userId === me && item.state === 'active');
    const others = participants.filter((item) => item.state === 'active' && item.userId !== me);
    voiceMyRoleRef.current = myPart?.role ?? null;

    for (const peerUserId of Array.from(voicePeerConnectionsRef.current.keys())) {
      if (!others.some((item) => item.userId === peerUserId)) {
        closeVoicePeer(peerUserId);
      }
    }

    if (!myPart) {
      cleanupVoiceMesh(true);
      return;
    }

    const iPublish = isVoicePublisherRole(myPart.role) && !myPart.forceMuted;
    const iAmPublisherRole = isVoicePublisherRole(myPart.role);

    if (iAmPublisherRole) {
      try {
        await ensureVoiceLocalStream();
        applyVoiceLocalMute(myPart.muted || myPart.forceMuted);
      } catch {
        showToast('Microphone unavailable — controls still work');
      }
    } else {
      voiceLocalStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceLocalStreamRef.current = null;
      setVoiceMicMuted(true);
      // Tear down publish legs so demote stops sending immediately.
      for (const peerUserId of Array.from(voicePeerConnectionsRef.current.keys())) {
        closeVoicePeer(peerUserId);
      }
    }

    for (const peer of others) {
      const peerPublishes = isVoicePublisherRole(peer.role);
      if (!iAmPublisherRole && !peerPublishes) continue;

      const shouldOffer =
        iAmPublisherRole &&
        (iPublish || peerPublishes) &&
        (!peerPublishes || me < peer.userId);

      if (shouldOffer) {
        await offerVoicePeer(peer.userId, iPublish);
      } else if (iAmPublisherRole && peerPublishes && me > peer.userId) {
        await ensureVoicePeerConnection(peer.userId, iPublish);
      }
    }
  };

  const exitVoiceRoomLocal = (opts?: { emitLeave?: boolean; toast?: string }) => {
    const roomId = voiceActiveRoomIdRef.current;
    const userId = currentUserIdRef.current;
    if (opts?.emitLeave && roomId && userId) {
      socketRef.current?.emit('voice:leave', { roomId, userId });
    }
    cleanupVoiceMesh(true);
    voiceActiveRoomIdRef.current = '';
    voiceMyRoleRef.current = null;
    voiceParticipantsRef.current = [];
    setActiveVoiceRoom(null);
    setVoiceParticipants([]);
    setVoiceReconnecting(false);
    setVoiceCreatedInviteToken('');
    setVoiceMicMuted(false);
    if (opts?.toast) showToast(opts.toast);
  };

  const loadVoiceRoomsList = useCallback(async () => {
    if (!currentUserId) return;
    const response = await fetch(
      `${API_BASE_URL}/api/voice-rooms?userId=${encodeURIComponent(currentUserId)}`,
    );
    const payload = await voiceJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Could not load voice rooms');
      return;
    }
    setVoiceRoomsMine(payload.mine ?? []);
    setVoiceRoomsLivePublic(payload.livePublic ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const enterVoiceRoomSession = async (room: VoiceRoomPreview, participant?: VoiceRoomParticipant | null) => {
    const userId = currentUserIdRef.current;
    if (!userId || !room.id) return;
    const previousRoomId = voiceActiveRoomIdRef.current;
    if (previousRoomId && previousRoomId !== room.id) {
      socketRef.current?.emit('voice:leave', { roomId: previousRoomId, userId });
      cleanupVoiceMesh(true);
    }
    voiceActiveRoomIdRef.current = room.id;
    voiceMyRoleRef.current = participant?.role ?? room.myRole;
    setActiveVoiceRoom({
      ...room,
      myRole: participant?.role ?? room.myRole,
      myState: participant?.state ?? room.myState ?? 'active',
      muted: participant?.muted ?? room.muted,
      handRaised: participant?.handRaised ?? room.handRaised,
    });
    setVoiceMicMuted(Boolean(participant?.muted ?? room.muted));
    socketRef.current?.emit('voice:join', { roomId: room.id, userId });
    setActiveView('voiceRooms');
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/voice-rooms/${encodeURIComponent(room.id)}/participants?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await voiceJson(response);
      if (response.ok && Array.isArray(payload.participants)) {
        const next = payload.participants as VoiceRoomParticipant[];
        voiceParticipantsRef.current = next;
        setVoiceParticipants(next);
        await syncVoiceMesh(next);
      }
    } catch {
      // socket voice:participants will fill in
    }
  };

  const createVoiceRoom = async () => {
    if (!currentUserId) return;
    const title = voiceCreateForm.title.trim();
    if (title.length < 2) {
      showToast('Enter a room title');
      return;
    }
    setVoiceBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/voice-rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          title,
          description: voiceCreateForm.description.trim(),
          rules: voiceCreateForm.rules.trim(),
          privacy: voiceCreateForm.privacy,
        }),
      });
      const payload = await voiceJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not create voice room');
        return;
      }
      setVoiceCreateForm({ title: '', description: '', rules: '', privacy: 'public' });
      showToast('Voice room live');
      await loadVoiceRoomsList();
      if (payload.room) {
        await enterVoiceRoomSession(payload.room, payload.participant);
      }
    } catch {
      showToast('Could not create voice room');
    } finally {
      setVoiceBusy(false);
    }
  };

  const joinVoiceRoom = async (roomId: string, inviteToken?: string) => {
    if (!currentUserId) return;
    setVoiceBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/voice-rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          ...(inviteToken ? { inviteToken } : {}),
        }),
      });
      const payload = await voiceJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not join voice room');
        return;
      }
      showToast(payload.alreadyJoined ? 'Already in room' : 'Joined voice room');
      await loadVoiceRoomsList();
      if (payload.room) {
        await enterVoiceRoomSession(payload.room, payload.participant);
      }
    } catch {
      showToast('Could not join voice room');
    } finally {
      setVoiceBusy(false);
    }
  };

  const leaveVoiceRoom = async () => {
    const roomId = voiceActiveRoomIdRef.current || activeVoiceRoom?.id;
    if (!currentUserId || !roomId) return;
    setVoiceBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/voice-rooms/${encodeURIComponent(roomId)}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await voiceJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not leave');
        return;
      }
      exitVoiceRoomLocal({ emitLeave: true, toast: payload.ended ? 'Room ended' : 'Left voice room' });
      await loadVoiceRoomsList();
    } catch {
      showToast('Could not leave');
    } finally {
      setVoiceBusy(false);
    }
  };

  const endVoiceRoom = async () => {
    const roomId = voiceActiveRoomIdRef.current || activeVoiceRoom?.id;
    if (!currentUserId || !roomId) return;
    setVoiceBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/voice-rooms/${encodeURIComponent(roomId)}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await voiceJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Could not end room');
        return;
      }
      exitVoiceRoomLocal({ emitLeave: true, toast: 'Room ended' });
      await loadVoiceRoomsList();
    } catch {
      showToast('Could not end room');
    } finally {
      setVoiceBusy(false);
    }
  };

  const voiceRoomAction = async (
    path: string,
    body: Record<string, unknown> = {},
    okToast?: string,
  ) => {
    if (!currentUserId) return null;
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, ...body }),
    });
    const payload = await voiceJson(response);
    if (!response.ok) {
      showToast(payload.error || 'Action failed');
      return null;
    }
    if (okToast) showToast(okToast);
    return payload;
  };

  const raiseVoiceHand = async () => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(`/api/voice-rooms/${encodeURIComponent(roomId)}/raise-hand`, {}, 'Hand raised');
  };

  const lowerVoiceHand = async () => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(`/api/voice-rooms/${encodeURIComponent(roomId)}/lower-hand`, {}, 'Hand lowered');
  };

  const toggleVoiceMic = async () => {
    const room = activeVoiceRoom;
    const me = voiceParticipants.find((item) => item.userId === currentUserId && item.state === 'active');
    if (!room || !me || !isVoicePublisherRole(me.role)) return;
    if (me.forceMuted && me.muted) {
      showToast('You were muted by the host');
      return;
    }
    const nextMuted = !me.muted;
    const payload = await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(room.id)}/participants/${encodeURIComponent(currentUserId)}/mute`,
      { muted: nextMuted },
    );
    if (!payload?.participant) return;
    applyVoiceLocalMute(Boolean(payload.participant.muted));
  };

  const approveVoiceSpeaker = async (targetUserId: string) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/speakers/${encodeURIComponent(targetUserId)}/approve`,
      {},
      'Speaker approved',
    );
  };

  const rejectVoiceHand = async (targetUserId: string) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/speakers/${encodeURIComponent(targetUserId)}/reject`,
      {},
      'Hand rejected',
    );
  };

  const demoteVoiceSpeaker = async (targetUserId: string) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/speakers/${encodeURIComponent(targetUserId)}/demote`,
      {},
      'Demoted to listener',
    );
  };

  const muteVoiceParticipant = async (targetUserId: string, muted: boolean) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(targetUserId)}/mute`,
      { muted },
      muted ? 'Muted' : 'Unmuted',
    );
  };

  const removeVoiceParticipant = async (targetUserId: string) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(targetUserId)}/remove`,
      { block: false },
      'Removed',
    );
  };

  const promoteVoiceModerator = async (targetUserId: string) => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/moderators/${encodeURIComponent(targetUserId)}`,
      {},
      'Moderator added',
    );
  };

  const createVoiceInvite = async () => {
    const roomId = activeVoiceRoom?.id;
    if (!roomId) return;
    const payload = await voiceRoomAction(
      `/api/voice-rooms/${encodeURIComponent(roomId)}/invites`,
      { role: 'listener' },
      'Invite created',
    );
    if (payload?.invite?.token) {
      setVoiceCreatedInviteToken(payload.invite.token);
    }
  };

  const acceptVoiceInvite = async () => {
    const token = voiceInviteTokenDraft.trim();
    if (!currentUserId || !token) {
      showToast('Paste an invite token');
      return;
    }
    setVoiceBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/voice-rooms/invites/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await voiceJson(response);
      if (!response.ok) {
        showToast(payload.error || 'Invite failed');
        return;
      }
      setVoiceInviteTokenDraft('');
      showToast('Invite accepted');
      await loadVoiceRoomsList();
      if (payload.room) {
        await enterVoiceRoomSession(payload.room, payload.participant);
      }
    } catch {
      showToast('Invite failed');
    } finally {
      setVoiceBusy(false);
    }
  };

  useEffect(() => {
    voiceParticipantsRef.current = voiceParticipants;
  }, [voiceParticipants]);

  useEffect(() => {
    if (activeView === 'voiceRooms' && currentUserId) {
      void loadVoiceRoomsList();
    }
  }, [activeView, currentUserId, loadVoiceRoomsList]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return undefined;

    const onVoiceRoom = (payload: {
      room?: VoiceRoomPreview;
      action?: string;
      error?: string;
    }) => {
      if (payload.error) {
        showToast(payload.error);
      }
      if (!payload.room) return;
      const room = payload.room;
      if (voiceActiveRoomIdRef.current === room.id || activeVoiceRoom?.id === room.id) {
        if (payload.action === 'removed' || payload.action === 'blocked') {
          exitVoiceRoomLocal({ emitLeave: true, toast: payload.action === 'blocked' ? 'Blocked from room' : 'Removed from room' });
          void loadVoiceRoomsList();
          return;
        }
        if (payload.action === 'speaker_demoted') {
          cleanupVoiceMesh(true);
        }
        setActiveVoiceRoom((current) => (current?.id === room.id ? { ...current, ...room } : room));
        voiceMyRoleRef.current = room.myRole;
        if (room.myRole && isVoicePublisherRole(room.myRole)) {
          void syncVoiceMesh(voiceParticipantsRef.current);
        } else if (payload.action === 'speaker_demoted' || payload.action === 'speaker_approved') {
          void syncVoiceMesh(voiceParticipantsRef.current);
        }
      }
      void loadVoiceRoomsList();
    };

    const onVoiceParticipants = (payload: {
      roomId?: string;
      participants?: VoiceRoomParticipant[];
    }) => {
      if (!payload.roomId || payload.roomId !== voiceActiveRoomIdRef.current) return;
      const next = payload.participants ?? [];
      voiceParticipantsRef.current = next;
      setVoiceParticipants(next);
      const me = next.find((item) => item.userId === currentUserIdRef.current && item.state === 'active');
      if (me) {
        setActiveVoiceRoom((current) =>
          current
            ? {
                ...current,
                myRole: me.role,
                myState: me.state,
                muted: me.muted,
                handRaised: me.handRaised,
              }
            : current,
        );
        voiceMyRoleRef.current = me.role;
        if (isVoicePublisherRole(me.role)) {
          applyVoiceLocalMute(me.muted || me.forceMuted);
        }
      } else if (voiceActiveRoomIdRef.current) {
        exitVoiceRoomLocal({ toast: 'Left voice room' });
        void loadVoiceRoomsList();
        return;
      }
      void syncVoiceMesh(next);
    };

    const onVoiceSignal = (payload: {
      roomId?: string;
      fromUserId?: string;
      toUserId?: string;
      signalType?: 'offer' | 'answer' | 'ice-candidate';
      payload?: any;
    }) => {
      const roomId = payload.roomId;
      const fromUserId = payload.fromUserId;
      const signalType = payload.signalType;
      if (!roomId || !fromUserId || !signalType) return;
      if (roomId !== voiceActiveRoomIdRef.current) return;
      if (payload.toUserId && payload.toUserId !== currentUserIdRef.current) return;
      if (fromUserId === currentUserIdRef.current) return;

      void (async () => {
        try {
          const myRole = voiceMyRoleRef.current;
          const iAmPublisher = isVoicePublisherRole(myRole);
          if (signalType === 'offer') {
            const connection = await ensureVoicePeerConnection(fromUserId, iAmPublisher);
            await connection.setRemoteDescription(new RTCSessionDescription(payload.payload));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            emitVoiceSignal(roomId, 'answer', answer, fromUserId);
            return;
          }
          if (signalType === 'answer') {
            const connection = voicePeerConnectionsRef.current.get(fromUserId)
              ?? (await ensureVoicePeerConnection(fromUserId, iAmPublisher));
            await connection.setRemoteDescription(new RTCSessionDescription(payload.payload));
            return;
          }
          if (signalType === 'ice-candidate' && payload.payload) {
            const connection = voicePeerConnectionsRef.current.get(fromUserId)
              ?? (await ensureVoicePeerConnection(fromUserId, iAmPublisher));
            await connection.addIceCandidate(new RTCIceCandidate(payload.payload));
          }
        } catch {
          // keep UI; mesh may recover on next participant sync
        }
      })();
    };

    const onVoiceEnded = (payload: { roomId?: string }) => {
      if (payload.roomId && payload.roomId === voiceActiveRoomIdRef.current) {
        exitVoiceRoomLocal({ toast: 'Room ended' });
        void loadVoiceRoomsList();
      }
    };

    const onVoiceReconnecting = (payload: { roomId?: string; userId?: string }) => {
      if (payload.roomId === voiceActiveRoomIdRef.current && payload.userId === currentUserIdRef.current) {
        setVoiceReconnecting(true);
      }
    };

    const onDisconnect = () => {
      if (voiceActiveRoomIdRef.current) {
        setVoiceReconnecting(true);
      }
    };

    const onConnect = () => {
      const roomId = voiceActiveRoomIdRef.current;
      const userId = currentUserIdRef.current;
      if (roomId && userId) {
        socket.emit('voice:join', { roomId, userId });
        setVoiceReconnecting(false);
      }
    };

    socket.on('voice:room', onVoiceRoom);
    socket.on('voice:participants', onVoiceParticipants);
    socket.on('voice:signal', onVoiceSignal);
    socket.on('voice:ended', onVoiceEnded);
    socket.on('voice:reconnecting', onVoiceReconnecting);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('voice:room', onVoiceRoom);
      socket.off('voice:participants', onVoiceParticipants);
      socket.off('voice:signal', onVoiceSignal);
      socket.off('voice:ended', onVoiceEnded);
      socket.off('voice:reconnecting', onVoiceReconnecting);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, loadVoiceRoomsList, activeVoiceRoom?.id]);

  const emitGameSocketJoin = useCallback((sessionId: string, userId: string) => {
    const socket = socketRef.current;
    if (!socket || !sessionId || !userId) return;
    socket.emit('game:join', { sessionId, userId });
  }, []);

  const emitGameSocketLeave = useCallback((sessionId: string) => {
    const socket = socketRef.current;
    if (!socket || !sessionId) return;
    socket.emit('game:leave', { sessionId });
  }, []);

  const upsertGameSessionMine = useCallback((session: GameSessionPublic) => {
    setGameSessionsMine((current) => {
      const index = current.findIndex((item) => item.id === session.id);
      if (index < 0) {
        if (session.status === 'cancelled') return current;
        return [session, ...current];
      }
      const next = [...current];
      next[index] = session;
      return next.filter((item) => item.status !== 'cancelled');
    });
  }, []);

  const loadGamesCatalog = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/games`);
      const payload = await response.json();
      if (!response.ok) {
        showToast(payload.error || 'Could not load games.');
        return;
      }
      setGameCatalog(Array.isArray(payload.games) ? payload.games : []);
      if (typeof payload.pointsNote === 'string' && payload.pointsNote.trim()) {
        setGamePointsNote(payload.pointsNote);
      }
    } catch {
      showToast('Could not load games.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGamesLeaderboard = useCallback(async (userId: string) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/leaderboard?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json();
      if (!response.ok) return;
      setGameLeaderboard(Array.isArray(payload.leaderboard) ? payload.leaderboard : []);
      setGameLeaderboardMine(payload.mine ?? null);
      if (typeof payload.pointsNote === 'string' && payload.pointsNote.trim()) {
        setGamePointsNote(payload.pointsNote);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshMyGameSessions = useCallback(async (userId: string) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/mine?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json();
      if (!response.ok) return;
      setGameSessionsMine(Array.isArray(payload.sessions) ? payload.sessions : []);
      if (typeof payload.pointsNote === 'string' && payload.pointsNote.trim()) {
        setGamePointsNote(payload.pointsNote);
      }
    } catch {
      // ignore
    }
  }, []);

  const loadGamesHome = useCallback(async (userId: string) => {
    await Promise.all([
      loadGamesCatalog(),
      loadGamesLeaderboard(userId),
      refreshMyGameSessions(userId),
    ]);
  }, [loadGamesCatalog, loadGamesLeaderboard, refreshMyGameSessions]);

  const resetGamePlayState = useCallback(() => {
    setGameRoundPhase(null);
    setGameCurrentRound(null);
    setGameRoundResult(null);
    setGameRoundMeta({ roundIndex: 0, roundStartedAt: null, roundTimeoutMs: 30000 });
    setGameMyAnswerIndex(null);
    setGameRoundSecondsLeft(null);
  }, []);

  const exitGameUi = useCallback(async (options?: {
    leaveServer?: boolean;
    skipSocketLeave?: boolean;
  }) => {
    const sessionId = gameActiveSessionIdRef.current;
    const userId = currentUserIdRef.current;
    const leaveServer = options?.leaveServer ?? false;
    const skipSocketLeave = options?.skipSocketLeave ?? false;

    if (leaveServer && sessionId && userId) {
      try {
        await fetch(`${API_BASE_URL}/api/games/sessions/${encodeURIComponent(sessionId)}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
      } catch {
        // ignore
      }
    }
    if (!skipSocketLeave && sessionId) {
      emitGameSocketLeave(sessionId);
    }

    gameActiveSessionIdRef.current = '';
    setGameActiveSession(null);
    setGameScreen('list');
    setGameSelectedSlug('');
    setGameInviteSelectedIds([]);
    resetGamePlayState();
    if (userId) void refreshMyGameSessions(userId);
  }, [emitGameSocketLeave, refreshMyGameSessions, resetGamePlayState]);

  const enterGameSession = useCallback((session: GameSessionPublic, screen?: GameScreen) => {
    gameActiveSessionIdRef.current = session.id;
    setGameActiveSession(session);
    upsertGameSessionMine(session);
    emitGameSocketJoin(session.id, currentUserIdRef.current);
    if (session.chatId) setGameChatId(session.chatId);
    if (screen) {
      setGameScreen(screen);
      return;
    }
    if (session.status === 'lobby') setGameScreen('lobby');
    else if (session.status === 'active') setGameScreen('play');
    else if (session.status === 'finished') setGameScreen('finished');
    else setGameScreen('list');
  }, [emitGameSocketJoin, upsertGameSessionMine]);

  const beginGameInviteFlow = useCallback((slug: string, chatId?: string | null) => {
    const entry = gameCatalog.find((item) => item.slug === slug);
    if (!entry || entry.comingSoon) {
      showToast(entry?.comingSoon ? 'This game is coming soon.' : 'Game not found.');
      return;
    }
    setGameSelectedSlug(slug);
    setGameChatId(chatId || null);
    const preselect: string[] = [];
    if (chatId) {
      const chat = chatItems.find((item) => item.id === chatId);
      if (chat?.peerUserId && chat.peerUserId !== currentUserIdRef.current) {
        preselect.push(chat.peerUserId);
      }
    }
    setGameInviteSelectedIds(preselect);
    setGameScreen('invite');
    setActiveView('games');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatItems, gameCatalog]);

  const openPlayGameFromChat = useCallback(() => {
    if (!selectedChatId) {
      showToast('Open a chat first.');
      return;
    }
    setGameChatId(selectedChatId);
    setGameScreen('list');
    setGameSelectedSlug('');
    setGameInviteSelectedIds([]);
    setActiveView('games');
    showToast('Pick a game to play with this chat.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatId]);

  const createGameSession = async () => {
    if (!currentUserId || !gameSelectedSlug || gameBusy) return;
    const entry = gameCatalog.find((item) => item.slug === gameSelectedSlug);
    if (!entry || entry.comingSoon) {
      showToast('Pick a playable game.');
      return;
    }
    if (gameInviteSelectedIds.length + 1 > entry.maxPlayers) {
      showToast(`Max ${entry.maxPlayers} players for this game.`);
      return;
    }
    setGameBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/games/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          gameSlug: gameSelectedSlug,
          chatId: gameChatId || undefined,
          inviteUserIds: gameInviteSelectedIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.session) {
        showToast(payload.error || 'Could not create session.');
        return;
      }
      enterGameSession(payload.session as GameSessionPublic, 'lobby');
      showToast('Lobby ready — waiting for players.');
    } catch {
      showToast('Could not create session.');
    } finally {
      setGameBusy(false);
    }
  };

  const acceptGameInvite = async (sessionId: string) => {
    if (!currentUserId || !sessionId || gameBusy) return;
    setGameBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(sessionId)}/join`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.session) {
        showToast(payload.error || 'Could not join game.');
        return;
      }
      setGamePendingInvite(null);
      setActiveView('games');
      enterGameSession(payload.session as GameSessionPublic, 'lobby');
      showToast('Joined lobby.');
    } catch {
      showToast('Could not join game.');
    } finally {
      setGameBusy(false);
    }
  };

  const declineGameInvite = async (sessionId: string) => {
    if (!currentUserId || !sessionId) return;
    setGamePendingInvite(null);
    try {
      await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(sessionId)}/decline`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      showToast('Invite declined.');
      void refreshMyGameSessions(currentUserId);
    } catch {
      showToast('Could not decline invite.');
    }
  };

  const startGameSession = async () => {
    if (!currentUserId || !gameActiveSession || gameBusy) return;
    setGameBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(gameActiveSession.id)}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.session) {
        showToast(payload.error || 'Could not start game.');
        return;
      }
      enterGameSession(payload.session as GameSessionPublic, 'play');
    } catch {
      showToast('Could not start game.');
    } finally {
      setGameBusy(false);
    }
  };

  const submitGameAnswer = async (answerIndex: number) => {
    if (!currentUserId || !gameActiveSession || gameBusy) return;
    if (gameRoundPhase !== 'prompt' || gameMyAnswerIndex !== null) return;
    setGameMyAnswerIndex(answerIndex);
    setGameBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(gameActiveSession.id)}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            roundIndex: gameRoundMeta.roundIndex,
            answerIndex,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        showToast(payload.error || 'Answer rejected.');
        if (payload.session) {
          setGameActiveSession(payload.session as GameSessionPublic);
        }
        if (payload.error !== 'Already answered this round.') {
          setGameMyAnswerIndex(null);
        }
        return;
      }
      if (payload.session) {
        setGameActiveSession(payload.session as GameSessionPublic);
      }
    } catch {
      showToast('Could not submit answer.');
      setGameMyAnswerIndex(null);
    } finally {
      setGameBusy(false);
    }
  };

  const cancelGameSession = async () => {
    if (!currentUserId || !gameActiveSession || gameBusy) return;
    setGameBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(gameActiveSession.id)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        showToast(payload.error || 'Could not cancel.');
        return;
      }
      showToast('Session cancelled.');
      await exitGameUi({ leaveServer: false, skipSocketLeave: false });
    } catch {
      showToast('Could not cancel.');
    } finally {
      setGameBusy(false);
    }
  };

  const resumeGameSession = async (sessionId: string) => {
    if (!currentUserId || !sessionId || gameBusy) return;
    setGameBusy(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/games/sessions/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json();
      if (!response.ok || !payload.session) {
        showToast(payload.error || 'Could not resume session.');
        return;
      }
      const session = payload.session as GameSessionPublic;
      resetGamePlayState();
      enterGameSession(session);
      if (session.status === 'active') {
        const round = session.rounds[session.roundIndex];
        if (round) setGameCurrentRound(round);
        setGameRoundMeta({
          roundIndex: session.roundIndex,
          roundStartedAt: session.roundStartedAt || null,
          roundTimeoutMs: session.roundTimeoutMs || 30000,
        });
        setGameRoundPhase('prompt');
        const myAnswers = session.players.find((player) => player.userId === currentUserId)?.answers;
        const answered = myAnswers?.[String(session.roundIndex)];
        setGameMyAnswerIndex(typeof answered === 'number' ? answered : null);
      }
    } catch {
      showToast('Could not resume session.');
    } finally {
      setGameBusy(false);
    }
  };

  const gameInviteCandidates = useMemo(() => {
    const byId = new Map<string, AppUser>();
    users.forEach((user) => {
      if (user.id !== currentUserId) byId.set(user.id, user);
    });
    chatItems.forEach((chat) => {
      if (chat.peerUserId && chat.peerUserId !== currentUserId && !byId.has(chat.peerUserId)) {
        byId.set(chat.peerUserId, {
          id: chat.peerUserId,
          name: chat.name,
          avatar: chat.name.slice(0, 2).toUpperCase(),
          phone: '',
        });
      }
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [chatItems, currentUserId, users]);

  useEffect(() => {
    if (activeView === 'games' && currentUserId) {
      void loadGamesHome(currentUserId);
    }
  }, [activeView, currentUserId, loadGamesHome]);

  useEffect(() => {
    if (gameRoundPhase !== 'prompt' || !gameRoundMeta.roundStartedAt) {
      setGameRoundSecondsLeft(null);
      return undefined;
    }
    const started = Date.parse(gameRoundMeta.roundStartedAt);
    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((started + gameRoundMeta.roundTimeoutMs - Date.now()) / 1000),
      );
      setGameRoundSecondsLeft(left);
    };
    tick();
    const handle = window.setInterval(tick, 250);
    return () => window.clearInterval(handle);
  }, [gameRoundMeta.roundStartedAt, gameRoundMeta.roundTimeoutMs, gameRoundPhase]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !currentUserId) return undefined;

    const onGameInvite = (payload: GamePendingInvite) => {
      if (!payload?.sessionId || !payload?.session) return;
      if (payload.fromUserId && payload.fromUserId === currentUserIdRef.current) return;
      setGamePendingInvite(payload);
      const title = payload.title || payload.gameSlug || 'Game';
      const fromName = getUserMeta(payload.fromUserId).name;
      showToast(`${fromName} invited you to ${title}`, 4000);
    };

    const onGameSession = (payload: {
      session?: GameSessionPublic;
      action?: string;
      error?: string;
    }) => {
      const session = payload?.session;
      if (!session?.id) {
        if (payload?.action === 'join_rejected' && payload.error) {
          showToast(payload.error);
        }
        return;
      }
      if (payload?.action === 'join_rejected') {
        if (payload.error) showToast(payload.error);
        return;
      }
      upsertGameSessionMine(session);
      if (gameActiveSessionIdRef.current && session.id === gameActiveSessionIdRef.current) {
        setGameActiveSession(session);
        if (session.status === 'lobby') setGameScreen('lobby');
        if (session.status === 'active') {
          setGameScreen((current) => (current === 'finished' ? current : 'play'));
        }
        if (session.status === 'finished') setGameScreen('finished');
        if (session.status === 'cancelled') {
          showToast('Game cancelled.');
          void exitGameUi({ leaveServer: false, skipSocketLeave: false });
        }
      }
      void refreshMyGameSessions(currentUserIdRef.current);
    };

    const onGameRound = (payload: {
      sessionId?: string;
      roundIndex?: number;
      round?: GameRoundPublic | null;
      roundStartedAt?: string | null;
      roundTimeoutMs?: number;
      phase?: 'prompt' | 'result';
      session?: GameSessionPublic;
      picks?: Array<{ userId: string; answerIndex: number | null }>;
      players?: Array<{ userId: string; status: GamePlayerStatus; score: number }>;
    }) => {
      if (!payload?.sessionId) return;
      if (gameActiveSessionIdRef.current && payload.sessionId !== gameActiveSessionIdRef.current) {
        return;
      }
      if (!gameActiveSessionIdRef.current && payload.session) {
        enterGameSession(payload.session, 'play');
      }
      if (payload.session) setGameActiveSession(payload.session);
      setGameRoundMeta({
        roundIndex: payload.roundIndex ?? 0,
        roundStartedAt: payload.roundStartedAt || null,
        roundTimeoutMs: payload.roundTimeoutMs || 30000,
      });
      if (payload.phase === 'result') {
        setGameRoundPhase('result');
        setGameRoundResult({
          roundIndex: payload.roundIndex ?? 0,
          round: payload.round,
          picks: payload.picks || [],
          players: payload.players || [],
        });
        if (payload.round) setGameCurrentRound(payload.round);
        return;
      }
      setGameRoundPhase('prompt');
      setGameCurrentRound(payload.round || null);
      setGameRoundResult(null);
      setGameMyAnswerIndex(null);
      setGameScreen('play');
    };

    const onGameFinished = (payload: {
      sessionId?: string;
      session?: GameSessionPublic;
      results?: GameResultsSummary | null;
    }) => {
      if (!payload?.sessionId) return;
      if (gameActiveSessionIdRef.current && payload.sessionId !== gameActiveSessionIdRef.current) {
        void refreshMyGameSessions(currentUserIdRef.current);
        return;
      }
      if (payload.session) {
        setGameActiveSession(payload.session);
        upsertGameSessionMine(payload.session);
      }
      setGameScreen('finished');
      setGameRoundPhase(null);
      void refreshMyGameSessions(currentUserIdRef.current);
      void loadGamesLeaderboard(currentUserIdRef.current);
    };

    socket.on('game:invite', onGameInvite);
    socket.on('game:session', onGameSession);
    socket.on('game:round', onGameRound);
    socket.on('game:finished', onGameFinished);
    return () => {
      socket.off('game:invite', onGameInvite);
      socket.off('game:session', onGameSession);
      socket.off('game:round', onGameRound);
      socket.off('game:finished', onGameFinished);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentUserId,
    enterGameSession,
    exitGameUi,
    getUserMeta,
    loadGamesLeaderboard,
    refreshMyGameSessions,
    upsertGameSessionMine,
  ]);

  const renderGamesView = () => {
    const catalogEntry = gameCatalog.find((item) => item.slug === gameSelectedSlug)
      || gameCatalog.find((item) => item.slug === gameActiveSession?.gameSlug);
    const activePlayers = (gameActiveSession?.players || []).filter(
      (player) => player.status === 'joined' || player.status === 'finished',
    );
    const joinedCount = (gameActiveSession?.players || []).filter(
      (player) => player.status === 'joined',
    ).length;
    const isHost = gameActiveSession?.hostUserId === currentUserId;
    const resumable = gameSessionsMine.filter(
      (session) => session.status === 'lobby' || session.status === 'active',
    );

    const renderPlayerRow = (player: GamePlayerPublic) => {
      const meta = getUserMeta(player.userId);
      return (
        <div className="game-player-row" key={player.userId}>
          <strong>{meta.name}</strong>
          <span>{player.status}{typeof player.score === 'number' ? ` · ${player.score} pts` : ''}</span>
        </div>
      );
    };

    if (gameScreen === 'invite' && catalogEntry) {
      return (
        <>
          <section className="chat-sidebar community-sidebar games-sidebar">
            <header className="chat-sidebar-header">
              <h1>Invite</h1>
            </header>
            <div className="community-sidebar-scroll">
              <p className="muted">{catalogEntry.title} · pick friends ({catalogEntry.minPlayers}–{catalogEntry.maxPlayers})</p>
              {gameChatId ? <p className="game-chat-link">Sharing results to open chat</p> : null}
              <div className="game-invite-list">
                {gameInviteCandidates.map((user) => {
                  const checked = gameInviteSelectedIds.includes(user.id);
                  return (
                    <label className="game-invite-row community-checkbox" key={user.id}>
                      <input
                        checked={checked}
                        onChange={() => {
                          setGameInviteSelectedIds((current) => {
                            if (current.includes(user.id)) {
                              return current.filter((id) => id !== user.id);
                            }
                            if (current.length + 1 >= (catalogEntry.maxPlayers)) {
                              showToast(`Max ${catalogEntry.maxPlayers} players.`);
                              return current;
                            }
                            return [...current, user.id];
                          });
                        }}
                        type="checkbox"
                      />
                      <span>{user.name}</span>
                    </label>
                  );
                })}
                {!gameInviteCandidates.length ? <p className="muted">No contacts yet.</p> : null}
              </div>
              <div className="community-detail-actions game-actions-row">
                <button
                  disabled={gameBusy}
                  onClick={() => {
                    setGameScreen('list');
                    setGameSelectedSlug('');
                  }}
                  type="button"
                >
                  Back
                </button>
                <button
                  className="send-button"
                  disabled={gameBusy}
                  onClick={() => void createGameSession()}
                  type="button"
                >
                  Create lobby
                </button>
              </div>
            </div>
          </section>
          <main className="panel-shell community-detail-pane games-detail-pane">
            <header className="panel-header">
              <div>
                <h2>{catalogEntry.title}</h2>
                <p>{catalogEntry.description}</p>
              </div>
            </header>
            <p className="game-points-note">{gamePointsNote}</p>
          </main>
        </>
      );
    }

    if (gameScreen === 'lobby' && gameActiveSession) {
      return (
        <>
          <section className="chat-sidebar community-sidebar games-sidebar">
            <header className="chat-sidebar-header">
              <h1>Lobby</h1>
            </header>
            <div className="community-sidebar-scroll">
              <p className="muted">
                {catalogEntry?.title || gameActiveSession.gameSlug}
                {' · '}
                {joinedCount} joined
              </p>
              {(gameActiveSession.players || []).map(renderPlayerRow)}
              <div className="community-detail-actions game-actions-row">
                {isHost ? (
                  <>
                    <button
                      className="send-button"
                      disabled={gameBusy || joinedCount < (catalogEntry?.minPlayers ?? 2)}
                      onClick={() => void startGameSession()}
                      type="button"
                    >
                      Start
                    </button>
                    <button disabled={gameBusy} onClick={() => void cancelGameSession()} type="button">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    disabled={gameBusy}
                    onClick={() => void exitGameUi({ leaveServer: true })}
                    type="button"
                  >
                    Leave
                  </button>
                )}
                <button disabled={gameBusy} onClick={() => void exitGameUi({ leaveServer: false })} type="button">
                  Back to list
                </button>
              </div>
            </div>
          </section>
          <main className="panel-shell community-detail-pane games-detail-pane">
            <header className="panel-header">
              <div>
                <h2>Waiting in lobby</h2>
                <p>Host starts when enough players have joined. Points are cosmetic only.</p>
              </div>
            </header>
            <p className="game-points-note">{gamePointsNote}</p>
          </main>
        </>
      );
    }

    if (gameScreen === 'play' && gameActiveSession) {
      const round = gameCurrentRound
        || (gameActiveSession.rounds?.[gameActiveSession.roundIndex] as GameRoundPublic | null);
      return (
        <>
          <section className="chat-sidebar community-sidebar games-sidebar">
            <header className="chat-sidebar-header">
              <h1>Playing</h1>
            </header>
            <div className="community-sidebar-scroll">
              <p className="muted">
                Round {(gameRoundMeta.roundIndex ?? 0) + 1}
                {typeof gameRoundSecondsLeft === 'number' ? ` · ${gameRoundSecondsLeft}s` : ''}
              </p>
              {activePlayers.map(renderPlayerRow)}
              <button
                className="community-inline-btn"
                disabled={gameBusy}
                onClick={() => void exitGameUi({ leaveServer: true })}
                type="button"
              >
                Leave game
              </button>
            </div>
          </section>
          <main className="panel-shell community-detail-pane games-detail-pane">
            <header className="panel-header community-detail-header">
              <div>
                <h2>{catalogEntry?.title || gameActiveSession.gameSlug}</h2>
                <p>
                  {gameRoundPhase === 'result' ? 'Round result' : 'Choose an answer'}
                  {typeof gameRoundSecondsLeft === 'number' && gameRoundPhase === 'prompt'
                    ? ` · ${gameRoundSecondsLeft}s left`
                    : ''}
                </p>
              </div>
            </header>
            {round ? (
              <div className="game-round-panel">
                <h3>{round.prompt}</h3>
                <div className="game-options">
                  {round.options.map((option, index) => {
                    const selected = gameMyAnswerIndex === index;
                    const revealCorrect = gameRoundPhase === 'result'
                      && typeof round.correctAnswerIndex === 'number'
                      && round.correctAnswerIndex === index;
                    return (
                      <button
                        className={`game-option-btn ${selected ? 'selected' : ''} ${revealCorrect ? 'correct' : ''}`}
                        disabled={gameBusy || gameRoundPhase !== 'prompt' || gameMyAnswerIndex !== null}
                        key={`${round.index}-${index}`}
                        onClick={() => void submitGameAnswer(index)}
                        type="button"
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
                {gameMyAnswerIndex !== null && gameRoundPhase === 'prompt' ? (
                  <p className="muted">Answer locked — waiting for others…</p>
                ) : null}
                {gameRoundPhase === 'result' && gameRoundResult ? (
                  <div className="game-round-result">
                    <h4>Picks</h4>
                    {gameRoundResult.picks.map((pick) => (
                      <p key={pick.userId}>
                        {getUserMeta(pick.userId).name}
                        {': '}
                        {pick.answerIndex === null
                          ? '—'
                          : (gameRoundResult.round?.options?.[pick.answerIndex] ?? `#${pick.answerIndex}`)}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">Waiting for round…</p>
            )}
          </main>
        </>
      );
    }

    if (gameScreen === 'finished' && gameActiveSession) {
      const results = gameActiveSession.results;
      return (
        <>
          <section className="chat-sidebar community-sidebar games-sidebar">
            <header className="chat-sidebar-header">
              <h1>Results</h1>
            </header>
            <div className="community-sidebar-scroll">
              {(results?.scores || activePlayers.map((player) => ({
                userId: player.userId,
                score: player.score,
              }))).map((row) => (
                <div className="game-player-row" key={row.userId}>
                  <strong>{getUserMeta(row.userId).name}</strong>
                  <span>{row.score} pts</span>
                </div>
              ))}
              <button
                className="send-button community-inline-btn"
                onClick={() => void exitGameUi({ leaveServer: false })}
                type="button"
              >
                Back to games
              </button>
            </div>
          </section>
          <main className="panel-shell community-detail-pane games-detail-pane">
            <header className="panel-header">
              <div>
                <h2>Game finished</h2>
                <p>
                  {results?.winnerUserIds?.length
                    ? results.winnerUserIds.length > 1
                      ? `Tie: ${results.winnerUserIds.map((id) => getUserMeta(id).name).join(', ')}`
                      : `Winner: ${getUserMeta(results.winnerUserIds[0]).name}`
                    : 'Thanks for playing'}
                  {typeof results?.agreementPercent === 'number'
                    ? ` · ${results.agreementPercent}% agreement`
                    : ''}
                </p>
              </div>
            </header>
            {results?.funSummary ? <p>{results.funSummary}</p> : null}
            <p className="game-points-note">{results?.pointsNote || gamePointsNote}</p>
            {gameActiveSession.chatId ? (
              <p className="muted">A summary was shared to the linked chat when available.</p>
            ) : null}
          </main>
        </>
      );
    }

    return (
      <>
        <section className="chat-sidebar community-sidebar games-sidebar">
          <header className="chat-sidebar-header">
            <h1>Games</h1>
          </header>
          <div className="community-sidebar-scroll">
            {gameChatId ? (
              <p className="game-chat-link">Playing from chat — results can post there.</p>
            ) : null}
            <div className="community-section">
              <h3>Active / resume</h3>
              {resumable.length ? resumable.map((session) => {
                const title = gameCatalog.find((item) => item.slug === session.gameSlug)?.title
                  || session.gameSlug;
                return (
                  <button
                    className="community-list-item"
                    key={session.id}
                    onClick={() => void resumeGameSession(session.id)}
                    type="button"
                  >
                    <div className="community-list-avatar">🎮</div>
                    <div className="community-list-copy">
                      <strong>{title}</strong>
                      <span>{session.status} · {(session.players || []).length} players</span>
                    </div>
                  </button>
                );
              }) : <p className="muted">No active sessions.</p>}
            </div>
            <div className="community-section">
              <h3>Catalog</h3>
              {gameCatalog.map((entry) => (
                <button
                  className={`community-list-item ${entry.comingSoon ? 'game-coming-soon' : ''}`}
                  disabled={entry.comingSoon || gameBusy}
                  key={entry.id}
                  onClick={() => beginGameInviteFlow(entry.slug, gameChatId)}
                  type="button"
                >
                  <div className="community-list-avatar">🎮</div>
                  <div className="community-list-copy">
                    <strong>{entry.title}</strong>
                    <span>
                      {entry.comingSoon ? 'Coming soon' : `${entry.minPlayers}–${entry.maxPlayers} players`}
                      {' · '}
                      {entry.description}
                    </span>
                  </div>
                </button>
              ))}
              {!gameCatalog.length ? <p className="muted">Loading catalog…</p> : null}
            </div>
          </div>
        </section>
        <main className="panel-shell community-detail-pane games-detail-pane">
          <header className="panel-header">
            <div>
              <h2>Games</h2>
              <p>Play Quiz Battle or Would You Rather with friends. Fun points only — never cash.</p>
            </div>
          </header>
          <p className="game-points-note">{gamePointsNote}</p>
          <section className="game-leaderboard">
            <h3>Leaderboard</h3>
            <p className="muted">Cosmetic ranks — not redeemable, not gambling.</p>
            {gameLeaderboardMine ? (
              <p className="game-leaderboard-mine">
                You: {gameLeaderboardMine.points} pts · {gameLeaderboardMine.wins} wins · {gameLeaderboardMine.gamesPlayed} played
              </p>
            ) : null}
            <ol className="game-leaderboard-list">
              {gameLeaderboard.slice(0, 10).map((row) => (
                <li key={row.userId}>
                  <span>#{row.rank} {row.name || getUserMeta(row.userId).name}</span>
                  <span>{row.points} pts</span>
                </li>
              ))}
            </ol>
            {!gameLeaderboard.length ? <p className="muted">No scores yet — play a round!</p> : null}
          </section>
        </main>
      </>
    );
  };

  const renderVoiceRoomsView = () => {
    const room = activeVoiceRoom;
    const myPart = voiceParticipants.find(
      (item) => item.userId === currentUserId && item.state === 'active',
    );
    const myRole = myPart?.role ?? room?.myRole ?? null;
    const canModerate = voiceRoleAtLeast(myRole, 'moderator');
    const isHost = myRole === 'host';
    const canPublish = isVoicePublisherRole(myRole);
    const speakers = voiceParticipants.filter(
      (item) => item.state === 'active' && isVoicePublisherRole(item.role),
    );
    const listeners = voiceParticipants.filter(
      (item) => item.state === 'active' && item.role === 'listener',
    );

    const renderRoomCard = (item: VoiceRoomPreview) => (
      <button
        className={`community-list-item ${room?.id === item.id ? 'active' : ''}`}
        key={item.id}
        onClick={() => void joinVoiceRoom(item.id)}
        type="button"
      >
        <div className="community-list-avatar">🎙</div>
        <div className="community-list-copy">
          <strong>{item.title}</strong>
          <span>
            {item.privacy}
            {item.myRole ? ` · ${item.myRole}` : ''}
            {` · ${item.capacitySpeakers} speakers max`}
          </span>
        </div>
      </button>
    );

    return (
      <>
        <section className="chat-sidebar community-sidebar voice-sidebar">
          <header className="chat-sidebar-header">
            <h1>Voice rooms</h1>
          </header>

          <div className="community-invite-accept">
            <input
              onChange={(event) => setVoiceInviteTokenDraft(event.target.value)}
              placeholder="Invite token"
              value={voiceInviteTokenDraft}
            />
            <button
              className="send-button community-inline-btn"
              disabled={voiceBusy}
              onClick={() => void acceptVoiceInvite()}
              type="button"
            >
              Accept
            </button>
          </div>

          <div className="community-sidebar-scroll">
            <div className="community-section">
              <h3>Mine / live with you</h3>
              {voiceRoomsMine.length
                ? voiceRoomsMine.map(renderRoomCard)
                : <p className="muted">No rooms yet.</p>}
            </div>

            <div className="community-section">
              <h3>Live public</h3>
              {voiceRoomsLivePublic.length
                ? voiceRoomsLivePublic.map(renderRoomCard)
                : <p className="muted">No public rooms live.</p>}
            </div>

            <div className="community-section community-create-form">
              <h3>Create</h3>
              <label>
                <span>Title</span>
                <input
                  onChange={(event) => setVoiceCreateForm((current) => ({ ...current, title: event.target.value }))}
                  value={voiceCreateForm.title}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  onChange={(event) => setVoiceCreateForm((current) => ({ ...current, description: event.target.value }))}
                  value={voiceCreateForm.description}
                />
              </label>
              <label>
                <span>Rules</span>
                <textarea
                  onChange={(event) => setVoiceCreateForm((current) => ({ ...current, rules: event.target.value }))}
                  value={voiceCreateForm.rules}
                />
              </label>
              <label>
                <span>Privacy</span>
                <select
                  onChange={(event) => setVoiceCreateForm((current) => ({
                    ...current,
                    privacy: event.target.value as VoiceRoomPrivacy,
                  }))}
                  value={voiceCreateForm.privacy}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="invite-only">Invite only</option>
                </select>
              </label>
              <button className="send-button" disabled={voiceBusy} onClick={() => void createVoiceRoom()} type="button">
                Go live
              </button>
            </div>
          </div>
        </section>

        <main className="panel-shell community-detail-pane voice-detail-pane">
          {!room ? (
            <header className="panel-header">
              <div>
                <h2>Voice rooms</h2>
                <p>Join a live room or create one. Speakers mesh (≤8); listeners receive only.</p>
              </div>
            </header>
          ) : (
            <>
              {voiceReconnecting ? (
                <div className="voice-reconnecting-banner">Reconnecting…</div>
              ) : null}
              <header className="panel-header community-detail-header">
                <div>
                  <h2>{room.title}</h2>
                  <p>
                    {room.privacy}
                    {myRole ? ` · ${myRole}` : ''}
                    {` · ${speakers.length}/${room.capacitySpeakers} speakers`}
                    {` · ${listeners.length} listeners`}
                    {' · recording off'}
                  </p>
                </div>
                <div className="community-detail-actions voice-room-actions">
                  {canPublish ? (
                    <button
                      disabled={Boolean(myPart?.forceMuted && myPart.muted)}
                      onClick={() => void toggleVoiceMic()}
                      type="button"
                    >
                      {myPart?.muted || voiceMicMuted ? 'Unmute mic' : 'Mute mic'}
                    </button>
                  ) : null}
                  {myRole === 'listener' ? (
                    myPart?.handRaised ? (
                      <button disabled={voiceBusy} onClick={() => void lowerVoiceHand()} type="button">
                        Lower hand
                      </button>
                    ) : (
                      <button disabled={voiceBusy} onClick={() => void raiseVoiceHand()} type="button">
                        Raise hand
                      </button>
                    )
                  ) : null}
                  <button disabled={voiceBusy} onClick={() => void leaveVoiceRoom()} type="button">
                    Leave
                  </button>
                  {isHost ? (
                    <button disabled={voiceBusy} onClick={() => void endVoiceRoom()} type="button">
                      End room
                    </button>
                  ) : null}
                  {canModerate ? (
                    <button disabled={voiceBusy} onClick={() => void createVoiceInvite()} type="button">
                      Invite
                    </button>
                  ) : null}
                </div>
              </header>

              {voiceCreatedInviteToken ? (
                <p className="community-token">
                  Invite token: <code>{voiceCreatedInviteToken}</code>
                </p>
              ) : null}
              {room.description ? <p className="muted">{room.description}</p> : null}
              {room.rules ? <p className="community-rules">{room.rules}</p> : null}

              <div className="community-block">
                <h3>Speakers</h3>
                <div className="community-rooms-list">
                  {speakers.length ? speakers.map((participant) => {
                    const label = participant.name || getUserMeta(participant.userId).name;
                    const isSelf = participant.userId === currentUserId;
                    return (
                      <div className="community-member-row voice-participant-row" key={participant.id}>
                        <div>
                          <strong>{label}{isSelf ? ' (you)' : ''}</strong>
                          <small>
                            {participant.role}
                            {participant.muted ? ' · muted' : ''}
                            {participant.forceMuted ? ' · force muted' : ''}
                            {participant.handRaised ? ' · hand' : ''}
                          </small>
                        </div>
                        {canModerate && !isSelf ? (
                          <div className="community-member-actions">
                            <button onClick={() => void muteVoiceParticipant(participant.userId, !participant.muted)} type="button">
                              {participant.muted ? 'Unmute' : 'Mute'}
                            </button>
                            {participant.role !== 'host' ? (
                              <button onClick={() => void demoteVoiceSpeaker(participant.userId)} type="button">
                                Demote
                              </button>
                            ) : null}
                            {isHost && participant.role !== 'host' && participant.role !== 'moderator' ? (
                              <button onClick={() => void promoteVoiceModerator(participant.userId)} type="button">
                                Make mod
                              </button>
                            ) : null}
                            {participant.role !== 'host' ? (
                              <button onClick={() => void removeVoiceParticipant(participant.userId)} type="button">
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <p className="muted">No speakers yet.</p>}
                </div>
              </div>

              <div className="community-block">
                <h3>Listeners</h3>
                <div className="community-rooms-list">
                  {listeners.length ? listeners.map((participant) => {
                    const label = participant.name || getUserMeta(participant.userId).name;
                    const isSelf = participant.userId === currentUserId;
                    return (
                      <div className="community-member-row voice-participant-row" key={participant.id}>
                        <div>
                          <strong>{label}{isSelf ? ' (you)' : ''}</strong>
                          <small>
                            listener
                            {participant.handRaised ? ' · hand raised' : ''}
                            {participant.muted ? ' · muted' : ''}
                          </small>
                        </div>
                        {canModerate && !isSelf ? (
                          <div className="community-member-actions">
                            {participant.handRaised ? (
                              <>
                                <button onClick={() => void approveVoiceSpeaker(participant.userId)} type="button">
                                  Approve
                                </button>
                                <button onClick={() => void rejectVoiceHand(participant.userId)} type="button">
                                  Reject
                                </button>
                              </>
                            ) : (
                              <button onClick={() => void approveVoiceSpeaker(participant.userId)} type="button">
                                Promote
                              </button>
                            )}
                            {isHost ? (
                              <button onClick={() => void promoteVoiceModerator(participant.userId)} type="button">
                                Make mod
                              </button>
                            ) : null}
                            <button onClick={() => void removeVoiceParticipant(participant.userId)} type="button">
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <p className="muted">No listeners.</p>}
                </div>
              </div>
            </>
          )}
        </main>
      </>
    );
  };

  const createDirectChat = async (peerUserId: string, seedMessage?: string) => {
    const response = await fetch(`${API_BASE_URL}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, peerUserId }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const mappedChat = mapChatFromServer(payload.chat, currentUserId, users);
    setChatItems((current) => (current.some((item) => item.id === mappedChat.id) ? current : [mappedChat, ...current]));
    setSelectedChatId(mappedChat.id);
    setNewChatVisible(false);
    setActiveView('chats');
    if (seedMessage) {
      setMessageDraft(seedMessage);
    }
  };

  const renderChatsView = () => (
    <>
      <section className="chat-sidebar">
        <header className="chat-sidebar-header">
          <h1>Chats</h1>
          <div className="sidebar-header-actions">
            <button className="compose-square" onClick={() => void fetchLinkedDevices(currentUserId)} type="button">🖥</button>
            <button className="compose-square" onClick={() => setNewChatVisible(true)} type="button">✎</button>
          </div>
        </header>

        <div className="search-box desktop-search">
          <input
            aria-label="Search chats"
            onChange={(event) => setChatSearchQuery(event.target.value)}
            placeholder="Search"
            value={chatSearchQuery}
          />
        </div>

        {archivedChatIds.length ? (
          <button className="archive-toggle" onClick={() => setShowArchivedChats((current) => !current)} type="button">
            {showArchivedChats ? 'Back to chats' : `Archived (${archivedChatIds.length})`}
          </button>
        ) : null}

        <div className="chat-list desktop-chat-list">
          {visibleChatItems.map((chat) => (
            <button
              className={`chat-list-item desktop-chat-item ${chat.id === activeChat?.id ? 'active' : ''}`}
              key={chat.id}
              onClick={() => setSelectedChatId(chat.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                const action = window.prompt(
                  `${chat.name}\n1 Pin/Unpin\n2 Mute/Unmute\n3 Archive/Unarchive`,
                  '1',
                );
                if (action === '1') {
                  toggleFavoriteChat(chat.id);
                } else if (action === '2') {
                  toggleMuteChat(chat.id);
                } else if (action === '3') {
                  toggleArchiveChat(chat.id);
                }
              }}
              type="button"
            >
              <div className="avatar desktop-avatar">{chat.name.slice(0, 2).toUpperCase()}</div>
              <div className="chat-copy">
                <div className="chat-topline">
                  <strong>
                    {favoriteChatIds.includes(chat.id) ? '★ ' : ''}
                    {chat.name}
                    {mutedChatIds.includes(chat.id) ? ' 🔕' : ''}
                  </strong>
                  <span>{chat.time}</span>
                </div>
                <div className="chat-bottomline">
                  <span>{peerTypingByChat[chat.id] ? 'typing…' : chat.preview}</span>
                  {chat.unread > 0 ? <em>{chat.unread}</em> : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <main className="desktop-chatboard">
        {activeChat ? (
          <>
        <header className="desktop-chat-header">
          <div className="desktop-chat-title">
            <div className="avatar desktop-avatar">{activeChat.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{activeChat.name}</strong>
              <small>{getPresenceLabel(activeChat)}</small>
            </div>
          </div>
          <div className="desktop-chat-actions">
            <button
              className={`summarise-header-button ${aiHelperVisible ? 'active-header-action' : ''}`}
              disabled={!currentUserId}
              onClick={() => setAiHelperVisible((current) => !current)}
              title="AI helper"
              type="button"
            >
              AI helper
            </button>
            <button
              className={`summarise-header-button ${summaryVisible ? 'active-header-action' : ''}`}
              disabled={!currentUserId || summaryBusy}
              onClick={() => {
                if (summaryVisible) {
                  setSummaryVisible(false);
                  return;
                }
                void requestChatSummary(summaryScope);
              }}
              title="Summarise chat"
              type="button"
            >
              Summarise
            </button>
            <button
              className="summarise-header-button"
              disabled={!currentUserId}
              onClick={() => openPlayGameFromChat()}
              title="Play a game"
              type="button"
            >
              Play a game
            </button>
            <button
              onClick={() => {
                const action = window.prompt('1 Mute  2 Archive  3 Pin  4 Play a game', '1');
                if (action === '1') {
                  toggleMuteChat(activeChat.id);
                } else if (action === '2') {
                  toggleArchiveChat(activeChat.id);
                } else if (action === '3') {
                  toggleFavoriteChat(activeChat.id);
                } else if (action === '4') {
                  openPlayGameFromChat();
                }
              }}
              type="button"
            >
              ⋮
            </button>
            <button onClick={() => setActiveView('catalog')} type="button">🏬</button>
            <button onClick={() => setCallSheetVisible(true)} type="button">☎</button>
          </div>
        </header>

        {aiHelperVisible ? (
          <aside className="ai-helper-panel" aria-label="AI helper">
            <div className="ai-helper-toolbar">
              <strong>AI helper</strong>
              <button onClick={() => setAiHelperVisible(false)} type="button">
                Close
              </button>
            </div>
            <p className="ai-helper-disclaimer" role="note">
              Drafts only — never auto-sent. Review before sending.
            </p>
            <div className="ai-helper-tasks">
              {AI_ASSISTANT_TASKS.map((entry) => (
                <button
                  className={aiHelperTask === entry.id ? 'active' : ''}
                  key={entry.id}
                  onClick={() => setAiHelperTask(entry.id)}
                  type="button"
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <label className="ai-tone-select">
              <span>Tone</span>
              <select
                aria-label="Assistant tone"
                onChange={(event) => setAiTone(event.target.value as AiTone)}
                value={aiTone}
              >
                {AI_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tone}
                  </option>
                ))}
              </select>
            </label>
            {(aiHelperTask === 'translate') ? (
              <label className="ai-tone-select">
                <span>Language</span>
                <select
                  aria-label="Translate target language"
                  onChange={(event) => setTranslateTargetLanguage(event.target.value as TranslateLanguage)}
                  value={translateTargetLanguage}
                >
                  {TRANSLATE_LANGUAGES.map((language) => (
                    <option key={language.id} value={language.id}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <textarea
              onChange={(event) => setAiHelperPrompt(event.target.value)}
              placeholder={
                aiHelperTask === 'draft'
                  ? 'Describe what to draft…'
                  : aiHelperTask === 'rewrite' || aiHelperTask === 'translate' || aiHelperTask === 'explain'
                    ? 'Optional override text (defaults to composer draft)'
                    : 'Optional prompt / focus for this chat task'
              }
              rows={2}
              value={aiHelperPrompt}
            />
            <label className="ai-consent-row">
              <input
                checked={aiConsentToShareContext}
                onChange={(event) => setAiConsentToShareContext(event.target.checked)}
                type="checkbox"
              />
              <span>I consent to share this chat context with the assistant</span>
            </label>
            <div className="ai-helper-actions">
              <button
                disabled={aiBusy || !currentUserId}
                onClick={() =>
                  void runAssistantTask(aiHelperTask, {
                    prompt: aiHelperPrompt,
                    text:
                      aiHelperTask === 'rewrite' ||
                      aiHelperTask === 'translate' ||
                      aiHelperTask === 'explain'
                        ? aiHelperPrompt.trim() || messageDraft
                        : aiHelperPrompt,
                  })
                }
                type="button"
              >
                {aiBusy ? 'Working…' : 'Run'}
              </button>
              {aiHelperResult ? (
                <button
                  onClick={() => {
                    setMessageDraft(aiHelperResult);
                    showToast('Filled draft — review before sending', 3000);
                  }}
                  type="button"
                >
                  Use as draft
                </button>
              ) : null}
            </div>
            {aiHelperNotice ? (
              <p className="ai-helper-notice" role="status">
                {aiHelperNotice}
              </p>
            ) : null}
            {aiHelperResult ? <p className="ai-helper-result">{aiHelperResult}</p> : null}
          </aside>
        ) : null}

        {summaryVisible ? (
          <aside className="chat-summary-panel" aria-label="Chat summary">
            <div className="chat-summary-toolbar">
              <div className="chat-summary-scopes">
                <button
                  className={summaryScope === 'unread' ? 'active' : ''}
                  disabled={summaryBusy || !currentUserId}
                  onClick={() => void requestChatSummary('unread')}
                  type="button"
                >
                  Unread
                </button>
                <button
                  className={summaryScope === 'recent' ? 'active' : ''}
                  disabled={summaryBusy || !currentUserId}
                  onClick={() => void requestChatSummary('recent')}
                  type="button"
                >
                  Recent
                </button>
              </div>
              <button onClick={() => setSummaryVisible(false)} type="button">
                Close
              </button>
            </div>
            {summaryBusy && !chatSummary ? <p className="chat-summary-status">Summarising…</p> : null}
            {chatSummary ? (
              <>
                <p className="chat-summary-overview">{chatSummary.overview}</p>
                {summaryNotice || chatSummary.notice ? (
                  <p className="chat-summary-notice" role="note">
                    {summaryNotice || chatSummary.notice}
                  </p>
                ) : null}
                {renderSummarySection('Questions', chatSummary.questions)}
                {renderSummarySection('Decisions', chatSummary.decisions)}
                {renderSummarySection('Action suggestions', chatSummary.actionSuggestions)}
                {renderSummarySection('Highlights', chatSummary.highlights)}
              </>
            ) : null}
          </aside>
        ) : null}

        <section className="desktop-canvas">
          {messages.map((message) => (
            message.kind === 'call' ? (
              <button
                className={`call-thread ${describeCallMessage(message).alert ? 'missed' : ''}`}
                id={`message-${message.id}`}
                key={message.id}
                onClick={() => void startCall(message.callKind === 'video' ? 'video' : 'audio', activeChat.peerUserId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (window.confirm('Delete this call from the chat?')) {
                    void deleteMessage(message, 'me');
                  }
                }}
                type="button"
              >
                <strong>{describeCallMessage(message).arrow} {describeCallMessage(message).label}</strong>
                <small>{message.time} · Call again · right-click to delete</small>
              </button>
            ) : (
            <article
              className={`message-bubble ${message.sender === 'me' ? 'mine' : 'theirs'} ${message.deletedForEveryone ? 'deleted' : ''} ${message.automated ? 'automated' : ''} ${message.anonymous ? 'anonymous' : ''} ${focusedMessageId === message.id ? 'summary-focus' : ''}`}
              id={`message-${message.id}`}
              key={message.id}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!message.deletedForEveryone) {
                  setMessageActionTarget(message);
                }
              }}
            >
              {message.anonymous ? (
                <span className="anonymous-badge">
                  {message.sender === 'me' ? 'Anonymous' : 'Anonymous Member'}
                </span>
              ) : null}
              {message.automated ? <span className="automated-badge">Automated reply</span> : null}
              {message.documentId ? (
                <span className="document-badge">
                  {message.documentKind === 'invoice' ? 'Invoice' : message.documentKind === 'quotation' ? 'Quotation' : 'Document'}
                </span>
              ) : null}
              {message.replyPreview ? <div className="reply-quote">{message.replyPreview}</div> : null}
              {message.kind === 'image' && message.imageUrl ? (
                <button className="message-image-button" onClick={() => setMediaViewer(message.imageUrl ?? null)} type="button">
                  <img alt={message.text} className="message-image" src={message.imageUrl} />
                </button>
              ) : null}

              {message.kind === 'voice' ? (
                <div className="voice-note">
                  {message.audioUrl ? <audio controls src={message.audioUrl} /> : <span>Voice note {message.durationLabel}</span>}
                  {!message.deletedForEveryone ? (
                    <div className="message-ai-row">
                      <button
                        className="message-ai-button"
                        disabled={!currentUserId || transcribingMessageId === message.id}
                        onClick={() => void requestTranscribe(message)}
                        type="button"
                      >
                        {transcribingMessageId === message.id
                          ? 'Transcribing…'
                          : message.transcript || message.transcriptStatus === 'ready'
                            ? 'Re-transcribe'
                            : 'Transcribe'}
                      </button>
                    </div>
                  ) : null}
                  {message.transcript ? (
                    <p className="voice-transcript">{message.transcript}</p>
                  ) : null}
                  {message.transcriptStatus && message.transcriptStatus !== 'ready' ? (
                    <small className="message-ai-notice">
                      {message.transcriptStatus === 'pending'
                        ? 'Transcript pending…'
                        : message.transcriptStatus === 'failed'
                          ? 'Transcription failed.'
                          : 'Transcript unavailable.'}
                    </small>
                  ) : null}
                  {message.transcriptNotice ? (
                    <small className="message-ai-notice" role="note">{message.transcriptNotice}</small>
                  ) : null}
                </div>
              ) : null}

              {message.kind !== 'voice' ? <p>{message.text}</p> : null}
              {!message.deletedForEveryone
              && message.kind !== 'voice'
              && (message.text || '').trim() ? (
                <div className="message-ai-row">
                  <button
                    className="message-ai-button"
                    disabled={!currentUserId || translatingMessageId === message.id}
                    onClick={() => {
                      setTranslatePickerMessageId(message.id);
                      void requestTranslate(
                        message,
                        translationsByMessageId[message.id]?.targetLanguage || translateTargetLanguage,
                      );
                    }}
                    type="button"
                  >
                    {translatingMessageId === message.id ? 'Translating…' : 'Translate'}
                  </button>
                  {translatePickerMessageId === message.id || translationsByMessageId[message.id] ? (
                    <label className="translate-lang-select">
                      <select
                        aria-label="Target language"
                        onChange={(event) => {
                          const nextLanguage = event.target.value as TranslateLanguage;
                          setTranslateTargetLanguage(nextLanguage);
                          void requestTranslate(message, nextLanguage);
                        }}
                        value={
                          translationsByMessageId[message.id]?.targetLanguage || translateTargetLanguage
                        }
                      >
                        {TRANSLATE_LANGUAGES.map((language) => (
                          <option key={language.id} value={language.id}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {(() => {
                const translation = translationsByMessageId[message.id];
                if (!translation) return null;
                return (
                  <div className="message-translation">
                    <p>{translation.translatedText}</p>
                    {(translation.notice || translation.partial || translation.needsProvider) ? (
                      <small className="message-ai-notice" role="note">
                        {translation.notice
                          || (translation.needsProvider
                            ? 'Full translation needs a provider.'
                            : 'Partial translation. Review before relying on it.')}
                      </small>
                    ) : null}
                  </div>
                );
              })()}
              {(() => {
                const warning = scamWarningsByKey[`${activeChat.id}:${message.id}`];
                if (!warning) return null;
                return (
                  <div className={`scam-warning severity-${warning.severity}`} role="alert">
                    <strong>Scam warning</strong>
                    <span>{warning.advice || 'Be careful with this message.'}</span>
                    {(warning.signals || []).length ? (
                      <small>{warning.signals.map((signal) => signal.label).join(' · ')}</small>
                    ) : null}
                  </div>
                );
              })()}
              <div className="message-meta">
                <span>{message.time}</span>
                {appSettings.readReceiptsEnabled ? renderReceipt(message) : null}
              </div>
              {message.anonymous
              && !message.deletedForEveryone
              && canRevealAnonymousAuthor(activeChat) ? (
                <button
                  className="reveal-author-button"
                  disabled={anonymousRevealBusy}
                  onClick={() => void revealAnonymousAuthor(message)}
                  type="button"
                >
                  Reveal author
                </button>
              ) : null}
            </article>
            )
          ))}
        </section>

        {replyTarget ? (
          <div className="reply-composer-bar">
            <div>
              <strong>Replying</strong>
              <span>{replyTarget.text}</span>
            </div>
            <button onClick={() => setReplyTarget(null)} type="button">✕</button>
          </div>
        ) : null}

        {canComposeAnonymous ? (
          <div className="anonymous-composer-bar">
            <button
              className={`anonymous-toggle ${anonymousCompose ? 'on' : ''}`}
              onClick={() => requestAnonymousCompose(!anonymousCompose)}
              type="button"
            >
              {anonymousCompose
                ? anonymousRemaining !== null
                  ? `Anonymous on · ${anonymousRemaining} left today`
                  : 'Anonymous on'
                : 'Send as anonymous'}
            </button>
            {anonymousCompose ? (
              <small>Name hidden from members · moderators may reveal for abuse</small>
            ) : null}
          </div>
        ) : null}

        <div className="ai-composer-bar">
          <button
            className={aiHelperVisible ? 'active' : ''}
            disabled={!currentUserId}
            onClick={() => setAiHelperVisible((current) => !current)}
            type="button"
          >
            AI helper
          </button>
          <button
            disabled={aiTwinBusy || !currentUserId}
            onClick={() => void runAiTwin()}
            title={
              aiTwinConfig && !aiTwinConfig.enabled
                ? 'AI Twin is paused — enable in Business tools'
                : 'Run Twin (drafts only, never auto-send)'
            }
            type="button"
          >
            {aiTwinBusy ? 'Twin…' : 'Run Twin'}
          </button>
          <button
            disabled={aiBusy || !currentUserId}
            onClick={() => void requestSuggestedReplies()}
            type="button"
          >
            Suggest reply
          </button>
          <label className="ai-tone-select">
            <span>Tone</span>
            <select
              aria-label="Rewrite tone"
              onChange={(event) => setAiTone(event.target.value as AiTone)}
              value={aiTone}
            >
              {AI_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={aiBusy || !messageDraft.trim() || !currentUserId}
            onClick={() => void requestRewrite()}
            type="button"
          >
            Rewrite
          </button>
          <button
            disabled={aiBusy || !messageDraft.trim() || !currentUserId}
            onClick={() => void runAssistantTask('translate', { text: messageDraft })}
            type="button"
          >
            Translate draft
          </button>
        </div>

        {aiSuggestionChips.length ? (
          <div className="ai-suggestion-chips" aria-label="AI draft suggestions">
            {aiSuggestionChips.map((chip) => (
              <button
                key={chip.id}
                className="ai-chip"
                onClick={() => {
                  setMessageDraft(chip.text);
                }}
                title={chip.reason || chip.tone || 'Fill draft'}
                type="button"
              >
                {chip.text}
              </button>
            ))}
          </div>
        ) : null}

        <footer className="composer desktop-composer">
          <textarea
            aria-label="Message composer"
            onChange={(event) => {
              setMessageDraft(event.target.value);
              setDictationNotice('');
              emitTyping(true);
              if (typingTimeoutRef.current) {
                window.clearTimeout(typingTimeoutRef.current);
              }
              typingTimeoutRef.current = window.setTimeout(() => emitTyping(false), 1200);
            }}
            onKeyDown={(event) => {
              if (appSettings.enterIsSend && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type a message"
            rows={1}
            className="desktop-message-input"
            value={messageDraft}
          />
          {renderComposerControls()}
          <input
            accept="image/*,video/*,.pdf,.doc,.docx"
            className="hidden-input"
            onChange={onAttachmentSelected}
            ref={attachmentInputRef}
            type="file"
          />
        </footer>
        {!speechRecognitionSupported ? (
          <p className="dictation-notice muted">Dictation unavailable in this browser</p>
        ) : dictationNotice ? (
          <p className="dictation-notice" role="status">{dictationNotice}</p>
        ) : null}

        <div className="emoji-quick-row">
          {emojiChoices.map((emoji) => (
            <button key={emoji} className="emoji-chip" onClick={() => insertEmoji(emoji)} type="button">
              {emoji}
            </button>
          ))}
        </div>
          </>
        ) : (
          <section className="empty-chat-state">
            <h3>No chats yet</h3>
            <p>Start a new conversation with one of your synced mobile contacts.</p>
            <button className="send-button secondary-button" onClick={() => setNewChatVisible(true)} type="button">
              New Conversation
            </button>
          </section>
        )}
      </main>
    </>
  );

  const renderCallsView = () => (
    <main className="panel-shell">
      <header className="panel-header">
        <div>
          <h2>Calls</h2>
          <p>Recent audio and video calls synced from your account.</p>
        </div>
      </header>
      <section className="calls-list">
        {calls.length ? calls.map((call) => {
          const unanswered = call.state === 'missed' || call.state === 'declined';
          const directionLabel = call.direction === 'outgoing'
            ? 'Outgoing'
            : call.state === 'declined'
              ? 'Declined'
              : call.state === 'missed'
                ? 'Missed'
                : 'Incoming';
          return (
          <article className={`call-history-row ${unanswered ? 'missed' : ''}`} key={call.id}>
            <div>
              <strong>{call.peerName}</strong>
              <small>
                {directionLabel}
                {' · '}
                {call.kind === 'video' ? 'Video' : 'Voice'}
                {' · '}
                {formatClock(call.startedAt)}
              </small>
            </div>
            <button
              onClick={() => void startCall(call.kind, call.peerUserId)}
              type="button"
            >
              {call.kind === 'video' ? 'Video call' : 'Voice call'}
            </button>
            <button
              onClick={() => {
                setCalls((current) => current.filter((item) => item.id !== call.id));
                void fetch(`${API_BASE_URL}/api/calls/${encodeURIComponent(call.id)}`, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: currentUserId }),
                });
              }}
              type="button"
            >
              Delete
            </button>
          </article>
          );
        }) : <p>No calls yet. Start one from a chat header.</p>}
      </section>
    </main>
  );

  const renderCatalogView = () => (
    <main className="panel-shell">
      <header className="panel-header">
        <div>
          <h2>Catalog</h2>
          <p>Discover items from sellers using the app.</p>
        </div>
      </header>

      <div className="catalog-toolbar">
        <input
          onChange={(event) => setCatalogSearch(event.target.value)}
          placeholder="Search products, sellers, or categories"
          value={catalogSearch}
        />
        <div className="catalog-chips">
          {categories.map((category) => (
            <button
              className={catalogCategory === category ? 'active' : ''}
              key={category}
              onClick={() => setCatalogCategory(category)}
              type="button"
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-uploader">
        <input
          accept="image/*"
          className="hidden-input"
          multiple
          onChange={(event) => {
            setStatusAssetFiles(Array.from(event.target.files ?? []));
          }}
          ref={statusInputRef}
          type="file"
        />
      </div>

      <section className="catalog-grid">
        {filteredCatalogItems.map((item) => (
          <article className="catalog-card" key={item.id}>
            <img alt={item.title} src={item.imageUrl} />
            <div className="catalog-card-body">
              <strong>{item.title}</strong>
              <span className="catalog-price">{item.price}</span>
              <small>
                {item.seller}
                {' · '}
                {item.status || 'active'}
                {item.trackStock === false ? ' · Stock not tracked' : ` · Stock ${item.stockQuantity ?? 0}`}
              </small>
              {isCatalogLowStock(item) ? <span className="low-stock-badge">Low stock</span> : null}
              <p>{item.description}</p>
              <button
                onClick={() => {
                  setActiveView('chats');
                  const seller =
                    users.find((user) => user.id === item.sellerId && user.id !== currentUserId) ||
                    users.find((user) => user.name === item.seller && user.id !== currentUserId);
                  if (seller) {
                    void createDirectChat(seller.id, `Hi, I want to buy ${item.title}. `);
                  } else {
                    setActiveView('chats');
                    setMessageDraft(`Hi, I want to buy ${item.title}. `);
                  }
                }}
                type="button"
              >
                Chat Seller
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );

  const renderSettingsToggle = (
    label: string,
    value: boolean,
    onChange: (next: boolean) => void,
    helper?: string,
  ) => (
    <label className="settings-toggle-row">
      <span>
        <strong>{label}</strong>
        {helper ? <small>{helper}</small> : null}
      </span>
      <input checked={value} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );

  const renderPrivacyChoice = (
    label: string,
    key: 'lastSeenPrivacy' | 'profilePhotoPrivacy' | 'aboutPrivacy' | 'statusPrivacy',
    options: Array<{ value: string; label: string }>,
  ) => (
    <div className="settings-choice-block">
      <strong>{label}</strong>
      <div className="settings-choice-row">
        {options.map((option) => (
          <button
            className={appSettings[key] === option.value ? 'active' : ''}
            key={`${key}-${option.value}`}
            onClick={() => updateAppSetting(key, option.value as any, { syncProfile: true })}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderSettingsPanelBody = () => {
    if (settingsPanel === 'favorites') {
      return (
        <>
          <p>Favorite chats stay pinned at the top of Chats.</p>
          {chatItems.map((chat) => (
            <button className="settings-list-row" key={chat.id} onClick={() => toggleFavoriteChat(chat.id)} type="button">
              <span>{chat.name}</span>
              <strong>{favoriteChatIds.includes(chat.id) ? '★' : '☆'}</strong>
            </button>
          ))}
        </>
      );
    }
    if (settingsPanel === 'business') {
      const tabs: Array<{ id: BusinessHubTab; label: string }> = [
        { id: 'catalog', label: 'Catalog' },
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'orders', label: 'Orders' },
        { id: 'receipts', label: 'Receipts' },
        { id: 'inventory', label: 'Inventory' },
        { id: 'customers', label: 'Customers' },
        { id: 'documents', label: 'Documents' },
        { id: 'broadcasts', label: 'Broadcasts' },
        { id: 'autoreplies', label: 'Auto-replies' },
        { id: 'ai', label: 'AI assistant' },
        { id: 'twin', label: 'AI Twin' },
      ];
      const consentLabel = (consent: MarketingConsent) =>
        consent === 'opted_in' ? 'Opted in' : consent === 'opted_out' ? 'Opted out' : 'Unknown';
      const isFollowUpDue = (followUpAt?: string | null) =>
        Boolean(followUpAt && new Date(followUpAt).getTime() <= Date.now());
      const formatMoney = (amount: number, currency = profile.currency || 'GHS') =>
        `${currency} ${Number(amount || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      const broadcastAudienceCount =
        broadcastForm.segment === 'opted_in'
          ? broadcastAudience.opted_in
          : broadcastForm.segment === 'repeat_buyers'
            ? broadcastAudience.repeat_buyers
            : broadcastForm.segment === 'all_customers'
              ? broadcastAudience.all_customers
              : businessCustomers.filter(
                  (customer) =>
                    customer.marketingConsent === 'opted_in' &&
                    customer.tags.some((tag) => tag.toLowerCase() === broadcastForm.tag.trim().toLowerCase()),
                ).length;
      const customerTagOptions = Array.from(
        new Set(businessCustomers.flatMap((customer) => customer.tags || [])),
      ).filter(Boolean);
      return (
        <>
          <button className="settings-list-row" onClick={() => setActiveView('catalog')} type="button">
            Open public catalog
          </button>
          <div className="business-tabs">
            {tabs.map((tab) => (
              <button
                className={businessHubTab === tab.id ? 'active' : ''}
                key={tab.id}
                onClick={() => {
                  setBusinessHubTab(tab.id);
                  if (tab.id === 'dashboard') void loadSalesDashboard(salesDashboardPeriod);
                  if (tab.id === 'orders') void loadCommerceOrders();
                  if (tab.id === 'receipts') void loadSaleReceipts();
                  if (tab.id === 'inventory') void loadInventoryAlerts();
                  if (tab.id === 'customers') void loadBusinessCustomers();
                  if (tab.id === 'documents') {
                    void loadCommerceDocuments(documentKindFilter);
                    void loadBusinessCustomers();
                  }
                  if (tab.id === 'broadcasts') {
                    void loadBroadcasts();
                    void loadBusinessCustomers();
                  }
                  if (tab.id === 'autoreplies') {
                    void loadAutoReplyConfig();
                    void loadAutoReplyLogs();
                  }
                  if (tab.id === 'ai') {
                    void loadBusinessAiConfig();
                    setBusinessAiAskResult(null);
                  }
                  if (tab.id === 'twin') {
                    void loadAiTwin();
                    void loadAiTwinActions();
                    setAiTwinNotice('');
                  }
                }}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {businessHubTab === 'catalog' ? (
            <div className="business-panel">
              <h3>Add Catalog Item</h3>
              <button onClick={() => catalogInputRef.current?.click()} type="button">
                Upload Catalog Images
                {catalogAssetFiles.length ? ` (${catalogAssetFiles.length})` : ''}
              </button>
              <input
                onChange={(event) => setCatalogForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="Product title"
                value={catalogForm.title}
              />
              <input
                onChange={(event) => setCatalogForm((current) => ({ ...current, price: event.target.value }))}
                placeholder={`Price (${profile.currency || 'GHS'})`}
                value={catalogForm.price}
              />
              <input
                onChange={(event) =>
                  setCatalogForm((current) => ({
                    ...current,
                    stockQuantity: event.target.value.replace(/[^\d]/g, ''),
                  }))
                }
                placeholder="Stock quantity"
                value={catalogForm.stockQuantity}
              />
              <input
                onChange={(event) => setCatalogForm((current) => ({ ...current, costPrice: event.target.value }))}
                placeholder={`Cost price (${profile.currency || 'GHS'})`}
                value={catalogForm.costPrice}
              />
              <input
                onChange={(event) =>
                  setCatalogForm((current) => ({
                    ...current,
                    lowStockThreshold: event.target.value.replace(/[^\d]/g, ''),
                  }))
                }
                placeholder="Low stock threshold"
                value={catalogForm.lowStockThreshold}
              />
              <label className="settings-toggle-row">
                <span>
                  <strong>Track stock</strong>
                  <small>Turn off if you do not count units for this product.</small>
                </span>
                <input
                  checked={catalogForm.trackStock}
                  onChange={(event) =>
                    setCatalogForm((current) => ({ ...current, trackStock: event.target.checked }))
                  }
                  type="checkbox"
                />
              </label>
              <input
                onChange={(event) => setCatalogForm((current) => ({ ...current, category: event.target.value }))}
                placeholder="Category"
                value={catalogForm.category}
              />
              <textarea
                onChange={(event) => setCatalogForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Description"
                value={catalogForm.description}
              />
              <input
                onChange={(event) => setCatalogForm((current) => ({ ...current, variantName: event.target.value }))}
                placeholder="Variant name (e.g. Storage, Colour)"
                value={catalogForm.variantName}
              />
              <input
                onChange={(event) =>
                  setCatalogForm((current) => ({ ...current, variantOptions: event.target.value }))
                }
                placeholder="Options, comma-separated (e.g. 64GB, 128GB)"
                value={catalogForm.variantOptions}
              />
              <div className="catalog-chips">
                {(['active', 'draft'] as const).map((status) => (
                  <button
                    className={catalogForm.status === status ? 'active' : ''}
                    key={status}
                    onClick={() => setCatalogForm((current) => ({ ...current, status }))}
                    type="button"
                  >
                    {status}
                  </button>
                ))}
              </div>
              <button onClick={() => void addCatalogItem()} type="button">
                {catalogForm.status === 'draft' ? 'Save draft' : 'Add To Catalog'}
              </button>

              <h3>Your products</h3>
              {ownCatalogItems.length ? null : <p>No products yet. Add your first item above.</p>}
              {ownCatalogItems.map((item) => (
                <div className="business-product-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.price} · {item.status || 'active'}
                      {item.trackStock === false ? ' · Stock not tracked' : ` · Stock ${item.stockQuantity ?? 0}`}
                    </small>
                    {isCatalogLowStock(item) ? <span className="low-stock-badge">Low stock</span> : null}
                  </div>
                  <div className="business-product-actions">
                    <button onClick={() => void adjustCatalogStock(item, -1)} type="button">
                      −
                    </button>
                    <button onClick={() => void adjustCatalogStock(item, 1)} type="button">
                      +
                    </button>
                    {(item.status || 'active') !== 'archived' ? (
                      <button onClick={() => void setCatalogItemStatus(item, 'archived')} type="button">
                        Archive
                      </button>
                    ) : (
                      <button onClick={() => void setCatalogItemStatus(item, 'active')} type="button">
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {businessHubTab === 'dashboard' ? (
            <div className="business-panel">
              <h3>Sales dashboard</h3>
              <div className="catalog-chips">
                {(
                  [
                    ['today', 'Today'],
                    ['7d', '7 days'],
                    ['30d', '30 days'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    className={salesDashboardPeriod === id ? 'active' : ''}
                    key={id}
                    onClick={() => {
                      setSalesDashboardPeriod(id);
                      void loadSalesDashboard(id);
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              {salesDashboard ? (
                <>
                  <p>
                    {salesDashboard.periodStart
                      ? new Date(salesDashboard.periodStart).toLocaleDateString()
                      : ''}
                    {' – '}
                    {salesDashboard.periodEnd
                      ? new Date(salesDashboard.periodEnd).toLocaleDateString()
                      : ''}
                    {' · '}
                    {salesDashboard.currency}
                    {salesDashboard.estimated ? ' · Estimated' : ' · Live'}
                  </p>
                  <div className="metric-grid">
                    <button
                      className="metric-card"
                      onClick={() => {
                        setBusinessHubTab('orders');
                        void loadCommerceOrders();
                      }}
                      type="button"
                    >
                      <strong>{salesDashboard.metrics?.pendingOrders ?? 0}</strong>
                      <span>Pending orders</span>
                    </button>
                    <button
                      className="metric-card"
                      onClick={() => {
                        setBusinessHubTab('receipts');
                        void loadSaleReceipts();
                      }}
                      type="button"
                    >
                      <strong>{salesDashboard.metrics?.confirmedSalesCount ?? 0}</strong>
                      <span>Confirmed sales</span>
                    </button>
                    <button
                      className="metric-card"
                      onClick={() => {
                        setBusinessHubTab('inventory');
                        void loadInventoryAlerts();
                      }}
                      type="button"
                    >
                      <strong>{salesDashboard.metrics?.lowStockCount ?? 0}</strong>
                      <span>Low stock</span>
                    </button>
                  </div>
                  {salesDashboard.canSeeFinance ? (
                    <>
                      <h3>Sales figures</h3>
                      <p>Gross sales {moneyLabel(salesDashboard.metrics?.grossSales, salesDashboard.currency)}</p>
                      <p>
                        Refunds {moneyLabel(salesDashboard.metrics?.refunds, salesDashboard.currency)}
                        {' · '}
                        Net sales {moneyLabel(salesDashboard.metrics?.netSales, salesDashboard.currency)}
                      </p>
                      <p>
                        Cash received {moneyLabel(salesDashboard.metrics?.cashReceived, salesDashboard.currency)}
                        {' (confirmed payments only)'}
                      </p>
                      {salesDashboard.metrics?.grossProfitAvailable ? (
                        <p>
                          After cost of goods {moneyLabel(salesDashboard.metrics?.grossProfit, salesDashboard.currency)}
                          {' · COGS '}
                          {moneyLabel(salesDashboard.metrics?.costOfGoodsSold, salesDashboard.currency)}
                        </p>
                      ) : (
                        <p>After-cost figure unavailable — add cost prices on products first.</p>
                      )}
                      {salesDashboard.metrics?.grossProfitNote ? (
                        <small>{salesDashboard.metrics.grossProfitNote}</small>
                      ) : null}
                    </>
                  ) : (
                    <p>Financial totals are limited to owners and managers.</p>
                  )}
                  <button onClick={() => void shareSalesReport()} type="button">
                    Copy / share report
                  </button>
                </>
              ) : (
                <p>Loading sales figures…</p>
              )}
            </div>
          ) : null}

          {businessHubTab === 'orders' ? (
            <div className="business-panel">
              <h3>Seller orders</h3>
              <button onClick={() => void loadCommerceOrders()} type="button">
                Refresh
              </button>
              {commerceOrders.length ? null : <p>No seller orders yet.</p>}
              {commerceOrders.map((order) => (
                <div className="business-product-row" key={order.id}>
                  <div>
                    <strong>{order.id}</strong>
                    <small>
                      {order.state.replace(/_/g, ' ')} · {moneyLabel(order.totalAmount, order.currency)}
                    </small>
                    <small>
                      {(order.items || []).map((entry) => `${entry.title} ×${entry.quantity}`).join(', ')}
                    </small>
                    {order.deliveryReference ? (
                      <small>Delivery ref: {order.deliveryReference}</small>
                    ) : null}
                    {order.fulfilmentNote ? (
                      <small>Fulfilment: {order.fulfilmentNote}</small>
                    ) : null}
                  </div>
                  <div className="business-product-actions">
                    {sellerOrderActions(order).map(([state, label]) => (
                      <button key={state} onClick={() => void updateOrderState(order.id, state)} type="button">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {businessHubTab === 'receipts' ? (
            <div className="business-panel">
              <h3>Receipts</h3>
              <button onClick={() => void loadSaleReceipts()} type="button">
                Refresh
              </button>
              {saleReceipts.length ? null : <p>No receipts yet.</p>}
              {saleReceipts.map((receipt) => (
                <button
                  className="settings-list-row"
                  key={receipt.id}
                  onClick={() => void openReceiptDetail(receipt.id)}
                  type="button"
                >
                  <span>
                    {receipt.receiptNumber}
                    <small>
                      {' '}
                      · {receipt.state} · {moneyLabel(receipt.totalAmount, receipt.currency)}
                    </small>
                  </span>
                  <strong>View</strong>
                </button>
              ))}
              {receiptDetail ? (
                <div className="receipt-detail">
                  <h3>{receiptDetail.receiptNumber}</h3>
                  <p>{receiptDetail.businessName || receiptDetail.sellerName}</p>
                  <p>Buyer: {receiptDetail.buyerName}</p>
                  <p>
                    {receiptDetail.state} ·{' '}
                    {new Date(receiptDetail.issuedAt || receiptDetail.createdAt).toLocaleString()}
                  </p>
                  {(receiptDetail.items || []).map((entry, index) => (
                    <p key={`${receiptDetail.id}-${index}`}>
                      {entry.title} ×{entry.quantity} · {moneyLabel(entry.price, receiptDetail.currency)}
                    </p>
                  ))}
                  <p>
                    Total {moneyLabel(receiptDetail.totalAmount, receiptDetail.currency)}
                  </p>
                  <p>
                    Payment: {receiptDetail.paymentMethod || '—'} · {receiptDetail.paymentReference || '—'}
                  </p>
                  <button onClick={() => setReceiptDetail(null)} type="button">
                    Close detail
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {businessHubTab === 'inventory' ? (
            <div className="business-panel">
              <h3>Low stock products</h3>
              {lowStockOwnItems.length ? null : <p>Stock looks fine right now.</p>}
              {lowStockOwnItems.map((item) => (
                <div className="business-product-row" key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.stockQuantity} left · alert at {item.lowStockThreshold}
                    </small>
                    <span className="low-stock-badge">Low stock</span>
                  </div>
                  <div className="business-product-actions">
                    <button onClick={() => void adjustCatalogStock(item, 1)} type="button">
                      + Stock
                    </button>
                  </div>
                </div>
              ))}
              <h3>Inventory alerts</h3>
              <button onClick={() => void loadInventoryAlerts()} type="button">
                Refresh alerts
              </button>
              {inventoryAlerts.length ? null : <p>No open inventory alerts.</p>}
              {inventoryAlerts.map((alert) => (
                <div className="business-product-row" key={alert.id}>
                  <div>
                    <strong>{alert.title || alert.catalogItemId || alert.id}</strong>
                    <small>
                      {alert.stockQuantity != null ? `${alert.stockQuantity} left` : 'Alert'}
                      {alert.lowStockThreshold != null ? ` · threshold ${alert.lowStockThreshold}` : ''}
                      {alert.reviewedAt ? ' · reviewed' : ' · open'}
                    </small>
                  </div>
                  <div className="business-product-actions">
                    {!alert.reviewedAt ? (
                      <button onClick={() => void reviewInventoryAlert(alert.id)} type="button">
                        Mark reviewed
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {businessHubTab === 'customers' ? (
            <div className="business-panel">
              <h3>Customers</h3>
              <button onClick={() => void loadBusinessCustomers()} type="button">
                Refresh
              </button>
              <p>
                {businessCustomers.length} customers
                {' · '}
                {businessCustomers.filter((entry) => isFollowUpDue(entry.followUpAt)).length} follow-ups due
                {' · '}
                {businessCustomers.filter((entry) => entry.marketingConsent === 'opted_in').length} opted in
              </p>

              <h3>Add customer</h3>
              <input
                onChange={(event) =>
                  setCustomerForm((current) => ({ ...current, displayName: event.target.value }))
                }
                placeholder="Display name"
                value={customerForm.displayName}
              />
              <input
                onChange={(event) =>
                  setCustomerForm((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="Phone (optional)"
                value={customerForm.phone}
              />
              <input
                onChange={(event) =>
                  setCustomerForm((current) => ({ ...current, tags: event.target.value }))
                }
                placeholder="Tags, comma-separated"
                value={customerForm.tags}
              />
              <textarea
                onChange={(event) =>
                  setCustomerForm((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="First note (optional)"
                value={customerForm.note}
              />
              <label>
                <span>Follow-up</span>
                <input
                  onChange={(event) =>
                    setCustomerForm((current) => ({ ...current, followUpAt: event.target.value }))
                  }
                  type="datetime-local"
                  value={customerForm.followUpAt}
                />
              </label>
              <button onClick={() => void createBusinessCustomer()} type="button">
                Save customer
              </button>

              {businessCustomers.length ? null : <p>No customers yet. Add one above.</p>}
              {businessCustomers.map((customer) => (
                <button
                  className="settings-list-row"
                  key={customer.id}
                  onClick={() => void loadCustomerDetail(customer.id)}
                  type="button"
                >
                  <span>
                    {customer.displayName}
                    <small>
                      {' '}
                      · {customer.orderCount || 0} orders ·{' '}
                      {moneyLabel(customer.totalSpent, customer.currency || profile.currency)}
                      {(customer.tags || []).length
                        ? ` · ${(customer.tags || []).slice(0, 3).join(', ')}`
                        : ''}
                    </small>
                    <span className={`consent-badge consent-${customer.marketingConsent || 'unknown'}`}>
                      {consentLabel(customer.marketingConsent || 'unknown')}
                    </span>
                    {isFollowUpDue(customer.followUpAt) ? (
                      <span className="follow-up-badge">Follow-up due</span>
                    ) : null}
                  </span>
                  <strong>Open</strong>
                </button>
              ))}

              {selectedCustomer ? (
                <div className="receipt-detail customer-detail">
                  <h3>{selectedCustomer.displayName}</h3>
                  <p>
                    {selectedCustomer.phone || 'No phone'}
                    {' · '}
                    {consentLabel(selectedCustomer.marketingConsent || 'unknown')}
                  </p>
                  <p>
                    {(selectedCustomer.tags || []).length
                      ? (selectedCustomer.tags || []).join(', ')
                      : 'No tags'}
                  </p>
                  <p>
                    Follow-up:{' '}
                    {selectedCustomer.followUpAt
                      ? new Date(selectedCustomer.followUpAt).toLocaleString()
                      : 'Not set'}
                    {selectedCustomer.followUpNote ? ` · ${selectedCustomer.followUpNote}` : ''}
                  </p>

                  <h3>Purchase history</h3>
                  {customerOrders.length ? null : <p>No linked orders yet.</p>}
                  {customerOrders.map((order) => (
                    <p key={order.id}>
                      {order.itemTitle || order.id} · {order.state.replace(/_/g, ' ')} ·{' '}
                      {moneyLabel(order.totalAmount, order.currency)} ·{' '}
                      {new Date(order.createdAt).toLocaleDateString()}
                      {order.deliveryReference ? ` · Ref ${order.deliveryReference}` : ''}
                      {order.fulfilmentNote ? ` · ${order.fulfilmentNote}` : ''}
                    </p>
                  ))}

                  <h3>Notes</h3>
                  {(selectedCustomer.notes || []).length ? null : <p>No notes yet.</p>}
                  {(selectedCustomer.notes || []).map((note) => (
                    <p key={note.id}>
                      {note.text}
                      <small> · {new Date(note.createdAt).toLocaleString()}</small>
                    </p>
                  ))}
                  <textarea
                    onChange={(event) => setCustomerNoteDraft(event.target.value)}
                    placeholder="Add a note"
                    value={customerNoteDraft}
                  />
                  <button onClick={() => void addCustomerNote(selectedCustomer.id)} type="button">
                    Add note
                  </button>

                  <div className="business-product-actions">
                    <button
                      onClick={() => {
                        const next = window.prompt(
                          'Follow-up date/time (YYYY-MM-DDTHH:mm or leave blank to clear)',
                          selectedCustomer.followUpAt
                            ? selectedCustomer.followUpAt.slice(0, 16)
                            : '',
                        );
                        if (next === null) return;
                        const trimmed = next.trim();
                        void updateBusinessCustomer(selectedCustomer.id, {
                          followUpAt: trimmed ? new Date(trimmed).toISOString() : null,
                        });
                      }}
                      type="button"
                    >
                      Set follow-up
                    </button>
                    {selectedCustomer.marketingConsent !== 'opted_out' ? (
                      <button
                        onClick={() =>
                          void updateBusinessCustomer(selectedCustomer.id, {
                            marketingConsent: 'opted_out',
                          })
                        }
                        type="button"
                      >
                        Mark opted out
                      </button>
                    ) : null}
                    <button
                      className="danger"
                      onClick={() => void deleteBusinessCustomer(selectedCustomer.id)}
                      type="button"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => {
                        setSelectedCustomer(null);
                        setCustomerOrders([]);
                      }}
                      type="button"
                    >
                      Close detail
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {businessHubTab === 'documents' ? (
            <div className="business-panel">
              <h3>Invoices & quotations</h3>
              <p>Create drafts, send to chat, convert quotations, and mark invoices paid.</p>
              <div className="doc-filter-row">
                <button
                  className={documentKindFilter === '' ? 'active' : ''}
                  onClick={() => {
                    setDocumentKindFilter('');
                    void loadCommerceDocuments('');
                  }}
                  type="button"
                >
                  All
                </button>
                <button
                  className={documentKindFilter === 'quotation' ? 'active' : ''}
                  onClick={() => {
                    setDocumentKindFilter('quotation');
                    void loadCommerceDocuments('quotation');
                  }}
                  type="button"
                >
                  Quotations
                </button>
                <button
                  className={documentKindFilter === 'invoice' ? 'active' : ''}
                  onClick={() => {
                    setDocumentKindFilter('invoice');
                    void loadCommerceDocuments('invoice');
                  }}
                  type="button"
                >
                  Invoices
                </button>
                <button onClick={() => void loadCommerceDocuments(documentKindFilter)} type="button">
                  Refresh
                </button>
              </div>

              <h3>Create</h3>
              <select
                onChange={(event) =>
                  setDocumentForm((current) => ({
                    ...current,
                    kind: event.target.value as CommerceDocKind,
                  }))
                }
                value={documentForm.kind}
              >
                <option value="quotation">Quotation</option>
                <option value="invoice">Invoice</option>
              </select>
              <input
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, customerName: event.target.value }))
                }
                placeholder="Customer name"
                value={documentForm.customerName}
              />
              <select
                onChange={(event) => {
                  const customerUserId = event.target.value;
                  const customer = businessCustomers.find((entry) => entry.customerUserId === customerUserId);
                  const chat = chatItems.find((entry) => entry.peerUserId === customerUserId);
                  setDocumentForm((current) => ({
                    ...current,
                    customerUserId,
                    customerName: customer?.displayName || current.customerName,
                    chatId: chat?.id || customer?.chatId || current.chatId,
                  }));
                }}
                value={documentForm.customerUserId}
              >
                <option value="">Link customer (optional)</option>
                {businessCustomers
                  .filter((customer) => customer.customerUserId)
                  .map((customer) => (
                    <option key={customer.id} value={customer.customerUserId || ''}>
                      {customer.displayName}
                    </option>
                  ))}
              </select>
              <select
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, chatId: event.target.value }))
                }
                value={documentForm.chatId}
              >
                <option value="">Chat to share (optional)</option>
                {chatItems.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.name}
                  </option>
                ))}
              </select>
              <div className="doc-line-row">
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, lineTitle: event.target.value }))
                  }
                  placeholder="Line item title"
                  value={documentForm.lineTitle}
                />
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      lineQuantity: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder="Qty"
                  value={documentForm.lineQuantity}
                />
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      lineUnitPrice: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder="Unit price"
                  value={documentForm.lineUnitPrice}
                />
              </div>
              {documentExtraLines.map((line, index) => (
                <div className="doc-line-row" key={`extra-line-${index}`}>
                  <input
                    onChange={(event) =>
                      setDocumentExtraLines((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, title: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Line item title"
                    value={line.title}
                  />
                  <input
                    onChange={(event) =>
                      setDocumentExtraLines((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, quantity: event.target.value.replace(/[^\d.]/g, '') }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Qty"
                    value={line.quantity}
                  />
                  <input
                    onChange={(event) =>
                      setDocumentExtraLines((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, unitPrice: event.target.value.replace(/[^\d.]/g, '') }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Unit price"
                    value={line.unitPrice}
                  />
                  <button
                    onClick={() =>
                      setDocumentExtraLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setDocumentExtraLines((current) => [...current, { title: '', quantity: '1', unitPrice: '' }])
                }
                type="button"
              >
                Add line
              </button>
              <div className="doc-line-row">
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      discountAmount: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder="Discount"
                  value={documentForm.discountAmount}
                />
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({
                      ...current,
                      taxAmount: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                  placeholder="Tax"
                  value={documentForm.taxAmount}
                />
              </div>
              <input
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, paymentTerms: event.target.value }))
                }
                placeholder="Payment terms"
                value={documentForm.paymentTerms}
              />
              {documentForm.kind === 'quotation' ? (
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, expiresAt: event.target.value }))
                  }
                  placeholder="Expires at (ISO or date)"
                  type="datetime-local"
                  value={documentForm.expiresAt}
                />
              ) : (
                <input
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, dueAt: event.target.value }))
                  }
                  placeholder="Due at"
                  type="datetime-local"
                  value={documentForm.dueAt}
                />
              )}
              <textarea
                onChange={(event) =>
                  setDocumentForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Notes"
                value={documentForm.notes}
              />
              <label className="settings-toggle-row">
                <span>
                  <strong>Send now</strong>
                  <small>Share into the selected chat immediately.</small>
                </span>
                <input
                  checked={documentForm.sendNow}
                  onChange={(event) =>
                    setDocumentForm((current) => ({ ...current, sendNow: event.target.checked }))
                  }
                  type="checkbox"
                />
              </label>
              <button onClick={() => void createCommerceDocument()} type="button">
                {documentForm.sendNow ? 'Create & send' : 'Save draft'}
              </button>

              <h3>Documents</h3>
              {commerceDocuments.length ? null : <p>No documents yet.</p>}
              {commerceDocuments.map((doc) => {
                const isSeller = doc.sellerUserId === currentUserId;
                const isCustomer = doc.customerUserId === currentUserId;
                return (
                  <div className="business-product-row" key={doc.id}>
                    <div>
                      <strong>
                        {doc.kind === 'invoice' ? 'Invoice' : 'Quotation'} {doc.number}
                      </strong>
                      <small>
                        {doc.customerName} · {doc.state} · {formatMoney(doc.totalAmount, doc.currency)}
                      </small>
                      <small>{new Date(doc.updatedAt || doc.createdAt).toLocaleString()}</small>
                    </div>
                    <div className="business-product-actions">
                      {isSeller && doc.state === 'draft' ? (
                        <button onClick={() => void runDocumentAction(doc.id, 'send', { chatId: doc.chatId })} type="button">
                          Send
                        </button>
                      ) : null}
                      {isSeller &&
                      doc.kind === 'quotation' &&
                      (doc.state === 'sent' || doc.state === 'accepted') ? (
                        <button onClick={() => void runDocumentAction(doc.id, 'convert')} type="button">
                          Convert
                        </button>
                      ) : null}
                      {isSeller &&
                      doc.kind === 'invoice' &&
                      doc.state !== 'paid' &&
                      doc.state !== 'voided' ? (
                        <button
                          onClick={() => void runDocumentAction(doc.id, 'mark-paid', { markCashReceived: true })}
                          type="button"
                        >
                          Mark paid
                        </button>
                      ) : null}
                      {isCustomer && doc.state === 'sent' ? (
                        <>
                          <button onClick={() => void runDocumentAction(doc.id, 'accept')} type="button">
                            Accept
                          </button>
                          <button onClick={() => void runDocumentAction(doc.id, 'reject')} type="button">
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {businessHubTab === 'broadcasts' ? (
            <div className="business-panel">
              <h3>Broadcasts</h3>
              <p>Only opted-in customers receive marketing broadcasts. Rate limit applies.</p>
              <div className="metric-grid">
                <div className="metric-card">
                  <strong>{broadcastAudience.opted_in}</strong>
                  <span>Opted in</span>
                </div>
                <div className="metric-card">
                  <strong>{broadcastAudience.repeat_buyers}</strong>
                  <span>Repeat buyers</span>
                </div>
                <div className="metric-card">
                  <strong>{broadcastAudience.all_customers}</strong>
                  <span>All customers</span>
                </div>
              </div>
              <textarea
                onChange={(event) =>
                  setBroadcastForm((current) => ({ ...current, text: event.target.value }))
                }
                placeholder="Broadcast message"
                value={broadcastForm.text}
              />
              <select
                onChange={(event) =>
                  setBroadcastForm((current) => ({
                    ...current,
                    segment: event.target.value as BroadcastSegment,
                  }))
                }
                value={broadcastForm.segment}
              >
                <option value="opted_in">Opted in</option>
                <option value="repeat_buyers">Repeat buyers</option>
                <option value="all_customers">All customers (opted in)</option>
                <option value="tag">By tag</option>
              </select>
              {broadcastForm.segment === 'tag' ? (
                <select
                  onChange={(event) =>
                    setBroadcastForm((current) => ({ ...current, tag: event.target.value }))
                  }
                  value={broadcastForm.tag}
                >
                  <option value="">Select tag</option>
                  {customerTagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              ) : null}
              <small>
                Audience preview: {broadcastAudienceCount} recipient
                {broadcastAudienceCount === 1 ? '' : 's'}
              </small>
              <label className="settings-toggle-row">
                <span>
                  <strong>Send now</strong>
                  <small>Deliver immediately to the selected segment.</small>
                </span>
                <input
                  checked={broadcastForm.sendNow}
                  onChange={(event) =>
                    setBroadcastForm((current) => ({ ...current, sendNow: event.target.checked }))
                  }
                  type="checkbox"
                />
              </label>
              <button onClick={() => void createBroadcast()} type="button">
                {broadcastForm.sendNow ? 'Send broadcast' : 'Save draft'}
              </button>
              <button onClick={() => void loadBroadcasts()} type="button">
                Refresh history
              </button>

              <h3>Campaign history</h3>
              {broadcastCampaigns.length ? null : <p>No campaigns yet.</p>}
              {broadcastCampaigns.map((campaign) => (
                <div className="business-product-row" key={campaign.id}>
                  <div>
                    <strong>{campaign.text}</strong>
                    <small>
                      {campaign.segment}
                      {campaign.tag ? ` · ${campaign.tag}` : ''} · {campaign.status} ·{' '}
                      {campaign.sentCount}/{campaign.audienceCount} sent
                    </small>
                    <small>{new Date(campaign.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="business-product-actions">
                    {campaign.status !== 'sent' && campaign.status !== 'cancelled' ? (
                      <button onClick={() => void cancelBroadcast(campaign.id)} type="button">
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {businessHubTab === 'autoreplies' ? (
            <div className="business-panel">
              <h3>Auto-replies</h3>
              <p>
                Rule-based replies only. No invented prices or stock. Customers can type “human” to
                pause automation for that chat.
              </p>
              {renderSettingsToggle(
                'Master switch',
                Boolean(autoReplyConfig?.enabled),
                (value) => void saveAutoReplyConfig({ enabled: value }),
                autoReplyConfig?.enabled ? 'Auto-replies are on' : 'Turn on to reply automatically',
              )}

              <h3>Greeting</h3>
              {renderSettingsToggle(
                'First-message greeting',
                autoReplyConfig?.greetingEnabled !== false,
                (value) => void saveAutoReplyConfig({ greetingEnabled: value }),
              )}
              <textarea
                onBlur={() =>
                  void saveAutoReplyConfig({ greetingText: autoReplyConfig?.greetingText || '' })
                }
                onChange={(event) =>
                  setAutoReplyConfig((current) =>
                    current
                      ? { ...current, greetingText: event.target.value }
                      : ({ greetingText: event.target.value } as AutoReplyConfig),
                  )
                }
                placeholder="Thanks for messaging us..."
                value={autoReplyConfig?.greetingText || ''}
              />

              <h3>Away message</h3>
              {renderSettingsToggle(
                'Away fallback',
                autoReplyConfig?.awayEnabled !== false,
                (value) => void saveAutoReplyConfig({ awayEnabled: value }),
              )}
              <textarea
                onBlur={() => void saveAutoReplyConfig({ awayText: autoReplyConfig?.awayText || '' })}
                onChange={(event) =>
                  setAutoReplyConfig((current) =>
                    current
                      ? { ...current, awayText: event.target.value }
                      : ({ awayText: event.target.value } as AutoReplyConfig),
                  )
                }
                placeholder="We are away right now..."
                value={autoReplyConfig?.awayText || ''}
              />

              <h3>Opening hours</h3>
              <input
                onBlur={() => void saveAutoReplyConfig({ hoursText: autoReplyConfig?.hoursText || '' })}
                onChange={(event) =>
                  setAutoReplyConfig((current) =>
                    current
                      ? { ...current, hoursText: event.target.value }
                      : ({ hoursText: event.target.value } as AutoReplyConfig),
                  )
                }
                placeholder="Mon–Sat 9am–6pm"
                value={autoReplyConfig?.hoursText || ''}
              />

              <h3>Human handover</h3>
              <input
                onBlur={() =>
                  void saveAutoReplyConfig({
                    humanHandoverKeywords: (autoReplyConfig?.humanHandoverKeywords || [])
                      .map((keyword) => keyword.trim())
                      .filter(Boolean),
                  })
                }
                onChange={(event) => {
                  const keywords = event.target.value
                    .split(',')
                    .map((keyword) => keyword.trim())
                    .filter((keyword, index, list) => keyword || index < list.length - 1);
                  setAutoReplyConfig((current) =>
                    current
                      ? { ...current, humanHandoverKeywords: keywords }
                      : ({ humanHandoverKeywords: keywords } as AutoReplyConfig),
                  );
                }}
                placeholder="human, agent, real person"
                value={(autoReplyConfig?.humanHandoverKeywords || []).join(', ')}
              />
              <small>Comma-separated. Customers matching these pause auto-replies for that chat.</small>

              <h3>Cooldown</h3>
              <input
                onBlur={() =>
                  void saveAutoReplyConfig({
                    cooldownSeconds: Number(autoReplyConfig?.cooldownSeconds) || 90,
                  })
                }
                onChange={(event) => {
                  const cooldownSeconds = Number(event.target.value.replace(/[^\d]/g, '')) || 0;
                  setAutoReplyConfig((current) =>
                    current
                      ? { ...current, cooldownSeconds }
                      : ({ cooldownSeconds } as AutoReplyConfig),
                  );
                }}
                placeholder="Cooldown seconds (e.g. 90)"
                value={autoReplyConfig?.cooldownSeconds ?? ''}
              />

              <h3>FAQ rules</h3>
              {(autoReplyConfig?.rules || []).length ? null : <p>No FAQ rules yet.</p>}
              {(autoReplyConfig?.rules || []).map((rule) => (
                <div className="business-product-row" key={rule.id}>
                  <div>
                    <strong>{(rule.keywords || []).join(', ')}</strong>
                    <small>{rule.response}</small>
                    {rule.enabled === false ? <span className="consent-badge consent-opted_out">Off</span> : null}
                  </div>
                  <div className="business-product-actions">
                    <button onClick={() => void removeAutoReplyRule(rule.id)} type="button">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <input
                onChange={(event) =>
                  setAutoReplyRuleDraft((current) => ({ ...current, keywords: event.target.value }))
                }
                placeholder="Keywords, comma-separated"
                value={autoReplyRuleDraft.keywords}
              />
              <textarea
                onChange={(event) =>
                  setAutoReplyRuleDraft((current) => ({ ...current, response: event.target.value }))
                }
                placeholder="Fixed reply text"
                value={autoReplyRuleDraft.response}
              />
              <button onClick={() => void addAutoReplyRule()} type="button">
                Add rule
              </button>

              <h3>Recent activity</h3>
              <button
                onClick={() => {
                  void loadAutoReplyConfig();
                  void loadAutoReplyLogs();
                }}
                type="button"
              >
                Refresh
              </button>
              {autoReplyLogs.length ? null : <p>No automated replies logged yet.</p>}
              {autoReplyLogs.slice(0, 12).map((log) => (
                <div className="business-product-row" key={log.id}>
                  <div>
                    <strong>{log.source}</strong>
                    <small>
                      {new Date(log.createdAt).toLocaleString()} · chat {log.chatId}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {businessHubTab === 'ai' ? (
            <div className="business-panel">
              <h3>Business AI assistant</h3>
              <p>
                Answers use approved catalogue and policy data only. Replies are drafts — never
                auto-sent. Escalates when data is insufficient.
              </p>
              {renderSettingsToggle(
                businessAiConfig?.enabled ? 'Enabled' : 'Paused',
                Boolean(businessAiConfig?.enabled),
                (value) => void saveBusinessAiConfig({ enabled: value }),
                businessAiConfig?.enabled
                  ? 'Customers can receive automated business answers'
                  : 'Turn on to answer from approved policies and FAQ',
              )}

              <h3>Business info</h3>
              <textarea
                onBlur={() =>
                  void saveBusinessAiConfig({ policyText: businessAiConfig?.policyText || '' })
                }
                onChange={(event) =>
                  setBusinessAiConfig((current) =>
                    current
                      ? { ...current, policyText: event.target.value }
                      : ({ policyText: event.target.value } as BusinessAiConfig),
                  )
                }
                placeholder="Hours, location, general business info…"
                value={businessAiConfig?.policyText || ''}
              />

              <h3>Delivery policy</h3>
              <textarea
                onBlur={() =>
                  void saveBusinessAiConfig({
                    deliveryPolicy: businessAiConfig?.deliveryPolicy || '',
                  })
                }
                onChange={(event) =>
                  setBusinessAiConfig((current) =>
                    current
                      ? { ...current, deliveryPolicy: event.target.value }
                      : ({ deliveryPolicy: event.target.value } as BusinessAiConfig),
                  )
                }
                placeholder="Shipping timing, areas, fees…"
                value={businessAiConfig?.deliveryPolicy || ''}
              />

              <h3>Refund policy</h3>
              <textarea
                onBlur={() =>
                  void saveBusinessAiConfig({ refundPolicy: businessAiConfig?.refundPolicy || '' })
                }
                onChange={(event) =>
                  setBusinessAiConfig((current) =>
                    current
                      ? { ...current, refundPolicy: event.target.value }
                      : ({ refundPolicy: event.target.value } as BusinessAiConfig),
                  )
                }
                placeholder="Returns and refunds…"
                value={businessAiConfig?.refundPolicy || ''}
              />

              <h3>FAQ</h3>
              {(businessAiConfig?.faq || []).length ? null : <p>No FAQ entries yet.</p>}
              {(businessAiConfig?.faq || []).map((entry, index) => (
                <div className="business-product-row" key={`${entry.question}-${index}`}>
                  <div>
                    <strong>{entry.question}</strong>
                    <small>{entry.answer}</small>
                  </div>
                  <div className="business-product-actions">
                    <button
                      onClick={() => {
                        const nextFaq = (businessAiConfig?.faq || []).filter((_, i) => i !== index);
                        void saveBusinessAiConfig({ faq: nextFaq });
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <input
                onChange={(event) =>
                  setBusinessAiFaqDraft((current) => ({ ...current, question: event.target.value }))
                }
                placeholder="FAQ question"
                value={businessAiFaqDraft.question}
              />
              <textarea
                onChange={(event) =>
                  setBusinessAiFaqDraft((current) => ({ ...current, answer: event.target.value }))
                }
                placeholder="Approved answer"
                value={businessAiFaqDraft.answer}
              />
              <button
                onClick={() => {
                  const question = businessAiFaqDraft.question.trim();
                  const answer = businessAiFaqDraft.answer.trim();
                  if (question.length < 2 || answer.length < 2) {
                    showToast('Add a question and answer');
                    return;
                  }
                  const nextFaq = [...(businessAiConfig?.faq || []), { question, answer }];
                  void saveBusinessAiConfig({ faq: nextFaq });
                  setBusinessAiFaqDraft({ question: '', answer: '' });
                }}
                type="button"
              >
                Add FAQ
              </button>

              <h3>Test question</h3>
              <input
                onChange={(event) => setBusinessAiTestQuestion(event.target.value)}
                placeholder="Ask as a customer would…"
                value={businessAiTestQuestion}
              />
              <button
                disabled={businessAiBusy || !businessAiTestQuestion.trim() || !currentUserId}
                onClick={() => void askBusinessAi()}
                type="button"
              >
                {businessAiBusy ? 'Asking…' : 'Ask'}
              </button>
              {businessAiAskResult ? (
                <div className="business-ai-result" role="status">
                  <p className="business-ai-disclosure">
                    {businessAiAskResult.disclosure ||
                      'Automated business assistant. Answers use approved catalogue/policy data only.'}
                  </p>
                  <p>{businessAiAskResult.answer}</p>
                  {businessAiAskResult.escalate ? (
                    <p className="business-ai-escalate" role="alert">
                      Escalate to a human — approved data was insufficient or sensitive.
                    </p>
                  ) : null}
                  {businessAiAskResult.notice ? (
                    <small>{businessAiAskResult.notice}</small>
                  ) : null}
                  {businessAiAskResult.source || businessAiAskResult.confidence ? (
                    <small>
                      {[businessAiAskResult.source, businessAiAskResult.confidence]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  ) : null}
                </div>
              ) : null}
              <button onClick={() => void loadBusinessAiConfig()} type="button">
                Refresh
              </button>
            </div>
          ) : null}

          {businessHubTab === 'twin' ? (
            <div className="business-panel">
              <h3>AI Twin</h3>
              <p>
                Acts as a supervised draft agent for your business. Drafts only fill the composer —
                never auto-sent. Hard blocks cannot be removed.
              </p>
              {renderSettingsToggle(
                aiTwinConfig?.enabled ? 'Enabled' : 'Paused',
                Boolean(aiTwinConfig?.enabled),
                (value) => void saveAiTwinConfig({ enabled: value }),
                aiTwinConfig?.enabled
                  ? 'Twin can propose drafts and organise enquiries'
                  : 'Enable to run the Twin from chat or the action inbox',
              )}

              <h3>Capabilities</h3>
              <div className="twin-capabilities">
                <div>
                  <strong>May</strong>
                  <ul>
                    {(aiTwinCapabilities?.may || TWIN_ALLOWED_TASKS.map((task) => task.label)).map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
                <div className="twin-hard-blocks" role="note">
                  <strong>Hard blocks (never allowed)</strong>
                  <ul>
                    {(
                      aiTwinCapabilities?.mayNot ||
                      aiTwinConfig?.blockedActions ||
                      Object.keys(TWIN_HARD_BLOCK_LABELS)
                    ).map((item) => (
                      <li key={item}>{TWIN_HARD_BLOCK_LABELS[item] || item.replace(/_/g, ' ')}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <h3>Settings</h3>
              <input
                onBlur={() =>
                  void saveAiTwinConfig({ displayName: aiTwinConfig?.displayName || 'AI Twin' })
                }
                onChange={(event) =>
                  setAiTwinConfig((current) =>
                    current
                      ? { ...current, displayName: event.target.value }
                      : ({ displayName: event.target.value } as AiTwinConfig),
                  )
                }
                placeholder="Display name"
                value={aiTwinConfig?.displayName || ''}
              />
              <label className="ai-tone-select">
                <span>Permission</span>
                <select
                  aria-label="Twin permission tier"
                  onChange={(event) =>
                    void saveAiTwinConfig({
                      permissionTier: event.target.value as TwinPermissionTier,
                    })
                  }
                  value={aiTwinConfig?.permissionTier || 'draft_only'}
                >
                  <option value="draft_only">Draft only (owner review)</option>
                  <option value="auto_routine">Auto routine (still no auto-send)</option>
                </select>
              </label>
              <textarea
                onBlur={() =>
                  void saveAiTwinConfig({
                    operatingHoursText: aiTwinConfig?.operatingHoursText || '',
                  })
                }
                onChange={(event) =>
                  setAiTwinConfig((current) =>
                    current
                      ? { ...current, operatingHoursText: event.target.value }
                      : ({ operatingHoursText: event.target.value } as AiTwinConfig),
                  )
                }
                placeholder="Approved operating hours text…"
                value={aiTwinConfig?.operatingHoursText || ''}
              />
              <input
                min={1}
                max={200}
                onBlur={() =>
                  void saveAiTwinConfig({
                    dailyActionLimit: Math.min(
                      200,
                      Math.max(1, Number(aiTwinConfig?.dailyActionLimit) || 40),
                    ),
                  })
                }
                onChange={(event) =>
                  setAiTwinConfig((current) =>
                    current
                      ? { ...current, dailyActionLimit: Number(event.target.value) || 1 }
                      : ({ dailyActionLimit: Number(event.target.value) || 1 } as AiTwinConfig),
                  )
                }
                placeholder="Daily action limit"
                type="number"
                value={aiTwinConfig?.dailyActionLimit ?? 40}
              />

              <h3>Allowed tasks</h3>
              <div className="twin-checklist">
                {TWIN_ALLOWED_TASKS.map((task) => {
                  const checked = (aiTwinConfig?.allowedTasks || []).includes(task.id);
                  return (
                    <label key={task.id}>
                      <input
                        checked={checked}
                        onChange={() => {
                          const current = aiTwinConfig?.allowedTasks || [];
                          const next = checked
                            ? current.filter((entry) => entry !== task.id)
                            : [...current, task.id];
                          void saveAiTwinConfig({ allowedTasks: next });
                        }}
                        type="checkbox"
                      />
                      <span>{task.label}</span>
                    </label>
                  );
                })}
              </div>

              <h3>Data sources</h3>
              <div className="twin-checklist">
                {TWIN_DATA_SOURCES.map((source) => {
                  const checked = (aiTwinConfig?.dataSources || []).includes(source.id);
                  return (
                    <label key={source.id}>
                      <input
                        checked={checked}
                        onChange={() => {
                          const current = aiTwinConfig?.dataSources || [];
                          const next = checked
                            ? current.filter((entry) => entry !== source.id)
                            : [...current, source.id];
                          void saveAiTwinConfig({ dataSources: next });
                        }}
                        type="checkbox"
                      />
                      <span>{source.label}</span>
                    </label>
                  );
                })}
              </div>

              {aiTwinNotice ? (
                <p className="twin-notice" role="status">
                  {aiTwinNotice}
                </p>
              ) : null}

              <h3>Action inbox</h3>
              <button
                disabled={aiTwinBusy || !currentUserId}
                onClick={() => {
                  void loadAiTwin();
                  void loadAiTwinActions();
                }}
                type="button"
              >
                Refresh
              </button>
              {aiTwinActions.length ? null : <p>No Twin actions yet.</p>}
              {aiTwinActions.slice(0, 20).map((action) => (
                <div
                  className={`business-product-row twin-action-row status-${action.status}`}
                  key={action.id}
                >
                  <div>
                    <strong>
                      {action.task.replace(/_/g, ' ')} · {action.status.replace(/_/g, ' ')}
                    </strong>
                    <small>{action.summary}</small>
                    {action.draftText ? <p className="twin-draft-preview">{action.draftText}</p> : null}
                    {action.status === 'blocked' ? (
                      <p className="twin-blocked-banner" role="alert">
                        Hard block — cannot approve.
                      </p>
                    ) : null}
                    <small>{new Date(action.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="business-product-actions">
                    {action.status === 'proposed' ? (
                      <>
                        <button
                          disabled={aiTwinBusy}
                          onClick={() => void decideTwinAction(action.id, 'approve')}
                          type="button"
                        >
                          Approve → draft
                        </button>
                        <button
                          disabled={aiTwinBusy}
                          onClick={() => void decideTwinAction(action.id, 'reject')}
                          type="button"
                        >
                          Reject
                        </button>
                      </>
                    ) : null}
                    {action.status === 'executed_draft' && action.draftText ? (
                      <button
                        onClick={() =>
                          fillComposerFromTwinDraft(
                            action.draftText,
                            'Filled draft — review before sending.',
                          )
                        }
                        type="button"
                      >
                        Use draft
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      );
    }
    if (settingsPanel === 'history') {
      return (
        <>
          <button className="settings-list-row" onClick={() => showToast(`Export ready: ${chatItems.length} chats`)} type="button">
            Export chat
          </button>
          <button className="settings-list-row danger" onClick={clearChatHistory} type="button">
            Clear all chats
          </button>
        </>
      );
    }
    if (settingsPanel === 'privacy') {
      return (
        <>
          {renderPrivacyChoice('Last seen & online', 'lastSeenPrivacy', [
            { value: 'everyone', label: 'Everyone' },
            { value: 'contacts', label: 'My contacts' },
            { value: 'nobody', label: 'Nobody' },
          ])}
          {renderPrivacyChoice('Profile photo', 'profilePhotoPrivacy', [
            { value: 'everyone', label: 'Everyone' },
            { value: 'contacts', label: 'My contacts' },
            { value: 'nobody', label: 'Nobody' },
          ])}
          {renderPrivacyChoice('About', 'aboutPrivacy', [
            { value: 'everyone', label: 'Everyone' },
            { value: 'contacts', label: 'My contacts' },
            { value: 'nobody', label: 'Nobody' },
          ])}
          {renderPrivacyChoice('Status', 'statusPrivacy', [
            { value: 'contacts', label: 'My contacts' },
            { value: 'close-friends', label: 'Close friends' },
            { value: 'nobody', label: 'Nobody' },
          ])}
          {renderSettingsToggle(
            'Read receipts',
            appSettings.readReceiptsEnabled,
            (value) => updateAppSetting('readReceiptsEnabled', value, { syncProfile: true }),
            'If off, you won’t send or see read ticks',
          )}
          <div className="business-panel">
            <h3>Marketing preferences</h3>
            <p>Businesses that keep a CRM record for you can send marketing only if you opt in.</p>
            <button onClick={() => void loadCustomerPreferences()} type="button">
              Refresh preferences
            </button>
            {customerPrefs.length ? null : <p>No business CRM records linked to your account.</p>}
            {customerPrefs.map((pref) => (
              <div className="business-product-row" key={pref.customerId}>
                <div>
                  <strong>{pref.displayNameOnSellerSide || pref.sellerUserId}</strong>
                  <small>
                    {pref.marketingConsent === 'opted_in'
                      ? 'Opted in'
                      : pref.marketingConsent === 'opted_out'
                        ? 'Opted out'
                        : 'Not set'}
                  </small>
                  <span className={`consent-badge consent-${pref.marketingConsent || 'unknown'}`}>
                    {pref.marketingConsent === 'opted_in'
                      ? 'Opted in'
                      : pref.marketingConsent === 'opted_out'
                        ? 'Opted out'
                        : 'Unknown'}
                  </span>
                </div>
                <div className="business-product-actions">
                  <button
                    onClick={() => void updateMyMarketingPreference(pref.customerId, 'opted_in')}
                    type="button"
                  >
                    Opt in
                  </button>
                  <button
                    onClick={() => void updateMyMarketingPreference(pref.customerId, 'opted_out')}
                    type="button"
                  >
                    Opt out
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      );
    }
    if (settingsPanel === 'chats') {
      return (
        <>
          {renderSettingsToggle('Enter is send', appSettings.enterIsSend, (value) => updateAppSetting('enterIsSend', value))}
          {renderSettingsToggle('Media auto-download', appSettings.mediaAutoDownload, (value) => updateAppSetting('mediaAutoDownload', value))}
          {renderSettingsToggle('Low data mode', appSettings.lowDataMode, (value) => updateAppSetting('lowDataMode', value))}
        </>
      );
    }
    if (settingsPanel === 'notifications') {
      return (
        <>
          {renderSettingsToggle('Message notifications', appSettings.messageNotifications, (value) => updateAppSetting('messageNotifications', value))}
          {renderSettingsToggle('Show preview', appSettings.showNotificationPreview, (value) => updateAppSetting('showNotificationPreview', value))}
          {renderSettingsToggle('Conversation tones', appSettings.conversationTones, (value) => updateAppSetting('conversationTones', value))}
        </>
      );
    }
    if (settingsPanel === 'storage') {
      return (
        <>
          <p>{Object.values(messagesByChat).flat().length} messages · {catalogItems.length} catalog items · {favoriteChatIds.length} favorites</p>
          {renderSettingsToggle('Low data mode', appSettings.lowDataMode, (value) => updateAppSetting('lowDataMode', value))}
          <button className="settings-list-row" onClick={() => { setCatalogAssetFiles([]); setStatusAssetFiles([]); showToast('Local media cache cleared'); }} type="button">
            Clear cache
          </button>
        </>
      );
    }
    if (settingsPanel === 'help') {
      return (
        <>
          {['How to link devices', 'How payments work', 'Contact support'].map((faq) => (
            <button className="settings-list-row" key={faq} onClick={() => showToast(faq)} type="button">{faq}</button>
          ))}
          <textarea onChange={(event) => setFeedbackDraft(event.target.value)} placeholder="Send feedback" value={feedbackDraft} />
          <button
            className="send-button"
            onClick={() => {
              if (!feedbackDraft.trim()) {
                showToast('Write feedback first.');
                return;
              }
              setFeedbackDraft('');
              showToast('Thanks — feedback sent to the ZynkUp team.');
            }}
            type="button"
          >
            Send feedback
          </button>
        </>
      );
    }

    return (
      <>
        <h2>Profile</h2>
        <div className="profile-top">
          <img alt={profile.name} src={profile.photoUrl} />
          <button onClick={() => profilePhotoInputRef.current?.click()} type="button">Edit photo</button>
          <input
            accept="image/*"
            className="hidden-input"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              showToast('Uploading photo…');
              try {
                const uploaded = await uploadFiles([file]);
                const photoUrl = uploaded[0] || URL.createObjectURL(file);
                setProfile((current) => ({ ...current, photoUrl }));
                await saveProfileToServer({ photoUrl });
              } catch {
                showToast('Could not upload profile photo.');
              }
            }}
            ref={profilePhotoInputRef}
            type="file"
          />
        </div>
        <label>
          <span>About</span>
          <input onChange={(event) => setProfile((current) => ({ ...current, about: event.target.value }))} value={profile.about} />
        </label>
        <label>
          <span>Name</span>
          <input onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} value={profile.name} />
        </label>
        <label>
          <span>Phone number</span>
          <input readOnly value={profile.phone} />
        </label>
        <button className="send-button" onClick={() => void saveProfileToServer()} type="button">Save account</button>

        <div className="business-panel">
          <h3>Linked Devices</h3>
          <p>{linkedDeviceSlots.linkedCount} of {linkedDeviceSlots.limit} web devices linked. {linkedDeviceSlots.remaining} left.</p>
          <button className="settings-auth-button" onClick={() => void fetchLinkedDevices(currentUserId)} type="button">
            Refresh Linked Devices
          </button>
          <div className="linked-device-list">
            {linkedDevices.length ? linkedDevices.map((device) => (
              <div className="linked-device-row" key={device.deviceId}>
                <div>
                  <strong>{device.label}</strong>
                  <small>{device.platform} · last seen {formatRelative(device.lastSeenAt)}</small>
                </div>
                <button
                  onClick={() => {
                    fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(device.deviceId)}`, { method: 'DELETE' })
                      .then(() => fetchLinkedDevices(currentUserId))
                      .catch(() => undefined);
                  }}
                  type="button"
                >
                  Log out
                </button>
              </div>
            )) : <p>No extra linked devices yet.</p>}
          </div>
        </div>
      </>
    );
  };

  const renderSettingsView = () => (
    <main className="settings-shell">
      <aside className="settings-menu">
        <h2>Settings</h2>
        <div className="settings-user">
          <img alt={profile.name} src={profile.photoUrl} />
          <strong>{profile.name}</strong>
        </div>
        <div className="settings-links">
          {SETTINGS_MENU.map((section) => (
            <button
              className={settingsPanel === section.id ? 'active' : ''}
              key={section.id}
              onClick={() => {
                setSettingsPanel(section.id);
                if (section.id === 'privacy') void loadCustomerPreferences();
              }}
              type="button"
            >
              <strong>{section.title}</strong>
              <small>{section.subtitle}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="settings-profile">
        <h2>{SETTINGS_MENU.find((item) => item.id === settingsPanel)?.title || 'Account'}</h2>
        {renderSettingsPanelBody()}
      </section>
    </main>
  );

  const renderCommunityListCard = (community: CommunityPreview) => {
    const selected = selectedCommunityId === community.id;
    return (
      <button
        className={`community-list-item ${selected ? 'active' : ''}`}
        key={community.id}
        onClick={() => void loadCommunityDetail(community.id)}
        type="button"
      >
        <div className="community-list-avatar">
          {community.avatarUrl
            ? <img alt="" src={community.avatarUrl} />
            : (community.name || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="community-list-copy">
          <strong>{community.name}</strong>
          <span>
            {community.privacy}
            {community.memberCount ? ` · ${community.memberCount} members` : ''}
            {community.myState === 'pending' ? ' · pending' : ''}
            {community.muted ? ' · muted' : ''}
          </span>
        </div>
      </button>
    );
  };

  const renderCommunitiesView = () => {
    const detail = communityDetail;
    const role = detail?.myRole ?? communityMembership?.role ?? null;
    const isActiveMember = detail?.myState === 'active' || communityMembership?.state === 'active';
    const isPending = detail?.myState === 'pending' || communityMembership?.state === 'pending';
    const canModerate = isActiveMember && communityRoleAtLeast(role, 'moderator');
    const canAdmin = isActiveMember && communityRoleAtLeast(role, 'admin');

    return (
      <>
        <section className="chat-sidebar community-sidebar">
          <header className="chat-sidebar-header">
            <h1>Communities</h1>
          </header>

          <div className="search-box desktop-search">
            <input
              aria-label="Search communities"
              onChange={(event) => setCommunitiesSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void searchCommunities();
              }}
              placeholder="Search communities"
              value={communitiesSearchQuery}
            />
            <button className="send-button community-inline-btn" onClick={() => void searchCommunities()} type="button">
              Search
            </button>
          </div>

          <div className="community-invite-accept">
            <input
              onChange={(event) => setCommunityInviteTokenDraft(event.target.value)}
              placeholder="Invite token"
              value={communityInviteTokenDraft}
            />
            <button className="send-button community-inline-btn" onClick={() => void acceptCommunityInvite()} type="button">
              Accept
            </button>
          </div>

          <div className="community-sidebar-scroll">
            {communitiesSearchResults.length ? (
              <div className="community-section">
                <h3>Search</h3>
                {communitiesSearchResults.map(renderCommunityListCard)}
                <button
                  className="community-clear-search"
                  onClick={() => setCommunitiesSearchResults([])}
                  type="button"
                >
                  Clear search
                </button>
              </div>
            ) : null}

            <div className="community-section">
              <h3>Mine</h3>
              {communitiesMine.length
                ? communitiesMine.map(renderCommunityListCard)
                : <p className="muted">No communities yet.</p>}
            </div>

            <div className="community-section">
              <h3>Discover</h3>
              {communitiesDiscover.length
                ? communitiesDiscover.map(renderCommunityListCard)
                : <p className="muted">No public communities to discover.</p>}
            </div>

            <div className="community-section community-create-form">
              <h3>Create</h3>
              <label>
                <span>Name</span>
                <input
                  onChange={(event) => setCommunityCreateForm((current) => ({ ...current, name: event.target.value }))}
                  value={communityCreateForm.name}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  onChange={(event) => setCommunityCreateForm((current) => ({ ...current, description: event.target.value }))}
                  value={communityCreateForm.description}
                />
              </label>
              <label>
                <span>Rules</span>
                <textarea
                  onChange={(event) => setCommunityCreateForm((current) => ({ ...current, rules: event.target.value }))}
                  value={communityCreateForm.rules}
                />
              </label>
              <label>
                <span>Privacy</span>
                <select
                  onChange={(event) => setCommunityCreateForm((current) => ({
                    ...current,
                    privacy: event.target.value as CommunityPrivacy,
                  }))}
                  value={communityCreateForm.privacy}
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="invite-only">Invite only</option>
                </select>
              </label>
              <label>
                <span>Avatar URL</span>
                <input
                  onChange={(event) => setCommunityCreateForm((current) => ({ ...current, avatarUrl: event.target.value }))}
                  placeholder="https://..."
                  value={communityCreateForm.avatarUrl}
                />
              </label>
              <button className="send-button" disabled={communityBusy} onClick={() => void createCommunity()} type="button">
                Create community
              </button>
            </div>
          </div>
        </section>

        <main className="panel-shell community-detail-pane">
          {!detail ? (
            <header className="panel-header">
              <div>
                <h2>Communities</h2>
                <p>Select a community or create one to get started.</p>
              </div>
            </header>
          ) : (
            <>
              <header className="panel-header community-detail-header">
                <div>
                  <h2>{detail.name}</h2>
                  <p>
                    {detail.privacy}
                    {detail.memberCount ? ` · ${detail.memberCount} members` : ''}
                    {role ? ` · ${role}` : ''}
                    {isPending ? ' · join pending' : ''}
                  </p>
                </div>
                <div className="community-detail-actions">
                  {!isActiveMember && !isPending ? (
                    <>
                      {(detail.privacy === 'private' || detail.privacy === 'invite-only') ? (
                        <input
                          className="community-join-note"
                          onChange={(event) => setCommunityJoinNote(event.target.value)}
                          placeholder="Optional join note"
                          value={communityJoinNote}
                        />
                      ) : null}
                      <button
                        className="send-button"
                        disabled={communityBusy}
                        onClick={() => void joinCommunity(detail.id)}
                        type="button"
                      >
                        {detail.privacy === 'public' ? 'Join' : 'Request'}
                      </button>
                    </>
                  ) : null}
                  {isPending || isActiveMember ? (
                    <button disabled={communityBusy} onClick={() => void leaveCommunity(detail.id)} type="button">
                      {isPending ? 'Cancel request' : 'Leave'}
                    </button>
                  ) : null}
                  {isActiveMember ? (
                    <button
                      onClick={() => void muteCommunity(detail.id, !detail.muted)}
                      type="button"
                    >
                      {detail.muted ? 'Unmute' : 'Mute'}
                    </button>
                  ) : null}
                </div>
              </header>

              {communityNotice ? <p className="community-notice">{communityNotice}</p> : null}
              {communityBusy ? <p className="muted">Loading…</p> : null}

              <div className="catalog-chips community-tabs">
                {(['overview', 'members', 'requests', 'moderation', 'settings'] as const).map((tab) => {
                  if (tab === 'members' && !isActiveMember) return null;
                  if (tab === 'requests' && !canModerate) return null;
                  if (tab === 'moderation' && !canModerate) return null;
                  if (tab === 'settings' && !canAdmin) return null;
                  return (
                    <button
                      className={communityDetailTab === tab ? 'active' : ''}
                      key={tab}
                      onClick={() => setCommunityDetailTab(tab)}
                      type="button"
                    >
                      {tab === 'overview' ? 'Overview' : tab === 'members' ? 'Members' : tab === 'requests' ? 'Join requests' : tab === 'moderation' ? 'Moderation' : 'Settings'}
                    </button>
                  );
                })}
              </div>

              {communityDetailTab === 'overview' ? (
                <section className="community-overview">
                  {detail.description ? (
                    <div className="community-block">
                      <h3>About</h3>
                      <p>{detail.description}</p>
                    </div>
                  ) : detail.limited ? (
                    <p className="muted">Join to see the full community details.</p>
                  ) : null}
                  {detail.rules ? (
                    <div className="community-block">
                      <h3>Rules</h3>
                      <p className="community-rules">{detail.rules}</p>
                    </div>
                  ) : null}

                  {isActiveMember ? (
                    <div className="community-block">
                      <div className="status-board-header">
                        <h3>Rooms</h3>
                      </div>
                      {communityRooms.length ? (
                        <div className="community-rooms-list">
                          {communityRooms.map((room) => (
                            <article className="community-room-row" key={room.id}>
                              <div>
                                <strong>{room.title}</strong>
                                <small>
                                  {room.topic || (room.isAnnouncement ? 'Announcements' : 'Room')}
                                  {room.canPost === false ? ' · read-only for you' : ''}
                                  {room.allowAnonymous ? ' · anonymous allowed' : ''}
                                </small>
                              </div>
                              <div className="community-room-actions">
                                {canAdmin ? (
                                  <label className="community-checkbox compact">
                                    <input
                                      checked={Boolean(room.allowAnonymous)}
                                      disabled={communityBusy}
                                      onChange={(event) => void updateCommunityRoomAllowAnonymous(
                                        detail.id,
                                        room,
                                        event.target.checked,
                                      )}
                                      type="checkbox"
                                    />
                                    Allow anonymous
                                  </label>
                                ) : null}
                                <button
                                  className="send-button"
                                  onClick={() => openCommunityRoomChat(room)}
                                  type="button"
                                >
                                  Open chat
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">No rooms yet.</p>
                      )}

                      {canAdmin ? (
                        <div className="community-create-room">
                          <h4>Create room</h4>
                          <input
                            onChange={(event) => setCommunityRoomForm((current) => ({ ...current, title: event.target.value }))}
                            placeholder="Room title"
                            value={communityRoomForm.title}
                          />
                          <input
                            onChange={(event) => setCommunityRoomForm((current) => ({ ...current, topic: event.target.value }))}
                            placeholder="Topic"
                            value={communityRoomForm.topic}
                          />
                          <label className="community-checkbox">
                            <input
                              checked={communityRoomForm.isAnnouncement}
                              onChange={(event) => setCommunityRoomForm((current) => ({
                                ...current,
                                isAnnouncement: event.target.checked,
                              }))}
                              type="checkbox"
                            />
                            Announcement room
                          </label>
                          <label className="community-checkbox">
                            <input
                              checked={communityRoomForm.allowAnonymous}
                              onChange={(event) => setCommunityRoomForm((current) => ({
                                ...current,
                                allowAnonymous: event.target.checked,
                              }))}
                              type="checkbox"
                            />
                            Allow anonymous posting
                          </label>
                          <button
                            className="send-button"
                            disabled={communityBusy}
                            onClick={() => void createCommunityRoom(detail.id)}
                            type="button"
                          >
                            Add room
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="community-block">
                    <h3>Report</h3>
                    <input
                      onChange={(event) => setCommunityReportReason(event.target.value)}
                      placeholder="Why are you reporting this community?"
                      value={communityReportReason}
                    />
                    <button onClick={() => void reportCommunity(detail.id)} type="button">
                      Submit report
                    </button>
                  </div>
                </section>
              ) : null}

              {communityDetailTab === 'members' && isActiveMember ? (
                <section className="community-block">
                  <h3>Members</h3>
                  {communityMembers.map((member) => (
                    <article className="community-member-row" key={member.id}>
                      <div>
                        <strong>{member.name || member.userId}</strong>
                        <small>{member.role}</small>
                      </div>
                      <div className="community-member-actions">
                        {canAdmin && member.userId !== currentUserId && member.role !== 'owner' ? (
                          <select
                            onChange={(event) => void setCommunityMemberRole(
                              detail.id,
                              member.userId,
                              event.target.value as CommunityRole,
                            )}
                            value={member.role}
                          >
                            <option value="member">member</option>
                            <option value="moderator">moderator</option>
                            {role === 'owner' ? <option value="admin">admin</option> : null}
                          </select>
                        ) : null}
                        {canModerate && member.userId !== currentUserId && member.role !== 'owner' ? (
                          <button onClick={() => void removeCommunityMember(detail.id, member.userId)} type="button">
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              {communityDetailTab === 'requests' && canModerate ? (
                <section className="community-block">
                  <h3>Join requests</h3>
                  {communityJoinRequests.length ? communityJoinRequests.map((request) => (
                    <article className="community-member-row" key={request.id}>
                      <div>
                        <strong>{request.userId}</strong>
                        <small>{request.note || 'No note'}</small>
                      </div>
                      <div className="community-member-actions">
                        <button onClick={() => void reviewCommunityJoinRequest(detail.id, request.id, 'approve')} type="button">
                          Approve
                        </button>
                        <button onClick={() => void reviewCommunityJoinRequest(detail.id, request.id, 'reject')} type="button">
                          Reject
                        </button>
                      </div>
                    </article>
                  )) : <p className="muted">No pending requests.</p>}
                </section>
              ) : null}

              {communityDetailTab === 'moderation' && canModerate ? (
                <section className="community-overview">
                  <div className="community-block">
                    <h3>Reports</h3>
                    {communityModReports.length ? communityModReports.map((report) => (
                      <article className="community-member-row" key={report.id}>
                        <div>
                          <strong>{report.reason}</strong>
                          <small>{report.state} · {formatClock(report.createdAt)}</small>
                        </div>
                        {report.state === 'pending' ? (
                          <div className="community-member-actions">
                            <button onClick={() => void reviewCommunityReport(report.id, 'reviewed')} type="button">Review</button>
                            <button onClick={() => void reviewCommunityReport(report.id, 'dismissed')} type="button">Dismiss</button>
                            <button onClick={() => void reviewCommunityReport(report.id, 'actioned')} type="button">Actioned</button>
                          </div>
                        ) : null}
                      </article>
                    )) : <p className="muted">No pending reports.</p>}
                  </div>
                  <div className="community-block">
                    <h3>Audit</h3>
                    {communityAudit.length ? communityAudit.slice(0, 40).map((event) => (
                      <article className="community-audit-row" key={event.id}>
                        <strong>{event.action}</strong>
                        <span>{event.detail}</span>
                        <small>{formatClock(event.createdAt)}</small>
                      </article>
                    )) : <p className="muted">No audit events.</p>}
                  </div>
                </section>
              ) : null}

              {communityDetailTab === 'settings' && canAdmin ? (
                <section className="community-block community-create-form">
                  <h3>Settings</h3>
                  <label>
                    <span>Name</span>
                    <input
                      onChange={(event) => setCommunityEditForm((current) => ({ ...current, name: event.target.value }))}
                      value={communityEditForm.name}
                    />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea
                      onChange={(event) => setCommunityEditForm((current) => ({ ...current, description: event.target.value }))}
                      value={communityEditForm.description}
                    />
                  </label>
                  <label>
                    <span>Rules</span>
                    <textarea
                      onChange={(event) => setCommunityEditForm((current) => ({ ...current, rules: event.target.value }))}
                      value={communityEditForm.rules}
                    />
                  </label>
                  <label>
                    <span>Privacy</span>
                    <select
                      onChange={(event) => setCommunityEditForm((current) => ({
                        ...current,
                        privacy: event.target.value as CommunityPrivacy,
                      }))}
                      value={communityEditForm.privacy}
                    >
                      <option value="public">Public</option>
                      <option value="private">Private</option>
                      <option value="invite-only">Invite only</option>
                    </select>
                  </label>
                  <label>
                    <span>Avatar URL</span>
                    <input
                      onChange={(event) => setCommunityEditForm((current) => ({ ...current, avatarUrl: event.target.value }))}
                      value={communityEditForm.avatarUrl}
                    />
                  </label>
                  <label className="community-checkbox">
                    <input
                      checked={communityEditForm.pinnedRules}
                      onChange={(event) => setCommunityEditForm((current) => ({
                        ...current,
                        pinnedRules: event.target.checked,
                      }))}
                      type="checkbox"
                    />
                    Pin rules
                  </label>
                  <button
                    className="send-button"
                    disabled={communityBusy}
                    onClick={() => void saveCommunitySettings(detail.id)}
                    type="button"
                  >
                    Save settings
                  </button>

                  <div className="community-invite-box">
                    <h4>Invites</h4>
                    <button onClick={() => void createCommunityInvite(detail.id)} type="button">
                      Create invite token
                    </button>
                    {communityCreatedInviteToken ? (
                      <p className="community-token">
                        Token: <code>{communityCreatedInviteToken}</code>
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </main>
      </>
    );
  };

  const renderUpdatesView = () => (
    <main className="panel-shell">
      <header className="panel-header">
        <div>
          <h2>Updates</h2>
          <p>Share photos or launch the text composer like on mobile.</p>
        </div>
      </header>

      <section className="status-board">
        <div className="status-board-header">
          <div>
            <h3>Status</h3>
            <p>{statuses.length} live update{statuses.length === 1 ? '' : 's'}</p>
          </div>
          <div className="status-board-actions">
            <button onClick={() => statusInputRef.current?.click()} type="button">📷+</button>
            <button onClick={() => setStatusComposerVisible(true)} type="button">✎</button>
          </div>
        </div>

        <div className="status-strip">
          {updatesFeed.map((entry, index) => {
            const cover = entry.items[0]?.assets?.[0]?.url ?? '';
            const latestStatus = entry.items[0];
            const isMine = entry.userId === currentUserId;
            return (
              <article
                className="status-card status-card-interactive"
                key={entry.userId}
                onClick={() => openStatusViewer(index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openStatusViewer(index);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="status-card-media">
                  {cover ? <img alt={entry.name} src={cover} /> : <div className="status-card-fallback">{entry.name.slice(0, 1)}</div>}
                  <div className="status-card-ring">
                    <div className="status-card-avatar">{entry.avatar}</div>
                  </div>
                  <div className="status-card-count">{entry.items.length}</div>
                  {isMine && latestStatus ? (
                    <button
                      className="status-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        fetch(`${API_BASE_URL}/api/statuses/${latestStatus.id}?userId=${currentUserId}`, {
                          method: 'DELETE',
                        }).catch(() => undefined);
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
                <div className="status-card-copy">
                  <strong>{entry.name}</strong>
                  <span>{latestStatus?.text || formatRelative(entry.latestAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );

  const renderDesktopLinkGate = () => (
    <div className="desktop-link-gate">
      <div className="desktop-link-backdrop">
        <div className="desktop-link-float title">Zynkup</div>
        <div className="desktop-link-float chat">Chat sent</div>
        <div className="desktop-link-float reply">Reply delivered</div>
        <div className="desktop-link-float call">Video call connected</div>
        <div className="desktop-link-float status">Status updated</div>
      </div>
      <div className="desktop-link-overlay" />
      <div className="desktop-link-card">
        <div className="desktop-link-copy">
          <span className="desktop-link-badge">Mobile First</span>
          <h2>Scan To Log In</h2>
          <ol>
            <li>Register and verify your number on mobile.</li>
            <li>Open `Settings` then `Link devices` on your phone.</li>
            <li>Scan this QR code to sync chats, contacts, calls, status, and profile.</li>
          </ol>
          <p>Desktop mirrors your mobile in real time while both devices stay online.</p>
          <small>Web linking is limited to 4 devices. The phone app itself is not one of those slots. Log out of a linked browser to free one.</small>
        </div>
        <div className="desktop-link-qr-panel">
          {linkQrDataUrl ? <img alt="Link Zynkup desktop" src={linkQrDataUrl} /> : <div className="desktop-link-qr-placeholder">Preparing QR...</div>}
          {linkStatus === 'pin_required' ? (
            <div className="desktop-pin-card">
              <strong>Enter your app pin</strong>
              <input
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setDesktopPin(event.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                placeholder="4-digit pin"
                value={desktopPin}
              />
              <button className="send-button" onClick={() => void verifyDesktopPin()} type="button">Unlock Desktop</button>
            </div>
          ) : null}
          {linkStatus === 'expired' ? (
            <button className="send-button" onClick={() => void createDesktopLinkRequest()} type="button">Refresh QR</button>
          ) : null}
          {linkError ? <p className="desktop-link-error">{linkError}</p> : null}
        </div>
      </div>
    </div>
  );

  return (
    <div className="desktop-shell">
      <input
        accept="image/*"
        className="hidden-input"
        multiple
        onChange={(event) => {
          setCatalogAssetFiles(Array.from(event.target.files ?? []));
        }}
        ref={catalogInputRef}
        type="file"
      />
      <aside className="rail">
        <div className="rail-icons">
          <button className={`rail-button rail-badged ${activeView === 'chats' ? 'active' : ''}`} onClick={() => setActiveView('chats')} type="button">
            💬
            {(() => {
              const unreadTotal = chatItems.reduce((sum, chat) => sum + (chat.unread || 0), 0);
              return unreadTotal > 0 ? <span>{unreadTotal}</span> : null;
            })()}
          </button>
          <button className={`rail-button ${activeView === 'calls' ? 'active' : ''}`} onClick={() => setActiveView('calls')} type="button">☎</button>
          <button className={`rail-button ${activeView === 'updates' ? 'active' : ''}`} onClick={() => setActiveView('updates')} type="button">◌</button>
          <button className={`rail-button ${activeView === 'communities' ? 'active' : ''}`} onClick={() => setActiveView('communities')} type="button" title="Communities">◎</button>
          <button className={`rail-button ${activeView === 'voiceRooms' ? 'active' : ''}`} onClick={() => setActiveView('voiceRooms')} type="button" title="Voice rooms">🎙</button>
          <button className={`rail-button ${activeView === 'games' ? 'active' : ''}`} onClick={() => setActiveView('games')} type="button" title="Games">🎮</button>
          <button className={`rail-button ${activeView === 'catalog' ? 'active' : ''}`} onClick={() => setActiveView('catalog')} type="button">🏬</button>
          <button className={`rail-button ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')} type="button">⚙</button>
        </div>
        <button className="rail-button rail-bottom" onClick={() => setActiveView('settings')} type="button">⚙</button>
      </aside>

      {activeView === 'chats' ? renderChatsView() : null}
      {activeView === 'calls' ? renderCallsView() : null}
      {activeView === 'updates' ? renderUpdatesView() : null}
      {activeView === 'communities' ? renderCommunitiesView() : null}
      {activeView === 'voiceRooms' ? renderVoiceRoomsView() : null}
      {activeView === 'games' ? renderGamesView() : null}
      {activeView === 'catalog' ? renderCatalogView() : null}
      {activeView === 'settings' ? renderSettingsView() : null}

      {toastMessage ? <div className="web-toast">{toastMessage}</div> : null}

      {gamePendingInvite ? (
        <div className="modal-overlay" onClick={() => setGamePendingInvite(null)}>
          <div className="dialog-card game-invite-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Game invite</h3>
            <p>
              {getUserMeta(gamePendingInvite.fromUserId).name}
              {' invited you to '}
              {gamePendingInvite.title || gamePendingInvite.gameSlug || 'a game'}
              .
            </p>
            <p className="game-points-note muted">{gamePointsNote}</p>
            <button
              disabled={gameBusy}
              onClick={() => void declineGameInvite(gamePendingInvite.sessionId)}
              type="button"
            >
              Decline
            </button>
            <button
              className="send-button"
              disabled={gameBusy}
              onClick={() => void acceptGameInvite(gamePendingInvite.sessionId)}
              type="button"
            >
              Accept
            </button>
          </div>
        </div>
      ) : null}

      {messageActionTarget ? (
        <div className="modal-overlay" onClick={() => setMessageActionTarget(null)}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h3>Message</h3>
            <button
              onClick={() => {
                setReplyTarget(messageActionTarget);
                setMessageActionTarget(null);
              }}
              type="button"
            >
              Reply
            </button>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(messageActionTarget.text || '').then(
                  () => showToast('Copied'),
                  () => showToast('Could not copy'),
                );
                setMessageActionTarget(null);
              }}
              type="button"
            >
              Copy
            </button>
            <button onClick={() => void forwardMessage(messageActionTarget)} type="button">Forward</button>
            <button onClick={() => void deleteMessage(messageActionTarget, 'me')} type="button">Delete for me</button>
            {messageActionTarget.sender === 'me' ? (
              <button onClick={() => void deleteMessage(messageActionTarget, 'everyone')} type="button">Delete for everyone</button>
            ) : null}
            {messageActionTarget.anonymous && canRevealAnonymousAuthor(activeChat) ? (
              <button
                disabled={anonymousRevealBusy}
                onClick={() => void revealAnonymousAuthor(messageActionTarget)}
                type="button"
              >
                Reveal author
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {anonymousDisclosureOpen ? (
        <div className="modal-overlay" onClick={() => setAnonymousDisclosureOpen(false)}>
          <div className="dialog-card anonymous-disclosure-card" onClick={(event) => event.stopPropagation()}>
            <h3>Anonymous posting</h3>
            <p>
              Your display name is hidden from other members in this room. Anonymity is limited —
              moderators and group admins can reveal authors during abuse investigations, and those
              reveals are audited.
            </p>
            <div className="anonymous-disclosure-actions">
              <button onClick={() => setAnonymousDisclosureOpen(false)} type="button">
                Cancel
              </button>
              <button
                className="send-button"
                onClick={() => {
                  setAnonymousDisclosureAccepted(true);
                  setAnonymousCompose(true);
                  setAnonymousDisclosureOpen(false);
                }}
                type="button"
              >
                Continue anonymously
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {anonymousRevealResult ? (
        <div className="modal-overlay" onClick={() => setAnonymousRevealResult(null)}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h3>Author revealed</h3>
            <p>
              <strong>{anonymousRevealResult.authorName || 'Unknown member'}</strong>
              {anonymousRevealResult.authorUserId
                ? ` (${anonymousRevealResult.authorUserId})`
                : ''}
            </p>
            <p className="muted" role="note">
              {anonymousRevealResult.notice || 'Reveals are logged for moderation accountability.'}
            </p>
            <button onClick={() => setAnonymousRevealResult(null)} type="button">
              Close
            </button>
          </div>
        </div>
      ) : null}

      {callSheetVisible ? (
        <div className="call-type-dropdown" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void startCall('audio')} type="button">Audio Call</button>
          <button onClick={() => void startCall('video')} type="button">Video Call</button>
          <small>{calls.length} synced call record{calls.length === 1 ? '' : 's'}</small>
          <button className="call-type-close" onClick={() => setCallSheetVisible(false)} type="button">Close</button>
        </div>
      ) : null}

      {callSheetVisible ? (
        <div className="call-type-backdrop" onClick={() => setCallSheetVisible(false)} />
      ) : null}

      {activeCall ? (() => {
        const peer = users.find((user) => user.id === activeCall.peerUserId);
        const peerPhoto = peer?.photoUri || '';
        const localVideoLive = Boolean(localCallStream?.getVideoTracks().some((track) => track.enabled && track.readyState === 'live')) && !callCameraOff;
        const remoteVideoLive = Boolean(remoteCallStream?.getVideoTracks().some((track) => track.enabled && track.readyState === 'live' && !track.muted)) && !remoteCameraOff;
        const showRemoteVideo = activeCall.kind === 'video' && remoteVideoLive;
        const showLocalVideo = activeCall.kind === 'video' && localVideoLive;
        const canAnswer = activeCall.state === 'ringing' && activeCall.initiatorId !== currentUserId;
        const answered = activeCall.state === 'ongoing';
        return (
          <div className="call-stage">
            {showRemoteVideo ? (
              <video autoPlay className="call-stage-main" playsInline ref={remoteVideoRef} />
            ) : (
              <div className="call-stage-fallback">
                {peerPhoto ? <img alt="" src={peerPhoto} /> : <span>{(activeCall.peerName || '?').slice(0, 1).toUpperCase()}</span>}
              </div>
            )}
            {activeCall.kind === 'video' && (showLocalVideo || profile.photoUrl) ? (
              <div className="call-stage-pip">
                {showLocalVideo ? (
                  <video autoPlay muted playsInline ref={localVideoRef} />
                ) : (
                  profile.photoUrl ? <img alt="" src={profile.photoUrl} /> : <span>You</span>
                )}
              </div>
            ) : null}
            <div className="call-stage-top">
              <strong>{activeCall.peerName}</strong>
              <span>
                {answered
                  ? formatDurationLabel(activeCallSeconds)
                  : canAnswer
                    ? `Incoming ${activeCall.kind === 'video' ? 'video' : 'voice'} call`
                    : 'Ringing...'}
              </span>
              {callError ? <em>{callError}</em> : null}
            </div>
            <div className="call-stage-actions">
              <button disabled={!answered} onClick={() => setCallAudioMuted(!callMuted)} type="button">{callMuted ? 'Unmute' : 'Mute'}</button>
              {activeCall.kind === 'video' ? (
                <button disabled={!answered} onClick={() => setCallVideoEnabled(callCameraOff)} type="button">{callCameraOff ? 'Camera' : 'Cam off'}</button>
              ) : (
                <button disabled={!answered} onClick={() => {
                  emitCallSignal(activeCall.id, 'video-upgrade', { from: currentUserId }, activeCall.peerUserId);
                  showToast('Asked them to switch to video.');
                }} type="button">Video</button>
              )}
              {canAnswer ? (
                <button className="answer" onClick={() => void acceptIncomingCall()} type="button">Answer</button>
              ) : null}
              <button className="end" onClick={() => void endActiveCall()} type="button">{answered ? 'End' : canAnswer ? 'Decline' : 'Cancel'}</button>
            </div>
          </div>
        );
      })() : null}

      {mediaViewer ? (
        <div className="modal-overlay" onClick={() => setMediaViewer(null)}>
          <div className="viewer-card" onClick={(event) => event.stopPropagation()}>
            <img alt="Selected media" src={mediaViewer} />
          </div>
        </div>
      ) : null}

      {activeStatusGroup && activeStatusItem ? (
        <div className="modal-overlay status-viewer-overlay" onClick={closeStatusViewer}>
          <div className="status-viewer" onClick={(event) => event.stopPropagation()}>
            <div className="status-viewer-top">
              <div className="status-viewer-progress">
                {activeStatusGroup.items.map((item, index) => (
                  <div className="status-progress-track" key={item.id}>
                    <div
                      className="status-progress-fill"
                      style={{
                        width:
                          index < activeStatusItemIndex
                            ? '100%'
                            : index === activeStatusItemIndex
                              ? `${Math.round(statusProgress * 100)}%`
                              : '0%',
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="status-viewer-header">
                <div className="status-viewer-user">
                  <div className="status-card-avatar">{activeStatusGroup.avatar}</div>
                  <div>
                    <strong>{activeStatusGroup.name}</strong>
                    <span>{formatRelative(activeStatusItem.createdAt)}</span>
                  </div>
                </div>
                <button className="status-viewer-close" onClick={closeStatusViewer} type="button">
                  Close
                </button>
              </div>
            </div>

            <div
              className="status-viewer-body"
              onMouseDown={() => setStatusHoldActive(true)}
              onMouseUp={() => setStatusHoldActive(false)}
              onMouseLeave={() => setStatusHoldActive(false)}
              onTouchStart={() => setStatusHoldActive(true)}
              onTouchEnd={() => setStatusHoldActive(false)}
            >
              <button className="status-hit-zone left" onClick={() => moveStatus('previous')} type="button" />
              <div className="status-viewer-media">
                {activeStatusItem.assets[0]?.url ? (
                  <img alt={activeStatusItem.text || activeStatusGroup.name} src={activeStatusItem.assets[0].url} />
                ) : (
                  <div
                    className="status-viewer-fallback"
                    style={{
                      background: activeStatusItem.backgroundColor ?? '#162235',
                      fontFamily: activeStatusItem.fontFamily ?? 'inherit',
                      fontSize: activeStatusItem.fontSize ? `${activeStatusItem.fontSize}px` : undefined,
                    }}
                  >
                    {activeStatusItem.text || activeStatusGroup.name.slice(0, 1)}
                  </div>
                )}
                <div className="status-viewer-caption">
                  <strong>{activeStatusGroup.name}</strong>
                  <p>{activeStatusItem.text || activeStatusItem.assets[0]?.caption || 'Status update'}</p>
                  <div className="status-viewer-stats">
                    <button className="status-stat-button" onClick={openViewerList} type="button">
                      Views {activeStatusItem.views?.length ?? 0}
                    </button>
                    <button className="status-stat-button" onClick={() => setStatusThreadVisible(true)} type="button">
                      Replies {activeStatusItem.comments?.length ?? 0}
                    </button>
                    <button className="status-stat-button" onClick={openReactorList} type="button">
                      Reactions {activeStatusItem.reactions?.length ?? 0}
                    </button>
                  </div>
                  <div className="status-reaction-row">
                    {STATUS_REACTIONS.map((emoji) => (
                      <button key={emoji} className={`status-reaction-button ${(activeStatusItem.reactions ?? []).some((reaction) => reaction.userId === currentUserId && reaction.emoji === emoji) ? 'active' : ''}`} onClick={() => submitStatusReaction(emoji)} type="button">
                        {emoji}
                        <small>{(activeStatusItem.reactions ?? []).filter((reaction) => reaction.emoji === emoji).length}</small>
                      </button>
                    ))}
                  </div>
                  <div className="status-action-row">
                    <button className="status-viewer-action" onClick={() => submitStatusReaction('❤️')} type="button">♡</button>
                    <button className="status-viewer-action reply" onClick={() => setStatusReplyVisible(true)} type="button">Reply</button>
                    <button className="status-viewer-action done" onClick={closeStatusViewer} type="button">Done</button>
                  </div>
                  {activeStatusItem.comments?.length ? (
                    <div className="status-comment-preview">
                      Latest reply: {activeStatusItem.comments[activeStatusItem.comments.length - 1]?.text}
                    </div>
                  ) : null}
                </div>
              </div>
              <button className="status-hit-zone right" onClick={() => moveStatus('next')} type="button" />
            </div>
          </div>
        </div>
      ) : null}

      {statusComposerVisible ? (
        <div className="modal-overlay" onClick={() => setStatusComposerVisible(false)}>
          <div className="dialog-card status-composer-card" onClick={(event) => event.stopPropagation()}>
            <div className="status-composer-header">
              <h3>Create Text Status</h3>
              <button onClick={() => setStatusComposerVisible(false)} type="button">Close</button>
            </div>
            <div className="status-composer-preview" style={{ background: statusBackgroundColor }}>
              <p
                style={{
                  fontSize: `${statusFontSize}px`,
                  fontFamily: statusFontFamily === 'System' ? 'inherit' : statusFontFamily,
                }}
              >
                {statusText || 'Type your status'}
              </p>
            </div>
            <textarea
              onChange={(event) => setStatusText(event.target.value)}
              placeholder="Share an update"
              value={statusText}
            />
            <div className="status-composer-options">
              {['#10233e', '#1b1737', '#234229', '#4b1f1f', '#5a3a12'].map((color) => (
                <button
                  key={color}
                  className={`status-color-chip ${statusBackgroundColor === color ? 'active' : ''}`}
                  onClick={() => setStatusBackgroundColor(color)}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>
            <div className="status-composer-options">
              {['System', 'Georgia', 'Courier New', 'Trebuchet MS'].map((font) => (
                <button
                  key={font}
                  className={statusFontFamily === font ? 'active' : ''}
                  onClick={() => setStatusFontFamily(font)}
                  type="button"
                >
                  <span style={{ fontFamily: font === 'System' ? 'inherit' : font }}>{font}</span>
                </button>
              ))}
            </div>
            <div className="status-composer-options">
              {[22, 30, 38].map((size) => (
                <button
                  key={size}
                  className={statusFontSize === size ? 'active' : ''}
                  onClick={() => setStatusFontSize(size)}
                  type="button"
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="status-composer-options">
              {([
                ['contacts', 'My contacts'],
                ['public', 'Public'],
                ['marketplace', 'Marketplace'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  className={statusAudience === id ? 'active' : ''}
                  onClick={() => setStatusAudience(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="send-button" onClick={postStatus} type="button">Post Status</button>
          </div>
        </div>
      ) : null}

      {statusViewersVisible ? (
        <div className="modal-overlay" onClick={() => setStatusViewersVisible(false)}>
          <div className="dialog-card status-viewers-card" onClick={(event) => event.stopPropagation()}>
            <h3>Viewed By</h3>
            {statusViewers.length ? statusViewers.map((viewer) => (
              <div className="status-viewer-row" key={`${viewer.userId}-${viewer.viewedAt}`}>
                <strong>{viewer.name}</strong>
                <span>{formatClock(viewer.viewedAt)}</span>
              </div>
            )) : <p>No viewers yet.</p>}
          </div>
        </div>
      ) : null}

      {statusReactorsVisible ? (
        <div className="modal-overlay" onClick={() => setStatusReactorsVisible(false)}>
          <div className="dialog-card status-viewers-card" onClick={(event) => event.stopPropagation()}>
            <h3>Reactions</h3>
            {statusReactors.length ? statusReactors.map((reactor) => (
              <div className="status-viewer-row" key={`${reactor.userId}-${reactor.reactedAt}`}>
                <strong>{reactor.emoji} {reactor.name}</strong>
                <span>{formatClock(reactor.reactedAt)}</span>
              </div>
            )) : <p>No reactions yet.</p>}
          </div>
        </div>
      ) : null}

      {statusReplyVisible && activeStatusItem ? (
        <div className="modal-overlay" onClick={() => setStatusReplyVisible(false)}>
          <div className="dialog-card status-thread-card" onClick={(event) => event.stopPropagation()}>
            <h3>Reply</h3>
            {activeStatusItem.comments?.length ? (
              <div className="status-comment-sheet-list">
                {activeStatusItem.comments.slice(-3).map((comment) => {
                  const meta = getUserMeta(comment.userId);
                  return (
                    <div className="status-comment-item polished" key={comment.id}>
                      <div className="status-comment-author">
                        <div className="avatar inline-avatar">{meta.avatar}</div>
                        <div>
                          <strong>{meta.name}</strong>
                          <small>{formatClock(comment.updatedAt ?? comment.createdAt)}</small>
                        </div>
                      </div>
                      <span>{comment.text}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="status-comment-editor">
              <textarea
                onChange={(event) => setStatusCommentDraft(event.target.value)}
                placeholder="Write a reply"
                value={statusCommentDraft}
              />
              <div className="status-comment-controls">
                <button className="status-link-button" onClick={() => setStatusReplyVisible(false)} type="button">Discard</button>
                <button className="status-link-button" onClick={submitStatusComment} type="button">Send</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {statusThreadVisible && activeStatusItem ? (
        <div className="modal-overlay" onClick={() => setStatusThreadVisible(false)}>
          <div className="dialog-card status-thread-card" onClick={(event) => event.stopPropagation()}>
            <h3>Replies</h3>
            {activeStatusItem.comments?.length ? activeStatusItem.comments.map((comment) => {
              const meta = getUserMeta(comment.userId);
              const isMine = comment.userId === currentUserId;
              const isEditing = editingStatusCommentId === comment.id;
              return (
                <div className="status-comment-item polished" key={comment.id}>
                  <div className="status-comment-topline">
                    <div className="status-comment-author">
                      <div className="avatar inline-avatar">{meta.avatar}</div>
                      <div>
                        <strong>{meta.name}</strong>
                        <small>{formatClock(comment.updatedAt ?? comment.createdAt)}{comment.updatedAt ? ' edited' : ''}</small>
                      </div>
                    </div>
                    {isMine ? (
                      <div className="status-comment-controls">
                        <button className="status-link-button" onClick={() => startEditingStatusComment(comment.id, comment.text)} type="button">Edit</button>
                        <button className="status-link-button danger" onClick={() => deleteStatusComment(comment.id)} type="button">Delete</button>
                      </div>
                    ) : null}
                  </div>
                  {isEditing ? (
                    <div className="status-comment-editor">
                      <textarea
                        onChange={(event) => setEditingStatusCommentText(event.target.value)}
                        value={editingStatusCommentText}
                      />
                      <div className="status-comment-controls">
                        <button className="status-link-button" onClick={saveStatusCommentEdit} type="button">Save</button>
                        <button className="status-link-button" onClick={() => { setEditingStatusCommentId(null); setEditingStatusCommentText(''); }} type="button">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <span>{comment.text}</span>
                  )}
                </div>
              );
            }) : <p>No replies yet.</p>}
          </div>
        </div>
      ) : null}

      {newChatVisible ? (
        <div className="modal-overlay" onClick={() => setNewChatVisible(false)}>
          <div className="dialog-card auth-card" onClick={(event) => event.stopPropagation()}>
            <h3>New Conversation</h3>
            <div className="auth-account-list">
              {users.filter((user) => user.id !== currentUserId).map((user) => (
                <button key={user.id} onClick={() => void createDirectChat(user.id)} type="button">
                  {user.name} · {user.phone}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {authRequired ? renderDesktopLinkGate() : null}
    </div>
  );
}

export default App;
