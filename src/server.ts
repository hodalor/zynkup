import 'dotenv/config';
import admin from 'firebase-admin';
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

type Presence = 'online' | 'offline' | 'typing';
type MessageKind = 'text' | 'emoji' | 'image' | 'video' | 'voice' | 'file';
type MediaKind = 'image' | 'video' | 'document';

type User = {
  id: string;
  name: string;
  avatar: string;
  presence: Presence;
  phone: string;
  about: string;
  isBusiness: boolean;
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
};

type Chat = {
  id: string;
  title: string;
  kind: 'direct' | 'group';
  participants: string[];
  unreadCount: number;
  lastMessagePreview: string;
  updatedAt: string;
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
  audience: 'contacts' | 'close-friends';
};

type CatalogItem = {
  id: string;
  sellerId: string;
  title: string;
  price: number;
  currency: string;
  category: string;
  description: string;
  imageUrls: string[];
  stockQuantity: number;
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
  photoUri?: string;
  lastSeenPrivacy?: 'everyone' | 'contacts' | 'nobody';
  profilePhotoPrivacy?: 'everyone' | 'contacts' | 'nobody';
  aboutPrivacy?: 'everyone' | 'contacts' | 'nobody';
  statusPrivacy?: 'contacts' | 'close-friends' | 'nobody';
  readReceiptsEnabled?: boolean;
};

type UpdateFeedEntry = {
  userId: string;
  name: string;
  avatar: string;
  latestAt: string | null;
  items: StatusPost[];
};

type DeviceSession = {
  id: string;
  deviceId: string;
  userId: string;
  platform: string;
  label: string;
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
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  contacts: Contact[];
  calls: Call[];
  statuses: StatusPost[];
  updatesFeed: UpdateFeedEntry[];
  catalogItems: CatalogItem[];
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
  photoUri: '',
  lastSeenPrivacy: 'everyone',
  profilePhotoPrivacy: 'everyone',
  aboutPrivacy: 'everyone',
  statusPrivacy: 'contacts',
  readReceiptsEnabled: true,
};

const seedUsers: User[] = [];
const seedChats: Chat[] = [];
const seedMessages: Message[] = [];
const seedContacts: Contact[] = [];
const seedCalls: Call[] = [];
const seedStatuses: StatusPost[] = [];
const seedCatalogItems: CatalogItem[] = [];

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
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
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
const MAX_DEVICES_PER_USER = 5;
const LINK_REQUEST_TTL_MS = 1000 * 60 * 5;
const MEDIA_STORAGE_MODE: MediaStorageMode =
  process.env.MEDIA_STORAGE_PROVIDER === 'gcs'
    ? 'gcs'
    : process.env.MEDIA_STORAGE_PROVIDER === 'cloudinary'
      ? 'cloudinary'
      : 'local';
const GCS_BUCKET = process.env.GCS_BUCKET ?? process.env.GOOGLE_CLOUD_STORAGE_BUCKET ?? '';
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

let mongoClientPromise: Promise<MongoClient | null> | null = null;
let mongoConnectionState: 'not-configured' | 'connected' | 'failed' = 'not-configured';
const mongoUri = process.env.MONGODB_ATLAS_URI ?? process.env.MONGO_URI;
let firebaseAdminApp: admin.app.App | null = null;

const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  senderId: z.string().min(1),
  clientRef: z.string().min(6).max(120).optional(),
  kind: z.enum(['text', 'emoji', 'image', 'video', 'voice', 'file']).default('text'),
  text: z.string().min(1).max(4000),
  mediaUrls: z.array(z.string().url()).default([]),
  durationSeconds: z.number().int().nonnegative().optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  username: z.string().min(3).max(30).optional(),
  avatar: z.string().min(1).max(4).optional(),
  about: z.string().min(1).max(160).optional(),
  phone: z.string().min(7).max(30).optional(),
  businessName: z.string().min(2).max(80).optional(),
  businessDescription: z.string().min(2).max(160).optional(),
  photoUri: z.string().url().or(z.literal('')).optional(),
  lastSeenPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  profilePhotoPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  aboutPrivacy: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  statusPrivacy: z.enum(['contacts', 'close-friends', 'nobody']).optional(),
  readReceiptsEnabled: z.boolean().optional(),
  appLockEnabled: z.boolean().optional(),
  pin: z.string().length(4).optional(),
});

const statusAssetSchema = z.object({
  kind: z.enum(['image', 'video', 'document']),
  url: z.string().url(),
  caption: z.string().max(280).optional(),
});

