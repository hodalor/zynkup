import 'dotenv/config';
import { App, cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { v2 as cloudinary } from 'cloudinary';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import helmet from 'helmet';
import http from 'http';
import multer from 'multer';
import { Collection, Db, Document, MongoClient } from 'mongodb';
import morgan from 'morgan';
import path from 'path';
import { Server } from 'socket.io';
import { z } from 'zod';
import { findPhoneBlock, mountAdmin, readAppConfig, recordAdminEvent } from './adminApi.js';
import {
  actorCanModerateCommunity,
  appendCommunityAudit,
  assertCommunityRoomCanPost,
  findCommunityRoomByChatId,
  mountCommunities,
  type CommunitiesDeps,
  type CommunityChat,
} from './communitiesApi.js';
import {
  mountVoiceRooms,
  type VoiceRoomsDeps,
} from './voiceRoomsApi.js';
import {
  registerGamesApi,
  type GamesDeps,
} from './gamesApi.js';

type Presence = 'online' | 'offline' | 'typing';
type MessageKind = 'text' | 'emoji' | 'image' | 'video' | 'voice' | 'file' | 'call';
type MediaKind = 'image' | 'video' | 'document';

type User = {
  id: string;
  name: string;
  avatar: string;
  presence: Presence;
  phone: string;
  about: string;
  isBusiness: boolean;
  lastSeenAt?: string;
  photoUri?: string;
  username?: string;
};

type Message = {
  id: string;
  chatId: string;
  senderId: string;
  clientRef?: string;
  kind: MessageKind;
  text: string;
  mediaUrls: string[];
  sentAt: string;
  state: 'sent' | 'delivered' | 'read';
  durationSeconds?: number;
  deliveredAt?: string;
  readAt?: string;
  replyToMessageId?: string;
  replyPreview?: string;
  catalogItemId?: string;
  receiptId?: string;
  deletedForEveryone?: boolean;
  deletedFor?: string[];
  anonymous?: boolean;
  anonymousDay?: string;
  callKind?: 'audio' | 'video';
  callState?: 'missed' | 'declined' | 'completed';
  actorBusinessId?: string;
  actorName?: string;
  expiresAt?: string;
  automated?: boolean;
  autoReplySource?: string;
  documentId?: string;
  documentKind?: 'quotation' | 'invoice';
  broadcastCampaignId?: string;
  transcript?: string;
  transcriptStatus?: 'pending' | 'ready' | 'failed' | 'unavailable';
  transcriptLanguage?: string;
  transcriptUpdatedAt?: string;
};

type Chat = {
  id: string;
  title: string;
  kind: 'direct' | 'group';
  participants: string[];
  adminIds?: string[];
  unreadCount: number;
  unreadByUser?: Record<string, number>;
  lastMessagePreview: string;
  updatedAt: string;
  space?: string;
  disappearAfterSeconds?: number;
  /** When set, this group chat is a topic room inside a community. */
  communityId?: string;
  /** Opt-in anonymous posting; synced from community room when applicable. Default false. */
  allowAnonymous?: boolean;
};

type Contact = {
  id: string;
  ownerUserId: string;
  name: string;
  phone: string;
  normalizedPhone: string;
  linkedUserId: string | null;
  registered: boolean;
  presence: Presence;
};

type Call = {
  id: string;
  participantIds: string[];
  initiatorId: string;
  kind: 'audio' | 'video';
  direction: 'incoming' | 'outgoing';
  state: 'ringing' | 'completed' | 'missed' | 'ongoing' | 'declined';
  startedAt: string;
  durationSeconds: number;
  answeredAt?: string;
  endedAt?: string;
  logged?: boolean;
  hiddenFor?: string[];
};

type StatusAsset = {
  id: string;
  kind: MediaKind;
  url: string;
  caption?: string;
};

type StatusPost = {
  id: string;
  userId: string;
  text: string;
  assets: StatusAsset[];
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  catalogItemId?: string;
  reactions: Array<{
    userId: string;
    emoji: string;
    reactedAt: string;
  }>;
  comments: Array<{
    id: string;
    userId: string;
    text: string;
    createdAt: string;
    updatedAt?: string;
  }>;
  views: Array<{
    userId: string;
    viewedAt: string;
  }>;
  createdAt: string;
  expiresAt: string;
  audience: 'contacts' | 'close-friends' | 'public' | 'marketplace';
  businessId?: string;
  businessName?: string;
};

type ChatRequest = {
  id: string;
  fromUserId: string;
  toUserId: string;
  statusId?: string;
  note?: string;
  state: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};

type CatalogProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';

type CatalogVariant = {
  id: string;
  name: string;
  options: string[];
};

type CatalogItem = {
  id: string;
  sellerId: string;
  businessId?: string | null;
  title: string;
  price: number;
  currency: string;
  category: string;
  description: string;
  imageUrls: string[];
  stockQuantity: number;
  reservedQuantity?: number;
  trackStock?: boolean;
  costPrice?: number | null;
  lowStockThreshold?: number;
  status?: CatalogProductStatus;
  variants?: CatalogVariant[];
  availabilityUpdatedAt?: string;
  isPublic?: boolean;
  location?: string;
  condition?: 'New' | 'Used';
  takenDown?: boolean;
  boostedUntil?: string | null;
  boostText?: string;
  createdAt: string;
  updatedAt: string;
};

type InventoryMovementKind = 'sale' | 'return' | 'receipt' | 'adjustment' | 'reservation' | 'release';

type InventoryMovement = {
  id: string;
  catalogItemId: string;
  sellerUserId: string;
  businessId?: string | null;
  kind: InventoryMovementKind;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  orderId?: string | null;
  byUserId: string;
  createdAt: string;
};

type InventoryAlert = {
  id: string;
  catalogItemId: string;
  sellerUserId: string;
  businessId?: string | null;
  title: string;
  stockQuantity: number;
  lowStockThreshold: number;
  state: 'open' | 'reviewed';
  createdAt: string;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
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

type AutoReplyRule = {
  id: string;
  keywords: string[];
  response: string;
  enabled: boolean;
};

type BusinessAutoReplyConfig = {
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
type QuotationState = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
type InvoiceState = 'draft' | 'sent' | 'accepted' | 'rejected' | 'paid' | 'overdue' | 'voided';

type CommerceDocLine = {
  id: string;
  catalogItemId?: string | null;
  title: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type CommerceDocument = {
  id: string;
  kind: CommerceDocKind;
  number: string;
  sellerUserId: string;
  businessId?: string | null;
  customerUserId?: string | null;
  customerName: string;
  customerPhone?: string;
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
  state: QuotationState | InvoiceState;
  version: number;
  versions: Array<{
    version: number;
    at: string;
    byUserId: string;
    snapshot: {
      lines: CommerceDocLine[];
      subtotal: number;
      discountAmount: number;
      taxAmount: number;
      totalAmount: number;
      notes?: string;
      paymentTerms?: string;
    };
  }>;
  history: Array<{ state: string; at: string; byUserId: string; note?: string }>;
  sourceQuotationId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  receiptId?: string | null;
  messageId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BroadcastSegment = 'opted_in' | 'repeat_buyers' | 'all_customers' | 'tag';

type BroadcastCampaign = {
  id: string;
  sellerUserId: string;
  businessId?: string | null;
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

type OrderState =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'dispatched'
  | 'completed'
  | 'cancelled'
  | 'refunded';

type OrderItemSnapshot = {
  catalogItemId: string;
  title: string;
  price: number;
  currency: string;
  quantity: number;
  variantSelections?: Array<{ name: string; option: string }>;
  imageUrl?: string;
};

type CommerceOrder = {
  id: string;
  buyerUserId: string;
  sellerUserId: string;
  businessId?: string | null;
  statusId?: string | null;
  chatId?: string | null;
  paymentId?: string | null;
  receiptId?: string | null;
  clientRequestId?: string | null;
  items: OrderItemSnapshot[];
  totalAmount: number;
  currency: string;
  state: OrderState;
  deliveryReference?: string | null;
  fulfilmentNote?: string | null;
  history: Array<{ state: OrderState; at: string; byUserId: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
};

type SaleReceiptState = 'issued' | 'voided' | 'refunded';

type SaleReceipt = {
  id: string;
  receiptNumber: string;
  orderId: string;
  paymentId?: string | null;
  buyerUserId: string;
  sellerUserId: string;
  businessId?: string | null;
  businessName: string;
  sellerName: string;
  buyerName: string;
  items: OrderItemSnapshot[];
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  state: SaleReceiptState;
  linkedReceiptId?: string | null;
  issuedAt: string;
  createdAt: string;
  updatedAt: string;
};

type Profile = {
  id: string;
  name: string;
  username: string;
  avatar: string;
  about: string;
  phone: string;
  countryCode?: string;
  phoneVerifiedAt?: string | null;
  appLockEnabled?: boolean;
  pinHash?: string | null;
  businessName: string;
  businessDescription: string;
  currency?: string;
  photoUri?: string;
  lastSeenPrivacy?: 'everyone' | 'contacts' | 'nobody';
  profilePhotoPrivacy?: 'everyone' | 'contacts' | 'nobody';
  aboutPrivacy?: 'everyone' | 'contacts' | 'nobody';
  statusPrivacy?: 'contacts' | 'close-friends' | 'nobody';
  typingPrivacy?: 'everyone' | 'contacts' | 'nobody';
  callPrivacy?: 'everyone' | 'contacts' | 'nobody';
  groupInvitePrivacy?: 'everyone' | 'contacts' | 'nobody';
  readReceiptsEnabled?: boolean;
  blockedUserIds?: string[];
  blocked?: boolean;
  blockedUntil?: string | null;
  activeBusinessId?: string | null;
};

type BusinessRole = 'owner' | 'manager' | 'sales' | 'support';

type BusinessMember = {
  userId: string;
  role: BusinessRole;
  addedAt: string;
};

type BusinessVerificationStatus = 'unverified' | 'pending' | 'approved' | 'rejected';
type BusinessVisibility = 'draft' | 'published';

type BusinessProfile = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  logoUrl?: string;
  location?: string;
  hours?: string;
  contactButtonLabel?: string;
  showPhone?: boolean;
  visibility?: BusinessVisibility;
  verificationStatus?: BusinessVerificationStatus;
  verificationNote?: string;
  verificationEvidenceUrls?: string[];
  verificationSubmittedAt?: string | null;
  verificationReviewedAt?: string | null;
  verificationReviewNote?: string;
  createdAt: string;
  updatedAt: string;
  members: BusinessMember[];
};

type UpdateFeedEntry = {
  userId: string;
  name: string;
  avatar: string;
  photoUri?: string;
  latestAt: string | null;
  items: StatusPost[];
};

type DeviceSession = {
  id: string;
  deviceId: string;
  userId: string;
  platform: string;
  label: string;
  kind?: 'phone' | 'linked';
  pushToken?: string;
  createdAt: string;
  lastSeenAt: string;
};

type OtpChallenge = {
  id: string;
  phone: string;
  normalizedPhone: string;
  countryCode: string;
  code: string;
  provider: 'google-firebase-ready' | 'development';
  createdAt: string;
  expiresAt: string;
  verifiedAt?: string | null;
};

type LinkRequest = {
  id: string;
  token: string;
  deviceId: string;
  platform: string;
  label: string;
  status: 'pending' | 'pin_required' | 'linked' | 'expired';
  userId?: string | null;
  createdAt: string;
  expiresAt: string;
  linkedAt?: string | null;
};

type MediaStorageMode = 'local' | 'cloudinary' | 'gcs';

type BootstrapPayload = {
  authRequired: boolean;
  currentUserId: string;
  currentDeviceId: string | null;
  profile: Profile;
  users: User[];
  mutualUserIds?: string[];
  chatRequests?: ChatRequest[];
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  contacts: Contact[];
  calls: Call[];
  statuses: StatusPost[];
  updatesFeed: UpdateFeedEntry[];
  catalogItems: CatalogItem[];
  businesses?: BusinessProfile[];
  notice?: { text: string } | null;
  anonymousDailyLimit?: number;
  settingsMenu: string[];
  architecture: {
    mode: string;
    realtimeTransport: string;
    syncStrategy: string;
    persistenceMode: string;
    mongodbConfigured: boolean;
    mediaStorageMode: MediaStorageMode;
    cloudMediaConfigured: boolean;
    encryptionBoundary: string;
  };
};

const emptyProfile: Profile = {
  id: '',
  name: '',
  username: '',
  avatar: 'ZU',
  about: '',
  phone: '',
  countryCode: '',
  phoneVerifiedAt: null,
  appLockEnabled: false,
  pinHash: null,
  businessName: '',
  businessDescription: '',
  currency: '',
  photoUri: '',
  lastSeenPrivacy: 'everyone',
  profilePhotoPrivacy: 'everyone',
  aboutPrivacy: 'everyone',
  statusPrivacy: 'contacts',
  typingPrivacy: 'everyone',
  callPrivacy: 'everyone',
  groupInvitePrivacy: 'everyone',
  readReceiptsEnabled: true,
  blockedUserIds: [],
};

const seedUsers: User[] = [];
const seedChats: Chat[] = [];
const seedMessages: Message[] = [];
const seedContacts: Contact[] = [];
const seedChatRequests: ChatRequest[] = [];
const seedCalls: Call[] = [];
const seedStatuses: StatusPost[] = [];
const seedCatalogItems: CatalogItem[] = [];
const seedOrders: CommerceOrder[] = [];
const seedReceipts: SaleReceipt[] = [];
const receiptCounters: Record<string, number> = {};
const seedInventoryMovements: InventoryMovement[] = [];
const seedInventoryAlerts: InventoryAlert[] = [];
const seedBusinessCustomers: BusinessCustomer[] = [];
const seedAutoReplyConfigs: BusinessAutoReplyConfig[] = [];
const seedAutoReplyLogs: AutoReplyLog[] = [];
const seedCommerceDocuments: CommerceDocument[] = [];
const seedBroadcastCampaigns: BroadcastCampaign[] = [];
const seedBusinessAiConfigs: BusinessAiConfig[] = [];
const seedAiTwinConfigs: AiTwinConfig[] = [];
const seedAiTwinActions: AiTwinAction[] = [];
const documentCounters: Record<string, number> = {};
const TWIN_HARD_BLOCKS = [
  'send_money',
  'approve_refund',
  'invent_price',
  'promise_discount',
  'auto_send_without_disclosure',
  'impersonate_owner_secretly',
] as const;

const settingsMenu = [
  'Favorites',
  'Business tools',
  'Chat history',
  'Account',
  'Privacy',
  'Chats',
  'Notifications',
  'Storage and data',
  'Help and feedback',
];

const DEFAULT_USER_ID = '';
const DEFAULT_DB_NAME = process.env.MONGODB_DB_NAME ?? 'zynkup';

const resolveUploadsDir = () => {
  const candidates = [
    process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : '',
    path.resolve(process.cwd(), 'uploads'),
    '/tmp/zynkup-uploads',
  ].filter(Boolean);

  for (const directory of candidates) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      return directory;
    } catch (error) {
      console.warn(`Uploads directory not writable (${directory}):`, error instanceof Error ? error.message : error);
    }
  }

  throw new Error('No writable uploads directory. Set UPLOADS_DIR to a writable path.');
};

const UPLOADS_DIR = resolveUploadsDir();
const STATIC_UPLOAD_PREFIX = '/uploads';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? '';
const FIREBASE_WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY ?? '';
const FIREBASE_APP_ID = process.env.FIREBASE_APP_ID ?? '';
const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN ?? '';
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? '';
const FIREBASE_MESSAGING_SENDER_ID = process.env.FIREBASE_MESSAGING_SENDER_ID ?? '';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL ?? '';
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '';
const MAX_LINKED_DEVICES = 4;
const LINK_REQUEST_TTL_MS = 1000 * 60 * 5;
const GCS_BUCKET = process.env.GCS_BUCKET ?? process.env.GOOGLE_CLOUD_STORAGE_BUCKET ?? '';
const MEDIA_STORAGE_MODE: MediaStorageMode =
  process.env.MEDIA_STORAGE_PROVIDER === 'cloudinary'
    ? 'cloudinary'
    : process.env.MEDIA_STORAGE_PROVIDER === 'gcs' || GCS_BUCKET
      ? 'gcs'
      : 'local';
const GCS_PUBLIC_BASE_URL = (process.env.GCS_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_UPLOAD_FOLDER = process.env.CLOUDINARY_UPLOAD_FOLDER ?? 'zynkup';
const OTP_TTL_MS = 1000 * 60 * 5;
const seedOtpChallenges: OtpChallenge[] = [];
const seedLinkRequests: LinkRequest[] = [];

const seedProfiles: Profile[] = [];
const seedSessions: DeviceSession[] = [];
const seedBusinesses: BusinessProfile[] = [];

let mongoClientPromise: Promise<MongoClient | null> | null = null;
let mongoConnectionState: 'not-configured' | 'connected' | 'failed' = 'not-configured';
const mongoUri = process.env.MONGODB_ATLAS_URI ?? process.env.MONGO_URI;
let firebaseAdminApp: App | null = null;

const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  senderId: z.string().min(1),
  clientRef: z.string().min(6).max(120).optional(),
  kind: z.enum(['text', 'emoji', 'image', 'video', 'voice', 'file', 'call']).default('text'),
  text: z.string().min(1).max(4000),
  mediaUrls: z.array(z.string().url()).default([]),
  durationSeconds: z.number().int().nonnegative().optional(),
  replyToMessageId: z.string().min(1).optional(),
  replyPreview: z.string().max(280).optional(),
  catalogItemId: z.string().min(1).max(80).optional(),
  anonymous: z.boolean().optional(),
  businessId: z.string().min(1).max(80).optional(),
});

const clearChatUnreadSchema = z.object({
  userId: z.string().min(1),
});

const deleteMessageSchema = z.object({
  userId: z.string().min(1),
  scope: z.enum(['me', 'everyone']).default('me'),
});

const revealAuthorSchema = z.object({
  userId: z.string().min(1).optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  username: z.string().min(3).max(30).optional(),
  avatar: z.string().min(1).max(4).optional(),
  about: z.string().min(1).max(160).optional(),
  phone: z.string().min(7).max(30).optional(),
  businessName: z.string().min(2).max(80).optional(),
  businessDescription: z.string().min(2).max(160).optional(),
  currency: z.string().min(3).max(5).optional(),
  photoUri: z.string().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    'Profile photo must be an uploaded https URL',
  ).optional(),
  lastSeenPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  profilePhotoPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  aboutPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  statusPrivacy: z.enum(['contacts', 'close-friends', 'nobody']).optional(),
  typingPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  callPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  groupInvitePrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  readReceiptsEnabled: z.boolean().optional(),
  appLockEnabled: z.boolean().optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
});

const blockUserSchema = z.object({
  userId: z.string().min(1),
  targetUserId: z.string().min(1),
});

const chatDisappearSchema = z.object({
  userId: z.string().min(1),
  disappearAfterSeconds: z.union([z.literal(0), z.literal(86400), z.literal(604800), z.literal(7776000)]),
});

const statusAssetSchema = z.object({
  kind: z.enum(['image', 'video', 'document']),
  url: z.string().url(),
  caption: z.string().max(280).optional(),
});

const createStatusSchema = z.object({
  userId: z.string().min(1),
  text: z.string().max(700).default(''),
  assets: z.array(statusAssetSchema).max(10).default([]),
  backgroundColor: z.string().min(4).max(30).optional(),
  fontFamily: z.string().min(2).max(40).optional(),
  fontSize: z.number().int().min(16).max(64).optional(),
  catalogItemId: z.string().min(1).max(80).optional(),
  businessId: z.string().min(1).max(80).optional(),
  audience: z.enum(['contacts', 'close-friends', 'public', 'marketplace']).default('contacts'),
}).refine((value) => value.text.trim().length > 0 || value.assets.length > 0, {
  message: 'A status needs text or at least one asset',
});

const createCallSchema = z.object({
  participantIds: z.array(z.string().min(1)).min(2),
  initiatorId: z.string().min(1).optional(),
  kind: z.enum(['audio', 'video']),
  direction: z.enum(['incoming', 'outgoing']).default('outgoing'),
});

const updateCallSchema = z.object({
  state: z.enum(['ringing', 'ongoing', 'completed', 'missed', 'declined']),
  durationSeconds: z.number().int().nonnegative().optional(),
});

const catalogVariantSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(40),
  options: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
});

const createCatalogItemSchema = z.object({
  sellerId: z.string().min(1).optional(),
  businessId: z.string().max(80).optional(),
  title: z.string().min(2).max(120),
  price: z.number().positive(),
  currency: z.string().min(3).max(5).default('GHS'),
  category: z.string().min(2).max(40),
  description: z.string().min(2).max(2000),
  imageUrls: z.array(z.string().url()).min(1).max(8),
  stockQuantity: z.number().int().nonnegative().default(0),
  trackStock: z.boolean().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  lowStockThreshold: z.number().int().nonnegative().max(9999).optional(),
  status: z.enum(['draft', 'active', 'archived', 'out_of_stock']).optional(),
  variants: z.array(catalogVariantSchema).max(8).optional(),
  isPublic: z.boolean().optional(),
  location: z.string().max(80).optional(),
  condition: z.enum(['New', 'Used']).optional(),
});

const updateCatalogItemSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  price: z.number().positive().optional(),
  currency: z.string().min(3).max(5).optional(),
  category: z.string().min(2).max(40).optional(),
  description: z.string().min(2).max(2000).optional(),
  imageUrls: z.array(z.string().url()).min(1).max(8).optional(),
  stockQuantity: z.number().int().nonnegative().optional(),
  trackStock: z.boolean().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  lowStockThreshold: z.number().int().nonnegative().max(9999).optional(),
  status: z.enum(['draft', 'active', 'archived', 'out_of_stock']).optional(),
  variants: z.array(catalogVariantSchema).max(8).optional(),
  isPublic: z.boolean().optional(),
  location: z.string().max(80).optional(),
  condition: z.enum(['New', 'Used']).optional(),
  takenDown: z.boolean().optional(),
});

const stockAdjustSchema = z.object({
  userId: z.string().min(1),
  delta: z.number().int().refine((value) => value !== 0, 'Delta cannot be zero'),
  reason: z.string().trim().min(2).max(200).default('Manual adjustment'),
  lowStockThreshold: z.number().int().nonnegative().max(9999).optional(),
});

const inventoryAlertReviewSchema = z.object({
  userId: z.string().min(1),
});

const marketingConsentSchema = z.enum(['unknown', 'opted_in', 'opted_out']);

const createCustomerSchema = z.object({
  userId: z.string().min(1),
  customerUserId: z.string().min(1).max(80).optional().nullable(),
  displayName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  businessId: z.string().min(1).max(80).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  note: z.string().trim().min(1).max(1000).optional(),
  followUpAt: z.string().min(1).max(40).optional().nullable(),
  followUpNote: z.string().trim().max(240).optional(),
  chatId: z.string().min(1).max(80).optional().nullable(),
});

const updateCustomerSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  followUpAt: z.string().min(1).max(40).nullable().optional(),
  followUpNote: z.string().trim().max(240).optional(),
  marketingConsent: marketingConsentSchema.optional(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  businessId: z.string().min(1).max(80).optional().nullable(),
});

const customerNoteSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
});

const customerPreferenceSchema = z.object({
  userId: z.string().min(1),
  customerId: z.string().min(1),
  marketingConsent: z.enum(['opted_in', 'opted_out']),
});

const autoReplyRuleSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(12),
  response: z.string().trim().min(1).max(800),
  enabled: z.boolean().optional(),
});

const upsertAutoReplySchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().min(1).max(80).optional().nullable(),
  enabled: z.boolean().optional(),
  greetingEnabled: z.boolean().optional(),
  greetingText: z.string().trim().max(800).optional(),
  awayEnabled: z.boolean().optional(),
  awayText: z.string().trim().max(800).optional(),
  hoursText: z.string().trim().max(400).optional(),
  humanHandoverKeywords: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  rules: z.array(autoReplyRuleSchema).max(40).optional(),
  cooldownSeconds: z.number().int().min(10).max(3600).optional(),
  pausedChatIds: z.array(z.string().min(1).max(80)).max(200).optional(),
});

const autoReplyPauseSchema = z.object({
  userId: z.string().min(1),
  chatId: z.string().min(1),
  paused: z.boolean(),
});

const commerceDocLineSchema = z.object({
  catalogItemId: z.string().min(1).max(80).optional().nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(400).optional(),
  quantity: z.number().positive().max(100000),
  unitPrice: z.number().nonnegative().max(100000000),
});

const createCommerceDocSchema = z.object({
  userId: z.string().min(1),
  kind: z.enum(['quotation', 'invoice']),
  businessId: z.string().min(1).max(80).optional().nullable(),
  customerUserId: z.string().min(1).max(80).optional().nullable(),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().max(40).optional(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  currency: z.string().min(3).max(5).default('GHS'),
  lines: z.array(commerceDocLineSchema).min(1).max(40),
  discountAmount: z.number().nonnegative().max(100000000).optional(),
  taxAmount: z.number().nonnegative().max(100000000).optional(),
  notes: z.string().trim().max(1000).optional(),
  paymentTerms: z.string().trim().max(240).optional(),
  expiresAt: z.string().min(1).max(40).optional().nullable(),
  dueAt: z.string().min(1).max(40).optional().nullable(),
  sendNow: z.boolean().optional(),
});

const updateCommerceDocSchema = z.object({
  userId: z.string().min(1),
  customerName: z.string().trim().min(1).max(120).optional(),
  customerPhone: z.string().trim().max(40).optional(),
  customerUserId: z.string().min(1).max(80).optional().nullable(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  lines: z.array(commerceDocLineSchema).min(1).max(40).optional(),
  discountAmount: z.number().nonnegative().max(100000000).optional(),
  taxAmount: z.number().nonnegative().max(100000000).optional(),
  notes: z.string().trim().max(1000).optional(),
  paymentTerms: z.string().trim().max(240).optional(),
  expiresAt: z.string().min(1).max(40).optional().nullable(),
  dueAt: z.string().min(1).max(40).optional().nullable(),
  currency: z.string().min(3).max(5).optional(),
});

const commerceDocActionSchema = z.object({
  userId: z.string().min(1),
  note: z.string().trim().max(240).optional(),
  chatId: z.string().min(1).max(80).optional().nullable(),
  paymentId: z.string().min(1).max(80).optional().nullable(),
  markCashReceived: z.boolean().optional(),
});

const createBroadcastSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
  segment: z.enum(['opted_in', 'repeat_buyers', 'all_customers', 'tag']).default('opted_in'),
  tag: z.string().trim().min(1).max(40).optional(),
  businessId: z.string().min(1).max(80).optional().nullable(),
  scheduledAt: z.string().min(1).max(40).optional().nullable(),
  sendNow: z.boolean().optional(),
});

const aiToneSchema = z.enum(['polite', 'concise', 'professional', 'friendly', 'apologetic']);

const suggestRepliesSchema = z.object({
  userId: z.string().min(1),
  chatId: z.string().min(1),
  messageId: z.string().min(1).max(80).optional(),
  tone: aiToneSchema.optional(),
});

const rewriteMessageSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().min(1).max(2000),
  tone: aiToneSchema.default('polite'),
});

const scamCheckSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
});

const summarizeChatSchema = z.object({
  userId: z.string().min(1),
  chatId: z.string().min(1),
  scope: z.enum(['unread', 'recent', 'range']).default('unread'),
  limit: z.number().int().min(5).max(300).optional(),
  since: z.string().min(1).max(40).optional(),
  until: z.string().min(1).max(40).optional(),
});

const dictateSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().max(4000).optional(),
  audioUrl: z.string().url().optional(),
});

const transcribeMessageSchema = z.object({
  userId: z.string().min(1),
  language: z.string().trim().min(2).max(16).optional(),
});

const translateSchema = z.object({
  userId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  messageId: z.string().min(1).max(80).optional(),
  chatId: z.string().min(1).max(80).optional(),
  targetLanguage: z.enum(['en', 'tw', 'ga', 'ee', 'pcm']).default('en'),
  sourceLanguage: z.enum(['auto', 'en', 'tw', 'ga', 'ee', 'pcm']).default('auto'),
});

const assistantTaskSchema = z.object({
  userId: z.string().min(1),
  task: z.enum(['draft', 'rewrite', 'summarise', 'translate', 'suggest_reply', 'explain']),
  prompt: z.string().trim().max(1000).optional(),
  text: z.string().trim().max(4000).optional(),
  chatId: z.string().min(1).max(80).optional(),
  messageId: z.string().min(1).max(80).optional(),
  tone: aiToneSchema.optional(),
  targetLanguage: z.enum(['en', 'tw', 'ga', 'ee', 'pcm']).optional(),
  consentToShareContext: z.boolean().default(false),
});

const businessAiConfigSchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().min(1).max(80).optional().nullable(),
  enabled: z.boolean().optional(),
  autoSend: z.boolean().optional(),
  policyText: z.string().trim().max(2000).optional(),
  deliveryPolicy: z.string().trim().max(800).optional(),
  refundPolicy: z.string().trim().max(800).optional(),
  faq: z.array(z.object({
    question: z.string().trim().min(2).max(200),
    answer: z.string().trim().min(2).max(800),
  })).max(40).optional(),
});

const businessAiAskSchema = z.object({
  userId: z.string().min(1),
  sellerUserId: z.string().min(1).optional(),
  businessId: z.string().min(1).max(80).optional().nullable(),
  question: z.string().trim().min(2).max(1000),
  chatId: z.string().min(1).max(80).optional(),
});

const twinAllowedTaskSchema = z.enum([
  'draft_reply',
  'organise_enquiry',
  'create_reminder',
  'prepare_quotation',
  'answer_hours',
]);

const twinConfigSchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().min(1).max(80).optional().nullable(),
  enabled: z.boolean().optional(),
  displayName: z.string().trim().max(80).optional(),
  permissionTier: z.enum(['draft_only', 'auto_routine']).optional(),
  allowedTasks: z.array(twinAllowedTaskSchema).max(10).optional(),
  dataSources: z.array(z.enum(['catalog', 'hours', 'faq', 'policies', 'crm'])).max(10).optional(),
  operatingHoursText: z.string().trim().max(200).optional(),
  dailyActionLimit: z.number().int().min(1).max(200).optional(),
});

const twinRunSchema = z.object({
  userId: z.string().min(1),
  event: z.enum(['new_enquiry', 'manual']),
  chatId: z.string().min(1).max(80).optional(),
  messageId: z.string().min(1).max(80).optional(),
  prompt: z.string().trim().max(1000).optional(),
  businessId: z.string().min(1).max(80).optional().nullable(),
});

const twinActionDecisionSchema = z.object({
  userId: z.string().min(1),
  note: z.string().trim().max(240).optional(),
});

type TwinAllowedTask = z.infer<typeof twinAllowedTaskSchema>;

type AiTwinConfig = {
  id: string;
  ownerUserId: string;
  businessId?: string | null;
  enabled: boolean;
  displayName: string;
  permissionTier: 'draft_only' | 'auto_routine';
  allowedTasks: TwinAllowedTask[];
  dataSources: Array<'catalog' | 'hours' | 'faq' | 'policies' | 'crm'>;
  operatingHoursText: string;
  dailyActionLimit: number;
  // Hard-blocked forever — never grantable via config
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

const resolveCatalogStatus = (
  status: CatalogProductStatus | undefined,
  stockQuantity: number,
  trackStock: boolean,
): CatalogProductStatus => {
  if (status === 'archived' || status === 'draft') return status;
  if (trackStock && stockQuantity <= 0) return 'out_of_stock';
  if (status === 'out_of_stock' && (!trackStock || stockQuantity > 0)) return 'active';
  return status || 'active';
};

const paymentIntentSchema = z.object({
  action: z.enum(['send', 'request', 'topup']),
  amount: z.number().positive(),
  currency: z.string().min(3).max(5).default('GHS'),
  phone: z.string().min(6).max(30).optional(),
  note: z.string().max(160).optional(),
  userId: z.string().min(1).optional(),
  orderId: z.string().min(1).max(80).optional(),
  provider: z.enum(['mtn_momo', 'vodafone_cash', 'airteltigo']).default('mtn_momo'),
});

const createOrderSchema = z.object({
  buyerUserId: z.string().min(1),
  catalogItemId: z.string().min(1),
  quantity: z.number().int().positive().max(99).default(1),
  variantSelections: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    option: z.string().trim().min(1).max(40),
  })).max(8).optional(),
  statusId: z.string().max(80).optional(),
  chatId: z.string().max(80).optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
});

const updateOrderSchema = z.object({
  userId: z.string().min(1),
  state: z.enum(['pending_payment', 'paid', 'processing', 'dispatched', 'completed', 'cancelled', 'refunded']),
  note: z.string().trim().max(200).optional(),
  deliveryReference: z.string().trim().max(120).optional().nullable(),
  fulfilmentNote: z.string().trim().max(400).optional().nullable(),
});

const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled', 'refunded'],
  processing: ['dispatched', 'cancelled', 'refunded'],
  dispatched: ['completed', 'refunded'],
  completed: ['refunded'],
  cancelled: [],
  refunded: [],
};

const canTransitionOrder = (
  order: CommerceOrder,
  nextState: OrderState,
  actorUserId: string,
): string | null => {
  const isBuyer = order.buyerUserId === actorUserId;
  const isSeller = order.sellerUserId === actorUserId;
  if (!isBuyer && !isSeller) return 'You cannot update this order.';
  if (order.state === nextState) return 'Order is already in that state.';
  if (!(ORDER_TRANSITIONS[order.state] || []).includes(nextState)) {
    return `Cannot move an order from ${order.state} to ${nextState}.`;
  }
  if (isBuyer && !isSeller) {
    if (nextState === 'cancelled' && order.state === 'pending_payment') return null;
    return 'Buyers can only cancel unpaid orders.';
  }
  // Seller (or seller who is also buyer in edge cases) manages fulfilment.
  if (nextState === 'paid' || nextState === 'processing' || nextState === 'dispatched' || nextState === 'completed' || nextState === 'refunded' || nextState === 'cancelled') {
    return null;
  }
  return 'That order status change is not allowed.';
};

const updateReceiptSchema = z.object({
  state: z.enum(['delivered', 'read']),
});

const reactToStatusSchema = z.object({
  userId: z.string().min(1).optional(),
  emoji: z.string().min(1).max(4),
});

const commentOnStatusSchema = z.object({
  userId: z.string().min(1).optional(),
  text: z.string().min(1).max(280),
});

const updateStatusCommentSchema = z.object({
  userId: z.string().min(1).optional(),
  text: z.string().min(1).max(280),
});

const markStatusViewSchema = z.object({
  userId: z.string().min(1).optional(),
});

const createChatSchema = z.object({
  userId: z.string().min(1),
  peerUserId: z.string().min(1),
  businessId: z.string().min(1).max(80).optional(),
});

const createChatRequestSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  statusId: z.string().min(1).max(80).optional(),
  note: z.string().max(180).optional(),
});

const createRoomSchema = z.object({
  userId: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().min(1)).min(1),
  businessId: z.string().min(1).max(80).optional(),
});

const pinCodeSchema = z.string().regex(/^\d{4,6}$/);

