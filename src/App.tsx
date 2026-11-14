import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import './App.css';

type View = 'chats' | 'calls' | 'catalog' | 'settings' | 'updates';
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
  createdAt: string;
  updatedAt: string;
};

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
};

type CustomerPreference = {
  customerId: string;
  sellerUserId: string;
  businessId?: string | null;
  marketingConsent: MarketingConsent;
  marketingConsentUpdatedAt?: string | null;
  displayNameOnSellerSide?: string;
};

type BusinessHubTab = 'catalog' | 'dashboard' | 'orders' | 'receipts' | 'inventory' | 'customers';

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
  { id: 'business', title: 'Business tools', subtitle: 'Catalog, customers, sales, orders, and inventory' },
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
  };
};

const mapServerMessage = (message: any, userId: string): Message => ({
  id: message.id,
  clientRef: message.clientRef,
  sender: message.senderId === userId ? 'me' : 'other',
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
  const [favoriteChatIds, setFavoriteChatIds] = useState<string[]>([]);
  const [mutedChatIds, setMutedChatIds] = useState<string[]>([]);
  const [archivedChatIds, setArchivedChatIds] = useState<string[]>([]);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [messageActionTarget, setMessageActionTarget] = useState<Message | null>(null);
  const [peerTypingByChat, setPeerTypingByChat] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState('');
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
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
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
  const [chatItems, setChatItems] = useState<Chat[]>(initialChats);
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

  const sendMessage = () => {
    if (!messageDraft.trim() || !activeChat) {
      return;
    }

    const optimistic: Message = {
      id: `local-${Date.now()}`,
      clientRef: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'me',
      kind: 'text',
      text: messageDraft.trim(),
      time: 'Now',
      receiptState: 'sent',
      replyToMessageId: replyTarget?.id,
      replyPreview: replyTarget?.text?.slice(0, 140),
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimistic],
    }));
    emitTyping(false);
    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: activeChat.id,
        senderId: currentUserId,
        clientRef: optimistic.clientRef,
        kind: 'text',
        text: messageDraft.trim(),
        mediaUrls: [],
        replyToMessageId: replyTarget?.id,
        replyPreview: replyTarget?.text?.slice(0, 140),
      }),
    }).catch(() => undefined);
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
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, state }),
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
    const message: Message = {
      id: `m${Date.now()}`,
      clientRef,
      sender: 'me',
      kind: file.type.startsWith('image/') ? 'image' : 'file',
      text: file.name,
      time: 'Now',
      imageUrl: file.type.startsWith('image/') ? objectUrl : undefined,
      receiptState: 'sent',
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), message],
    }));
    event.target.value = '';
    const uploadedUrls = await uploadFiles([file]).catch(() => []);

    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: activeChat.id,
        senderId: currentUserId,
        clientRef,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        text: file.name,
        mediaUrls: uploadedUrls.length ? uploadedUrls : [objectUrl],
      }),
    }).catch(() => undefined);
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
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: [
            ...(current[activeChat.id] ?? []),
            {
              id: `m${Date.now()}`,
              clientRef,
              sender: 'me',
              kind: 'voice',
              text: 'Voice note',
              time: 'Now',
              audioUrl,
              durationLabel: formatDurationLabel(durationSeconds),
              receiptState: 'sent',
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
                chatId: activeChat.id,
                senderId: currentUserId,
                clientRef,
                kind: 'voice',
                text: 'Voice note',
                mediaUrls: uploadedUrls.length ? uploadedUrls : [audioUrl],
                durationSeconds,
              }),
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

  const renderComposerControls = () => {
    if (messageDraft.trim()) {
      return (
        <button className="send-button" onClick={sendMessage} type="button">
          Send
        </button>
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
              onClick={() => {
                const action = window.prompt('1 Mute  2 Archive  3 Pin', '1');
                if (action === '1') {
                  toggleMuteChat(activeChat.id);
                } else if (action === '2') {
                  toggleArchiveChat(activeChat.id);
                } else if (action === '3') {
                  toggleFavoriteChat(activeChat.id);
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

        <section className="desktop-canvas">
          {messages.map((message) => (
            message.kind === 'call' ? (
              <button
                className={`call-thread ${describeCallMessage(message).alert ? 'missed' : ''}`}
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
              className={`message-bubble ${message.sender === 'me' ? 'mine' : 'theirs'} ${message.deletedForEveryone ? 'deleted' : ''}`}
              key={message.id}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!message.deletedForEveryone) {
                  setMessageActionTarget(message);
                }
              }}
            >
              {message.replyPreview ? <div className="reply-quote">{message.replyPreview}</div> : null}
              {message.kind === 'image' && message.imageUrl ? (
                <button className="message-image-button" onClick={() => setMediaViewer(message.imageUrl ?? null)} type="button">
                  <img alt={message.text} className="message-image" src={message.imageUrl} />
                </button>
              ) : null}

              {message.kind === 'voice' ? (
                <div className="voice-note">
                  {message.audioUrl ? <audio controls src={message.audioUrl} /> : <span>Voice note {message.durationLabel}</span>}
                </div>
              ) : null}

              {message.kind !== 'voice' ? <p>{message.text}</p> : null}
              <div className="message-meta">
                <span>{message.time}</span>
                {appSettings.readReceiptsEnabled ? renderReceipt(message) : null}
              </div>
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

        <footer className="composer desktop-composer">
          <textarea
            aria-label="Message composer"
            onChange={(event) => {
              setMessageDraft(event.target.value);
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
      ];
      const consentLabel = (consent: MarketingConsent) =>
        consent === 'opted_in' ? 'Opted in' : consent === 'opted_out' ? 'Opted out' : 'Unknown';
      const isFollowUpDue = (followUpAt?: string | null) =>
        Boolean(followUpAt && new Date(followUpAt).getTime() <= Date.now());
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
          <button className={`rail-button ${activeView === 'catalog' ? 'active' : ''}`} onClick={() => setActiveView('catalog')} type="button">🏬</button>
          <button className={`rail-button ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')} type="button">⚙</button>
        </div>
        <button className="rail-button rail-bottom" onClick={() => setActiveView('settings')} type="button">⚙</button>
      </aside>

      {activeView === 'chats' ? renderChatsView() : null}
      {activeView === 'calls' ? renderCallsView() : null}
      {activeView === 'updates' ? renderUpdatesView() : null}
      {activeView === 'catalog' ? renderCatalogView() : null}
      {activeView === 'settings' ? renderSettingsView() : null}

      {toastMessage ? <div className="web-toast">{toastMessage}</div> : null}

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