const createStatusSchema = z.object({
  userId: z.string().min(1),
  text: z.string().max(280).default(''),
  assets: z.array(statusAssetSchema).max(10).default([]),
  backgroundColor: z.string().min(4).max(30).optional(),
  fontFamily: z.string().min(2).max(40).optional(),
  fontSize: z.number().int().min(16).max(64).optional(),
  audience: z.enum(['contacts', 'close-friends']).default('contacts'),
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

const createCatalogItemSchema = z.object({
  sellerId: z.string().min(1).optional(),
  title: z.string().min(2).max(120),
  price: z.number().positive(),
  currency: z.string().min(3).max(5).default('GHS'),
  category: z.string().min(2).max(40),
  description: z.string().min(2).max(400),
  imageUrls: z.array(z.string().url()).min(1).max(10),
  stockQuantity: z.number().int().nonnegative().default(0),
});

const updateCatalogItemSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  price: z.number().positive().optional(),
  currency: z.string().min(3).max(5).optional(),
  category: z.string().min(2).max(40).optional(),
  description: z.string().min(2).max(400).optional(),
  imageUrls: z.array(z.string().url()).min(1).max(10).optional(),
  stockQuantity: z.number().int().nonnegative().optional(),
});

const paymentIntentSchema = z.object({
  action: z.enum(['send', 'request', 'topup']),
  amount: z.number().positive(),
  currency: z.string().min(3).max(5).default('GHS'),
  phone: z.string().min(6).max(30).optional(),
  note: z.string().max(160).optional(),
  provider: z.enum(['mtn_momo', 'vodafone_cash', 'airteltigo']).default('mtn_momo'),
});

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
});