const authLoginSchema = z.object({
  deviceId: z.string().min(8).nullish(),
  countryCode: z.string().min(1).max(8).optional(),
  phone: z.string().min(7).max(30),
  phoneNumber: z.string().min(4).max(20).optional(),
  pin: pinCodeSchema,
  challengeId: z.string().min(6).optional(),
  idToken: z.string().min(32).optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const phoneLookupSchema = z.object({
  countryCode: z.string().min(1).max(8),
  phoneNumber: z.string().min(4).max(20),
  deviceId: z.string().min(8).optional(),
});

const resetPinSchema = z.object({
  deviceId: z.string().min(8).nullish(),
  challengeId: z.string().min(6).optional(),
  idToken: z.string().min(32).optional(),
  pin: pinCodeSchema,
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const authRegisterSchema = z.object({
  deviceId: z.string().min(8).optional(),
  name: z.string().min(2).max(80),
  phone: z.string().min(7).max(30),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const authSwitchSchema = z.object({
  deviceId: z.string().min(8),
  userId: z.string().min(1),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const startPhoneAuthSchema = z.object({
  deviceId: z.string().min(8).nullish(),
  countryCode: z.string().min(1).max(8),
  phoneNumber: z.string().min(4).max(20),
});

const optionalDeviceId = z.string().min(8).nullish();

const verifyOtpSchema = z.object({
  deviceId: optionalDeviceId,
  challengeId: z.string().min(6),
  code: z.string().min(4).max(8),
  forcePinReset: z.boolean().optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const phoneSessionSchema = z.object({
  deviceId: optionalDeviceId,
  idToken: z.string().min(32),
  phone: z.string().min(6).max(30),
  forcePinReset: z.boolean().optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const completeRegistrationSchema = z.object({
  deviceId: optionalDeviceId,
  challengeId: z.string().min(6),
  name: z.string().min(2).max(80),
  countryCode: z.string().min(1).max(8),
  phoneNumber: z.string().min(4).max(20),
  pin: pinCodeSchema,
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const phoneRegisterSchema = z.object({
  deviceId: optionalDeviceId,
  idToken: z.string().min(32),
  name: z.string().min(2).max(80),
  countryCode: z.string().min(1).max(8),
  phone: z.string().min(6).max(30),
  pin: pinCodeSchema,
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const syncContactsSchema = z.object({
  userId: z.string().min(1),
  contacts: z.array(
    z.object({
      name: z.string().max(120).optional(),
      phone: z.string().max(40),
    }),
  ).max(5000),
});

const createLinkRequestSchema = z.object({
  deviceId: z.string().min(8).optional(),
  platform: z.string().min(2).max(40).default('web'),
  label: z.string().min(2).max(80).default('Linked browser'),
});

const confirmLinkRequestSchema = z.object({
  requestId: z.string().min(6),
  token: z.string().min(12),
  userId: z.string().min(1),
});

const verifyLinkedDevicePinSchema = z.object({
  requestId: z.string().min(6),
  token: z.string().min(12),
  pin: pinCodeSchema,
});

const ensureSessionSchema = z.object({
  deviceId: z.string().min(8).nullish(),
  preferredUserId: z.string().min(1).optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
  kind: z.enum(['phone', 'linked']).optional(),
});

const app = express();
const server = http.createServer(app);
/** Assigned before mountCommunities; used by the message pipeline for room ACL. */
let communitiesDeps: CommunitiesDeps;
let voiceRoomsDeps: VoiceRoomsDeps;
let gamesDeps: GamesDeps;
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '8mb' }));
app.use(morgan('dev'));
app.use(STATIC_UPLOAD_PREFIX, express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, UPLOADS_DIR);
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '');
    const safeBase = path
      .basename(file.originalname || 'upload', extension)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 60);
    callback(null, `${Date.now()}-${safeBase || 'upload'}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    files: 10,
    fileSize: 25 * 1024 * 1024,
  },
});

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
}

const getMongoClient = async () => {
  if (!mongoUri) {
    return null;
  }

  if (!mongoClientPromise) {
    mongoClientPromise = MongoClient.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000,
    })
      .then((client) => {
        mongoConnectionState = 'connected';
        console.log('Connected to MongoDB');
        return client;
      })
      .catch((error: unknown) => {
        mongoConnectionState = 'failed';
        mongoClientPromise = null;
        const message = error instanceof Error ? error.message : 'Unknown MongoDB error';
        console.error(`MongoDB connection failed: ${message}`);
        console.error('Cloud Run has no fixed IP. In Atlas Network Access, allow 0.0.0.0/0, and URL-encode any special characters in the password.');
        return null;
      });
  }

  return mongoClientPromise;
};

const getDb = async () => {
  const client = await getMongoClient();
  return client ? client.db(DEFAULT_DB_NAME) : null;
};

const buildAbsoluteUrl = (req: express.Request, relativePath: string) =>
  `${req.protocol}://${req.get('host')}${relativePath}`;

const isCloudinaryConfigured = () =>
  Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

const isGcsConfigured = () => Boolean(GCS_BUCKET);

const uploadFileToGcs = async (file: Express.Multer.File) => {
  if (!isGcsConfigured()) {
    throw new Error('GCS bucket is not configured');
  }

  // Lazy-load so local/cloudinary deploys do not require the package until used.
  const { Storage } = require('@google-cloud/storage') as typeof import('@google-cloud/storage');
  const storageClient = new Storage();
  const bucket = storageClient.bucket(GCS_BUCKET);
  const objectName = `${CLOUDINARY_UPLOAD_FOLDER || 'zynkup'}/${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
  await bucket.upload(file.path, {
    destination: objectName,
    resumable: false,
    metadata: {
      contentType: file.mimetype,
      cacheControl: 'public, max-age=31536000',
    },
  });
  await bucket.file(objectName).makePublic().catch((error: unknown) => {
    console.warn('GCS object was uploaded but is not public yet. Grant allUsers the Storage Object Viewer role on the bucket.', error);
  });
  await fs.promises.rm(file.path, { force: true }).catch(() => undefined);

  const publicUrl = GCS_PUBLIC_BASE_URL
    ? `${GCS_PUBLIC_BASE_URL}/${objectName}`
    : `https://storage.googleapis.com/${GCS_BUCKET}/${objectName}`;

  return {
    url: publicUrl,
    name: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
};

const getHostedPathname = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith(STATIC_UPLOAD_PREFIX) ? parsed.pathname : null;
  } catch {
    return url.startsWith(STATIC_UPLOAD_PREFIX) ? url : null;
  }
};

const inferCloudinaryResourceType = (mimeType: string) => {
  if (mimeType.startsWith('video/')) {
    return 'video' as const;
  }
  if (mimeType.startsWith('image/')) {
    return 'image' as const;
  }
  return 'raw' as const;
};

const uploadFileToCloudinary = async (file: Express.Multer.File) => {
  if (!isCloudinaryConfigured()) {
    throw new Error('Cloudinary is not configured');
  }

  try {
    const resourceType = inferCloudinaryResourceType(file.mimetype);
    const result = await cloudinary.uploader.upload(file.path, {
      folder: CLOUDINARY_UPLOAD_FOLDER,
      resource_type: resourceType,
      use_filename: true,
      unique_filename: true,
    });

    return {
      url: result.secure_url,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  } finally {
    await fs.promises.rm(file.path, { force: true }).catch(() => undefined);
  }
};

const extractCloudinaryPublicId = (url: string) => {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('res.cloudinary.com')) {
      return null;
    }

    const parts = parsed.pathname.split('/upload/');
    if (parts.length < 2) {
      return null;
    }

    const suffix = parts[1].replace(/^v\d+\//, '');
    return suffix.replace(/\.[^.]+$/, '');
  } catch {
    return null;
  }
};

const deleteHostedFiles = async (urls: string[]) => {
  await Promise.all(
    urls.map(async (url) => {
      const cloudinaryPublicId = extractCloudinaryPublicId(url);
      if (cloudinaryPublicId && isCloudinaryConfigured()) {
        for (const resourceType of ['image', 'video', 'raw'] as const) {
          try {
            const result = await cloudinary.uploader.destroy(cloudinaryPublicId, { resource_type: resourceType });
            if (result.result === 'ok' || result.result === 'not found') {
              return;
            }
          } catch {
            continue;
          }
        }
      }

      const pathname = getHostedPathname(url);
      if (!pathname) {
        return;
      }

      const filePath = path.resolve(UPLOADS_DIR, `.${pathname.replace(STATIC_UPLOAD_PREFIX, '')}`);
      if (!filePath.startsWith(UPLOADS_DIR)) {
        return;
      }

      await fs.promises.rm(filePath, { force: true });
    }),
  );
};

const getPersistenceMode = () =>
  mongoConnectionState === 'connected'
    ? 'mongodb-connected'
    : mongoUri
      ? 'mongodb-configured-memory-fallback'
      : 'in-memory';

const withProjection = <T extends Document>(collection: Collection<T>) =>
  collection.find({}, { projection: { _id: 0 } });

const buildMessagesByChat = (messages: Message[]) =>
  messages.reduce<Record<string, Message[]>>((accumulator, message) => {
    const current = accumulator[message.chatId] ?? [];
    accumulator[message.chatId] = [...current, message];
    return accumulator;
  }, {});

const anonymousDayKey = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka' }).format(new Date());

const presentMessage = (message: Message, viewerId: string): Message => {
  if (!message.anonymous || message.senderId === viewerId) {
    return message;
  }
  return { ...message, senderId: 'anonymous' };
};

const chatAdmins = (chat: Chat) => (chat.adminIds?.length ? chat.adminIds : chat.participants.slice(0, 1));

const saveChatRecord = async (chat: Chat) => {
  const db = await getDb();
  if (!db) {
    const index = seedChats.findIndex((item) => item.id === chat.id);
    if (index >= 0) {
      seedChats[index] = chat;
    } else {
      seedChats.unshift(chat);
    }
    return chat;
  }
  await seedDatabaseIfNeeded();
  await collectionsFor(db).chats.updateOne({ id: chat.id }, { $set: chat }, { upsert: true });
  return chat;
};

const buildUpdateFeed = (users: User[], statuses: StatusPost[]): UpdateFeedEntry[] =>
  users
    .map((user) => {
      const userStatuses = statuses
        .filter((status) => status.userId === user.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      return {
        userId: user.id,
        name: user.name,
        avatar: user.avatar,
        photoUri: user.photoUri || '',
        latestAt: userStatuses[0]?.createdAt ?? null,
        items: userStatuses,
      };
    })
    .filter((entry) => entry.items.length > 0);

const normalizePhone = (countryCode: string, phoneNumber: string) => {
  const cc = (countryCode.startsWith('+') ? countryCode : `+${countryCode}`).replace(/[^\d+]/g, '');
  let digits = phoneNumber.replace(/[^\d]/g, '');

  // Drop national trunk prefix (e.g. Ghana 0XXXXXXXXX -> +233XXXXXXXXX).
  if (cc.length > 1 && digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  }

  const ccDigits = cc.replace(/\D/g, '');
  if (ccDigits && digits.startsWith(ccDigits)) {
    digits = digits.slice(ccDigits.length);
  }

  return `${cc}${digits}`;
};

const sanitizePhone = (phoneNumber: string) => phoneNumber.replace(/[^\d+]/g, '');

const rejectIfBlocked = async (
  res: { status: (code: number) => { json: (body: unknown) => void } },
  phone: string,
) => {
  const block = await findPhoneBlock(getDb, phone);
  if (!block) return false;
  const until = block.until ? String(block.until) : null;
  res.status(403).json({
    error: until
      ? 'This number is paused. You can try again when the wait ends.'
      : 'This number cannot register or sign in on ZynkUp.',
    code: 'NUMBER_BLOCKED',
    until,
    remainingMs: until ? Math.max(0, new Date(until).getTime() - Date.now()) : null,
  });
  return true;
};

const CURRENCY_BY_CALLING_CODE: Array<[string, string]> = [
  ['233', 'GHS'],
  ['260', 'ZMW'],
  ['234', 'NGN'],
  ['254', 'KES'],
  ['256', 'UGX'],
  ['255', 'TZS'],
  ['250', 'RWF'],
  ['257', 'BIF'],
  ['243', 'CDF'],
  ['237', 'XAF'],
  ['225', 'XOF'],
  ['221', 'XOF'],
  ['27', 'ZAR'],
  ['20', 'EGP'],
  ['212', 'MAD'],
  ['44', 'GBP'],
  ['91', 'INR'],
  ['86', 'CNY'],
  ['1', 'USD'],
];

const currencyForCallingCode = (value: string) => {
  const digits = String(value || '').replace(/\D/g, '');
  const match = CURRENCY_BY_CALLING_CODE
    .slice()
    .sort((left, right) => right[0].length - left[0].length)
    .find(([code]) => digits.startsWith(code));
  return match?.[1] ?? 'USD';
};

const phoneTail = (value: string) => String(value || '').replace(/\D/g, '').replace(/^0+/, '').slice(-9);

const callingCodesLongestFirst = () =>
  CURRENCY_BY_CALLING_CODE
    .map(([code]) => code)
    .sort((left, right) => right.length - left.length);

const phoneIdentity = (value: string, countryCode?: string) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const stripTrunk = (national: string) => national.replace(/^0+/, '');
  const hinted = String(countryCode || '').replace(/\D/g, '');
  const finish = (code: string, nationalDigits: string) => {
    let national = stripTrunk(nationalDigits);
    if (code && national.startsWith(code)) {
      const nested = stripTrunk(national.slice(code.length));
      if (nested.length >= 7) national = nested;
    }
    return { cc: code, national, key: `${code}${national}` };
  };
  if (hinted) {
    if (digits.startsWith(hinted)) digits = digits.slice(hinted.length);
    return finish(hinted, digits);
  }
  for (const code of callingCodesLongestFirst()) {
    if (digits.startsWith(code) && digits.length - code.length >= 7 && digits.length - code.length <= 12) {
      return finish(code, digits.slice(code.length));
    }
  }
  const national = stripTrunk(digits);
  return { cc: '', national, key: national };
};

const phonesMatch = (left: string, right: string, leftCountry?: string, rightCountry?: string) => {
  const a = phoneIdentity(left, leftCountry);
  const b = phoneIdentity(right, rightCountry);
  if (a.national.length < 8 || b.national.length < 8) return false;
  if (a.cc && b.cc && a.cc !== b.cc) return false;
  return a.national === b.national || a.key === b.key;
};

const canonicalPhone = (value: string, countryCode?: string) => {
  const identity = phoneIdentity(value, countryCode);
  if (identity.national.length < 8) return sanitizePhone(value);
  return identity.cc ? `+${identity.cc}${identity.national}` : `+${identity.national}`;
};

const hashPin = (pin: string) =>
  crypto.createHash('sha256').update(`zynkup:${pin}`).digest('hex');

const hasFirebaseAdminCredentials = () =>
  Boolean(
    FIREBASE_SERVICE_ACCOUNT_JSON.trim()
    || (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_PROJECT_ID),
  );

let firebasePublicCerts: { fetchedAt: number; certs: Record<string, string> } | null = null;

const readFirebasePublicCerts = async () => {
  if (firebasePublicCerts && Date.now() - firebasePublicCerts.fetchedAt < 60 * 60 * 1000) {
    return firebasePublicCerts.certs;
  }

  const response = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
  );
  if (!response.ok) {
    throw new Error('Unable to load Firebase signing keys.');
  }
  const certs = (await response.json()) as Record<string, string>;
  firebasePublicCerts = { fetchedAt: Date.now(), certs };
  return certs;
};

const verifyFirebaseIdTokenWithPublicKeys = async (idToken: string, expectedPhone?: string) => {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Firebase token.');
  }

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string };
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
    aud?: string;
    iss?: string;
    exp?: number;
    phone_number?: string;
    sub?: string;
    user_id?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token.');
  }

  let certs = await readFirebasePublicCerts();
  let certificate = certs[header.kid];
  if (!certificate) {
    firebasePublicCerts = null;
    certs = await readFirebasePublicCerts();
    certificate = certs[header.kid];
  }
  if (!certificate) {
    throw new Error('Firebase signing key was not found.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(certificate, Buffer.from(parts[2], 'base64url'))) {
    throw new Error('Firebase token signature is invalid.');
  }

  const projectId = FIREBASE_PROJECT_ID || payload.aud || '';
  if (!projectId || payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase token is for a different project.');
  }
  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new Error('Firebase token expired.');
  }

  const verifiedPhone = payload.phone_number?.trim() ?? '';
  if (!verifiedPhone) {
    throw new Error('Firebase token does not include a verified phone number.');
  }
  if (expectedPhone && !phonesMatch(verifiedPhone, expectedPhone)) {
    throw new Error('Firebase token phone number does not match the submitted number.');
  }

  return {
    uid: payload.sub || payload.user_id || 'firebase-user',
    phoneNumber: verifiedPhone,
  };
};

const verifyFirebasePhoneWithRestApi = async (idToken: string, expectedPhone?: string) => {
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error('Firebase token verification is not configured yet.');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const restError =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error?: { message?: string } }).error?.message
        : '';
    throw new Error(restError ? `Firebase token lookup failed: ${restError}` : 'Firebase token lookup failed.');
  }

  const userRecord =
    payload && typeof payload === 'object' && Array.isArray((payload as { users?: unknown[] }).users)
      ? (payload as { users?: Array<Record<string, unknown>> }).users?.[0]
      : null;
  const verifiedPhone = typeof userRecord?.phoneNumber === 'string' ? userRecord.phoneNumber.trim() : '';
  if (!verifiedPhone) {
    throw new Error('Firebase token does not include a verified phone number.');
  }

  if (expectedPhone && !phonesMatch(verifiedPhone, expectedPhone)) {
    throw new Error('Firebase token phone number does not match the submitted number.');
  }

  return {
    uid:
      (typeof userRecord?.localId === 'string' && userRecord.localId)
      || (typeof userRecord?.['localId'] === 'string' && userRecord['localId'])
      || 'firebase-rest-user',
    phoneNumber: verifiedPhone,
  };
};

const getFirebaseAdminApp = () => {
  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  if (!hasFirebaseAdminCredentials()) {
    return null;
  }

  try {
    if (FIREBASE_SERVICE_ACCOUNT_JSON.trim()) {
      const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
      firebaseAdminApp = getApps().length
        ? getApp()
        : initializeApp({
            credential: cert(serviceAccount),
            projectId: FIREBASE_PROJECT_ID || serviceAccount.projectId,
          });
      return firebaseAdminApp;
    }

    if (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_PROJECT_ID) {
      firebaseAdminApp = getApps().length
        ? getApp()
        : initializeApp({
            credential: cert({
              projectId: FIREBASE_PROJECT_ID,
              clientEmail: FIREBASE_CLIENT_EMAIL,
              privateKey: FIREBASE_PRIVATE_KEY,
            }),
            projectId: FIREBASE_PROJECT_ID,
          });
      return firebaseAdminApp;
    }
  } catch (error) {
    console.warn('Firebase Admin initialization failed:', error);
  }

  return null;
};

const verifyFirebasePhoneIdentity = async (idToken: string, expectedPhone?: string) => {
  const adminApp = getFirebaseAdminApp();
  if (adminApp) {
    try {
      const decodedToken = await getAuth(adminApp).verifyIdToken(idToken, true);
      const verifiedPhone = decodedToken.phone_number?.trim();
      if (!verifiedPhone) {
        throw new Error('Firebase token does not include a verified phone number.');
      }

      if (expectedPhone && !phonesMatch(verifiedPhone, expectedPhone)) {
        throw new Error('Firebase token phone number does not match the submitted number.');
      }

      return {
        uid: decodedToken.uid,
        phoneNumber: verifiedPhone,
      };
    } catch (error) {
      console.warn('Firebase Admin token verification failed, checking the token signature directly.', error);
    }
  }

  try {
    return await verifyFirebaseIdTokenWithPublicKeys(idToken, expectedPhone);
  } catch (error) {
    if (!FIREBASE_WEB_API_KEY) {
      throw error;
    }
    console.warn('Public-key token check failed, falling back to Firebase REST lookup.', error);
  }

  return verifyFirebasePhoneWithRestApi(idToken, expectedPhone);
};

const collectionsFor = (db: Db) => ({
  users: db.collection<User>('users'),
  profiles: db.collection<Profile>('profiles'),
  sessions: db.collection<DeviceSession>('sessions'),
  chats: db.collection<Chat>('chats'),
  messages: db.collection<Message>('messages'),
  contacts: db.collection<Contact>('contacts'),
  calls: db.collection<Call>('calls'),
  statuses: db.collection<StatusPost>('statuses'),
  catalogItems: db.collection<CatalogItem>('catalogItems'),
  chatRequests: db.collection<ChatRequest>('chatRequests'),
});

let seedPromise: Promise<void> | null = null;

const seedDatabaseIfNeeded = async () => {
  const db = await getDb();
  if (!db) {
    return;
  }

  if (!seedPromise) {
    seedPromise = (async () => {
      const collections = collectionsFor(db);
      await Promise.all([
        collections.users.deleteMany({ id: { $in: ['u1', 'u2', 'u3', 'u4'] } }),
        collections.profiles.deleteMany({ id: { $in: ['u1', 'u2', 'u3', 'u4'] } }),
        collections.sessions.deleteMany({
          $or: [{ id: 'session1' }, { deviceId: 'seed-device-primary' }, { userId: { $in: ['u1', 'u2', 'u3', 'u4'] } }],
        }),
        collections.chats.deleteMany({ id: { $in: ['c1', 'c2', 'c3'] } }),
        collections.messages.deleteMany({ id: { $in: ['m1', 'm2', 'm3', 'm4', 'm5'] } }),
        collections.contacts.deleteMany({ id: { $in: ['ct1', 'ct2', 'ct3', 'ct4'] } }),
        collections.calls.deleteMany({ id: { $in: ['call1', 'call2'] } }),
        collections.statuses.deleteMany({ id: { $in: ['s1', 's2'] } }),
        collections.catalogItems.deleteMany({ id: { $in: ['p1', 'p2', 'p3'] } }),
      ]);
    })();
  }

  await seedPromise;
};

const readUsers = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedUsers];
  }

  await seedDatabaseIfNeeded();
  return withProjection(collectionsFor(db).users).toArray();
};

const readProfiles = async () => {
  const db = await getDb();
  if (!db) {
    return [] as Profile[];
  }

  await seedDatabaseIfNeeded();
  return withProjection(collectionsFor(db).profiles).toArray();
};

const readBusinesses = async () => {
  const db = await getDb();
  if (!db) {
    return seedBusinesses;
  }
  await seedDatabaseIfNeeded();
  return db.collection<BusinessProfile>('businesses').find({}, { projection: { _id: 0 } }).toArray();
};

const saveBusiness = async (business: BusinessProfile) => {
  const db = await getDb();
  if (!db) {
    const index = seedBusinesses.findIndex((item) => item.id === business.id);
    if (index >= 0) {
      seedBusinesses[index] = business;
    } else {
      seedBusinesses.unshift(business);
    }
    return business;
  }
  await seedDatabaseIfNeeded();
  await db.collection<BusinessProfile>('businesses').updateOne({ id: business.id }, { $set: business }, { upsert: true });
  return business;
};

const businessesForUser = async (userId: string) =>
  (await readBusinesses()).filter((business) => business.members.some((member) => member.userId === userId));

const businessRoleFor = (business: BusinessProfile, userId: string) =>
  business.members.find((member) => member.userId === userId)?.role ?? null;

const chatSpaceOf = (chat: Chat) => (chat.space && chat.space !== 'personal' ? chat.space : 'personal');

const blockedBy = (profile: Profile | null | undefined, otherUserId: string) =>
  Boolean(profile?.blockedUserIds?.includes(otherUserId));

const usersHaveBlock = async (leftUserId: string, rightUserId: string) => {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) {
    return false;
  }
  const [left, right] = await Promise.all([readProfile(leftUserId), readProfile(rightUserId)]);
  return blockedBy(left, rightUserId) || blockedBy(right, leftUserId);
};

const privacyAllows = (
  setting: 'everyone' | 'contacts' | 'nobody' | undefined,
  viewerId: string,
  ownerId: string,
  mutual: boolean,
) => {
  const privacy = setting ?? 'everyone';
  if (viewerId === ownerId || privacy === 'everyone') return true;
  if (privacy === 'nobody') return false;
  return mutual;
};

const readUserByPhone = async (phone: string, countryCode?: string) => {
  const users = await readUsers();
  const profiles = await readProfiles();
  const matches = users.filter((user) => {
    const profile = profiles.find((item) => item.id === user.id);
    return phonesMatch(user.phone, phone, profile?.countryCode, countryCode);
  });
  matches.sort((left, right) => left.id.localeCompare(right.id));
  return matches[0] ?? null;
};

const readOtpChallenge = async (challengeId: string) => {
  const db = await getDb();
  if (!db) {
    return seedOtpChallenges.find((challenge) => challenge.id === challengeId) ?? null;
  }

  await seedDatabaseIfNeeded();
  return db.collection<OtpChallenge>('otpChallenges').findOne({ id: challengeId }, { projection: { _id: 0 } });
};

const persistOtpChallenge = async (challenge: OtpChallenge) => {
  const db = await getDb();
  if (!db) {
    seedOtpChallenges.unshift(challenge);
    return challenge;
  }

  await seedDatabaseIfNeeded();
  await db.collection<OtpChallenge>('otpChallenges').insertOne(challenge);
  return challenge;
};

const updateOtpChallenge = async (challengeId: string, updater: (challenge: OtpChallenge) => OtpChallenge) => {
  const db = await getDb();
  if (!db) {
    const index = seedOtpChallenges.findIndex((challenge) => challenge.id === challengeId);
    if (index < 0) {
      return null;
    }
    seedOtpChallenges[index] = updater(seedOtpChallenges[index]);
    return seedOtpChallenges[index];
  }

  await seedDatabaseIfNeeded();
  const collection = db.collection<OtpChallenge>('otpChallenges');
  const current = await collection.findOne({ id: challengeId }, { projection: { _id: 0 } });
  if (!current) {
    return null;
  }

  const nextChallenge = updater(current);
  await collection.replaceOne({ id: challengeId }, nextChallenge);
  return nextChallenge;
};

const readLinkRequest = async (requestId: string) => {
  const db = await getDb();
  if (!db) {
    return seedLinkRequests.find((request) => request.id === requestId) ?? null;
  }

  await seedDatabaseIfNeeded();
  return db.collection<LinkRequest>('linkRequests').findOne({ id: requestId }, { projection: { _id: 0 } });
};

const persistLinkRequest = async (request: LinkRequest) => {
  const db = await getDb();
  if (!db) {
    seedLinkRequests.unshift(request);
    return request;
  }

  await seedDatabaseIfNeeded();
  await db.collection<LinkRequest>('linkRequests').insertOne(request);
  return request;
};

const updateLinkRequest = async (requestId: string, updater: (request: LinkRequest) => LinkRequest) => {
  const db = await getDb();
  if (!db) {
    const index = seedLinkRequests.findIndex((request) => request.id === requestId);
    if (index < 0) {
      return null;
    }
    seedLinkRequests[index] = updater(seedLinkRequests[index]);
    return seedLinkRequests[index];
  }

  await seedDatabaseIfNeeded();
  const collection = db.collection<LinkRequest>('linkRequests');
  const current = await collection.findOne({ id: requestId }, { projection: { _id: 0 } });
  if (!current) {
    return null;
  }

  const nextRequest = updater(current);
  await collection.replaceOne({ id: requestId }, nextRequest);
  return nextRequest;
};

const readSessionByDeviceId = async (deviceId: string) => {
  const db = await getDb();
  if (!db) {
    return seedSessions.find((session) => session.deviceId === deviceId) ?? null;
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).sessions.findOne({ deviceId }, { projection: { _id: 0 } });
};

const readSessionsByUserId = async (userId: string) => {
  const db = await getDb();
  if (!db) {
    return seedSessions.filter((session) => session.userId === userId);
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).sessions.find({ userId }, { projection: { _id: 0 } }).toArray();
};

const isLinkedSession = (session: DeviceSession) => session.kind === 'linked' || session.platform === 'web';

const linkedDeviceSummary = async (userId: string, deviceId?: string | null) => {
  const sessions = userId ? await readSessionsByUserId(userId) : [];
  const linked = sessions.filter((session) => isLinkedSession(session) && session.deviceId !== deviceId);
  return {
    linkedCount: linked.length,
    limit: MAX_LINKED_DEVICES,
    remaining: Math.max(0, MAX_LINKED_DEVICES - linked.length),
  };
};

const canOpenAnotherSession = async (userId: string, deviceId?: string | null) => {
  if (!userId) return true;
  const summary = await linkedDeviceSummary(userId, deviceId);
  return summary.remaining > 0;
};

const ensureSession = async (input: z.infer<typeof ensureSessionSchema>) => {
  const nowIso = new Date().toISOString();
  const users = await readUsers();
  // Omitting preferredUserId must keep the saved account. Sending it replaces the account.
  const explicitUserId = input.preferredUserId
    ? users.find((user) => user.id === input.preferredUserId)?.id
    : undefined;
  const deviceId = input.deviceId ?? crypto.randomUUID();
  const kind = input.kind ?? (input.platform === 'web' ? 'linked' : 'phone');

  const db = await getDb();
  if (!db) {
    const existing = seedSessions.find((session) => session.deviceId === deviceId);
    if (existing) {
      existing.userId = explicitUserId === undefined ? existing.userId : explicitUserId;
      existing.platform = input.platform;
      existing.label = input.label;
      existing.kind = kind;
      existing.lastSeenAt = nowIso;
      return existing;
    }

    const session: DeviceSession = {
      id: `session-${Date.now()}`,
      deviceId,
      userId: explicitUserId ?? '',
      platform: input.platform,
      label: input.label,
      kind,
      createdAt: nowIso,
      lastSeenAt: nowIso,
    };
    seedSessions.unshift(session);
    return session;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const existing = await collections.sessions.findOne({ deviceId }, { projection: { _id: 0 } });
  if (existing) {
    const userId = explicitUserId === undefined ? existing.userId : explicitUserId;
    await collections.sessions.updateOne(
      { deviceId },
      {
        $set: {
          userId,
          platform: input.platform,
          label: input.label,
          kind,
          lastSeenAt: nowIso,
        },
      },
    );
    if (kind === 'phone' && userId) {
      await collections.sessions.deleteMany({
        userId,
        deviceId: { $ne: deviceId },
        platform: { $ne: 'web' },
        kind: { $ne: 'linked' },
      });
    }
    return {
      ...existing,
      userId,
      platform: input.platform,
      label: input.label,
      kind,
      lastSeenAt: nowIso,
    };
  }

  const session: DeviceSession = {
    id: `session-${Date.now()}`,
    deviceId,
    userId: explicitUserId ?? '',
    platform: input.platform,
    label: input.label,
    kind,
    createdAt: nowIso,
    lastSeenAt: nowIso,
  };
  await collections.sessions.insertOne(session);
  if (kind === 'phone' && session.userId) {
    await collections.sessions.deleteMany({
      userId: session.userId,
      deviceId: { $ne: deviceId },
      platform: { $ne: 'web' },
      kind: { $ne: 'linked' },
    });
  }
  return session;
};

const resolveRequestUserId = async (req: express.Request) => {
  if (typeof req.query.userId === 'string' && req.query.userId.trim()) {
    return req.query.userId.trim();
  }

  if (typeof req.query.deviceId === 'string' && req.query.deviceId.trim()) {
    const session = await readSessionByDeviceId(req.query.deviceId.trim());
    if (session) {
      return session.userId;
    }
  }

  return '';
};

const readProfile = async (userId = DEFAULT_USER_ID) => {
  const db = await getDb();
  if (!db) {
    return seedProfiles.find((profile) => profile.id === userId) ?? { ...emptyProfile };
  }

  await seedDatabaseIfNeeded();
  const profile = await collectionsFor(db).profiles.findOne({ id: userId }, { projection: { _id: 0 } });
  return profile ?? seedProfiles.find((item) => item.id === userId) ?? { ...emptyProfile };
};

const readChats = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedChats];
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).chats.find({}, { projection: { _id: 0 }, sort: { updatedAt: -1 } }).toArray();
};

const readMessages = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedMessages];
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).messages.find({}, { projection: { _id: 0 }, sort: { sentAt: 1 } }).toArray();
};

const readContacts = async (ownerUserId?: string) => {
  const db = await getDb();
  if (!db) {
    return ownerUserId ? seedContacts.filter((contact) => contact.ownerUserId === ownerUserId) : [...seedContacts];
  }

  await seedDatabaseIfNeeded();
  const cursor = collectionsFor(db).contacts.find(
    ownerUserId ? { ownerUserId } : {},
    { projection: { _id: 0 } },
  );
  return cursor.toArray();
};

const readChatRequests = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedChatRequests];
  }
  await seedDatabaseIfNeeded();
  return collectionsFor(db).chatRequests.find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } }).toArray();
};

const saveChatRequest = async (request: ChatRequest) => {
  const db = await getDb();
  if (!db) {
    const index = seedChatRequests.findIndex((item) => item.id === request.id);
    if (index >= 0) {
      seedChatRequests[index] = request;
    } else {
      seedChatRequests.unshift(request);
    }
    return request;
  }
  await seedDatabaseIfNeeded();
  await collectionsFor(db).chatRequests.updateOne({ id: request.id }, { $set: request }, { upsert: true });
  return request;
};

const countryKeyFor = (user?: User, profile?: Profile | null) => {
  const digits = String(profile?.countryCode || user?.phone || '').replace(/\D/g, '');
  const match = CURRENCY_BY_CALLING_CODE
    .slice()
    .sort((left, right) => right[0].length - left[0].length)
    .find(([code]) => digits.startsWith(code));
  return match?.[0] || digits.slice(0, 3);
};

const readCalls = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedCalls];
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).calls.find({}, { projection: { _id: 0 }, sort: { startedAt: -1 } }).toArray();
};

const readStatuses = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedStatuses].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).statuses.find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } }).toArray();
};

const readCatalogItems = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedCatalogItems];
  }

  await seedDatabaseIfNeeded();
  return collectionsFor(db).catalogItems.find({}, { projection: { _id: 0 }, sort: { updatedAt: -1 } }).toArray();
};

const replaceUserId = (ids: string[], from: string, to: string) =>
  [...new Set(ids.map((id) => (id === from ? to : id)))];

const mergePhoneDuplicates = async (keeperId: string) => {
  const users = await readUsers();
  const profiles = await readProfiles();
  const keeper = users.find((user) => user.id === keeperId);
  if (!keeper?.phone) return;
  const keeperProfile = profiles.find((profile) => profile.id === keeperId) ?? null;
  const duplicates = users.filter((user) =>
    user.id !== keeperId
    && Boolean(user.phone)
    && phonesMatch(
      user.phone,
      keeper.phone,
      profiles.find((profile) => profile.id === user.id)?.countryCode,
      keeperProfile?.countryCode,
    ),
  );
  if (!duplicates.length) return;
  const db = await getDb();
  if (!db) return;
  const collections = collectionsFor(db);
  for (const duplicate of duplicates) {
    const from = duplicate.id;
    const chats = await collections.chats.find({ participants: from }, { projection: { _id: 0 } }).toArray();
    for (const chat of chats) {
      const participants = replaceUserId(chat.participants, from, keeperId);
      const adminIds = replaceUserId(chat.adminIds ?? [], from, keeperId);
      const unreadByUser = { ...(chat.unreadByUser ?? {}) };
      if (unreadByUser[from] != null) {
        unreadByUser[keeperId] = (unreadByUser[keeperId] ?? 0) + unreadByUser[from];
        delete unreadByUser[from];
      }
      await collections.chats.updateOne({ id: chat.id }, { $set: { participants, adminIds, unreadByUser } });
    }
    await collections.messages.updateMany({ senderId: from }, { $set: { senderId: keeperId } });
    const calls = await collections.calls.find({ participantIds: from }, { projection: { _id: 0 } }).toArray();
    for (const call of calls) {
      await collections.calls.updateOne({ id: call.id }, {
        $set: {
          participantIds: replaceUserId(call.participantIds, from, keeperId),
          initiatorId: call.initiatorId === from ? keeperId : call.initiatorId,
        },
      });
    }
    await collections.contacts.updateMany({ ownerUserId: from }, { $set: { ownerUserId: keeperId } });
    await collections.contacts.updateMany({ linkedUserId: from }, { $set: { linkedUserId: keeperId } });
    await collections.statuses.updateMany({ userId: from }, { $set: { userId: keeperId } });
    await collections.catalogItems.updateMany({ sellerId: from }, { $set: { sellerId: keeperId } });
    await collections.sessions.updateMany({ userId: from }, { $set: { userId: keeperId } });
    await collections.chatRequests.updateMany({ fromUserId: from }, { $set: { fromUserId: keeperId } });
    await collections.chatRequests.updateMany({ toUserId: from }, { $set: { toUserId: keeperId } });
    await collections.users.deleteOne({ id: from });
    await collections.profiles.deleteOne({ id: from });
  }

  const directChats = await collections.chats.find({ kind: 'direct', participants: keeperId }, { projection: { _id: 0 } }).toArray();
  const grouped = new Map<string, Chat[]>();
  for (const chat of directChats) {
    const key = [...chat.participants].sort().join(':');
    grouped.set(key, [...(grouped.get(key) ?? []), chat]);
  }
  for (const list of grouped.values()) {
    if (list.length < 2) continue;
    const [keep, ...extras] = [...list].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    for (const extra of extras) {
      await collections.messages.updateMany({ chatId: extra.id }, { $set: { chatId: keep.id } });
      await collections.chats.deleteOne({ id: extra.id });
    }
  }
};

const notifyOfflineUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
  channel: 'messages' | 'calls',
) => {
  if (!userId) return false;
  try {
    const awake = await io.in(`user:${userId}`).fetchSockets();
    if (awake.length) return false;
    const adminApp = getFirebaseAdminApp();
    if (!adminApp) {
      void recordAdminEvent(getDb, { level: 'warn', area: 'push', message: 'Push skipped because Firebase admin is not configured', detail: channel });
      return false;
    }
    const tokens = [...new Set(
      (await readSessionsByUserId(userId))
        .map((session) => session.pushToken)
        .filter((token): token is string => Boolean(token)),
    )];
    if (!tokens.length) {
      void recordAdminEvent(getDb, { level: 'warn', area: 'push', message: 'No push token for this account', detail: `${channel} ${userId}` });
      return false;
    }
    const result = await getMessaging(adminApp).sendEachForMulticast({
      tokens,
      data: { ...data, title, body, channel },
      android: {
        priority: 'high',
        ttl: channel === 'calls' ? 60_000 : 86_400_000,
      },
    });
    if (!result.successCount) {
      void recordAdminEvent(getDb, { level: 'error', area: 'push', message: 'Push was not accepted', detail: `${channel} ${result.failureCount} failed` });
      return false;
    }
    return true;
  } catch (error) {
    void recordAdminEvent(getDb, { level: 'error', area: 'push', message: 'Push failed', detail: error instanceof Error ? error.message : channel });
    return false;
  }
};

const recordCallMessage = async (call: Call) => {
  if (!['missed', 'declined', 'completed'].includes(call.state)) return;
  const participants = [...new Set(call.participantIds)].filter(Boolean);
  if (participants.length !== 2) return;
  const marker = `call-${call.id}`;
  const already = (await readMessages()).find((message) => message.clientRef === marker);
  if (already) return;
  const chat = await createOrFindDirectChat(participants[0], participants[1]);
  if (!chat) return;
  const video = call.kind === 'video';
  const noun = video ? 'video call' : 'voice call';
  const text = call.state === 'missed'
    ? `Missed ${noun}`
    : call.state === 'declined'
      ? `Declined ${noun}`
      : `${video ? 'Video' : 'Voice'} call${call.durationSeconds > 0 ? ` · ${call.durationSeconds}s` : ''}`;
  const message: Message = {
    id: `m${Date.now()}-${call.id}`,
    chatId: chat.id,
    senderId: call.initiatorId,
    clientRef: marker,
    kind: 'call',
    text,
    mediaUrls: [],
    sentAt: call.endedAt || new Date().toISOString(),
    state: 'sent',
    durationSeconds: call.durationSeconds,
    callKind: call.kind,
    callState: call.state === 'missed' || call.state === 'declined' ? call.state : 'completed',
  };
  await persistMessage(message);
  const updatedChat = await updateChatAfterMessage(chat.id, text, message.sentAt, call.initiatorId);
  for (const participantId of chat.participants) {
    io.to(`user:${participantId}`).emit('message:new', presentMessage(message, participantId));
  }
  if (updatedChat) {
    io.emit('chat:updated', updatedChat);
  }
  await updateCall(call.id, (current) => ({ ...current, logged: true }));
};

const expireStaleCalls = async () => {
  const cutoff = Date.now() - 70_000;
  const ringing = (await readCalls()).filter((call) => call.state === 'ringing' && new Date(call.startedAt).getTime() < cutoff);
  for (const call of ringing) {
    const missed = await updateCall(call.id, (current) => (
      current.state === 'ringing'
        ? { ...current, state: 'missed', endedAt: new Date().toISOString() }
        : current
    ));
    if (missed?.state === 'missed') {
      await recordCallMessage(missed);
      io.emit('call:updated', missed);
    }
  }
};

const buildBootstrapPayload = async (session: DeviceSession | null = null): Promise<BootstrapPayload> => {
  if (session?.userId) {
    await mergePhoneDuplicates(session.userId);
  }
  await expireStaleCalls();
  const currentUserId = session?.userId ?? '';
  if (!currentUserId) {
    return {
      authRequired: true,
      currentUserId: '',
      currentDeviceId: session?.deviceId ?? null,
      profile: {
        id: '',
        name: '',
        username: '',
        avatar: 'ZU',
        about: '',
        phone: '',
        countryCode: '',
        phoneVerifiedAt: null,
        appLockEnabled: false,
        pinHash: null,
        businessName: '',
        businessDescription: '',
      },
      users: [],
      chats: [],
      messagesByChat: {},
      contacts: [],
      calls: [],
      statuses: [],
      updatesFeed: [],
      catalogItems: [],
      settingsMenu,
      architecture: {
        mode: 'whatsapp-inspired',
        realtimeTransport: 'socket.io',
        syncStrategy: 'server fan-out plus device sync snapshots',
        persistenceMode: getPersistenceMode(),
        mongodbConfigured: Boolean(mongoUri),
        mediaStorageMode: MEDIA_STORAGE_MODE,
        cloudMediaConfigured:
          MEDIA_STORAGE_MODE === 'gcs'
            ? isGcsConfigured()
            : MEDIA_STORAGE_MODE === 'cloudinary'
              ? isCloudinaryConfigured()
              : true,
        encryptionBoundary: 'client-side in future phase',
      },
    };
  }

  let profile = await readProfile(currentUserId);
  if (profile?.id && !profile.currency) {
    const currency = currencyForCallingCode(profile.countryCode || profile.phone);
    profile = { ...profile, currency };
    await updateProfile(profile.id, { currency }).catch((error) => {
      console.warn('Could not store the account currency', error);
    });
  }

  const [rawUsers, profiles, chats, messages, contacts, allContacts, calls, statuses, catalogItems, chatRequests] = await Promise.all([
    readUsers(),
    readProfiles(),
    readChats(),
    readMessages(),
    readContacts(currentUserId),
    readContacts(),
    readCalls(),
    readStatuses(),
    readCatalogItems(),
    readChatRequests(),
  ]);
  const photoByUserId = new Map(profiles.map((item) => [item.id, item.photoUri || '']));
  const users = rawUsers.map((user) => ({
    ...user,
    photoUri: photoByUserId.get(user.id) || user.photoUri || '',
  }));
  const myBusinesses = await businessesForUser(currentUserId);
  const myBusinessIds = new Set(myBusinesses.map((business) => business.id));
  if (profile?.activeBusinessId && !myBusinessIds.has(profile.activeBusinessId)) {
    profile = { ...profile, activeBusinessId: null };
    await updateProfile(currentUserId, { activeBusinessId: null }).catch(() => undefined);
  }
  const visibleChats = chats
    .filter((chat) => chat.participants.includes(currentUserId) || (chat.space ? myBusinessIds.has(chat.space) : false))
    .map((chat) => {
      const unreadForUser = chat.unreadByUser?.[currentUserId] ?? 0;
      if (chat.kind !== 'direct') {
        return { ...chat, unreadCount: unreadForUser };
      }

      const others = chat.participants.filter((participantId) => participantId !== currentUserId);
      if (!others.length) {
        return { ...chat, title: 'Message yourself', unreadCount: unreadForUser };
      }

      const peerId = others[0];
      const peerUser = users.find((user) => user.id === peerId);
      return {
        ...chat,
        title: peerUser?.name ?? chat.title,
        unreadCount: unreadForUser,
      };
    });
  const visibleChatIds = new Set(visibleChats.map((chat) => chat.id));
  const nowMs = Date.now();
  const visibleMessages = messages.filter(
    (message) =>
      visibleChatIds.has(message.chatId) &&
      !message.deletedForEveryone &&
      !(message.deletedFor ?? []).includes(currentUserId) &&
      !(message.expiresAt && new Date(message.expiresAt).getTime() <= nowMs),
  );
  const visibleCalls = calls.filter((call) => call.participantIds.includes(currentUserId) && !(call.hiddenFor ?? []).includes(currentUserId));
  const mergedContacts = contacts.map((contact) => {
    const linkedUser = users.find((user) => user.id === contact.linkedUserId);
    return {
      ...contact,
      registered: Boolean(linkedUser),
      presence: linkedUser?.presence ?? 'offline',
    };
  });

  const savedByMe = new Set(
    contacts.map((contact) => contact.linkedUserId).filter((id): id is string => Boolean(id)),
  );
  const savedMe = new Set(
    allContacts
      .filter((contact) => contact.ownerUserId !== currentUserId && contact.linkedUserId === currentUserId)
      .map((contact) => contact.ownerUserId),
  );
  const mutualUserIds = [...savedByMe].filter((id) => savedMe.has(id));
  const mutualSet = new Set(mutualUserIds);
  const acceptedUserIds = new Set(
    chatRequests
      .filter((request) => request.state === 'accepted' && (request.fromUserId === currentUserId || request.toUserId === currentUserId))
      .map((request) => (request.fromUserId === currentUserId ? request.toUserId : request.fromUserId)),
  );
  const myCountry = countryKeyFor(
    rawUsers.find((user) => user.id === currentUserId),
    profile,
  );
  const profileById = new Map(profiles.map((item) => [item.id, item]));
  const userById = new Map(rawUsers.map((user) => [user.id, user]));
  const sameCountry = (userId: string) => countryKeyFor(userById.get(userId), profileById.get(userId)) === myCountry && Boolean(myCountry);
  const visibleStatuses = statuses.filter((status) => {
    const expiry = status.expiresAt
      ? new Date(status.expiresAt).getTime()
      : new Date(status.createdAt).getTime() + 24 * 60 * 60 * 1000;
    if (status.audience !== 'marketplace' && (!Number.isFinite(expiry) || expiry <= Date.now())) {
      return false;
    }
    if (status.userId === currentUserId) {
      return true;
    }
    const ownerStatusPrivacy = profileById.get(status.userId)?.statusPrivacy ?? 'contacts';
    if (ownerStatusPrivacy === 'nobody') {
      return false;
    }
    if ((ownerStatusPrivacy === 'contacts' || ownerStatusPrivacy === 'close-friends') && !mutualSet.has(status.userId) && status.audience !== 'marketplace') {
      return false;
    }
    if (status.audience === 'public') {
      return true;
    }
    if (status.audience === 'marketplace') {
      return sameCountry(status.userId);
    }
    return mutualSet.has(status.userId);
  });
  const visibleCatalog = catalogItems.filter((item) => {
    if (item.takenDown && item.sellerId !== currentUserId) {
      return false;
    }
    if (item.sellerId === currentUserId) {
      return true;
    }
    if (item.takenDown) {
      return false;
    }
    if (mutualSet.has(item.sellerId)) {
      return true;
    }
    return Boolean(item.isPublic) && sameCountry(item.sellerId);
  });
  const knownUserIds = new Set<string>([
    currentUserId,
    ...mutualUserIds,
    ...acceptedUserIds,
    ...visibleChats.flatMap((chat) => chat.participants),
  ]);
  const safeUsers = users.map((user) => {
    const theirProfile = profileById.get(user.id);
    const allows = (setting: 'everyone' | 'contacts' | 'nobody' | undefined) => {
      const privacy = setting ?? 'everyone';
      if (user.id === currentUserId || privacy === 'everyone') return true;
      if (privacy === 'nobody') return false;
      return mutualSet.has(user.id);
    };
    const seePresence = allows(theirProfile?.lastSeenPrivacy);
    const seePhoto = allows(theirProfile?.profilePhotoPrivacy);
    const seeAbout = allows(theirProfile?.aboutPrivacy);
    const known = knownUserIds.has(user.id);
    return {
      ...user,
      phone: known ? user.phone : '',
      username: known ? user.username : '',
      about: seeAbout ? user.about : '',
      photoUri: seePhoto ? (user.photoUri || '') : '',
      presence: seePresence ? user.presence : 'offline',
      lastSeenAt: seePresence ? user.lastSeenAt : undefined,
      lastSeenPrivacy: theirProfile?.lastSeenPrivacy ?? 'everyone',
      profilePhotoPrivacy: theirProfile?.profilePhotoPrivacy ?? 'everyone',
      aboutPrivacy: theirProfile?.aboutPrivacy ?? 'everyone',
    };
  });

  const appConfig = await readAppConfig(getDb);
  return {
    authRequired: false,
    currentUserId,
    currentDeviceId: session?.deviceId ?? null,
    profile,
    users: safeUsers,
    mutualUserIds,
    chatRequests: chatRequests.filter((request) => request.fromUserId === currentUserId || request.toUserId === currentUserId),
    chats: visibleChats,
    messagesByChat: buildMessagesByChat(visibleMessages.map((message) => presentMessage(message, currentUserId))),
    contacts: mergedContacts,
    calls: visibleCalls,
    statuses: visibleStatuses,
    updatesFeed: buildUpdateFeed(safeUsers, visibleStatuses),
    catalogItems: visibleCatalog,
    businesses: myBusinesses,
    notice: appConfig.bannerActive && appConfig.bannerText ? { text: appConfig.bannerText } : null,
    anonymousDailyLimit: appConfig.anonymousDailyLimit,
    settingsMenu,
    architecture: {
      mode: 'whatsapp-inspired',
      realtimeTransport: 'socket.io',
      syncStrategy: 'server fan-out plus device sync snapshots',
      persistenceMode: getPersistenceMode(),
      mongodbConfigured: Boolean(mongoUri),
      mediaStorageMode: MEDIA_STORAGE_MODE,
      cloudMediaConfigured:
        MEDIA_STORAGE_MODE === 'gcs'
          ? isGcsConfigured()
          : MEDIA_STORAGE_MODE === 'cloudinary'
            ? isCloudinaryConfigured()
            : true,
      encryptionBoundary: 'client-side in future phase',
    },
  };
};