const authLoginSchema = z.object({
  deviceId: z.string().min(8).optional(),
  phone: z.string().min(7).max(30),
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
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const phoneSessionSchema = z.object({
  deviceId: optionalDeviceId,
  idToken: z.string().min(32),
  phone: z.string().min(6).max(30),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const completeRegistrationSchema = z.object({
  deviceId: optionalDeviceId,
  challengeId: z.string().min(6),
  name: z.string().min(2).max(80),
  countryCode: z.string().min(1).max(8),
  phoneNumber: z.string().min(4).max(20),
  pin: z.string().length(4).optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const phoneRegisterSchema = z.object({
  deviceId: optionalDeviceId,
  idToken: z.string().min(32),
  name: z.string().min(2).max(80),
  countryCode: z.string().min(1).max(8),
  phone: z.string().min(6).max(30),
  pin: z.string().length(4).optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const syncContactsSchema = z.object({
  userId: z.string().min(1),
  contacts: z.array(
    z.object({
      name: z.string().min(1).max(120),
      phone: z.string().min(4).max(30),
    }),
  ).max(2000),
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
  pin: z.string().length(4),
});

const ensureSessionSchema = z.object({
  deviceId: z.string().min(8).nullish(),
  preferredUserId: z.string().min(1).optional(),
  platform: z.string().min(2).max(40).default('unknown'),
  label: z.string().min(2).max(80).default('Primary device'),
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
      serverSelectionTimeoutMS: 5000,
    })
      .then((client) => {
        mongoConnectionState = 'connected';
        return client;
      })
      .catch((error: unknown) => {
        mongoConnectionState = 'failed';
        const message = error instanceof Error ? error.message : 'Unknown MongoDB error';
        console.error(`MongoDB connection failed: ${message}`);
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

const hashPin = (pin: string) =>
  crypto.createHash('sha256').update(`zynkup:${pin}`).digest('hex');

const hasFirebaseAdminCredentials = () =>
  Boolean(
    FIREBASE_SERVICE_ACCOUNT_JSON.trim()
    || (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_PROJECT_ID),
  );

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

  if (expectedPhone && sanitizePhone(verifiedPhone) !== sanitizePhone(expectedPhone)) {
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
      const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON) as admin.ServiceAccount;
      firebaseAdminApp = admin.apps.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: FIREBASE_PROJECT_ID || serviceAccount.projectId,
          });
      return firebaseAdminApp;
    }

    if (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_PROJECT_ID) {
      firebaseAdminApp = admin.apps.length
        ? admin.app()
        : admin.initializeApp({
            credential: admin.credential.cert({
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
      const decodedToken = await admin.auth(adminApp).verifyIdToken(idToken, true);
      const verifiedPhone = decodedToken.phone_number?.trim();
      if (!verifiedPhone) {
        throw new Error('Firebase token does not include a verified phone number.');
      }

      if (expectedPhone && sanitizePhone(verifiedPhone) !== sanitizePhone(expectedPhone)) {
        throw new Error('Firebase token phone number does not match the submitted number.');
      }

      return {
        uid: decodedToken.uid,
        phoneNumber: verifiedPhone,
      };
    } catch (error) {
      if (!FIREBASE_WEB_API_KEY) {
        throw error;
      }
      console.warn('Firebase Admin token verification failed, falling back to REST lookup.');
    }
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

const readUserByPhone = async (phone: string) => {
  const normalizedPhone = phone.replace(/[^\d+]/g, '');
  const users = await readUsers();
  return users.find((user) => user.phone.replace(/[^\d+]/g, '') === normalizedPhone) ?? null;
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

const canOpenAnotherSession = async (userId: string, deviceId?: string | null) => {
  if (!userId) {
    return true;
  }

  const sessions = await readSessionsByUserId(userId);
  const uniqueSessions = sessions.filter((session) => session.deviceId !== deviceId);
  return uniqueSessions.length < MAX_DEVICES_PER_USER;
};

const ensureSession = async (input: z.infer<typeof ensureSessionSchema>) => {
  const nowIso = new Date().toISOString();
  const users = await readUsers();
  const resolvedUserId = input.preferredUserId
    ? (users.find((user) => user.id === input.preferredUserId)?.id ?? '')
    : '';
  const deviceId = input.deviceId ?? crypto.randomUUID();

  const db = await getDb();
  if (!db) {
    const existing = seedSessions.find((session) => session.deviceId === deviceId);
    if (existing) {
      existing.userId = resolvedUserId;
      existing.platform = input.platform;
      existing.label = input.label;
      existing.lastSeenAt = nowIso;
      return existing;
    }

    const session: DeviceSession = {
      id: `session-${Date.now()}`,
      deviceId,
      userId: resolvedUserId,
      platform: input.platform,
      label: input.label,
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
    await collections.sessions.updateOne(
      { deviceId },
      {
        $set: {
          userId: resolvedUserId,
          platform: input.platform,
          label: input.label,
          lastSeenAt: nowIso,
        },
      },
    );
    return {
      ...existing,
      userId: resolvedUserId,
      platform: input.platform,
      label: input.label,
      lastSeenAt: nowIso,
    };
  }

  const session: DeviceSession = {
    id: `session-${Date.now()}`,
    deviceId,
    userId: resolvedUserId,
    platform: input.platform,
    label: input.label,
    createdAt: nowIso,
    lastSeenAt: nowIso,
  };
  await collections.sessions.insertOne(session);
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

const buildBootstrapPayload = async (session: DeviceSession | null = null): Promise<BootstrapPayload> => {
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

  const [profile, users, chats, messages, contacts, calls, statuses, catalogItems] = await Promise.all([
    readProfile(currentUserId),
    readUsers(),
    readChats(),
    readMessages(),
    readContacts(currentUserId),
    readCalls(),
    readStatuses(),
    readCatalogItems(),
  ]);
  const visibleChats = chats
    .filter((chat) => chat.participants.includes(currentUserId))
    .map((chat) => {
      if (chat.kind !== 'direct') {
        return chat;
      }

      const peerId = chat.participants.find((participantId) => participantId !== currentUserId);
      const peerUser = users.find((user) => user.id === peerId);
      return {
        ...chat,
        title: peerUser?.name ?? chat.title,
      };
    });
  const visibleChatIds = new Set(visibleChats.map((chat) => chat.id));
  const visibleMessages = messages.filter((message) => visibleChatIds.has(message.chatId));
  const visibleCalls = calls.filter((call) => call.participantIds.includes(currentUserId));
  const mergedContacts = contacts.map((contact) => {
    const linkedUser = users.find((user) => user.id === contact.linkedUserId);
    return {
      ...contact,
      registered: Boolean(linkedUser),
      presence: linkedUser?.presence ?? 'offline',
    };
  });

  return {
    authRequired: false,
    currentUserId,
    currentDeviceId: session?.deviceId ?? null,
    profile,
    users,
    chats: visibleChats,
    messagesByChat: buildMessagesByChat(visibleMessages),
    contacts: mergedContacts,
    calls: visibleCalls,
    statuses,
    updatesFeed: buildUpdateFeed(users, statuses),
    catalogItems,
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
  const normalizedPhone = phoneNumber.trim().startsWith('+')
    ? phoneNumber.trim().replace(/\s+/g, '')
    : normalizePhone(countryCode, phoneNumber);
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
  };

  const db = await getDb();
  if (!db) {
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
    const normalizedPhone = normalizePhone('', contact.phone).replace(/^\+/, '+');
    const linkedUser = users.find(
      (user) => user.phone.replace(/[^\d+]/g, '') === normalizedPhone.replace(/[^\d+]/g, ''),
    );

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

const createOrFindDirectChat = async (userId: string, peerUserId: string) => {
  const users = await readUsers();
  const peerUser = users.find((user) => user.id === peerUserId);
  if (!peerUser) {
    return null;
  }

  const participants = [userId, peerUserId].sort();
  const db = await getDb();
  if (!db) {
    const existing = seedChats.find(
      (chat) =>
        chat.kind === 'direct' &&
        [...chat.participants].sort().join(':') === participants.join(':'),
    );
    if (existing) {
      return existing;
    }

    const chat: Chat = {
      id: `c${Date.now()}`,
      title: peerUser.name,
      kind: 'direct',
      participants,
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
  const existing = chats.find(
    (chat) => [...chat.participants].sort().join(':') === participants.join(':'),
  );
  if (existing) {
    return existing;
  }

  const chat: Chat = {
    id: `c${Date.now()}`,
    title: peerUser.name,
    kind: 'direct',
    participants,
    unreadCount: 0,
    lastMessagePreview: 'Say hello',
    updatedAt: new Date().toISOString(),
  };
  await collections.chats.insertOne(chat);
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

const updateChatAfterMessage = async (chatId: string, preview: string, updatedAt: string) => {
  const db = await getDb();
  if (!db) {
    const fallbackChat = seedChats.find((item) => item.id === chatId);
    if (!fallbackChat) {
      return null;
    }
    fallbackChat.lastMessagePreview = preview;
    fallbackChat.updatedAt = updatedAt;
    return fallbackChat;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  await collections.chats.updateOne(
    { id: chatId },
    {
      $set: {
        lastMessagePreview: preview,
        updatedAt,
      },
    },
  );

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
  const db = await getDb();
  if (!db) {
    const user = seedUsers.find((item) => item.id === userId);
    if (!user) {
      return null;
    }
    user.presence = presence;
    return user;
  }

  await seedDatabaseIfNeeded();
  const collections = collectionsFor(db);
  await collections.users.updateOne({ id: userId }, { $set: { presence } });
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
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
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
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
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

app.post('/api/auth/phone/start', async (req, res) => {
  const parseResult = startPhoneAuthSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid phone auth payload',
      details: z.flattenError(parseResult.error),
    });
  }

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
    if (!(await canOpenAnotherSession(existingUser.id, parseResult.data.deviceId))) {
      return res.status(409).json({
        error: 'Device limit reached. Log out from one of your linked devices and try again.',
        code: 'DEVICE_LIMIT_REACHED',
        limit: MAX_DEVICES_PER_USER,
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

  if (!(await canOpenAnotherSession(existingUser.id, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
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

  const { user } = await createAuthIdentity(
    parseResult.data.name,
    parseResult.data.countryCode,
    parseResult.data.phoneNumber,
    parseResult.data.pin,
  );
  if (!(await canOpenAnotherSession(user.id, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
    });
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

  const existing = await readUserByPhone(verifiedIdentity.phoneNumber);
  if (existing) {
    return res.status(409).json({ error: 'A user with that phone already exists' });
  }

  const { user } = await createAuthIdentity(
    parseResult.data.name,
    parseResult.data.countryCode,
    verifiedIdentity.phoneNumber,
    parseResult.data.pin,
  );
  if (!(await canOpenAnotherSession(user.id, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
    });
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

  const user = await readUserByPhone(parseResult.data.phone);
  if (!user) {
    return res.status(404).json({ error: 'No account found for that phone number' });
  }

  if (!(await canOpenAnotherSession(user.id, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
    });
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

  const { user } = await createAuthIdentity(parseResult.data.name, '', parseResult.data.phone);
  if (!(await canOpenAnotherSession(user.id, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
    });
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

  if (!(await canOpenAnotherSession(parseResult.data.userId, parseResult.data.deviceId))) {
    return res.status(409).json({
      error: 'Device limit reached. Log out from one of your linked devices and try again.',
      code: 'DEVICE_LIMIT_REACHED',
      limit: MAX_DEVICES_PER_USER,
    });
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

  const syncedContacts = await syncDeviceContacts(parseResult.data.userId, parseResult.data.contacts);
  return res.status(201).json({
    contacts: syncedContacts.filter((contact) => contact.registered),
  });
});

app.get('/api/devices', async (req, res) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const devices = await readSessionsByUserId(userId);
  return res.json({
    devices: devices
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, MAX_DEVICES_PER_USER),
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
    reactions: [],
    comments: [],
    views: [],
    createdAt,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    audience: parseResult.data.audience,
  };

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

app.get('/api/catalog', async (_req, res) => {
  res.json({ catalogItems: await readCatalogItems() });
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
  const item: CatalogItem = {
    id: `p${Date.now()}`,
    sellerId: parseResult.data.sellerId ?? await resolveRequestUserId(req),
    title: parseResult.data.title,
    price: parseResult.data.price,
    currency: parseResult.data.currency,
    category: parseResult.data.category,
    description: parseResult.data.description,
    imageUrls: parseResult.data.imageUrls,
    stockQuantity: parseResult.data.stockQuantity ?? 0,
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

  const updated: CatalogItem = {
    ...existing,
    ...parseResult.data,
    updatedAt: new Date().toISOString(),
  };

  const db = await getDb();
  if (!db) {
    const index = seedCatalogItems.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      seedCatalogItems[index] = updated;
    }
  } else {
    await collectionsFor(db).catalogItems.updateOne({ id: updated.id }, { $set: updated });
  }

  io.emit('catalog:itemUpdated', updated);
  return res.json({ item: updated });
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

app.post('/api/calls', async (req, res) => {
  const parseResult = createCallSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid call payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const call: Call = {
    id: `call${Date.now()}`,
    participantIds: parseResult.data.participantIds,
    initiatorId: parseResult.data.initiatorId ?? parseResult.data.participantIds[0],
    kind: parseResult.data.kind,
    direction: parseResult.data.direction,
    state: 'ringing',
    startedAt: new Date().toISOString(),
    durationSeconds: 0,
  };

  await persistCall(call);
  io.emit('call:created', call);
  io.emit('call:incoming', call);

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
  return res.json({ call });
});

app.post('/api/chats', async (req, res) => {
  const parseResult = createChatSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid chat payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const chat = await createOrFindDirectChat(parseResult.data.userId, parseResult.data.peerUserId);
  if (!chat) {
    return res.status(404).json({ error: 'Peer user not found' });
  }

  io.emit('chat:created', chat);
  return res.status(201).json({ chat });
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

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
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
  };

  await persistMessage(message);
  const updatedChat = await updateChatAfterMessage(payload.chatId, payload.text, message.sentAt);

  io.emit('message:new', message);
  if (updatedChat) {
    io.emit('chat:updated', updatedChat);
  }

  return res.status(201).json({ message });
});

app.patch('/api/messages/:messageId/receipt', async (req, res) => {
  const parseResult = updateReceiptSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid receipt payload',
      details: z.flattenError(parseResult.error),
    });
  }

  const message = await updateMessageReceipt(req.params.messageId, parseResult.data.state);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }

  io.emit('message:receiptUpdated', message);
  return res.json({ message });
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

  socket.on('typing:update', ({ chatId, userId, typing }) => {
    socket.to(chatId).emit('typing:update', { chatId, userId, typing });
  });

  socket.on('presence:update', ({ userId, presence }: { userId: string; presence: Presence }) => {
    void (async () => {
      const user = await updatePresence(userId, presence);
      if (!user) {
        return;
      }
      io.emit('presence:changed', { userId, presence });
    })();
  });

  socket.on('call:join', ({ callId, userId }: { callId: string; userId: string }) => {
    socket.join(callId);
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
      if (toUserId) {
        socket.to(callId).emit('call:signal', { callId, fromUserId, toUserId, signalType, payload });
        return;
      }

      socket.to(callId).emit('call:signal', { callId, fromUserId, signalType, payload });
    },
  );
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const startServer = async () => {
  await getMongoClient();
  await seedDatabaseIfNeeded();

  server.listen(port, host, () => {
    console.log(`Running on http://${host}:${port}`);
    console.log(
      mongoConnectionState === 'connected'
        ? 'Connected to MongoDB'
        : mongoUri
          ? 'MongoDB configured but using in-memory fallback'
          : 'MongoDB not configured, using in-memory fallback',
    );
    console.log(`Media storage: ${MEDIA_STORAGE_MODE}${MEDIA_STORAGE_MODE === 'gcs' ? ` (bucket=${GCS_BUCKET || 'unset'})` : ''}`);
    console.log(`Socket.IO running on port ${port}`);
  });
};

void startServer();