const createAuthIdentity = async (
  name: string,
  countryCode: string,
  phoneNumber: string,
  pin?: string,
) => {
  const normalizedName = name.trim();
  const normalizedPhone = canonicalPhone(phoneNumber, countryCode);
  const existingUser = await readUserByPhone(normalizedPhone, countryCode);
  if (existingUser) {
    const existingProfile = await readProfile(existingUser.id);
    if (pin) {
      await updateProfile(existingUser.id, {
        pinHash: hashPin(pin),
        phone: canonicalPhone(existingUser.phone, existingProfile?.countryCode || countryCode),
        phoneVerifiedAt: new Date().toISOString(),
      });
    }
    return {
      user: { ...existingUser, phone: canonicalPhone(existingUser.phone, existingProfile?.countryCode || countryCode) },
      profile: existingProfile ?? { ...emptyProfile, id: existingUser.id, phone: normalizedPhone },
    };
  }
  const nextId = `u${Date.now()}`;
  const avatar = normalizedName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
    .slice(0, 2) || 'ZU';
  const usernameBase = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || `user${Date.now()}`;
  const user: User = {
    id: nextId,
    name: normalizedName,
    avatar,
    presence: 'online',
    phone: normalizedPhone,
    about: 'Joined Zynkup.',
    isBusiness: false,
  };
  const profile: Profile = {
    id: nextId,
    name: normalizedName,
    username: `@${usernameBase}`,
    avatar,
    about: 'Joined Zynkup.',
    phone: normalizedPhone,
    countryCode,
    phoneVerifiedAt: new Date().toISOString(),
    appLockEnabled: Boolean(pin),
    pinHash: pin ? hashPin(pin) : null,
    businessName: '',
    businessDescription: '',
    currency: currencyForCallingCode(countryCode || normalizedPhone),
  };

  const db = await getDb();
  if (!db) {
    if (process.env.NODE_ENV === 'production') {
      const error = new Error('Accounts cannot be saved because MongoDB is not connected on this server.');
      (error as Error & { statusCode?: number }).statusCode = 503;
      throw error;
    }
    seedUsers.unshift(user);
    seedProfiles.unshift(profile);
    return { user, profile };
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  await collections.users.insertOne(user);
  await collections.profiles.insertOne(profile);
  return { user, profile };
};

const createOtpChallenge = async (countryCode: string, phoneNumber: string) => {
  const normalizedPhone = normalizePhone(countryCode, phoneNumber);
  const challenge: OtpChallenge = {
    id: `otp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phone: normalizedPhone,
    normalizedPhone,
    countryCode: countryCode.startsWith('+') ? countryCode : `+${countryCode}`,
    code: process.env.NODE_ENV === 'production' ? `${Math.floor(100000 + Math.random() * 900000)}` : '123456',
    provider: FIREBASE_WEB_API_KEY ? 'google-firebase-ready' : 'development',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    verifiedAt: null,
  };
  await persistOtpChallenge(challenge);
  return challenge;
};

const syncDeviceContacts = async (
  ownerUserId: string,
  contacts: Array<{ name: string; phone: string }>,
) => {
  const users = await readUsers();
  const syncedContacts: Contact[] = contacts.map((contact, index) => {
    const normalizedPhone = sanitizePhone(contact.phone);
    const linkedUser = users.find((user) => phonesMatch(user.phone, contact.phone));

    return {
      id: `contact-${ownerUserId}-${index}-${Date.now()}`,
      ownerUserId,
      name: contact.name.trim(),
      phone: contact.phone.trim(),
      normalizedPhone,
      linkedUserId: linkedUser?.id ?? null,
      registered: Boolean(linkedUser),
      presence: linkedUser?.presence ?? 'offline',
    };
  });

  const db = await getDb();
  if (!db) {
    for (let index = seedContacts.length - 1; index >= 0; index -= 1) {
      if (seedContacts[index].ownerUserId === ownerUserId) {
        seedContacts.splice(index, 1);
      }
    }
    seedContacts.push(...syncedContacts);
    return syncedContacts;
  }

  await seedDatabaseIfNeeded();
  const collection = collectionsFor(db).contacts;
  await collection.deleteMany({ ownerUserId });
  if (syncedContacts.length) {
    await collection.insertMany(syncedContacts);
  }
  return syncedContacts;
};

const persistMessage = async (message: Message) => {
  const db = await getDb();
  if (!db) {
    seedMessages.push(message);
    return message;
  }

  await seedDatabaseIfNeeded();
  await collectionsFor(db).messages.insertOne(message);
  return message;
};

const saveMessageUpdate = async (message: Message) => {
  const db = await getDb();
  if (!db) {
    const index = seedMessages.findIndex((entry) => entry.id === message.id);
    if (index >= 0) seedMessages[index] = message;
    else seedMessages.push(message);
    return message;
  }
  await seedDatabaseIfNeeded();
  await collectionsFor(db).messages.updateOne({ id: message.id }, { $set: message }, { upsert: true });
  return message;
};

const createOrFindDirectChat = async (userId: string, peerUserId: string, space = 'personal') => {
  const users = await readUsers();
  const peerUser = users.find((user) => user.id === peerUserId);
  if (!peerUser) {
    return null;
  }

  const wantedSpace = space && space !== 'personal' ? space : 'personal';
  const selfChat = userId === peerUserId;
  const participants = selfChat ? [userId] : [userId, peerUserId].sort();
  const sameThread = (chat: Chat) =>
    chat.kind === 'direct'
    && [...chat.participants].sort().join(':') === participants.join(':')
    && chatSpaceOf(chat) === wantedSpace;
  const db = await getDb();
  if (!db) {
    const existing = seedChats.find(sameThread);
    if (existing) {
      return existing;
    }

    const chat: Chat = {
      id: `c${Date.now()}`,
      title: selfChat ? 'Message yourself' : peerUser.name,
      kind: 'direct',
      participants,
      space: wantedSpace,
      unreadCount: 0,
      lastMessagePreview: 'Say hello',
      updatedAt: new Date().toISOString(),
    };
    seedChats.unshift(chat);
    return chat;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const chats = await collections.chats.find({ kind: 'direct' }, { projection: { _id: 0 } }).toArray();
  const existing = chats.find(sameThread);
  if (existing) {
    return existing;
  }

  const chat: Chat = {
    id: `c${Date.now()}`,
    title: selfChat ? 'Message yourself' : peerUser.name,
    kind: 'direct',
    participants,
    space: wantedSpace,
    unreadCount: 0,
    lastMessagePreview: 'Say hello',
    updatedAt: new Date().toISOString(),
  };
  await collections.chats.insertOne(chat);
  return chat;
};

const createChatRoom = async (userId: string, title: string, memberIds: string[], space = 'personal') => {
  const users = await readUsers();
  if (!users.some((user) => user.id === userId)) {
    return null;
  }
  const participants = [...new Set([userId, ...memberIds])];
  if (participants.length < 2) {
    return null;
  }

  const chat: Chat = {
    id: `c${Date.now()}`,
    title,
    kind: 'group',
    participants,
    adminIds: [userId],
    space: space && space !== 'personal' ? space : 'personal',
    unreadCount: 0,
    unreadByUser: {},
    lastMessagePreview: 'Chat room created',
    updatedAt: new Date().toISOString(),
    allowAnonymous: false,
  };

  const db = await getDb();
  if (!db) {
    seedChats.unshift(chat);
    return chat;
  }

  await seedDatabaseIfNeeded();
  await collectionsFor(db).chats.insertOne(chat);
  return chat;
};

const updateMessageReceipt = async (
  messageId: string,
  state: 'delivered' | 'read',
) => {
  const timestamp = new Date().toISOString();
  const changes =
    state === 'read'
      ? { state, deliveredAt: timestamp, readAt: timestamp }
      : { state, deliveredAt: timestamp };

  const db = await getDb();
  if (!db) {
    const message = seedMessages.find((item) => item.id === messageId);
    if (!message) {
      return null;
    }

    Object.assign(message, changes);
    return message;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  await collections.messages.updateOne({ id: messageId }, { $set: changes });
  return collections.messages.findOne({ id: messageId }, { projection: { _id: 0 } });
};

const bumpUnreadForRecipients = (
  chat: Chat,
  senderId: string,
): Record<string, number> => {
  const unreadByUser = { ...(chat.unreadByUser ?? {}) };
  for (const participantId of chat.participants) {
    if (participantId === senderId) {
      continue;
    }
    unreadByUser[participantId] = (unreadByUser[participantId] ?? 0) + 1;
  }
  return unreadByUser;
};

const updateChatAfterMessage = async (
  chatId: string,
  preview: string,
  updatedAt: string,
  senderId?: string,
) => {
  const db = await getDb();
  if (!db) {
    const fallbackChat = seedChats.find((item) => item.id === chatId);
    if (!fallbackChat) {
      return null;
    }
    fallbackChat.lastMessagePreview = preview;
    fallbackChat.updatedAt = updatedAt;
    if (senderId) {
      fallbackChat.unreadByUser = bumpUnreadForRecipients(fallbackChat, senderId);
      fallbackChat.unreadCount = Object.values(fallbackChat.unreadByUser).reduce((sum, n) => sum + n, 0);
    }
    return fallbackChat;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const current = await collections.chats.findOne({ id: chatId }, { projection: { _id: 0 } });
  if (!current) {
    return null;
  }

  const unreadByUser = senderId ? bumpUnreadForRecipients(current, senderId) : (current.unreadByUser ?? {});
  const unreadCount = Object.values(unreadByUser).reduce((sum, n) => sum + n, 0);
  await collections.chats.updateOne(
    { id: chatId },
    {
      $set: {
        lastMessagePreview: preview,
        updatedAt,
        unreadByUser,
        unreadCount,
      },
    },
  );

  return collections.chats.findOne({ id: chatId }, { projection: { _id: 0 } });
};

const clearChatUnread = async (chatId: string, userId: string) => {
  const db = await getDb();
  if (!db) {
    const chat = seedChats.find((item) => item.id === chatId);
    if (!chat) {
      return null;
    }
    chat.unreadByUser = { ...(chat.unreadByUser ?? {}), [userId]: 0 };
    chat.unreadCount = Object.values(chat.unreadByUser).reduce((sum, n) => sum + n, 0);
    return chat;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const chat = await collections.chats.findOne({ id: chatId }, { projection: { _id: 0 } });
  if (!chat) {
    return null;
  }
  const unreadByUser = { ...(chat.unreadByUser ?? {}), [userId]: 0 };
  const unreadCount = Object.values(unreadByUser).reduce((sum, n) => sum + n, 0);
  await collections.chats.updateOne({ id: chatId }, { $set: { unreadByUser, unreadCount } });
  return collections.chats.findOne({ id: chatId }, { projection: { _id: 0 } });
};

const persistStatus = async (status: StatusPost) => {
  const db = await getDb();
  if (!db) {
    seedStatuses.unshift(status);
    return status;
  }

  await seedDatabaseIfNeeded();
  await collectionsFor(db).statuses.insertOne(status);
  return status;
};

const updateStatusPost = async (
  statusId: string,
  updater: (status: StatusPost) => StatusPost,
) => {
  const db = await getDb();
  if (!db) {
    const index = seedStatuses.findIndex((item) => item.id === statusId);
    if (index < 0) {
      return null;
    }

    seedStatuses[index] = updater(seedStatuses[index]);
    return seedStatuses[index];
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const current = await collections.statuses.findOne({ id: statusId }, { projection: { _id: 0 } });
  if (!current) {
    return null;
  }

  const nextStatus = updater(current);
  await collections.statuses.replaceOne({ id: statusId }, nextStatus);
  return nextStatus;
};

const addStatusReaction = async (statusId: string, userId: string, emoji: string) =>
  updateStatusPost(statusId, (status) => {
    const withoutMine = status.reactions.filter((reaction) => reaction.userId !== userId);
    const existing = status.reactions.find((reaction) => reaction.userId === userId);
    return {
      ...status,
      reactions:
        existing?.emoji === emoji
          ? withoutMine
          : [
              ...withoutMine,
              {
                userId,
                emoji,
                reactedAt: new Date().toISOString(),
              },
            ],
    };
  });

const addStatusComment = async (statusId: string, userId: string, text: string) =>
  updateStatusPost(statusId, (status) => ({
    ...status,
    comments: [
      ...status.comments,
      {
        id: `sc${Date.now()}`,
        userId,
        text,
        createdAt: new Date().toISOString(),
      },
    ],
  }));

const updateStatusComment = async (statusId: string, commentId: string, userId: string, text: string) =>
  updateStatusPost(statusId, (status) => ({
    ...status,
    comments: status.comments.map((comment) =>
      comment.id === commentId && comment.userId === userId
        ? {
            ...comment,
            text,
            updatedAt: new Date().toISOString(),
          }
        : comment,
    ),
  }));

const deleteStatusComment = async (statusId: string, commentId: string, userId: string) =>
  updateStatusPost(statusId, (status) => ({
    ...status,
    comments: status.comments.filter((comment) => !(comment.id === commentId && comment.userId === userId)),
  }));

const addStatusView = async (statusId: string, userId: string) =>
  updateStatusPost(statusId, (status) => {
    if (status.userId === userId || status.views.some((view) => view.userId === userId)) {
      return status;
    }

    return {
      ...status,
      views: [
        ...status.views,
        {
          userId,
          viewedAt: new Date().toISOString(),
        },
      ],
    };
  });

const readStatusViewers = async (statusId: string) => {
  const [users, statuses] = await Promise.all([readUsers(), readStatuses()]);
  const status = statuses.find((item) => item.id === statusId);
  if (!status) {
    return null;
  }

  return status.views
    .map((view) => {
      const user = users.find((item) => item.id === view.userId);
      return user
        ? {
            userId: user.id,
            name: user.name,
            avatar: user.avatar,
            viewedAt: view.viewedAt,
          }
        : null;
    })
    .filter(Boolean);
};

const readStatusReactors = async (statusId: string) => {
  const [users, statuses] = await Promise.all([readUsers(), readStatuses()]);
  const status = statuses.find((item) => item.id === statusId);
  if (!status) {
    return null;
  }

  return status.reactions
    .map((reaction) => {
      const user = users.find((item) => item.id === reaction.userId);
      return user
        ? {
            userId: user.id,
            name: user.name,
            avatar: user.avatar,
            emoji: reaction.emoji,
            reactedAt: reaction.reactedAt,
          }
        : null;
    })
    .filter(Boolean);
};

const deleteStatusById = async (statusId: string, userId: string) => {
  const db = await getDb();
  if (!db) {
    const index = seedStatuses.findIndex((item) => item.id === statusId && item.userId === userId);
    if (index < 0) {
      return null;
    }

    const [removed] = seedStatuses.splice(index, 1);
    await deleteHostedFiles(removed.assets.map((asset) => asset.url));
    return removed;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const status = await collections.statuses.findOne({ id: statusId, userId }, { projection: { _id: 0 } });
  if (!status) {
    return null;
  }

  await collections.statuses.deleteOne({ id: statusId, userId });
  await deleteHostedFiles(status.assets.map((asset) => asset.url));
  return status;
};

const persistCatalogItem = async (item: CatalogItem) => {
  const db = await getDb();
  if (!db) {
    seedCatalogItems.unshift(item);
    return item;
  }

  await seedDatabaseIfNeeded();
  await collectionsFor(db).catalogItems.insertOne(item);
  return item;
};

const readOrders = async () => {
  const db = await getDb();
  if (!db) {
    return [...seedOrders];
  }
  await seedDatabaseIfNeeded();
  return db.collection<CommerceOrder>('orders').find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } }).toArray();
};

const saveOrder = async (order: CommerceOrder) => {
  const db = await getDb();
  if (!db) {
    const index = seedOrders.findIndex((item) => item.id === order.id);
    if (index >= 0) seedOrders[index] = order;
    else seedOrders.unshift(order);
    return order;
  }
  await seedDatabaseIfNeeded();
  await db.collection<CommerceOrder>('orders').updateOne({ id: order.id }, { $set: order }, { upsert: true });
  return order;
};

const readSaleReceipts = async () => {
  const db = await getDb();
  if (!db) return [...seedReceipts];
  await seedDatabaseIfNeeded();
  return db.collection<SaleReceipt>('saleReceipts').find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } }).toArray();
};

const saveSaleReceipt = async (receipt: SaleReceipt) => {
  const db = await getDb();
  if (!db) {
    const index = seedReceipts.findIndex((item) => item.id === receipt.id);
    if (index >= 0) seedReceipts[index] = receipt;
    else seedReceipts.unshift(receipt);
    return receipt;
  }
  await seedDatabaseIfNeeded();
  await db.collection<SaleReceipt>('saleReceipts').updateOne({ id: receipt.id }, { $set: receipt }, { upsert: true });
  return receipt;
};

const nextReceiptNumber = async (businessKey: string) => {
  const db = await getDb();
  const year = new Date().getFullYear();
  const key = `${businessKey}-${year}`;
  if (!db) {
    receiptCounters[key] = (receiptCounters[key] || 0) + 1;
    return `R-${year}-${String(receiptCounters[key]).padStart(5, '0')}`;
  }
  const result = await db.collection('receiptCounters').findOneAndUpdate(
    { id: key },
    { $inc: { seq: 1 }, $setOnInsert: { id: key, createdAt: new Date().toISOString() } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = Number((result as { seq?: number } | null)?.seq || 1);
  return `R-${year}-${String(seq).padStart(5, '0')}`;
};

const issueSaleReceiptForOrder = async (
  order: CommerceOrder,
  paymentMethod = 'marked_paid',
): Promise<{ order: CommerceOrder; receipt: SaleReceipt }> => {
  if (order.receiptId) {
    const existing = (await readSaleReceipts()).find((item) => item.id === order.receiptId);
    if (existing) return { order, receipt: existing };
  }
  const byOrder = (await readSaleReceipts()).find(
    (item) => item.orderId === order.id && item.state === 'issued',
  );
  if (byOrder) {
    const linked = { ...order, receiptId: byOrder.id, updatedAt: new Date().toISOString() };
    await saveOrder(linked);
    return { order: linked, receipt: byOrder };
  }

  const [seller, buyer, sellerProfile, buyerProfile] = await Promise.all([
    readUsers().then((users) => users.find((user) => user.id === order.sellerUserId)),
    readUsers().then((users) => users.find((user) => user.id === order.buyerUserId)),
    readProfile(order.sellerUserId),
    readProfile(order.buyerUserId),
  ]);
  const business = order.businessId
    ? (await readBusinesses()).find((item) => item.id === order.businessId)
    : null;
  const now = new Date().toISOString();
  const businessKey = order.businessId || order.sellerUserId;
  const receiptNumber = await nextReceiptNumber(businessKey);
  const receipt: SaleReceipt = {
    id: `rcpt${Date.now()}`,
    receiptNumber,
    orderId: order.id,
    paymentId: order.paymentId || null,
    buyerUserId: order.buyerUserId,
    sellerUserId: order.sellerUserId,
    businessId: order.businessId || null,
    businessName: business?.name || sellerProfile?.businessName || seller?.name || 'Seller',
    sellerName: seller?.name || sellerProfile?.name || 'Seller',
    buyerName: buyer?.name || buyerProfile?.name || 'Customer',
    items: order.items.map((item) => ({ ...item })),
    subtotal: order.totalAmount,
    discount: 0,
    tax: 0,
    totalAmount: order.totalAmount,
    currency: order.currency,
    paymentMethod,
    paymentReference: order.paymentId || order.id,
    state: 'issued',
    linkedReceiptId: null,
    issuedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await saveSaleReceipt(receipt);
  let withReceipt = { ...order, receiptId: receipt.id, updatedAt: now };
  const space = order.businessId || 'personal';
  const chat = order.chatId
    ? (await readChats()).find((entry) => entry.id === order.chatId) || null
    : await createOrFindDirectChat(order.sellerUserId, order.buyerUserId, space);
  if (chat) {
    const itemTitle = order.items[0]?.title || 'item';
    const message: Message = {
      id: `m${Date.now()}`,
      chatId: chat.id,
      senderId: order.sellerUserId,
      kind: 'text',
      text: `Receipt ${receipt.receiptNumber} · ${receipt.currency} ${receipt.totalAmount} · ${itemTitle}`,
      mediaUrls: [],
      sentAt: now,
      state: 'sent',
      receiptId: receipt.id,
      catalogItemId: order.items[0]?.catalogItemId,
      actorBusinessId: order.businessId || undefined,
      actorName: receipt.businessName,
    };
    await persistMessage(message);
    const updatedChat = {
      ...chat,
      lastMessagePreview: message.text,
      updatedAt: now,
    };
    const db = await getDb();
    if (!db) {
      const index = seedChats.findIndex((entry) => entry.id === chat.id);
      if (index >= 0) seedChats[index] = updatedChat;
    } else {
      await collectionsFor(db).chats.updateOne({ id: chat.id }, { $set: updatedChat });
    }
    withReceipt = { ...withReceipt, chatId: chat.id };
    chat.participants.forEach((participantId) => {
      io.to(`user:${participantId}`).emit('message:new', presentMessage(message, participantId));
      io.to(`user:${participantId}`).emit('chat:updated', updatedChat);
    });
  }
  await saveOrder(withReceipt);
  io.to(`user:${order.sellerUserId}`).emit('receipt:created', { receipt });
  io.to(`user:${order.buyerUserId}`).emit('receipt:created', { receipt });
  void recordAdminEvent(getDb, {
    level: 'info',
    area: 'receipts',
    message: 'Sale receipt issued',
    detail: `${receipt.receiptNumber} ${order.id}`,
  });
  return { order: withReceipt, receipt };
};

const catalogIsPurchasable = (item: CatalogItem) => {
  const status = item.status || 'active';
  if (item.takenDown || status === 'archived' || status === 'draft') return false;
  if (status === 'out_of_stock') return false;
  if (item.trackStock !== false && item.stockQuantity <= 0) return false;
  return true;
};

const availableStock = (item: CatalogItem) =>
  Math.max(0, Number(item.stockQuantity || 0) - Number(item.reservedQuantity || 0));

const persistCatalogItemUpdate = async (item: CatalogItem) => {
  const db = await getDb();
  if (!db) {
    const index = seedCatalogItems.findIndex((entry) => entry.id === item.id);
    if (index >= 0) seedCatalogItems[index] = item;
    else seedCatalogItems.unshift(item);
    return item;
  }
  await collectionsFor(db).catalogItems.updateOne({ id: item.id }, { $set: item }, { upsert: true });
  return item;
};

const saveInventoryMovement = async (movement: InventoryMovement) => {
  const db = await getDb();
  if (!db) {
    seedInventoryMovements.unshift(movement);
    return movement;
  }
  await db.collection<InventoryMovement>('inventoryMovements').insertOne(movement);
  return movement;
};

const readInventoryAlerts = async () => {
  const db = await getDb();
  if (!db) return [...seedInventoryAlerts];
  return db.collection<InventoryAlert>('inventoryAlerts').find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } }).toArray();
};

const saveInventoryAlert = async (alert: InventoryAlert) => {
  const db = await getDb();
  if (!db) {
    const index = seedInventoryAlerts.findIndex((entry) => entry.id === alert.id);
    if (index >= 0) seedInventoryAlerts[index] = alert;
    else seedInventoryAlerts.unshift(alert);
    return alert;
  }
  await db.collection<InventoryAlert>('inventoryAlerts').updateOne({ id: alert.id }, { $set: alert }, { upsert: true });
  return alert;
};

const maybeCreateLowStockAlert = async (item: CatalogItem) => {
  if (item.trackStock === false) return null;
  const threshold = item.lowStockThreshold ?? 2;
  if ((item.stockQuantity ?? 0) > threshold) return null;
  const openExisting = (await readInventoryAlerts()).find(
    (alert) =>
      alert.catalogItemId === item.id
      && alert.state === 'open'
      && alert.stockQuantity === item.stockQuantity,
  );
  if (openExisting) return openExisting;
  const alert: InventoryAlert = {
    id: `ial${Date.now()}`,
    catalogItemId: item.id,
    sellerUserId: item.sellerId,
    businessId: item.businessId || null,
    title: item.title,
    stockQuantity: item.stockQuantity,
    lowStockThreshold: threshold,
    state: 'open',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedByUserId: null,
  };
  await saveInventoryAlert(alert);
  io.to(`user:${item.sellerId}`).emit('inventory:alert', alert);
  return alert;
};

const applyInventoryChange = async (params: {
  item: CatalogItem;
  delta: number;
  kind: InventoryMovementKind;
  reason: string;
  byUserId: string;
  orderId?: string | null;
  allowNegative?: boolean;
  lowStockThreshold?: number;
}) => {
  const { item, delta, kind, reason, byUserId, orderId, allowNegative, lowStockThreshold } = params;
  const tracksStock = item.trackStock !== false;
  if (!tracksStock) {
    return { item, movement: null as InventoryMovement | null, alert: null as InventoryAlert | null };
  }
  const stockBefore = Number(item.stockQuantity || 0);
  const stockAfter = allowNegative ? stockBefore + delta : Math.max(0, stockBefore + delta);
  if (!allowNegative && stockBefore + delta < 0) {
    throw new Error(`Only ${stockBefore} in stock.`);
  }
  const now = new Date().toISOString();
  const next: CatalogItem = {
    ...item,
    stockQuantity: stockAfter,
    lowStockThreshold: lowStockThreshold ?? item.lowStockThreshold ?? 2,
    status: resolveCatalogStatus(item.status, stockAfter, tracksStock),
    availabilityUpdatedAt: now,
    updatedAt: now,
  };
  await persistCatalogItemUpdate(next);
  const movement: InventoryMovement = {
    id: `im${Date.now()}`,
    catalogItemId: item.id,
    sellerUserId: item.sellerId,
    businessId: item.businessId || null,
    kind,
    quantityDelta: delta,
    stockBefore,
    stockAfter,
    reason,
    orderId: orderId || null,
    byUserId,
    createdAt: now,
  };
  await saveInventoryMovement(movement);
  io.emit('catalog:itemUpdated', next);
  const alert = await maybeCreateLowStockAlert(next);
  return { item: next, movement, alert };
};

const readBusinessCustomers = async () => {
  const db = await getDb();
  if (!db) return [...seedBusinessCustomers];
  return db
    .collection<BusinessCustomer>('businessCustomers')
    .find({}, { projection: { _id: 0 }, sort: { updatedAt: -1 } })
    .toArray();
};

const saveBusinessCustomer = async (customer: BusinessCustomer) => {
  const db = await getDb();
  if (!db) {
    const index = seedBusinessCustomers.findIndex((entry) => entry.id === customer.id);
    if (index >= 0) seedBusinessCustomers[index] = customer;
    else seedBusinessCustomers.unshift(customer);
    return customer;
  }
  await db.collection<BusinessCustomer>('businessCustomers').updateOne(
    { id: customer.id },
    { $set: customer },
    { upsert: true },
  );
  return customer;
};

const canManageCustomers = async (
  sellerUserId: string,
  actorUserId: string,
  businessId?: string | null,
) => {
  if (!sellerUserId || !actorUserId) return false;
  if (sellerUserId === actorUserId) return true;
  const businesses = await businessesForUser(actorUserId);
  if (businessId) {
    return businesses.some((business) => business.id === businessId);
  }
  return businesses.some((business) => business.ownerUserId === sellerUserId);
};

const customerPublicView = (customer: BusinessCustomer) => ({
  ...customer,
  notes: customer.notes.slice(0, 50),
  orderIds: customer.orderIds.slice(0, 40),
});

const findMatchingCustomer = (
  customers: BusinessCustomer[],
  params: { sellerUserId: string; customerUserId?: string | null; phone?: string; businessId?: string | null },
) => {
  const active = customers.filter(
    (entry) => entry.sellerUserId === params.sellerUserId && !entry.deletedAt,
  );
  if (params.customerUserId) {
    const byUser = active.find((entry) => entry.customerUserId === params.customerUserId);
    if (byUser) return byUser;
  }
  if (params.phone) {
    const normalized = params.phone.replace(/\D/g, '');
    if (normalized) {
      const byPhone = active.find(
        (entry) => (entry.phone || '').replace(/\D/g, '') === normalized,
      );
      if (byPhone) return byPhone;
    }
  }
  return null;
};

const ensureCustomerFromOrder = async (order: CommerceOrder) => {
  const [customers, users, allOrders] = await Promise.all([
    readBusinessCustomers(),
    readUsers(),
    readOrders(),
  ]);
  const existing = findMatchingCustomer(customers, {
    sellerUserId: order.sellerUserId,
    customerUserId: order.buyerUserId,
    businessId: order.businessId,
  });
  const now = new Date().toISOString();
  const buyer = users.find((user) => user.id === order.buyerUserId);
  const relatedOrders = allOrders.filter(
    (entry) => entry.sellerUserId === order.sellerUserId && entry.buyerUserId === order.buyerUserId,
  );
  const paidOrders = relatedOrders.filter((entry) =>
    ['paid', 'processing', 'dispatched', 'completed'].includes(entry.state),
  );
  const orderIds = relatedOrders
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => entry.id)
    .slice(0, 40);
  const totalSpent = Number(
    paidOrders.reduce((sum, entry) => sum + Number(entry.totalAmount || 0), 0).toFixed(2),
  );
  const lastOrderAt = relatedOrders
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt || order.createdAt;

  if (existing) {
    const next: BusinessCustomer = {
      ...existing,
      businessId: existing.businessId || order.businessId || null,
      customerUserId: existing.customerUserId || order.buyerUserId,
      displayName: existing.displayName || buyer?.name || 'Customer',
      phone: existing.phone || buyer?.phone || '',
      chatId: existing.chatId || order.chatId || null,
      orderIds,
      lastOrderAt,
      orderCount: relatedOrders.length,
      totalSpent,
      currency: order.currency || existing.currency,
      updatedAt: now,
      deletedAt: null,
    };
    await saveBusinessCustomer(next);
    io.to(`user:${order.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(next) });
    return next;
  }

  const created: BusinessCustomer = {
    id: `cust${Date.now()}`,
    sellerUserId: order.sellerUserId,
    businessId: order.businessId || null,
    customerUserId: order.buyerUserId,
    displayName: buyer?.name || 'Customer',
    phone: buyer?.phone || '',
    tags: [],
    notes: [],
    followUpAt: null,
    followUpNote: '',
    marketingConsent: 'unknown',
    marketingConsentUpdatedAt: null,
    orderIds,
    lastOrderAt,
    orderCount: relatedOrders.length || 1,
    totalSpent,
    currency: order.currency,
    chatId: order.chatId || null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveBusinessCustomer(created);
  io.to(`user:${order.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(created) });
  return created;
};

const defaultAutoReplyConfig = (sellerUserId: string, businessId?: string | null): BusinessAutoReplyConfig => {
  const now = new Date().toISOString();
  return {
    id: `ar-${sellerUserId}${businessId ? `-${businessId}` : ''}`,
    sellerUserId,
    businessId: businessId || null,
    enabled: false,
    greetingEnabled: true,
    greetingText: 'Thanks for messaging us. A teammate will reply soon.',
    awayEnabled: true,
    awayText: 'We are away right now. Leave a message and we will get back to you.',
    hoursText: '',
    humanHandoverKeywords: ['human', 'agent', 'person', 'speak to someone', 'real person'],
    rules: [],
    cooldownSeconds: 90,
    pausedChatIds: [],
    createdAt: now,
    updatedAt: now,
  };
};

const readAutoReplyConfigs = async () => {
  const db = await getDb();
  if (!db) return [...seedAutoReplyConfigs];
  return db
    .collection<BusinessAutoReplyConfig>('businessAutoReplies')
    .find({}, { projection: { _id: 0 } })
    .toArray();
};

const saveAutoReplyConfig = async (config: BusinessAutoReplyConfig) => {
  const db = await getDb();
  if (!db) {
    const index = seedAutoReplyConfigs.findIndex((entry) => entry.id === config.id);
    if (index >= 0) seedAutoReplyConfigs[index] = config;
    else seedAutoReplyConfigs.unshift(config);
    return config;
  }
  await db.collection<BusinessAutoReplyConfig>('businessAutoReplies').updateOne(
    { id: config.id },
    { $set: config },
    { upsert: true },
  );
  return config;
};

const getAutoReplyConfigForSeller = async (sellerUserId: string, businessId?: string | null) => {
  const configs = await readAutoReplyConfigs();
  if (businessId) {
    const byBusiness = configs.find(
      (entry) => entry.sellerUserId === sellerUserId && entry.businessId === businessId,
    );
    if (byBusiness) return byBusiness;
  }
  const personal = configs.find(
    (entry) => entry.sellerUserId === sellerUserId && (!entry.businessId || entry.businessId === null),
  );
  return personal || defaultAutoReplyConfig(sellerUserId, businessId || null);
};

const saveAutoReplyLog = async (log: AutoReplyLog) => {
  const db = await getDb();
  if (!db) {
    seedAutoReplyLogs.unshift(log);
    if (seedAutoReplyLogs.length > 500) seedAutoReplyLogs.length = 500;
    return log;
  }
  await db.collection<AutoReplyLog>('autoReplyLogs').insertOne(log);
  return log;
};

const textIncludesAny = (haystack: string, needles: string[]) => {
  const text = haystack.toLowerCase();
  return needles.some((needle) => {
    const value = needle.trim().toLowerCase();
    return value && text.includes(value);
  });
};

const matchAutoReply = (
  config: BusinessAutoReplyConfig,
  incomingText: string,
  isFirstCustomerMessage: boolean,
): { source: AutoReplyLog['source']; text: string; ruleId?: string | null } | null => {
  if (!config.enabled) return null;
  const text = incomingText.trim();
  if (!text) return null;

  if (textIncludesAny(text, config.humanHandoverKeywords || [])) {
    return {
      source: 'handover',
      text: 'Connecting you to a person now. Automation is paused for this chat.',
    };
  }

  const activeRules = (config.rules || []).filter((rule) => rule.enabled !== false);
  for (const rule of activeRules) {
    if (textIncludesAny(text, rule.keywords || [])) {
      return { source: 'rule', text: rule.response, ruleId: rule.id };
    }
  }

  if (
    config.hoursText
    && textIncludesAny(text, ['hours', 'open today', 'opening', 'closing', 'are you open', 'when do you open', 'closed'])
  ) {
    return {
      source: 'hours',
      text: `Our hours: ${config.hoursText}`,
    };
  }

  if (isFirstCustomerMessage && config.greetingEnabled && config.greetingText) {
    return { source: 'greeting', text: config.greetingText };
  }

  if (config.awayEnabled && config.awayText) {
    return { source: 'away', text: config.awayText };
  }

  return null;
};

const emitMessageToChat = async (message: Message, chat: Chat, sendingBusiness?: BusinessProfile | null) => {
  const senderUser = (await readUsers()).find((user) => user.id === message.senderId);
  const senderProfile = senderUser ? await readProfile(senderUser.id) : null;
  const recipientIds = new Set(chat.participants);
  sendingBusiness?.members.forEach((member) => recipientIds.add(member.userId));
  for (const participantId of recipientIds) {
    const delivered = presentMessage(message, participantId);
    io.to(`user:${participantId}`).emit('message:new', {
      ...delivered,
      sender: delivered.senderId === 'anonymous' || !senderUser
        ? undefined
        : {
            id: senderUser.id,
            name: senderUser.name,
            phone: senderUser.phone,
            username: senderProfile?.username || '',
            avatar: senderUser.avatar,
            photoUri: senderProfile?.photoUri || '',
          },
    });
  }
  const updatedChat = await updateChatAfterMessage(
    chat.id,
    message.automated ? `[Auto] ${message.text}` : message.text,
    message.sentAt,
    message.senderId,
  );
  if (updatedChat) {
    for (const participantId of chat.participants) {
      io.emit('chat:updated', {
        ...updatedChat,
        unreadCount: updatedChat.unreadByUser?.[participantId] ?? 0,
        viewerUserId: participantId,
      });
    }
  }
};

const maybeSendBusinessAutoReply = async (params: {
  chat: Chat;
  incoming: Message;
  senderId: string;
}) => {
  const { chat, incoming, senderId } = params;
  if (incoming.automated || incoming.anonymous || chat.kind !== 'direct') return null;
  if (incoming.kind !== 'text' || !incoming.text?.trim()) return null;

  const peerId = chat.participants.find((id) => id !== senderId);
  if (!peerId) return null;

  // Only auto-reply when messaging a business owner/seller account.
  const businesses = await businessesForUser(peerId);
  const ownedBusiness = businesses.find((business) => business.ownerUserId === peerId)
    || businesses[0]
    || null;
  const config = await getAutoReplyConfigForSeller(peerId, ownedBusiness?.id || null);
  if (!config.enabled) return null;
  if ((config.pausedChatIds || []).includes(chat.id)) return null;

  const recentLogs = (await (async () => {
    const db = await getDb();
    if (!db) return seedAutoReplyLogs.filter((entry) => entry.chatId === chat.id);
    return db
      .collection<AutoReplyLog>('autoReplyLogs')
      .find({ chatId: chat.id }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
  })());
  const lastLog = recentLogs[0];
  if (
    lastLog
    && Date.now() - new Date(lastLog.createdAt).getTime() < (config.cooldownSeconds || 90) * 1000
  ) {
    return null;
  }

  const priorCustomerMessages = (await readMessages()).filter(
    (entry) =>
      entry.chatId === chat.id
      && entry.senderId === senderId
      && !entry.automated
      && entry.id !== incoming.id,
  );
  const match = matchAutoReply(config, incoming.text, priorCustomerMessages.length === 0);
  if (!match) return null;

  let nextConfig = config;
  if (match.source === 'handover') {
    nextConfig = {
      ...config,
      pausedChatIds: Array.from(new Set([...(config.pausedChatIds || []), chat.id])).slice(-200),
      updatedAt: new Date().toISOString(),
    };
    await saveAutoReplyConfig(nextConfig);
  }

  const replyText = match.text.startsWith('Automated:')
    ? match.text
    : `Automated: ${match.text}`;
  const reply: Message = {
    id: `m${Date.now()}-auto`,
    chatId: chat.id,
    senderId: peerId,
    clientRef: `auto-${incoming.id}`,
    kind: 'text',
    text: replyText,
    mediaUrls: [],
    sentAt: new Date().toISOString(),
    state: 'sent',
    actorBusinessId: ownedBusiness?.id,
    actorName: ownedBusiness?.name || 'Business assistant',
    automated: true,
    autoReplySource: match.source,
  };
  await persistMessage(reply);
  await emitMessageToChat(reply, chat, ownedBusiness);
  const log: AutoReplyLog = {
    id: `arl${Date.now()}`,
    sellerUserId: peerId,
    businessId: ownedBusiness?.id || null,
    chatId: chat.id,
    customerUserId: senderId,
    triggerMessageId: incoming.id,
    replyMessageId: reply.id,
    source: match.source,
    ruleId: match.ruleId || null,
    createdAt: new Date().toISOString(),
  };
  await saveAutoReplyLog(log);
  io.to(`user:${peerId}`).emit('autoReply:sent', { log, message: reply });
  return { reply, log, config: nextConfig };
};

const readCommerceDocuments = async () => {
  const db = await getDb();
  if (!db) return [...seedCommerceDocuments];
  return db
    .collection<CommerceDocument>('commerceDocuments')
    .find({}, { projection: { _id: 0 }, sort: { updatedAt: -1 } })
    .toArray();
};

const saveCommerceDocument = async (doc: CommerceDocument) => {
  const db = await getDb();
  if (!db) {
    const index = seedCommerceDocuments.findIndex((entry) => entry.id === doc.id);
    if (index >= 0) seedCommerceDocuments[index] = doc;
    else seedCommerceDocuments.unshift(doc);
    return doc;
  }
  await db.collection<CommerceDocument>('commerceDocuments').updateOne(
    { id: doc.id },
    { $set: doc },
    { upsert: true },
  );
  return doc;
};

const nextDocumentNumber = async (kind: CommerceDocKind, sellerUserId: string) => {
  const year = new Date().getFullYear();
  const prefix = kind === 'quotation' ? 'Q' : 'INV';
  const key = `${prefix}-${sellerUserId}-${year}`;
  const db = await getDb();
  if (!db) {
    documentCounters[key] = (documentCounters[key] || 0) + 1;
    return `${prefix}-${year}-${String(documentCounters[key]).padStart(4, '0')}`;
  }
  const result = await db.collection('documentCounters').findOneAndUpdate(
    { id: key },
    { $inc: { seq: 1 }, $setOnInsert: { id: key, createdAt: new Date().toISOString() } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = Number((result as { seq?: number } | null)?.seq || 1);
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
};

const buildDocLines = (lines: Array<z.infer<typeof commerceDocLineSchema>>): CommerceDocLine[] =>
  lines.map((line, index) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    return {
      id: `line-${Date.now()}-${index}`,
      catalogItemId: line.catalogItemId || null,
      title: line.title.trim(),
      description: line.description || '',
      quantity,
      unitPrice,
      amount: Number((quantity * unitPrice).toFixed(2)),
    };
  });

const computeDocTotals = (
  lines: CommerceDocLine[],
  discountAmount = 0,
  taxAmount = 0,
) => {
  const subtotal = Number(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0).toFixed(2));
  const discount = Math.min(subtotal, Math.max(0, Number(discountAmount || 0)));
  const tax = Math.max(0, Number(taxAmount || 0));
  const totalAmount = Number((subtotal - discount + tax).toFixed(2));
  return { subtotal, discountAmount: discount, taxAmount: tax, totalAmount };
};

const expireQuotationsIfNeeded = async (docs: CommerceDocument[]) => {
  const now = Date.now();
  const updated: CommerceDocument[] = [];
  for (const doc of docs) {
    if (
      doc.kind === 'quotation'
      && doc.state === 'sent'
      && doc.expiresAt
      && new Date(doc.expiresAt).getTime() < now
    ) {
      const next: CommerceDocument = {
        ...doc,
        state: 'expired',
        updatedAt: new Date().toISOString(),
        history: [
          ...doc.history,
          { state: 'expired', at: new Date().toISOString(), byUserId: 'system', note: 'Expired automatically' },
        ],
      };
      await saveCommerceDocument(next);
      updated.push(next);
    } else {
      updated.push(doc);
    }
  }
  return updated;
};

const shareDocumentInChat = async (doc: CommerceDocument, byUserId: string, chatId?: string | null) => {
  const targetChatId = chatId || doc.chatId;
  if (!targetChatId) return { doc, message: null as Message | null };
  const chat = (await readChats()).find((entry) => entry.id === targetChatId);
  if (!chat) return { doc, message: null as Message | null };
  const label = doc.kind === 'quotation' ? 'Quotation' : 'Invoice';
  const message: Message = {
    id: `m${Date.now()}-doc`,
    chatId: chat.id,
    senderId: byUserId,
    clientRef: `doc-${doc.id}-v${doc.version}`,
    kind: 'text',
    text: `${label} ${doc.number}: ${doc.currency} ${doc.totalAmount.toFixed(2)} (${doc.state})`,
    mediaUrls: [],
    sentAt: new Date().toISOString(),
    state: 'sent',
    documentId: doc.id,
    documentKind: doc.kind,
  };
  await persistMessage(message);
  await emitMessageToChat(message, chat, null);
  const next: CommerceDocument = {
    ...doc,
    chatId: chat.id,
    messageId: message.id,
    updatedAt: new Date().toISOString(),
  };
  await saveCommerceDocument(next);
  return { doc: next, message };
};

const readBroadcastCampaigns = async () => {
  const db = await getDb();
  if (!db) return [...seedBroadcastCampaigns];
  return db
    .collection<BroadcastCampaign>('broadcastCampaigns')
    .find({}, { projection: { _id: 0 }, sort: { createdAt: -1 } })
    .toArray();
};

const saveBroadcastCampaign = async (campaign: BroadcastCampaign) => {
  const db = await getDb();
  if (!db) {
    const index = seedBroadcastCampaigns.findIndex((entry) => entry.id === campaign.id);
    if (index >= 0) seedBroadcastCampaigns[index] = campaign;
    else seedBroadcastCampaigns.unshift(campaign);
    return campaign;
  }
  await db.collection<BroadcastCampaign>('broadcastCampaigns').updateOne(
    { id: campaign.id },
    { $set: campaign },
    { upsert: true },
  );
  return campaign;
};

const resolveBroadcastAudience = async (
  sellerUserId: string,
  segment: BroadcastSegment,
  tag?: string | null,
) => {
  const customers = (await readBusinessCustomers()).filter(
    (entry) => entry.sellerUserId === sellerUserId && !entry.deletedAt && entry.customerUserId,
  );
  if (segment === 'opted_in') {
    return customers.filter((entry) => entry.marketingConsent === 'opted_in');
  }
  if (segment === 'repeat_buyers') {
    return customers.filter(
      (entry) => entry.marketingConsent === 'opted_in' && Number(entry.orderCount || 0) >= 2,
    );
  }
  if (segment === 'tag') {
    const needle = (tag || '').toLowerCase();
    return customers.filter(
      (entry) =>
        entry.marketingConsent === 'opted_in'
        && entry.tags.some((value) => value.toLowerCase() === needle),
    );
  }
  // all_customers still requires opt-in for marketing
  return customers.filter((entry) => entry.marketingConsent === 'opted_in');
};

const sendBroadcastCampaign = async (campaign: BroadcastCampaign) => {
  const audience = await resolveBroadcastAudience(
    campaign.sellerUserId,
    campaign.segment,
    campaign.tag,
  );
  let sentCount = 0;
  let failedCount = 0;
  const sending: BroadcastCampaign = {
    ...campaign,
    status: 'sending',
    audienceCount: audience.length,
    updatedAt: new Date().toISOString(),
  };
  await saveBroadcastCampaign(sending);

  for (const customer of audience) {
    try {
      const peerUserId = customer.customerUserId!;
      let chat = (await readChats()).find(
        (entry) =>
          entry.kind === 'direct'
          && entry.participants.includes(campaign.sellerUserId)
          && entry.participants.includes(peerUserId)
          && chatSpaceOf(entry) === 'personal',
      );
      if (!chat) {
        chat = {
          id: `c${Date.now()}-${peerUserId.slice(-4)}`,
          title: customer.displayName || 'Customer',
          kind: 'direct',
          participants: [campaign.sellerUserId, peerUserId],
          unreadCount: 0,
          unreadByUser: {},
          lastMessagePreview: '',
          updatedAt: new Date().toISOString(),
          space: 'personal',
        };
        await saveChatRecord(chat);
      }
      const message: Message = {
        id: `m${Date.now()}-bc-${sentCount}-${peerUserId.slice(-6)}`,
        chatId: chat.id,
        senderId: campaign.sellerUserId,
        clientRef: `broadcast-${campaign.id}-${peerUserId}`,
        kind: 'text',
        text: campaign.text,
        mediaUrls: [],
        sentAt: new Date().toISOString(),
        state: 'sent',
        broadcastCampaignId: campaign.id,
      };
      await persistMessage(message);
      await emitMessageToChat(message, chat, null);
      sentCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  const finished: BroadcastCampaign = {
    ...sending,
    status: sentCount ? 'sent' : 'failed',
    sentCount,
    failedCount,
    sentAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveBroadcastCampaign(finished);
  io.to(`user:${campaign.sellerUserId}`).emit('broadcast:updated', { campaign: finished });
  return finished;
};

const persistCall = async (call: Call) => {
  const db = await getDb();
  if (!db) {
    seedCalls.unshift(call);
    return call;
  }

  await seedDatabaseIfNeeded();
  await collectionsFor(db).calls.insertOne(call);
  return call;
};

const updateCall = async (
  callId: string,
  updater: (call: Call) => Call,
) => {
  const db = await getDb();
  if (!db) {
    const index = seedCalls.findIndex((item) => item.id === callId);
    if (index < 0) {
      return null;
    }

    seedCalls[index] = updater(seedCalls[index]);
    return seedCalls[index];
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const current = await collections.calls.findOne({ id: callId }, { projection: { _id: 0 } });
  if (!current) {
    return null;
  }

  const nextCall = updater(current);
  await collections.calls.replaceOne({ id: callId }, nextCall);
  return nextCall;
};

const updateProfile = async (userId: string, changes: Partial<Profile>) => {
  const db = await getDb();
  if (!db) {
    const nextProfile = seedProfiles.find((item) => item.id === userId) ?? { ...emptyProfile, id: userId };
    Object.assign(nextProfile, changes);
    const user = seedUsers.find((item) => item.id === userId);
    if (user) {
      user.name = nextProfile.name;
      user.avatar = nextProfile.avatar;
      user.about = nextProfile.about;
      user.phone = nextProfile.phone;
    }
    return { ...nextProfile };
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  await collections.profiles.updateOne({ id: userId }, { $set: changes });

  const nextProfile = await collections.profiles.findOne({ id: userId }, { projection: { _id: 0 } });
  if (!nextProfile) {
    throw new Error('Profile not found after update');
  }

  await collections.users.updateOne(
    { id: userId },
    {
      $set: {
        name: nextProfile.name,
        avatar: nextProfile.avatar,
        about: nextProfile.about,
        phone: nextProfile.phone,
      },
    },
  );

  return nextProfile;
};

const updatePresence = async (userId: string, presence: Presence) => {
  const lastSeenAt = new Date().toISOString();
  const db = await getDb();
  if (!db) {
    const user = seedUsers.find((item) => item.id === userId);
    if (!user) {
      return null;
    }
    user.presence = presence;
    if (presence === 'offline') {
      user.lastSeenAt = lastSeenAt;
    }
    return user;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  const changes: Partial<User> = { presence };
  if (presence === 'offline') {
    changes.lastSeenAt = lastSeenAt;
  }
  await collections.users.updateOne({ id: userId }, { $set: changes });
  return collections.users.findOne({ id: userId }, { projection: { _id: 0 } });
};

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'zynkup-backend',
    persistenceMode: getPersistenceMode(),
    mongodbConfigured: Boolean(mongoUri),
    dbName: DEFAULT_DB_NAME,
    mediaStorageMode: MEDIA_STORAGE_MODE,
    cloudMediaConfigured:
      MEDIA_STORAGE_MODE === 'gcs'
        ? isGcsConfigured()
        : MEDIA_STORAGE_MODE === 'cloudinary'
          ? isCloudinaryConfigured()
          : true,
    gcsBucket: GCS_BUCKET || null,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/bootstrap', async (req, res) => {
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId.trim() : '';
  const session = deviceId ? await readSessionByDeviceId(deviceId) : null;
  res.json(await buildBootstrapPayload(session));
});

app.post('/api/session/ensure', async (req, res) => {
  const parseResult = ensureSessionSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid session payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const session = await ensureSession(parseResult.data);
  return res.status(201).json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.get('/api/auth/google-config', (_req, res) => {
  res.json({
    provider: 'google-firebase-ready',
    ready: Boolean(
      FIREBASE_PROJECT_ID &&
      FIREBASE_WEB_API_KEY &&
      FIREBASE_APP_ID &&
      FIREBASE_AUTH_DOMAIN,
    ),
    config: {
      projectId: FIREBASE_PROJECT_ID,
      webApiKey: FIREBASE_WEB_API_KEY,
      appId: FIREBASE_APP_ID,
      authDomain: FIREBASE_AUTH_DOMAIN,
      storageBucket: FIREBASE_STORAGE_BUCKET,
      messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
    },
  });
});

app.post('/api/link/request', async (req, res) => {
  const parseResult = createLinkRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid link request payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const linkRequest: LinkRequest = {
    id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    token: crypto.randomBytes(12).toString('hex'),
    deviceId: parseResult.data.deviceId ?? crypto.randomUUID(),
    platform: parseResult.data.platform,
    label: parseResult.data.label,
    status: 'pending',
    userId: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LINK_REQUEST_TTL_MS).toISOString(),
    linkedAt: null,
  };

  await persistLinkRequest(linkRequest);
  return res.status(201).json({
    requestId: linkRequest.id,
    deviceId: linkRequest.deviceId,
    expiresAt: linkRequest.expiresAt,
    qrPayload: JSON.stringify({
      type: 'zynkup-link-device',
      requestId: linkRequest.id,
      token: linkRequest.token,
    }),
  });
});

app.get('/api/link/request/:requestId', async (req, res) => {
  const linkRequest = await readLinkRequest(req.params.requestId);
  if (!linkRequest) {
    return res.status(404).json({ error: 'Link request not found' });
  }

  if (
    new Date(linkRequest.expiresAt).getTime() < Date.now() &&
    ['pending', 'pin_required'].includes(linkRequest.status)
  ) {
    await updateLinkRequest(linkRequest.id, (current) => ({ ...current, status: 'expired' }));
    return res.json({ status: 'expired' });
  }

  if (linkRequest.status === 'linked') {
    const session = await readSessionByDeviceId(linkRequest.deviceId);
    return res.json({
      status: 'linked',
      session,
      bootstrap: await buildBootstrapPayload(session),
    });
  }

  return res.json({
    status: linkRequest.status,
    userId: linkRequest.userId ?? null,
  });
});

app.post('/api/link/confirm', async (req, res) => {
  const parseResult = confirmLinkRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid link confirmation payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const linkRequest = await readLinkRequest(parseResult.data.requestId);
  if (!linkRequest) {
    return res.status(404).json({ error: 'Link request not found' });
  }

  if (new Date(linkRequest.expiresAt).getTime() < Date.now()) {
    await updateLinkRequest(linkRequest.id, (current) => ({ ...current, status: 'expired' }));
    return res.status(410).json({ error: 'Link request expired' });
  }

  if (linkRequest.token !== parseResult.data.token) {
    return res.status(401).json({ error: 'Invalid link token' });
  }

  if (linkRequest.status === 'linked') {
    const session = await readSessionByDeviceId(linkRequest.deviceId);
    return res.json({
      status: 'linked',
      session,
      bootstrap: await buildBootstrapPayload(session),
    });
  }

  if (linkRequest.status === 'pin_required' && linkRequest.userId === parseResult.data.userId) {
    return res.json({ status: 'pin_required' });
  }

  if (linkRequest.status !== 'pending') {
    return res.status(409).json({ error: 'This desktop link request is no longer available.' });
  }

  const userProfile = await readProfile(parseResult.data.userId);
  if (!(await canOpenAnotherSession(parseResult.data.userId, linkRequest.deviceId))) {
    return res.status(409).json({
      error: '4 of 4 web devices are already linked. Log out of one on your phone to free a slot.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_LINKED_DEVICES,
      remaining: 0,
    });
  }

  if (userProfile?.appLockEnabled && userProfile.pinHash) {
    await updateLinkRequest(linkRequest.id, (current) => ({
      ...current,
      status: 'pin_required',
      userId: parseResult.data.userId,
    }));
    return res.json({ status: 'pin_required' });
  }

  const session = await ensureSession({
    deviceId: linkRequest.deviceId,
    preferredUserId: parseResult.data.userId,
    platform: linkRequest.platform,
    label: linkRequest.label,
  });
  await updateLinkRequest(linkRequest.id, (current) => ({
    ...current,
    status: 'linked',
    userId: parseResult.data.userId,
    linkedAt: new Date().toISOString(),
  }));

  return res.json({
    status: 'linked',
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/link/verify-pin', async (req, res) => {
  const parseResult = verifyLinkedDevicePinSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid device pin payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const linkRequest = await readLinkRequest(parseResult.data.requestId);
  if (!linkRequest?.userId) {
    return res.status(404).json({ error: 'Link request not found' });
  }

  if (new Date(linkRequest.expiresAt).getTime() < Date.now()) {
    await updateLinkRequest(linkRequest.id, (current) => ({ ...current, status: 'expired' }));
    return res.status(410).json({ error: 'Link request expired' });
  }

  if (linkRequest.token !== parseResult.data.token) {
    return res.status(401).json({ error: 'Invalid link token' });
  }

  if (linkRequest.status !== 'pin_required' && linkRequest.status !== 'linked') {
    return res.status(409).json({ error: 'Desktop pin is not required for this link request.' });
  }

  if (linkRequest.status === 'linked') {
    const session = await readSessionByDeviceId(linkRequest.deviceId);
    return res.json({
      status: 'linked',
      session,
      bootstrap: await buildBootstrapPayload(session),
    });
  }

  const profile = await readProfile(linkRequest.userId);
  if (!profile?.pinHash || profile.pinHash !== hashPin(parseResult.data.pin)) {
    return res.status(401).json({ error: 'Incorrect pin' });
  }

  if (!(await canOpenAnotherSession(linkRequest.userId, linkRequest.deviceId))) {
    return res.status(409).json({
      error: '4 of 4 web devices are already linked. Log out of one on your phone to free a slot.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_LINKED_DEVICES,
      remaining: 0,
    });
  }

  const session = await ensureSession({
    deviceId: linkRequest.deviceId,
    preferredUserId: linkRequest.userId,
    platform: linkRequest.platform,
    label: linkRequest.label,
  });
  await updateLinkRequest(linkRequest.id, (current) => ({
    ...current,
    status: 'linked',
    linkedAt: new Date().toISOString(),
  }));

  return res.json({
    status: 'linked',
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/phone/lookup', async (req, res) => {
  const parseResult = phoneLookupSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid phone lookup payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const phone = normalizePhone(parseResult.data.countryCode, parseResult.data.phoneNumber);
  if (await rejectIfBlocked(res, phone)) return;
  const user = await readUserByPhone(phone);
  if (!user) {
    return res.json({
      registered: false,
      hasPin: false,
      phone,
    });
  }

  const profile = await readProfile(user.id);
  const knownDevice = Boolean(
    parseResult.data.deviceId
    && (await readSessionsByUserId(user.id)).some((session) => session.deviceId === parseResult.data.deviceId),
  );
  return res.json({
    registered: true,
    hasPin: Boolean(profile?.pinHash),
    otpRequired: Boolean(profile?.pinHash) && !knownDevice,
    phone: user.phone,
    name: user.name,
  });
});

app.post('/api/auth/phone/start', async (req, res) => {
  const parseResult = startPhoneAuthSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid phone auth payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const phone = normalizePhone(parseResult.data.countryCode, parseResult.data.phoneNumber);
  if (await rejectIfBlocked(res, phone)) return;
  const challenge = await createOtpChallenge(parseResult.data.countryCode, parseResult.data.phoneNumber);
  return res.status(201).json({
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    provider: challenge.provider,
    otpHint: process.env.NODE_ENV === 'production' ? undefined : challenge.code,
  });
});

app.post('/api/auth/phone/verify', async (req, res) => {
  const parseResult = verifyOtpSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid OTP verification payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const challenge = await readOtpChallenge(parseResult.data.challengeId);
  if (!challenge) {
    return res.status(404).json({ error: 'OTP challenge not found' });
  }

  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: 'OTP challenge expired' });
  }

  if (challenge.code !== parseResult.data.code.trim()) {
    return res.status(401).json({ error: 'Incorrect OTP code' });
  }

  const verifiedChallenge = await updateOtpChallenge(challenge.id, (current) => ({
    ...current,
    verifiedAt: new Date().toISOString(),
  }));
  if (!verifiedChallenge) {
    return res.status(500).json({ error: 'Unable to verify OTP challenge' });
  }

  const existingUser = await readUserByPhone(verifiedChallenge.normalizedPhone);
  if (existingUser) {
    if (parseResult.data.forcePinReset) {
      return res.json({
        verified: true,
        registrationRequired: false,
        pinResetRequired: true,
        challengeId: verifiedChallenge.id,
        phone: verifiedChallenge.normalizedPhone,
        countryCode: verifiedChallenge.countryCode,
      });
    }

    const existingProfile = await readProfile(existingUser.id);
    if (existingProfile?.pinHash) {
      // Registered users with a PIN must sign in with PIN (OTP only for forgot-PIN).
      return res.json({
        verified: true,
        registrationRequired: false,
        pinLoginRequired: true,
        challengeId: verifiedChallenge.id,
        phone: verifiedChallenge.normalizedPhone,
        countryCode: verifiedChallenge.countryCode,
        name: existingUser.name,
      });
    }

    // Account exists but has no PIN yet — open session and let client set one.
    const session = await ensureSession({
      deviceId: parseResult.data.deviceId,
      preferredUserId: existingUser.id,
      platform: parseResult.data.platform,
      label: parseResult.data.label,
    });
    return res.json({
      verified: true,
      registrationRequired: false,
      pinSetupRequired: true,
      challengeId: verifiedChallenge.id,
      session,
      bootstrap: await buildBootstrapPayload(session),
    });
  }

  return res.json({
    verified: true,
    registrationRequired: true,
    challengeId: verifiedChallenge.id,
    phone: verifiedChallenge.phone,
    countryCode: verifiedChallenge.countryCode,
  });
});

app.post('/api/auth/pin/reset', async (req, res) => {
  const parseResult = resetPinSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid pin reset payload',
      details: z.flattenError(parseResult.error),
    });
  }

  let verifiedPhone = '';
  if (parseResult.data.idToken) {
    try {
      const identity = await verifyFirebasePhoneIdentity(parseResult.data.idToken);
      verifiedPhone = identity.phoneNumber;
    } catch (error) {
      return res.status(401).json({
        error: error instanceof Error ? error.message : 'Phone number has not been verified yet',
      });
    }
  } else if (parseResult.data.challengeId) {
    const challenge = await readOtpChallenge(parseResult.data.challengeId);
    if (!challenge?.verifiedAt) {
      return res.status(401).json({ error: 'Phone number has not been verified yet' });
    }
    verifiedPhone = challenge.normalizedPhone;
  } else {
    return res.status(400).json({ error: 'Phone number has not been verified yet' });
  }

  const user = await readUserByPhone(verifiedPhone);
  if (!user) {
    return res.status(404).json({ error: 'No account found for that phone number' });
  }

  await updateProfile(user.id, {
    pinHash: hashPin(parseResult.data.pin),
    appLockEnabled: true,
  });

  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: user.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });

  return res.json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/phone/session', async (req, res) => {
  const parseResult = phoneSessionSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid Firebase phone session payload',
      details: z.flattenError(parseResult.error),
    });
  }

  let verifiedIdentity: { uid: string; phoneNumber: string };
  try {
    verifiedIdentity = await verifyFirebasePhoneIdentity(parseResult.data.idToken, parseResult.data.phone);
  } catch (error) {
    return res.status(401).json({
      error: error instanceof Error ? error.message : 'Firebase phone verification failed',
    });
  }

  const existingUser = await readUserByPhone(verifiedIdentity.phoneNumber);
  if (!existingUser) {
    return res.json({
      verified: true,
      registrationRequired: true,
      phone: verifiedIdentity.phoneNumber,
    });
  }

  if (parseResult.data.forcePinReset) {
    return res.json({
      verified: true,
      registrationRequired: false,
      pinResetRequired: true,
      phone: verifiedIdentity.phoneNumber,
    });
  }

  const existingProfile = await readProfile(existingUser.id);
  if (existingProfile?.pinHash) {
    return res.json({
      verified: true,
      registrationRequired: false,
      pinLoginRequired: true,
      phone: verifiedIdentity.phoneNumber,
      name: existingUser.name,
    });
  }

  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: existingUser.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });

  return res.json({
    verified: true,
    registrationRequired: false,
    pinSetupRequired: true,
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/phone/complete', async (req, res) => {
  const parseResult = completeRegistrationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid registration completion payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const challenge = await readOtpChallenge(parseResult.data.challengeId);
  if (!challenge?.verifiedAt) {
    return res.status(401).json({ error: 'Phone number has not been verified yet' });
  }

  const normalizedPhone = normalizePhone(parseResult.data.countryCode, parseResult.data.phoneNumber);
  if (challenge.normalizedPhone !== normalizedPhone) {
    return res.status(400).json({ error: 'Phone verification does not match the registration number' });
  }

  const existing = await readUserByPhone(normalizedPhone);
  if (existing) {
    return res.status(409).json({ error: 'A user with that phone already exists' });
  }

  let user;
  try {
    ({ user } = await createAuthIdentity(
      parseResult.data.name,
      parseResult.data.countryCode,
      parseResult.data.phoneNumber,
      parseResult.data.pin,
    ));
  } catch (error) {
    const statusCode = error instanceof Error ? (error as Error & { statusCode?: number }).statusCode : 0;
    if (statusCode === 503) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'MongoDB is not connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
    throw error;
  }
  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: user.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });

  return res.status(201).json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/phone/register', async (req, res) => {
  const parseResult = phoneRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid Firebase registration payload',
      details: z.flattenError(parseResult.error),
    });
  }

  let verifiedIdentity: { uid: string; phoneNumber: string };
  try {
    verifiedIdentity = await verifyFirebasePhoneIdentity(parseResult.data.idToken, parseResult.data.phone);
  } catch (error) {
    return res.status(401).json({
      error: error instanceof Error ? error.message : 'Firebase phone verification failed',
    });
  }

  if (await rejectIfBlocked(res, verifiedIdentity.phoneNumber)) return;
  const existing = await readUserByPhone(verifiedIdentity.phoneNumber);
  if (existing) {
    return res.status(409).json({ error: 'A user with that phone already exists' });
  }

  let user;
  try {
    ({ user } = await createAuthIdentity(
      parseResult.data.name,
      parseResult.data.countryCode,
      verifiedIdentity.phoneNumber,
      parseResult.data.pin,
    ));
  } catch (error) {
    const statusCode = error instanceof Error ? (error as Error & { statusCode?: number }).statusCode : 0;
    if (statusCode === 503) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'MongoDB is not connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
    throw error;
  }
  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: user.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });

  return res.status(201).json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/login', async (req, res) => {
  const parseResult = authLoginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid login payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const phone = parseResult.data.countryCode && parseResult.data.phoneNumber
    ? normalizePhone(parseResult.data.countryCode, parseResult.data.phoneNumber)
    : sanitizePhone(parseResult.data.phone);
  if (await rejectIfBlocked(res, phone)) return;
  const user = await readUserByPhone(phone);
  if (!user) {
    return res.status(404).json({ error: 'No account found for that phone number' });
  }

  const profile = await readProfile(user.id);
  if (!profile?.pinHash) {
    return res.status(409).json({
      error: 'This account has no PIN yet. Verify with OTP to set one.',
      code: 'PIN_REQUIRED',
    });
  }
  const knownDevice = Boolean(
    parseResult.data.deviceId
    && (await readSessionsByUserId(user.id)).some((session) => session.deviceId === parseResult.data.deviceId),
  );
  if (!knownDevice) {
    let proved = false;
    if (parseResult.data.challengeId) {
      const challenge = await readOtpChallenge(parseResult.data.challengeId);
      proved = Boolean(
        challenge?.verifiedAt
        && challenge.normalizedPhone.replace(/\D/g, '') === phone.replace(/\D/g, ''),
      );
    }
    if (!proved && parseResult.data.idToken) {
      try {
        const identity = await verifyFirebasePhoneIdentity(parseResult.data.idToken, phone);
        proved = identity.phoneNumber.replace(/\D/g, '') === phone.replace(/\D/g, '');
      } catch {
        proved = false;
      }
    }
    if (!proved) {
      return res.status(403).json({
        error: 'This install is new. Confirm the SMS code for this number, then enter your PIN.',
        code: 'OTP_REQUIRED',
      });
    }
  }
  if (profile.pinHash !== hashPin(parseResult.data.pin)) {
    return res.status(401).json({ error: 'Incorrect PIN' });
  }

  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: user.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });
  return res.json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/register', async (req, res) => {
  const parseResult = authRegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid register payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const existing = await readUserByPhone(parseResult.data.phone);
  if (existing) {
    return res.status(409).json({ error: 'A user with that phone already exists' });
  }

  let user;
  try {
    ({ user } = await createAuthIdentity(parseResult.data.name, '', parseResult.data.phone));
  } catch (error) {
    const statusCode = error instanceof Error ? (error as Error & { statusCode?: number }).statusCode : 0;
    if (statusCode === 503) {
      return res.status(503).json({
        error: error instanceof Error ? error.message : 'MongoDB is not connected.',
        code: 'DATABASE_UNAVAILABLE',
      });
    }
    throw error;
  }
  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: user.id,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });

  return res.status(201).json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.post('/api/auth/switch', async (req, res) => {
  const parseResult = authSwitchSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid switch payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const users = await readUsers();
  if (!users.some((user) => user.id === parseResult.data.userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  const session = await ensureSession({
    deviceId: parseResult.data.deviceId,
    preferredUserId: parseResult.data.userId,
    platform: parseResult.data.platform,
    label: parseResult.data.label,
  });
  return res.json({
    session,
    bootstrap: await buildBootstrapPayload(session),
  });
});

app.get('/api/contacts', async (req, res) => {
  const registeredOnly = req.query.registered === 'true';
  const ownerUserId = await resolveRequestUserId(req);
  const contactList = ownerUserId ? await readContacts(ownerUserId) : [];

  res.json({
    contacts: registeredOnly ? contactList.filter((contact) => contact.registered) : contactList,
  });
});

app.post('/api/contacts/sync', async (req, res) => {
  const parseResult = syncContactsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid contacts sync payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const usableContacts = parseResult.data.contacts
    .map((contact) => ({
      name: (contact.name || 'Unknown').trim().slice(0, 80) || 'Unknown',
      phone: contact.phone.replace(/[^\d+]/g, '').slice(0, 20),
    }))
    .filter((contact) => contact.phone.replace(/\D/g, '').length >= 8);
  const syncedContacts = await syncDeviceContacts(parseResult.data.userId, usableContacts);
  return res.status(201).json({
    contacts: syncedContacts.filter((contact) => contact.registered),
  });
});

app.post('/api/directory/lookup', async (req, res) => {
  const phone = sanitizePhone(String(req.body?.phone || ''));
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) {
    return res.status(400).json({ error: 'Enter a full phone number.' });
  }
  const users = await readUsers();
  const profiles = await readProfiles();
  const user = users.find((item) => phonesMatch(item.phone, phone));
  if (!user) {
    return res.json({ registered: false, phone });
  }
  const profile = profiles.find((item) => item.id === user.id);
  return res.json({
    registered: true,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      username: profile?.username || '',
      avatar: user.avatar,
      photoUri: profile?.photoUri || '',
    },
  });
});

app.post('/api/contacts/save', async (req, res) => {
  const ownerUserId = String(req.body?.ownerUserId || '');
  const linkedUserId = String(req.body?.linkedUserId || '');
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  if (!ownerUserId || !linkedUserId || !name) {
    return res.status(400).json({ error: 'Missing contact details.' });
  }
  const contact: Contact = {
    id: `contact-${ownerUserId}-${linkedUserId}`,
    ownerUserId,
    name,
    phone,
    normalizedPhone: sanitizePhone(phone),
    linkedUserId,
    registered: true,
    presence: 'offline',
  };
  const db = await getDb();
  if (!db) {
    const index = seedContacts.findIndex((item) => item.id === contact.id);
    if (index >= 0) seedContacts[index] = contact;
    else seedContacts.unshift(contact);
  } else {
    await collectionsFor(db).contacts.updateOne({ id: contact.id }, { $set: contact }, { upsert: true });
  }
  return res.status(201).json({ contact });
});

app.post('/api/devices/push', async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').trim();
  const token = String(req.body?.token || '').trim();
  if (!deviceId || !token) {
    return res.status(400).json({ error: 'Missing device push token.' });
  }
  const db = await getDb();
  if (!db) {
    const session = seedSessions.find((item) => item.deviceId === deviceId);
    if (session) session.pushToken = token;
    return res.json({ ok: Boolean(session) });
  }
  const result = await collectionsFor(db).sessions.updateOne({ deviceId }, { $set: { pushToken: token } });
  return res.json({ ok: result.matchedCount > 0 });
});

app.get('/api/devices', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const devices = (await readSessionsByUserId(userId)).filter(isLinkedSession);
  return res.json({
    devices: devices.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)),
    linkedCount: devices.length,
    limit: MAX_LINKED_DEVICES,
    remaining: Math.max(0, MAX_LINKED_DEVICES - devices.length),
  });
});

app.delete('/api/devices/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId;
  const db = await getDb();
  if (!db) {
    const index = seedSessions.findIndex((session) => session.deviceId === deviceId);
    if (index < 0) {
      return res.status(404).json({ error: 'Device session not found' });
    }
    const [deleted] = seedSessions.splice(index, 1);
    return res.json({ device: deleted });
  }

  await seedDatabaseIfNeeded();
  const collection = collectionsFor(db).sessions;
  const current = await collection.findOne({ deviceId }, { projection: { _id: 0 } });
  if (!current) {
    return res.status(404).json({ error: 'Device session not found' });
  }

  await collection.deleteOne({ deviceId });
  return res.json({ device: current });
});

app.get('/api/calls', async (_req, res) => {
  res.json({ calls: await readCalls() });
});

app.get('/api/statuses', async (_req, res) => {
  const [statuses, users] = await Promise.all([readStatuses(), readUsers()]);
  res.json({ statuses, updatesFeed: buildUpdateFeed(users, statuses) });
});

app.post('/api/uploads', upload.array('files', 10), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  const uploadedFiles = await Promise.all(
    files.map(async (file) => {
      if (MEDIA_STORAGE_MODE === 'gcs' && isGcsConfigured()) {
        return uploadFileToGcs(file);
      }

      if (MEDIA_STORAGE_MODE === 'cloudinary' && isCloudinaryConfigured()) {
        return uploadFileToCloudinary(file);
      }

      return {
        url: buildAbsoluteUrl(req, `${STATIC_UPLOAD_PREFIX}/${file.filename}`),
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      };
    }),
  );

  return res.status(201).json({ files: uploadedFiles });
});

app.post('/api/statuses', async (req, res) => {
  const parseResult = createStatusSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid status payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const createdAt = new Date().toISOString();
  if (parseResult.data.catalogItemId) {
    const tagged = (await readCatalogItems()).find((item) => item.id === parseResult.data.catalogItemId);
    if (!tagged || tagged.takenDown || (tagged.status || 'active') === 'archived') {
      return res.status(400).json({ error: 'Tag a live product from your catalogue.' });
    }
    const ownsProduct = tagged.sellerId === parseResult.data.userId;
    const business = tagged.businessId
      ? (await readBusinesses()).find((item) => item.id === tagged.businessId)
      : null;
    const staffOfBusiness = business ? Boolean(businessRoleFor(business, parseResult.data.userId)) : false;
    if (!ownsProduct && !staffOfBusiness) {
      return res.status(403).json({ error: 'You can only tag products from your own catalogue.' });
    }
  }
  if (parseResult.data.audience === 'marketplace' && parseResult.data.catalogItemId) {
    const existingStatuses = await readStatuses();
    const alreadyPosted = existingStatuses.find((status) =>
      status.userId === parseResult.data.userId
      && status.catalogItemId === parseResult.data.catalogItemId
      && status.audience === 'marketplace',
    );
    if (alreadyPosted) {
      const items = await readCatalogItems();
      const existingItem = items.find((item) => item.id === parseResult.data.catalogItemId);
      let revived = existingItem;
      if (existingItem) {
        revived = {
          ...existingItem,
          takenDown: false,
          isPublic: true,
          createdAt: createdAt,
          updatedAt: createdAt,
        };
        const db = await getDb();
        if (!db) {
          const index = seedCatalogItems.findIndex((item) => item.id === revived?.id);
          if (index >= 0 && revived) seedCatalogItems[index] = revived;
        } else if (revived) {
          await collectionsFor(db).catalogItems.updateOne({ id: revived.id }, { $set: revived });
        }
        io.emit('catalog:itemUpdated', revived);
      }
      return res.status(200).json({ status: alreadyPosted, duplicate: true, item: revived });
    }
  }
  const status: StatusPost = {
    id: `s${Date.now()}`,
    userId: parseResult.data.userId,
    text: parseResult.data.text,
    assets: parseResult.data.assets.map((asset, index) => ({
      id: `sa${Date.now()}-${index}`,
      kind: asset.kind,
      url: asset.url,
      caption: asset.caption,
    })),
    backgroundColor: parseResult.data.backgroundColor,
    fontFamily: parseResult.data.fontFamily,
    fontSize: parseResult.data.fontSize,
    catalogItemId: parseResult.data.catalogItemId,
    reactions: [],
    comments: [],
    views: [],
    createdAt,
    expiresAt: parseResult.data.audience === 'marketplace'
      ? new Date('2099-01-01T00:00:00.000Z').toISOString()
      : new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    audience: parseResult.data.audience,
    businessId: parseResult.data.businessId,
    businessName: undefined as string | undefined,
  };
  if (status.businessId) {
    const business = (await readBusinesses()).find((item) => item.id === status.businessId);
    if (!business || !businessRoleFor(business, status.userId)) {
      return res.status(403).json({ error: 'You cannot post as that business.' });
    }
    status.businessName = business.name;
  }

  await persistStatus(status);
  const [users, statuses] = await Promise.all([readUsers(), readStatuses()]);
  io.emit('status:new', status);
  io.emit('updates:refresh', buildUpdateFeed(users, statuses));

  return res.status(201).json({ status });
});

app.post('/api/statuses/:statusId/view', async (req, res) => {
  const parseResult = markStatusViewSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid view payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const fallbackUserId = await resolveRequestUserId(req);
  const status = await addStatusView(req.params.statusId, parseResult.data.userId ?? fallbackUserId);
  if (!status) {
    return res.status(404).json({ error: 'Status not found' });
  }

  io.emit('status:updated', status);
  return res.json({ status });
});

app.post('/api/statuses/:statusId/reactions', async (req, res) => {
  const parseResult = reactToStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid reaction payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const fallbackUserId = await resolveRequestUserId(req);
  const status = await addStatusReaction(req.params.statusId, parseResult.data.userId ?? fallbackUserId, parseResult.data.emoji);
  if (!status) {
    return res.status(404).json({ error: 'Status not found' });
  }

  io.emit('status:updated', status);
  return res.json({ status });
});

app.post('/api/statuses/:statusId/comments', async (req, res) => {
  const parseResult = commentOnStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid comment payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const fallbackUserId = await resolveRequestUserId(req);
  const status = await addStatusComment(req.params.statusId, parseResult.data.userId ?? fallbackUserId, parseResult.data.text);
  if (!status) {
    return res.status(404).json({ error: 'Status not found' });
  }

  io.emit('status:updated', status);
  return res.json({ status });
});

app.patch('/api/statuses/:statusId/comments/:commentId', async (req, res) => {
  const parseResult = updateStatusCommentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid comment update payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const fallbackUserId = await resolveRequestUserId(req);
  const status = await updateStatusComment(
    req.params.statusId,
    req.params.commentId,
    parseResult.data.userId ?? fallbackUserId,
    parseResult.data.text,
  );
  if (!status) {
    return res.status(404).json({ error: 'Status not found' });
  }

  io.emit('status:updated', status);
  return res.json({ status });
});

app.delete('/api/statuses/:statusId/comments/:commentId', async (req, res) => {
  const userId = await resolveRequestUserId(req);
  const status = await deleteStatusComment(req.params.statusId, req.params.commentId, userId);
  if (!status) {
    return res.status(404).json({ error: 'Status not found' });
  }

  io.emit('status:updated', status);
  return res.json({ status });
});

app.get('/api/statuses/:statusId/viewers', async (req, res) => {
  const viewers = await readStatusViewers(req.params.statusId);
  if (!viewers) {
    return res.status(404).json({ error: 'Status not found' });
  }

  return res.json({ viewers });
});

app.get('/api/statuses/:statusId/reactors', async (req, res) => {
  const reactors = await readStatusReactors(req.params.statusId);
  if (!reactors) {
    return res.status(404).json({ error: 'Status not found' });
  }

  return res.json({ reactors });
});

app.delete('/api/statuses/:statusId', async (req, res) => {
  const userId = await resolveRequestUserId(req);
  const deletedStatus = await deleteStatusById(req.params.statusId, userId);

  if (!deletedStatus) {
    return res.status(404).json({ error: 'Status not found or not owned by user' });
  }

  const [users, statuses] = await Promise.all([readUsers(), readStatuses()]);
  io.emit('status:deleted', { statusId: deletedStatus.id, userId });
  io.emit('updates:refresh', buildUpdateFeed(users, statuses));

  return res.json({ deleted: true, statusId: deletedStatus.id });
});

app.get('/api/catalog', async (req, res) => {
  const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId : '';
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const publicOnly = req.query.public === '1' || req.query.public === 'true';
  let items = await readCatalogItems();
  if (sellerId) items = items.filter((item) => item.sellerId === sellerId);
  if (businessId) items = items.filter((item) => item.businessId === businessId || (!item.businessId && item.sellerId));
  if (status) items = items.filter((item) => (item.status || 'active') === status);
  if (publicOnly) {
    items = items.filter(
      (item) => item.isPublic
        && !item.takenDown
        && (item.status || 'active') !== 'archived'
        && (item.status || 'active') !== 'draft',
    );
  }
  if (q) {
    items = items.filter((item) => {
      const haystack = `${item.title} ${item.description} ${item.category} ${item.location || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }
  return res.json({ catalogItems: items });
});

app.get('/api/catalog/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId : '';
  const category = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
  const items = (await readCatalogItems()).filter((item) => {
    if (item.takenDown) return false;
    if ((item.status || 'active') === 'archived' || (item.status || 'active') === 'draft') return false;
    if (!item.isPublic) return false;
    if (sellerId && item.sellerId !== sellerId) return false;
    if (category && category !== 'all' && item.category.toLowerCase() !== category) return false;
    if (!q) return true;
    const haystack = `${item.title} ${item.description} ${item.category} ${(item.variants || [])
      .map((variant) => `${variant.name} ${variant.options.join(' ')}`)
      .join(' ')}`.toLowerCase();
    return haystack.includes(q);
  });
  return res.json({ catalogItems: items, count: items.length });
});

app.get('/api/catalog/:itemId', async (req, res) => {
  const item = (await readCatalogItems()).find((entry) => entry.id === req.params.itemId);
  if (!item || item.takenDown) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const seller = (await readUsers()).find((user) => user.id === item.sellerId);
  const sellerProfile = await readProfile(item.sellerId);
  const business = item.businessId
    ? (await readBusinesses()).find((entry) => entry.id === item.businessId)
    : (await readBusinesses()).find(
      (entry) => entry.ownerUserId === item.sellerId && (entry.visibility || 'draft') === 'published',
    );
  return res.json({
    item: {
      ...item,
      purchasable: catalogIsPurchasable(item),
    },
    seller: {
      id: item.sellerId,
      name: seller?.name || sellerProfile?.name || 'Seller',
      phone: sellerProfile?.phone || seller?.phone || '',
      businessId: business?.id || null,
      businessName: business?.name || sellerProfile?.businessName || '',
      verified: (business?.verificationStatus || 'unverified') === 'approved',
    },
  });
});

app.post('/api/orders', async (req, res) => {
  const parseResult = createOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose a product and quantity.' });
  }
  if (parseResult.data.clientRequestId) {
    const existing = (await readOrders()).find(
      (order) =>
        order.clientRequestId === parseResult.data.clientRequestId
        && order.buyerUserId === parseResult.data.buyerUserId,
    );
    if (existing) {
      return res.status(200).json({ order: existing, duplicate: true });
    }
  }
  const item = (await readCatalogItems()).find((entry) => entry.id === parseResult.data.catalogItemId);
  if (!item) {
    return res.status(404).json({ error: 'Product not found' });
  }
  if (!catalogIsPurchasable(item)) {
    return res.status(409).json({ error: 'This product is not available to buy right now.' });
  }
  if (item.sellerId === parseResult.data.buyerUserId) {
    return res.status(400).json({ error: 'You cannot order your own product.' });
  }
  const quantity = parseResult.data.quantity;
  if (item.trackStock !== false && availableStock(item) < quantity) {
    return res.status(409).json({ error: `Only ${availableStock(item)} left in stock.` });
  }
  const selections = parseResult.data.variantSelections || [];
  for (const selection of selections) {
    const variant = (item.variants || []).find((entry) => entry.name === selection.name);
    if (!variant || !variant.options.includes(selection.option)) {
      return res.status(400).json({ error: `Choose a valid ${selection.name} option.` });
    }
  }
  const now = new Date().toISOString();
  const order: CommerceOrder = {
    id: `ord${Date.now()}`,
    buyerUserId: parseResult.data.buyerUserId,
    sellerUserId: item.sellerId,
    businessId: item.businessId || null,
    statusId: parseResult.data.statusId || null,
    chatId: parseResult.data.chatId || null,
    paymentId: null,
    clientRequestId: parseResult.data.clientRequestId || null,
    items: [{
      catalogItemId: item.id,
      title: item.title,
      price: item.price,
      currency: item.currency,
      quantity,
      variantSelections: selections,
      imageUrl: item.imageUrls?.[0] || '',
    }],
    totalAmount: Number((item.price * quantity).toFixed(2)),
    currency: item.currency,
    state: 'pending_payment',
    history: [{ state: 'pending_payment', at: now, byUserId: parseResult.data.buyerUserId, note: 'Order created from product' }],
    createdAt: now,
    updatedAt: now,
  };
  await saveOrder(order);
  void ensureCustomerFromOrder(order);
  io.to(`user:${order.sellerUserId}`).emit('order:created', { order });
  io.to(`user:${order.buyerUserId}`).emit('order:created', { order });
  void recordAdminEvent(getDb, {
    level: 'info',
    area: 'orders',
    message: 'Order created',
    detail: `${order.id} ${item.title} ${order.totalAmount} ${order.currency}`,
  });
  return res.status(201).json({ order, item });
});

app.get('/api/orders', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const role = typeof req.query.role === 'string' ? req.query.role : 'all';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  let orders = (await readOrders()).filter(
    (order) => order.buyerUserId === userId || order.sellerUserId === userId,
  );
  if (role === 'buyer') orders = orders.filter((order) => order.buyerUserId === userId);
  if (role === 'seller') orders = orders.filter((order) => order.sellerUserId === userId);
  if (state) orders = orders.filter((order) => order.state === state);
  return res.json({ orders });
});

app.get('/api/orders/:orderId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const order = (await readOrders()).find((entry) => entry.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (userId && order.buyerUserId !== userId && order.sellerUserId !== userId) {
    return res.status(403).json({ error: 'You cannot view this order.' });
  }
  return res.json({ order });
});

app.patch('/api/orders/:orderId', async (req, res) => {
  const parseResult = updateOrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid order update.' });
  }
  const order = (await readOrders()).find((entry) => entry.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const nextState = parseResult.data.state;
  const denyReason = canTransitionOrder(order, nextState, parseResult.data.userId);
  if (denyReason) {
    return res.status(400).json({ error: denyReason });
  }
  const now = new Date().toISOString();
  const fulfilmentNote = parseResult.data.fulfilmentNote ?? order.fulfilmentNote ?? null;
  const deliveryReference = parseResult.data.deliveryReference === undefined
    ? order.deliveryReference ?? null
    : parseResult.data.deliveryReference;
  const historyNote = [
    parseResult.data.note || '',
    deliveryReference && nextState === 'dispatched' ? `Ref ${deliveryReference}` : '',
  ].filter(Boolean).join(' · ');
  const updated: CommerceOrder = {
    ...order,
    state: nextState,
    deliveryReference,
    fulfilmentNote,
    updatedAt: now,
    history: [
      ...order.history,
      { state: nextState, at: now, byUserId: parseResult.data.userId, note: historyNote },
    ],
  };
  let finalOrder = updated;
  let issuedReceipt: SaleReceipt | null = null;
  if (nextState === 'paid' && order.state === 'pending_payment') {
    const catalogItem = (await readCatalogItems()).find((entry) => entry.id === order.items[0]?.catalogItemId);
    if (catalogItem && catalogItem.trackStock !== false) {
      const qty = order.items[0]?.quantity || 1;
      const alreadySold = (await (async () => {
        const db = await getDb();
        if (!db) {
          return seedInventoryMovements.some(
            (movement) => movement.orderId === order.id && movement.kind === 'sale',
          );
        }
        const existing = await db.collection('inventoryMovements').findOne({ orderId: order.id, kind: 'sale' });
        return Boolean(existing);
      })());
      if (!alreadySold) {
        if (availableStock(catalogItem) < qty) {
          return res.status(409).json({ error: `Only ${availableStock(catalogItem)} left in stock.` });
        }
        try {
          await applyInventoryChange({
            item: catalogItem,
            delta: -qty,
            kind: 'sale',
            reason: `Sale for order ${order.id}`,
            byUserId: parseResult.data.userId,
            orderId: order.id,
          });
        } catch (error) {
          return res.status(409).json({ error: error instanceof Error ? error.message : 'Stock update failed.' });
        }
      }
    }
    const receiptResult = await issueSaleReceiptForOrder(
      updated,
      order.paymentId ? 'provider' : 'seller_confirmed',
    );
    finalOrder = { ...receiptResult.order, state: 'paid', history: updated.history };
    issuedReceipt = receiptResult.receipt;
    await saveOrder(finalOrder);
  } else if (nextState === 'refunded' && order.receiptId) {
    const original = (await readSaleReceipts()).find((item) => item.id === order.receiptId);
    if (original && original.state === 'issued') {
      const refundReceipt: SaleReceipt = {
        ...original,
        id: `rcpt${Date.now()}`,
        receiptNumber: `${original.receiptNumber}-RF`,
        state: 'refunded',
        linkedReceiptId: original.id,
        paymentReference: `refund:${original.paymentReference}`,
        issuedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await saveSaleReceipt({ ...original, state: 'voided', updatedAt: now, linkedReceiptId: refundReceipt.id });
      await saveSaleReceipt(refundReceipt);
      io.to(`user:${order.sellerUserId}`).emit('receipt:created', { receipt: refundReceipt });
      io.to(`user:${order.buyerUserId}`).emit('receipt:created', { receipt: refundReceipt });
    }
    const soldItem = (await readCatalogItems()).find((entry) => entry.id === order.items[0]?.catalogItemId);
    if (soldItem && soldItem.trackStock !== false) {
      const qty = order.items[0]?.quantity || 1;
      const alreadyReturned = (await (async () => {
        const db = await getDb();
        if (!db) {
          return seedInventoryMovements.some(
            (movement) => movement.orderId === order.id && movement.kind === 'return',
          );
        }
        return Boolean(await db.collection('inventoryMovements').findOne({ orderId: order.id, kind: 'return' }));
      })());
      if (!alreadyReturned) {
        await applyInventoryChange({
          item: soldItem,
          delta: qty,
          kind: 'return',
          reason: `Return for refunded order ${order.id}`,
          byUserId: parseResult.data.userId,
          orderId: order.id,
        }).catch(() => undefined);
      }
    }
    await saveOrder(finalOrder);
  } else {
    await saveOrder(finalOrder);
  }
  void ensureCustomerFromOrder(finalOrder);
  io.to(`user:${finalOrder.sellerUserId}`).emit('order:updated', { order: finalOrder });
  io.to(`user:${finalOrder.buyerUserId}`).emit('order:updated', { order: finalOrder });
  return res.json({ order: finalOrder, receipt: issuedReceipt });
});

app.get('/api/receipts', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const receipts = (await readSaleReceipts()).filter(
    (receipt) => receipt.buyerUserId === userId || receipt.sellerUserId === userId,
  );
  return res.json({ receipts });
});

app.get('/api/receipts/:receiptId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const receipt = (await readSaleReceipts()).find((item) => item.id === req.params.receiptId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  if (userId && receipt.buyerUserId !== userId && receipt.sellerUserId !== userId) {
    return res.status(403).json({ error: 'You cannot view this receipt.' });
  }
  return res.json({ receipt });
});

app.get('/api/orders/:orderId/receipt', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const order = (await readOrders()).find((entry) => entry.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (userId && order.buyerUserId !== userId && order.sellerUserId !== userId) {
    return res.status(403).json({ error: 'You cannot view this order.' });
  }
  if (!order.receiptId) {
    return res.status(404).json({ error: 'No receipt yet. Receipts are issued after payment is confirmed.' });
  }
  const receipt = (await readSaleReceipts()).find((item) => item.id === order.receiptId);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  return res.json({ receipt, order });
});

app.post('/api/catalog', async (req, res) => {
  const parseResult = createCatalogItemSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid catalog payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const timestamp = new Date().toISOString();
  const sellerId = parseResult.data.sellerId ?? await resolveRequestUserId(req);
  const titleKey = parseResult.data.title.trim().toLowerCase();
  const existingItems = await readCatalogItems();
  const duplicate = existingItems.find((item) =>
    item.sellerId === sellerId
    && !item.takenDown
    && (item.status || 'active') !== 'archived'
    && item.title.trim().toLowerCase() === titleKey,
  );
  if (duplicate) {
    return res.status(409).json({ error: 'This product is already in your catalog. Edit it instead of posting it again.' });
  }
  const sellerProfile = sellerId ? await readProfile(sellerId) : null;
  const sellerCurrency = sellerProfile?.currency
    || (sellerProfile?.phone || sellerProfile?.countryCode
      ? currencyForCallingCode(sellerProfile.countryCode || sellerProfile.phone)
      : '');
  const trackStock = parseResult.data.trackStock !== false;
  const stockQuantity = parseResult.data.stockQuantity ?? 0;
  const status = resolveCatalogStatus(parseResult.data.status || 'active', stockQuantity, trackStock);
  const item: CatalogItem = {
    id: `p${Date.now()}`,
    sellerId,
    businessId: parseResult.data.businessId || sellerProfile?.activeBusinessId || null,
    title: parseResult.data.title,
    price: parseResult.data.price,
    currency: sellerCurrency || parseResult.data.currency,
    category: parseResult.data.category,
    description: parseResult.data.description,
    imageUrls: parseResult.data.imageUrls,
    stockQuantity,
    trackStock,
    costPrice: parseResult.data.costPrice ?? null,
    lowStockThreshold: parseResult.data.lowStockThreshold ?? 2,
    status,
    variants: parseResult.data.variants || [],
    availabilityUpdatedAt: timestamp,
    isPublic: parseResult.data.isPublic == null ? status === 'active' : Boolean(parseResult.data.isPublic),
    location: parseResult.data.location?.trim() || '',
    condition: parseResult.data.condition || 'New',
    takenDown: false,
    boostedUntil: null,
    boostText: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await persistCatalogItem(item);
  io.emit('catalog:itemCreated', item);

  return res.status(201).json({ item });
});

app.patch('/api/catalog/:itemId', async (req, res) => {
  const parseResult = updateCatalogItemSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid catalog update payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const items = await readCatalogItems();
  const existing = items.find((item) => item.id === req.params.itemId);
  if (!existing) {
    return res.status(404).json({ error: 'Catalog item not found' });
  }

  const nextTrack = parseResult.data.trackStock ?? existing.trackStock !== false;
  const stockDeltaRequested = parseResult.data.stockQuantity != null
    ? Number(parseResult.data.stockQuantity) - Number(existing.stockQuantity || 0)
    : 0;
  let updated: CatalogItem = {
    ...existing,
    ...parseResult.data,
    trackStock: nextTrack,
    variants: parseResult.data.variants ?? existing.variants ?? [],
    lowStockThreshold: parseResult.data.lowStockThreshold ?? existing.lowStockThreshold ?? 2,
    costPrice: parseResult.data.costPrice === undefined ? existing.costPrice : parseResult.data.costPrice,
    updatedAt: new Date().toISOString(),
  };
  if (stockDeltaRequested !== 0 && nextTrack) {
    try {
      const result = await applyInventoryChange({
        item: existing,
        delta: stockDeltaRequested,
        kind: 'adjustment',
        reason: 'Catalog stock edit',
        byUserId: typeof req.body?.userId === 'string' ? req.body.userId : existing.sellerId,
        lowStockThreshold: parseResult.data.lowStockThreshold,
      });
      updated = {
        ...result.item,
        ...parseResult.data,
        stockQuantity: result.item.stockQuantity,
        trackStock: nextTrack,
        status: resolveCatalogStatus(
          parseResult.data.status ?? result.item.status,
          result.item.stockQuantity,
          nextTrack,
        ),
        variants: parseResult.data.variants ?? result.item.variants ?? [],
        isPublic: (parseResult.data.status ?? result.item.status) === 'archived'
          || (parseResult.data.status ?? result.item.status) === 'draft'
          ? false
          : (parseResult.data.isPublic == null ? result.item.isPublic : Boolean(parseResult.data.isPublic)),
        updatedAt: new Date().toISOString(),
      };
      await persistCatalogItemUpdate(updated);
      io.emit('catalog:itemUpdated', updated);
      return res.json({ item: updated, movement: result.movement, alert: result.alert });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : 'Stock update failed.' });
    }
  }
  updated = {
    ...updated,
    stockQuantity: parseResult.data.stockQuantity ?? existing.stockQuantity,
    status: resolveCatalogStatus(
      parseResult.data.status ?? existing.status,
      parseResult.data.stockQuantity ?? existing.stockQuantity,
      nextTrack,
    ),
    availabilityUpdatedAt: parseResult.data.stockQuantity != null || parseResult.data.trackStock != null || parseResult.data.status != null
      ? new Date().toISOString()
      : (existing.availabilityUpdatedAt || existing.updatedAt),
    isPublic: (parseResult.data.status ?? existing.status) === 'archived'
      || (parseResult.data.status ?? existing.status) === 'draft'
      ? false
      : (parseResult.data.isPublic == null ? existing.isPublic : Boolean(parseResult.data.isPublic)),
  };
  await persistCatalogItemUpdate(updated);
  if (parseResult.data.lowStockThreshold != null || parseResult.data.stockQuantity != null) {
    await maybeCreateLowStockAlert(updated);
  }
  io.emit('catalog:itemUpdated', updated);
  return res.json({ item: updated });
});

app.post('/api/catalog/:itemId/stock-adjust', async (req, res) => {
  const parseResult = stockAdjustSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Enter a stock change and reason.' });
  }
  const item = (await readCatalogItems()).find((entry) => entry.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Product not found' });
  if (item.sellerId !== parseResult.data.userId) {
    const business = item.businessId
      ? (await readBusinesses()).find((entry) => entry.id === item.businessId)
      : null;
    const role = business ? businessRoleFor(business, parseResult.data.userId) : null;
    if (role !== 'owner' && role !== 'manager') {
      return res.status(403).json({ error: 'Only the seller or a manager can adjust stock.' });
    }
  }
  try {
    const result = await applyInventoryChange({
      item,
      delta: parseResult.data.delta,
      kind: parseResult.data.delta > 0 ? 'receipt' : 'adjustment',
      reason: parseResult.data.reason,
      byUserId: parseResult.data.userId,
      lowStockThreshold: parseResult.data.lowStockThreshold,
    });
    return res.json({ item: result.item, movement: result.movement, alert: result.alert });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Stock update failed.' });
  }
});

app.get('/api/catalog/:itemId/movements', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const item = (await readCatalogItems()).find((entry) => entry.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Product not found' });
  if (userId && item.sellerId !== userId) {
    return res.status(403).json({ error: 'You cannot view this inventory ledger.' });
  }
  const db = await getDb();
  const movements = db
    ? await db.collection('inventoryMovements').find({ catalogItemId: item.id }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(100).toArray()
    : seedInventoryMovements.filter((movement) => movement.catalogItemId === item.id);
  return res.json({ movements });
});

app.get('/api/inventory/alerts', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const alerts = (await readInventoryAlerts()).filter((alert) => alert.sellerUserId === userId);
  return res.json({
    alerts,
    open: alerts.filter((alert) => alert.state === 'open'),
  });
});

app.post('/api/inventory/alerts/:alertId/review', async (req, res) => {
  const parseResult = inventoryAlertReviewSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Missing user' });
  }
  const alert = (await readInventoryAlerts()).find((entry) => entry.id === req.params.alertId);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (alert.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You cannot review this alert.' });
  }
  const updated: InventoryAlert = {
    ...alert,
    state: 'reviewed',
    reviewedAt: new Date().toISOString(),
    reviewedByUserId: parseResult.data.userId,
  };
  await saveInventoryAlert(updated);
  return res.json({ alert: updated });
});

app.get('/api/customers', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
  const followUpDue = req.query.followUpDue === '1' || req.query.followUpDue === 'true';
  const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
  const now = Date.now();
  let customers = (await readBusinessCustomers()).filter((entry) => entry.sellerUserId === userId);
  if (!includeDeleted) customers = customers.filter((entry) => !entry.deletedAt);
  if (tag) {
    customers = customers.filter((entry) =>
      entry.tags.some((value) => value.toLowerCase() === tag),
    );
  }
  if (followUpDue) {
    customers = customers.filter(
      (entry) => entry.followUpAt && new Date(entry.followUpAt).getTime() <= now,
    );
  }
  if (q) {
    customers = customers.filter((entry) => {
      const haystack = `${entry.displayName} ${entry.phone || ''} ${entry.tags.join(' ')} ${entry.notes.map((note) => note.text).join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }
  customers.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return res.json({
    customers: customers.map(customerPublicView),
    dueFollowUps: customers.filter(
      (entry) => entry.followUpAt && new Date(entry.followUpAt).getTime() <= now,
    ).length,
    marketingEligible: customers.filter((entry) => entry.marketingConsent === 'opted_in').length,
  });
});

app.post('/api/customers', async (req, res) => {
  const parseResult = createCustomerSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Name is required for a customer record.' });
  }
  const actorUserId = parseResult.data.userId;
  const customers = await readBusinessCustomers();
  const matched = findMatchingCustomer(customers, {
    sellerUserId: actorUserId,
    customerUserId: parseResult.data.customerUserId,
    phone: parseResult.data.phone,
    businessId: parseResult.data.businessId,
  });
  const now = new Date().toISOString();
  if (matched) {
    const next: BusinessCustomer = {
      ...matched,
      displayName: parseResult.data.displayName || matched.displayName,
      phone: parseResult.data.phone || matched.phone || '',
      businessId: parseResult.data.businessId ?? matched.businessId ?? null,
      customerUserId: parseResult.data.customerUserId || matched.customerUserId || null,
      tags: parseResult.data.tags?.length
        ? Array.from(new Set([...(matched.tags || []), ...parseResult.data.tags])).slice(0, 20)
        : matched.tags,
      followUpAt: parseResult.data.followUpAt === undefined ? matched.followUpAt : parseResult.data.followUpAt,
      followUpNote: parseResult.data.followUpNote ?? matched.followUpNote,
      chatId: parseResult.data.chatId ?? matched.chatId ?? null,
      deletedAt: null,
      updatedAt: now,
    };
    if (parseResult.data.note) {
      next.notes = [
        {
          id: `note${Date.now()}`,
          text: parseResult.data.note,
          byUserId: actorUserId,
          createdAt: now,
        },
        ...matched.notes,
      ].slice(0, 100);
    }
    await saveBusinessCustomer(next);
    io.to(`user:${actorUserId}`).emit('customer:updated', { customer: customerPublicView(next) });
    return res.json({ customer: customerPublicView(next), existing: true });
  }

  const created: BusinessCustomer = {
    id: `cust${Date.now()}`,
    sellerUserId: actorUserId,
    businessId: parseResult.data.businessId || null,
    customerUserId: parseResult.data.customerUserId || null,
    displayName: parseResult.data.displayName,
    phone: parseResult.data.phone || '',
    tags: parseResult.data.tags || [],
    notes: parseResult.data.note
      ? [{ id: `note${Date.now()}`, text: parseResult.data.note, byUserId: actorUserId, createdAt: now }]
      : [],
    followUpAt: parseResult.data.followUpAt || null,
    followUpNote: parseResult.data.followUpNote || '',
    marketingConsent: 'unknown',
    marketingConsentUpdatedAt: null,
    orderIds: [],
    lastOrderAt: null,
    orderCount: 0,
    totalSpent: 0,
    currency: '',
    chatId: parseResult.data.chatId || null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveBusinessCustomer(created);
  io.to(`user:${actorUserId}`).emit('customer:updated', { customer: customerPublicView(created) });
  return res.status(201).json({ customer: customerPublicView(created) });
});

app.get('/api/customers/:customerId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const customer = (await readBusinessCustomers()).find((entry) => entry.id === req.params.customerId);
  if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  if (userId && !(await canManageCustomers(customer.sellerUserId, userId, customer.businessId))) {
    return res.status(403).json({ error: 'You cannot view this customer record.' });
  }
  const orders = customer.customerUserId
    ? (await readOrders()).filter(
      (order) =>
        order.sellerUserId === customer.sellerUserId
        && order.buyerUserId === customer.customerUserId,
    )
    : (await readOrders()).filter((order) => customer.orderIds.includes(order.id));
  return res.json({
    customer: customerPublicView(customer),
    orders: orders
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40)
      .map((order) => ({
        id: order.id,
        state: order.state,
        totalAmount: order.totalAmount,
        currency: order.currency,
        createdAt: order.createdAt,
        itemTitle: order.items[0]?.title || 'Order',
      })),
  });
});

app.patch('/api/customers/:customerId', async (req, res) => {
  const parseResult = updateCustomerSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid customer update.' });
  }
  const customer = (await readBusinessCustomers()).find((entry) => entry.id === req.params.customerId);
  if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canManageCustomers(customer.sellerUserId, parseResult.data.userId, customer.businessId))) {
    return res.status(403).json({ error: 'You cannot edit this customer record.' });
  }
  // Staff cannot invent marketing opt-in; only opted_out / unknown (or keep existing opted_in).
  let nextConsent = customer.marketingConsent;
  let consentAt = customer.marketingConsentUpdatedAt || null;
  if (parseResult.data.marketingConsent) {
    if (parseResult.data.marketingConsent === 'opted_in' && customer.marketingConsent !== 'opted_in') {
      return res.status(400).json({
        error: 'Customers must opt in themselves. You can only record opted out or unknown here.',
      });
    }
    nextConsent = parseResult.data.marketingConsent;
    consentAt = new Date().toISOString();
  }
  const now = new Date().toISOString();
  const updated: BusinessCustomer = {
    ...customer,
    displayName: parseResult.data.displayName ?? customer.displayName,
    phone: parseResult.data.phone ?? customer.phone,
    tags: parseResult.data.tags ?? customer.tags,
    followUpAt: parseResult.data.followUpAt === undefined ? customer.followUpAt : parseResult.data.followUpAt,
    followUpNote: parseResult.data.followUpNote ?? customer.followUpNote,
    marketingConsent: nextConsent,
    marketingConsentUpdatedAt: consentAt,
    chatId: parseResult.data.chatId === undefined ? customer.chatId : parseResult.data.chatId,
    businessId: parseResult.data.businessId === undefined ? customer.businessId : parseResult.data.businessId,
    updatedAt: now,
  };
  await saveBusinessCustomer(updated);
  io.to(`user:${customer.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(updated) });
  return res.json({ customer: customerPublicView(updated) });
});

app.post('/api/customers/:customerId/notes', async (req, res) => {
  const parseResult = customerNoteSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Write a short note.' });
  }
  const customer = (await readBusinessCustomers()).find((entry) => entry.id === req.params.customerId);
  if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canManageCustomers(customer.sellerUserId, parseResult.data.userId, customer.businessId))) {
    return res.status(403).json({ error: 'You cannot add notes to this customer.' });
  }
  const now = new Date().toISOString();
  const note: CustomerNote = {
    id: `note${Date.now()}`,
    text: parseResult.data.text,
    byUserId: parseResult.data.userId,
    createdAt: now,
  };
  const updated: BusinessCustomer = {
    ...customer,
    notes: [note, ...customer.notes].slice(0, 100),
    updatedAt: now,
  };
  await saveBusinessCustomer(updated);
  io.to(`user:${customer.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(updated) });
  return res.status(201).json({ customer: customerPublicView(updated), note });
});

app.delete('/api/customers/:customerId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : String(req.body?.userId || '');
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const customer = (await readBusinessCustomers()).find((entry) => entry.id === req.params.customerId);
  if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  if (customer.sellerUserId !== userId) {
    return res.status(403).json({ error: 'Only the business owner can delete customer records.' });
  }
  const now = new Date().toISOString();
  const updated: BusinessCustomer = {
    ...customer,
    deletedAt: now,
    updatedAt: now,
    followUpAt: null,
  };
  await saveBusinessCustomer(updated);
  io.to(`user:${customer.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(updated) });
  return res.json({ customer: customerPublicView(updated), deleted: true });
});

app.get('/api/me/customer-preferences', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const records = (await readBusinessCustomers()).filter(
    (entry) => entry.customerUserId === userId && !entry.deletedAt,
  );
  return res.json({
    preferences: records.map((entry) => ({
      customerId: entry.id,
      sellerUserId: entry.sellerUserId,
      businessId: entry.businessId || null,
      marketingConsent: entry.marketingConsent,
      marketingConsentUpdatedAt: entry.marketingConsentUpdatedAt || null,
      displayNameOnSellerSide: entry.displayName,
    })),
  });
});

app.patch('/api/me/customer-preferences', async (req, res) => {
  const parseResult = customerPreferenceSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose opt in or opt out.' });
  }
  const customer = (await readBusinessCustomers()).find((entry) => entry.id === parseResult.data.customerId);
  if (!customer || customer.deletedAt) return res.status(404).json({ error: 'Record not found' });
  if (customer.customerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You can only change your own marketing preferences.' });
  }
  const now = new Date().toISOString();
  const updated: BusinessCustomer = {
    ...customer,
    marketingConsent: parseResult.data.marketingConsent,
    marketingConsentUpdatedAt: now,
    updatedAt: now,
  };
  await saveBusinessCustomer(updated);
  io.to(`user:${customer.sellerUserId}`).emit('customer:updated', { customer: customerPublicView(updated) });
  return res.json({
    preference: {
      customerId: updated.id,
      sellerUserId: updated.sellerUserId,
      marketingConsent: updated.marketingConsent,
      marketingConsentUpdatedAt: updated.marketingConsentUpdatedAt,
    },
  });
});

app.get('/api/auto-replies', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : null;
  const config = await getAutoReplyConfigForSeller(userId, businessId);
  return res.json({ config });
});

app.put('/api/auto-replies', async (req, res) => {
  const parseResult = upsertAutoReplySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid auto-reply settings.' });
  }
  const existing = await getAutoReplyConfigForSeller(
    parseResult.data.userId,
    parseResult.data.businessId || null,
  );
  const now = new Date().toISOString();
  const rules = (parseResult.data.rules ?? existing.rules).map((rule, index) => ({
    id: rule.id || `rule-${Date.now()}-${index}`,
    keywords: rule.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 12),
    response: rule.response.trim().slice(0, 800),
    enabled: rule.enabled !== false,
  }));
  const next: BusinessAutoReplyConfig = {
    ...existing,
    id: existing.id || `ar-${parseResult.data.userId}`,
    sellerUserId: parseResult.data.userId,
    businessId: parseResult.data.businessId === undefined
      ? existing.businessId || null
      : parseResult.data.businessId,
    enabled: parseResult.data.enabled ?? existing.enabled,
    greetingEnabled: parseResult.data.greetingEnabled ?? existing.greetingEnabled,
    greetingText: parseResult.data.greetingText ?? existing.greetingText,
    awayEnabled: parseResult.data.awayEnabled ?? existing.awayEnabled,
    awayText: parseResult.data.awayText ?? existing.awayText,
    hoursText: parseResult.data.hoursText ?? existing.hoursText,
    humanHandoverKeywords:
      parseResult.data.humanHandoverKeywords ?? existing.humanHandoverKeywords,
    rules,
    cooldownSeconds: parseResult.data.cooldownSeconds ?? existing.cooldownSeconds,
    pausedChatIds: parseResult.data.pausedChatIds ?? existing.pausedChatIds,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  await saveAutoReplyConfig(next);
  io.to(`user:${parseResult.data.userId}`).emit('autoReply:updated', { config: next });
  return res.json({ config: next });
});

app.post('/api/auto-replies/pause-chat', async (req, res) => {
  const parseResult = autoReplyPauseSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Chat id required.' });
  }
  const config = await getAutoReplyConfigForSeller(parseResult.data.userId, null);
  const paused = new Set(config.pausedChatIds || []);
  if (parseResult.data.paused) paused.add(parseResult.data.chatId);
  else paused.delete(parseResult.data.chatId);
  const next: BusinessAutoReplyConfig = {
    ...config,
    pausedChatIds: Array.from(paused).slice(-200),
    updatedAt: new Date().toISOString(),
  };
  await saveAutoReplyConfig(next);
  return res.json({ config: next });
});

app.get('/api/auto-replies/logs', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const db = await getDb();
  const logs = db
    ? await db
      .collection<AutoReplyLog>('autoReplyLogs')
      .find({ sellerUserId: userId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()
    : seedAutoReplyLogs.filter((entry) => entry.sellerUserId === userId).slice(0, 100);
  return res.json({ logs });
});

app.get('/api/documents', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
  let docs = await expireQuotationsIfNeeded(await readCommerceDocuments());
  docs = docs.filter(
    (entry) => entry.sellerUserId === userId || entry.customerUserId === userId,
  );
  if (kind === 'quotation' || kind === 'invoice') {
    docs = docs.filter((entry) => entry.kind === kind);
  }
  return res.json({ documents: docs });
});

app.post('/api/documents', async (req, res) => {
  const parseResult = createCommerceDocSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Add at least one line item and a customer name.' });
  }
  const data = parseResult.data;
  const lines = buildDocLines(data.lines);
  const totals = computeDocTotals(lines, data.discountAmount, data.taxAmount);
  const now = new Date().toISOString();
  const number = await nextDocumentNumber(data.kind, data.userId);
  const doc: CommerceDocument = {
    id: `doc${Date.now()}`,
    kind: data.kind,
    number,
    sellerUserId: data.userId,
    businessId: data.businessId || null,
    customerUserId: data.customerUserId || null,
    customerName: data.customerName,
    customerPhone: data.customerPhone || '',
    chatId: data.chatId || null,
    currency: data.currency || 'GHS',
    lines,
    ...totals,
    notes: data.notes || '',
    paymentTerms: data.paymentTerms || '',
    expiresAt: data.kind === 'quotation' ? (data.expiresAt || null) : null,
    dueAt: data.kind === 'invoice' ? (data.dueAt || null) : null,
    state: 'draft',
    version: 1,
    versions: [{
      version: 1,
      at: now,
      byUserId: data.userId,
      snapshot: {
        lines,
        ...totals,
        notes: data.notes || '',
        paymentTerms: data.paymentTerms || '',
      },
    }],
    history: [{ state: 'draft', at: now, byUserId: data.userId, note: 'Created' }],
    sourceQuotationId: null,
    orderId: null,
    paymentId: null,
    receiptId: null,
    messageId: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveCommerceDocument(doc);
  let finalDoc = doc;
  if (data.sendNow) {
    finalDoc = {
      ...doc,
      state: 'sent',
      updatedAt: new Date().toISOString(),
      history: [...doc.history, { state: 'sent', at: new Date().toISOString(), byUserId: data.userId, note: 'Sent' }],
    };
    await saveCommerceDocument(finalDoc);
    const shared = await shareDocumentInChat(finalDoc, data.userId, data.chatId);
    finalDoc = shared.doc;
  }
  io.to(`user:${data.userId}`).emit('document:updated', { document: finalDoc });
  if (finalDoc.customerUserId) {
    io.to(`user:${finalDoc.customerUserId}`).emit('document:updated', { document: finalDoc });
  }
  return res.status(201).json({ document: finalDoc });
});

app.get('/api/documents/:documentId', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const docs = await expireQuotationsIfNeeded(await readCommerceDocuments());
  const doc = docs.find((entry) => entry.id === req.params.documentId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (userId && doc.sellerUserId !== userId && doc.customerUserId !== userId) {
    return res.status(403).json({ error: 'You cannot view this document.' });
  }
  return res.json({ document: doc });
});

app.patch('/api/documents/:documentId', async (req, res) => {
  const parseResult = updateCommerceDocSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid document update.' });
  }
  const docs = await readCommerceDocuments();
  const existing = docs.find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'Only the seller can edit this document.' });
  }
  if (!['draft', 'sent', 'rejected'].includes(existing.state)) {
    return res.status(400).json({ error: 'This document can no longer be edited.' });
  }
  const lines = parseResult.data.lines ? buildDocLines(parseResult.data.lines) : existing.lines;
  const totals = computeDocTotals(
    lines,
    parseResult.data.discountAmount ?? existing.discountAmount,
    parseResult.data.taxAmount ?? existing.taxAmount,
  );
  const now = new Date().toISOString();
  const nextVersion = existing.version + 1;
  const updated: CommerceDocument = {
    ...existing,
    customerName: parseResult.data.customerName ?? existing.customerName,
    customerPhone: parseResult.data.customerPhone ?? existing.customerPhone,
    customerUserId: parseResult.data.customerUserId === undefined
      ? existing.customerUserId
      : parseResult.data.customerUserId,
    chatId: parseResult.data.chatId === undefined ? existing.chatId : parseResult.data.chatId,
    currency: parseResult.data.currency ?? existing.currency,
    lines,
    ...totals,
    notes: parseResult.data.notes ?? existing.notes,
    paymentTerms: parseResult.data.paymentTerms ?? existing.paymentTerms,
    expiresAt: parseResult.data.expiresAt === undefined ? existing.expiresAt : parseResult.data.expiresAt,
    dueAt: parseResult.data.dueAt === undefined ? existing.dueAt : parseResult.data.dueAt,
    version: nextVersion,
    versions: [
      ...existing.versions,
      {
        version: nextVersion,
        at: now,
        byUserId: parseResult.data.userId,
        snapshot: {
          lines,
          ...totals,
          notes: parseResult.data.notes ?? existing.notes,
          paymentTerms: parseResult.data.paymentTerms ?? existing.paymentTerms,
        },
      },
    ].slice(-20),
    updatedAt: now,
  };
  await saveCommerceDocument(updated);
  io.to(`user:${updated.sellerUserId}`).emit('document:updated', { document: updated });
  if (updated.customerUserId) {
    io.to(`user:${updated.customerUserId}`).emit('document:updated', { document: updated });
  }
  return res.json({ document: updated });
});

app.post('/api/documents/:documentId/send', async (req, res) => {
  const parseResult = commerceDocActionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const existing = (await readCommerceDocuments()).find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'Only the seller can send this document.' });
  }
  if (existing.kind === 'quotation' && existing.state === 'expired') {
    return res.status(400).json({ error: 'Renew this expired quotation before sending.' });
  }
  const now = new Date().toISOString();
  let next: CommerceDocument = {
    ...existing,
    state: 'sent',
    chatId: parseResult.data.chatId || existing.chatId,
    updatedAt: now,
    history: [...existing.history, { state: 'sent', at: now, byUserId: parseResult.data.userId, note: parseResult.data.note || 'Sent' }],
  };
  await saveCommerceDocument(next);
  const shared = await shareDocumentInChat(next, parseResult.data.userId, next.chatId);
  next = shared.doc;
  io.to(`user:${next.sellerUserId}`).emit('document:updated', { document: next });
  if (next.customerUserId) io.to(`user:${next.customerUserId}`).emit('document:updated', { document: next });
  return res.json({ document: next, message: shared.message });
});

app.post('/api/documents/:documentId/accept', async (req, res) => {
  const parseResult = commerceDocActionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const docs = await expireQuotationsIfNeeded(await readCommerceDocuments());
  const existing = docs.find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.customerUserId && existing.customerUserId !== parseResult.data.userId && existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You cannot accept this document.' });
  }
  if (existing.kind === 'quotation' && existing.state === 'expired') {
    return res.status(400).json({ error: 'This quotation has expired. Ask for a renewal.' });
  }
  if (existing.state !== 'sent') {
    return res.status(400).json({ error: 'Only a sent document can be accepted.' });
  }
  const now = new Date().toISOString();
  const updated: CommerceDocument = {
    ...existing,
    state: 'accepted',
    updatedAt: now,
    history: [...existing.history, { state: 'accepted', at: now, byUserId: parseResult.data.userId, note: parseResult.data.note || 'Accepted' }],
  };
  await saveCommerceDocument(updated);
  io.to(`user:${updated.sellerUserId}`).emit('document:updated', { document: updated });
  if (updated.customerUserId) io.to(`user:${updated.customerUserId}`).emit('document:updated', { document: updated });
  return res.json({ document: updated });
});

app.post('/api/documents/:documentId/reject', async (req, res) => {
  const parseResult = commerceDocActionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const existing = (await readCommerceDocuments()).find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.customerUserId && existing.customerUserId !== parseResult.data.userId && existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You cannot reject this document.' });
  }
  if (existing.state !== 'sent') {
    return res.status(400).json({ error: 'Only a sent document can be rejected.' });
  }
  const now = new Date().toISOString();
  const updated: CommerceDocument = {
    ...existing,
    state: 'rejected',
    updatedAt: now,
    history: [...existing.history, { state: 'rejected', at: now, byUserId: parseResult.data.userId, note: parseResult.data.note || 'Rejected' }],
  };
  await saveCommerceDocument(updated);
  io.to(`user:${updated.sellerUserId}`).emit('document:updated', { document: updated });
  if (updated.customerUserId) io.to(`user:${updated.customerUserId}`).emit('document:updated', { document: updated });
  return res.json({ document: updated });
});

app.post('/api/documents/:documentId/convert', async (req, res) => {
  const parseResult = commerceDocActionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const existing = (await readCommerceDocuments()).find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'Only the seller can convert this quotation.' });
  }
  if (existing.kind !== 'quotation') {
    return res.status(400).json({ error: 'Only quotations convert to invoices.' });
  }
  if (!['accepted', 'sent'].includes(existing.state)) {
    return res.status(400).json({ error: 'Accept or send the quotation before converting.' });
  }
  if (existing.state === 'expired') {
    return res.status(400).json({ error: 'Expired quotations cannot be converted.' });
  }
  const now = new Date().toISOString();
  const number = await nextDocumentNumber('invoice', existing.sellerUserId);
  const invoice: CommerceDocument = {
    ...existing,
    id: `doc${Date.now()}`,
    kind: 'invoice',
    number,
    state: 'sent',
    sourceQuotationId: existing.id,
    dueAt: existing.dueAt || null,
    expiresAt: null,
    version: 1,
    versions: [{
      version: 1,
      at: now,
      byUserId: parseResult.data.userId,
      snapshot: {
        lines: existing.lines,
        subtotal: existing.subtotal,
        discountAmount: existing.discountAmount,
        taxAmount: existing.taxAmount,
        totalAmount: existing.totalAmount,
        notes: existing.notes,
        paymentTerms: existing.paymentTerms,
      },
    }],
    history: [{ state: 'sent', at: now, byUserId: parseResult.data.userId, note: `Converted from ${existing.number}` }],
    messageId: null,
    createdAt: now,
    updatedAt: now,
  };
  const quotation: CommerceDocument = {
    ...existing,
    state: 'converted',
    updatedAt: now,
    history: [...existing.history, { state: 'converted', at: now, byUserId: parseResult.data.userId, note: `Converted to ${invoice.number}` }],
  };
  await saveCommerceDocument(quotation);
  await saveCommerceDocument(invoice);
  const shared = await shareDocumentInChat(invoice, parseResult.data.userId, parseResult.data.chatId || invoice.chatId);
  io.to(`user:${invoice.sellerUserId}`).emit('document:updated', { document: quotation });
  io.to(`user:${invoice.sellerUserId}`).emit('document:updated', { document: shared.doc });
  if (invoice.customerUserId) {
    io.to(`user:${invoice.customerUserId}`).emit('document:updated', { document: shared.doc });
  }
  return res.status(201).json({ quotation, invoice: shared.doc, message: shared.message });
});

app.post('/api/documents/:documentId/mark-paid', async (req, res) => {
  const parseResult = commerceDocActionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const existing = (await readCommerceDocuments()).find((entry) => entry.id === req.params.documentId);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (existing.sellerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'Only the seller can mark this invoice paid.' });
  }
  if (existing.kind !== 'invoice') {
    return res.status(400).json({ error: 'Only invoices can be marked paid.' });
  }
  if (existing.state === 'paid') {
    return res.json({ document: existing });
  }
  if (!parseResult.data.paymentId && !parseResult.data.markCashReceived) {
    return res.status(400).json({
      error: 'Link a confirmed paymentId or explicitly mark cash received.',
    });
  }
  const now = new Date().toISOString();
  const updated: CommerceDocument = {
    ...existing,
    state: 'paid',
    paymentId: parseResult.data.paymentId || existing.paymentId || `cash-${Date.now()}`,
    updatedAt: now,
    history: [
      ...existing.history,
      {
        state: 'paid',
        at: now,
        byUserId: parseResult.data.userId,
        note: parseResult.data.paymentId
          ? `Payment ${parseResult.data.paymentId}`
          : 'Cash received (authorised record)',
      },
    ],
  };
  await saveCommerceDocument(updated);
  io.to(`user:${updated.sellerUserId}`).emit('document:updated', { document: updated });
  if (updated.customerUserId) io.to(`user:${updated.customerUserId}`).emit('document:updated', { document: updated });
  return res.json({ document: updated });
});

app.get('/api/broadcasts', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const campaigns = (await readBroadcastCampaigns()).filter((entry) => entry.sellerUserId === userId);
  const optedIn = await resolveBroadcastAudience(userId, 'opted_in');
  return res.json({
    campaigns,
    audiencePreview: {
      opted_in: optedIn.length,
      repeat_buyers: (await resolveBroadcastAudience(userId, 'repeat_buyers')).length,
      all_customers: (await resolveBroadcastAudience(userId, 'all_customers')).length,
    },
  });
});

app.post('/api/broadcasts', async (req, res) => {
  const parseResult = createBroadcastSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Write a broadcast message.' });
  }
  const data = parseResult.data;
  if (data.segment === 'tag' && !data.tag) {
    return res.status(400).json({ error: 'Choose a tag for this segment.' });
  }
  const audience = await resolveBroadcastAudience(data.userId, data.segment, data.tag);
  if (!audience.length) {
    return res.status(400).json({
      error: 'No opted-in customers in this segment. Marketing requires opt-in.',
    });
  }
  // Simple rate limit: max 5 campaigns / hour
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (await readBroadcastCampaigns()).filter(
    (entry) =>
      entry.sellerUserId === data.userId
      && new Date(entry.createdAt).getTime() >= hourAgo
      && entry.status !== 'cancelled',
  );
  if (recent.length >= 5) {
    return res.status(429).json({ error: 'Broadcast rate limit reached. Try again later.' });
  }
  const now = new Date().toISOString();
  let campaign: BroadcastCampaign = {
    id: `bc${Date.now()}`,
    sellerUserId: data.userId,
    businessId: data.businessId || null,
    text: data.text,
    segment: data.segment,
    tag: data.tag || null,
    status: data.scheduledAt && !data.sendNow ? 'draft' : 'draft',
    audienceCount: audience.length,
    sentCount: 0,
    failedCount: 0,
    scheduledAt: data.scheduledAt || null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await saveBroadcastCampaign(campaign);
  if (data.sendNow || !data.scheduledAt) {
    campaign = await sendBroadcastCampaign(campaign);
  } else {
    io.to(`user:${data.userId}`).emit('broadcast:updated', { campaign });
  }
  return res.status(201).json({ campaign });
});

app.post('/api/broadcasts/:campaignId/cancel', async (req, res) => {
  const userId = String(req.body?.userId || '');
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const campaign = (await readBroadcastCampaigns()).find((entry) => entry.id === req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.sellerUserId !== userId) {
    return res.status(403).json({ error: 'You cannot cancel this campaign.' });
  }
  if (campaign.status === 'sent') {
    return res.status(400).json({ error: 'Already sent campaigns cannot be cancelled.' });
  }
  const updated: BroadcastCampaign = {
    ...campaign,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
  };
  await saveBroadcastCampaign(updated);
  io.to(`user:${userId}`).emit('broadcast:updated', { campaign: updated });
  return res.json({ campaign: updated });
});

const rewriteWithTone = (text: string, tone: z.infer<typeof aiToneSchema>) => {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return cleaned;
  if (tone === 'concise') {
    return cleaned
      .replace(/\b(just|really|very|actually|basically|kind of|sort of)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);
  }
  if (tone === 'polite') {
    if (/please|thank/i.test(cleaned)) return cleaned;
    return `Please ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`.replace(/\.$/, '') + '. Thank you.';
  }
  if (tone === 'professional') {
    return cleaned
      .replace(/\b(hey|hi+|yeah|ok+|gonna|wanna)\b/gi, (match) => {
        const map: Record<string, string> = {
          hey: 'Hello', hi: 'Hello', yeah: 'Yes', ok: 'Understood', okay: 'Understood', gonna: 'going to', wanna: 'want to',
        };
        return map[match.toLowerCase()] || match;
      })
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (tone === 'friendly') {
    if (/!|😊|thanks/i.test(cleaned)) return cleaned;
    return `${cleaned.replace(/\.$/, '')} — happy to help!`;
  }
  // apologetic
  if (/sorry|apologis/i.test(cleaned)) return cleaned;
  return `Sorry about that. ${cleaned}`;
};

const buildSuggestedReplies = (incomingText: string, tone?: z.infer<typeof aiToneSchema>) => {
  const text = (incomingText || '').toLowerCase();
  const picks: Array<{ text: string; tone: z.infer<typeof aiToneSchema>; reason: string }> = [];
  const push = (body: string, reason: string, forcedTone: z.infer<typeof aiToneSchema> = tone || 'polite') => {
    picks.push({ text: rewriteWithTone(body, forcedTone), tone: forcedTone, reason });
  };

  if (/late|delay|where.*order|hasn't arrived|not arrived/.test(text)) {
    push('We apologise for the delay. Please share your order number so we can check this immediately.', 'delivery_delay', 'apologetic');
    push('Thanks for flagging this. I am checking the fulfilment status now and will update you shortly.', 'delivery_delay', 'professional');
  }
  if (/price|how much|cost|quote/.test(text)) {
    push('Thanks for your interest. I will share the current price and options for you now.', 'pricing', 'friendly');
    push('Please let me know the quantity you need and I will send an accurate quote.', 'pricing', 'professional');
  }
  if (/available|in stock|do you have|still sell/.test(text)) {
    push('Let me confirm stock for you and reply with what is available.', 'availability', 'concise');
    push('Thanks for asking. I am checking availability and will confirm shortly.', 'availability', 'polite');
  }
  if (/refund|return|money back/.test(text)) {
    push('I understand. Please share your order number and I will review the refund options with you.', 'refund', 'apologetic');
    push('We can look at this carefully. Share the order details and your preferred resolution.', 'refund', 'professional');
  }
  if (/open|hours|when.*close|are you open/.test(text)) {
    push('Our team will confirm today\'s hours and get back to you right away.', 'hours', 'friendly');
  }
  if (/thank|thanks|appreciate/.test(text)) {
    push('You are welcome. Happy to help anytime.', 'thanks', 'friendly');
  }
  if (!picks.length) {
    push('Thanks for your message. I will get back to you shortly.', 'generic', tone || 'polite');
    push('Got it — let me check and reply soon.', 'generic', 'concise');
    push('Thank you for reaching out. How can I best help with this?', 'generic', 'professional');
  }

  const unique = new Map<string, { text: string; tone: z.infer<typeof aiToneSchema>; reason: string }>();
  for (const entry of picks) {
    if (!unique.has(entry.text)) unique.set(entry.text, entry);
  }
  return Array.from(unique.values()).slice(0, 4).map((entry, index) => ({
    id: `sug-${Date.now()}-${index}`,
    text: entry.text,
    tone: entry.tone,
    reason: entry.reason,
    source: 'template' as const,
  }));
};

const scanScamSignals = (text: string) => {
  const lower = text.toLowerCase();
  const signals: Array<{ code: string; label: string; severity: 'low' | 'medium' | 'high' }> = [];
  if (/(momo|mobile money).*(pin|otp|code)|send.*(pin|otp)|give me your (pin|otp)/i.test(lower)) {
    signals.push({ code: 'pin_request', label: 'Asks for a PIN or OTP', severity: 'high' });
  }
  if (/prize|you have won|claim your reward|lottery/i.test(lower)) {
    signals.push({ code: 'prize_scam', label: 'Unsolicited prize or reward claim', severity: 'high' });
  }
  if (/urgent|act now|within 10 minutes|immediately send money/i.test(lower)) {
    signals.push({ code: 'urgency_pressure', label: 'High-pressure urgency language', severity: 'medium' });
  }
  if (/bit\.ly|tinyurl|t\.co\/|http:\/\//i.test(lower)) {
    signals.push({ code: 'suspicious_link', label: 'Shortened or insecure link', severity: 'medium' });
  }
  if (/gift card|western union|send crypto|bitcoin only/i.test(lower)) {
    signals.push({ code: 'unusual_payment', label: 'Unusual payment method request', severity: 'high' });
  }
  const severityRank = { low: 1, medium: 2, high: 3 };
  const top = signals.sort((a, b) => severityRank[b.severity] - severityRank[a.severity])[0];
  return {
    risky: signals.length > 0,
    severity: top?.severity || 'low',
    signals,
    advice: signals.length
      ? 'Be careful. Never share MoMo PINs or OTPs. Verify the sender before sending money.'
      : null,
  };
};

app.post('/api/ai/suggest-replies', async (req, res) => {
  const parseResult = suggestRepliesSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'chatId and userId are required.' });
  }
  const chat = (await readChats()).find((entry) => entry.id === parseResult.data.chatId);
  if (!chat || !chat.participants.includes(parseResult.data.userId)) {
    return res.status(403).json({ error: 'You cannot suggest replies for this chat.' });
  }
  const messages = (await readMessages())
    .filter((entry) => entry.chatId === chat.id && !entry.deletedForEveryone)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const target = parseResult.data.messageId
    ? messages.find((entry) => entry.id === parseResult.data.messageId)
    : [...messages].reverse().find((entry) => entry.senderId !== parseResult.data.userId && entry.kind === 'text');
  if (!target) {
    return res.status(404).json({ error: 'No message found to suggest a reply for.' });
  }
  const suggestions = buildSuggestedReplies(target.text || '', parseResult.data.tone);
  return res.json({
    suggestions,
    contextUsed: {
      messageId: target.id,
      preview: (target.text || '').slice(0, 180),
      senderId: target.senderId,
    },
    autoSend: false,
    notice: 'Suggestions are templates. Edit before sending. Nothing is sent automatically.',
  });
});

app.post('/api/ai/rewrite', async (req, res) => {
  const parseResult = rewriteMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Add text to rewrite.' });
  }
  const tones: Array<z.infer<typeof aiToneSchema>> = parseResult.data.tone
    ? [parseResult.data.tone]
    : ['polite', 'concise', 'professional', 'friendly', 'apologetic'];
  const variants = tones.map((tone, index) => ({
    id: `rw-${Date.now()}-${index}`,
    tone,
    text: rewriteWithTone(parseResult.data.text, tone),
    source: 'template' as const,
  }));
  return res.json({
    variants,
    autoSend: false,
    notice: 'Rewrites keep your meaning but may need fact-checking before send.',
  });
});

app.post('/api/ai/scam-check', async (req, res) => {
  const parseResult = scamCheckSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Add message text to check.' });
  }
  const result = scanScamSignals(parseResult.data.text);
  return res.json({
    ...result,
    disclaimer: 'This is a warning aid, not a guarantee that every scam can be detected.',
  });
});

const buildChatSummary = (
  messages: Message[],
  viewerId: string,
) => {
  const textMessages = messages.filter(
    (entry) =>
      entry.kind === 'text'
      && !entry.deletedForEveryone
      && !(entry.deletedFor || []).includes(viewerId)
      && (entry.text || '').trim(),
  );
  const questions: Array<{ messageId: string; text: string; sentAt: string; senderId: string }> = [];
  const decisions: Array<{ messageId: string; text: string; sentAt: string; senderId: string }> = [];
  const actions: Array<{ messageId: string; text: string; sentAt: string; senderId: string; suggested: true }> = [];
  const highlights: Array<{ messageId: string; text: string; sentAt: string; senderId: string }> = [];

  for (const message of textMessages) {
    const text = message.text.trim();
    const item = {
      messageId: message.id,
      text: text.slice(0, 220),
      sentAt: message.sentAt,
      senderId: message.senderId,
    };
    if (/\?/.test(text) || /^(who|what|when|where|why|how|can you|could you|please)\b/i.test(text)) {
      questions.push(item);
    }
    if (/\b(agreed|we will|let's|lets|confirmed|decision|ship it|go ahead)\b/i.test(text)) {
      decisions.push(item);
    }
    if (/\b(please|need you to|can you|could you|todo|follow up|send me|share)\b/i.test(text)) {
      actions.push({ ...item, suggested: true });
    }
    if (
      text.length >= 40
      || /\b(order|payment|invoice|delivery|meeting|deadline|price)\b/i.test(text)
    ) {
      highlights.push(item);
    }
  }

  const uniqueById = <T extends { messageId: string }>(items: T[]) => {
    const seen = new Set<string>();
    return items.filter((entry) => {
      if (seen.has(entry.messageId)) return false;
      seen.add(entry.messageId);
      return true;
    });
  };

  const overviewParts: string[] = [];
  if (textMessages.length) {
    overviewParts.push(`${textMessages.length} messages in scope.`);
  }
  if (questions.length) overviewParts.push(`${questions.length} open question(s).`);
  if (decisions.length) overviewParts.push(`${decisions.length} possible decision(s).`);
  if (actions.length) overviewParts.push(`${actions.length} possible follow-up(s).`);

  return {
    overview: overviewParts.join(' ') || 'No text messages in this range.',
    questions: uniqueById(questions).slice(-8),
    decisions: uniqueById(decisions).slice(-8),
    actionSuggestions: uniqueById(actions).slice(-8),
    highlights: uniqueById(highlights).slice(-10),
    messageCount: textMessages.length,
    method: 'extractive',
    notice: 'This is an extractive summary of messages you can read, not a substitute for the chat. Action items are suggestions only.',
  };
};

app.post('/api/ai/summarize', async (req, res) => {
  const parseResult = summarizeChatSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'chatId and userId are required.' });
  }
  const { userId, chatId, scope } = parseResult.data;
  const limit = parseResult.data.limit || (scope === 'unread' ? 120 : 80);
  const chat = (await readChats()).find((entry) => entry.id === chatId);
  if (!chat || !chat.participants.includes(userId)) {
    return res.status(403).json({ error: 'You cannot summarise this chat.' });
  }
  let messages = (await readMessages())
    .filter((entry) => entry.chatId === chatId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  if (scope === 'unread') {
    const unread = messages.filter(
      (entry) =>
        entry.senderId !== userId
        && entry.state !== 'read'
        && !entry.deletedForEveryone,
    );
    messages = unread.length ? unread.slice(-limit) : messages.slice(-Math.min(40, limit));
  } else if (scope === 'range') {
    const since = parseResult.data.since ? new Date(parseResult.data.since).getTime() : 0;
    const until = parseResult.data.until ? new Date(parseResult.data.until).getTime() : Date.now();
    messages = messages
      .filter((entry) => {
        const at = new Date(entry.sentAt).getTime();
        return at >= since && at <= until;
      })
      .slice(-limit);
  } else {
    messages = messages.slice(-limit);
  }

  // Drop disappearing messages past expiry for this viewer
  const now = Date.now();
  messages = messages.filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > now);

  const summary = buildChatSummary(messages, userId);
  return res.json({
    chatId,
    scope,
    summary,
    sourceMessageIds: [
      ...summary.questions,
      ...summary.decisions,
      ...summary.actionSuggestions,
      ...summary.highlights,
    ].map((entry) => entry.messageId),
  });
});

app.post('/api/ai/dictate', async (req, res) => {
  const parseResult = dictateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Provide dictated text or an audio URL.' });
  }
  const text = (parseResult.data.text || '').trim();
  if (text) {
    return res.json({
      text,
      autoSend: false,
      source: 'on_device',
      notice: 'Review and edit before sending. Dictation never sends automatically.',
    });
  }
  if (parseResult.data.audioUrl) {
    const hasProvider = Boolean(
      process.env.SPEECH_TO_TEXT_API_KEY
      || process.env.OPENAI_API_KEY
      || process.env.GOOGLE_SPEECH_API_KEY,
    );
    if (!hasProvider) {
      return res.status(503).json({
        error: 'Server speech-to-text is not configured yet.',
        needsProvider: true,
        autoSend: false,
        notice: 'Use on-device dictation, or type and edit the draft manually.',
      });
    }
    // Provider wiring lands when keys are available; keep contract stable.
    return res.status(501).json({
      error: 'Speech provider is configured but not wired in this build.',
      needsProvider: true,
      autoSend: false,
    });
  }
  return res.status(400).json({ error: 'Provide dictated text or an audio URL.' });
});

const TRANSLATION_GLOSSARY: Record<string, Partial<Record<'en' | 'tw' | 'ga' | 'ee' | 'pcm', string>>> = {
  hello: { en: 'Hello', tw: 'Mema wo akye', ga: 'Ojekoo', ee: 'Ndi', pcm: 'How far' },
  thanks: { en: 'Thank you', tw: 'Medaase', ga: 'Oyiwala don', ee: 'Akpe', pcm: 'Thank you' },
  'thank you': { en: 'Thank you', tw: 'Medaase', ga: 'Oyiwala don', ee: 'Akpe', pcm: 'Thank you' },
  yes: { en: 'Yes', tw: 'Aane', ga: 'Hɛɛ', ee: 'Ɛ̃', pcm: 'Yes' },
  no: { en: 'No', tw: 'Daabi', ga: 'Dabi', ee: 'Ao', pcm: 'No' },
  please: { en: 'Please', tw: 'Mepa wo kyɛw', ga: 'Ofaine', ee: 'Taflatse', pcm: 'Abeg' },
  goodbye: { en: 'Goodbye', tw: 'Nante yie', ga: 'Nyɔɔ', ee: 'Hede nyuie', pcm: 'I dey go' },
  'how much': { en: 'How much?', tw: 'Ɛyɛ sɛn?', ga: 'Eji ene?', ee: 'Ga nenie?', pcm: 'How much?' },
  'good morning': { en: 'Good morning', tw: 'Mema wo akye', ga: 'Ojekoo', ee: 'Ŋdi', pcm: 'Good morning' },
};

const glossaryTranslate = (
  text: string,
  targetLanguage: 'en' | 'tw' | 'ga' | 'ee' | 'pcm',
) => {
  const normalized = text.trim().toLowerCase().replace(/[?!.,]+$/g, '');
  const hit = TRANSLATION_GLOSSARY[normalized];
  if (hit?.[targetLanguage]) {
    return {
      translatedText: hit[targetLanguage]!,
      method: 'glossary' as const,
      partial: false,
    };
  }
  // Soft match: replace known tokens inside longer sentences when targeting English
  if (targetLanguage === 'en') {
    let output = text;
    let replaced = false;
    for (const [phrase, map] of Object.entries(TRANSLATION_GLOSSARY)) {
      if (!map.en) continue;
      const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'ig');
      if (pattern.test(output)) {
        output = output.replace(pattern, map.en);
        replaced = true;
      }
    }
    if (replaced) {
      return { translatedText: output, method: 'glossary' as const, partial: true };
    }
  }
  return null;
};

app.post('/api/messages/:messageId/transcribe', async (req, res) => {
  const parseResult = transcribeMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Missing user' });
  }
  const message = (await readMessages()).find((entry) => entry.id === req.params.messageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const chat = (await readChats()).find((entry) => entry.id === message.chatId);
  if (!chat || !chat.participants.includes(parseResult.data.userId)) {
    return res.status(403).json({ error: 'You cannot transcribe this message.' });
  }
  if (message.kind !== 'voice') {
    return res.status(400).json({ error: 'Only voice notes can be transcribed.' });
  }
  if (message.transcriptStatus === 'ready' && message.transcript) {
    return res.json({
      message,
      transcript: message.transcript,
      cached: true,
      notice: 'Transcript was already available for this voice note.',
    });
  }

  const hasProvider = Boolean(
    process.env.SPEECH_TO_TEXT_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.GOOGLE_SPEECH_API_KEY,
  );
  const audioUrl = message.mediaUrls?.[0] || '';
  if (!audioUrl) {
    const updated: Message = {
      ...message,
      transcriptStatus: 'failed',
      transcriptUpdatedAt: new Date().toISOString(),
    };
    await saveMessageUpdate(updated);
    return res.status(422).json({ error: 'Voice note has no audio URL.', message: updated });
  }

  if (!hasProvider) {
    // If sender already typed a caption into text (non-default), surface that as a caption transcript.
    const caption = (message.text || '').trim();
    const looksLikeCaption = caption && !/^(audio|voice( note)?)$/i.test(caption);
    const updated: Message = {
      ...message,
      transcript: looksLikeCaption ? caption : undefined,
      transcriptStatus: looksLikeCaption ? 'ready' : 'unavailable',
      transcriptLanguage: parseResult.data.language || 'auto',
      transcriptUpdatedAt: new Date().toISOString(),
    };
    await saveMessageUpdate(updated);
    for (const participantId of chat.participants) {
      io.to(`user:${participantId}`).emit('message:transcript', {
        message: presentMessage(updated, participantId),
      });
    }
    return res.status(looksLikeCaption ? 200 : 503).json({
      message: updated,
      transcript: updated.transcript || null,
      needsProvider: !looksLikeCaption,
      notice: looksLikeCaption
        ? 'Showing the sender caption as text. Full speech transcription needs a provider key.'
        : 'Speech transcription provider is not configured yet.',
    });
  }

  // Provider key present but wiring is intentionally deferred.
  const pending: Message = {
    ...message,
    transcriptStatus: 'pending',
    transcriptUpdatedAt: new Date().toISOString(),
  };
  await saveMessageUpdate(pending);
  return res.status(501).json({
    error: 'Speech provider is configured but not wired in this build.',
    message: pending,
    needsProvider: true,
  });
});

app.post('/api/ai/translate', async (req, res) => {
  const parseResult = translateSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Add text and a target language.' });
  }
  const { userId, text, targetLanguage, sourceLanguage, messageId, chatId } = parseResult.data;
  if (messageId) {
    const message = (await readMessages()).find((entry) => entry.id === messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    const chat = (await readChats()).find((entry) => entry.id === message.chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'You cannot translate this message.' });
    }
  } else if (chatId) {
    const chat = (await readChats()).find((entry) => entry.id === chatId);
    if (!chat || !chat.participants.includes(userId)) {
      return res.status(403).json({ error: 'You cannot translate in this chat.' });
    }
  }

  const glossary = glossaryTranslate(text, targetLanguage);
  if (glossary) {
    return res.json({
      translatedText: glossary.translatedText,
      sourceLanguage: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
      targetLanguage,
      method: glossary.method,
      partial: glossary.partial,
      testedPairs: ['en↔tw', 'en↔ga', 'en↔ee', 'en↔pcm'],
      notice: glossary.partial
        ? 'Partial glossary translation. Review before relying on it.'
        : 'Matched a tested glossary phrase. Review before relying on it.',
    });
  }

  const hasProvider = Boolean(
    process.env.TRANSLATE_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.GOOGLE_TRANSLATE_API_KEY,
  );
  if (!hasProvider) {
    return res.json({
      translatedText: text,
      sourceLanguage: sourceLanguage === 'auto' ? 'auto' : sourceLanguage,
      targetLanguage,
      method: 'passthrough',
      partial: true,
      needsProvider: true,
      testedPairs: ['en↔tw', 'en↔ga', 'en↔ee', 'en↔pcm'],
      notice: 'Full translation needs a provider. Common phrases can still use the built-in glossary.',
    });
  }

  return res.status(501).json({
    error: 'Translation provider is configured but not wired in this build.',
    needsProvider: true,
  });
});

app.post('/api/ai/assistant', async (req, res) => {
  const parseResult = assistantTaskSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose an assistant task.' });
  }
  const data = parseResult.data;
  if ((data.chatId || data.messageId) && !data.consentToShareContext) {
    return res.status(400).json({
      error: 'Confirm consentToShareContext before sharing chat content with the assistant.',
      requiresConsent: true,
    });
  }

  let contextText = (data.text || data.prompt || '').trim();
  let contextMeta: Record<string, string> = {};
  if (data.chatId || data.messageId) {
    if (data.messageId) {
      const message = (await readMessages()).find((entry) => entry.id === data.messageId);
      if (!message) return res.status(404).json({ error: 'Message not found' });
      const chat = (await readChats()).find((entry) => entry.id === message.chatId);
      if (!chat || !chat.participants.includes(data.userId)) {
        return res.status(403).json({ error: 'You cannot use this message with the assistant.' });
      }
      contextText = message.text || contextText;
      contextMeta = { messageId: message.id, chatId: message.chatId };
    } else if (data.chatId) {
      const chat = (await readChats()).find((entry) => entry.id === data.chatId);
      if (!chat || !chat.participants.includes(data.userId)) {
        return res.status(403).json({ error: 'You cannot use this chat with the assistant.' });
      }
      contextMeta = { chatId: chat.id };
    }
  }

  if (data.task === 'rewrite') {
    if (!contextText) return res.status(400).json({ error: 'Add text to rewrite.' });
    const tone = data.tone || 'polite';
    return res.json({
      task: data.task,
      result: rewriteWithTone(contextText, tone),
      tone,
      autoSend: false,
      contextUsed: contextMeta,
      notice: 'Review and edit before sending. The assistant never sends for you.',
    });
  }

  if (data.task === 'suggest_reply') {
    if (!data.chatId) return res.status(400).json({ error: 'chatId is required for suggest_reply.' });
    const suggestions = buildSuggestedReplies(contextText || 'Hello', data.tone);
    return res.json({
      task: data.task,
      suggestions,
      autoSend: false,
      contextUsed: contextMeta,
      notice: 'Suggestions are drafts only.',
    });
  }

  if (data.task === 'summarise') {
    if (!data.chatId) return res.status(400).json({ error: 'chatId is required for summarise.' });
    const chat = (await readChats()).find((entry) => entry.id === data.chatId);
    if (!chat || !chat.participants.includes(data.userId)) {
      return res.status(403).json({ error: 'You cannot summarise this chat.' });
    }
    const messages = (await readMessages())
      .filter((entry) => entry.chatId === data.chatId)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
      .slice(-80);
    const summary = buildChatSummary(messages, data.userId);
    return res.json({
      task: data.task,
      summary,
      autoSend: false,
      contextUsed: contextMeta,
      notice: summary.notice,
    });
  }

  if (data.task === 'translate') {
    if (!contextText) return res.status(400).json({ error: 'Add text to translate.' });
    const targetLanguage = data.targetLanguage || 'en';
    const glossary = glossaryTranslate(contextText, targetLanguage);
    return res.json({
      task: data.task,
      result: glossary?.translatedText || contextText,
      targetLanguage,
      partial: glossary ? glossary.partial : true,
      needsProvider: !glossary,
      autoSend: false,
      contextUsed: contextMeta,
      notice: glossary
        ? 'Glossary translation — review before relying on it.'
        : 'No glossary match. Full MT needs a provider.',
    });
  }

  if (data.task === 'explain') {
    if (!contextText) return res.status(400).json({ error: 'Add text to explain.' });
    return res.json({
      task: data.task,
      result: `Plain-language reading: this message is about “${contextText.slice(0, 160)}”. Check any amounts, dates or promises yourself before you reply.`,
      autoSend: false,
      contextUsed: contextMeta,
      notice: 'Explanation is heuristic, not legal or financial advice.',
    });
  }

  // draft
  const prompt = (data.prompt || contextText || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Describe what to draft.' });
  const tone = data.tone || 'professional';
  const draftBase = prompt.startsWith('Draft') || prompt.startsWith('Write')
    ? prompt
    : `Regarding your message: ${prompt}`;
  return res.json({
    task: 'draft',
    result: rewriteWithTone(draftBase, tone),
    tone,
    autoSend: false,
    contextUsed: contextMeta,
    notice: 'Draft only. Edit before sending. Never treat AI wording as a final commitment.',
  });
});

const defaultBusinessAiConfig = (sellerUserId: string, businessId?: string | null): BusinessAiConfig => {
  const now = new Date().toISOString();
  return {
    id: `bai-${sellerUserId}${businessId ? `-${businessId}` : ''}`,
    sellerUserId,
    businessId: businessId || null,
    enabled: false,
    autoSend: false,
    policyText: '',
    deliveryPolicy: '',
    refundPolicy: '',
    faq: [],
    createdAt: now,
    updatedAt: now,
  };
};

const readBusinessAiConfigs = async () => {
  const db = await getDb();
  if (!db) return [...seedBusinessAiConfigs];
  return db.collection<BusinessAiConfig>('businessAiConfigs').find({}, { projection: { _id: 0 } }).toArray();
};

const saveBusinessAiConfig = async (config: BusinessAiConfig) => {
  const db = await getDb();
  if (!db) {
    const index = seedBusinessAiConfigs.findIndex((entry) => entry.id === config.id);
    if (index >= 0) seedBusinessAiConfigs[index] = config;
    else seedBusinessAiConfigs.unshift(config);
    return config;
  }
  await db.collection<BusinessAiConfig>('businessAiConfigs').updateOne(
    { id: config.id },
    { $set: config },
    { upsert: true },
  );
  return config;
};

const getBusinessAiConfig = async (sellerUserId: string, businessId?: string | null) => {
  const configs = await readBusinessAiConfigs();
  if (businessId) {
    const match = configs.find((entry) => entry.sellerUserId === sellerUserId && entry.businessId === businessId);
    if (match) return match;
  }
  return configs.find((entry) => entry.sellerUserId === sellerUserId && !entry.businessId)
    || defaultBusinessAiConfig(sellerUserId, businessId || null);
};

const answerBusinessQuestion = async (
  config: BusinessAiConfig,
  question: string,
  sellerUserId: string,
) => {
  const q = question.toLowerCase();
  const catalog = (await readCatalogItems()).filter(
    (item) => item.sellerId === sellerUserId && item.takenDown !== true,
  );
  const businesses = await businessesForUser(sellerUserId);
  const business = config.businessId
    ? businesses.find((entry) => entry.id === config.businessId)
    : businesses.find((entry) => entry.ownerUserId === sellerUserId) || businesses[0];

  // FAQ exact-ish match
  for (const entry of config.faq || []) {
    if (entry.question && q.includes(entry.question.toLowerCase().slice(0, 24))) {
      return {
        answer: `Automated: ${entry.answer}`,
        confidence: 'high' as const,
        source: 'faq' as const,
        escalate: false,
      };
    }
  }

  if (/refund|return|money back/.test(q)) {
    if (config.refundPolicy.trim()) {
      return {
        answer: `Automated (refund policy): ${config.refundPolicy}`,
        confidence: 'high' as const,
        source: 'refund_policy' as const,
        escalate: false,
      };
    }
    return {
      answer: 'Automated: I cannot confirm refund outcomes from approved data. A teammate will help you.',
      confidence: 'low' as const,
      source: 'escalation' as const,
      escalate: true,
    };
  }

  if (/deliver|shipping|how long|when.*arrive/.test(q)) {
    if (config.deliveryPolicy.trim()) {
      return {
        answer: `Automated (delivery policy): ${config.deliveryPolicy}`,
        confidence: 'high' as const,
        source: 'delivery_policy' as const,
        escalate: false,
      };
    }
    return {
      answer: 'Automated: Delivery timing is not in approved business data yet. A teammate will confirm.',
      confidence: 'low' as const,
      source: 'escalation' as const,
      escalate: true,
    };
  }

  if (/hour|open|close|are you open/.test(q)) {
    const hours = business?.hours || config.policyText;
    if (hours?.trim()) {
      return {
        answer: `Automated: Our hours are ${hours}.`,
        confidence: 'high' as const,
        source: 'hours' as const,
        escalate: false,
      };
    }
  }

  // Catalog / stock — only from live catalog fields, never invent
  const stockAsk = /stock|available|do you have|in stock|price|how much|cost/.test(q);
  if (stockAsk) {
    const matches = catalog.filter((item) => {
      const hay = `${item.title} ${item.description} ${item.category}`.toLowerCase();
      return question
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 3)
        .some((token) => hay.includes(token));
    }).slice(0, 3);
    if (!matches.length) {
      return {
        answer: 'Automated: I could not match that to an approved catalogue item. A teammate will confirm availability and price.',
        confidence: 'low' as const,
        source: 'escalation' as const,
        escalate: true,
      };
    }
    const lines = matches.map((item) => {
      const stock = item.trackStock === false
        ? 'stock not tracked'
        : `${availableStock(item)} in stock`;
      return `${item.title}: ${item.currency} ${item.price} (${stock})`;
    });
    return {
      answer: `Automated (catalogue): ${lines.join(' · ')}`,
      confidence: 'medium' as const,
      source: 'catalog' as const,
      escalate: false,
      products: matches.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
        currency: item.currency,
        stockQuantity: item.trackStock === false ? null : availableStock(item),
      })),
    };
  }

  if (config.policyText.trim() && q.length > 8) {
    return {
      answer: `Automated (business info): ${config.policyText.slice(0, 400)}`,
      confidence: 'medium' as const,
      source: 'policy' as const,
      escalate: false,
    };
  }

  return {
    answer: 'Automated: I am not sure from approved business data. Connecting you to a person.',
    confidence: 'low' as const,
    source: 'escalation' as const,
    escalate: true,
  };
};

app.get('/api/ai/business', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : null;
  const config = await getBusinessAiConfig(userId, businessId);
  return res.json({ config });
});

app.put('/api/ai/business', async (req, res) => {
  const parseResult = businessAiConfigSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid business AI settings.' });
  }
  const existing = await getBusinessAiConfig(
    parseResult.data.userId,
    parseResult.data.businessId || null,
  );
  const now = new Date().toISOString();
  const next: BusinessAiConfig = {
    ...existing,
    id: existing.id || `bai-${parseResult.data.userId}`,
    sellerUserId: parseResult.data.userId,
    businessId: parseResult.data.businessId === undefined ? existing.businessId : parseResult.data.businessId,
    enabled: parseResult.data.enabled ?? existing.enabled,
    // Never allow silent auto-send of invented commitments; keep false unless explicitly set, still never invent.
    autoSend: false,
    policyText: parseResult.data.policyText ?? existing.policyText,
    deliveryPolicy: parseResult.data.deliveryPolicy ?? existing.deliveryPolicy,
    refundPolicy: parseResult.data.refundPolicy ?? existing.refundPolicy,
    faq: parseResult.data.faq ?? existing.faq,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  await saveBusinessAiConfig(next);
  io.to(`user:${parseResult.data.userId}`).emit('businessAi:updated', { config: next });
  return res.json({ config: next });
});

app.post('/api/ai/business/ask', async (req, res) => {
  const parseResult = businessAiAskSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Ask a business question.' });
  }
  const sellerUserId = parseResult.data.sellerUserId || parseResult.data.userId;
  const config = await getBusinessAiConfig(sellerUserId, parseResult.data.businessId || null);
  const isOwner = parseResult.data.userId === sellerUserId;
  if (!config.enabled && !isOwner) {
    return res.status(403).json({ error: 'This business assistant is paused.' });
  }
  const result = await answerBusinessQuestion(config, parseResult.data.question, sellerUserId);
  return res.json({
    ...result,
    autoSend: false,
    disclosure: 'Automated business assistant. Answers use approved catalogue/policy data only.',
    notice: result.escalate
      ? 'Escalated to a human because approved data was insufficient or sensitive.'
      : 'Review before sending to a customer. The assistant does not auto-send.',
  });
});

const defaultAiTwinConfig = (ownerUserId: string, businessId?: string | null): AiTwinConfig => {
  const now = new Date().toISOString();
  return {
    id: `twin-${ownerUserId}${businessId ? `-${businessId}` : ''}`,
    ownerUserId,
    businessId: businessId || null,
    enabled: false,
    displayName: 'AI Twin',
    permissionTier: 'draft_only',
    allowedTasks: ['draft_reply', 'answer_hours', 'organise_enquiry', 'create_reminder', 'prepare_quotation'],
    dataSources: ['catalog', 'hours', 'faq', 'policies'],
    operatingHoursText: '',
    dailyActionLimit: 40,
    blockedActions: [...TWIN_HARD_BLOCKS],
    createdAt: now,
    updatedAt: now,
  };
};

const readAiTwinConfigs = async () => {
  const db = await getDb();
  if (!db) return [...seedAiTwinConfigs];
  return db.collection<AiTwinConfig>('aiTwins').find({}, { projection: { _id: 0 } }).toArray();
};

const saveAiTwinConfig = async (config: AiTwinConfig) => {
  const db = await getDb();
  // Always re-assert hard blocks so prompt/config injection cannot remove them
  const safe: AiTwinConfig = {
    ...config,
    blockedActions: [...TWIN_HARD_BLOCKS],
    permissionTier: config.permissionTier === 'auto_routine' ? 'auto_routine' : 'draft_only',
  };
  if (!db) {
    const index = seedAiTwinConfigs.findIndex((entry) => entry.id === safe.id);
    if (index >= 0) seedAiTwinConfigs[index] = safe;
    else seedAiTwinConfigs.unshift(safe);
    return safe;
  }
  await db.collection<AiTwinConfig>('aiTwins').updateOne({ id: safe.id }, { $set: safe }, { upsert: true });
  return safe;
};

const getAiTwinConfig = async (ownerUserId: string, businessId?: string | null) => {
  const configs = await readAiTwinConfigs();
  if (businessId) {
    const match = configs.find((entry) => entry.ownerUserId === ownerUserId && entry.businessId === businessId);
    if (match) return { ...match, blockedActions: [...TWIN_HARD_BLOCKS] };
  }
  const personal = configs.find((entry) => entry.ownerUserId === ownerUserId && !entry.businessId);
  return personal
    ? { ...personal, blockedActions: [...TWIN_HARD_BLOCKS] }
    : defaultAiTwinConfig(ownerUserId, businessId || null);
};

const readAiTwinActions = async (ownerUserId: string) => {
  const db = await getDb();
  if (!db) return seedAiTwinActions.filter((entry) => entry.ownerUserId === ownerUserId);
  return db
    .collection<AiTwinAction>('aiTwinActions')
    .find({ ownerUserId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
};

const saveAiTwinAction = async (action: AiTwinAction) => {
  const db = await getDb();
  if (!db) {
    const index = seedAiTwinActions.findIndex((entry) => entry.id === action.id);
    if (index >= 0) seedAiTwinActions[index] = action;
    else seedAiTwinActions.unshift(action);
    return action;
  }
  await db.collection<AiTwinAction>('aiTwinActions').updateOne({ id: action.id }, { $set: action }, { upsert: true });
  return action;
};

const detectTwinInjection = (text: string) =>
  /ignore (all )?(previous|prior) (instructions|rules)|you are now|system prompt|bypass|send money|approve refund|change your permissions/i.test(
    text,
  );

app.get('/api/ai/twin', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : null;
  const config = await getAiTwinConfig(userId, businessId);
  return res.json({
    config,
    capabilities: {
      may: ['draft replies', 'organise enquiries', 'create reminders', 'prepare quotation drafts', 'answer hours from approved data'],
      mayNot: [...TWIN_HARD_BLOCKS, 'send without owner review when draft_only'],
    },
  });
});

app.put('/api/ai/twin', async (req, res) => {
  const parseResult = twinConfigSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid AI Twin settings.' });
  }
  const existing = await getAiTwinConfig(
    parseResult.data.userId,
    parseResult.data.businessId || null,
  );
  const now = new Date().toISOString();
  const next = await saveAiTwinConfig({
    ...existing,
    id: existing.id || `twin-${parseResult.data.userId}`,
    ownerUserId: parseResult.data.userId,
    businessId: parseResult.data.businessId === undefined ? existing.businessId : parseResult.data.businessId,
    enabled: parseResult.data.enabled ?? existing.enabled,
    displayName: parseResult.data.displayName ?? existing.displayName,
    permissionTier: parseResult.data.permissionTier ?? existing.permissionTier,
    allowedTasks: parseResult.data.allowedTasks ?? existing.allowedTasks,
    dataSources: parseResult.data.dataSources ?? existing.dataSources,
    operatingHoursText: parseResult.data.operatingHoursText ?? existing.operatingHoursText,
    dailyActionLimit: parseResult.data.dailyActionLimit ?? existing.dailyActionLimit,
    blockedActions: [...TWIN_HARD_BLOCKS],
    createdAt: existing.createdAt || now,
    updatedAt: now,
  });
  io.to(`user:${parseResult.data.userId}`).emit('twin:updated', { config: next });
  return res.json({ config: next });
});

app.get('/api/ai/twin/actions', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const actions = await readAiTwinActions(userId);
  return res.json({ actions });
});

app.post('/api/ai/twin/run', async (req, res) => {
  const parseResult = twinRunSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid Twin run request.' });
  }
  const twin = await getAiTwinConfig(parseResult.data.userId, parseResult.data.businessId || null);
  if (!twin.enabled) {
    return res.status(403).json({ error: 'AI Twin is paused. Enable it in settings first.' });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todays = (await readAiTwinActions(parseResult.data.userId)).filter(
    (entry) => new Date(entry.createdAt).getTime() >= dayStart.getTime() && entry.status !== 'blocked',
  );
  if (todays.length >= twin.dailyActionLimit) {
    return res.status(429).json({ error: 'Daily Twin action limit reached.' });
  }

  let inputPreview = (parseResult.data.prompt || '').trim();
  let chatId = parseResult.data.chatId || null;
  let messageId = parseResult.data.messageId || null;
  if (messageId) {
    const message = (await readMessages()).find((entry) => entry.id === messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    const chat = (await readChats()).find((entry) => entry.id === message.chatId);
    if (!chat || !chat.participants.includes(parseResult.data.userId)) {
      return res.status(403).json({ error: 'You cannot run the Twin on this message.' });
    }
    inputPreview = message.text || inputPreview;
    chatId = message.chatId;
  } else if (chatId) {
    const chat = (await readChats()).find((entry) => entry.id === chatId);
    if (!chat || !chat.participants.includes(parseResult.data.userId)) {
      return res.status(403).json({ error: 'You cannot run the Twin on this chat.' });
    }
  }

  if (inputPreview && detectTwinInjection(inputPreview)) {
    const blocked: AiTwinAction = {
      id: `twa${Date.now()}`,
      twinId: twin.id,
      ownerUserId: twin.ownerUserId,
      task: 'blocked_attempt',
      status: 'blocked',
      summary: 'Blocked suspicious instruction that tried to change Twin permissions or force a high-risk action.',
      requiresApproval: true,
      chatId,
      messageId,
      inputPreview: inputPreview.slice(0, 240),
      createdAt: new Date().toISOString(),
      decidedAt: new Date().toISOString(),
      decidedByUserId: 'system',
    };
    await saveAiTwinAction(blocked);
    io.to(`user:${twin.ownerUserId}`).emit('twin:action', { action: blocked });
    return res.status(400).json({
      error: 'That request looked like a permission bypass attempt and was blocked.',
      action: blocked,
    });
  }

  const lower = inputPreview.toLowerCase();
  const proposed: AiTwinAction[] = [];
  const now = new Date().toISOString();
  const pushAction = ( partial: Omit<AiTwinAction, 'id' | 'twinId' | 'ownerUserId' | 'createdAt'> ) => {
    if (partial.task !== 'blocked_attempt' && !twin.allowedTasks.includes(partial.task)) return;
    proposed.push({
      id: `twa${Date.now()}-${proposed.length}`,
      twinId: twin.id,
      ownerUserId: twin.ownerUserId,
      createdAt: now,
      chatId,
      messageId,
      inputPreview: inputPreview.slice(0, 240),
      ...partial,
    });
  };

  // High-risk language → never execute; propose human approval note only
  if (/refund|send money|discount|pay me|transfer/.test(lower)) {
    pushAction({
      task: 'organise_enquiry',
      status: 'proposed',
      summary: 'Flagged a sensitive money/refund/discount request for human review.',
      draftText: 'A customer raised a payment-sensitive request. The Twin will not approve money movement or discounts.',
      requiresApproval: true,
      result: 'Awaiting owner review',
    });
  } else if (/hour|open|close|are you open/.test(lower) && twin.allowedTasks.includes('answer_hours')) {
    const hours = twin.operatingHoursText
      || (await businessesForUser(twin.ownerUserId)).find((entry) => entry.ownerUserId === twin.ownerUserId)?.hours
      || '';
    pushAction({
      task: 'answer_hours',
      status: 'proposed',
      summary: 'Draft hours reply from approved business data.',
      draftText: hours
        ? `Automated draft (AI Twin): Our hours are ${hours}.`
        : 'Automated draft (AI Twin): Hours are not in approved data yet — please confirm with the owner.',
      requiresApproval: twin.permissionTier === 'draft_only',
    });
  } else if (/quote|quotation|price list|how much for/.test(lower) && twin.allowedTasks.includes('prepare_quotation')) {
    pushAction({
      task: 'prepare_quotation',
      status: 'proposed',
      summary: 'Prepare a quotation draft for owner review (no prices invented).',
      draftText: 'Automated draft (AI Twin): I can prepare a quotation from catalogue items you select. No price will be invented — please confirm line items.',
      requiresApproval: true,
    });
  } else if (twin.allowedTasks.includes('draft_reply')) {
    const suggestions = buildSuggestedReplies(inputPreview || 'Hello', 'professional');
    pushAction({
      task: 'draft_reply',
      status: 'proposed',
      summary: 'Draft a reply for the owner to edit and send.',
      draftText: `Automated draft (AI Twin — not the owner): ${suggestions[0]?.text || 'Thanks for your message. I will get back to you shortly.'}`,
      requiresApproval: twin.permissionTier === 'draft_only',
    });
  }

  if (twin.allowedTasks.includes('create_reminder') && /follow up|remind|later|tomorrow/.test(lower)) {
    pushAction({
      task: 'create_reminder',
      status: 'proposed',
      summary: 'Create a follow-up reminder draft.',
      draftText: 'Reminder draft: Follow up with this customer within 24 hours.',
      requiresApproval: true,
    });
  }

  if (!proposed.length) {
    pushAction({
      task: 'organise_enquiry',
      status: 'proposed',
      summary: 'Logged enquiry for human handling — Twin was uncertain.',
      draftText: 'The Twin is unsure and stopped for human review.',
      requiresApproval: true,
    });
  }

  for (const action of proposed) {
    await saveAiTwinAction(action);
    io.to(`user:${twin.ownerUserId}`).emit('twin:action', { action });
  }

  return res.status(201).json({
    actions: proposed,
    twin: { id: twin.id, displayName: twin.displayName, permissionTier: twin.permissionTier },
    disclosure: 'AI Twin drafts are labelled as automated and are not the owner speaking secretly.',
    autoSend: false,
    notice: 'Draft-only by default. Twin cannot send money, approve refunds, or invent prices.',
  });
});

app.post('/api/ai/twin/actions/:actionId/approve', async (req, res) => {
  const parseResult = twinActionDecisionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const actions = await readAiTwinActions(parseResult.data.userId);
  const existing = actions.find((entry) => entry.id === req.params.actionId);
  if (!existing) return res.status(404).json({ error: 'Action not found' });
  if (existing.ownerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You cannot approve this Twin action.' });
  }
  if (existing.status === 'blocked') {
    return res.status(400).json({ error: 'Blocked actions cannot be approved.' });
  }
  const updated: AiTwinAction = {
    ...existing,
    status: 'executed_draft',
    requiresApproval: false,
    decidedAt: new Date().toISOString(),
    decidedByUserId: parseResult.data.userId,
    result: parseResult.data.note || 'Approved as draft for the owner to send manually.',
  };
  await saveAiTwinAction(updated);
  io.to(`user:${updated.ownerUserId}`).emit('twin:action', { action: updated });
  return res.json({
    action: updated,
    autoSend: false,
    notice: 'Approved draft only. The Twin still does not send the message for you.',
  });
});

app.post('/api/ai/twin/actions/:actionId/reject', async (req, res) => {
  const parseResult = twinActionDecisionSchema.safeParse(req.body);
  if (!parseResult.success) return res.status(400).json({ error: 'Missing user' });
  const actions = await readAiTwinActions(parseResult.data.userId);
  const existing = actions.find((entry) => entry.id === req.params.actionId);
  if (!existing) return res.status(404).json({ error: 'Action not found' });
  if (existing.ownerUserId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'You cannot reject this Twin action.' });
  }
  const updated: AiTwinAction = {
    ...existing,
    status: 'rejected',
    decidedAt: new Date().toISOString(),
    decidedByUserId: parseResult.data.userId,
    result: parseResult.data.note || 'Rejected by owner',
  };
  await saveAiTwinAction(updated);
  io.to(`user:${updated.ownerUserId}`).emit('twin:action', { action: updated });
  return res.json({ action: updated });
});

app.post('/api/catalog/:itemId/feature', async (req, res) => {
  const items = await readCatalogItems();
  const existing = items.find((item) => item.id === req.params.itemId);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 7));
  const note = String(req.body?.note || '').trim().slice(0, 180);
  const userId = String(req.body?.userId || existing.sellerId);
  if (userId !== existing.sellerId) return res.status(403).json({ error: 'Only the seller can feature this product.' });
  const db = await getDb();
  if (!db) return res.status(503).json({ error: 'Database is not connected.' });
  const request = {
    id: `boost-${Date.now()}`,
    itemId: existing.id,
    userId,
    title: existing.title,
    days,
    note,
    amount: days * 20,
    currency: existing.currency,
    state: 'pending',
    createdAt: new Date().toISOString(),
  };
  await db.collection('boostRequests').insertOne({ ...request });
  await db.collection('payments').insertOne({
    id: `pay-boost-${request.id}`,
    action: 'feature',
    amount: request.amount,
    currency: request.currency,
    userId,
    note: `Feature ${existing.title} for ${days} days`,
    status: 'pending',
    createdAt: request.createdAt,
  });
  return res.status(201).json({ request });
});

app.post('/api/payments/intent', async (req, res) => {
  const parseResult = paymentIntentSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid payment payload',
      details: z.flattenError(parseResult.error),
    });
  }

  // Provider keys (MTN MoMo / etc.) will be wired later via env.
  // This endpoint keeps the client flow ready and returns a staged intent.
  const intent = {
    id: `pay-${Date.now()}`,
    ...parseResult.data,
    status: process.env.MTN_MOMO_API_KEY || process.env.PAYMENT_PROVIDER_API_KEY
      ? 'queued'
      : 'awaiting_provider_keys',
    createdAt: new Date().toISOString(),
  };

  const db = await getDb();
  if (db) {
    await db.collection('payments').insertOne({ ...intent });
  }
  if (parseResult.data.orderId) {
    const order = (await readOrders()).find((entry) => entry.id === parseResult.data.orderId);
    if (order) {
      await saveOrder({
        ...order,
        paymentId: intent.id,
        updatedAt: intent.createdAt,
      });
    }
  }
  return res.status(201).json({
    intent,
    message:
      intent.status === 'awaiting_provider_keys'
        ? 'Payment flow is ready. Add provider API keys to process live transfers.'
        : 'Payment intent accepted and queued for the provider.',
  });
});

app.get('/api/profile', async (req, res) => {
  res.json({ profile: await readProfile(await resolveRequestUserId(req)) });
});

app.patch('/api/profile', async (req, res) => {
  const parseResult = updateProfileSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid profile payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const { pin, ...profileChanges } = parseResult.data;
  const changes: Partial<Profile> = { ...profileChanges };
  if (pin) {
    changes.pinHash = hashPin(pin);
    changes.appLockEnabled = profileChanges.appLockEnabled ?? true;
  } else if (profileChanges.appLockEnabled === false) {
    changes.pinHash = null;
  }

  const profile = await updateProfile(await resolveRequestUserId(req), changes);
  io.emit('profile:updated', profile);

  return res.json({ profile });
});

const createBusinessSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional(),
});

const updateBusinessSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(280).optional(),
  logoUrl: z.string().max(2000).refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    'Logo must be an uploaded https URL',
  ).optional(),
  location: z.string().trim().max(120).optional(),
  hours: z.string().trim().max(120).optional(),
  contactButtonLabel: z.string().trim().max(40).optional(),
  showPhone: z.boolean().optional(),
  visibility: z.enum(['draft', 'published']).optional(),
});

const businessVerifySchema = z.object({
  userId: z.string().min(1),
  note: z.string().trim().max(280).optional(),
  evidenceUrls: z.array(z.string().url()).max(5).default([]),
});

const businessReportSchema = z.object({
  userId: z.string().min(1),
  reason: z.string().trim().min(4).max(280),
});

const addBusinessStaffSchema = z.object({
  userId: z.string().min(1),
  phone: z.string().min(7).max(30),
  countryCode: z.string().max(8).optional(),
  role: z.enum(['manager', 'sales', 'support']),
});

const switchIdentitySchema = z.object({
  userId: z.string().min(1),
  businessId: z.string().max(80).optional(),
});

app.get('/api/businesses', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) {
    return res.status(400).json({ error: 'Missing user' });
  }
  return res.json({ businesses: await businessesForUser(userId) });
});

app.post('/api/businesses', async (req, res) => {
  const parseResult = createBusinessSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Enter a business name.' });
  }
  const owner = (await readUsers()).find((user) => user.id === parseResult.data.userId);
  if (!owner) {
    return res.status(404).json({ error: 'Account not found' });
  }
  const now = new Date().toISOString();
  const business: BusinessProfile = {
    id: `b${Date.now()}`,
    ownerUserId: owner.id,
    name: parseResult.data.name,
    description: parseResult.data.description?.trim() || '',
    logoUrl: '',
    location: '',
    hours: '',
    contactButtonLabel: 'Chat',
    showPhone: false,
    visibility: 'draft',
    verificationStatus: 'unverified',
    verificationNote: '',
    verificationEvidenceUrls: [],
    verificationSubmittedAt: null,
    verificationReviewedAt: null,
    verificationReviewNote: '',
    createdAt: now,
    updatedAt: now,
    members: [{ userId: owner.id, role: 'owner', addedAt: now }],
  };
  await saveBusiness(business);
  const profile = await updateProfile(owner.id, {
    activeBusinessId: business.id,
    businessName: business.name,
    businessDescription: business.description,
  });
  return res.status(201).json({ business, profile });
});

app.patch('/api/businesses/:businessId', async (req, res) => {
  const parseResult = updateBusinessSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'That business update is not valid.' });
  }
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  const role = businessRoleFor(business, parseResult.data.userId);
  if (role !== 'owner' && role !== 'manager') {
    return res.status(403).json({ error: 'Only an owner or manager can edit this business.' });
  }
  const next: BusinessProfile = {
    ...business,
    name: parseResult.data.name ?? business.name,
    description: parseResult.data.description ?? business.description,
    logoUrl: parseResult.data.logoUrl ?? business.logoUrl ?? '',
    location: parseResult.data.location ?? business.location ?? '',
    hours: parseResult.data.hours ?? business.hours ?? '',
    contactButtonLabel: parseResult.data.contactButtonLabel ?? business.contactButtonLabel ?? 'Chat',
    showPhone: parseResult.data.showPhone ?? Boolean(business.showPhone),
    visibility: parseResult.data.visibility ?? business.visibility ?? 'draft',
    updatedAt: new Date().toISOString(),
  };
  await saveBusiness(next);
  if (role === 'owner' || role === 'manager') {
    await updateProfile(business.ownerUserId, {
      businessName: next.name,
      businessDescription: next.description,
    }).catch(() => undefined);
  }
  return res.json({ business: next });
});

app.get('/api/businesses/owner/:ownerUserId/public', async (req, res) => {
  const viewerId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const business = (await readBusinesses()).find(
    (item) =>
      item.ownerUserId === req.params.ownerUserId
      && (item.visibility || 'draft') === 'published',
  );
  if (!business) {
    return res.status(404).json({ error: 'No public business for this account.' });
  }
  const isMember = viewerId ? Boolean(businessRoleFor(business, viewerId)) : false;
  const owner = (await readUsers()).find((user) => user.id === business.ownerUserId);
  const ownerProfile = await readProfile(business.ownerUserId);
  const catalog = (await readCatalogItems()).filter(
    (item) =>
      item.sellerId === business.ownerUserId
      && item.isPublic
      && !item.takenDown
      && (item.status || 'active') !== 'archived'
      && (item.status || 'active') !== 'draft',
  );
  return res.json({
    business: {
      id: business.id,
      name: business.name,
      description: business.description,
      logoUrl: business.logoUrl || '',
      location: business.location || '',
      hours: business.hours || '',
      contactButtonLabel: business.contactButtonLabel || 'Chat',
      showPhone: Boolean(business.showPhone),
      phone: business.showPhone ? (ownerProfile?.phone || owner?.phone || '') : '',
      visibility: business.visibility || 'draft',
      verificationStatus: business.verificationStatus || 'unverified',
      verified: (business.verificationStatus || 'unverified') === 'approved',
      ownerUserId: business.ownerUserId,
      ownerName: owner?.name || ownerProfile?.name || '',
      catalogCount: catalog.length,
    },
    catalogItems: catalog,
    isMember,
  });
});

app.get('/api/businesses/:businessId', async (req, res) => {
  const viewerId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  const isMember = viewerId ? Boolean(businessRoleFor(business, viewerId)) : false;
  const published = (business.visibility || 'draft') === 'published';
  if (!published && !isMember) {
    return res.status(404).json({ error: 'This business is not public yet.' });
  }
  const owner = (await readUsers()).find((user) => user.id === business.ownerUserId);
  const ownerProfile = await readProfile(business.ownerUserId);
  const catalog = (await readCatalogItems()).filter(
    (item) =>
      item.sellerId === business.ownerUserId
      && item.isPublic
      && !item.takenDown
      && (item.status || 'active') !== 'archived'
      && (item.status || 'active') !== 'draft',
  );
  const publicBusiness = {
    id: business.id,
    name: business.name,
    description: business.description,
    logoUrl: business.logoUrl || '',
    location: business.location || '',
    hours: business.hours || '',
    contactButtonLabel: business.contactButtonLabel || 'Chat',
    showPhone: Boolean(business.showPhone),
    phone: business.showPhone ? (ownerProfile?.phone || owner?.phone || '') : '',
    visibility: business.visibility || 'draft',
    verificationStatus: business.verificationStatus || 'unverified',
    verified: (business.verificationStatus || 'unverified') === 'approved',
    ownerUserId: business.ownerUserId,
    ownerName: owner?.name || ownerProfile?.name || '',
    catalogCount: catalog.length,
  };
  return res.json({
    business: isMember ? { ...business, verified: publicBusiness.verified } : publicBusiness,
    catalogItems: catalog,
    isMember,
  });
});

app.get('/api/sales/dashboard', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  if (!userId) return res.status(400).json({ error: 'Missing user' });
  const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : '';
  const period = typeof req.query.period === 'string' ? req.query.period : '7d';
  const now = new Date();
  const start = new Date(now);
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (period === '30d') {
    start.setDate(start.getDate() - 30);
  } else {
    start.setDate(start.getDate() - 7);
  }
  const startIso = start.toISOString();

  let business: BusinessProfile | null = null;
  let role: BusinessRole | null = null;
  let sellerIds: string[] = [userId];
  if (businessId) {
    business = (await readBusinesses()).find((item) => item.id === businessId) || null;
    if (!business) return res.status(404).json({ error: 'Business not found' });
    role = businessRoleFor(business, userId);
    if (!role) return res.status(403).json({ error: 'You are not on this business.' });
    sellerIds = [business.ownerUserId];
  }

  const canSeeFinance = !businessId || role === 'owner' || role === 'manager';
  const [orders, receipts, catalog] = await Promise.all([
    readOrders(),
    readSaleReceipts(),
    readCatalogItems(),
  ]);

  const scopedOrders = orders.filter((order) => {
    const sellerMatch = sellerIds.includes(order.sellerUserId);
    const businessMatch = businessId
      ? order.businessId === businessId || (!order.businessId && order.sellerUserId === business?.ownerUserId)
      : true;
    return sellerMatch && businessMatch;
  });
  const periodOrders = scopedOrders.filter((order) => order.createdAt >= startIso);
  const scopedReceipts = receipts.filter((receipt) => {
    const sellerMatch = sellerIds.includes(receipt.sellerUserId);
    const businessMatch = businessId
      ? receipt.businessId === businessId || (!receipt.businessId && receipt.sellerUserId === business?.ownerUserId)
      : true;
    return sellerMatch && businessMatch && receipt.issuedAt >= startIso;
  });

  const issuedReceipts = scopedReceipts.filter((receipt) => receipt.state === 'issued');
  const refundReceipts = scopedReceipts.filter((receipt) => receipt.state === 'refunded');
  const grossSales = issuedReceipts.reduce((sum, receipt) => sum + Number(receipt.totalAmount || 0), 0);
  const discounts = issuedReceipts.reduce((sum, receipt) => sum + Number(receipt.discount || 0), 0);
  const refunds = refundReceipts.reduce((sum, receipt) => sum + Number(receipt.totalAmount || 0), 0);
  const netSales = Number((grossSales - refunds).toFixed(2));
  const cashReceived = grossSales; // only issued receipts = confirmed payment
  const currency = issuedReceipts[0]?.currency
    || periodOrders[0]?.currency
    || (await readProfile(sellerIds[0]))?.currency
    || 'GHS';

  const pendingOrders = scopedOrders.filter((order) =>
    ['pending_payment', 'paid', 'processing', 'dispatched'].includes(order.state),
  );
  const confirmedOrderIds = new Set(issuedReceipts.map((receipt) => receipt.orderId));

  const productSales: Record<string, { catalogItemId: string; title: string; units: number; revenue: number }> = {};
  issuedReceipts.forEach((receipt) => {
    (receipt.items || []).forEach((item) => {
      const key = item.catalogItemId || item.title;
      if (!productSales[key]) {
        productSales[key] = {
          catalogItemId: item.catalogItemId,
          title: item.title,
          units: 0,
          revenue: 0,
        };
      }
      productSales[key].units += item.quantity || 0;
      productSales[key].revenue += Number(item.price || 0) * Number(item.quantity || 0);
    });
  });
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, 5);

  const sellerCatalog = catalog.filter((item) =>
    sellerIds.includes(item.sellerId)
    && (!businessId || item.businessId === businessId || !item.businessId)
    && !item.takenDown
    && (item.status || 'active') !== 'archived',
  );
  const lowStock = sellerCatalog.filter((item) => {
    if (item.trackStock === false) return false;
    const threshold = item.lowStockThreshold ?? 2;
    return (item.stockQuantity ?? 0) <= threshold;
  }).map((item) => ({
    id: item.id,
    title: item.title,
    stockQuantity: item.stockQuantity,
    lowStockThreshold: item.lowStockThreshold ?? 2,
  }));

  let costOfGoodsSold: number | null = 0;
  let missingCostLines = 0;
  issuedReceipts.forEach((receipt) => {
    (receipt.items || []).forEach((item) => {
      const product = catalog.find((entry) => entry.id === item.catalogItemId);
      if (product && product.costPrice != null && Number.isFinite(product.costPrice)) {
        costOfGoodsSold = (costOfGoodsSold || 0) + Number(product.costPrice) * Number(item.quantity || 0);
      } else {
        missingCostLines += 1;
      }
    });
  });
  const grossProfitAvailable = missingCostLines === 0 && issuedReceipts.length > 0;
  const grossProfit = grossProfitAvailable ? Number((netSales - (costOfGoodsSold || 0)).toFixed(2)) : null;
  if (!grossProfitAvailable) costOfGoodsSold = null;

  const finance = canSeeFinance
    ? {
        grossSales: Number(grossSales.toFixed(2)),
        discounts: Number(discounts.toFixed(2)),
        refunds: Number(refunds.toFixed(2)),
        netSales,
        cashReceived: Number(cashReceived.toFixed(2)),
        costOfGoodsSold,
        grossProfit,
        grossProfitAvailable,
        grossProfitNote: grossProfitAvailable
          ? 'Gross profit uses recorded product cost prices. This is not net profit.'
          : 'Gross profit unavailable until every sold product has a cost price. This is not profit.',
      }
    : null;

  return res.json({
    period: period === 'today' || period === '30d' ? period : '7d',
    periodStart: startIso,
    periodEnd: now.toISOString(),
    currency,
    lastUpdatedAt: now.toISOString(),
    estimated: false,
    role: role || 'owner',
    canSeeFinance,
    metrics: {
      ordersInPeriod: periodOrders.length,
      pendingOrders: pendingOrders.length,
      confirmedSalesCount: confirmedOrderIds.size,
      lowStockCount: lowStock.length,
      ...finance,
    },
    topProducts: canSeeFinance ? topProducts : topProducts.map(({ catalogItemId, title, units }) => ({ catalogItemId, title, units })),
    lowStock,
    drilldown: {
      pendingOrderIds: pendingOrders.slice(0, 20).map((order) => order.id),
      issuedReceiptIds: issuedReceipts.slice(0, 20).map((receipt) => receipt.id),
    },
  });
});

app.post('/api/businesses/:businessId/verify', async (req, res) => {
  const parseResult = businessVerifySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Add a short note or supporting documents.' });
  }
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  if (businessRoleFor(business, parseResult.data.userId) !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can request verification.' });
  }
  if ((business.verificationStatus || 'unverified') === 'approved') {
    return res.status(400).json({ error: 'This business is already verified.' });
  }
  const next: BusinessProfile = {
    ...business,
    verificationStatus: 'pending',
    verificationNote: parseResult.data.note || '',
    verificationEvidenceUrls: parseResult.data.evidenceUrls,
    verificationSubmittedAt: new Date().toISOString(),
    verificationReviewedAt: null,
    verificationReviewNote: '',
    updatedAt: new Date().toISOString(),
  };
  await saveBusiness(next);
  void recordAdminEvent(getDb, {
    level: 'info',
    area: 'business',
    message: 'Business verification submitted',
    detail: `${next.id} ${next.name}`,
  });
  return res.json({ business: next });
});

app.post('/api/businesses/:businessId/report', async (req, res) => {
  const parseResult = businessReportSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Tell us why you are reporting this business.' });
  }
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  const db = await getDb();
  const report = {
    id: `br${Date.now()}`,
    businessId: business.id,
    businessName: business.name,
    reporterUserId: parseResult.data.userId,
    reason: parseResult.data.reason,
    createdAt: new Date().toISOString(),
    state: 'open',
  };
  if (db) {
    await db.collection('businessReports').insertOne({ ...report });
  }
  void recordAdminEvent(getDb, {
    level: 'warn',
    area: 'business',
    message: 'Business reported',
    detail: `${business.id} ${parseResult.data.reason}`,
  });
  return res.status(201).json({ report });
});

app.post('/api/businesses/:businessId/staff', async (req, res) => {
  const parseResult = addBusinessStaffSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Enter the staff phone number and role.' });
  }
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  if (businessRoleFor(business, parseResult.data.userId) !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can add staff.' });
  }
  const staffUser = await readUserByPhone(parseResult.data.phone, parseResult.data.countryCode);
  if (!staffUser) {
    return res.status(404).json({ error: 'That phone number is not on ZynkUp yet.' });
  }
  if (staffUser.id === business.ownerUserId) {
    return res.status(400).json({ error: 'The owner is already on this business.' });
  }
  const members = business.members.filter((member) => member.userId !== staffUser.id);
  members.push({ userId: staffUser.id, role: parseResult.data.role, addedAt: new Date().toISOString() });
  const next = { ...business, members, updatedAt: new Date().toISOString() };
  await saveBusiness(next);
  return res.json({ business: next });
});

app.delete('/api/businesses/:businessId/staff/:memberUserId', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const business = (await readBusinesses()).find((item) => item.id === req.params.businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found' });
  }
  if (businessRoleFor(business, userId) !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can remove staff.' });
  }
  if (req.params.memberUserId === business.ownerUserId) {
    return res.status(400).json({ error: 'The owner cannot be removed.' });
  }
  const next = {
    ...business,
    members: business.members.filter((member) => member.userId !== req.params.memberUserId),
    updatedAt: new Date().toISOString(),
  };
  await saveBusiness(next);
  return res.json({ business: next });
});

app.post('/api/identity', async (req, res) => {
  const parseResult = switchIdentitySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose Personal or a business.' });
  }
  const businessId = parseResult.data.businessId?.trim() || '';
  if (businessId) {
    const business = (await readBusinesses()).find((item) => item.id === businessId);
    if (!business || !businessRoleFor(business, parseResult.data.userId)) {
      return res.status(403).json({ error: 'You do not have access to that business.' });
    }
  }
  const profile = await updateProfile(parseResult.data.userId, { activeBusinessId: businessId || null });
  return res.json({ profile, activeBusinessId: businessId || null });
});

app.post('/api/calls', async (req, res) => {
  const parseResult = createCallSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid call payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const initiatorId = parseResult.data.initiatorId ?? parseResult.data.participantIds[0];
  const calleeId = parseResult.data.participantIds.find((id) => id !== initiatorId) || '';
  if (calleeId) {
    if (await usersHaveBlock(initiatorId, calleeId)) {
      return res.status(403).json({ error: 'You cannot call this person.' });
    }
    const [calleeProfile, mutualContacts] = await Promise.all([
      readProfile(calleeId),
      readContacts(),
    ]);
    const savedByCallee = mutualContacts.some(
      (contact) => contact.ownerUserId === calleeId && contact.linkedUserId === initiatorId,
    );
    const savedByCaller = mutualContacts.some(
      (contact) => contact.ownerUserId === initiatorId && contact.linkedUserId === calleeId,
    );
    if (!privacyAllows(calleeProfile?.callPrivacy, initiatorId, calleeId, savedByCallee && savedByCaller)) {
      return res.status(403).json({ error: 'This person only accepts calls from people they allow.' });
    }
  }

  const call: Call = {
    id: `call${Date.now()}`,
    participantIds: parseResult.data.participantIds,
    initiatorId,
    kind: parseResult.data.kind,
    direction: parseResult.data.direction,
    state: 'ringing',
    startedAt: new Date().toISOString(),
    durationSeconds: 0,
  };

  await persistCall(call);
  const caller = (await readUsers()).find((user) => user.id === call.initiatorId);
  const callerProfile = caller ? await readProfile(caller.id) : null;
  const deliveredCall = {
    ...call,
    caller: caller
      ? {
          id: caller.id,
          name: caller.name,
          phone: caller.phone,
          username: callerProfile?.username || '',
          avatar: caller.avatar,
          photoUri: callerProfile?.photoUri || '',
        }
      : null,
  };
  io.emit('call:created', deliveredCall);
  io.emit('call:incoming', deliveredCall);
  for (const participantId of call.participantIds) {
    if (participantId === call.initiatorId) continue;
    const title = caller?.name || caller?.phone || 'Incoming call';
    void notifyOfflineUser(
      participantId,
      title,
      call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call',
      { type: 'call', callId: call.id, kind: call.kind },
      'calls',
    );
  }

  return res.status(201).json({ call });
});

app.patch('/api/calls/:callId', async (req, res) => {
  const parseResult = updateCallSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid call update payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const timestamp = new Date().toISOString();
  const call = await updateCall(req.params.callId, (current) => ({
    ...current,
    state: parseResult.data.state,
    durationSeconds: parseResult.data.durationSeconds ?? current.durationSeconds,
    answeredAt:
      parseResult.data.state === 'ongoing'
        ? current.answeredAt ?? timestamp
        : current.answeredAt,
    endedAt:
      ['completed', 'missed', 'declined'].includes(parseResult.data.state)
        ? timestamp
        : current.endedAt,
  }));

  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }

  io.emit('call:updated', call);
  if (['completed', 'missed', 'declined'].includes(call.state)) {
    await recordCallMessage(call);
    if (call.state === 'missed' || call.state === 'declined') {
      const caller = (await readUsers()).find((user) => user.id === call.initiatorId);
      for (const participantId of call.participantIds) {
        if (participantId === call.initiatorId && call.state === 'declined') continue;
        const title = caller?.name || 'ZynkUp call';
        const body = call.state === 'missed'
          ? `Missed ${call.kind === 'video' ? 'video' : 'voice'} call`
          : `${call.kind === 'video' ? 'Video' : 'Voice'} call`;
        void notifyOfflineUser(participantId, title, body, { type: 'call', callId: call.id, kind: call.kind }, 'calls');
      }
    }
  }
  return res.json({ call });
});

app.delete('/api/calls/:callId', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  if (!userId) {
    return res.status(400).json({ error: 'Missing user' });
  }
  const call = await updateCall(req.params.callId, (current) => ({
    ...current,
    hiddenFor: [...new Set([...(current.hiddenFor ?? []), userId])],
  }));
  if (!call) {
    return res.status(404).json({ error: 'Call not found' });
  }
  io.to(`user:${userId}`).emit('call:hidden', { callId: call.id, userId });
  return res.json({ ok: true });
});

app.post('/api/chats', async (req, res) => {
  const parseResult = createChatSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid chat payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const requestedSpace = parseResult.data.businessId || 'personal';
  if (requestedSpace !== 'personal') {
    const business = (await readBusinesses()).find((item) => item.id === requestedSpace);
    if (!business || !businessRoleFor(business, parseResult.data.userId)) {
      return res.status(403).json({ error: 'You cannot message as that business.' });
    }
  }
  if (await usersHaveBlock(parseResult.data.userId, parseResult.data.peerUserId)) {
    return res.status(403).json({ error: 'You cannot start a chat with this person.' });
  }
  const chat = await createOrFindDirectChat(parseResult.data.userId, parseResult.data.peerUserId, requestedSpace);
  if (!chat) {
    return res.status(404).json({ error: 'Peer user not found' });
  }

  io.emit('chat:created', chat);
  return res.status(201).json({ chat });
});

app.post('/api/chats/rooms', async (req, res) => {
  const parseResult = createRoomSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'A chat room needs a name and at least 2 people.',
      details: z.flattenError(parseResult.error),
    });
  }

  const roomSpace = parseResult.data.businessId || 'personal';
  if (roomSpace !== 'personal') {
    const business = (await readBusinesses()).find((item) => item.id === roomSpace);
    if (!business || !businessRoleFor(business, parseResult.data.userId)) {
      return res.status(403).json({ error: 'You cannot create a room for that business.' });
    }
  }
  const chat = await createChatRoom(
    parseResult.data.userId,
    parseResult.data.title,
    parseResult.data.memberIds,
    roomSpace,
  );
  if (!chat) {
    return res.status(400).json({ error: 'A chat room needs at least 2 people.' });
  }

  io.emit('chat:created', chat);
  const host = (await readUsers()).find((user) => user.id === parseResult.data.userId);
  for (const participantId of chat.participants) {
    if (participantId === parseResult.data.userId) continue;
    void notifyOfflineUser(
      participantId,
      host?.name || 'ZynkUp',
      `Added you to ${chat.title}`,
      { type: 'chat', chatId: chat.id },
      'messages',
    );
  }
  return res.status(201).json({ chat });
});

app.delete('/api/chats/:chatId', async (req, res) => {
  const userId = await resolveRequestUserId(req);
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || !userId || !chat.participants.includes(userId)) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  if (chat.kind !== 'group') {
    return res.status(400).json({ error: 'Only a chat room can be deleted.' });
  }
  if (!chatAdmins(chat).includes(userId)) {
    return res.status(403).json({ error: 'Only a group admin can delete this room.' });
  }
  const db = await getDb();
  if (!db) {
    const index = seedChats.findIndex((item) => item.id === chat.id);
    if (index >= 0) {
      seedChats.splice(index, 1);
    }
  } else {
    await collectionsFor(db).chats.deleteOne({ id: chat.id });
  }
  io.emit('chat:deleted', { chatId: chat.id });
  return res.json({ ok: true });
});

app.patch('/api/chats/:chatId', async (req, res) => {
  const userId = String(req.body?.userId || '');
  const title = String(req.body?.title || '').trim();
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || chat.kind !== 'group' || !chat.participants.includes(userId)) {
    return res.status(404).json({ error: 'Chat room not found' });
  }
  if (!chatAdmins(chat).includes(userId)) {
    return res.status(403).json({ error: 'Only a group admin can rename this room.' });
  }
  if (title.length < 2 || title.length > 80) {
    return res.status(400).json({ error: 'Enter a room name between 2 and 80 characters.' });
  }
  const updated = { ...chat, title, adminIds: chatAdmins(chat), updatedAt: new Date().toISOString() };
  await saveChatRecord(updated);
  io.emit('chat:updated', updated);
  return res.json({ chat: updated });
});

app.post('/api/chats/:chatId/members', async (req, res) => {
  const userId = String(req.body?.userId || '');
  const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds.map(String) : [];
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || chat.kind !== 'group' || !chat.participants.includes(userId)) {
    return res.status(404).json({ error: 'Chat room not found' });
  }
  if (!chatAdmins(chat).includes(userId)) {
    return res.status(403).json({ error: 'Only a group admin can add people.' });
  }
  const known = new Set((await readUsers()).map((user) => user.id));
  const contacts = await readContacts();
  const allowedMemberIds: string[] = [];
  for (const candidateId of memberIds) {
    if (!known.has(candidateId) || chat.participants.includes(candidateId)) continue;
    if (await usersHaveBlock(userId, candidateId)) continue;
    const invitee = await readProfile(candidateId);
    const mutual = contacts.some((contact) => contact.ownerUserId === userId && contact.linkedUserId === candidateId)
      && contacts.some((contact) => contact.ownerUserId === candidateId && contact.linkedUserId === userId);
    if (!privacyAllows(invitee?.groupInvitePrivacy, userId, candidateId, mutual)) continue;
    allowedMemberIds.push(candidateId);
  }
  if (!allowedMemberIds.length) {
    return res.status(403).json({ error: 'None of those people accept this group invite.' });
  }
  const participants = [...new Set([...chat.participants, ...allowedMemberIds])];
  const added = participants.filter((id) => !chat.participants.includes(id));
  const updated = { ...chat, participants, adminIds: chatAdmins(chat), updatedAt: new Date().toISOString() };
  await saveChatRecord(updated);
  io.emit('chat:updated', updated);
  const host = (await readUsers()).find((user) => user.id === userId);
  for (const participantId of added) {
    void notifyOfflineUser(
      participantId,
      host?.name || 'ZynkUp',
      `Added you to ${updated.title}`,
      { type: 'chat', chatId: updated.id },
      'messages',
    );
  }
  return res.json({ chat: updated });
});

app.delete('/api/chats/:chatId/members/:memberId', async (req, res) => {
  const userId = String(req.query.userId || '');
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || chat.kind !== 'group' || !chat.participants.includes(userId)) {
    return res.status(404).json({ error: 'Chat room not found' });
  }
  const targetId = req.params.memberId;
  const self = userId === targetId;
  if (!self && !chatAdmins(chat).includes(userId)) {
    return res.status(403).json({ error: 'Only a group admin can remove people.' });
  }
  if (!chat.participants.includes(targetId)) {
    return res.status(404).json({ error: 'That person is not in this room.' });
  }
  const participants = chat.participants.filter((id) => id !== targetId);
  if (!participants.length) {
    const db = await getDb();
    if (!db) {
      const index = seedChats.findIndex((item) => item.id === chat.id);
      if (index >= 0) seedChats.splice(index, 1);
    } else {
      await collectionsFor(db).chats.deleteOne({ id: chat.id });
    }
    io.emit('chat:deleted', { chatId: chat.id });
    return res.json({ ok: true, deleted: true });
  }
  let adminIds = chatAdmins(chat).filter((id) => id !== targetId);
  if (!adminIds.length) adminIds = [participants[0]];
  const updated = { ...chat, participants, adminIds, updatedAt: new Date().toISOString() };
  await saveChatRecord(updated);
  io.emit('chat:updated', updated);
  io.emit('chat:membership', { chatId: chat.id, userId: targetId, removed: true });
  return res.json({ chat: updated });
});

app.post('/api/chats/:chatId/admins', async (req, res) => {
  const userId = String(req.body?.userId || '');
  const memberId = String(req.body?.memberId || '');
  const grant = req.body?.admin !== false;
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || chat.kind !== 'group' || !chat.participants.includes(userId) || !chat.participants.includes(memberId)) {
    return res.status(404).json({ error: 'Chat room not found' });
  }
  if (!chatAdmins(chat).includes(userId)) {
    return res.status(403).json({ error: 'Only a group admin can change admins.' });
  }
  let adminIds = chatAdmins(chat);
  if (grant) {
    adminIds = [...new Set([...adminIds, memberId])];
  } else {
    adminIds = adminIds.filter((id) => id !== memberId);
    if (!adminIds.length) {
      return res.status(400).json({ error: 'A room needs at least one admin.' });
    }
  }
  const updated = { ...chat, adminIds, updatedAt: new Date().toISOString() };
  await saveChatRecord(updated);
  io.emit('chat:updated', updated);
  return res.json({ chat: updated });
});

app.post('/api/chat-requests', async (req, res) => {
  const parseResult = createChatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid chat request' });
  }
  const { fromUserId, toUserId, statusId, note } = parseResult.data;
  if (fromUserId === toUserId) {
    return res.status(400).json({ error: 'You cannot request yourself.' });
  }
  const existing = (await readChatRequests()).find((item) =>
    item.state !== 'rejected'
    && ((item.fromUserId === fromUserId && item.toUserId === toUserId)
      || (item.fromUserId === toUserId && item.toUserId === fromUserId)));
  if (existing) {
    return res.status(200).json({ request: existing });
  }
  const request: ChatRequest = {
    id: `r${Date.now()}`,
    fromUserId,
    toUserId,
    statusId,
    note,
    state: 'pending',
    createdAt: new Date().toISOString(),
  };
  await saveChatRequest(request);
  io.emit('chat:request', request);
  return res.status(201).json({ request });
});

app.post('/api/chat-requests/:requestId/:action', async (req, res) => {
  const action = req.params.action;
  if (action !== 'accept' && action !== 'reject') {
    return res.status(400).json({ error: 'Unknown action' });
  }
  const requests = await readChatRequests();
  const current = requests.find((item) => item.id === req.params.requestId);
  if (!current) {
    return res.status(404).json({ error: 'Request not found' });
  }
  const updated: ChatRequest = { ...current, state: action === 'accept' ? 'accepted' : 'rejected' };
  await saveChatRequest(updated);
  let chat = null;
  if (action === 'accept') {
    chat = await createOrFindDirectChat(current.toUserId, current.fromUserId);
    if (chat) {
      io.emit('chat:created', chat);
    }
  }
  io.emit('chat:request', updated);
  return res.json({ request: updated, chat });
});

app.post('/api/messages', async (req, res) => {
  const parseResult = sendMessageSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid message payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const payload = parseResult.data;
  const chat = (await readChats()).find((item) => item.id === payload.chatId);

  const space = chat ? chatSpaceOf(chat) : 'personal';
  const sendingAs = payload.businessId || 'personal';
  const sendingBusiness = sendingAs === 'personal'
    ? null
    : (await readBusinesses()).find((item) => item.id === sendingAs) ?? null;
  const senderRole = sendingBusiness ? businessRoleFor(sendingBusiness, payload.senderId) : null;
  const canAccessChat = Boolean(
    chat && (
      chat.participants.includes(payload.senderId)
      || (space !== 'personal' && senderRole)
    ),
  );
  if (!chat || !canAccessChat) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  if (chat.communityId) {
    const roomPost = await assertCommunityRoomCanPost(communitiesDeps, chat.id, payload.senderId);
    if (!roomPost.ok) {
      return res.status(roomPost.status).json({ error: roomPost.error });
    }
  }
  if (sendingAs !== space) {
    return res.status(409).json({
      error: space === 'personal'
        ? 'This chat is personal. Switch to Personal before you reply.'
        : 'This chat belongs to a business. Switch to that business before you reply.',
    });
  }
  if (sendingAs !== 'personal' && !senderRole) {
    return res.status(403).json({ error: 'You cannot send as that business.' });
  }
  if (chat.kind === 'direct') {
    const peerId = chat.participants.find((id) => id !== payload.senderId) || '';
    if (peerId && (await usersHaveBlock(payload.senderId, peerId))) {
      return res.status(403).json({ error: 'You cannot message this person.' });
    }
  }
  if (payload.anonymous && chat.kind !== 'group') {
    return res.status(400).json({ error: 'Anonymous messages are only for chat rooms.' });
  }
  const anonymousDay = payload.anonymous ? anonymousDayKey() : undefined;
  let anonymousUsed = 0;
  if (payload.anonymous) {
    // Room must opt in; display identity is masked but moderators may still review reports.
    if (chat.communityId) {
      const room = await findCommunityRoomByChatId(communitiesDeps, chat.id);
      if (!room || room.allowAnonymous !== true) {
        return res.status(403).json({
          error: 'Anonymous posting is not enabled in this room.',
        });
      }
    } else if (chat.allowAnonymous !== true) {
      return res.status(403).json({
        error: 'Anonymous posting is not enabled in this room.',
      });
    }
    anonymousUsed = (await readMessages()).filter((item) =>
      item.chatId === payload.chatId
      && item.senderId === payload.senderId
      && item.anonymous
      && item.anonymousDay === anonymousDay,
    ).length;
    const anonymousLimit = (await readAppConfig(getDb)).anonymousDailyLimit;
    if (anonymousUsed >= anonymousLimit) {
      return res.status(429).json({ error: `You can send ${anonymousLimit} anonymous messages in this room each day.` });
    }
  }
  if (payload.clientRef) {
    const existing = (await readMessages()).find(
      (item) => item.chatId === payload.chatId && item.clientRef === payload.clientRef,
    );
    if (existing) {
      return res.status(200).json({ message: presentMessage(existing, payload.senderId) });
    }
  }

  let replyPreview = payload.replyPreview?.trim() || undefined;
  if (payload.replyToMessageId && !replyPreview) {
    const parent = (await readMessages()).find((item) => item.id === payload.replyToMessageId);
    if (parent && !parent.deletedForEveryone) {
      replyPreview = parent.text.slice(0, 140);
    }
  }

  const message: Message = {
    id: `m${Date.now()}`,
    chatId: payload.chatId,
    senderId: payload.senderId,
    clientRef: payload.clientRef,
    kind: payload.kind,
    text: payload.text,
    mediaUrls: payload.mediaUrls,
    sentAt: new Date().toISOString(),
    state: 'sent',
    durationSeconds: payload.durationSeconds,
    replyToMessageId: payload.replyToMessageId,
    replyPreview,
    catalogItemId: payload.catalogItemId,
    anonymous: Boolean(payload.anonymous),
    anonymousDay,
    actorBusinessId: sendingBusiness?.id,
    actorName: sendingBusiness?.name,
    expiresAt: chat.disappearAfterSeconds
      ? new Date(Date.now() + chat.disappearAfterSeconds * 1000).toISOString()
      : undefined,
  };

  await persistMessage(message);
  const updatedChat = await updateChatAfterMessage(
    payload.chatId,
    payload.anonymous ? 'Anonymous message' : payload.text,
    message.sentAt,
    payload.senderId,
  );

  const senderUser = (await readUsers()).find((user) => user.id === message.senderId);
  const senderProfile = senderUser ? await readProfile(senderUser.id) : null;
  const recipientIds = new Set(chat.participants);
  sendingBusiness?.members.forEach((member) => recipientIds.add(member.userId));
  for (const participantId of recipientIds) {
    const delivered = presentMessage(message, participantId);
    io.to(`user:${participantId}`).emit('message:new', {
      ...delivered,
      sender: delivered.senderId === 'anonymous' || !senderUser
        ? undefined
        : {
            id: senderUser.id,
            name: senderUser.name,
            phone: senderUser.phone,
            username: senderProfile?.username || '',
            avatar: senderUser.avatar,
            photoUri: senderProfile?.photoUri || '',
          },
    });
  }
  if (updatedChat) {
    for (const participantId of chat.participants) {
      io.emit('chat:updated', {
        ...updatedChat,
        unreadCount: updatedChat.unreadByUser?.[participantId] ?? 0,
        viewerUserId: participantId,
      });
    }
  }
  if (!payload.anonymous && senderUser) {
    for (const participantId of chat.participants) {
      if (participantId === payload.senderId) continue;
      void notifyOfflineUser(
        participantId,
        senderUser.name || senderUser.phone || 'New message',
        payload.text || 'New message',
        { type: 'message', chatId: payload.chatId, messageId: message.id },
        'messages',
      );
    }
  }

  let autoReply: { reply: Message; log: AutoReplyLog } | null = null;
  if (!payload.anonymous && !message.automated && sendingAs === 'personal') {
    try {
      const result = await maybeSendBusinessAutoReply({
        chat,
        incoming: message,
        senderId: payload.senderId,
      });
      if (result) autoReply = { reply: result.reply, log: result.log };
    } catch {
      // Never fail customer sends because automation failed.
    }
  }

  let scamWarning: ReturnType<typeof scanScamSignals> | null = null;
  if (!payload.anonymous && message.kind === 'text' && message.text) {
    scamWarning = scanScamSignals(message.text);
    if (scamWarning.risky) {
      for (const participantId of chat.participants) {
        if (participantId === payload.senderId) continue;
        io.to(`user:${participantId}`).emit('message:scamWarning', {
          chatId: chat.id,
          messageId: message.id,
          warning: scamWarning,
        });
      }
    }
  }

  return res.status(201).json({
    message: presentMessage(message, payload.senderId),
    autoReply: autoReply
      ? {
          message: presentMessage(autoReply.reply, payload.senderId),
          source: autoReply.log.source,
        }
      : null,
    scamWarning: scamWarning?.risky ? scamWarning : null,
    anonymousRemaining: payload.anonymous
      ? Math.max(0, (await readAppConfig(getDb)).anonymousDailyLimit - 1 - anonymousUsed)
      : undefined,
  });
});

app.post('/api/chats/:chatId/read', async (req, res) => {
  const parseResult = clearChatUnreadSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid read payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const chat = await clearChatUnread(req.params.chatId, parseResult.data.userId);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  io.emit('chat:updated', {
    ...chat,
    unreadCount: chat.unreadByUser?.[parseResult.data.userId] ?? 0,
    viewerUserId: parseResult.data.userId,
  });
  return res.json({
    chat: { ...chat, unreadCount: chat.unreadByUser?.[parseResult.data.userId] ?? 0 },
  });
});

app.delete('/api/messages/:messageId', async (req, res) => {
  const parseResult = deleteMessageSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid delete payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const messages = await readMessages();
  const current = messages.find((item) => item.id === req.params.messageId);
  if (!current) {
    return res.status(404).json({ error: 'Message not found' });
  }

  if (parseResult.data.scope === 'everyone' && current.senderId !== parseResult.data.userId) {
    return res.status(403).json({ error: 'Only the sender can delete for everyone' });
  }

  const db = await getDb();
  let nextMessage: Message;
  if (parseResult.data.scope === 'everyone') {
    nextMessage = {
      ...current,
      text: 'This message was deleted',
      mediaUrls: [],
      deletedForEveryone: true,
      kind: 'text',
    };
  } else {
    nextMessage = {
      ...current,
      deletedFor: [...new Set([...(current.deletedFor ?? []), parseResult.data.userId])],
    };
  }

  if (!db) {
    const index = seedMessages.findIndex((item) => item.id === current.id);
    if (index >= 0) {
      seedMessages[index] = nextMessage;
    }
  } else {
    await seedDatabaseIfNeeded();
    await collectionsFor(db).messages.replaceOne({ id: current.id }, nextMessage);
  }

  const chatForDelete = (await readChats()).find((item) => item.id === nextMessage.chatId);
  if (chatForDelete && nextMessage.anonymous) {
    for (const participantId of chatForDelete.participants) {
      io.to(`user:${participantId}`).emit('message:deleted', {
        message: presentMessage(nextMessage, participantId),
        scope: parseResult.data.scope,
        userId: parseResult.data.userId,
      });
    }
  } else {
    io.emit('message:deleted', {
      message: nextMessage,
      scope: parseResult.data.scope,
      userId: parseResult.data.userId,
    });
  }
  return res.json({ message: presentMessage(nextMessage, parseResult.data.userId) });
});

app.post('/api/messages/:messageId/reveal-author', async (req, res) => {
  const parseResult = revealAuthorSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid reveal payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const actorUserId = parseResult.data.userId?.trim() || await resolveRequestUserId(req);
  if (!actorUserId) {
    return res.status(400).json({ error: 'Missing user' });
  }

  const message = (await readMessages()).find((item) => item.id === req.params.messageId);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }
  if (!message.anonymous) {
    return res.status(400).json({ error: 'Only anonymous messages can be revealed this way.' });
  }

  const chat = (await readChats()).find((item) => item.id === message.chatId);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  if (!chat.participants.includes(actorUserId) && !chatAdmins(chat).includes(actorUserId)) {
    return res.status(403).json({ error: 'You cannot access this chat.' });
  }

  if (chat.communityId) {
    const canModerate = await actorCanModerateCommunity(communitiesDeps, chat.communityId, actorUserId);
    if (!canModerate) {
      return res.status(403).json({
        error: 'Only community moderators and above can reveal anonymous authors.',
      });
    }
    const room = await findCommunityRoomByChatId(communitiesDeps, chat.id);
    await appendCommunityAudit(communitiesDeps, {
      communityId: chat.communityId,
      actorUserId,
      action: 'anonymous.author_revealed',
      detail: 'Restricted identity reveal for moderation',
      targetUserId: message.senderId,
      roomId: room?.id ?? null,
      messageId: message.id,
      chatId: chat.id,
    });
  } else if (!chatAdmins(chat).includes(actorUserId)) {
    return res.status(403).json({
      error: 'Only group admins can reveal anonymous authors in this room.',
    });
  }

  const author = (await readUsers()).find((user) => user.id === message.senderId);
  return res.json({
    authorUserId: message.senderId,
    authorName: author?.name || undefined,
    messageId: message.id,
    chatId: chat.id,
    notice: 'Reveals are logged for moderation accountability.',
  });
});

app.patch('/api/messages/:messageId/receipt', async (req, res) => {
  const parseResult = updateReceiptSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid receipt payload',
      details: z.flattenError(parseResult.error),
    });
  }

  if (parseResult.data.state === 'read') {
    const current = (await readMessages()).find((item) => item.id === req.params.messageId);
    if (current) {
      const chat = (await readChats()).find((item) => item.id === current.chatId);
      const readerId = chat?.participants.find((id) => id !== current.senderId) || '';
      const [senderProfile, readerProfile] = await Promise.all([
        readProfile(current.senderId),
        readerId ? readProfile(readerId) : Promise.resolve(null),
      ]);
      if (senderProfile?.readReceiptsEnabled === false || readerProfile?.readReceiptsEnabled === false) {
        const delivered = current.state === 'sent'
          ? await updateMessageReceipt(req.params.messageId, 'delivered')
          : current;
        if (delivered) {
          io.emit('message:receiptUpdated', delivered);
        }
        return res.json({ message: delivered, receiptsHidden: true });
      }
    }
  }

  const message = await updateMessageReceipt(req.params.messageId, parseResult.data.state);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  io.emit('message:receiptUpdated', message);
  return res.json({ message });
});

app.post('/api/users/block', async (req, res) => {
  const parseResult = blockUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose who to block.' });
  }
  if (parseResult.data.userId === parseResult.data.targetUserId) {
    return res.status(400).json({ error: 'You cannot block yourself.' });
  }
  const profile = await readProfile(parseResult.data.userId);
  const blockedUserIds = [...new Set([...(profile?.blockedUserIds ?? []), parseResult.data.targetUserId])];
  const next = await updateProfile(parseResult.data.userId, { blockedUserIds });
  return res.json({ profile: next, blockedUserIds });
});

app.post('/api/users/unblock', async (req, res) => {
  const parseResult = blockUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose who to unblock.' });
  }
  const profile = await readProfile(parseResult.data.userId);
  const blockedUserIds = (profile?.blockedUserIds ?? []).filter((id) => id !== parseResult.data.targetUserId);
  const next = await updateProfile(parseResult.data.userId, { blockedUserIds });
  return res.json({ profile: next, blockedUserIds });
});

app.patch('/api/chats/:chatId/disappear', async (req, res) => {
  const parseResult = chatDisappearSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Choose a disappearing timer.' });
  }
  const chats = await readChats();
  const chat = chats.find((item) => item.id === req.params.chatId);
  if (!chat || !chat.participants.includes(parseResult.data.userId)) {
    return res.status(404).json({ error: 'Chat not found' });
  }
  const next = {
    ...chat,
    disappearAfterSeconds: parseResult.data.disappearAfterSeconds,
  };
  await saveChatRecord(next);
  for (const participantId of chat.participants) {
    io.to(`user:${participantId}`).emit('chat:updated', {
      ...next,
      unreadCount: next.unreadByUser?.[participantId] ?? 0,
      viewerUserId: participantId,
    });
  }
  return res.json({ chat: next });
});

app.post('/api/calls/:callId/reached', async (req, res) => {
  const call = (await readCalls()).find((item) => item.id === req.params.callId);
  if (!call || call.state !== 'ringing') {
    return res.json({ ok: true });
  }
  const calleeId = call.participantIds.find((id) => id !== call.initiatorId) || '';
  io.to(`user:${call.initiatorId}`).emit('call:peerRinging', { callId: call.id, userId: calleeId });
  void recordAdminEvent(getDb, { level: 'info', area: 'call', message: 'Call reached the other phone', detail: call.id });
  return res.json({ ok: true });
});

app.post('/api/client/events', async (req, res) => {
  const area = typeof req.body?.area === 'string' ? req.body.area : 'app';
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const detail = typeof req.body?.detail === 'string' ? req.body.detail : '';
  if (!message.trim()) {
    return res.status(400).json({ error: 'Missing message' });
  }
  await recordAdminEvent(getDb, { level: 'error', area, message, detail });
  return res.json({ ok: true });
});

io.on('connection', (socket) => {
  void (async () => {
    socket.emit('system:ready', {
      message: 'Connected to Zynkup realtime service',
      bootstrap: await buildBootstrapPayload(),
      timestamp: new Date().toISOString(),
    });
  })();

  socket.on('chat:join', (chatId: string) => {
    socket.join(chatId);
  });

  socket.on('chat:leave', (chatId: string) => {
    socket.leave(chatId);
  });

  socket.on('typing:update', async ({ chatId, userId, typing }) => {
    try {
      const chat = (await readChats()).find((item) => item.id === chatId);
      if (!chat || !userId || !chat.participants.includes(userId)) {
        return;
      }
      const typerProfile = await readProfile(userId);
      for (const participantId of chat.participants) {
        if (participantId === userId) continue;
        if (await usersHaveBlock(userId, participantId)) continue;
        const contacts = await readContacts();
        const mutual = contacts.some((contact) => contact.ownerUserId === userId && contact.linkedUserId === participantId)
          && contacts.some((contact) => contact.ownerUserId === participantId && contact.linkedUserId === userId);
        if (!privacyAllows(typerProfile?.typingPrivacy, participantId, userId, mutual)) {
          continue;
        }
        io.to(`user:${participantId}`).emit('typing:update', { chatId, userId, typing });
      }
    } catch {
      socket.to(chatId).emit('typing:update', { chatId, userId, typing });
    }
  });

  socket.on('presence:update', ({ userId, presence }: { userId: string; presence: Presence }) => {
    void (async () => {
      const user = await updatePresence(userId, presence);
      if (!user) {
        return;
      }
      io.emit('presence:changed', {
        userId,
        presence: user.presence,
        lastSeenAt: user.lastSeenAt ?? null,
      });
    })();
  });

  socket.on('user:join', ({ userId, focused }: { userId?: string; focused?: boolean }) => {
    if (userId) {
      socket.data.userId = userId;
      socket.data.focused = focused !== false;
      socket.join(`user:${userId}`);
    }
  });

  socket.on('user:focus', ({ focused }: { focused?: boolean }) => {
    socket.data.focused = focused === true;
  });

  socket.on('disconnect', () => {
    const userId = typeof socket.data.userId === 'string' ? socket.data.userId : '';
    if (!userId) return;
    setTimeout(() => {
      void io.in(`user:${userId}`).fetchSockets().then((sockets) => {
        if (!sockets.length) {
          void updatePresence(userId, 'offline');
        }
      });
    }, 4000);
  });

  socket.on('call:invite', ({
    toUserId,
    fromUserId,
    fromName,
    kind,
  }: {
    toUserId?: string;
    fromUserId?: string;
    fromName?: string;
    kind?: string;
  }) => {
    if (toUserId) {
      io.to(`user:${toUserId}`).emit('call:invite', { fromUserId, fromName, kind });
    }
  });

  socket.on('call:ringing', ({ callId, userId, initiatorId }: { callId: string; userId: string; initiatorId?: string }) => {
    const event = { callId, userId };
    socket.to(callId).emit('call:peerRinging', event);
    if (initiatorId) {
      io.to(`user:${initiatorId}`).emit('call:peerRinging', event);
    }
  });

  socket.on('call:join', ({ callId, userId }: { callId: string; userId: string }) => {
    socket.join(callId);
    if (userId) {
      socket.join(`user:${userId}`);
    }
    socket.to(callId).emit('call:participantJoined', { callId, userId });
  });

  socket.on('call:leave', ({ callId, userId }: { callId: string; userId: string }) => {
    socket.leave(callId);
    socket.to(callId).emit('call:participantLeft', { callId, userId });
  });

  socket.on(
    'call:signal',
    ({
      callId,
      fromUserId,
      toUserId,
      signalType,
      payload,
    }: {
      callId: string;
      fromUserId: string;
      toUserId?: string;
      signalType: 'offer' | 'answer' | 'ice-candidate';
      payload: unknown;
    }) => {
      const event = { callId, fromUserId, toUserId, signalType, payload };
      if (toUserId) {
        io.to(`user:${toUserId}`).emit('call:signal', event);
      }
      socket.to(callId).emit('call:signal', event);
    },
  );
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const connectMongoInBackground = async () => {
  if (!mongoUri) {
    console.error('FATAL: MONGODB_ATLAS_URI (or MONGO_URI) is required. API calls will fail until it is set. No mock data.');
    return;
  }

  const client = await getMongoClient();
  if (!client || mongoConnectionState !== 'connected') {
    console.error('MongoDB is not connected yet. Retrying in 15s. Requests stay unavailable until Atlas accepts this instance.');
    setTimeout(() => {
      void connectMongoInBackground();
    }, 15000);
    return;
  }

  try {
    await seedDatabaseIfNeeded();
    console.log('Connected to MongoDB (persistent mode — no mock data)');
  } catch (error) {
    console.error('MongoDB connected, but startup cleanup failed:', error);
  }
};

mountAdmin(app, {
  getDb,
  readUsers,
  readProfiles,
  readMessages,
  readCalls,
  readStatuses,
  readCatalogItems,
  updateProfile: (userId, changes) => updateProfile(userId, changes as Partial<Profile>),
  countryKeyFor: (user, profile) => countryKeyFor(user as User | undefined, profile as Profile | null | undefined),
  hashPin,
});

communitiesDeps = {
  getDb,
  io,
  resolveRequestUserId,
  readUsers: async () => (await readUsers()).map((user) => ({ id: user.id, name: user.name, avatar: user.avatar })),
  usersHaveBlock,
  saveChatRecord: async (chat) => saveChatRecord(chat as Chat) as Promise<CommunityChat>,
  readChats: async () => (await readChats()) as CommunityChat[],
  deleteChatById: async (chatId) => {
    const db = await getDb();
    if (!db) {
      const index = seedChats.findIndex((item) => item.id === chatId);
      if (index >= 0) seedChats.splice(index, 1);
      return;
    }
    await collectionsFor(db).chats.deleteOne({ id: chatId });
  },
};

mountCommunities(app, communitiesDeps);

voiceRoomsDeps = {
  getDb,
  io,
  resolveRequestUserId,
  readUsers: async () => (await readUsers()).map((user) => ({ id: user.id, name: user.name, avatar: user.avatar })),
};
mountVoiceRooms(app, voiceRoomsDeps);

gamesDeps = {
  getDb,
  io,
  resolveRequestUserId,
  readUsers: async () => (await readUsers()).map((user) => ({ id: user.id, name: user.name, avatar: user.avatar })),
  persistGameResultMessage: async ({ chatId, hostUserId, text, sessionId }) => {
    const chat = (await readChats()).find((entry) => entry.id === chatId);
    if (!chat) return;
    const message: Message = {
      id: `m${Date.now()}-game`,
      chatId: chat.id,
      senderId: hostUserId,
      clientRef: `game-result-${sessionId}`,
      kind: 'text',
      text,
      mediaUrls: [],
      sentAt: new Date().toISOString(),
      state: 'sent',
      automated: true,
      autoReplySource: 'game-result',
    };
    await persistMessage(message);
    await emitMessageToChat(message, chat, null);
  },
};
registerGamesApi(app, gamesDeps);

const startServer = () => {
  // Cloud Run fails the revision if the process does not listen on PORT quickly.
  // Mongo is connected after the port is open so a slow or blocked Atlas lookup
  // cannot take the container down before the startup probe.
  server.listen(port, host, () => {
    console.log(`Listening on http://${host}:${port}`);
    console.log(`Media storage: ${MEDIA_STORAGE_MODE}${MEDIA_STORAGE_MODE === 'gcs' ? ` (bucket=${GCS_BUCKET || 'unset'})` : ''}`);
    console.log(`Socket.IO running on port ${port}`);
    void connectMongoInBackground();
  });
};

startServer();
