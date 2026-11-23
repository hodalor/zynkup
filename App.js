import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  createSound,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';
import Video from 'react-native-video';
import { countries } from 'countries-list';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ImageBackground,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TextInput,
  View,
  AppState,
  BackHandler,
  Dimensions,
  Keyboard,
  NativeModules,
  PanResponder,
  Vibration,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import { firebaseAuth, firebaseConfigReady, nativeFirebaseReady } from './firebaseConfig';

const brandSplashLogo = require('./assets/brand/splash-logo.png');
const brandSplashCity = require('./assets/brand/splash-start.jpg');
const brandMark = require('./assets/brand/logo-mark.png');
const brandWordmark = require('./assets/brand/wordmark.png');
const brandLockup = require('./assets/brand/logo-lockup.png');
const brandGradient = require('./assets/brand/button-gradient.png');

const loadOptionalModule = (request) => {
  try {
    return request();
  } catch {
    return null;
  }
};

const cameraKitModule = loadOptionalModule(() => require('react-native-camera-kit'));
const CameraKit = cameraKitModule?.default ?? cameraKitModule ?? null;
const Camera = cameraKitModule?.Camera ?? null;
const Contacts = loadOptionalModule(() => require('react-native-contacts'))?.default
  ?? loadOptionalModule(() => require('react-native-contacts'));
const documentPickerModule = loadOptionalModule(() => require('@react-native-documents/picker'));
const DocumentPickerErrorCodes = documentPickerModule?.errorCodes ?? {};
const isDocumentPickerErrorWithCode = documentPickerModule?.isErrorWithCode ?? (() => false);
const pickDocument = documentPickerModule?.pick ?? null;
const keepLocalDocumentCopy = documentPickerModule?.keepLocalCopy ?? null;
const DocumentPickerTypes = documentPickerModule?.types ?? {};
const launchImageLibrary = loadOptionalModule(() => require('react-native-image-picker'))?.launchImageLibrary
  ?? null;
const Geolocation = loadOptionalModule(() => require('@react-native-community/geolocation'))?.default
  ?? loadOptionalModule(() => require('@react-native-community/geolocation'));
// Not autolinked in the current Android PackageList; keep disabled until linked.
const Tts = null;

const safeTtsStop = () => {
  try {
    Tts?.stop?.();
  } catch {
    // Native TTS module is unavailable in this build.
  }
};

const safeTtsSpeak = (...args) => {
  try {
    Tts?.speak?.(...args);
  } catch {
    // Native TTS module is unavailable in this build.
  }
};

const BODY_FONT_FAMILY = Platform.select({
  android: 'sans-serif',
  ios: 'System',
  default: undefined,
});

const DISPLAY_FONT_FAMILY = Platform.select({
  android: 'sans-serif-medium',
  ios: 'System',
  default: BODY_FONT_FAMILY,
});

if (BODY_FONT_FAMILY) {
  const existingTextStyle = Text.defaultProps?.style;
  Text.defaultProps = Text.defaultProps || {};
  Text.defaultProps.style = existingTextStyle
    ? [{ fontFamily: BODY_FONT_FAMILY }, existingTextStyle]
    : { fontFamily: BODY_FONT_FAMILY };

  const existingInputStyle = TextInput.defaultProps?.style;
  TextInput.defaultProps = TextInput.defaultProps || {};
  TextInput.defaultProps.style = existingInputStyle
    ? [{ fontFamily: BODY_FONT_FAMILY }, existingInputStyle]
    : { fontFamily: BODY_FONT_FAMILY };
}

let webRtcModule = null;
try {
  // Expo Go does not include this native module, so load it lazily.
  webRtcModule = require('react-native-webrtc');
} catch {
  webRtcModule = null;
}

const mediaDevices = webRtcModule?.mediaDevices ?? null;
const RTCPeerConnectionNative = webRtcModule?.RTCPeerConnection ?? null;
const RTCIceCandidateNative = webRtcModule?.RTCIceCandidate ?? null;
const RTCSessionDescriptionNative = webRtcModule?.RTCSessionDescription ?? null;
const RTCViewNative = webRtcModule?.RTCView ?? null;
const CAN_USE_NATIVE_WEBRTC = Boolean(
  mediaDevices &&
  RTCPeerConnectionNative &&
  RTCIceCandidateNative &&
  RTCSessionDescriptionNative &&
  RTCViewNative,
);

const AnimatedText = Animated.createAnimatedComponent(Text);
const tabs = ['Chats', 'Explore', 'Pay', 'Business', 'Profile'];
const SETTINGS_STORAGE_KEY = 'zynkup-mobile-app-settings';
const FAVORITES_STORAGE_KEY = 'zynkup-mobile-favorite-chats';
const MUTED_CHATS_STORAGE_KEY = 'zynkup-mobile-muted-chats';
const ARCHIVED_CHATS_STORAGE_KEY = 'zynkup-mobile-archived-chats';
const LOCKED_CHATS_STORAGE_KEY = 'zynkup-mobile-locked-chats';
const APP_LOCK_PIN_KEY = 'zynkup-mobile-app-lock-pin';
const DISMISSED_CARDS_KEY = 'zynkup-mobile-dismissed-cards';
const ACCOUNT_STORAGE_KEY = 'zynkup-mobile-account';
const OUTBOX_STORAGE_KEY = 'zynkup-mobile-outbox';
const SEEN_STATUS_KEY = 'zynkup-seen-statuses';
const WALLPAPER_KEY = 'zynkup-chat-wallpaper';
const STATUS_TEXT_LIMIT = 700;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_APP_SETTINGS = {
  enterIsSend: true,
  mediaAutoDownload: true,
  messageNotifications: true,
  showNotificationPreview: true,
  conversationTones: true,
  saveToCameraRoll: false,
  lowDataMode: false,
  lastSeenPrivacy: 'everyone',
  profilePhotoPrivacy: 'everyone',
  aboutPrivacy: 'everyone',
  statusPrivacy: 'contacts',
  typingPrivacy: 'everyone',
  callPrivacy: 'everyone',
  groupInvitePrivacy: 'everyone',
  readReceiptsEnabled: true,
  appLockEnabled: false,
  pinDisabled: false,
};
const SETTINGS_MENU = [
  { id: 'favorites', title: 'Favorites', subtitle: 'Pin important chats to the top', icon: '★' },
  { id: 'business', title: 'Business tools', subtitle: 'Catalog, quotes, customers, broadcast', icon: '⌂' },
  { id: 'history', title: 'Chat history', subtitle: 'Export or clear conversations', icon: '▤' },
  { id: 'account', title: 'Account', subtitle: 'Security, phone number, delete account', icon: '◎' },
  { id: 'privacy', title: 'Privacy', subtitle: 'Last seen, lock, block, disappearing', icon: '◌' },
  { id: 'chats', title: 'Chats', subtitle: 'Theme, media, enter is send', icon: '◫' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Message alerts and previews', icon: '◉' },
  { id: 'storage', title: 'Storage and data', subtitle: 'Network usage and cache', icon: '▦' },
  { id: 'help', title: 'Help and feedback', subtitle: 'FAQ and contact support', icon: '?' },
];
const emojiOptions = ['😀', '😂', '🤣', '😍', '🔥', '🙏', '🎉', '❤️'];
const tabBadges = {
  Chats: 0,
  Explore: 0,
  Pay: 0,
  Business: 0,
  Profile: 0,
};
const statusBackgroundOptions = ['#10233e', '#1f2937', '#14532d', '#7c2d12', '#581c87'];
const statusFontOptions = ['System', 'serif', 'monospace'];
const statusReactionOptions = ['❤️', '👍', '👎', '🔥', '😂'];
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const LAUGHING_EMOJIS = new Set(['😂', '🤣', '😆', '😄', '😹']);
const API_BASE_URL = 'https://zynkup-api-597625475865.europe-west9.run.app';
const DEVICE_STORAGE_KEY = 'zynkup-mobile-device-id';
const statusStillLive = (item) => {
  if (!item || item.takenDown) return false;
  if (item.audience === 'marketplace') return true;
  const created = item.createdAt ? new Date(item.createdAt).getTime() : 0;
  const expiry = item.expiresAt ? new Date(item.expiresAt).getTime() : created + 24 * 60 * 60 * 1000;
  return Number.isFinite(expiry) && expiry > Date.now();
};
const PHONE_LINK_PATTERN = /(\+?\d[\d\s()-]{7,}\d)/g;
const PRODUCT_CATEGORIES = ['All', 'Phones', 'Fashion', 'Food', 'Beauty', 'Home', 'Electronics', 'Vehicles', 'Services', 'Other'];
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const BOOTSTRAP_TIMEOUT_MS = 5000;
const CueSound = NativeModules.CueSound;
const WEBRTC_CONFIGURATION = {
  iceCandidatePoolSize: 4,
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.relay.metered.ca:80'] },
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp',
      ],
      username: 'f6507426c0f4f89d0bda02e2',
      credential: '7YF0907XexAfvkbL',
    },
  ],
};
const CUE_SOUNDS = {
  send: 'file:///android_asset/sounds/send.wav',
  receive: 'file:///android_asset/sounds/receive.wav',
  ringback: 'file:///android_asset/sounds/ringback.wav',
  ringtone: 'file:///android_asset/sounds/ringtone.wav',
};

const COUNTRY_OPTIONS = Object.entries(countries)
  .flatMap(([code, country]) =>
    (country.phone ?? []).map((phoneCode) => ({
      code,
      name: country.name,
      dialCode: `+${phoneCode}`,
      flag: country.emoji ?? code,
      currency: country.currency?.[0] || 'USD',
    })),
  )
  .sort((left, right) => left.name.localeCompare(right.name));

const countryForPhone = (phone) => {
  const normalized = String(phone || '');
  return [...COUNTRY_OPTIONS]
    .sort((left, right) => right.dialCode.length - left.dialCode.length)
    .find((country) => normalized.startsWith(country.dialCode)) ?? null;
};

const currencyForPhone = (phone, countryCode) =>
  COUNTRY_OPTIONS.find((country) => country.dialCode === countryCode)?.currency
  || countryForPhone(phone)?.currency
  || 'USD';

const splitStoredPhone = (phone) => {
  const match = countryForPhone(phone);
  if (!match) {
    return { countryCode: '+233', phone: String(phone || '').replace(/^\+/, '') };
  }
  let national = String(phone).slice(match.dialCode.length);
  if (national && !national.startsWith('0')) {
    national = `0${national}`;
  }
  return { countryCode: match.dialCode, phone: national };
};

const readRememberedAccount = async () => {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeRememberedAccount = async (account) => {
  const current = (await readRememberedAccount()) ?? {};
  const next = {
    ...current,
    ...account,
    lastActiveAt: account.lastActiveAt ?? current.lastActiveAt ?? Date.now(),
  };
  await AsyncStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(next));
  return next;
};

const chats = [];
const contacts = [];
const initialStatuses = [];
const initialCalls = [];
const initialCatalogItems = [];
const initialMessages = {};

const normalizeAuthPhone = (countryCode, phoneNumber) => {
  const cc = (countryCode.startsWith('+') ? countryCode : `+${countryCode}`).replace(/[^\d+]/g, '');
  let digits = phoneNumber.replace(/[^\d]/g, '');

  // Users often type a national trunk prefix (e.g. Ghana 024...), which must not
  // sit after the country code in E.164 (+233024... is invalid).
  if (cc.length > 1 && digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  }

  // If the field already includes the country dial code, avoid doubling it.
  const ccDigits = cc.replace(/\D/g, '');
  if (ccDigits && digits.startsWith(ccDigits)) {
    digits = digits.slice(ccDigits.length);
  }

  return `${cc}${digits}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const deriveAuthUsername = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24);

const openImageLibrary = async ({ mediaType = 'photo', selectionLimit = 1 } = {}) => {
  if (!launchImageLibrary) {
    return {
      didCancel: true,
      errorCode: 'module_unavailable',
      errorMessage: 'Image picker is not available in this build.',
    };
  }

  return launchImageLibrary({
    mediaType,
    quality: 1,
    selectionLimit,
    includeBase64: false,
  });
};

const extractEmojiTokens = (text) => text.match(EMOJI_REGEX) ?? [];

const isEmojiOnlyMessage = (text) => {
  const emojis = extractEmojiTokens(text);
  if (!emojis.length) {
    return false;
  }

  const stripped = text.replace(EMOJI_REGEX, '').replace(/\uFE0F/g, '').trim();
  return stripped.length === 0;
};

const getAudioDurationLabel = (milliseconds) => {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const formatPlaybackClock = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds) || 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const formatCallStamp = (value) => {
  if (!value) {
    return '';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const time = parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (parsed.toDateString() === new Date().toDateString()) {
    return time;
  }
  return `${parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

const formatClock = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const inferMimeType = (uri, fallback = 'application/octet-stream') => {
  const lower = String(uri).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.m4a')) return 'audio/m4a';
  if (lower.endsWith('.caf')) return 'audio/x-caf';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
};

const VOICE_RECORDER_AUDIO_SET = {
  AudioChannels: 1,
  AudioSamplingRate: 44100,
  AudioEncodingBitRate: 128000,
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
  AVNumberOfChannelsKeyIOS: 1,
  AVSampleRateKeyIOS: 44100,
};

const TRANSLATE_TARGET_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'tw', label: 'Twi' },
  { code: 'ga', label: 'Ga' },
  { code: 'ee', label: 'Ewe' },
  { code: 'pcm', label: 'Pidgin' },
];

const fetchWithTimeout = async (url, options = {}, timeoutMs = BOOTSTRAP_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

function SwipeReply({ enabled, onReply, children }) {
  const enabledRef = useRef(enabled);
  const replyRef = useRef(onReply);
  const [offset, setOffset] = useState(0);
  enabledRef.current = enabled;
  replyRef.current = onReply;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Boolean(enabledRef.current) && gesture.dx > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) + 6,
    onPanResponderMove: (_event, gesture) => setOffset(Math.max(0, Math.min(76, gesture.dx))),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx > 52) replyRef.current();
      setOffset(0);
    },
    onPanResponderTerminate: () => setOffset(0),
  })).current;

  return (
    <View {...pan.panHandlers}>
      <View style={{ transform: [{ translateX: offset }] }}>
        {offset > 18 ? <Text style={{ position: 'absolute', left: -22, top: 14, color: '#128C7E', fontSize: 18 }}>↩</Text> : null}
        {children}
      </View>
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const navBottomInset = Math.max(insets.bottom, 12);
  const authBottomInset = Math.max(insets.bottom + 18, 30);
  const modalBottomInset = Math.max(insets.bottom + 20, 28);
  const lightContentBottomInset = 12;
  const [activeView, setActiveView] = useState('Chats');
  const [chatMode, setChatMode] = useState('personal');
  const [businesses, setBusinesses] = useState([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [identitySheetVisible, setIdentitySheetVisible] = useState(false);
  const [businessDraft, setBusinessDraft] = useState({
    name: '',
    description: '',
    location: '',
    hours: '',
    contactButtonLabel: 'Chat',
    showPhone: false,
    logoUrl: '',
    verificationNote: '',
  });
  const [publicBusinessView, setPublicBusinessView] = useState(null);
  const [publicBusinessCatalog, setPublicBusinessCatalog] = useState([]);
  const [businessReportDraft, setBusinessReportDraft] = useState('');
  const [staffDraft, setStaffDraft] = useState({ phone: '', role: 'sales' });
  const [dismissedCards, setDismissedCards] = useState([]);
  const identityDraftsRef = useRef({});
  const [chatScreen, setChatScreen] = useState('list');
  const [selectedChatId, setSelectedChatId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [usersById, setUsersById] = useState({});
  const [chatItems, setChatItems] = useState(chats);
  const [contactItems, setContactItems] = useState(contacts);
  const [messageDraft, setMessageDraft] = useState('');
  const [anonymousCompose, setAnonymousCompose] = useState(false);
  const [groupInfoVisible, setGroupInfoVisible] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [messagesByChat, setMessagesByChat] = useState(initialMessages);
  const [calls, setCalls] = useState(initialCalls);
  const [, setStatuses] = useState(initialStatuses);
  const [catalogItems, setCatalogItems] = useState(initialCatalogItems);
  const [profile, setProfile] = useState({
    name: '',
    username: '',
    about: '',
    phone: '',
    countryCode: '',
    currency: '',
    photoUri: '',
    profileVideoUri: '',
    profileVideoPosterUri: '',
    profileVideoDurationSeconds: 0,
    blockedUserIds: [],
  });
  const [settingsPanel, setSettingsPanel] = useState('');
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [favoriteChatIds, setFavoriteChatIds] = useState([]);
  const [mutedChatIds, setMutedChatIds] = useState([]);
  const [archivedChatIds, setArchivedChatIds] = useState([]);
  const [lockedChatIds, setLockedChatIds] = useState([]);
  const [unlockChatId, setUnlockChatId] = useState('');
  const [unlockPin, setUnlockPin] = useState('');
  const lockedChatIdsRef = useRef([]);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [messageActionTarget, setMessageActionTarget] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [aiRewriteVariants, setAiRewriteVariants] = useState([]);
  const [aiRewriteTone, setAiRewriteTone] = useState('polite');
  const [aiAssistBusy, setAiAssistBusy] = useState(false);
  const [aiHelperSheetVisible, setAiHelperSheetVisible] = useState(false);
  const [aiHelperTask, setAiHelperTask] = useState('draft');
  const [aiHelperPrompt, setAiHelperPrompt] = useState('');
  const [aiHelperConsent, setAiHelperConsent] = useState(false);
  const [aiHelperTargetLang, setAiHelperTargetLang] = useState('en');
  const [aiHelperBusy, setAiHelperBusy] = useState(false);
  const [aiHelperPayload, setAiHelperPayload] = useState(null);
  const [messageTranslations, setMessageTranslations] = useState({});
  const [translateBusyId, setTranslateBusyId] = useState('');
  const [translatePickerId, setTranslatePickerId] = useState('');
  const [transcribeBusyId, setTranscribeBusyId] = useState('');
  const [summarySheetVisible, setSummarySheetVisible] = useState(false);
  const [summaryScope, setSummaryScope] = useState('unread');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryResult, setSummaryResult] = useState(null);
  const [dictateSheetVisible, setDictateSheetVisible] = useState(false);
  const [dictateDraft, setDictateDraft] = useState('');
  const [dictateBusy, setDictateBusy] = useState(false);
  const [scamWarningBanner, setScamWarningBanner] = useState(null);
  const [orderDeliveryDraft, setOrderDeliveryDraft] = useState({
    deliveryReference: '',
    fulfilmentNote: '',
  });
  const [peerTypingByChat, setPeerTypingByChat] = useState({});
  const [chatCameraVisible, setChatCameraVisible] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [accountPinDraft, setAccountPinDraft] = useState('');
  const [appLockPin, setAppLockPin] = useState('');
  const [appUnlocked, setAppUnlocked] = useState(true);
  const [unlockPinDraft, setUnlockPinDraft] = useState('');
  const chatCameraRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const mutedChatIdsRef = useRef([]);
  const [catalogForm, setCatalogForm] = useState({
    title: '',
    price: '',
    category: 'Phones',
    description: '',
    stockQuantity: '1',
    costPrice: '',
    lowStockThreshold: '2',
    location: '',
    condition: 'New',
    status: 'active',
    trackStock: true,
    variantName: '',
    variantOptions: '',
  });
  const [inventoryAlerts, setInventoryAlerts] = useState([]);
  const [businessCustomers, setBusinessCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerOrders, setCustomerOrders] = useState([]);
  const [customerForm, setCustomerForm] = useState({
    displayName: '',
    phone: '',
    tags: '',
    note: '',
    followUpAt: '',
  });
  const [customerNoteDraft, setCustomerNoteDraft] = useState('');
  const [customerPrefs, setCustomerPrefs] = useState([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('All');
  const [catalogStatusFilter, setCatalogStatusFilter] = useState('All');
  const [marketCategory, setMarketCategory] = useState('All');
  const [marketPrice, setMarketPrice] = useState('Any');
  const [marketRegion, setMarketRegion] = useState('All');
  const [productDetail, setProductDetail] = useState(null);
  const [productImageIndex, setProductImageIndex] = useState(0);
  const [phonePrompt, setPhonePrompt] = useState(null);
  const [newChatNumber, setNewChatNumber] = useState('');
  const [appNotice, setAppNotice] = useState('');
  const [statusAssetUris, setStatusAssetUris] = useState([]);
  const [catalogImageUris, setCatalogImageUris] = useState([]);
  const [updatesFeed, setUpdatesFeed] = useState([]);
  const [statusComposerVisible, setStatusComposerVisible] = useState(false);
  const [statusComposerMode, setStatusComposerMode] = useState('text'); // text | photo | video
  const [statusTaggedProductId, setStatusTaggedProductId] = useState('');
  const [statusProductSheet, setStatusProductSheet] = useState(null);
  const [statusProductSeller, setStatusProductSeller] = useState(null);
  const [statusOrderQuantity, setStatusOrderQuantity] = useState('1');
  const [statusVariantPicks, setStatusVariantPicks] = useState({});
  const [businessPanel, setBusinessPanel] = useState(''); // '' | catalog | customers | receipts | broadcast | documents | orders | profile | dashboard | inventory | autoreplies | businessai
  const [autoReplyConfig, setAutoReplyConfig] = useState(null);
  const [autoReplyLogs, setAutoReplyLogs] = useState([]);
  const [autoReplyRuleDraft, setAutoReplyRuleDraft] = useState({ keywords: '', response: '' });
  const [businessAiConfig, setBusinessAiConfig] = useState(null);
  const [businessAiFaqDraft, setBusinessAiFaqDraft] = useState({ question: '', answer: '' });
  const [businessAiAskDraft, setBusinessAiAskDraft] = useState('');
  const [businessAiAskResult, setBusinessAiAskResult] = useState(null);
  const [businessAiBusy, setBusinessAiBusy] = useState(false);
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [broadcastSegment, setBroadcastSegment] = useState('opted_in');
  const [broadcastCampaigns, setBroadcastCampaigns] = useState([]);
  const [broadcastAudiencePreview, setBroadcastAudiencePreview] = useState({
    opted_in: 0,
    repeat_buyers: 0,
    all_customers: 0,
  });
  const [commerceDocuments, setCommerceDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [documentKindFilter, setDocumentKindFilter] = useState('all');
  const [documentForm, setDocumentForm] = useState({
    kind: 'quotation',
    customerName: '',
    customerPhone: '',
    lineTitle: '',
    lineQty: '1',
    linePrice: '',
    discountAmount: '',
    taxAmount: '',
    notes: '',
    expiresAt: '',
    dueAt: '',
  });
  const [commerceOrders, setCommerceOrders] = useState([]);
  const [saleReceipts, setSaleReceipts] = useState([]);
  const [orderDetail, setOrderDetail] = useState(null);
  const [receiptDetail, setReceiptDetail] = useState(null);
  const [orderRoleFilter, setOrderRoleFilter] = useState('seller'); // seller | buyer | all
  const [salesDashboard, setSalesDashboard] = useState(null);
  const [salesDashboardPeriod, setSalesDashboardPeriod] = useState('7d');
  const [paySheet, setPaySheet] = useState(''); // '' | send | request | topup | history | orders
  const [payForm, setPayForm] = useState({ amount: '', phone: '', note: '' });
  const [payHistoryItems, setPayHistoryItems] = useState([]);
  const [newChatQuery, setNewChatQuery] = useState('');
  const [statusBackgroundColor, setStatusBackgroundColor] = useState(statusBackgroundOptions[0]);
  const [statusFontFamily, setStatusFontFamily] = useState(statusFontOptions[0]);
  const [statusFontSize, setStatusFontSize] = useState(30);
  const [sheetStep, setSheetStep] = useState('closed');
  const [attachmentType, setAttachmentType] = useState('image');
  const [emojiPlayback, setEmojiPlayback] = useState(null);
  const [emojiTrayVisible, setEmojiTrayVisible] = useState(false);
  const [mediaViewer, setMediaViewer] = useState(null);
  const [callSheetVisible, setCallSheetVisible] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [activeCallSeconds, setActiveCallSeconds] = useState(0);
  const [localCallStream, setLocalCallStream] = useState(null);
  const [remoteCallStream, setRemoteCallStream] = useState(null);
  const [callError, setCallError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingLabel, setRecordingLabel] = useState('');
  const [voiceDraft, setVoiceDraft] = useState(null);
  const [voicePlayback, setVoicePlayback] = useState({ messageId: '', positionMs: 0, durationMs: 0, playing: false });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [chatMenuVisible, setChatMenuVisible] = useState(false);
  const [peerProfileVisible, setPeerProfileVisible] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [localVideoLarge, setLocalVideoLarge] = useState(false);
  const [callPhase, setCallPhase] = useState('calling');
  const [callMinimized, setCallMinimized] = useState(false);
  const [callMuted, setCallMuted] = useState(false);
  const [callSpeakerOn, setCallSpeakerOn] = useState(false);
  const callSpeakerOnRef = useRef(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  const [remoteCameraOff, setRemoteCameraOff] = useState(false);
  const [callControlsVisible, setCallControlsVisible] = useState(true);
  const [callInviteVisible, setCallInviteVisible] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 210, y: 120 });
  const [seenStatusIds, setSeenStatusIds] = useState([]);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatWallpaper, setChatWallpaper] = useState('zynkup');
  const [roomPicking, setRoomPicking] = useState(false);
  const [roomSelection, setRoomSelection] = useState([]);
  const [roomTitle, setRoomTitle] = useState('');
  const [statusAudience, setStatusAudience] = useState('contacts');
  const [statusTab, setStatusTab] = useState('contacts');
  const [chatListTab, setChatListTab] = useState('recent');
  const [exploreSection, setExploreSection] = useState('status');
  const [communitiesMine, setCommunitiesMine] = useState([]);
  const [communitiesDiscover, setCommunitiesDiscover] = useState([]);
  const [communityEvents, setCommunityEvents] = useState([]);
  const [gameCatalog, setGameCatalog] = useState([]);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [exploreReload, setExploreReload] = useState(0);
  const [communityName, setCommunityName] = useState('');
  const [aiToneMenuVisible, setAiToneMenuVisible] = useState(false);
  const [chatRequests, setChatRequests] = useState([]);
  const [mutualUserIds, setMutualUserIds] = useState([]);
  const mutualUserIdsRef = useRef([]);
  const [mutualPrivacyReady, setMutualPrivacyReady] = useState(false);
  const [chatActionChat, setChatActionChat] = useState(null);
  const [phoneLocked, setPhoneLocked] = useState(AppState.currentState !== 'active');
  const [statusToolsOpen, setStatusToolsOpen] = useState(false);
  const [cartItems, setCartItems] = useState([]);
  const [activeStatusGroupIndex, setActiveStatusGroupIndex] = useState(null);
  const [activeStatusItemIndex, setActiveStatusItemIndex] = useState(0);
  const [statusProgress, setStatusProgress] = useState(0);
  const [statusElapsedMs, setStatusElapsedMs] = useState(0);
  const [statusCommentDraft, setStatusCommentDraft] = useState('');
  const [statusViewersVisible, setStatusViewersVisible] = useState(false);
  const [statusViewers, setStatusViewers] = useState([]);
  const [statusReactorsVisible, setStatusReactorsVisible] = useState(false);
  const [statusReactors, setStatusReactors] = useState([]);
  const [statusThreadVisible, setStatusThreadVisible] = useState(false);
  const [statusReplyVisible, setStatusReplyVisible] = useState(false);
  const [statusHoldActive, setStatusHoldActive] = useState(false);
  const [editingStatusCommentId, setEditingStatusCommentId] = useState(null);
  const [editingStatusCommentText, setEditingStatusCommentText] = useState('');
  const [newChatVisible, setNewChatVisible] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [authMode, setAuthMode] = useState('welcome');
  const [authPendingAction, setAuthPendingAction] = useState('');
  const [toastState, setToastState] = useState({
    visible: false,
    type: 'info',
    message: '',
  });
  const [entryCelebrationVisible, setEntryCelebrationVisible] = useState(false);
  const [entryCelebrationName, setEntryCelebrationName] = useState('');
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [deviceScannerVisible, setDeviceScannerVisible] = useState(false);
  const [deviceLinking, setDeviceLinking] = useState(false);
  const [linkedDevices, setLinkedDevices] = useState([]);
  const [linkedDeviceSlots, setLinkedDeviceSlots] = useState({ linkedCount: 0, limit: 4, remaining: 4 });
  const [deviceLinkMessage, setDeviceLinkMessage] = useState('');
  const [authForm, setAuthForm] = useState({
    countryCode: '+233',
    phone: '',
    otp: '',
    verifiedPhone: '',
    name: '',
    pin: '',
    username: '',
    language: 'English (Ghana)  GH',
    accountType: '',
    photoUri: '',
  });
  const [authSecretVisible, setAuthSecretVisible] = useState(false);
  const [startContinued, setStartContinued] = useState(false);
  const [startStep, setStartStep] = useState('splash');
  useEffect(() => {
    const timer = setTimeout(() => setStartStep('city'), 1400);
    return () => clearTimeout(timer);
  }, []);
  const phoneAuthConfirmationRef = useRef(null);
  const phoneAuthIdTokenRef = useRef('');
  const phoneAuthChallengeIdRef = useRef('');
  const phoneAuthProviderRef = useRef(''); // 'firebase' | 'backend'
  const forgotPinFlowRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const presentScamWarningRef = useRef(() => undefined);
  const appSettingsRef = useRef(DEFAULT_APP_SETTINGS);
  const currentUserIdRef = useRef('');
  const pinHoldingRef = useRef(false);
  const uiLockedRef = useRef(false);
  const systemCallIdRef = useRef('');
  const [lockNotice, setLockNotice] = useState(null);
  const usersByIdRef = useRef({});
  const chatScreenRef = useRef('list');
  const selectedChatIdRef = useRef('');
  const profileNameRef = useRef('');
  const currentDeviceIdRef = useRef('');

  const emojiAnim = useRef(new Animated.Value(0)).current;
  const animationRef = useRef(null);
  const timeoutsRef = useRef([]);
  const autoplayedRef = useRef(new Set());
  const recordingRef = useRef(null);
  const recordingDurationRef = useRef(0);
  const recordingPausedRef = useRef(false);
  const currentSoundRef = useRef(null);
  const playbackTokenRef = useRef(0);
  const playbackBusyRef = useRef(false);
  const uiSoundRef = useRef(null);
  const ringSoundRef = useRef(null);
  const playCueRef = useRef(() => undefined);
  const closeStatusViewerRef = useRef(() => undefined);
  const navigationStateRef = useRef({});
  const pendingIceRef = useRef([]);
  const remoteReadyRef = useRef(false);
  const iceRestartedRef = useRef(false);
  const signalChainRef = useRef(Promise.resolve());
  const outboxRef = useRef([]);
  const outboxFlushRef = useRef(false);
  const flushOutboxRef = useRef(() => undefined);
  const threadRef = useRef(null);
  const stickToLatestRef = useRef(true);
  const floatOriginRef = useRef({ x: 210, y: 120 });
  const callFloatResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gesture) => {
      setFloatPos({
        x: floatOriginRef.current.x + gesture.dx,
        y: floatOriginRef.current.y + gesture.dy,
      });
    },
    onPanResponderRelease: (_, gesture) => {
      const next = {
        x: Math.max(8, Math.min(260, floatOriginRef.current.x + gesture.dx)),
        y: Math.max(40, floatOriginRef.current.y + gesture.dy),
      };
      floatOriginRef.current = next;
      setFloatPos(next);
      if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
        setCallMinimized(false);
        setCallControlsVisible(true);
      }
    },
  })).current;
  const callControlsTimerRef = useRef(null);
  const messageNodeRefs = useRef({});
  const startCallRef = useRef(() => undefined);
  const voiceBarWidthRef = useRef(160);
  const recordPulse = useRef(new Animated.Value(1)).current;
  const socketRef = useRef(null);
  const updatesFeedRef = useRef([]);
  const statusGroupIndexRef = useRef(null);
  const statusItemIndexRef = useRef(0);
  const statusTabRef = useRef('contacts');
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const refreshSessionRef = useRef(() => undefined);
  const peerConnectionRef = useRef(null);
  const callMediaStreamRef = useRef(null);
  const mediaQueueRef = useRef(Promise.resolve());
  const remoteMediaStreamRef = useRef(null);
  const sentCueRefs = useRef(new Set());
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);

  const activeChat = chatItems.find((chat) => chat.id === selectedChatId) ?? chatItems[0] ?? chats[0];
  const messages = (messagesByChat[selectedChatId] ?? []).filter((message) => {
    if (!message?.expiresAt) return true;
    const expires = new Date(message.expiresAt).getTime();
    return !Number.isFinite(expires) || expires > Date.now();
  });
  const activeStatusGroup = activeStatusGroupIndex === null ? null : updatesFeed[activeStatusGroupIndex] ?? null;
  const visibleStatusItems = (activeStatusGroup?.items ?? []).filter((item) => {
    if (!statusStillLive(item)) return false;
    if (!activeStatusGroup?.userId || activeStatusGroup.userId === currentUserId) {
      return true;
    }
    const audience = item?.audience || 'contacts';
    if (statusTab === 'public') return audience === 'public';
    if (statusTab === 'marketplace') return audience === 'marketplace' || Boolean(item?.catalogItemId);
    return audience !== 'public' && audience !== 'marketplace';
  });
  const activeStatusItem = visibleStatusItems[activeStatusItemIndex] ?? null;
  const statusPlaybackPaused =
    statusHoldActive ||
    statusThreadVisible ||
    statusReplyVisible ||
    statusViewersVisible ||
    statusReactorsVisible ||
    Boolean(statusCommentDraft.trim()) ||
    Boolean(editingStatusCommentId);

  const accountCurrency = profile.currency || currencyForPhone(profile.phone, profile.countryCode);
  const accountCountry = countryForPhone(profile.phone) || COUNTRY_OPTIONS.find((country) => country.dialCode === profile.countryCode);

  const filteredCatalogItems = useMemo(() => {
    return catalogItems.filter((item) => {
      if (item.sellerId && currentUserId && item.sellerId !== currentUserId) {
        return false;
      }
      const status = item.status || (item.takenDown ? 'archived' : 'active');
      const matchesStatus = catalogStatusFilter === 'All' || status === catalogStatusFilter;
      const matchesCategory = catalogCategory === 'All' || item.category === catalogCategory;
      const query = catalogSearch.trim().toLowerCase();
      const variantText = (item.variants || [])
        .map((variant) => `${variant.name} ${(variant.options || []).join(' ')}`)
        .join(' ');
      const matchesSearch =
        !query ||
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        (item.seller || '').toLowerCase().includes(query) ||
        variantText.toLowerCase().includes(query);
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [catalogCategory, catalogItems, catalogSearch, catalogStatusFilter, currentUserId]);

  const filteredCountryOptions = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    return COUNTRY_OPTIONS.filter((country) =>
      !query ||
      country.name.toLowerCase().includes(query) ||
      country.dialCode.includes(query) ||
      country.code.toLowerCase().includes(query),
    );
  }, [countrySearch]);

  const visibleChatItems = useMemo(() => {
    const query = chatSearchQuery.trim().toLowerCase();
    const activeSpace = activeBusinessId || 'personal';
    const scoped = chatItems.filter((chat) => {
      if ((chat.space || 'personal') !== activeSpace) {
        return false;
      }
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
  }, [activeBusinessId, archivedChatIds, chatItems, chatSearchQuery, favoriteChatIds, showArchivedChats]);

  const payQuickContacts = useMemo(() => {
    const merged = [
      ...contactItems.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone || '',
        userId: contact.linkedUserId,
      })),
      ...chatItems.map((chat) => ({
        id: chat.id,
        name: chat.name,
        phone: usersById[chat.peerUserId]?.phone || '',
        userId: chat.peerUserId,
      })),
    ];

    const unique = [];
    const seen = new Set();
    merged.forEach((entry) => {
      const key = entry.name.trim().toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(entry);
    });
    return unique.slice(0, 5);
  }, [chatItems, contactItems, usersById]);

  const payTransactions = payHistoryItems;

  const selectedAuthCountry = useMemo(
    () => COUNTRY_OPTIONS.find((country) => country.dialCode === authForm.countryCode) ?? null,
    [authForm.countryCode],
  );

  const authStepNumber = useMemo(() => {
    if (authMode === 'phone') return 1;
    if (authMode === 'pin' || authMode === 'otp') return 2;
    if (authMode === 'reset-pin' || authMode === 'profile') return 3;
    if (authMode === 'account') return 4;
    return 0;
  }, [authMode]);

  const authProgressWidth = authStepNumber ? `${Math.min(100, (authStepNumber / 4) * 100)}%` : '0%';
  const authOtpDigits = Array.from({ length: 6 }, (_, index) => authForm.otp[index] ?? '');
  const authPinDigits = Array.from({ length: 6 }, (_, index) => authForm.pin[index] ?? '');
  const isAuthBusy = Boolean(authPendingAction);
  const authPendingLabel =
    authPendingAction === 'lookup'
      ? 'Checking your number...'
      : authPendingAction === 'send-code'
        ? 'Sending verification code...'
        : authPendingAction === 'verify-otp'
          ? 'Verifying your code...'
          : authPendingAction === 'pin-login'
            ? 'Signing you in...'
            : authPendingAction === 'reset-pin'
              ? 'Saving your PIN...'
              : authPendingAction === 'register'
                ? 'Creating your account...'
                : '';
  const celebrationDisplayName =
    entryCelebrationName ||
    authForm.name.trim().split(/\s+/)[0] ||
    profile.name.trim().split(/\s+/)[0] ||
    'there';

  const dismissToast = () => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToastState((current) => ({ ...current, visible: false }));
  };

  const showToast = (message, type = 'info', duration = 2600) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = null;
    }
    setToastState({
      visible: true,
      type,
      message,
    });
    if (duration > 0) {
      toastTimeoutRef.current = setTimeout(() => {
        setToastState((current) => ({ ...current, visible: false }));
        toastTimeoutRef.current = null;
      }, duration);
    }
  };

  const presentScamWarning = (chatId, messageId, warning) => {
    if (!warning?.risky) {
      return;
    }
    const signals = warning.signals || [];
    const pinAsk = signals.some((entry) => entry.code === 'pin_request');
    const advice = warning.advice
      || (pinAsk
        ? 'Never share MoMo PINs or OTPs.'
        : 'Be careful with this message.');
    const label = pinAsk
      ? `Security tip: this message may ask for a PIN/OTP. ${advice}`
      : `Security tip (${warning.severity || 'risk'}): ${advice}`;
    if (
      chatScreenRef.current === 'detail'
      && selectedChatIdRef.current
      && selectedChatIdRef.current === chatId
    ) {
      setScamWarningBanner({ chatId, messageId, warning });
    }
    showToast(label, 'error', pinAsk ? 5600 : 4200);
  };
  presentScamWarningRef.current = presentScamWarning;

  const persistAppSettings = async (nextSettings) => {
    appSettingsRef.current = nextSettings;
    setAppSettings(nextSettings);
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings)).catch(() => undefined);
  };

  const persistFavorites = async (nextFavorites) => {
    setFavoriteChatIds(nextFavorites);
    await AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(nextFavorites)).catch(() => undefined);
  };

  const toggleFavoriteChat = (chatId) => {
    const exists = favoriteChatIds.includes(chatId);
    const next = exists ? favoriteChatIds.filter((id) => id !== chatId) : [chatId, ...favoriteChatIds];
    void persistFavorites(next);
    showToast(exists ? 'Removed from favorites' : 'Added to favorites', 'success', 1600);
  };

  const persistMutedChats = async (nextMuted) => {
    mutedChatIdsRef.current = nextMuted;
    setMutedChatIds(nextMuted);
    await AsyncStorage.setItem(MUTED_CHATS_STORAGE_KEY, JSON.stringify(nextMuted)).catch(() => undefined);
  };

  const persistArchivedChats = async (nextArchived) => {
    setArchivedChatIds(nextArchived);
    await AsyncStorage.setItem(ARCHIVED_CHATS_STORAGE_KEY, JSON.stringify(nextArchived)).catch(() => undefined);
  };

  const toggleMuteChat = (chatId) => {
    const exists = mutedChatIds.includes(chatId);
    const next = exists ? mutedChatIds.filter((id) => id !== chatId) : [chatId, ...mutedChatIds];
    void persistMutedChats(next);
    showToast(exists ? 'Chat unmuted' : 'Chat muted', 'success', 1400);
  };

  const persistLockedChats = async (nextLocked) => {
    lockedChatIdsRef.current = nextLocked;
    setLockedChatIds(nextLocked);
    await AsyncStorage.setItem(LOCKED_CHATS_STORAGE_KEY, JSON.stringify(nextLocked)).catch(() => undefined);
  };

  const toggleLockChat = (chatId) => {
    if (!appLockPin) {
      showToast('Set a PIN in Profile before locking a chat.', 'error', 3600);
      setActiveView('Profile');
      setSettingsPanel('account');
      return;
    }
    const next = lockedChatIds.includes(chatId)
      ? lockedChatIds.filter((id) => id !== chatId)
      : [...lockedChatIds, chatId];
    void persistLockedChats(next);
    showToast(next.includes(chatId) ? 'Chat locked. The PIN opens it.' : 'Chat unlocked.', 'success', 2200);
  };

  const setChatDisappear = async (chatId, disappearAfterSeconds) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/disappear`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, disappearAfterSeconds }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update disappearing messages.', 'error');
        return;
      }
      setChatItems((current) => current.map((chat) => (
        chat.id === chatId
          ? { ...chat, disappearAfterSeconds: Number(payload.chat?.disappearAfterSeconds || 0) }
          : chat
      )));
      const label = disappearAfterSeconds === 0
        ? 'Off'
        : disappearAfterSeconds === 86400
          ? '24 hours'
          : disappearAfterSeconds === 604800
            ? '7 days'
            : '90 days';
      showToast(`Disappearing messages: ${label}`, 'success', 2200);
    } catch {
      showToast('Could not update disappearing messages.', 'error');
    }
  };

  const blockUser = async (targetUserId) => {
    if (!targetUserId || targetUserId === currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, targetUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not block this person.', 'error');
        return;
      }
      setProfile((current) => ({ ...current, blockedUserIds: payload.blockedUserIds || [] }));
      setPeerProfileVisible(false);
      setChatScreen('list');
      showToast('Blocked. They can no longer message or call you.', 'success', 3200);
    } catch {
      showToast('Could not block this person.', 'error');
    }
  };

  const unblockUser = async (targetUserId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/unblock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, targetUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not unblock this person.', 'error');
        return;
      }
      setProfile((current) => ({ ...current, blockedUserIds: payload.blockedUserIds || [] }));
      showToast('Unblocked.', 'success', 1800);
    } catch {
      showToast('Could not unblock this person.', 'error');
    }
  };

  const toggleArchiveChat = (chatId) => {
    const exists = archivedChatIds.includes(chatId);
    const next = exists ? archivedChatIds.filter((id) => id !== chatId) : [chatId, ...archivedChatIds];
    void persistArchivedChats(next);
    showToast(exists ? 'Chat unarchived' : 'Chat archived', 'success', 1400);
  };

  const mapServerMessage = (message, userId = currentUserId) => {
    const deleted = Boolean(message.deletedForEveryone);
    const mediaUrl = deleted ? undefined : message.mediaUrls?.[0];
    const locationMatch = !deleted && message.kind !== 'file'
      ? /^📍\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\|([\s\S]*))?$/.exec(message.text || '')
      : null;
    const kind = deleted ? 'text' : locationMatch ? 'location' : message.kind;

    return {
      id: message.id,
      clientRef: message.clientRef,
      mine: message.senderId === userId,
      kind,
      text: locationMatch ? (locationMatch[3]?.trim() || 'Shared location') : message.text,
      time: formatClock(message.sentAt),
      imageUri: kind === 'image' ? mediaUrl : undefined,
      audioUri: kind === 'voice' || kind === 'audio' ? mediaUrl : undefined,
      videoUri: kind === 'video' ? mediaUrl : undefined,
      fileUri: kind === 'file' ? mediaUrl : undefined,
      location: locationMatch ? `${locationMatch[1]},${locationMatch[2]}` : undefined,
      durationLabel: message.durationSeconds ? getAudioDurationLabel(message.durationSeconds * 1000) : undefined,
      durationSeconds: message.durationSeconds,
      catalogItemId: message.catalogItemId,
      documentId: message.documentId,
      documentKind: message.documentKind,
      receiptId: message.receiptId,
      receiptState: message.state,
      senderId: message.senderId,
      anonymous: Boolean(message.anonymous) || message.senderId === 'anonymous',
      actorName: message.actorName || '',
      expiresAt: message.expiresAt || '',
      replyToMessageId: message.replyToMessageId,
      replyPreview: message.replyPreview,
      deletedForEveryone: deleted,
      callKind: message.callKind,
      callState: message.callState,
      transcript: message.transcript,
      transcriptStatus: message.transcriptStatus,
      transcriptLanguage: message.transcriptLanguage,
      transcriptUpdatedAt: message.transcriptUpdatedAt,
    };
  };

  const clearChatUnread = (chatId) => {
    if (!chatId || !currentUserId) {
      return;
    }
    setChatItems((current) =>
      current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
    );
    fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    }).catch(() => undefined);
  };

  const emitTyping = (typing) => {
    if (!socketRef.current || !selectedChatId || !currentUserId) {
      return;
    }
    socketRef.current.emit('typing:update', {
      chatId: selectedChatId,
      userId: currentUserId,
      typing: Boolean(typing),
    });
  };

  const copyMessageText = async (text) => {
    if (!text) {
      return;
    }
    try {
      const RNClipboard = require('react-native').Clipboard;
      if (RNClipboard?.setString) {
        RNClipboard.setString(text);
        showToast('Copied', 'success', 1200);
        return;
      }
    } catch {
      // Fall through to Share.
    }
    try {
      await Share.share({ message: text });
    } catch {
      showToast('Could not copy message', 'error');
    }
  };

  const deleteMessage = async (message, scope = 'me') => {
    if (!message?.id || !currentUserId) {
      return;
    }
    if (scope === 'me') {
      setMessagesByChat((current) => ({
        ...current,
        [selectedChatId]: (current[selectedChatId] ?? []).filter((item) => item.id !== message.id),
      }));
    }
    const response = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, scope }),
    }).catch(() => null);
    if (!response?.ok && scope === 'everyone') {
      showToast('Could not delete for everyone', 'error');
      return;
    }
    showToast(scope === 'everyone' ? 'Deleted for everyone' : 'Deleted for you', 'success', 1400);
    setMessageActionTarget(null);
  };

  const forwardMessage = async (message) => {
    const peers = chatItems.filter((chat) => chat.id !== selectedChatId).slice(0, 8);
    if (!peers.length) {
      showToast('No other chat to forward into yet.', 'error');
      return;
    }
    Alert.alert(
      'Forward message',
      'Choose a chat',
      [
        ...peers.map((chat) => ({
          text: chat.name,
          onPress: () => {
            fetch(`${API_BASE_URL}/api/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chatId: chat.id,
                senderId: currentUserId,
                clientRef: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kind: message.kind === 'location'
                  ? 'text'
                  : message.kind === 'audio'
                    ? 'voice'
                    : message.kind === 'image' || message.kind === 'voice' || message.kind === 'video' || message.kind === 'file'
                      ? message.kind
                      : 'text',
                text: message.kind === 'location' && message.location
                  ? `📍 ${message.location}|${message.text || 'Shared location'}`
                  : (message.text || 'Forwarded message'),
                mediaUrls: [message.imageUri, message.audioUri, message.videoUri, message.fileUri].filter((uri) => /^https?:\/\//i.test(uri || '')),
              }),
            }).catch(() => undefined);
            showToast(`Forwarded to ${chat.name}`, 'success', 1600);
            setMessageActionTarget(null);
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const savedNameFor = (userId) => contactItems.find((contact) => contact.linkedUserId === userId)?.name || '';

  const shortPhone = (phone) => {
    const value = String(phone || '').replace(/\s+/g, '');
    if (!value) return '';
    if (value.length <= 8) return value;
    return `${value.slice(0, 8)}...`;
  };

  const displayNameFor = (userId, fallback = '') => {
    if (!userId) return fallback || 'ZynkUP';
    if (userId === currentUserId) return 'Message yourself';
    const saved = savedNameFor(userId);
    if (saved) return saved;
    const user = usersById[userId];
    if (!user) return fallback || 'ZynkUP';
    return user.name || fallback || shortPhone(user.phone) || 'ZynkUP';
  };

  const headerLabelFor = (userId, fallback = '') => {
    const phone = shortPhone(usersById[userId]?.phone);
    if (phone) return phone;
    return displayNameFor(userId, fallback);
  };

  const isMutualContact = (userId) => {
    if (!userId) return false;
    if (userId === currentUserId) return true;
    if (mutualPrivacyReady) return mutualUserIds.includes(userId);
    return Boolean(savedNameFor(userId));
  };

  const sendChatRequest = async (toUserId, note) => {
    if (!toUserId || toUserId === currentUserId) return;
    const response = await fetch(`${API_BASE_URL}/api/chat-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId: currentUserId, toUserId, note }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not send the request.', 'error');
      return;
    }
    if (payload.request) {
      setChatRequests((current) => [payload.request, ...current.filter((item) => item.id !== payload.request.id)]);
    }
    showToast('Chat request sent. They can accept it from Requests.', 'success');
    setChatListTab('requests');
    setActiveView('Chats');
    setChatScreen('list');
  };

  const getPresenceLabel = (chat) => {
    if (peerTypingByChat[chat?.id]) {
      return 'typing…';
    }
    if (chat?.kind === 'group') {
      return peerTypingByChat[chat?.id] ? 'typing…' : 'Chat room';
    }
    if (chat?.kind === 'group') {
      return peerTypingByChat[chat?.id] ? 'typing…' : 'Chat room';
    }
    if (chat?.selfChat || (chat?.peerUserId && chat.peerUserId === currentUserId)) {
      return 'Message yourself';
    }
    const peer = usersById[chat?.peerUserId];
    if (!peer) {
      return chat?.presence || 'offline';
    }
    const seePresence = (() => {
      const privacy = peer.lastSeenPrivacy || 'everyone';
      if (privacy === 'nobody') return false;
      if (privacy === 'contacts') return isMutualContact(chat?.peerUserId);
      return true;
    })();
    if (!seePresence) {
      return 'offline';
    }
    if (peer.presence === 'online' || peer.presence === 'typing') {
      return peer.presence === 'typing' ? 'typing…' : 'online';
    }
    if (peer.lastSeenAt) {
      return `last seen ${formatClock(peer.lastSeenAt)}`;
    }
    return 'offline';
  };

  const saveProfileToServer = async (overrides = {}, settingsOverrides = {}, options = {}) => {
    if (!currentUserId) {
      showToast('Sign in first to sync profile settings.', 'error');
      return false;
    }

    const nextProfile = { ...profile, ...overrides };
    const nextSettings = { ...appSettingsRef.current, ...settingsOverrides };
    const pinToSave = typeof options.pin === 'string' ? options.pin.trim() : '';
    const avatar =
      nextProfile.name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.slice(0, 1).toUpperCase())
        .join('')
        .slice(0, 4) || 'ZU';

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile?userId=${encodeURIComponent(currentUserId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nextProfile.name.trim() || undefined,
          about: nextProfile.about.trim() || 'Hey there! I am using ZynkUP.',
          phone: nextProfile.phone.trim() || undefined,
          username: nextProfile.username?.trim() || undefined,
          avatar,
          photoUri: /^https?:\/\//i.test(nextProfile.photoUri || '') ? nextProfile.photoUri : '',
          profileVideoUri: /^https?:\/\//i.test(nextProfile.profileVideoUri || '') ? nextProfile.profileVideoUri : '',
          profileVideoPosterUri: /^https?:\/\//i.test(nextProfile.profileVideoPosterUri || '') ? nextProfile.profileVideoPosterUri : '',
          profileVideoDurationSeconds: Number(nextProfile.profileVideoDurationSeconds) || 0,
          currency: nextProfile.currency || accountCurrency,
          lastSeenPrivacy: nextSettings.lastSeenPrivacy,
          profilePhotoPrivacy: nextSettings.profilePhotoPrivacy,
          aboutPrivacy: nextSettings.aboutPrivacy,
          statusPrivacy: nextSettings.statusPrivacy,
          typingPrivacy: nextSettings.typingPrivacy,
          callPrivacy: nextSettings.callPrivacy,
          groupInvitePrivacy: nextSettings.groupInvitePrivacy,
          readReceiptsEnabled: nextSettings.readReceiptsEnabled,
          appLockEnabled: nextSettings.appLockEnabled,
          ...(pinToSave.length === 4 ? { pin: pinToSave } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(payload, 'Could not save profile.'), 'error', 3600);
        return false;
      }
      const payload = await response.json();
      if (payload.profile) {
        setProfile((current) => ({
          ...current,
          name: payload.profile.name ?? current.name,
          username: payload.profile.username ?? current.username,
          about: payload.profile.about ?? current.about,
          phone: payload.profile.phone ?? current.phone,
          countryCode: payload.profile.countryCode ?? current.countryCode,
          currency: payload.profile.currency ?? current.currency,
          photoUri: payload.profile.photoUri ?? current.photoUri,
          profileVideoUri: payload.profile.profileVideoUri ?? current.profileVideoUri,
          profileVideoPosterUri: payload.profile.profileVideoPosterUri ?? current.profileVideoPosterUri,
          profileVideoDurationSeconds: payload.profile.profileVideoDurationSeconds ?? current.profileVideoDurationSeconds,
        }));
      }
      if (/^\d{4,6}$/.test(pinToSave)) {
        setAppLockPin(pinToSave);
        await AsyncStorage.setItem(APP_LOCK_PIN_KEY, pinToSave).catch(() => undefined);
      }
      if (nextSettings.appLockEnabled === false || nextSettings.pinDisabled) {
        setAppLockPin('');
        setAppUnlocked(true);
        await AsyncStorage.removeItem(APP_LOCK_PIN_KEY).catch(() => undefined);
      }
      if (!options.quiet) {
        showToast('Settings saved', 'success');
      }
      return true;
    } catch {
      showToast('Network error while saving settings.', 'error');
      return false;
    }
  };

  const updateAppSetting = (key, value, options = {}) => {
    const nextSettings = { ...appSettingsRef.current, [key]: value };
    void persistAppSettings(nextSettings);
    if (!options.silent) {
      showToast('Setting updated', 'success', 1400);
    }
    if (options.syncProfile) {
      void saveProfileToServer({}, { [key]: value }, { quiet: true });
    }
    return nextSettings;
  };

  const pickProfilePhoto = async () => {
    const result = await openImageLibrary({ mediaType: 'photo', selectionLimit: 1 });
    if (result.errorCode) {
      Alert.alert('Permission needed', result.errorMessage || 'Allow gallery access to update your photo.');
      return;
    }
    if (result.didCancel || !result.assets?.length) {
      return;
    }

    const localUri = result.assets[0].uri;
    setProfile((current) => ({ ...current, photoUri: localUri }));
    showToast('Uploading profile photo...', 'info', 0);
    try {
      const uploaded = await uploadUris([localUri], {
        names: [`profile-${Date.now()}.jpg`],
        fallbackType: 'image/jpeg',
      });
      if (!uploaded[0]) {
        showToast('Preview is on this phone. Cloud Storage is not ready, so it will not show on other devices yet.', 'error', 4600);
        return;
      }
      setProfile((current) => ({ ...current, photoUri: uploaded[0] }));
      setUsersById((current) => ({
        ...current,
        [currentUserId]: {
          ...(current[currentUserId] ?? { id: currentUserId, name: profile.name, avatar: profile.name.slice(0, 2).toUpperCase() }),
          photoUri: uploaded[0],
        },
      }));
      await saveProfileToServer({ photoUri: uploaded[0] });
    } catch {
      showToast('Could not upload profile photo. The preview stays on this phone.', 'error', 4200);
    }
  };

  const pickProfileVideo = async () => {
    const result = await openImageLibrary({ mediaType: 'video', selectionLimit: 1 });
    if (result.errorCode) {
      Alert.alert('Permission needed', result.errorMessage || 'Allow gallery access to add a profile video.');
      return;
    }
    const asset = result.assets?.[0];
    if (result.didCancel || !asset?.uri) {
      return;
    }
    let durationSeconds = Number(asset.duration) || 0;
    if (durationSeconds > 30) {
      durationSeconds = durationSeconds / 1000;
    }
    durationSeconds = Math.round(durationSeconds);
    if (durationSeconds && (durationSeconds < 1 || durationSeconds > 6)) {
      showToast('Profile videos must be 1–6 seconds.', 'error', 3600);
      return;
    }
    showToast('Uploading profile video...', 'info', 0);
    try {
      const uploaded = await uploadUris([asset.uri], {
        names: [`profile-video-${Date.now()}.mp4`],
        types: [asset.type || 'video/mp4'],
        fallbackType: 'video/mp4',
      });
      if (!uploaded[0]) {
        showToast('Could not upload profile video.', 'error');
        return;
      }
      const nextFields = {
        profileVideoUri: uploaded[0],
        profileVideoPosterUri: /^https?:\/\//i.test(profile.photoUri || '') ? profile.photoUri : '',
        profileVideoDurationSeconds: durationSeconds || 6,
      };
      setProfile((current) => ({ ...current, ...nextFields }));
      await saveProfileToServer(nextFields);
    } catch {
      showToast('Could not upload profile video.', 'error');
    }
  };

  const removeProfileVideo = async () => {
    const nextFields = {
      profileVideoUri: '',
      profileVideoPosterUri: '',
      profileVideoDurationSeconds: 0,
    };
    setProfile((current) => ({ ...current, ...nextFields }));
    await saveProfileToServer(nextFields);
  };

  const clearChatHistory = () => {
    Alert.alert(
      'Clear chat history?',
      'This removes local message history on this device. Your contacts stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setMessagesByChat({});
            setChatItems((current) =>
              current.map((chat) => ({ ...chat, preview: 'No messages yet', unread: 0, time: '' })),
            );
            showToast('Chat history cleared on this device', 'success');
            setSettingsPanel('');
          },
        },
      ],
    );
  };

  const clearLocalMediaCache = () => {
    setStatusAssetUris([]);
    setCatalogImageUris([]);
    setMediaViewer(null);
    showToast('Local media cache cleared', 'success');
  };

  const getBackendErrorMessage = (payload, fallback) => {
    const fieldErrors = Object.values(payload?.details?.fieldErrors ?? {})
      .flat()
      .find(Boolean);
    const formError = payload?.details?.formErrors?.find(Boolean);
    const detail = fieldErrors || formError || '';
    if (payload?.error && detail && payload.error !== detail) {
      return `${payload.error}: ${detail}`;
    }
    return payload?.error || detail || fallback;
  };

  const authDevicePayload = () => (
    currentDeviceId && String(currentDeviceId).length >= 8
      ? { deviceId: currentDeviceId }
      : {}
  );

  const hydrateBootstrapFromDevice = async (deviceIdHint, options = {}) => {
    const storedDeviceId = await AsyncStorage.getItem(DEVICE_STORAGE_KEY);
    const deviceIds = [deviceIdHint, currentDeviceId, storedDeviceId].filter(Boolean);
    const uniqueDeviceIds = [...new Set(deviceIds)];
    if (!uniqueDeviceIds.length) {
      return null;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const deviceId of uniqueDeviceIds) {
        try {
          const response = await fetch(`${API_BASE_URL}/api/bootstrap?deviceId=${encodeURIComponent(deviceId)}`);
          if (!response.ok) {
            continue;
          }
          const payload = await response.json();
          if (payload?.currentUserId) {
            applyBootstrapPayload(payload, options);
            return payload;
          }
        } catch {
          // Retry below after a short delay.
        }
      }
      if (attempt < 2) {
        await sleep(400);
      }
    }

    return null;
  };
  refreshSessionRef.current = () => {
    void hydrateBootstrapFromDevice(currentDeviceIdRef.current, { preserveCall: true });
  };

  const signOutKeepAccount = async () => {
    const account = await readRememberedAccount();
    const phone = account?.phone || profile.phone;
    const parts = splitStoredPhone(phone);
    if (phone) {
      await writeRememberedAccount({
        userId: account?.userId || currentUserId,
        phone,
        countryCode: account?.countryCode || profile.countryCode || parts.countryCode,
        name: account?.name || profile.name || '',
        currency: account?.currency || profile.currency || '',
        lastActiveAt: Date.now() - SESSION_IDLE_MS - 1000,
      });
    }
    setCurrentUserId('');
    setAuthRequired(true);
    setAuthVisible(true);
    setAuthForm((current) => ({
      ...current,
      countryCode: parts.countryCode,
      phone: parts.phone,
      verifiedPhone: phone || '',
      name: account?.name || profile.name || '',
      pin: '',
      otp: '',
    }));
    setAuthMode(phone && !appSettingsRef.current.pinDisabled ? 'pin' : (phone ? 'phone' : 'phone'));
    showToast(
      phone && !appSettingsRef.current.pinDisabled
        ? 'Enter your PIN to open this account.'
        : 'Enter your phone number.',
      'info',
      2800,
    );
  };

  const resetAuthForm = () => {
    setAuthForm({
      countryCode: '+233',
      phone: '',
      otp: '',
      verifiedPhone: '',
      name: '',
      pin: '',
      username: '',
      language: 'English (Ghana)  GH',
      accountType: '',
      photoUri: '',
    });
    setAuthMode('welcome');
  };

  const goBackAuthStep = () => {
    if (authMode === 'phone') {
      setAuthMode('welcome');
      return;
    }
    if (authMode === 'pin' || authMode === 'otp') {
      setAuthMode('phone');
      return;
    }
    if (authMode === 'reset-pin') {
      setAuthMode('otp');
      return;
    }
    if (authMode === 'profile') {
      setAuthMode('otp');
      return;
    }
    if (authMode === 'account') {
      setAuthMode('profile');
    }
  };

  const appendOtpDigit = (digit) => {
    setAuthForm((current) => {
      if (current.otp.length >= 6) {
        return current;
      }
      return {
        ...current,
        otp: `${current.otp}${digit}`,
      };
    });
  };

  const removeOtpDigit = () => {
    setAuthForm((current) => ({
      ...current,
      otp: current.otp.slice(0, -1),
    }));
  };

  const appendPinDigit = (digit) => {
    setAuthForm((current) => {
      if (current.pin.length >= 6) {
        return current;
      }
      return {
        ...current,
        pin: `${current.pin}${digit}`,
      };
    });
  };

  const removePinDigit = () => {
    setAuthForm((current) => ({
      ...current,
      pin: current.pin.slice(0, -1),
    }));
  };

  const isValidAuthPin = (pin) => /^\d{4,6}$/.test(String(pin || '').trim());

  const pickAuthProfilePhoto = async () => {
    const result = await openImageLibrary({ mediaType: 'photo' });
    if (result.errorCode) {
      Alert.alert('Permission needed', result.errorMessage || 'Please allow gallery access to select a profile photo.');
      return;
    }
    if (!result.didCancel && result.assets?.length) {
      setAuthForm((current) => ({
        ...current,
        photoUri: result.assets[0].uri,
      }));
    }
  };

  const continueFromProfileStep = () => {
    const trimmedName = authForm.name.trim();
    if (!trimmedName) {
      showToast('Enter your name to continue.', 'error');
      return;
    }
    if (!isValidAuthPin(authForm.pin)) {
      showToast('Create a 4–6 digit PIN to secure your account.', 'error');
      return;
    }

    setAuthForm((current) => ({
      ...current,
      name: trimmedName,
      username: current.username.trim() || deriveAuthUsername(trimmedName),
    }));
    setAuthMode('account');
  };

  const finishAuthenticatedSession = async (payload, pinToStore) => {
    pinHoldingRef.current = false;
    if (payload.session?.deviceId) {
      await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
      setCurrentDeviceId(payload.session.deviceId);
    }
    let bootstrapPayload = payload.bootstrap ?? null;
    if (bootstrapPayload?.currentUserId) {
      applyBootstrapPayload(bootstrapPayload);
    } else {
      bootstrapPayload = await hydrateBootstrapFromDevice(payload.session?.deviceId ?? currentDeviceId);
    }
    if (!bootstrapPayload?.currentUserId) {
      showToast('Signed in, but session sync failed. Reopen the app once.', 'error', 4200);
      return false;
    }
    if (pinToStore && isValidAuthPin(pinToStore)) {
      setAppLockPin(String(pinToStore));
      await AsyncStorage.setItem(APP_LOCK_PIN_KEY, String(pinToStore)).catch(() => undefined);
    }
    pinHoldingRef.current = false;
    setAuthVisible(false);
    setAuthRequired(false);
    resetAuthForm();
    showToast('Welcome back', 'success');
    return true;
  };

  const loginWithPin = async () => {
    if (isAuthBusy) {
      return;
    }
    if (!isValidAuthPin(authForm.pin)) {
      showToast('Enter your 4–6 digit PIN.', 'error');
      return;
    }
    setAuthPendingAction('pin-login');
    showToast('Signing you in...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authDevicePayload(),
          countryCode: authForm.countryCode.trim(),
          phoneNumber: authForm.phone.trim(),
          phone: normalizeAuthPhone(authForm.countryCode.trim(), authForm.phone.trim()),
          pin: authForm.pin.trim(),
          challengeId: phoneAuthChallengeIdRef.current || undefined,
          idToken: phoneAuthIdTokenRef.current || undefined,
          platform: Platform.OS,
          label: `${Platform.OS} device`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.code === 'OTP_REQUIRED') {
        showToast('Confirm the SMS code for this number, then enter your PIN again.', 'info', 4200);
        setAuthPendingAction('send-code');
        await deliverPhoneOtp(authForm.countryCode.trim(), authForm.phone.trim(), authForm.verifiedPhone);
        return;
      }
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Incorrect PIN.'), 'error');
        return;
      }
      await finishAuthenticatedSession(payload, authForm.pin.trim());
    } catch {
      showToast('Network error while signing in.', 'error');
    } finally {
      setAuthPendingAction('');
    }
  };

  const signInFromWelcome = async () => {
    if (isAuthBusy) {
      return;
    }
    if (!authForm.countryCode.trim()) {
      showToast('Select your country code first.', 'error');
      setCountryPickerVisible(true);
      return;
    }
    const countryCode = authForm.countryCode.trim();
    const phoneNumber = authForm.phone.trim();
    const normalizedPhone = normalizeAuthPhone(countryCode, phoneNumber);
    if (normalizedPhone.length < 8) {
      showToast('Enter a valid phone number first.', 'error');
      return;
    }
    if (!isValidAuthPin(authForm.pin)) {
      showToast('Enter your 4–6 digit PIN.', 'error');
      return;
    }
    const pin = authForm.pin.trim();
    setAuthPendingAction('lookup');
    showToast('Signing you in...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/phone/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode,
          phoneNumber,
          deviceId: currentDeviceId || (await AsyncStorage.getItem(DEVICE_STORAGE_KEY)) || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Could not check this phone number.'), 'error');
        return;
      }
      const verifiedPhone = payload.phone || normalizedPhone;
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
        pin,
        otp: '',
      }));
      if (payload.registered && payload.hasPin && payload.otpRequired) {
        forgotPinFlowRef.current = false;
        showToast('This install is new. Confirm the SMS code, then enter your PIN.', 'info', 4200);
        setAuthPendingAction('send-code');
        await deliverPhoneOtp(countryCode, phoneNumber, verifiedPhone);
        return;
      }
      if (!(payload.registered && payload.hasPin)) {
        showToast('No account on this number yet. Create one to join.', 'info', 3200);
        setAuthMode('phone');
        return;
      }
      setAuthPendingAction('pin-login');
      const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authDevicePayload(),
          countryCode,
          phoneNumber,
          phone: verifiedPhone,
          pin,
          platform: Platform.OS,
          label: `${Platform.OS} device`,
        }),
      });
      const loginPayload = await loginResponse.json().catch(() => ({}));
      if (loginPayload.code === 'OTP_REQUIRED') {
        showToast('Confirm the SMS code for this number, then enter your PIN again.', 'info', 4200);
        setAuthPendingAction('send-code');
        await deliverPhoneOtp(countryCode, phoneNumber, verifiedPhone);
        return;
      }
      if (!loginResponse.ok) {
        showToast(getBackendErrorMessage(loginPayload, 'Incorrect PIN.'), 'error');
        return;
      }
      await finishAuthenticatedSession(loginPayload, pin);
    } catch (error) {
      reportOtpFailure(error);
    } finally {
      setAuthPendingAction('');
    }
  };

  const resetPinAfterOtp = async () => {
    if (isAuthBusy) {
      return;
    }
    if (!isValidAuthPin(authForm.pin)) {
      showToast('Enter a new 4–6 digit PIN.', 'error');
      return;
    }
    if (!phoneAuthChallengeIdRef.current && !phoneAuthIdTokenRef.current) {
      showToast('Verify OTP first, then set a new PIN.', 'error');
      return;
    }
    setAuthPendingAction('reset-pin');
    showToast('Saving new PIN...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/pin/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authDevicePayload(),
          challengeId: phoneAuthChallengeIdRef.current || undefined,
          idToken: phoneAuthIdTokenRef.current || undefined,
          pin: authForm.pin.trim(),
          platform: Platform.OS,
          label: `${Platform.OS} device`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Could not reset PIN.'), 'error');
        return;
      }
      await finishAuthenticatedSession(payload, authForm.pin.trim());
    } catch {
      showToast('Network error while resetting PIN.', 'error');
    } finally {
      setAuthPendingAction('');
    }
  };

  const continueWithPhone = async () => {
    if (isAuthBusy) {
      return;
    }
    if (!authForm.countryCode.trim()) {
      showToast('Select your country code first.', 'error');
      setCountryPickerVisible(true);
      return;
    }
    const countryCode = authForm.countryCode.trim();
    const phoneNumber = authForm.phone.trim();
    const normalizedPhone = normalizeAuthPhone(countryCode, phoneNumber);
    if (normalizedPhone.length < 8) {
      showToast('Enter a valid phone number first.', 'error');
      return;
    }

    setAuthPendingAction('lookup');
    showToast('Checking your number...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/phone/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode,
          phoneNumber,
          deviceId: currentDeviceId || (await AsyncStorage.getItem(DEVICE_STORAGE_KEY)) || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Could not check this phone number.'), 'error');
        return;
      }

      setAuthForm((current) => ({
        ...current,
        verifiedPhone: payload.phone || normalizedPhone,
        pin: '',
        otp: '',
      }));

      if (payload.registered && payload.hasPin && payload.otpRequired) {
        forgotPinFlowRef.current = false;
        showToast('This install is new. Confirm the SMS code, then enter your PIN.', 'info', 4200);
        setAuthPendingAction('send-code');
        await deliverPhoneOtp(countryCode, phoneNumber, payload.phone || normalizedPhone);
        return;
      }

      if (payload.registered && payload.hasPin) {
        forgotPinFlowRef.current = false;
        setAuthMode('pin');
        showToast('Welcome back. Enter your PIN.', 'success', 2200);
        return;
      }

      // New user or account without PIN — real SMS via Firebase on release builds.
      forgotPinFlowRef.current = false;
      setAuthPendingAction('send-code');
      await deliverPhoneOtp(countryCode, phoneNumber, normalizedPhone);
    } catch (error) {
      reportOtpFailure(error);
    } finally {
      setAuthPendingAction('');
    }
  };

  const submitSelectedAccountType = (accountType) => {
    if (isAuthBusy) {
      return;
    }
    setAuthForm((current) => ({
      ...current,
      accountType,
    }));
  };

  const closePeerConnection = () => {
    peerConnectionRef.current?.getSenders().forEach((sender) => sender.track?.stop?.());
    peerConnectionRef.current?.close?.();
    peerConnectionRef.current = null;
    iceRestartedRef.current = false;
    callMediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    callMediaStreamRef.current = null;
    remoteMediaStreamRef.current = null;
    mediaQueueRef.current = Promise.resolve();
    CueSound?.resetAudioRoute?.();
    pendingIceRef.current = [];
    remoteReadyRef.current = false;
    setLocalCallStream(null);
    setRemoteCallStream(null);
    setLocalVideoLarge(false);
  };

  const ensureCallMedia = (kind) => {
    const job = mediaQueueRef.current.then(async () => {
      if (!CAN_USE_NATIVE_WEBRTC || !mediaDevices) {
        throw new Error('native-webrtc-unavailable');
      }

      const wantsVideo = String(kind || '').toLowerCase() === 'video';
      if (Platform.OS === 'android') {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (wantsVideo) {
          permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        }
        const blocked = [];
        for (const permission of permissions) {
          let granted = await PermissionsAndroid.check(permission);
          if (!granted) {
            const result = await PermissionsAndroid.request(permission);
            granted = result === PermissionsAndroid.RESULTS.GRANTED;
          }
          if (!granted) blocked.push(permission);
        }
        if (blocked.length) {
          const cameraBlocked = blocked.includes(PermissionsAndroid.PERMISSIONS.CAMERA);
          Alert.alert(
            cameraBlocked ? 'Camera is blocked' : 'Microphone is blocked',
            'Allow the camera and microphone for ZynkUP, then open the video call again.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ],
          );
          throw new Error('permission-denied');
        }
        if (wantsVideo) setCameraPermissionGranted(true);
      }

      const existing = callMediaStreamRef.current;
      const existingHasVideo = existing?.getVideoTracks?.().some((track) => track.readyState === 'live');
      if (existing && (!wantsVideo || existingHasVideo)) {
        return existing;
      }
      if (existing && wantsVideo && !existingHasVideo) {
        let videoOnly;
        try {
          videoOnly = await mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user', width: 640, height: 480 },
          });
        } catch (mediaError) {
          try {
            videoOnly = await mediaDevices.getUserMedia({ audio: false, video: true });
          } catch (fallbackError) {
            const reason = `${mediaError?.name || ''} ${mediaError?.message || ''} ${fallbackError?.name || ''} ${fallbackError?.message || ''}`;
            throw new Error(/permission|NotAllowed|Security/i.test(reason) ? 'permission-denied' : 'camera-failed');
          }
        }
        const videoTrack = videoOnly.getVideoTracks?.()?.[0];
        if (!videoTrack) throw new Error('camera-failed');
        videoTrack.enabled = true;
        existing.addTrack(videoTrack);
        const connection = peerConnectionRef.current;
        if (connection) {
          const sender = connection.getSenders?.().find((item) => item.track?.kind === 'video');
          if (sender?.replaceTrack) {
            sender.replaceTrack(videoTrack).catch(() => undefined);
          } else {
            try {
              connection.addTrack(videoTrack, existing);
            } catch {
              // Already attached.
            }
          }
        }
        callMediaStreamRef.current = existing;
        const PreviewStream = webRtcModule?.MediaStream;
        setLocalCallStream(PreviewStream ? new PreviewStream(existing.getTracks()) : existing);
        return existing;
      }
      existing?.getTracks?.().forEach((track) => track.stop());

      const videoAttempts = wantsVideo
        ? [
          { audio: true, video: true },
          { audio: true, video: { facingMode: 'user' } },
          { audio: true, video: { facingMode: 'user', width: 640, height: 480 } },
        ]
        : [{ audio: true, video: false }];
      let stream;
      let lastError;
      for (const constraints of videoAttempts) {
        try {
          stream = await mediaDevices.getUserMedia(constraints);
          break;
        } catch (mediaError) {
          lastError = mediaError;
        }
      }
      if (!stream) {
        const reason = `${lastError?.name || ''} ${lastError?.message || ''}`;
        throw new Error(/permission|NotAllowed|Security/i.test(reason) ? 'permission-denied' : 'camera-failed');
      }
      stream.getAudioTracks?.().forEach((track) => {
        track.enabled = true;
      });
      stream.getVideoTracks?.().forEach((track) => {
        track.enabled = true;
      });
      const connection = peerConnectionRef.current;
      if (connection) {
        stream.getTracks().forEach((track) => {
          const sender = connection.getSenders?.().find((item) => item.track?.kind === track.kind);
          if (sender?.replaceTrack) {
            sender.replaceTrack(track).catch(() => undefined);
          } else {
            try {
              connection.addTrack(track, stream);
            } catch {
              // Track is already on this connection.
            }
          }
        });
      }
      callMediaStreamRef.current = stream;
      const PreviewStream = webRtcModule?.MediaStream;
      setLocalCallStream(PreviewStream ? new PreviewStream(stream.getTracks()) : stream);
      return stream;
    });
    mediaQueueRef.current = job.then(() => undefined, () => undefined);
    return job;
  };

  const flushQueuedIce = async (connection) => {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const candidate of queued) {
      await connection.addIceCandidate(new RTCIceCandidateNative(candidate)).catch(() => undefined);
    }
  };

  const flipCallCamera = () => {
    const track = localCallStream?.getVideoTracks?.()?.[0];
    if (typeof track?._switchCamera === 'function') {
      track._switchCamera();
    }
  };

  const revealCallControls = () => {
    setCallControlsVisible(true);
    if (callControlsTimerRef.current) {
      clearTimeout(callControlsTimerRef.current);
    }
    callControlsTimerRef.current = setTimeout(() => {
      const call = activeCallRef.current;
      if (call?.kind === 'Video' && call?.state === 'ongoing' && !callMinimized) {
        setCallControlsVisible(false);
      }
    }, 7000);
  };

  const setCallAudioMuted = (muted) => {
    setCallMuted(muted);
    localCallStream?.getAudioTracks?.()?.forEach((track) => {
      track.enabled = !muted;
    });
  };

  const setCallVideoEnabled = (enabled) => {
    if (!enabled) {
      setCallCameraOff(true);
      localCallStream?.getVideoTracks?.()?.forEach((track) => {
        track.enabled = false;
      });
      const call = activeCallRef.current;
      if (call) {
        emitCallSignal(call.id, 'camera', { enabled: false }, call.peerUserId);
      }
      return;
    }
    void ensureCallMedia('Video').then((stream) => {
      const tracks = stream?.getVideoTracks?.() || [];
      if (!tracks.length) {
        throw new Error('camera-failed');
      }
      tracks.forEach((track) => {
        track.enabled = true;
      });
      setCallCameraOff(false);
      setCallError('');
      const call = activeCallRef.current;
      if (call) {
        emitCallSignal(call.id, 'camera', { enabled: true }, call.peerUserId);
      }
    }).catch((error) => {
      setCallCameraOff(true);
      setCallError(error?.message === 'permission-denied'
        ? 'Camera permission was denied. Allow the camera, then tap Camera again.'
        : 'The camera did not open. Tap Camera to try again.');
    });
  };

  const setCallSpeaker = (enabled) => {
    callSpeakerOnRef.current = enabled;
    setCallSpeakerOn(enabled);
    CueSound?.setSpeaker?.(enabled);
  };

  const shareCallScreen = async () => {
    const mediaDevices = webRtcModule?.mediaDevices;
    const connection = peerConnectionRef.current;
    if (!mediaDevices?.getDisplayMedia || !connection) {
      showToast('Screen share is not available on this phone yet.', 'error');
      return;
    }
    try {
      const displayStream = await mediaDevices.getDisplayMedia({ video: true });
      const track = displayStream.getVideoTracks?.()?.[0];
      const sender = connection.getSenders?.().find((item) => item.track?.kind === 'video');
      if (track && sender?.replaceTrack) {
        await sender.replaceTrack(track);
        setCallCameraOff(false);
        showToast('You are sharing your screen.', 'success');
      }
    } catch {
      showToast('Screen share was cancelled.', 'error');
    }
  };

  const enableVideoOnCall = async () => {
    const connection = peerConnectionRef.current;
    const call = activeCallRef.current;
    if (!connection || !call) {
      return;
    }
    const stream = await ensureCallMedia('Video');
    const videoTrack = stream.getVideoTracks?.()?.find((track) => track.readyState === 'live');
    if (!videoTrack) {
      throw new Error('camera-failed');
    }
    videoTrack.enabled = true;
    const sender = connection.getSenders?.().find((item) => item.track?.kind === 'video');
    if (sender?.replaceTrack) {
      await sender.replaceTrack(videoTrack);
    } else {
      connection.addTrack(videoTrack, stream);
    }
    setCallCameraOff(false);
    setActiveCall((current) => (current ? { ...current, kind: 'Video' } : current));
    emitCallSignal(call.id, 'camera', { enabled: true }, call.peerUserId);
    if (connection.signalingState === 'stable') {
      const offer = await connection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await connection.setLocalDescription(offer);
      emitCallSignal(call.id, 'offer', offer, call.peerUserId);
    }
  };

  const emitCallSignal = (callId, signalType, payload, toUserId) => {
    socketRef.current?.emit('call:signal', {
      callId,
      fromUserId: currentUserId,
      toUserId,
      signalType,
      payload,
    });
  };

  const syncPhoneContacts = async (userId, options = {}) => {
    if (!userId) {
      showToast('Sign in first, then sync your phone book.', 'error');
      return;
    }
    if (!Contacts?.getAll) {
      showToast('Contact sync needs the latest app install.', 'error', 4200);
      return;
    }

    try {
      if (Platform.OS === 'android') {
        const permission = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;
        let granted = await PermissionsAndroid.check(permission);
        if (!granted) {
          const result = await PermissionsAndroid.request(permission);
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
        }
        if (!granted) {
          showToast('Contacts are off. Allow ZynkUP to read contacts, then tap Sync again.', 'error', 4200);
          await Linking.openSettings();
          return;
        }
      } else {
        const permission = await Contacts.requestPermission();
        if (permission !== 'authorized') {
          showToast('Contacts are off. Allow ZynkUP to read contacts, then tap Sync again.', 'error', 4200);
          await Linking.openSettings();
          return;
        }
      }

      const deviceContacts = await Contacts.getAll();
      const payloadContacts = deviceContacts
        .flatMap((contact) =>
          (contact.phoneNumbers ?? []).map((entry) => ({
            name: String(contact.displayName || 'Unknown').trim().slice(0, 80) || 'Unknown',
            phone: String(entry.number || '').replace(/[^\d+]/g, '').slice(0, 20),
          })),
        )
        .filter((contact) => contact.phone.replace(/\D/g, '').length >= 8);

      if (!payloadContacts.length) {
        setContactItems([]);
        if (!options.quiet) {
          showToast('No phone numbers were found in the phone book.', 'error', 3600);
        }
        return;
      }

      if (!options.quiet) {
        showToast('Syncing phone book...', 'info', 0);
      }
      const response = await fetch(`${API_BASE_URL}/api/contacts/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          contacts: payloadContacts,
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(failure, 'Contact sync failed. Check the connection and try again.'), 'error', 4200);
        return;
      }

      const payload = await response.json();
      const matched = payload.contacts ?? [];
      setContactItems(matched);
      if (!options.quiet) {
        showToast(
          matched.length
            ? `${matched.length} contact${matched.length === 1 ? '' : 's'} on ZynkUP. You can chat and call them.`
            : `Checked ${payloadContacts.length} numbers. None of them are on ZynkUP yet.`,
          matched.length ? 'success' : 'info',
          4200,
        );
      }
    } catch {
      showToast('Contact sync could not read the phone book.', 'error', 3600);
    }
  };

  const fetchLinkedDevices = async (userId) => {
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
      remaining: payload.remaining ?? Math.max(0, 4 - (payload.devices ?? []).length),
    });
  };

  const unlinkDevice = async (deviceId) => {
    const response = await fetch(`${API_BASE_URL}/api/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      return;
    }

    await fetchLinkedDevices(currentUserId);
  };

  const confirmLinkedDesktop = async (rawPayload) => {
    if (deviceLinking || !currentUserId) {
      return;
    }

    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      parsedPayload = null;
    }

    if (
      parsedPayload?.type !== 'zynkup-link-device' ||
      !parsedPayload?.requestId ||
      !parsedPayload?.token
    ) {
      setDeviceLinkMessage('Invalid desktop QR code.');
      return;
    }

    setDeviceLinking(true);
    setDeviceScannerVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/link/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: parsedPayload.requestId,
          token: parsedPayload.token,
          userId: currentUserId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeviceLinkMessage(payload.error ?? 'Unable to link this desktop.');
        return;
      }

      setDeviceLinkMessage(
        payload.status === 'pin_required'
          ? 'Desktop scan accepted. Enter your app pin on desktop to finish linking.'
          : 'Desktop linked successfully.',
      );
      await fetchLinkedDevices(currentUserId);
    } finally {
      setDeviceLinking(false);
    }
  };

  const ensurePeerConnection = async (call) => {
    if (!CAN_USE_NATIVE_WEBRTC || !RTCPeerConnectionNative) {
      throw new Error('native-webrtc-unavailable');
    }

    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const connection = new RTCPeerConnectionNative(WEBRTC_CONFIGURATION);
    const MediaStreamCtor = webRtcModule?.MediaStream;
    if (!remoteMediaStreamRef.current && MediaStreamCtor) {
      remoteMediaStreamRef.current = new MediaStreamCtor();
    }
    connection.ontrack = (event) => {
      const bucket = remoteMediaStreamRef.current;
      const track = event.track;
      if (bucket && track && !bucket.getTracks().some((item) => item.id === track.id)) {
        bucket.addTrack(track);
        setRemoteCallStream(bucket);
        return;
      }
      if (event.streams?.[0]) {
        setRemoteCallStream(event.streams[0]);
      }
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        emitCallSignal(call.id, 'ice-candidate', event.candidate.toJSON(), call.peerUserId);
      }
    };
    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'connected' || connection.iceConnectionState === 'completed') {
        setCallError('');
        return;
      }
      if (connection.iceConnectionState !== 'failed') {
        return;
      }
      if (!iceRestartedRef.current) {
        iceRestartedRef.current = true;
        if (typeof connection.restartIce === 'function') {
          connection.restartIce();
          return;
        }
      }
      setCallError('Call media could not connect. Try again on a stronger network.');
    };
    const localStream = await ensureCallMedia(call.kind);
    localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    peerConnectionRef.current = connection;
    return connection;
  };

  const uploadUris = async (uris, options = {}) => {
    if (!uris.length) {
      return [];
    }

    const formData = new FormData();
    uris.forEach((uri, index) => {
      formData.append('files', {
        uri,
        name: options.names?.[index] ?? `upload-${Date.now()}-${index}`,
        type: options.types?.[index] ?? inferMimeType(uri, options.fallbackType),
      });
    });

    const response = await fetch(`${API_BASE_URL}/api/uploads`, {
      method: 'POST',
      body: formData,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    const payload = await response.json();
    return (payload.files ?? []).map((file) => file.url);
  };

  const getStatusItemDuration = (item) =>
    item.assets?.some((asset) => asset.kind === 'video') ? STATUS_VIDEO_DURATION_MS : STATUS_IMAGE_DURATION_MS;

  const getChatTitle = (chat, userId, userMap) => {
    if (chat.kind !== 'direct') {
      return chat.title;
    }

    const others = (chat.participants ?? []).filter((participantId) => participantId !== userId);
    if (chat.kind === 'direct' && !others.length) {
      return 'Message yourself';
    }
    return userMap[others[0]]?.name ?? chat.title;
  };

  const mapChatFromServer = (chat, userId, userMap) => {
    const others = (chat.participants ?? []).filter((participantId) => participantId !== userId);
    const isSelf = chat.kind === 'direct' && !others.length;
    const peerUserId = chat.kind === 'direct' ? (others[0] || (isSelf ? userId : undefined)) : undefined;
    const peer = peerUserId ? userMap[peerUserId] : null;
    return {
      id: chat.id,
      kind: chat.kind,
      name: isSelf ? 'Message yourself' : getChatTitle(chat, userId, userMap),
      preview: chat.lastMessagePreview,
      unread: chat.unreadCount ?? 0,
      presence: isSelf ? 'online' : (peer?.presence ?? 'offline'),
      lastSeenAt: peer?.lastSeenAt,
      time: formatClock(chat.updatedAt ?? new Date().toISOString()),
      peerUserId,
      selfChat: isSelf,
      participants: chat.participants ?? [],
      adminIds: chat.adminIds ?? [],
      space: chat.space && chat.space !== 'personal' ? chat.space : 'personal',
      disappearAfterSeconds: Number(chat.disappearAfterSeconds || 0),
    };
  };

  const mapCallFromServer = (call, userId, userMap) => {
    const peerUserId = (call.participantIds ?? []).find((participantId) => participantId !== userId);
    return {
      id: call.id,
      participantIds: call.participantIds ?? [],
      initiatorId: call.initiatorId ?? call.participantIds?.[0] ?? userId,
      peerUserId,
      name: userMap[peerUserId]?.name ?? 'Call',
      kind: call.kind === 'audio' ? 'Audio' : 'Video',
      state: call.state,
      time: formatClock(call.startedAt),
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds ?? 0,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
    };
  };

  const getUserMeta = (userId) => ({
    name: userId === currentUserId ? 'You' : displayNameFor(userId, usersById[userId]?.name ?? 'ZynkUP'),
    avatar: usersById[userId]?.avatar ?? (userId === currentUserId ? profile.name.slice(0, 2).toUpperCase() : 'ZU'),
  });

  const syncReceiptState = async (messageId, state) => {
    await fetch(`${API_BASE_URL}/api/messages/${messageId}/receipt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }).catch(() => undefined);
  };

  const reconcileIncomingMessage = (chatId, incomingMessage) => {
    setMessagesByChat((current) => {
      const existing = current[chatId] ?? [];
      const existingIndex = existing.findIndex(
        (item) =>
          item.id === incomingMessage.id ||
          (incomingMessage.clientRef && item.clientRef === incomingMessage.clientRef),
      );
      const mapped = mapServerMessage(incomingMessage, currentUserIdRef.current);

      if (existingIndex >= 0) {
        const next = [...existing];
        next[existingIndex] = { ...next[existingIndex], ...mapped };
        return { ...current, [chatId]: next };
      }

      return { ...current, [chatId]: [...existing, mapped] };
    });
  };

  currentUserIdRef.current = currentUserId;
  usersByIdRef.current = usersById;
  chatScreenRef.current = chatScreen;
  selectedChatIdRef.current = selectedChatId;
  profileNameRef.current = profile.name || '';
  currentDeviceIdRef.current = currentDeviceId;

  const upsertStatus = (status) => {
    const knownUsers = usersByIdRef.current;
    const me = currentUserIdRef.current;
    const mappedStatus = {
      ...status,
      author: knownUsers[status.userId]?.name ?? (status.userId === me ? 'You' : 'User'),
      postedAt: formatClock(status.createdAt),
    };

    setStatuses((current) => {
      const index = current.findIndex((item) => item.id === status.id);
      if (index < 0) {
        return [mappedStatus, ...current];
      }
      const next = [...current];
      next[index] = { ...next[index], ...mappedStatus };
      return next;
    });

    setUpdatesFeed((current) =>
      current.some((entry) => entry.userId === status.userId)
        ? current.map((entry) =>
            entry.userId === status.userId
              ? {
                  ...entry,
                  latestAt: entry.items.some((item) => item.id === status.id) ? entry.latestAt : status.createdAt,
                  items: entry.items.some((item) => item.id === status.id)
                    ? entry.items.map((item) => (item.id === status.id ? status : item))
                    : [status, ...entry.items],
                }
              : entry,
          )
        : [
            {
              userId: status.userId,
              name: knownUsers[status.userId]?.name ?? (status.userId === me ? profileNameRef.current : 'Contact'),
              avatar: knownUsers[status.userId]?.avatar ?? (status.userId === me ? (profileNameRef.current || 'ZU').slice(0, 2).toUpperCase() : 'CT'),
              latestAt: status.createdAt,
              items: [status],
            },
            ...current,
          ],
    );
  };

  const revealApp = () => {
    setBootstrapReady(true);
  };

  const applyBootstrapPayload = (payload, options = {}) => {
    const nextCurrentUserId = payload.currentUserId ?? '';
    revealApp();
    setAuthRequired(Boolean(payload.authRequired));
    setAuthVisible(Boolean(payload.authRequired) && !nextCurrentUserId);
    const nextUsersById = Object.fromEntries((payload.users ?? []).map((user) => [user.id, user]));
    if (payload.profile?.photoUri && nextCurrentUserId) {
      nextUsersById[nextCurrentUserId] = {
        ...(nextUsersById[nextCurrentUserId] ?? { id: nextCurrentUserId, name: payload.profile.name, avatar: 'ZU' }),
        photoUri: payload.profile.photoUri,
        name: payload.profile.name || nextUsersById[nextCurrentUserId]?.name,
      };
    }
    setCurrentUserId(nextCurrentUserId);
    setCurrentDeviceId(payload.currentDeviceId ?? null);
    setUsersById(nextUsersById);
    setBusinesses(payload.businesses ?? []);
    setActiveBusinessId(payload.profile?.activeBusinessId || '');
    setChatMode(payload.profile?.activeBusinessId ? 'business' : 'personal');
    setProfile((current) => ({
      ...current,
      name: payload.profile?.name ?? current.name,
      username: payload.profile?.username ?? current.username,
      about: payload.profile?.about ?? current.about,
      phone: payload.profile?.phone ?? current.phone,
      countryCode: payload.profile?.countryCode ?? current.countryCode,
      currency: payload.profile?.currency || currencyForPhone(payload.profile?.phone, payload.profile?.countryCode),
      photoUri: payload.profile?.photoUri || current.photoUri,
      profileVideoUri: payload.profile?.profileVideoUri || '',
      profileVideoPosterUri: payload.profile?.profileVideoPosterUri || '',
      profileVideoDurationSeconds: payload.profile?.profileVideoDurationSeconds || 0,
      blockedUserIds: payload.profile?.blockedUserIds ?? current.blockedUserIds ?? [],
    }));
    if (payload.profile) {
      setAppSettings((current) => {
        const next = {
          ...current,
          lastSeenPrivacy: payload.profile.lastSeenPrivacy ?? current.lastSeenPrivacy,
          profilePhotoPrivacy: payload.profile.profilePhotoPrivacy ?? current.profilePhotoPrivacy,
          aboutPrivacy: payload.profile.aboutPrivacy ?? current.aboutPrivacy,
          statusPrivacy: payload.profile.statusPrivacy ?? current.statusPrivacy,
          typingPrivacy: payload.profile.typingPrivacy ?? current.typingPrivacy,
          callPrivacy: payload.profile.callPrivacy ?? current.callPrivacy,
          groupInvitePrivacy: payload.profile.groupInvitePrivacy ?? current.groupInvitePrivacy,
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
        void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    }
    const nextChats = (payload.chats ?? []).map((chat) => mapChatFromServer(chat, nextCurrentUserId, nextUsersById));
    setChatItems(nextChats);
    setSelectedChatId((current) => (nextChats.some((chat) => chat.id === current) ? current : nextChats[0]?.id ?? ''));
    setContactItems(
      (payload.contacts ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        registered: contact.registered,
        linkedUserId: contact.linkedUserId,
        presence: contact.presence,
      })),
    );
    setMessagesByChat((current) => {
      const next = Object.fromEntries(
        Object.entries(payload.messagesByChat ?? {}).map(([chatId, list]) => [
          chatId,
          list.map((message) => mapServerMessage(message, nextCurrentUserId)),
        ]),
      );
      Object.entries(current).forEach(([chatId, list]) => {
        const pending = (list ?? []).filter((message) => message.receiptState === 'pending');
        if (!pending.length) {
          return;
        }
        const serverList = next[chatId] ?? [];
        const missing = pending.filter(
          (message) => !serverList.some((item) => item.clientRef && item.clientRef === message.clientRef),
        );
        if (missing.length) {
          next[chatId] = [...serverList, ...missing];
        }
      });
      return next;
    });
    Object.values(payload.messagesByChat ?? {})
      .flat()
      .filter((message) => message.senderId !== nextCurrentUserId && message.state === 'sent')
      .slice(-40)
      .forEach((message) => {
        void syncReceiptState(message.id, 'delivered');
      });
    const nextCalls = (payload.calls ?? []).map((call) => mapCallFromServer(call, nextCurrentUserId, nextUsersById));
    setCalls(nextCalls);
    if (!options.preserveCall) {
      const incoming = nextCalls.find((call) => call.state === 'ringing' && call.initiatorId !== nextCurrentUserId) ?? null;
      const liveCall = nextCalls.find((call) => call.state === 'ongoing' || (call.state === 'ringing' && call.initiatorId === nextCurrentUserId)) ?? null;
      setActiveCall(liveCall);
      setIncomingCall(incoming);
    }
    setStatuses(
      (payload.statuses ?? []).map((status) => ({
        ...status,
        author: payload.users?.find((user) => user.id === status.userId)?.name ?? 'User',
        text: status.text || status.assets?.[0]?.caption || 'Media status',
        postedAt: formatClock(status.createdAt),
        assets: status.assets ?? [],
      })),
    );
    setUpdatesFeed(payload.updatesFeed ?? []);
    setChatRequests(payload.chatRequests ?? []);
    setMutualPrivacyReady(Array.isArray(payload.mutualUserIds));
    const nextMutual = Array.isArray(payload.mutualUserIds) ? payload.mutualUserIds : [];
    mutualUserIdsRef.current = nextMutual;
    setMutualUserIds(nextMutual);
    setCatalogItems(
      (payload.catalogItems ?? []).map((item) => ({
        id: item.id,
        sellerId: item.sellerId,
        businessId: item.businessId || null,
        title: item.title,
        price: `${item.currency ?? 'GHS'} ${item.price}`,
        priceAmount: item.price,
        currency: item.currency,
        isPublic: Boolean(item.isPublic),
        category: item.category,
        seller: payload.users?.find((user) => user.id === item.sellerId)?.name ?? 'Seller',
        description: item.description,
        stockQuantity: item.stockQuantity ?? 0,
        trackStock: item.trackStock !== false,
        costPrice: item.costPrice ?? null,
        lowStockThreshold: item.lowStockThreshold ?? 2,
        status: item.status || (item.takenDown ? 'archived' : 'active'),
        variants: item.variants || [],
        availabilityUpdatedAt: item.availabilityUpdatedAt || item.updatedAt || '',
        createdAt: item.createdAt || '',
        location: item.location || '',
        condition: item.condition || 'New',
        takenDown: Boolean(item.takenDown),
        boostedUntil: item.boostedUntil || null,
        boostText: item.boostText || '',
        imageUri: item.imageUrls?.[0] ?? null,
        imageUris: item.imageUrls ?? [],
      })),
    );
    setAppNotice(payload.notice?.text || '');
    if (pinHoldingRef.current) {
      setAuthRequired(true);
      setAuthVisible(true);
      setAuthMode('pin');
    }
    if (nextCurrentUserId) {
      void writeRememberedAccount({
        userId: nextCurrentUserId,
        phone: payload.profile?.phone || '',
        countryCode: payload.profile?.countryCode || '',
        name: payload.profile?.name || '',
        currency: payload.profile?.currency || currencyForPhone(payload.profile?.phone, payload.profile?.countryCode),
        lastActiveAt: Date.now(),
      });
    }
    if (!payload.authRequired && nextCurrentUserId) {
      void syncPhoneContacts(nextCurrentUserId, { quiet: true });
      void fetchLinkedDevices(nextCurrentUserId);
    }
  };

  useEffect(() => {
    if (!currentUserId || authRequired) return;
    void loadCommerceOrders('all', currentUserId);
    void loadSaleReceipts(currentUserId);
    void loadInventoryAlerts(currentUserId);
    void loadBusinessCustomers(currentUserId);
    void loadCustomerPreferences(currentUserId);
    void loadAutoReplyConfig(currentUserId);
    void loadCommerceDocuments(currentUserId);
    void loadBroadcastCampaigns(currentUserId);
  }, [currentUserId, authRequired]);

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
    statusTabRef.current = statusTab;
  }, [statusTab]);

  useEffect(() => {
    let stopped = false;
    const readLock = () => {
      if (!CueSound?.isLocked) {
        return;
      }
      Promise.resolve(CueSound.isLocked())
        .then((locked) => {
          if (!stopped) setPhoneLocked(Boolean(locked));
        })
        .catch(() => undefined);
    };
    readLock();
    const timer = setInterval(readLock, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const armed = activeCall?.kind === 'Video' && activeCall?.state === 'ongoing';
    CueSound?.setCallPipArmed?.(armed);
    return () => CueSound?.setCallPipArmed?.(false);
  }, [activeCall?.id, activeCall?.kind, activeCall?.state]);

  useEffect(() => {
    CueSound?.setShowWhenLocked?.(Boolean(activeCall || incomingCall));
    return () => CueSound?.setShowWhenLocked?.(false);
  }, [activeCall?.id, incomingCall?.id]);

  useEffect(() => {
    activeCallRef.current = activeCall;
    incomingCallRef.current = incomingCall;
  }, [activeCall, incomingCall]);

  const stopEmojiPlayback = () => {
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current = [];
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    safeTtsStop();
    emojiAnim.setValue(0);
    setEmojiPlayback(null);
  };

  const startPulse = () => {
    if (animationRef.current) {
      animationRef.current.stop();
    }

    emojiAnim.setValue(0);
    animationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(emojiAnim, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(emojiAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animationRef.current.start();
  };

  const playEmojiMessage = (message) => {
    const tokens = extractEmojiTokens(message.text);
    if (!tokens.length) {
      return;
    }

    stopEmojiPlayback();
    startPulse();

    const uniqueTokens = [...new Set(tokens)];
    const sequence = uniqueTokens.length === 1 ? [uniqueTokens[0]] : uniqueTokens;
    const duration = uniqueTokens.length === 1 ? 5000 : 3000;

    sequence.forEach((token, index) => {
      const timeout = setTimeout(() => {
        setEmojiPlayback({
          messageId: message.id,
          currentToken: token,
        });

        safeTtsStop();
        if (LAUGHING_EMOJIS.has(token)) {
          safeTtsSpeak('ha ha ha ha', {
            iosVoiceId: undefined,
            rate: 0.5,
          });
        }
      }, index * duration);

      timeoutsRef.current.push(timeout);
    });

    timeoutsRef.current.push(
      setTimeout(() => {
        stopEmojiPlayback();
      }, sequence.length * duration),
    );
  };

  useEffect(() => {
    const autoplayMessage = messages.find(
      (message) =>
        !message.mine &&
        isEmojiOnlyMessage(message.text) &&
        !autoplayedRef.current.has(message.id),
    );

    if (chatScreen === 'detail' && autoplayMessage) {
      autoplayedRef.current.add(autoplayMessage.id);
      playEmojiMessage(autoplayMessage);
    }

    return () => {
      stopEmojiPlayback();
      if (currentSoundRef.current) {
        currentSoundRef.current.removePlayBackListener();
        currentSoundRef.current.removePlaybackEndListener();
        currentSoundRef.current.stopPlayer().catch(() => undefined);
        currentSoundRef.current = null;
      }
    };
  }, [messages, chatScreen, selectedChatId]);

  useEffect(() => {
    let mounted = true;

    if (!CameraKit?.checkDeviceCameraAuthorizationStatus) {
      setCameraPermissionGranted(false);
      return undefined;
    }

    CameraKit.checkDeviceCameraAuthorizationStatus()
      .then((granted) => {
        if (mounted) {
          setCameraPermissionGranted(Boolean(granted));
        }
      })
      .catch(() => {
        if (mounted) {
          setCameraPermissionGranted(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapSession = async () => {
      const storedDeviceId = await AsyncStorage.getItem(DEVICE_STORAGE_KEY);
      const account = await readRememberedAccount();
      const settingsRaw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY).catch(() => null);
      let skipPin = false;
      try {
        skipPin = Boolean(JSON.parse(settingsRaw || '{}').pinDisabled);
      } catch {
        skipPin = false;
      }
      if (account?.userId && account?.phone && !skipPin) {
        const parts = splitStoredPhone(account.phone);
        pinHoldingRef.current = true;
        currentUserIdRef.current = account.userId;
        if (!cancelled) {
          setCurrentUserId(account.userId);
          setAuthForm((current) => ({
            ...current,
            countryCode: account.countryCode || parts.countryCode,
            phone: parts.phone,
            verifiedPhone: account.phone,
            name: account.name || current.name,
            pin: '',
          }));
          setAuthMode('pin');
          setAuthRequired(true);
          setAuthVisible(true);
          revealApp();
        }
      }
      try {
        const response = await fetchWithTimeout(`${API_BASE_URL}/api/session/ensure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: storedDeviceId ?? undefined,
            preferredUserId: account?.userId,
            platform: Platform.OS,
            label: `${Platform.OS} device`,
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
          await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
          setCurrentDeviceId(payload.session.deviceId);
        }
        if (payload.bootstrap) {
          applyBootstrapPayload(payload.bootstrap);
        }
        return;
      } catch {
        const query = storedDeviceId ? `?deviceId=${encodeURIComponent(storedDeviceId)}` : '';
        try {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/bootstrap${query}`);
          const payload = await response.json();
          if (!cancelled) {
            applyBootstrapPayload(payload);
          }
        } catch {
          if (!cancelled) {
            revealApp();
          }
        }
      }
    };

    void bootstrapSession();

    const appStateSub = AppState.addEventListener('change', (state) => {
      const userId = currentUserIdRef.current;
      if (state === 'active') {
        if (userId) {
          socketRef.current?.emit('presence:update', { userId, presence: 'online' });
          socketRef.current?.emit('user:focus', { focused: !uiLockedRef.current && !pinHoldingRef.current });
        }
        if (userId && !activeCallRef.current && !incomingCallRef.current) {
          refreshSessionRef.current();
          flushOutboxRef.current();
        }
        return;
      }
      if (userId) {
        socketRef.current?.emit('presence:update', { userId, presence: 'offline' });
        socketRef.current?.emit('user:focus', { focused: false });
        void writeRememberedAccount({ lastActiveAt: Date.now() });
      }
      const liveCall = activeCallRef.current;
      if (liveCall?.kind === 'Video' && liveCall?.state === 'ongoing') {
        setCallMinimized(false);
        setCallControlsVisible(false);
      }
    });

    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, []);

  useEffect(() => {
    const socket = io(API_BASE_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      if (currentUserIdRef.current) {
        const focused = AppState.currentState === 'active' && !uiLockedRef.current && !pinHoldingRef.current;
        socket.emit('user:join', { userId: currentUserIdRef.current, focused });
        socket.emit('user:focus', { focused });
      }
      flushOutboxRef.current();
      if (!activeCallRef.current && !incomingCallRef.current) {
        refreshSessionRef.current();
      }
    });
    socket.on('call:invite', ({ fromUserId, fromName, kind }) => {
      if (!fromUserId || fromUserId === currentUserIdRef.current || activeCallRef.current || incomingCallRef.current) {
        return;
      }
      Alert.alert(`${fromName || 'Someone'} invited you`, `Join their ${kind || 'audio'} call?`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Call them', onPress: () => { void startCallRef.current(kind === 'Video' ? 'Video' : 'Audio', fromUserId); } },
      ]);
    });
    socket.on('call:peerRinging', ({ callId }) => {
      const currentCall = activeCallRef.current;
      if (currentCall && currentCall.id === callId && currentCall.initiatorId === currentUserIdRef.current) {
        setCallPhase('ringing');
      }
    });
    socket.on('system:ready', (payload) => {
      if (payload.bootstrap && !currentDeviceIdRef.current) {
        applyBootstrapPayload(payload.bootstrap);
      }
    });
    socket.on('message:new', (message) => {
      if (message.sender?.id) {
        const sender = message.sender;
        usersByIdRef.current = {
          ...usersByIdRef.current,
          [sender.id]: { ...(usersByIdRef.current[sender.id] || {}), ...sender },
        };
        setUsersById(usersByIdRef.current);
      }
      reconcileIncomingMessage(message.chatId, message);
      if (message.senderId && message.senderId !== currentUserIdRef.current && message.senderId !== 'anonymous') {
        const sender = message.sender || usersByIdRef.current[message.senderId];
        const senderLabel = sender?.phone
          ? `${sender.phone} · ${sender.name || 'ZynkUP'}`
          : (sender?.name || 'New message');
        setChatItems((current) => {
          if (current.some((item) => item.id === message.chatId)) {
            return current.map((item) => item.id === message.chatId
              ? { ...item, preview: message.text || item.preview, time: 'Now', unread: (item.unread || 0) + 1, peerUserId: item.peerUserId || message.senderId, name: item.name || senderLabel }
              : item);
          }
          return [{
            id: message.chatId,
            kind: 'direct',
            name: senderLabel,
            preview: message.text || 'New message',
            unread: 1,
            time: 'Now',
            peerUserId: message.senderId,
            participants: [currentUserIdRef.current, message.senderId].filter(Boolean),
            adminIds: [],
            presence: 'offline',
          }, ...current];
        });
      }

      if (message.senderId !== currentUserIdRef.current) {
        const settings = appSettingsRef.current;
        const uiLocked = uiLockedRef.current || pinHoldingRef.current;
        const appIsForeground = AppState.currentState === 'active';
        const viewingChat = appIsForeground && !uiLocked && chatScreenRef.current === 'detail' && selectedChatIdRef.current === message.chatId;
        const nextReceipt =
          viewingChat && settings.readReceiptsEnabled ? 'read' : 'delivered';
        void syncReceiptState(message.id, nextReceipt);

        if (
          settings.conversationTones &&
          !mutedChatIdsRef.current.includes(message.chatId)
        ) {
          if (appIsForeground && !uiLocked && !viewingChat) {
            playCueRef.current('receive');
          }
        }

        if (
          settings.messageNotifications &&
          !viewingChat &&
          !mutedChatIdsRef.current.includes(message.chatId)
        ) {
          const lockedChat = lockedChatIdsRef.current.includes(message.chatId);
          const senderName = lockedChat ? 'ZynkUP' : (usersByIdRef.current[message.senderId]?.name || 'New message');
          const preview = settings.showNotificationPreview && !lockedChat
            ? (message.text || (message.kind === 'image' ? 'Photo' : message.kind === 'voice' ? 'Voice message' : 'New message'))
            : 'New message';
          if (appIsForeground && !uiLocked) {
            showToast(`${senderName}: ${preview}`, 'info', settings.conversationTones ? 2800 : 1800);
          }
          if (uiLocked) {
            setLockNotice({ title: senderName, body: preview });
          }
          CueSound?.showMessageNotification?.(senderName, preview);
        }
      }
    });
    socket.on('call:hidden', ({ callId, userId }) => {
      if (!callId || userId !== currentUserIdRef.current) return;
      setCalls((current) => current.filter((item) => item.id !== callId));
    });
    socket.on('message:deleted', ({ message, scope, userId }) => {
      if (!message?.chatId) {
        return;
      }
      if (scope === 'me' && userId !== currentUserIdRef.current) {
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
    socket.on('message:scamWarning', ({ chatId, messageId, warning }) => {
      if (!warning?.risky || !chatId) {
        return;
      }
      presentScamWarningRef.current(chatId, messageId, warning);
    });
    socket.on('typing:update', ({ chatId, userId, typing }) => {
      if (!chatId || userId === currentUserIdRef.current) {
        return;
      }
      setPeerTypingByChat((current) => ({ ...current, [chatId]: Boolean(typing) }));
    });
    socket.on('profile:updated', (updatedProfile) => {
      if (!updatedProfile?.id) {
        return;
      }
      const allows = (privacy) => {
        if (!privacy || privacy === 'everyone') return true;
        if (privacy === 'nobody') return false;
        return mutualUserIdsRef.current.includes(updatedProfile.id);
      };
      const seePhoto = allows(updatedProfile.profilePhotoPrivacy || 'everyone');
      const seeAbout = allows(updatedProfile.aboutPrivacy || 'everyone');
      setUsersById((current) => ({
        ...current,
        [updatedProfile.id]: {
          ...(current[updatedProfile.id] ?? { id: updatedProfile.id, avatar: 'CT' }),
          name: updatedProfile.name || current[updatedProfile.id]?.name,
          about: seeAbout ? (updatedProfile.about ?? current[updatedProfile.id]?.about) : '',
          phone: updatedProfile.phone || current[updatedProfile.id]?.phone,
          photoUri: seePhoto ? (updatedProfile.photoUri || '') : '',
          lastSeenPrivacy: updatedProfile.lastSeenPrivacy || current[updatedProfile.id]?.lastSeenPrivacy || 'everyone',
          profilePhotoPrivacy: updatedProfile.profilePhotoPrivacy || 'everyone',
          aboutPrivacy: updatedProfile.aboutPrivacy || 'everyone',
        },
      }));
      setChatItems((current) =>
        current.map((chat) =>
          chat.peerUserId === updatedProfile.id
            ? { ...chat, name: updatedProfile.name || chat.name, photoUri: seePhoto ? (updatedProfile.photoUri || '') : '' }
            : chat,
        ),
      );
    });
    socket.on('presence:changed', ({ userId, presence, lastSeenAt }) => {
      if (!userId) {
        return;
      }
      setUsersById((current) => {
        const existing = current[userId] ?? { id: userId, name: 'Contact', avatar: 'CT' };
        const privacy = existing.lastSeenPrivacy || 'everyone';
        const allowed = privacy === 'everyone' || (privacy === 'contacts' && mutualUserIdsRef.current.includes(userId));
        const nextPresence = allowed ? presence : 'offline';
        const nextSeen = allowed ? (lastSeenAt ?? existing.lastSeenAt) : undefined;
        setChatItems((chats) =>
          chats.map((chat) =>
            chat.peerUserId === userId
              ? { ...chat, presence: nextPresence, lastSeenAt: nextSeen }
              : chat,
          ),
        );
        return {
          ...current,
          [userId]: {
            ...existing,
            presence: nextPresence,
            lastSeenAt: nextSeen,
          },
        };
      });
    });
    socket.on('chat:deleted', ({ chatId }) => {
      if (!chatId) return;
      setChatItems((current) => current.filter((item) => item.id !== chatId));
      if (selectedChatIdRef.current === chatId) {
        setChatScreen('list');
      }
    });
    socket.on('chat:membership', ({ chatId, userId, removed }) => {
      if (removed && userId === currentUserIdRef.current) {
        setChatItems((current) => current.filter((item) => item.id !== chatId));
        if (selectedChatIdRef.current === chatId) {
          setChatScreen('list');
          showToast('You left the chat room.', 'info');
        }
      }
    });
    socket.on('chat:updated', (chat) => {
      if (chat.viewerUserId && chat.viewerUserId !== currentUserIdRef.current) {
        return;
      }
      const mine = currentUserIdRef.current;
      const includesMe = !chat.participants || chat.participants.includes(mine);
      if (!includesMe) return;
      setChatItems((current) => {
        const exists = current.some((item) => item.id === chat.id);
        if (!exists) {
          if (chat.kind === 'group' && AppState.currentState !== 'active') {
            CueSound?.showMessageNotification?.(chat.title || 'Chat room', 'You were added to a chat room');
          }
          return [mapChatFromServer(chat, mine, usersByIdRef.current), ...current];
        }
        return current.map((item) =>
          item.id === chat.id
            ? {
                ...item,
                name: item.kind === 'group' && chat.title ? chat.title : item.name,
                preview: chat.lastMessagePreview ?? item.preview,
                unread: chat.unreadCount ?? item.unread,
                time: formatClock(chat.updatedAt || new Date().toISOString()),
                participants: chat.participants ?? item.participants,
                adminIds: chat.adminIds ?? item.adminIds,
              }
            : item,
        );
      });
    });
    socket.on('chat:created', (chat) => {
      if (!(chat.participants ?? []).includes(currentUserIdRef.current)) {
        return;
      }

      setChatItems((current) => {
        const mapped = mapChatFromServer(chat, currentUserIdRef.current, usersByIdRef.current);
        if (current.some((item) => item.id === mapped.id)) {
          return current;
        }
        return [mapped, ...current];
      });
    });
    socket.on('status:new', (status) => {
      upsertStatus(status);
    });
    socket.on('status:deleted', ({ statusId }) => {
      setStatuses((current) => current.filter((item) => item.id !== statusId));
      setUpdatesFeed((current) =>
        current
          .map((entry) => {
            const nextItems = entry.items.filter((item) => item.id !== statusId);
            return {
              ...entry,
              items: nextItems,
              latestAt: nextItems[0]?.createdAt ?? null,
            };
          })
          .filter((entry) => entry.items.length > 0),
      );
    });
    socket.on('catalog:itemCreated', (item) => {
      setCatalogItems((current) => {
        if (current.some((entry) => entry.id === item.id)) {
          return current;
        }
        return [
          {
            id: item.id,
            sellerId: item.sellerId,
            businessId: item.businessId || null,
            title: item.title,
            price: `${item.currency || accountCurrency} ${item.price}`,
            priceAmount: item.price,
            currency: item.currency,
            isPublic: Boolean(item.isPublic),
            category: item.category,
            seller: usersByIdRef.current[item.sellerId]?.name || 'Seller',
            description: item.description,
            stockQuantity: item.stockQuantity ?? 0,
            trackStock: item.trackStock !== false,
            status: item.status || 'active',
            variants: item.variants || [],
            availabilityUpdatedAt: item.availabilityUpdatedAt || item.updatedAt || '',
            imageUri: item.imageUrls?.[0] ?? null,
            imageUris: item.imageUrls ?? [],
          },
          ...current,
        ];
      });
    });
    socket.on('catalog:itemUpdated', (item) => {
      setCatalogItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                title: item.title ?? entry.title,
                price: item.price != null ? `${item.currency ?? 'GHS'} ${item.price}` : entry.price,
                priceAmount: item.price ?? entry.priceAmount,
                currency: item.currency ?? entry.currency,
                isPublic: item.isPublic == null ? entry.isPublic : Boolean(item.isPublic),
                category: item.category ?? entry.category,
                description: item.description ?? entry.description,
                stockQuantity: item.stockQuantity ?? entry.stockQuantity ?? 0,
                trackStock: item.trackStock ?? entry.trackStock,
                status: item.status ?? entry.status,
                variants: item.variants ?? entry.variants,
                availabilityUpdatedAt: item.availabilityUpdatedAt ?? entry.availabilityUpdatedAt,
                imageUri: item.imageUrls?.[0] ?? entry.imageUri,
                imageUris: item.imageUrls ?? entry.imageUris,
              }
            : entry,
        ),
      );
    });
    socket.on('order:created', ({ order }) => {
      if (!order?.id) return;
      setCommerceOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)]);
      if (order.sellerUserId === currentUserIdRef.current) {
        showToast(`New order ${order.id}`, 'success');
      }
    });
    socket.on('order:updated', ({ order }) => {
      if (!order?.id) return;
      setCommerceOrders((current) => current.map((entry) => (entry.id === order.id ? order : entry)));
      setOrderDetail((current) => (current?.id === order.id ? order : current));
    });
    socket.on('receipt:created', ({ receipt }) => {
      if (!receipt?.id) return;
      setSaleReceipts((current) => [receipt, ...current.filter((entry) => entry.id !== receipt.id)]);
    });
    socket.on('inventory:alert', (alert) => {
      if (!alert?.id) return;
      setInventoryAlerts((current) => [alert, ...current.filter((entry) => entry.id !== alert.id)]);
      showToast(`${alert.title} is low on stock (${alert.stockQuantity} left).`, 'error', 4200);
    });
    socket.on('customer:updated', ({ customer }) => {
      if (!customer?.id) return;
      if (customer.deletedAt) {
        setBusinessCustomers((current) => current.filter((entry) => entry.id !== customer.id));
        setSelectedCustomer((current) => (current?.id === customer.id ? null : current));
        return;
      }
      setBusinessCustomers((current) => [customer, ...current.filter((entry) => entry.id !== customer.id)]);
      setSelectedCustomer((current) => (current?.id === customer.id ? customer : current));
    });
    socket.on('autoReply:updated', ({ config }) => {
      if (config) setAutoReplyConfig(config);
    });
    socket.on('businessAi:updated', ({ config }) => {
      if (config) setBusinessAiConfig(config);
    });
    socket.on('document:updated', ({ document }) => {
      if (!document?.id) return;
      setCommerceDocuments((current) => [document, ...current.filter((entry) => entry.id !== document.id)]);
      setSelectedDocument((current) => (current?.id === document.id ? document : current));
    });
    socket.on('broadcast:updated', ({ campaign }) => {
      if (!campaign?.id) return;
      setBroadcastCampaigns((current) => [campaign, ...current.filter((entry) => entry.id !== campaign.id)]);
    });
    socket.on('autoReply:sent', ({ log, message: autoMessage }) => {
      if (log?.id) {
        setAutoReplyLogs((current) => [log, ...current.filter((entry) => entry.id !== log.id)].slice(0, 100));
      }
      if (autoMessage?.chatId && autoMessage?.id) {
        setMessagesByChat((current) => ({
          ...current,
          [autoMessage.chatId]: [...(current[autoMessage.chatId] || []).filter((entry) => entry.id !== autoMessage.id), {
            ...autoMessage,
            mine: autoMessage.senderId === currentUserId,
          }],
        }));
      }
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
    socket.on('message:transcript', ({ message }) => {
      if (!message?.chatId || !message?.id) {
        return;
      }
      reconcileIncomingMessage(message.chatId, message);
    });
    socket.on('status:updated', (status) => {
      upsertStatus(status);
    });
    socket.on('call:created', (call) => {
      if ((call.participantIds ?? []).includes(currentUserIdRef.current)) {
        upsertCall(call);
      }
    });
    socket.on('call:incoming', (call) => {
      if ((call.participantIds ?? []).includes(currentUserIdRef.current)) {
        upsertCall(call);
      }
    });
    socket.on('call:updated', (call) => {
      if ((call.participantIds ?? []).includes(currentUserIdRef.current)) {
        upsertCall(call);
      }
    });
    socket.on('call:participantJoined', ({ callId, userId }) => {
      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.id !== callId || currentCall.initiatorId !== currentUserIdRef.current) {
        return;
      }

      void (async () => {
        try {
          const connection = await ensurePeerConnection(currentCall);
          if (connection.localDescription) {
            return;
          }
          const offer = await connection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: currentCall.kind === 'Video',
          });
          await connection.setLocalDescription(offer);
          emitCallSignal(callId, 'offer', offer, userId);
        } catch {
          setCallError('Unable to start call media.');
        }
      })();
    });
    socket.on('call:signal', ({ callId, fromUserId, signalType, payload }) => {
      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.id !== callId) {
        return;
      }

      signalChainRef.current = signalChainRef.current.then(async () => {
        try {
          const connection = await ensurePeerConnection(currentCall);
          if (signalType === 'offer') {
            if (connection.signalingState === 'have-local-offer') {
              return;
            }
            if (connection.remoteDescription?.sdp && connection.remoteDescription.sdp === payload?.sdp) {
              return;
            }
            await connection.setRemoteDescription(new RTCSessionDescriptionNative(payload));
            remoteReadyRef.current = true;
            await flushQueuedIce(connection);
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            emitCallSignal(callId, 'answer', answer, fromUserId);
            return;
          }

          if (signalType === 'answer') {
            if (connection.signalingState === 'stable' && connection.remoteDescription) {
              return;
            }
            await connection.setRemoteDescription(new RTCSessionDescriptionNative(payload));
            remoteReadyRef.current = true;
            await flushQueuedIce(connection);
            return;
          }

          if (signalType === 'camera') {
            setRemoteCameraOff(payload?.enabled === false);
            return;
          }

          if (signalType === 'video-upgrade') {
            Alert.alert('Switch to video?', 'The other person wants to turn this into a video call.', [
              { text: 'Stay on audio', style: 'cancel' },
              {
                text: 'Accept',
                onPress: () => {
                  emitCallSignal(callId, 'video-upgrade-accept', { accepted: true }, fromUserId);
                  void enableVideoOnCall().catch((error) => setCallError(error?.message === 'permission-denied' ? 'Camera permission was denied.' : 'The camera did not start. Try the video switch again.'));
                },
              },
            ]);
            return;
          }

          if (signalType === 'video-upgrade-accept') {
            void enableVideoOnCall().catch((error) => setCallError(error?.message === 'permission-denied' ? 'Camera permission was denied.' : 'The camera did not start. Try the video switch again.'));
            return;
          }

          if (signalType === 'ice-candidate' && payload) {
            if (!remoteReadyRef.current || !connection.remoteDescription) {
              pendingIceRef.current.push(payload);
              return;
            }
            await connection.addIceCandidate(new RTCIceCandidateNative(payload));
          }
        } catch {
          setCallError('Call signaling lost sync.');
        }
      }).catch(() => undefined);
    });

    if (currentUserIdRef.current && AppState.currentState === 'active') {
      socket.emit('presence:update', { userId: currentUserIdRef.current, presence: 'online' });
    }

    return () => {
      if (currentUserIdRef.current) {
        socket.emit('presence:update', { userId: currentUserIdRef.current, presence: 'offline' });
      }
      socket.disconnect();
    };
  }, [currentUserId]);

  useEffect(() => {
    void (async () => {
      try {
        const [storedSettings, storedFavorites, storedMuted, storedArchived, storedLocked, storedPin, storedCards] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_STORAGE_KEY),
          AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
          AsyncStorage.getItem(MUTED_CHATS_STORAGE_KEY),
          AsyncStorage.getItem(ARCHIVED_CHATS_STORAGE_KEY),
          AsyncStorage.getItem(LOCKED_CHATS_STORAGE_KEY),
          AsyncStorage.getItem(APP_LOCK_PIN_KEY),
          AsyncStorage.getItem(DISMISSED_CARDS_KEY),
        ]);
        let nextSettings = { ...DEFAULT_APP_SETTINGS };
        if (storedSettings) {
          nextSettings = { ...nextSettings, ...JSON.parse(storedSettings) };
          appSettingsRef.current = nextSettings;
          setAppSettings(nextSettings);
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
        if (storedLocked) {
          const parsed = JSON.parse(storedLocked);
          if (Array.isArray(parsed)) {
            lockedChatIdsRef.current = parsed;
            setLockedChatIds(parsed);
          }
        }
        if (storedPin && /^\d{4,6}$/.test(storedPin)) {
          setAppLockPin(storedPin);
        }
        if (storedCards) {
          const parsed = JSON.parse(storedCards);
          if (Array.isArray(parsed)) {
            setDismissedCards(parsed);
          }
        }
        if (!nextSettings.pinDisabled && nextSettings.appLockEnabled && storedPin && /^\d{4,6}$/.test(storedPin)) {
          setAppUnlocked(false);
        }
      } catch {
        // Keep defaults when storage is unavailable.
      }
    })();
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || chatScreen !== 'detail' || !selectedChatId) {
      return undefined;
    }
    socket.emit('chat:join', selectedChatId);
    clearChatUnread(selectedChatId);
    return () => {
      socket.emit('chat:leave', selectedChatId);
      emitTyping(false);
    };
  }, [chatScreen, selectedChatId]);

  useEffect(() => {
    if (AppState.currentState !== 'active' || chatScreen !== 'detail' || !appSettings.readReceiptsEnabled) {
      return;
    }

    (messagesByChat[selectedChatId] ?? [])
      .filter((message) => !message.mine && message.receiptState !== 'read')
      .forEach((message) => {
        void syncReceiptState(message.id, 'read');
      });
  }, [appSettings.readReceiptsEnabled, chatScreen, messagesByChat, selectedChatId]);

  useEffect(() => {
    if (!activeStatusItem) {
      return undefined;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    }).catch(() => undefined);
    if (activeStatusItem.userId && activeStatusItem.userId !== currentUserId) {
      setSeenStatusIds((current) => {
        if (current.includes(activeStatusItem.id)) {
          return current;
        }
        const next = [...current, activeStatusItem.id].slice(-500);
        void AsyncStorage.setItem(SEEN_STATUS_KEY, JSON.stringify(next));
        return next;
      });
    }
  }, [activeStatusItem?.id, activeStatusItem?.userId, currentUserId]);

  useEffect(() => {
    if (!activeStatusItem?.id) {
      setStatusProgress(0);
      setStatusElapsedMs(0);
      return;
    }

    setStatusProgress(0);
    setStatusElapsedMs(0);
  }, [activeStatusItem?.id]);

  useEffect(() => {
    if (!activeStatusItem || statusPlaybackPaused) {
      return undefined;
    }

    const duration = getStatusItemDuration(activeStatusItem);
    const timer = setInterval(() => {
      setStatusElapsedMs((current) => {
        const nextValue = current + 80;
        if (nextValue >= duration) {
          clearInterval(timer);
          setStatusProgress(1);
          setTimeout(() => moveStatus('next'), 0);
          return duration;
        }
        return nextValue;
      });
    }, 80);

    return () => clearInterval(timer);
  }, [activeStatusItem, statusPlaybackPaused]);

  useEffect(() => {
    if (!activeStatusItem) {
      setStatusProgress(0);
      return;
    }

    const duration = getStatusItemDuration(activeStatusItem);
    setStatusProgress(Math.min(1, statusElapsedMs / duration));
  }, [activeStatusItem, statusElapsedMs]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ongoing') {
      setActiveCallSeconds(0);
      return undefined;
    }

    const baseSeconds = activeCall.durationSeconds ?? 0;
    setActiveCallSeconds(baseSeconds);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setActiveCallSeconds(baseSeconds + Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [activeCall]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ongoing' || activeCall.initiatorId !== currentUserId) {
      return undefined;
    }
    const call = activeCall;
    const timer = setTimeout(() => {
      if (peerConnectionRef.current?.localDescription || peerConnectionRef.current?.remoteDescription) {
        return;
      }
      void (async () => {
        try {
          const connection = await ensurePeerConnection(call);
          if (connection.localDescription || connection.remoteDescription) {
            return;
          }
          const offer = await connection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: call.kind === 'Video',
          });
          await connection.setLocalDescription(offer);
          emitCallSignal(call.id, 'offer', offer, call.peerUserId);
        } catch {
          setCallError('Unable to start call media.');
        }
      })();
    }, 40);
    return () => clearTimeout(timer);
  }, [activeCall?.id, activeCall?.state, activeCall?.initiatorId, currentUserId]);

  useEffect(() => {
    const callId = activeCall?.id;
    if (!callId || !socketRef.current) {
      return undefined;
    }

    setCallError('');
    socketRef.current.emit('call:join', { callId, userId: currentUserId });
    socketRef.current.emit('user:join', { userId: currentUserId });

    return () => {
      socketRef.current?.emit('call:leave', { callId, userId: currentUserId });
      closePeerConnection();
    };
  }, [activeCall?.id, currentUserId]);

  const appendMessage = (message) => {
    setMessagesByChat((current) => ({
      ...current,
      [selectedChatId]: [...(current[selectedChatId] ?? []), message],
    }));
  };

  const upsertCall = (incomingCallPayload) => {
    const caller = incomingCallPayload?.caller;
    const userMap = caller?.id
      ? {
          ...usersByIdRef.current,
          [caller.id]: { ...(usersByIdRef.current[caller.id] || {}), ...caller },
        }
      : usersByIdRef.current;
    if (caller?.id) {
      usersByIdRef.current = userMap;
      setUsersById(userMap);
    }
    const mapped = mapCallFromServer(incomingCallPayload, currentUserIdRef.current || currentUserId, userMap);
    if (caller?.phone && mapped.initiatorId !== (currentUserIdRef.current || currentUserId)) {
      mapped.name = `${caller.phone} · ${caller.name || 'ZynkUP'}`;
    }
    setCalls((current) => {
      const existingIndex = current.findIndex((item) => item.id === mapped.id);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = mapped;
        return next;
      }
      return [mapped, ...current];
    });

    if (mapped.state === 'ringing' && mapped.initiatorId !== (currentUserIdRef.current || currentUserId)) {
      setIncomingCall(mapped);
      setActiveCall((current) => (current?.id === mapped.id ? null : current));
      const callerLabel = mapped.name || 'Incoming call';
      CueSound?.showIncomingCall?.(callerLabel, mapped.kind === 'Video' ? 'Incoming video call' : 'Incoming voice call');
      if (AppState.currentState !== 'active') {
        CueSound?.setShowWhenLocked?.(true);
      }
    } else if (mapped.state === 'ongoing' || (mapped.state === 'ringing' && mapped.initiatorId === (currentUserIdRef.current || currentUserId))) {
      setIncomingCall((current) => (current?.id === mapped.id ? null : current));
      setActiveCall(mapped);
      if (mapped.state === 'ongoing') {
        CueSound?.hideIncomingCall?.();
      }
    }
    if (['completed', 'missed', 'declined'].includes(mapped.state)) {
      setIncomingCall((current) => (current?.id === mapped.id ? null : current));
      setActiveCall((current) => (current?.id === mapped.id ? null : current));
      CueSound?.hideIncomingCall?.();
      if (systemCallIdRef.current === mapped.id) {
        CueSound?.endSystemCall?.(mapped.state === 'completed' ? 'completed' : mapped.state);
        systemCallIdRef.current = '';
      }
    }
  };

  const updateCallState = async (callId, state, durationSeconds) => {
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

  const closeStatusViewer = () => {
    setActiveStatusGroupIndex(null);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
    setStatusElapsedMs(0);
    setStatusThreadVisible(false);
    setStatusReplyVisible(false);
    setStatusViewersVisible(false);
    setStatusReactorsVisible(false);
    setStatusHoldActive(false);
    setStatusCommentDraft('');
    setEditingStatusCommentId(null);
    setEditingStatusCommentText('');
  };

  const openStatusViewer = (groupIndex) => {
    setActiveStatusGroupIndex(groupIndex);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
    setStatusElapsedMs(0);
    setStatusCommentDraft('');
    setStatusViewersVisible(false);
    setStatusThreadVisible(false);
    setStatusReplyVisible(false);
    setStatusReactorsVisible(false);
    setEditingStatusCommentId(null);
  };

  closeStatusViewerRef.current = closeStatusViewer;
  navigationStateRef.current = {
    chatScreen,
    activeView,
    chatListTab,
    settingsPanel,
    chatMenuVisible,
    summarySheetVisible,
    dictateSheetVisible,
    aiHelperSheetVisible,
    peerProfileVisible,
    avatarPrompt,
    photoPreview,
    mediaViewer,
    callSheetVisible,
    newChatVisible,
    activeStatusGroupIndex,
    incomingCall,
    activeCall,
  };

  useEffect(() => {
    if (!currentUserId || Platform.OS !== 'android') {
      return undefined;
    }
    const permissions = [
      Platform.Version >= 33 ? PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS : null,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ].filter(Boolean);
    void PermissionsAndroid.requestMultiple(permissions);
    CueSound?.prepareAlerts?.();
    CueSound?.startInboxService?.();
    const messaging = loadOptionalModule(() => require('@react-native-firebase/messaging').default);
    if (messaging && currentDeviceId) {
      void (async () => {
        try {
          await messaging().requestPermission();
          const token = await messaging().getToken();
          if (!token) return;
          await fetch(`${API_BASE_URL}/api/devices/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: currentDeviceId, token }),
          });
        } catch {
          // Push starts once this install includes the messaging module.
        }
      })();
    }
    return () => {
      CueSound?.stopInboxService?.();
    };
  }, [currentUserId, currentDeviceId]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      const windowHeight = Dimensions.get('window').height;
      const screenY = event?.endCoordinates?.screenY ?? windowHeight;
      const reported = event?.endCoordinates?.height ?? 0;
      const overlap = Math.max(reported, windowHeight - screenY);
      setKeyboardInset(overlap > 0 ? overlap + 16 : 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardInset(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const call = activeCall || incomingCall;
    if (!call || phoneLocked || (call.state !== 'ringing' && call.state !== 'ongoing')) {
      return undefined;
    }
    void ensureCallMedia(call.kind).then(() => {
      if (String(call.kind).toLowerCase() === 'video') {
        setCallCameraOff(false);
        setCallError('');
      }
    }).catch((error) => {
      if (String(call.kind).toLowerCase() === 'video') {
        setCallCameraOff(true);
      }
      if (String(call.kind).toLowerCase() === 'video' || call.state === 'ongoing') {
        setCallError(error?.message === 'permission-denied'
          ? 'Camera or microphone permission was denied. Allow them in phone settings.'
          : 'The camera did not start. Tap Camera to try again.');
      }
    });
    return undefined;
  }, [activeCall?.id, activeCall?.state, activeCall?.kind, incomingCall?.id, incomingCall?.state, incomingCall?.kind, phoneLocked]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = navigationStateRef.current;
      if (state.photoPreview) {
        setPhotoPreview(null);
        return true;
      }
      if (state.avatarPrompt) {
        setAvatarPrompt(null);
        return true;
      }
      if (state.peerProfileVisible) {
        setPeerProfileVisible(false);
        return true;
      }
      if (state.chatMenuVisible) {
        setChatMenuVisible(false);
        return true;
      }
      if (state.summarySheetVisible) {
        setSummarySheetVisible(false);
        return true;
      }
      if (state.dictateSheetVisible) {
        setDictateSheetVisible(false);
        return true;
      }
      if (state.aiHelperSheetVisible) {
        setAiHelperSheetVisible(false);
        return true;
      }
      if (state.mediaViewer) {
        setMediaViewer(null);
        return true;
      }
      if (state.callSheetVisible) {
        setCallSheetVisible(false);
        return true;
      }
      if (state.newChatVisible) {
        setNewChatVisible(false);
        return true;
      }
      if (state.activeStatusGroupIndex != null) {
        closeStatusViewerRef.current();
        return true;
      }
      if (state.incomingCall || state.activeCall) {
        return true;
      }
      if (state.settingsPanel) {
        setSettingsPanel('');
        return true;
      }
      if (state.chatScreen === 'detail') {
        setChatScreen('list');
        return true;
      }
      if (state.activeView === 'Chats' && state.chatListTab === 'calls') {
        setChatListTab('recent');
        return true;
      }
      if (state.activeView !== 'Chats') {
        setActiveView('Chats');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isRecording || recordingPaused) {
      recordPulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordPulse, { toValue: 0.35, duration: 520, useNativeDriver: true }),
        Animated.timing(recordPulse, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, recordingPaused, recordPulse]);

  useEffect(() => {
    if (activeCall?.id) {
      setCallPhase('calling');
    }
  }, [activeCall?.id]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ringing' || activeCall.initiatorId !== currentUserId) {
      return;
    }
    if (usersById[activeCall.peerUserId]?.presence === 'online') {
      setCallPhase('ringing');
    }
  }, [activeCall?.id, activeCall?.state, activeCall?.initiatorId, activeCall?.peerUserId, usersById]);

  useEffect(() => {
    if (!incomingCall || incomingCall.state !== 'ringing') {
      return;
    }
    socketRef.current?.emit('call:ringing', {
      callId: incomingCall.id,
      userId: currentUserId,
      initiatorId: incomingCall.initiatorId,
    });
  }, [incomingCall?.id, incomingCall?.state, currentUserId]);

  useEffect(() => {
    const locked = (authVisible && authMode === 'pin') || (appSettings.appLockEnabled && !appUnlocked && Boolean(appLockPin));
    uiLockedRef.current = locked;
    if (!locked) {
      setLockNotice(null);
    }
    const focused = AppState.currentState === 'active' && !locked && !pinHoldingRef.current;
    socketRef.current?.emit('user:focus', { focused });
  }, [authVisible, authMode, appSettings.appLockEnabled, appUnlocked, appLockPin]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const live = incomingCall?.state === 'ringing'
      ? incomingCall
      : activeCall && (activeCall.state === 'ringing' || activeCall.state === 'ongoing')
        ? activeCall
        : null;
    if (!live) return undefined;
    if (systemCallIdRef.current !== live.id) {
      systemCallIdRef.current = live.id;
      CueSound?.beginSystemCall?.(live.initiatorId !== currentUserId, live.name || 'ZynkUP');
    }
    if (live.state === 'ongoing') {
      CueSound?.answerSystemCall?.();
    }
    return undefined;
  }, [incomingCall?.id, incomingCall?.state, incomingCall?.initiatorId, activeCall?.id, activeCall?.state, activeCall?.initiatorId, currentUserId]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ongoing') {
      setCallMinimized(false);
      return undefined;
    }
    let cancelled = false;
    const applyRoute = () => {
      if (!cancelled) {
        CueSound?.setSpeaker?.(callSpeakerOnRef.current);
      }
    };
    void ensureCallMedia(activeCall.kind).then(() => {
      applyRoute();
    }).catch((error) => {
      setCallError(error?.message === 'permission-denied'
        ? 'Camera or microphone permission was denied.'
        : 'The camera did not start. Tap Camera to try again.');
    });
    const routeTimers = [400, 1200, 2200].map((delay) => setTimeout(applyRoute, delay));
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    CueSound?.showOngoingCall?.(activeCall.name || 'Call', activeCall.kind === 'Video');
    revealCallControls();
    return () => {
      cancelled = true;
      routeTimers.forEach((timer) => clearTimeout(timer));
      CueSound?.hideOngoingCall?.();
      CueSound?.resetAudioRoute?.();
    };
  }, [activeCall?.id, activeCall?.state, activeCall?.kind]);

  useEffect(() => {
    if (activeView !== 'Explore' || exploreSection === 'status' || !currentUserId) {
      return undefined;
    }
    let cancelled = false;
    const load = async () => {
      setExploreBusy(true);
      try {
        if (exploreSection === 'community') {
          const response = await fetch(`${API_BASE_URL}/api/communities?userId=${encodeURIComponent(currentUserId)}`);
          const payload = await response.json().catch(() => ({}));
          if (!cancelled && response.ok) {
            setCommunitiesMine(payload.mine || []);
            setCommunitiesDiscover(payload.discoverable || []);
          }
        } else if (exploreSection === 'events') {
          const response = await fetch(`${API_BASE_URL}/api/events?userId=${encodeURIComponent(currentUserId)}`);
          const payload = await response.json().catch(() => ({}));
          if (!cancelled && response.ok) {
            setCommunityEvents(payload.events || []);
          }
        } else if (exploreSection === 'games') {
          const response = await fetch(`${API_BASE_URL}/api/games`);
          const payload = await response.json().catch(() => ({}));
          if (!cancelled && response.ok) {
            setGameCatalog(payload.games || []);
          }
        }
      } catch {
        if (!cancelled) {
          showToast('Could not load that section.', 'error');
        }
      } finally {
        if (!cancelled) {
          setExploreBusy(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeView, exploreSection, currentUserId, exploreReload]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== 'ringing' || activeCall.initiatorId !== currentUserId) {
      return undefined;
    }
    const callId = activeCall.id;
    const timer = setTimeout(() => {
      void updateCallState(callId, 'missed', 0);
    }, 60000);
    return () => clearTimeout(timer);
  }, [activeCall?.id, activeCall?.state, activeCall?.initiatorId]);

  useEffect(() => {
    const incomingRing = Boolean(incomingCall && incomingCall.state === 'ringing' && incomingCall.initiatorId !== currentUserId);
    const outgoingRing = Boolean(activeCall && activeCall.state === 'ringing' && activeCall.initiatorId === currentUserId);
    if (!incomingRing && !outgoingRing) {
      CueSound?.stop?.();
      Vibration.cancel();
      return undefined;
    }

    const peerOnline = Boolean(activeCall && usersById[activeCall.peerUserId]?.presence === 'online');
    const tone = incomingRing ? 'ringtone' : ((callPhase === 'ringing' || peerOnline) ? 'ringing' : 'calling');
    CueSound?.start?.(tone, true);
    if (incomingRing) {
      Vibration.vibrate([0, 480, 220, 480], true);
    }
    return () => {
      CueSound?.stop?.();
      Vibration.cancel();
    };
  }, [activeCall?.id, activeCall?.state, activeCall?.initiatorId, incomingCall?.id, incomingCall?.state, currentUserId, callPhase]);

  useEffect(() => {
    if (chatScreen !== 'detail') {
      return undefined;
    }
    stickToLatestRef.current = true;
    const timer = setTimeout(() => threadRef.current?.scrollToEnd({ animated: false }), 60);
    return () => clearTimeout(timer);
  }, [chatScreen, selectedChatId]);

  useEffect(() => {
    void AsyncStorage.getItem(SEEN_STATUS_KEY).then((raw) => {
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setSeenStatusIds(parsed);
      }
    }).catch(() => undefined);
    void AsyncStorage.getItem(WALLPAPER_KEY).then((value) => {
      if (value) {
        setChatWallpaper(value);
      }
    }).catch(() => undefined);
    void AsyncStorage.getItem(OUTBOX_STORAGE_KEY).then((raw) => {
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        outboxRef.current = parsed;
        flushOutboxRef.current();
      }
    }).catch(() => undefined);
  }, []);

  const moveStatus = (direction) => {
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
    const itemsIn = (group) => {
      const items = (group?.items ?? []).filter((item) => statusStillLive(item));
      if (!group?.userId || group.userId === currentUserIdRef.current) return items;
      const tab = statusTabRef.current;
      return items.filter((item) => {
        const audience = item?.audience || 'contacts';
        if (tab === 'public') return audience === 'public';
        if (tab === 'marketplace') return audience === 'marketplace' || Boolean(item?.catalogItemId);
        return audience !== 'public' && audience !== 'marketplace';
      });
    };
    const currentItems = itemsIn(currentGroup);

    if (direction === 'previous') {
      if (currentItemIndex > 0) {
        setActiveStatusItemIndex((current) => current - 1);
        setStatusProgress(0);
        setStatusElapsedMs(0);
        return;
      }
      for (let index = currentGroupIndex - 1; index >= 0; index -= 1) {
        const previousItems = itemsIn(feed[index]);
        if (previousItems.length) {
          setActiveStatusGroupIndex(index);
          setActiveStatusItemIndex(previousItems.length - 1);
          setStatusProgress(0);
          setStatusElapsedMs(0);
          return;
        }
      }
      return;
    }

    if (currentItemIndex < currentItems.length - 1) {
      setActiveStatusItemIndex((current) => current + 1);
      setStatusProgress(0);
      setStatusElapsedMs(0);
      return;
    }

    for (let index = currentGroupIndex + 1; index < feed.length; index += 1) {
      if (itemsIn(feed[index]).length) {
        setActiveStatusGroupIndex(index);
        setActiveStatusItemIndex(0);
        setStatusProgress(0);
        setStatusElapsedMs(0);
        return;
      }
    }

    closeStatusViewer();
  };

  const rememberOutbox = async (items) => {
    outboxRef.current = items;
    await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items)).catch(() => undefined);
  };

  const flushOutbox = async () => {
    if (outboxFlushRef.current) {
      return;
    }
    outboxFlushRef.current = true;
    try {
      const queue = [...outboxRef.current];
      for (const entry of queue) {
        try {
          let body = entry.body;
          if (entry.localUri && !(body.mediaUrls ?? []).length) {
            const uploaded = await uploadUris([entry.localUri], {
              names: [entry.uploadName || `upload-${Date.now()}`],
              fallbackType: entry.uploadType || 'application/octet-stream',
            });
            if (!uploaded.length) {
              continue;
            }
            body = { ...body, mediaUrls: uploaded };
          }
          const response = await fetch(`${API_BASE_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            if (response.status === 400 || response.status === 429) {
              const failed = await response.json().catch(() => ({}));
              showToast(failed.error || 'Message was not sent.', 'error', 3600);
              await rememberOutbox(outboxRef.current.filter((item) => item.clientRef !== entry.clientRef));
              setMessagesByChat((current) => ({
                ...current,
                [body.chatId]: (current[body.chatId] ?? []).filter((item) => item.clientRef !== entry.clientRef),
              }));
            }
            continue;
          }
          if (appSettingsRef.current.conversationTones && entry.clientRef && !sentCueRefs.current.has(entry.clientRef)) {
            sentCueRefs.current.add(entry.clientRef);
            playCueRef.current('send');
          }
          const payload = await response.json().catch(() => ({}));
          if (payload.message) {
            reconcileIncomingMessage(body.chatId, payload.message);
          }
          if (payload.scamWarning?.risky) {
            presentScamWarning(
              body.chatId,
              payload.message?.id || entry.clientRef,
              payload.scamWarning,
            );
          }
          await rememberOutbox(outboxRef.current.filter((item) => item.clientRef !== entry.clientRef));
        } catch {
          // Leave the message pending until the network returns.
        }
      }
    } finally {
      outboxFlushRef.current = false;
    }
  };
  flushOutboxRef.current = flushOutbox;

  const queueOutgoing = (body, extras = {}) => {
    const entry = {
      clientRef: body.clientRef,
      body,
      localUri: extras.localUri,
      uploadName: extras.uploadName,
      uploadType: extras.uploadType,
    };
    const next = [...outboxRef.current.filter((item) => item.clientRef !== body.clientRef), entry];
    void rememberOutbox(next);
    void flushOutbox();
  };

  const activeBusiness = businesses.find((item) => item.id === activeBusinessId) || null;
  const identityLabel = activeBusiness?.name || 'Personal';

  const openChat = (chatId) => {
    if (lockedChatIds.includes(chatId)) {
      setUnlockPin('');
      setUnlockChatId(chatId);
      return;
    }
    if (selectedChatId && selectedChatId !== chatId) {
      identityDraftsRef.current[selectedChatId] = messageDraft;
    }
    setSelectedChatId(chatId);
    setMessageDraft(identityDraftsRef.current[chatId] || '');
    setAiSuggestions([]);
    setAiRewriteVariants([]);
    setSummaryResult(null);
    setSummarySheetVisible(false);
    setDictateSheetVisible(false);
    setAiHelperSheetVisible(false);
    setAiHelperPayload(null);
    setScamWarningBanner((current) => (current?.chatId === chatId ? current : null));
    setChatScreen('detail');
  };

  const confirmChatUnlock = () => {
    if (unlockPin !== appLockPin) {
      showToast('That PIN is not right.', 'error', 1800);
      setUnlockPin('');
      return;
    }
    const chatId = unlockChatId;
    setUnlockChatId('');
    setUnlockPin('');
    if (selectedChatId && selectedChatId !== chatId) {
      identityDraftsRef.current[selectedChatId] = messageDraft;
    }
    setSelectedChatId(chatId);
    setMessageDraft(identityDraftsRef.current[chatId] || '');
    setAiSuggestions([]);
    setAiRewriteVariants([]);
    setSummaryResult(null);
    setSummarySheetVisible(false);
    setDictateSheetVisible(false);
    setAiHelperSheetVisible(false);
    setAiHelperPayload(null);
    setScamWarningBanner((current) => (current?.chatId === chatId ? current : null));
    setChatScreen('detail');
  };

  const switchIdentity = async (businessId) => {
    if (selectedChatId) {
      identityDraftsRef.current[selectedChatId] = messageDraft;
    }
    setIdentitySheetVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/api/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, businessId: businessId || '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not switch.', 'error');
        return;
      }
      setActiveBusinessId(businessId || '');
      setChatMode(businessId ? 'business' : 'personal');
      setChatScreen('list');
      showToast(businessId ? 'Switched to this business.' : 'Switched to Personal.', 'success', 1600);
    } catch {
      showToast('Could not switch. Check the connection.', 'error');
    }
  };

  const createBusinessProfile = async (nameInput, descriptionInput, userId = currentUserId) => {
    const name = (nameInput ?? businessDraft.name).trim();
    const description = (descriptionInput ?? businessDraft.description).trim();
    if (name.length < 2) {
      showToast('Enter the business name.', 'error');
      return null;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, name, description }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not create the business.', 'error');
        return null;
      }
      setBusinesses((current) => [payload.business, ...current.filter((item) => item.id !== payload.business.id)]);
      setActiveBusinessId(payload.business.id);
      setChatMode('business');
      setBusinessDraft({
        name: '',
        description: '',
        location: '',
        hours: '',
        contactButtonLabel: 'Chat',
        showPhone: false,
        logoUrl: '',
        verificationNote: '',
      });
      setIdentitySheetVisible(false);
      setProfile((current) => ({
        ...current,
        businessName: payload.business.name,
        businessDescription: payload.business.description || current.businessDescription,
      }));
      showToast(`${payload.business.name} is ready as a draft. Open Storefront to publish.`, 'success', 4200);
      return payload.business;
    } catch {
      showToast('Could not create the business.', 'error');
      return null;
    }
  };

  const openBusinessStorefrontEditor = () => {
    if (!activeBusiness) {
      showToast('Create or switch to a business first.', 'error');
      return;
    }
    setBusinessDraft({
      name: activeBusiness.name || '',
      description: activeBusiness.description || '',
      location: activeBusiness.location || '',
      hours: activeBusiness.hours || '',
      contactButtonLabel: activeBusiness.contactButtonLabel || 'Chat',
      showPhone: Boolean(activeBusiness.showPhone),
      logoUrl: activeBusiness.logoUrl || '',
      verificationNote: activeBusiness.verificationNote || '',
    });
    setBusinessPanel('profile');
  };

  const saveBusinessStorefront = async (extra = {}) => {
    if (!activeBusiness || !currentUserId) {
      showToast('Switch to a business first.', 'error');
      return null;
    }
    const name = (extra.name ?? businessDraft.name).trim();
    if (name.length < 2) {
      showToast('Enter the business name.', 'error');
      return null;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses/${encodeURIComponent(activeBusiness.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          name,
          description: (extra.description ?? businessDraft.description).trim(),
          location: (extra.location ?? businessDraft.location).trim(),
          hours: (extra.hours ?? businessDraft.hours).trim(),
          contactButtonLabel: (extra.contactButtonLabel ?? businessDraft.contactButtonLabel).trim() || 'Chat',
          showPhone: extra.showPhone ?? businessDraft.showPhone,
          logoUrl: (extra.logoUrl ?? businessDraft.logoUrl).trim(),
          visibility: extra.visibility,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save the storefront.', 'error');
        return null;
      }
      setBusinesses((current) => current.map((item) => (item.id === payload.business.id ? payload.business : item)));
      setProfile((current) => ({
        ...current,
        businessName: payload.business.name,
        businessDescription: payload.business.description || current.businessDescription,
      }));
      showToast(
        payload.business.visibility === 'published' ? 'Storefront is public.' : 'Storefront saved.',
        'success',
      );
      return payload.business;
    } catch {
      showToast('Could not save the storefront.', 'error');
      return null;
    }
  };

  const requestBusinessVerification = async () => {
    if (!activeBusiness || !currentUserId) {
      showToast('Switch to a business first.', 'error');
      return;
    }
    if (activeBusiness.ownerUserId !== currentUserId) {
      showToast('Only the owner can request verification.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses/${encodeURIComponent(activeBusiness.id)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          note: businessDraft.verificationNote.trim(),
          evidenceUrls: [],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not submit verification.', 'error');
        return;
      }
      setBusinesses((current) => current.map((item) => (item.id === payload.business.id ? payload.business : item)));
      showToast('Verification submitted. We will review it soon.', 'success', 4200);
    } catch {
      showToast('Could not submit verification.', 'error');
    }
  };

  const openPublicBusiness = async (businessId, ownerUserId) => {
    try {
      let response;
      if (businessId) {
        response = await fetch(
          `${API_BASE_URL}/api/businesses/${encodeURIComponent(businessId)}?userId=${encodeURIComponent(currentUserId || '')}`,
        );
      } else if (ownerUserId) {
        response = await fetch(
          `${API_BASE_URL}/api/businesses/owner/${encodeURIComponent(ownerUserId)}/public?userId=${encodeURIComponent(currentUserId || '')}`,
        );
      } else {
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'This business is not public yet.', 'error');
        return;
      }
      setPublicBusinessView(payload.business);
      setPublicBusinessCatalog(payload.catalogItems || []);
      setBusinessReportDraft('');
    } catch {
      showToast('Could not open this business.', 'error');
    }
  };

  const reportPublicBusiness = async () => {
    if (!publicBusinessView?.id || !currentUserId) return;
    const reason = businessReportDraft.trim();
    if (reason.length < 4) {
      showToast('Tell us why you are reporting this business.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses/${encodeURIComponent(publicBusinessView.id)}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, reason }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not send the report.', 'error');
        return;
      }
      setBusinessReportDraft('');
      showToast('Report sent. Thanks for helping keep ZynkUP safe.', 'success');
    } catch {
      showToast('Could not send the report.', 'error');
    }
  };

  const loadCommerceOrders = async (role = 'all', userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/orders?userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(role)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load orders.', 'error');
        return;
      }
      setCommerceOrders(payload.orders || []);
    } catch {
      showToast('Could not load orders.', 'error');
    }
  };

  const loadSaleReceipts = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/receipts?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load receipts.', 'error');
        return;
      }
      setSaleReceipts(payload.receipts || []);
    } catch {
      showToast('Could not load receipts.', 'error');
    }
  };

  const formatSaleReceiptShare = (receipt) => {
    if (!receipt) return '';
    const lines = (receipt.items || []).map((item) => {
      const variants = (item.variantSelections || []).map((entry) => `${entry.name} ${entry.option}`).join(', ');
      return `- ${item.title}${variants ? ` (${variants})` : ''} x${item.quantity} · ${item.currency} ${item.price}`;
    });
    return [
      `ZynkUP receipt ${receipt.receiptNumber}`,
      receipt.businessName || receipt.sellerName,
      `Buyer: ${receipt.buyerName}`,
      ...lines,
      `Subtotal: ${receipt.currency} ${receipt.subtotal}`,
      receipt.discount ? `Discount: ${receipt.currency} ${receipt.discount}` : null,
      receipt.tax ? `Tax: ${receipt.currency} ${receipt.tax}` : null,
      `Total: ${receipt.currency} ${receipt.totalAmount}`,
      `Payment: ${receipt.paymentMethod} · ${receipt.paymentReference}`,
      `Issued: ${new Date(receipt.issuedAt || receipt.createdAt).toLocaleString()}`,
      `Status: ${receipt.state}`,
    ].filter(Boolean).join('\n');
  };

  const openSaleReceipt = async (receiptId) => {
    if (!receiptId || !currentUserId) return;
    const cached = saleReceipts.find((item) => item.id === receiptId);
    if (cached) {
      setReceiptDetail(cached);
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/receipts/${encodeURIComponent(receiptId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Receipt not found.', 'error');
        return;
      }
      setReceiptDetail(payload.receipt);
      setSaleReceipts((current) => [payload.receipt, ...current.filter((item) => item.id !== payload.receipt.id)]);
    } catch {
      showToast('Could not open receipt.', 'error');
    }
  };

  const updateCommerceOrderState = async (order, nextState, extras = {}) => {
    if (!order?.id || !currentUserId) return;
    try {
      const body = { userId: currentUserId, state: nextState };
      if (extras.deliveryReference !== undefined) {
        body.deliveryReference = extras.deliveryReference || null;
      }
      if (extras.fulfilmentNote !== undefined) {
        body.fulfilmentNote = extras.fulfilmentNote || null;
      }
      const response = await fetch(`${API_BASE_URL}/api/orders/${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update the order.', 'error');
        return;
      }
      setCommerceOrders((current) => current.map((entry) => (entry.id === payload.order.id ? payload.order : entry)));
      setOrderDetail(payload.order);
      setOrderDeliveryDraft({
        deliveryReference: payload.order?.deliveryReference || '',
        fulfilmentNote: payload.order?.fulfilmentNote || '',
      });
      if (payload.receipt) {
        setSaleReceipts((current) => [payload.receipt, ...current.filter((item) => item.id !== payload.receipt.id)]);
        showToast(`Paid. Receipt ${payload.receipt.receiptNumber} issued.`, 'success', 4200);
      } else {
        showToast(`Order marked ${nextState.replace('_', ' ')}.`, 'success');
      }
    } catch {
      showToast('Could not update the order.', 'error');
    }
  };

  const openOrderDetail = (order) => {
    setOrderDetail(order);
    setOrderDeliveryDraft({
      deliveryReference: order?.deliveryReference || '',
      fulfilmentNote: order?.fulfilmentNote || '',
    });
  };

  const runSellerOrderAction = (order, nextState) => {
    const extras = {};
    if (nextState === 'dispatched' || order?.state === 'dispatched' || nextState === 'completed') {
      extras.deliveryReference = orderDeliveryDraft.deliveryReference.trim();
      extras.fulfilmentNote = orderDeliveryDraft.fulfilmentNote.trim();
    }
    void updateCommerceOrderState(order, nextState, extras);
  };

  const orderStateLabel = (state) => String(state || '').replace(/_/g, ' ');

  const sellerOrderActions = (order) => {
    if (order.sellerUserId !== currentUserId) return [];
    if (order.state === 'pending_payment') return [['paid', 'Mark paid'], ['cancelled', 'Cancel']];
    if (order.state === 'paid') return [['processing', 'Start processing'], ['cancelled', 'Cancel']];
    if (order.state === 'processing') return [['dispatched', 'Mark dispatched']];
    if (order.state === 'dispatched') return [['completed', 'Complete']];
    return [];
  };

  const buyerOrderActions = (order) => {
    if (order.buyerUserId !== currentUserId) return [];
    if (order.state === 'pending_payment') return [['cancelled', 'Cancel order']];
    return [];
  };

  const openOrdersPanel = (role = 'seller') => {
    setOrderRoleFilter(role);
    setBusinessPanel('orders');
    void loadCommerceOrders(role);
  };

  const loadSalesDashboard = async (period = salesDashboardPeriod) => {
    if (!currentUserId) return;
    try {
      const query = new URLSearchParams({
        userId: currentUserId,
        period,
      });
      if (activeBusinessId) query.set('businessId', activeBusinessId);
      const response = await fetch(`${API_BASE_URL}/api/sales/dashboard?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load the sales dashboard.', 'error');
        return;
      }
      setSalesDashboard(payload);
      setSalesDashboardPeriod(payload.period || period);
    } catch {
      showToast('Could not load the sales dashboard.', 'error');
    }
  };

  const openSalesDashboard = () => {
    setBusinessPanel('dashboard');
    void loadSalesDashboard(salesDashboardPeriod);
  };

  const moneyLabel = (amount, currency = accountCurrency) =>
    `${currency || ''} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const addBusinessStaff = async () => {
    if (!activeBusiness) {
      showToast('Switch to a business first.', 'error');
      return;
    }
    const phone = staffDraft.phone.trim();
    if (phone.length < 7) {
      showToast('Enter the staff phone number.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/businesses/${encodeURIComponent(activeBusiness.id)}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          phone,
          countryCode: profile.countryCode || '',
          role: staffDraft.role,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not add that person.', 'error');
        return;
      }
      setBusinesses((current) => current.map((item) => (item.id === payload.business.id ? payload.business : item)));
      setStaffDraft({ phone: '', role: 'sales' });
      showToast('Staff member added. They only see this business, not your personal chats.', 'success', 4200);
    } catch {
      showToast('Could not add that person.', 'error');
    }
  };

  const clearAiAssist = () => {
    setAiSuggestions([]);
    setAiRewriteVariants([]);
  };

  const openAiHelperSheet = (task = 'draft') => {
    setAiHelperTask(task);
    setAiHelperPrompt(messageDraft || '');
    setAiHelperConsent(false);
    setAiHelperPayload(null);
    setAiHelperSheetVisible(true);
  };

  const applyAiHelperToDraft = (text) => {
    const next = String(text || '').trim();
    if (!next) {
      showToast('Nothing to put in the draft.', 'info');
      return;
    }
    setMessageDraft(next);
    clearAiAssist();
    setAiHelperSheetVisible(false);
    showToast('Added to draft. Nothing was sent.', 'info', 2600);
  };

  const runAiHelper = async () => {
    if (!currentUserId || aiHelperBusy) return;
    const needsChat = aiHelperTask === 'suggest_reply' || aiHelperTask === 'summarise';
    const shareContext = needsChat || aiHelperConsent;
    if (shareContext && !aiHelperConsent) {
      showToast('Tick consent to share chat context with the assistant.', 'info', 3200);
      return;
    }
    if (needsChat && !selectedChatId) {
      showToast('Open a chat first.', 'info');
      return;
    }
    setAiHelperBusy(true);
    setAiHelperPayload(null);
    try {
      const body = {
        userId: currentUserId,
        task: aiHelperTask,
        prompt: aiHelperPrompt.trim() || undefined,
        text: aiHelperPrompt.trim() || messageDraft.trim() || undefined,
        tone: aiRewriteTone || undefined,
        targetLanguage: aiHelperTask === 'translate' ? aiHelperTargetLang : undefined,
        consentToShareContext: shareContext ? true : false,
      };
      if (shareContext && selectedChatId) {
        body.chatId = selectedChatId;
      }
      if (shareContext && replyTarget?.id) {
        body.messageId = replyTarget.id;
      }
      const response = await fetch(`${API_BASE_URL}/api/ai/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.requiresConsent) {
          showToast(payload.error || 'Consent required to share chat context.', 'info', 3600);
        } else {
          showToast(payload.error || 'AI helper failed.', 'error');
        }
        return;
      }
      setAiHelperPayload(payload);
      if (payload.suggestions?.length) {
        setAiSuggestions(payload.suggestions.slice(0, 4));
        setAiRewriteVariants([]);
      }
      if (payload.result && (aiHelperTask === 'draft' || aiHelperTask === 'rewrite' || aiHelperTask === 'translate')) {
        // Keep in sheet for review — never auto-send.
      }
      if (payload.notice) {
        showToast(payload.notice, 'info', 3200);
      }
    } catch {
      showToast('AI helper failed.', 'error');
    } finally {
      setAiHelperBusy(false);
    }
  };

  const requestSuggestedReplies = async () => {
    if (!selectedChatId || !currentUserId || aiAssistBusy) {
      return;
    }
    setAiAssistBusy(true);
    setAiRewriteVariants([]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/suggest-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          chatId: selectedChatId,
          messageId: replyTarget?.id || undefined,
          tone: aiRewriteTone || 'polite',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not suggest replies.', 'error');
        return;
      }
      const suggestions = (payload.suggestions || []).slice(0, 4);
      setAiSuggestions(suggestions);
      if (payload.notice) {
        showToast(payload.notice, 'info', 3200);
      }
      if (!suggestions.length) {
        showToast('No suggestions available.', 'info');
      }
    } catch {
      showToast('Could not suggest replies.', 'error');
    } finally {
      setAiAssistBusy(false);
    }
  };

  const requestRewriteDraft = async () => {
    const text = messageDraft.trim();
    if (!text || !currentUserId || aiAssistBusy) {
      if (!text) {
        showToast('Type a message first, then rewrite.', 'info');
      }
      return;
    }
    setAiAssistBusy(true);
    setAiSuggestions([]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          tone: aiRewriteTone || 'polite',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not rewrite.', 'error');
        return;
      }
      const variants = payload.variants || [];
      setAiRewriteVariants(variants);
      if (variants.length === 1) {
        setMessageDraft(variants[0].text);
        clearAiAssist();
        showToast('Draft rewritten. Review before sending.', 'success', 2600);
      } else if (variants.length > 1) {
        showToast(payload.notice || 'Pick a rewrite. Nothing is sent automatically.', 'info', 3200);
      } else {
        showToast('No rewrite variants returned.', 'info');
      }
    } catch {
      showToast('Could not rewrite.', 'error');
    } finally {
      setAiAssistBusy(false);
    }
  };

  const applyAiSuggestion = (text) => {
    if (!text) return;
    setMessageDraft(text);
    clearAiAssist();
    showToast('Suggestion added to draft. Nothing was sent.', 'info', 2200);
  };

  const requestVoiceTranscript = async (message) => {
    if (!message?.id || !currentUserId || transcribeBusyId === message.id) {
      return;
    }
    setTranscribeBusyId(message.id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/messages/${encodeURIComponent(message.id)}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      const nextMessage = payload.message;
      if (nextMessage?.id) {
        reconcileIncomingMessage(nextMessage.chatId || message.chatId || selectedChatId, nextMessage);
      }
      if (payload.needsProvider) {
        showToast(payload.notice || 'Speech transcription is not set up yet.', 'info', 3600);
      } else if (!response.ok) {
        showToast(payload.error || 'Could not transcribe this voice note.', 'error');
      } else if (payload.notice && !payload.cached) {
        showToast(payload.notice, 'info', 2600);
      }
    } catch {
      showToast('Could not transcribe this voice note.', 'error');
    } finally {
      setTranscribeBusyId('');
    }
  };

  const requestMessageTranslation = async (message, targetLanguage = 'en') => {
    const text = (message?.text || '').trim();
    if (!text || !currentUserId || !message?.id || translateBusyId === message.id) {
      if (!text) {
        showToast('Nothing to translate on this message.', 'info');
      }
      return;
    }
    setTranslateBusyId(message.id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          targetLanguage,
          sourceLanguage: 'auto',
          messageId: message.id,
          chatId: selectedChatId || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !payload.translatedText) {
        showToast(payload.error || 'Could not translate.', 'error');
        return;
      }
      if (payload.translatedText) {
        setMessageTranslations((current) => ({
          ...current,
          [message.id]: {
            translatedText: payload.translatedText,
            targetLanguage: payload.targetLanguage || targetLanguage,
            method: payload.method,
            partial: Boolean(payload.partial),
            needsProvider: Boolean(payload.needsProvider),
            notice: payload.notice || '',
          },
        }));
      }
      if (payload.needsProvider || payload.partial) {
        showToast(payload.notice || 'Translation may be incomplete.', 'info', 3200);
      } else if (payload.notice) {
        showToast(payload.notice, 'info', 2200);
      }
    } catch {
      showToast('Could not translate.', 'error');
    } finally {
      setTranslateBusyId('');
    }
  };

  const pickTranslateLanguage = (message) => {
    if (!message?.id) {
      return;
    }
    setMessageActionTarget(null);
    setTranslatePickerId(message.id);
  };

  const scrollToMessageId = (messageId) => {
    if (!messageId) {
      return;
    }
    const node = messageNodeRefs.current[messageId];
    const scroller = threadRef.current;
    if (!node || !scroller?.scrollTo) {
      showToast('That message is not in the open thread.', 'info');
      return;
    }
    stickToLatestRef.current = false;
    node.measureLayout(
      scroller,
      (_x, y) => scroller.scrollTo({ y: Math.max(0, y - 24), animated: true }),
      () => showToast('Could not jump to that message.', 'info'),
    );
  };

  const requestChatSummary = async (scope = 'unread') => {
    if (!selectedChatId || !currentUserId || summaryBusy) {
      return;
    }
    setSummaryScope(scope);
    setSummarySheetVisible(true);
    setSummaryBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          chatId: selectedChatId,
          scope,
          limit: scope === 'recent' ? 80 : 120,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not summarise this chat.', 'error');
        return;
      }
      setSummaryResult(payload);
    } catch {
      showToast('Could not summarise this chat.', 'error');
    } finally {
      setSummaryBusy(false);
    }
  };

  const openDictateSheet = () => {
    setDictateDraft(messageDraft);
    setDictateSheetVisible(true);
  };

  const useDictateInComposer = (text) => {
    const next = String(text || '').trim();
    if (!next) {
      showToast('Add dictation text first.', 'info');
      return;
    }
    setMessageDraft(next);
    setDictateSheetVisible(false);
    showToast('Draft filled. Review before send — nothing was sent.', 'info', 2800);
  };

  const normalizeDictateDraft = async () => {
    const text = dictateDraft.trim();
    if (!text || !currentUserId || dictateBusy) {
      if (!text) {
        showToast('Speak with the keyboard mic, or paste text first.', 'info');
      }
      return;
    }
    setDictateBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/dictate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not normalize dictation.', 'error');
        return;
      }
      const next = String(payload.text || text).trim();
      setDictateDraft(next);
      setMessageDraft(next);
      showToast(
        payload.notice || 'Draft updated. Review before send — nothing was sent.',
        'success',
        3000,
      );
    } catch {
      showToast('Could not normalize dictation.', 'error');
    } finally {
      setDictateBusy(false);
    }
  };

  const sendMessage = () => {
    if (!messageDraft.trim() || !selectedChatId) {
      return;
    }
    const chatSpace = activeChat?.space || 'personal';
    const activeSpace = activeBusinessId || 'personal';
    if (chatSpace !== activeSpace) {
      showToast(
        chatSpace === 'personal'
          ? 'This chat is personal. Switch to Personal before you reply.'
          : 'Switch to this business before you reply.',
        'error',
        3600,
      );
      return;
    }

    const text = messageDraft.trim();
    const kind = isEmojiOnlyMessage(text) ? 'emoji' : 'text';
    const clientRef = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message = {
      id: `m${Date.now()}`,
      clientRef,
      mine: true,
      kind,
      text,
      time: 'Now',
      receiptState: 'pending',
      anonymous: Boolean(anonymousCompose && activeChat?.kind === 'group'),
      actorName: activeBusiness?.name || '',
      replyToMessageId: replyTarget?.id,
      replyPreview: replyTarget?.text?.slice(0, 140),
    };

    appendMessage(message);
    emitTyping(false);
    queueOutgoing({
      chatId: selectedChatId,
      senderId: currentUserId,
      clientRef,
      kind,
      text,
      mediaUrls: [],
      anonymous: Boolean(anonymousCompose && activeChat?.kind === 'group'),
      businessId: activeBusinessId || undefined,
      replyToMessageId: replyTarget?.id,
      replyPreview: replyTarget?.text?.slice(0, 140),
    });
    setMessageDraft('');
    setReplyTarget(null);
    setEmojiTrayVisible(false);
    clearAiAssist();

    if (kind === 'emoji') {
      playEmojiMessage(message);
    }
  };

  const addCatalogItem = async () => {
    if (!catalogForm.title.trim() || !catalogForm.price.trim()) {
      Alert.alert('Incomplete item', 'Add at least a title and price for the catalog item.');
      return;
    }

    if (!catalogImageUris.length) {
      showToast('Add a product photo before publishing.', 'error');
      return;
    }

    showToast('Saving catalog item...', 'info', 0);
    const uploadedImageUrls = await uploadUris(catalogImageUris, {
      names: catalogImageUris.map((_, index) => `catalog-${Date.now()}-${index}.jpg`),
      fallbackType: 'image/jpeg',
    }).catch(() => []);
    if (!uploadedImageUrls.length) {
      showToast('Photo upload failed. Check the connection and try again.', 'error', 3600);
      return;
    }

    const variantOptions = catalogForm.variantOptions
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const variants = catalogForm.variantName.trim() && variantOptions.length
      ? [{ id: `v${Date.now()}`, name: catalogForm.variantName.trim(), options: variantOptions }]
      : [];

    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: currentUserId,
          businessId: activeBusinessId || undefined,
          title: catalogForm.title.trim(),
          price: Number.parseFloat(catalogForm.price) || 0,
          currency: accountCurrency,
          category: catalogForm.category,
          description: catalogForm.description.trim() || 'New item from your business catalog.',
          stockQuantity: Number.parseInt(catalogForm.stockQuantity, 10) || 0,
          trackStock: catalogForm.trackStock,
          costPrice: catalogForm.costPrice.trim() === ''
            ? null
            : Number.parseFloat(catalogForm.costPrice),
          lowStockThreshold: Number.parseInt(catalogForm.lowStockThreshold, 10) || 2,
          status: catalogForm.status,
          variants,
          location: catalogForm.location.trim(),
          condition: catalogForm.condition,
          imageUrls: uploadedImageUrls,
          isPublic: catalogForm.status === 'active',
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(payload, 'Could not save catalog item.'), 'error', 3600);
        return;
      }
      showToast(catalogForm.status === 'draft' ? 'Product saved as draft.' : 'Catalog item published.', 'success');
      setCatalogForm({
        title: '',
        price: '',
        category: 'Phones',
        description: '',
        stockQuantity: '1',
        costPrice: '',
        lowStockThreshold: '2',
        location: '',
        condition: 'New',
        status: 'active',
        trackStock: true,
        variantName: '',
        variantOptions: '',
      });
      setCatalogImageUris([]);
    } catch {
      showToast('Network error while saving catalog item.', 'error');
    }
  };

  const setCatalogItemStatus = async (item, status) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update product status.', 'error');
        return;
      }
      if (payload.item) {
        setCatalogItems((current) =>
          current.map((entry) =>
            entry.id === payload.item.id
              ? {
                  ...entry,
                  status: payload.item.status,
                  isPublic: payload.item.isPublic == null ? entry.isPublic : Boolean(payload.item.isPublic),
                  stockQuantity: payload.item.stockQuantity ?? entry.stockQuantity,
                  availabilityUpdatedAt: payload.item.availabilityUpdatedAt,
                }
              : entry,
          ),
        );
      }
      showToast(
        status === 'archived'
          ? 'Product archived.'
          : status === 'draft'
            ? 'Product moved to draft.'
            : status === 'out_of_stock'
              ? 'Marked out of stock.'
              : 'Product is active.',
        'success',
      );
    } catch {
      showToast('Could not update product status.', 'error');
    }
  };

  const mergeCatalogItem = (item) => {
    if (!item?.id) return;
    setCatalogItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              title: item.title ?? entry.title,
              price: item.price != null ? `${item.currency ?? 'GHS'} ${item.price}` : entry.price,
              priceAmount: item.price ?? entry.priceAmount,
              currency: item.currency ?? entry.currency,
              isPublic: item.isPublic == null ? entry.isPublic : Boolean(item.isPublic),
              category: item.category ?? entry.category,
              description: item.description ?? entry.description,
              stockQuantity: item.stockQuantity ?? entry.stockQuantity ?? 0,
              status: item.status ?? entry.status,
              trackStock: item.trackStock ?? entry.trackStock,
              costPrice: item.costPrice ?? entry.costPrice,
              lowStockThreshold: item.lowStockThreshold ?? entry.lowStockThreshold ?? 2,
              variants: item.variants ?? entry.variants,
              availabilityUpdatedAt: item.availabilityUpdatedAt ?? entry.availabilityUpdatedAt,
              imageUri: item.imageUrls?.[0] ?? entry.imageUri,
              imageUris: item.imageUrls ?? entry.imageUris,
            }
          : entry,
      ),
    );
  };

  const adjustCatalogStock = async (itemId, nextStock) => {
    const current = catalogItems.find((entry) => entry.id === itemId);
    const delta = Math.max(0, nextStock) - Number(current?.stockQuantity ?? 0);
    if (!delta || !currentUserId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(itemId)}/stock-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          delta,
          reason: delta > 0 ? 'Stock received' : 'Manual stock adjustment',
          lowStockThreshold: current?.lowStockThreshold,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update stock.', 'error');
        return;
      }
      if (payload.item) mergeCatalogItem(payload.item);
      if (payload.alert) {
        setInventoryAlerts((alerts) => [payload.alert, ...alerts.filter((entry) => entry.id !== payload.alert.id)]);
        showToast(`${payload.alert.title} is low on stock.`, 'error', 3600);
      }
    } catch {
      showToast('Network error while updating stock.', 'error');
    }
  };

  const loadInventoryAlerts = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/inventory/alerts?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setInventoryAlerts(payload.alerts || []);
    } catch {
      // ignore
    }
  };

  const reviewInventoryAlert = async (alertId) => {
    if (!currentUserId || !alertId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/inventory/alerts/${encodeURIComponent(alertId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not review alert.', 'error');
        return;
      }
      setInventoryAlerts((current) => current.map((entry) => (entry.id === payload.alert.id ? payload.alert : entry)));
      showToast('Alert marked reviewed.', 'success');
    } catch {
      showToast('Could not review alert.', 'error');
    }
  };

  const loadBusinessCustomers = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setBusinessCustomers(payload.customers || []);
    } catch {
      // ignore
    }
  };

  const loadCustomerDetail = async (customerId) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not open customer.', 'error');
        return;
      }
      setSelectedCustomer(payload.customer || null);
      setCustomerOrders(payload.orders || []);
      setCustomerNoteDraft('');
    } catch {
      showToast('Could not open customer.', 'error');
    }
  };

  const createBusinessCustomer = async () => {
    if (!currentUserId) return;
    const displayName = customerForm.displayName.trim();
    if (!displayName) {
      showToast('Add a customer name.', 'error');
      return;
    }
    const tags = customerForm.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
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
          followUpAt: customerForm.followUpAt.trim() || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save customer.', 'error');
        return;
      }
      if (payload.customer) {
        setBusinessCustomers((current) => [payload.customer, ...current.filter((entry) => entry.id !== payload.customer.id)]);
      }
      setCustomerForm({ displayName: '', phone: '', tags: '', note: '', followUpAt: '' });
      showToast(payload.existing ? 'Customer record updated.' : 'Customer saved.', 'success');
    } catch {
      showToast('Could not save customer.', 'error');
    }
  };

  const addCustomerNote = async (customerId) => {
    const text = customerNoteDraft.trim();
    if (!currentUserId || !customerId || !text) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not add note.', 'error');
        return;
      }
      if (payload.customer) {
        setSelectedCustomer(payload.customer);
        setBusinessCustomers((current) => [payload.customer, ...current.filter((entry) => entry.id !== payload.customer.id)]);
      }
      setCustomerNoteDraft('');
      showToast('Note added.', 'success');
    } catch {
      showToast('Could not add note.', 'error');
    }
  };

  const updateBusinessCustomer = async (customerId, patch) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, ...patch }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update customer.', 'error');
        return;
      }
      if (payload.customer) {
        setSelectedCustomer(payload.customer);
        setBusinessCustomers((current) => [payload.customer, ...current.filter((entry) => entry.id !== payload.customer.id)]);
      }
      showToast('Customer updated.', 'success');
    } catch {
      showToast('Could not update customer.', 'error');
    }
  };

  const deleteBusinessCustomer = async (customerId) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/customers/${encodeURIComponent(customerId)}?userId=${encodeURIComponent(currentUserId)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not delete customer.', 'error');
        return;
      }
      setBusinessCustomers((current) => current.filter((entry) => entry.id !== customerId));
      setSelectedCustomer(null);
      setCustomerOrders([]);
      showToast('Customer record removed.', 'success');
    } catch {
      showToast('Could not delete customer.', 'error');
    }
  };

  const loadCustomerPreferences = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/me/customer-preferences?userId=${encodeURIComponent(userId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setCustomerPrefs(payload.preferences || []);
    } catch {
      // ignore
    }
  };

  const updateMyMarketingPreference = async (customerId, marketingConsent) => {
    if (!currentUserId || !customerId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/me/customer-preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, customerId, marketingConsent }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not update preference.', 'error');
        return;
      }
      setCustomerPrefs((current) =>
        current.map((entry) =>
          entry.customerId === customerId
            ? {
                ...entry,
                marketingConsent: payload.preference?.marketingConsent || marketingConsent,
                marketingConsentUpdatedAt: payload.preference?.marketingConsentUpdatedAt || entry.marketingConsentUpdatedAt,
              }
            : entry,
        ),
      );
      showToast(marketingConsent === 'opted_in' ? 'Opted in to marketing.' : 'Opted out of marketing.', 'success');
    } catch {
      showToast('Could not update preference.', 'error');
    }
  };

  const loadAutoReplyConfig = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/auto-replies?userId=${encodeURIComponent(userId)}`);
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
      const response = await fetch(`${API_BASE_URL}/api/auto-replies/logs?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setAutoReplyLogs(payload.logs || []);
    } catch {
      // ignore
    }
  };

  const saveAutoReplyConfig = async (patch = {}) => {
    if (!currentUserId) return;
    const base = autoReplyConfig || {};
    try {
      const response = await fetch(`${API_BASE_URL}/api/auto-replies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          enabled: base.enabled,
          greetingEnabled: base.greetingEnabled,
          greetingText: base.greetingText,
          awayEnabled: base.awayEnabled,
          awayText: base.awayText,
          hoursText: base.hoursText,
          humanHandoverKeywords: base.humanHandoverKeywords,
          rules: base.rules || [],
          cooldownSeconds: base.cooldownSeconds,
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save auto-replies.', 'error');
        return;
      }
      setAutoReplyConfig(payload.config || null);
      showToast('Auto-replies saved.', 'success');
    } catch {
      showToast('Could not save auto-replies.', 'error');
    }
  };

  const addAutoReplyRule = async () => {
    const keywords = autoReplyRuleDraft.keywords
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const response = autoReplyRuleDraft.response.trim();
    if (!keywords.length || !response) {
      showToast('Add keywords and a response.', 'error');
      return;
    }
    const rules = [
      ...(autoReplyConfig?.rules || []),
      { id: `rule-${Date.now()}`, keywords, response, enabled: true },
    ];
    setAutoReplyRuleDraft({ keywords: '', response: '' });
    await saveAutoReplyConfig({ rules });
  };

  const removeAutoReplyRule = async (ruleId) => {
    const rules = (autoReplyConfig?.rules || []).filter((rule) => rule.id !== ruleId);
    await saveAutoReplyConfig({ rules });
  };

  const loadBusinessAiConfig = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const query = new URLSearchParams({ userId });
      if (activeBusinessId) query.set('businessId', activeBusinessId);
      const response = await fetch(`${API_BASE_URL}/api/ai/business?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setBusinessAiConfig(payload.config || null);
    } catch {
      // ignore
    }
  };

  const saveBusinessAiConfig = async (patch = {}) => {
    if (!currentUserId) return;
    const base = businessAiConfig || {};
    setBusinessAiBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/business`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          businessId: activeBusinessId || base.businessId || undefined,
          enabled: base.enabled,
          policyText: base.policyText || '',
          deliveryPolicy: base.deliveryPolicy || '',
          refundPolicy: base.refundPolicy || '',
          faq: base.faq || [],
          ...patch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not save Business AI.', 'error');
        return;
      }
      setBusinessAiConfig(payload.config || null);
      showToast('Business AI saved. Auto-send stays off.', 'success', 2800);
    } catch {
      showToast('Could not save Business AI.', 'error');
    } finally {
      setBusinessAiBusy(false);
    }
  };

  const addBusinessAiFaq = async () => {
    const question = businessAiFaqDraft.question.trim();
    const answer = businessAiFaqDraft.answer.trim();
    if (question.length < 2 || answer.length < 2) {
      showToast('Add a FAQ question and answer.', 'error');
      return;
    }
    const faq = [...(businessAiConfig?.faq || []), { question, answer }];
    setBusinessAiFaqDraft({ question: '', answer: '' });
    await saveBusinessAiConfig({ faq });
  };

  const removeBusinessAiFaq = async (index) => {
    const faq = (businessAiConfig?.faq || []).filter((_, i) => i !== index);
    await saveBusinessAiConfig({ faq });
  };

  const askBusinessAi = async () => {
    const question = businessAiAskDraft.trim();
    if (!question || !currentUserId || businessAiBusy) {
      if (!question) showToast('Type a test question.', 'info');
      return;
    }
    setBusinessAiBusy(true);
    setBusinessAiAskResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai/business/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          sellerUserId: currentUserId,
          question,
          businessId: activeBusinessId || undefined,
          chatId: selectedChatId || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not get an answer.', 'error');
        return;
      }
      setBusinessAiAskResult(payload);
      if (payload.notice) showToast(payload.notice, 'info', 3200);
    } catch {
      showToast('Could not get an answer.', 'error');
    } finally {
      setBusinessAiBusy(false);
    }
  };

  const importContactAsCustomer = async (contact) => {
    if (!currentUserId || !contact) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          displayName: contact.name || 'Customer',
          phone: contact.phone || undefined,
          customerUserId: contact.linkedUserId || undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not add customer.', 'error');
        return;
      }
      if (payload.customer) {
        setBusinessCustomers((current) => [payload.customer, ...current.filter((entry) => entry.id !== payload.customer.id)]);
        void loadCustomerDetail(payload.customer.id);
      }
      showToast('Added to customer records.', 'success');
    } catch {
      showToast('Could not add customer.', 'error');
    }
  };

  const submitPayAction = async () => {
    const amount = Number.parseFloat(payForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a valid amount first.', 'error');
      return;
    }
    if ((paySheet === 'send' || paySheet === 'request') && !payForm.phone.trim()) {
      showToast('Enter the recipient phone number.', 'error');
      return;
    }

    showToast('Preparing payment...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/payments/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: paySheet === 'topup' ? 'topup' : paySheet,
          amount,
          currency: accountCurrency,
          phone: payForm.phone.trim() || undefined,
          note: payForm.note.trim() || undefined,
          provider: 'mtn_momo',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Payment could not start.'), 'error', 3600);
        return;
      }

      const entry = {
        id: payload.intent?.id ?? `local-${Date.now()}`,
        title:
          paySheet === 'send'
            ? `Sent to ${payForm.phone.trim()}`
            : paySheet === 'request'
              ? `Requested from ${payForm.phone.trim()}`
              : 'Wallet top up',
        time: 'Just now',
        amount: `${paySheet === 'request' ? '+' : '-'}${accountCurrency} ${amount.toFixed(2)}`,
        positive: paySheet === 'request' || paySheet === 'topup',
      };
      setPayHistoryItems((current) => [entry, ...current]);
      showToast(payload.message || 'Payment flow ready.', 'success', 4200);
      setPayForm({ amount: '', phone: '', note: '' });
      setPaySheet(paySheet === 'history' ? 'history' : '');
    } catch {
      showToast('Network error while starting payment.', 'error');
    }
  };

  const setCatalogVisibility = async (item, isPublic) => {
    const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic }),
    });
    if (!response.ok) {
      showToast('Could not update this product.', 'error');
      return false;
    }
    setCatalogItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isPublic } : entry)));
    showToast(isPublic ? 'Catalog is now public.' : 'Catalog is private.', 'success');
    return true;
  };

  const ensureDirectChatId = async (peerUserId) => {
    const space = activeBusinessId || 'personal';
    const existing = chatItems.find((chat) => chat.peerUserId === peerUserId && (chat.space || 'personal') === space);
    if (existing) {
      return existing.id;
    }
    const response = await fetch(`${API_BASE_URL}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, peerUserId, businessId: activeBusinessId || undefined }),
    });
    if (!response.ok) {
      return '';
    }
    const payload = await response.json();
    const mappedChat = mapChatFromServer(payload.chat, currentUserId, usersById);
    setChatItems((current) => (current.some((item) => item.id === mappedChat.id) ? current : [mappedChat, ...current]));
    return mappedChat.id;
  };

  const sendCatalogCard = async (item, peerUserId) => {
    if (!peerUserId || peerUserId === currentUserId) {
      return;
    }
    const chatId = await ensureDirectChatId(peerUserId);
    if (!chatId) {
      showToast('Could not open the chat for this product.', 'error');
      return;
    }
    const clientRef = `catalog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const text = `${item.title} · ${item.price}`;
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: [...(current[chatId] ?? []), {
        id: `m${Date.now()}`,
        clientRef,
        mine: true,
        kind: item.imageUri ? 'image' : 'text',
        text,
        time: 'Now',
        receiptState: 'pending',
        imageUri: item.imageUri,
        catalogItemId: item.id,
      }],
    }));
    queueOutgoing({
      chatId,
      senderId: currentUserId,
      clientRef,
      kind: item.imageUri ? 'image' : 'text',
      text,
      mediaUrls: item.imageUri ? [item.imageUri] : [],
      catalogItemId: item.id,
    });
    setSelectedChatId(chatId);
    setChatScreen('detail');
    setActiveView('Chats');
    setPeerProfileVisible(false);
  };

  const postCatalogToStatus = async (item, audience = 'contacts') => {
    let liveItem = item;
    if (audience === 'marketplace' && (item.takenDown || !item.isPublic)) {
      const revive = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ takenDown: false, isPublic: true }),
      });
      if (!revive.ok) {
        showToast('Could not put this product back on the marketplace.', 'error');
        return;
      }
      liveItem = { ...item, takenDown: false, isPublic: true };
      setCatalogItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...liveItem } : entry)));
    } else if (!item.isPublic) {
      const madePublic = await setCatalogVisibility(item, true);
      if (!madePublic) {
        return;
      }
    }
    const response = await fetch(`${API_BASE_URL}/api/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
        text: `${item.title} · ${item.price}`,
        catalogItemId: liveItem.id,
        assets: liveItem.imageUri ? [{ kind: 'image', url: liveItem.imageUri, caption: liveItem.title }] : [],
        businessId: activeBusinessId || undefined,
        audience,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = getBackendErrorMessage(payload, 'Could not post this product to the marketplace.');
      showToast(
        /close-friends/.test(message)
          ? 'Marketplace posting needs the latest server. That update is not live yet.'
          : message,
        'error',
        4200,
      );
      return;
    }
    if (payload.item) {
      setCatalogItems((current) => current.map((entry) => (
        entry.id === payload.item.id
          ? { ...entry, takenDown: false, isPublic: true, createdAt: payload.item.createdAt || entry.createdAt }
          : entry
      )));
    }
    if (payload.status) {
      upsertStatus(payload.status);
    }
    showToast(
      audience === 'marketplace'
        ? 'Posted to the marketplace. Everyone registered in your country can see it.'
        : 'Product posted to your status.',
      'success',
    );
  };

  const payForCatalogItem = async (item, sellerId) => {
    const status = item.status || 'active';
    if (status === 'archived' || status === 'draft') {
      showToast('This product is not available to buy.', 'error');
      return;
    }
    if (status === 'out_of_stock' || (item.trackStock !== false && Number(item.stockQuantity) <= 0)) {
      showToast('This product is out of stock.', 'error');
      return;
    }
    const amount = Number(item.priceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('This product has no price yet.', 'error');
      return;
    }
    const response = await fetch(`${API_BASE_URL}/api/payments/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send',
        amount,
        currency: item.currency || accountCurrency,
        note: item.title,
      }),
    });
    if (!response.ok) {
      showToast('Payment could not be started.', 'error');
      return;
    }
    if (item.stockQuantity > 0) {
      void adjustCatalogStock(item.id, item.stockQuantity - 1);
    }
    showToast(`Payment started for ${item.title}.`, 'success');
    if (sellerId && sellerId !== currentUserId) {
      await sendCatalogCard({ ...item, title: `Paid · ${item.title}` }, sellerId);
    }
  };

  const upsertCommerceDocument = (document) => {
    if (!document?.id) return;
    setCommerceDocuments((current) => [document, ...current.filter((entry) => entry.id !== document.id)]);
    setSelectedDocument((current) => (current?.id === document.id ? document : current));
  };

  const loadCommerceDocuments = async (userId = currentUserId, kind = '') => {
    if (!userId) return;
    try {
      const query = new URLSearchParams({ userId });
      if (kind === 'quotation' || kind === 'invoice') query.set('kind', kind);
      const response = await fetch(`${API_BASE_URL}/api/documents?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load documents.', 'error');
        return;
      }
      setCommerceDocuments(payload.documents || []);
    } catch {
      showToast('Could not load documents.', 'error');
    }
  };

  const openCommerceDocument = async (documentId, options = {}) => {
    if (!documentId || !currentUserId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}?userId=${encodeURIComponent(currentUserId)}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.document) {
        showToast(payload.error || 'Could not open document.', 'error');
        return;
      }
      upsertCommerceDocument(payload.document);
      setSelectedDocument(payload.document);
      if (options.openPanel !== false) {
        setBusinessPanel('documents');
        setActiveView('Business');
      }
    } catch {
      showToast('Could not open document.', 'error');
    }
  };

  const resetDocumentForm = () => {
    setDocumentForm({
      kind: 'quotation',
      customerName: '',
      customerPhone: '',
      lineTitle: '',
      lineQty: '1',
      linePrice: '',
      discountAmount: '',
      taxAmount: '',
      notes: '',
      expiresAt: '',
      dueAt: '',
    });
  };

  const createCommerceDocument = async ({ sendNow = false } = {}) => {
    if (!currentUserId) return;
    const customerName = documentForm.customerName.trim();
    const lineTitle = documentForm.lineTitle.trim();
    const quantity = Number.parseFloat(documentForm.lineQty) || 0;
    const unitPrice = Number.parseFloat(documentForm.linePrice);
    if (!customerName || !lineTitle || !(quantity > 0) || !Number.isFinite(unitPrice)) {
      showToast('Add customer name and at least one line (title, qty, price).', 'error', 3600);
      return;
    }
    showToast(sendNow ? 'Creating and sending...' : 'Saving draft...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          kind: documentForm.kind === 'invoice' ? 'invoice' : 'quotation',
          customerName,
          customerPhone: documentForm.customerPhone.trim() || undefined,
          currency: accountCurrency,
          lines: [{ title: lineTitle, quantity, unitPrice }],
          discountAmount: documentForm.discountAmount.trim() === ''
            ? undefined
            : Number.parseFloat(documentForm.discountAmount) || 0,
          taxAmount: documentForm.taxAmount.trim() === ''
            ? undefined
            : Number.parseFloat(documentForm.taxAmount) || 0,
          notes: documentForm.notes.trim() || undefined,
          expiresAt: documentForm.kind === 'quotation' && documentForm.expiresAt.trim()
            ? documentForm.expiresAt.trim()
            : undefined,
          dueAt: documentForm.kind === 'invoice' && documentForm.dueAt.trim()
            ? documentForm.dueAt.trim()
            : undefined,
          chatId: selectedChatId || undefined,
          sendNow: Boolean(sendNow),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.document) {
        showToast(getBackendErrorMessage(payload, 'Could not create document.'), 'error', 3600);
        return;
      }
      upsertCommerceDocument(payload.document);
      setSelectedDocument(payload.document);
      resetDocumentForm();
      showToast(
        sendNow
          ? `${payload.document.kind === 'invoice' ? 'Invoice' : 'Quote'} sent.`
          : `${payload.document.kind === 'invoice' ? 'Invoice' : 'Quote'} draft saved.`,
        'success',
      );
    } catch {
      showToast('Could not create document.', 'error');
    }
  };

  const runDocumentAction = async (documentId, action, bodyExtra = {}) => {
    if (!currentUserId || !documentId) return;
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, ...bodyExtra }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, `Could not ${action} document.`), 'error', 3600);
        return;
      }
      if (payload.document) upsertCommerceDocument(payload.document);
      if (payload.quotation) upsertCommerceDocument(payload.quotation);
      if (payload.invoice) {
        upsertCommerceDocument(payload.invoice);
        setSelectedDocument(payload.invoice);
      }
      showToast(
        action === 'send'
          ? 'Document sent.'
          : action === 'accept'
            ? 'Document accepted.'
            : action === 'reject'
              ? 'Document rejected.'
              : action === 'convert'
                ? 'Converted to invoice.'
                : action === 'mark-paid'
                  ? 'Marked paid.'
                  : 'Updated.',
        'success',
      );
      void loadCommerceDocuments(currentUserId);
    } catch {
      showToast(`Could not ${action} document.`, 'error');
    }
  };

  const loadBroadcastCampaigns = async (userId = currentUserId) => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/broadcasts?userId=${encodeURIComponent(userId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error || 'Could not load broadcasts.', 'error');
        return;
      }
      setBroadcastCampaigns(payload.campaigns || []);
      setBroadcastAudiencePreview({
        opted_in: payload.audiencePreview?.opted_in ?? 0,
        repeat_buyers: payload.audiencePreview?.repeat_buyers ?? 0,
        all_customers: payload.audiencePreview?.all_customers ?? 0,
      });
    } catch {
      showToast('Could not load broadcasts.', 'error');
    }
  };

  const sendBroadcast = async () => {
    const text = broadcastDraft.trim();
    if (!text) {
      showToast('Write a broadcast message first.', 'error');
      return;
    }
    if (!currentUserId) return;
    const segment = ['opted_in', 'repeat_buyers', 'all_customers'].includes(broadcastSegment)
      ? broadcastSegment
      : 'opted_in';
    showToast('Sending broadcast...', 'info', 0);
    try {
      const response = await fetch(`${API_BASE_URL}/api/broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          segment,
          sendNow: true,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.campaign) {
        showToast(getBackendErrorMessage(payload, 'Broadcast could not be sent.'), 'error', 4200);
        return;
      }
      setBroadcastCampaigns((current) => [payload.campaign, ...current.filter((entry) => entry.id !== payload.campaign.id)]);
      setBroadcastDraft('');
      showToast(
        `Broadcast ${payload.campaign.status === 'sent' ? 'sent' : 'queued'} to ${payload.campaign.audienceCount || 0} opted-in customers.`,
        'success',
        4200,
      );
      void loadBroadcastCampaigns(currentUserId);
    } catch {
      showToast('Broadcast could not be sent.', 'error');
    }
  };

  const cancelBroadcastCampaign = async (campaignId) => {
    if (!currentUserId || !campaignId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/broadcasts/${encodeURIComponent(campaignId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.campaign) {
        showToast(getBackendErrorMessage(payload, 'Could not cancel campaign.'), 'error', 3600);
        return;
      }
      setBroadcastCampaigns((current) => [payload.campaign, ...current.filter((entry) => entry.id !== payload.campaign.id)]);
      showToast('Campaign cancelled.', 'success');
    } catch {
      showToast('Could not cancel campaign.', 'error');
    }
  };

  const addAttachmentMessage = (kind, name, source, uri = null) => {
    const clientRef = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const normalizedKind = kind === 'document' ? 'file' : kind;
    appendMessage({
      id: `m${Date.now()}`,
      clientRef,
      mine: true,
      kind: normalizedKind,
      text: name,
      time: 'Now',
      receiptState: 'pending',
      attachment: { kind: normalizedKind, name, source },
      imageUri: normalizedKind === 'image' ? uri : undefined,
      videoUri: normalizedKind === 'video' ? uri : undefined,
      audioUri: normalizedKind === 'audio' || normalizedKind === 'voice' ? uri : undefined,
      fileUri: normalizedKind === 'file' ? uri : undefined,
    });
    return clientRef;
  };

  const persistAttachmentMessage = async (kind, name, source, uri = null) => {
    if (!selectedChatId || !uri) {
      showToast('Open a chat and choose a file first.', 'error');
      return;
    }
    const normalizedKind = kind === 'document' ? 'file' : kind === 'audio' ? 'voice' : kind;
    const clientRef = addAttachmentMessage(normalizedKind, name, source, uri);
    const fallbackType =
      normalizedKind === 'image'
        ? 'image/jpeg'
        : normalizedKind === 'video'
          ? 'video/mp4'
          : normalizedKind === 'voice'
            ? 'audio/mpeg'
            : 'application/octet-stream';
    queueOutgoing({
      chatId: selectedChatId,
      senderId: currentUserId,
      clientRef,
      kind: normalizedKind,
      text: name || (normalizedKind === 'voice' ? 'Audio' : 'File'),
      mediaUrls: [],
    }, {
      localUri: uri,
      uploadName: name || `file-${Date.now()}`,
      uploadType: inferMimeType(uri, fallbackType),
    });
  };

  const openGallery = async (kind) => {
    const result = await openImageLibrary({ mediaType: kind === 'video' ? 'video' : 'photo' });
    if (result.errorCode) {
      Alert.alert('Permission needed', result.errorMessage || 'Please allow gallery access to send media.');
      return;
    }
    if (!result.didCancel && result.assets?.length) {
      const asset = result.assets[0];
      persistAttachmentMessage(
        kind,
        asset.fileName ?? `${kind}-asset`,
        'gallery',
        asset.uri,
      );
    }
  };

  const openFiles = async (kind) => {
    if (!pickDocument) {
      Alert.alert('Unavailable', 'Document picker is not available in this build.');
      return;
    }

    const type =
      kind === 'image'
        ? [DocumentPickerTypes.images]
        : kind === 'video'
          ? [DocumentPickerTypes.video]
          : kind === 'audio'
            ? [DocumentPickerTypes.audio || DocumentPickerTypes.allFiles]
            : [DocumentPickerTypes.allFiles];
    try {
      const [asset] = await pickDocument({
        type,
        allowMultiSelection: false,
      });
      let uri = asset.uri;
      if (keepLocalDocumentCopy && asset.uri) {
        const [copy] = await keepLocalDocumentCopy({
          destination: 'cachesDirectory',
          files: [{ uri: asset.uri, fileName: asset.name || `upload-${Date.now()}` }],
        });
        if (copy?.status === 'success' && copy.localUri) {
          uri = copy.localUri;
        }
      }
      persistAttachmentMessage(kind, asset.name || 'File', 'file manager', uri);
    } catch (error) {
      if (!(isDocumentPickerErrorWithCode(error) && error.code === DocumentPickerErrorCodes.OPERATION_CANCELED)) {
        Alert.alert('Files', 'Unable to open the file picker right now.');
      }
    }
  };

  const shareCurrentLocation = async () => {
    setSheetStep('closed');
    if (!selectedChatId) {
      showToast('Open a chat before sharing your location.', 'error');
      return;
    }
    if (!Geolocation?.getCurrentPosition) {
      showToast('Location is not available in this build.', 'error');
      return;
    }
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        showToast('Allow location access to share where you are.', 'error');
        return;
      }
    }

    showToast('Finding your location...', 'info', 0);
    Geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          showToast('Could not read a GPS fix.', 'error');
          return;
        }
        const coords = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
        const clientRef = `mobile-loc-${Date.now()}`;
        appendMessage({
          id: `m${Date.now()}`,
          clientRef,
          mine: true,
          kind: 'location',
          text: 'Shared location',
          location: coords,
          time: 'Now',
          receiptState: 'pending',
        });
        queueOutgoing({
          chatId: selectedChatId,
          senderId: currentUserId,
          clientRef,
          kind: 'text',
          text: `📍 ${coords}|Shared location`,
          mediaUrls: [],
        });
        showToast('Location sent', 'success', 1600);
      },
      () => {
        showToast('Location timed out. Turn on GPS and try again.', 'error', 3600);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  };

  const chooseAttachmentSource = async (source) => {
    setSheetStep('closed');
    if (source === 'gallery') {
      await openGallery(attachmentType);
      return;
    }

    await openFiles(attachmentType);
  };

  const pickMultipleImages = async (target, mediaType = 'photo') => {
    const result = await openImageLibrary({
      mediaType: mediaType === 'video' ? 'video' : 'photo',
      selectionLimit: mediaType === 'video' ? 1 : 10,
    });
    if (result.errorCode) {
      Alert.alert('Permission needed', result.errorMessage || 'Please allow gallery access to select media.');
      return;
    }
    if (!result.didCancel && result.assets?.length) {
      const uris = result.assets.map((asset) => asset.uri);
      if (target === 'status') {
        setStatusAssetUris(uris);
      } else {
        setCatalogImageUris(uris);
      }
    }
  };

  const openStatusProduct = async (catalogItemId, statusId) => {
    if (!catalogItemId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(catalogItemId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.item) {
        showToast(payload.error || 'That product is no longer available.', 'error');
        return;
      }
      setStatusProductSheet({ ...payload.item, fromStatusId: statusId || null });
      setStatusProductSeller(payload.seller || null);
      setStatusOrderQuantity('1');
      setStatusVariantPicks({});
      closeStatusViewer();
    } catch {
      showToast('Could not open this product.', 'error');
    }
  };

  const placeStatusProductOrder = async () => {
    if (!statusProductSheet || !currentUserId) return;
    const quantity = Math.max(1, Number.parseInt(statusOrderQuantity, 10) || 1);
    const variants = statusProductSheet.variants || [];
    const selections = variants.map((variant) => ({
      name: variant.name,
      option: statusVariantPicks[variant.name] || '',
    }));
    if (selections.some((entry) => !entry.option)) {
      showToast('Choose each product option first.', 'error');
      return;
    }
    try {
      const orderResponse = await fetch(`${API_BASE_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerUserId: currentUserId,
          catalogItemId: statusProductSheet.id,
          quantity,
          variantSelections: selections,
          statusId: statusProductSheet.fromStatusId || undefined,
          clientRequestId: `req-${currentUserId}-${statusProductSheet.id}-${quantity}-${Date.now()}`,
        }),
      });
      const orderPayload = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok) {
        showToast(orderPayload.error || 'Could not create the order.', 'error');
        return;
      }
      if (orderPayload.order) {
        setCommerceOrders((current) => [
          orderPayload.order,
          ...current.filter((entry) => entry.id !== orderPayload.order.id),
        ]);
      }
      const payResponse = await fetch(`${API_BASE_URL}/api/payments/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          amount: orderPayload.order.totalAmount,
          currency: orderPayload.order.currency,
          note: orderPayload.order.items?.[0]?.title || statusProductSheet.title,
          userId: currentUserId,
          orderId: orderPayload.order.id,
        }),
      });
      const payPayload = await payResponse.json().catch(() => ({}));
      if (!payResponse.ok) {
        showToast(payPayload.error || 'Order created, but payment could not start.', 'error', 4200);
        return;
      }
      const sellerId = statusProductSheet.sellerId;
      const productCard = {
        id: statusProductSheet.id,
        title: `Order ${orderPayload.order.id} · ${statusProductSheet.title}`,
        price: `${orderPayload.order.currency} ${orderPayload.order.totalAmount}`,
        priceAmount: orderPayload.order.totalAmount,
        currency: orderPayload.order.currency,
        imageUri: statusProductSheet.imageUrls?.[0],
      };
      setStatusProductSheet(null);
      setStatusProductSeller(null);
      showToast(
        payPayload.message || `Order ${orderPayload.order.id} is pending payment.`,
        'success',
        4800,
      );
      if (sellerId && sellerId !== currentUserId) {
        await sendCatalogCard(productCard, sellerId);
      }
    } catch {
      showToast('Could not start checkout.', 'error');
    }
  };

  const postStatus = async () => {
    const text = statusDraft.trim();
    const wantsMedia = statusComposerMode === 'photo' || statusComposerMode === 'video';

    if (statusComposerMode === 'text' && !text) {
      showToast('Type a text status first.', 'error');
      return;
    }
    if (wantsMedia && !statusAssetUris.length) {
      showToast(`Pick at least one ${statusComposerMode} first.`, 'error');
      return;
    }
    if (!text && !statusAssetUris.length) {
      showToast('Add text or media before posting.', 'error');
      return;
    }

    showToast('Posting your status...', 'info', 0);
    const uploadedUrls = statusAssetUris.length
      ? await uploadUris(statusAssetUris, {
          names: statusAssetUris.map((_, index) => `status-${Date.now()}-${index}.${statusComposerMode === 'video' ? 'mp4' : 'jpg'}`),
          fallbackType: statusComposerMode === 'video' ? 'video/mp4' : 'image/jpeg',
        }).catch(() => [])
      : [];

    if (wantsMedia && !uploadedUrls.length) {
      showToast('Could not upload media. Check your connection and try again.', 'error', 3600);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/statuses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          text,
          assets: uploadedUrls.map((uri, index) => ({
            kind: statusComposerMode === 'video' ? 'video' : 'image',
            url: uri,
            caption: index === 0 ? text : '',
          })),
          backgroundColor: statusComposerMode === 'text' ? statusBackgroundColor : undefined,
          fontFamily: statusComposerMode === 'text' ? statusFontFamily : undefined,
          fontSize: statusComposerMode === 'text' ? statusFontSize : undefined,
          businessId: activeBusinessId || undefined,
          audience: statusAudience,
          catalogItemId: statusTaggedProductId || undefined,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = getBackendErrorMessage(payload, 'Could not post status.');
        showToast(
          /close-friends/.test(message)
            ? 'Public and marketplace posts need the latest server. That update is not live yet.'
            : message,
          'error',
          4200,
        );
        return;
      }
      setStatusDraft('');
      setStatusAssetUris([]);
      setStatusTaggedProductId('');
      setStatusComposerMode('text');
      setStatusComposerVisible(false);
      showToast(statusTaggedProductId ? 'Status posted with product tag.' : 'Status posted.', 'success');
    } catch {
      showToast('Network error while posting status.', 'error');
    }
  };

  const deleteStatus = (statusId) => {
    fetch(`${API_BASE_URL}/api/statuses/${statusId}?userId=${currentUserId}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  };

  const submitStatusReaction = (emoji) => {
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

  const startEditingStatusComment = (commentId, text) => {
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

  const removeStatusComment = (commentId) => {
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
  }, [activeStatusItem?.views?.length, statusViewersVisible]);

  useEffect(() => {
    if (!statusReactorsVisible || !activeStatusItem) {
      return;
    }

    openReactorList();
  }, [activeStatusItem?.reactions?.length, statusReactorsVisible]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const createDirectChat = async (peerUserId, seedMessage) => {
    const response = await fetch(`${API_BASE_URL}/api/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, peerUserId }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const mappedChat = mapChatFromServer(payload.chat, currentUserId, usersById);
    setChatItems((current) => (current.some((item) => item.id === mappedChat.id) ? current : [mappedChat, ...current]));
    setSelectedChatId(mappedChat.id);
    setChatScreen('detail');
    setActiveView('Chats');
    setNewChatVisible(false);
    if (seedMessage) {
      setMessageDraft(seedMessage);
    }
  };

  const startBackendPhoneAuth = async (countryCode, phoneNumber, normalizedPhone) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/phone/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode, phoneNumber }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getBackendErrorMessage(payload, 'Unable to start phone verification.'));
    }

    phoneAuthProviderRef.current = 'backend';
    phoneAuthConfirmationRef.current = null;
    phoneAuthIdTokenRef.current = '';
    phoneAuthChallengeIdRef.current = payload.challengeId ?? '';
    setAuthForm((current) => ({
      ...current,
      otp: '',
      verifiedPhone: normalizedPhone,
    }));
    setAuthMode('otp');
    showToast(
      payload.otpHint
        ? `Dev OTP ready. Use code ${payload.otpHint}.`
        : 'The server stored a code but did not send an SMS.',
      payload.otpHint ? 'success' : 'error',
      4200,
    );
  };

  const reportOtpFailure = (error, phone = '') => {
    const code = error?.code || '';
    const detail = [code, error?.message || ''].filter(Boolean).join(' ').slice(0, 300);
    showToast(code === 'auth/invalid-phone-number' ? 'That phone number looks invalid.' : 'Unable to send OTP.', 'error', 4200);
    void fetch(`${API_BASE_URL}/api/client/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'otp', message: 'Unable to send OTP', detail: `${phone} ${detail}`.trim() }),
    }).catch(() => undefined);
  };

  const deliverPhoneOtp = async (countryCode, phoneNumber, normalizedPhone) => {
    const preferBackendOtp = typeof __DEV__ !== 'undefined' && __DEV__;
    if (preferBackendOtp) {
      await startBackendPhoneAuth(countryCode, phoneNumber, normalizedPhone);
      return;
    }

    if (!nativeFirebaseReady || !firebaseAuth || !firebaseConfigReady) {
      throw new Error('Firebase phone auth is not available in this build.');
    }

    if (firebaseAuth.settings) {
      firebaseAuth.settings.forceRecaptchaFlowForTesting = false;
    }
    phoneAuthIdTokenRef.current = '';
    phoneAuthConfirmationRef.current = await firebaseAuth.signInWithPhoneNumber(normalizedPhone);
    phoneAuthProviderRef.current = 'firebase';
    phoneAuthChallengeIdRef.current = '';
    setAuthForm((current) => ({
      ...current,
      otp: '',
      verifiedPhone: normalizedPhone,
    }));
    setAuthMode('otp');
    showToast('SMS sent by Firebase. Enter the code from your phone.', 'success', 4200);
  };

  const startPhoneAuth = async () => {
    if (isAuthBusy) {
      return;
    }

    if (!authForm.countryCode.trim()) {
      showToast('Select your country code first.', 'error');
      setCountryPickerVisible(true);
      return;
    }

    const countryCode = authForm.countryCode.trim();
    const phoneNumber = authForm.phone.trim();
    const normalizedPhone = normalizeAuthPhone(countryCode, phoneNumber);
    if (normalizedPhone.length < 8) {
      showToast('Enter a valid phone number first.', 'error');
      return;
    }

    setAuthPendingAction('send-code');
    showToast('Sending verification code...', 'info', 0);

    try {
      await deliverPhoneOtp(countryCode, phoneNumber, normalizedPhone);
    } catch (error) {
      const firebaseCode = error?.code ?? '';
      const firebaseMessage = error?.message ?? '';
      console.warn('Phone auth send failed', firebaseCode, firebaseMessage, normalizedPhone);

      reportOtpFailure(error, normalizedPhone);
    } finally {
      setAuthPendingAction('');
    }
  };

  const applyVerifiedPhoneSession = async (payload, verifiedPhone) => {
    if (payload.pinResetRequired) {
      forgotPinFlowRef.current = false;
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
        pin: '',
      }));
      setAuthMode('reset-pin');
      showToast('OTP verified. Choose a new PIN.', 'success');
      return;
    }

    if (payload.pinLoginRequired) {
      forgotPinFlowRef.current = false;
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
        pin: '',
      }));
      setAuthMode('pin');
      showToast('Enter your PIN to sign in.', 'success');
      return;
    }

    if (payload.registrationRequired) {
      forgotPinFlowRef.current = false;
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
      }));
      setAuthMode('profile');
      showToast('Phone verified. Complete your profile to continue.', 'success');
      return;
    }

    if (payload.session?.deviceId) {
      await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
      setCurrentDeviceId(payload.session.deviceId);
    }

    let bootstrapPayload = payload.bootstrap ?? null;
    if (bootstrapPayload?.currentUserId) {
      applyBootstrapPayload(bootstrapPayload);
    } else {
      bootstrapPayload = await hydrateBootstrapFromDevice(payload.session?.deviceId ?? currentDeviceId);
    }

    if (!bootstrapPayload?.currentUserId) {
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
      }));
      setAuthMode('profile');
      showToast('Phone verified. We could not restore the session yet, so continue registration.', 'success', 3600);
      return;
    }

    if (payload.pinSetupRequired) {
      setAuthForm((current) => ({
        ...current,
        verifiedPhone,
        pin: '',
      }));
      setAuthMode('reset-pin');
      showToast('Create a PIN to finish signing in.', 'success');
      return;
    }

    forgotPinFlowRef.current = false;
    pinHoldingRef.current = false;
    setAuthVisible(false);
    setAuthRequired(false);
    resetAuthForm();
    showToast('Welcome back. Signing you in...', 'success');
  };

  const startForgotPinAuth = async () => {
    forgotPinFlowRef.current = true;
    setAuthForm((current) => ({ ...current, otp: '', pin: '' }));
    await startPhoneAuth();
  };

  const verifyPhoneOtp = async () => {
    if (isAuthBusy) {
      return;
    }

    if (authForm.otp.trim().length !== 6) {
      showToast('Enter the full 6-digit OTP first.', 'error');
      return;
    }

    const usingBackend = phoneAuthProviderRef.current === 'backend' || Boolean(phoneAuthChallengeIdRef.current);
    if (!usingBackend && !phoneAuthConfirmationRef.current) {
      showToast('Start phone verification first.', 'error');
      return;
    }
    if (usingBackend && !phoneAuthChallengeIdRef.current) {
      showToast('Verification expired. Tap Resend to get a new code.', 'error', 3600);
      return;
    }

    setAuthPendingAction('verify-otp');
    showToast('Verifying your code...', 'info', 0);

    try {
      if (usingBackend) {
        const response = await fetch(`${API_BASE_URL}/api/auth/phone/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...authDevicePayload(),
            challengeId: phoneAuthChallengeIdRef.current,
            code: authForm.otp.trim(),
            forcePinReset: forgotPinFlowRef.current || undefined,
            platform: Platform.OS,
            label: `${Platform.OS} device`,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast(getBackendErrorMessage(payload, 'The OTP is invalid or expired.'), 'error');
          return;
        }

        if (payload.challengeId) {
          phoneAuthChallengeIdRef.current = payload.challengeId;
        }
        const verifiedPhone = payload.phone || authForm.verifiedPhone;
        await applyVerifiedPhoneSession(payload, verifiedPhone);
        return;
      }

      const submitFirebaseSession = async (idToken, verifiedPhone) => {
        const response = await fetch(`${API_BASE_URL}/api/auth/phone/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...authDevicePayload(),
            idToken,
            phone: verifiedPhone,
            forcePinReset: forgotPinFlowRef.current || undefined,
            platform: Platform.OS,
            label: `${Platform.OS} device`,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          showToast(getBackendErrorMessage(payload, 'Unable to verify this phone on the server.'), 'error', 4200);
          return false;
        }
        await applyVerifiedPhoneSession(payload, verifiedPhone);
        return true;
      };

      const alreadySignedIn = firebaseAuth?.currentUser;
      if (!phoneAuthIdTokenRef.current && alreadySignedIn?.phoneNumber) {
        const signedInDigits = String(alreadySignedIn.phoneNumber).replace(/\D/g, '');
        const expectedDigits = String(authForm.verifiedPhone || '').replace(/\D/g, '');
        if (!expectedDigits || signedInDigits.endsWith(expectedDigits) || expectedDigits.endsWith(signedInDigits)) {
          const existingToken = await alreadySignedIn.getIdToken(true).catch(() => '');
          if (existingToken) {
            phoneAuthIdTokenRef.current = existingToken;
          }
        }
      }

      if (phoneAuthIdTokenRef.current) {
        await submitFirebaseSession(phoneAuthIdTokenRef.current, alreadySignedIn?.phoneNumber || authForm.verifiedPhone);
        return;
      }

      let credential = null;
      try {
        credential = await phoneAuthConfirmationRef.current.confirm(authForm.otp.trim());
      } catch (error) {
        const signedInUser = firebaseAuth?.currentUser;
        if (signedInUser?.phoneNumber) {
          const recoveredToken = await signedInUser.getIdToken(true).catch(() => '');
          if (recoveredToken) {
            phoneAuthIdTokenRef.current = recoveredToken;
            await submitFirebaseSession(recoveredToken, signedInUser.phoneNumber);
            return;
          }
        }
        const firebaseCode = error?.code ?? '';
        showToast(
          firebaseCode === 'auth/invalid-verification-code'
            ? 'That code does not match this SMS. Correct the 6 digits and tap Verify again. The same code still works.'
            : firebaseCode === 'auth/session-expired' || firebaseCode === 'auth/code-expired'
              ? 'That SMS code expired. Tap Resend code.'
              : 'The OTP could not be checked. Enter it again.',
          'error',
        );
        return;
      }

      const verifiedPhone = credential?.user?.phoneNumber ?? authForm.verifiedPhone;
      const idToken = await credential?.user?.getIdToken(true);
      if (!idToken || !verifiedPhone) {
        showToast('Firebase accepted the code, but the secure token could not be read.', 'error', 3600);
        return;
      }
      phoneAuthIdTokenRef.current = idToken;
      await submitFirebaseSession(idToken, verifiedPhone);
    } catch (error) {
      showToast(error?.message || 'The code could not be checked. Enter it again.', 'error', 4200);
    } finally {
      setAuthPendingAction('');
    }
  };

  const completePhoneRegistration = async (selectedAccountType = authForm.accountType) => {
    if (isAuthBusy) {
      return;
    }
    const accountType =
      selectedAccountType === 'business' || selectedAccountType === 'personal' ? selectedAccountType : '';
    if (!authForm.verifiedPhone) {
      showToast('Verify your phone number with the OTP first.', 'error');
      return;
    }

    if (!accountType) {
      showToast('Choose Personal or Business to continue.', 'error');
      setAuthMode('account');
      return;
    }

    const usingBackend = phoneAuthProviderRef.current === 'backend' || Boolean(phoneAuthChallengeIdRef.current);
    if (!usingBackend && !phoneAuthIdTokenRef.current) {
      showToast('The secure Firebase token is missing. Verify your OTP again.', 'error', 3600);
      return;
    }
    if (usingBackend && !phoneAuthChallengeIdRef.current) {
      showToast('Phone verification expired. Send a new code and try again.', 'error', 3600);
      setAuthMode('phone');
      return;
    }

    if (!authForm.name.trim()) {
      showToast('Enter your name to continue.', 'error');
      setAuthMode('profile');
      return;
    }

    if (!isValidAuthPin(authForm.pin)) {
      showToast('Create a 4–6 digit PIN to continue.', 'error');
      setAuthMode('profile');
      return;
    }

    setAuthPendingAction('register');
    showToast('Creating your account...', 'info', 0);
    try {
      const response = await fetch(
        usingBackend ? `${API_BASE_URL}/api/auth/phone/complete` : `${API_BASE_URL}/api/auth/phone/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            usingBackend
              ? {
                  ...authDevicePayload(),
                  challengeId: phoneAuthChallengeIdRef.current,
                  name: authForm.name.trim(),
                  countryCode: authForm.countryCode.trim(),
                  phoneNumber: authForm.phone.trim(),
                  pin: authForm.pin.trim(),
                  platform: Platform.OS,
                  label: `${Platform.OS} device`,
                }
              : {
                  ...authDevicePayload(),
                  idToken: phoneAuthIdTokenRef.current,
                  phone: authForm.verifiedPhone,
                  countryCode: authForm.countryCode.trim(),
                  name: authForm.name.trim(),
                  pin: authForm.pin.trim(),
                  platform: Platform.OS,
                  label: `${Platform.OS} device`,
                },
          ),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(payload, 'Unable to finish registration right now.'), 'error', 4200);
        return;
      }

      const payload = await response.json();
      if (payload.session?.deviceId) {
        await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
        setCurrentDeviceId(payload.session.deviceId);
      }

      let bootstrapPayload = payload.bootstrap ?? null;
      if (bootstrapPayload?.currentUserId) {
        applyBootstrapPayload(bootstrapPayload);
      } else {
        showToast('Account created. Finalizing your session...', 'info', 0);
        bootstrapPayload = await hydrateBootstrapFromDevice(payload.session?.deviceId ?? currentDeviceId);
      }

      if (!bootstrapPayload?.currentUserId) {
        showToast('Your account was created, but the app could not open the next screen yet. Please reopen the app once.', 'error', 4200);
        return;
      }

      const authAvatar =
        authForm.name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.slice(0, 1).toUpperCase())
          .join('')
          .slice(0, 4) || 'ZU';
      await fetch(`${API_BASE_URL}/api/profile?userId=${encodeURIComponent(bootstrapPayload.currentUserId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authForm.name.trim(),
          username: authForm.username.trim() ? `@${authForm.username.trim().replace(/^@/, '')}` : undefined,
          avatar: authAvatar,
          about:
            accountType === 'business'
              ? 'Business account on ZynkUP.'
              : 'Personal account on ZynkUP.',
          businessName: accountType === 'business' ? authForm.name.trim() : undefined,
          businessDescription:
            accountType === 'business'
              ? 'Sell products, accept payments, and manage customers.'
              : undefined,
        }),
      }).catch(() => undefined);

      if (isValidAuthPin(authForm.pin)) {
        setAppLockPin(authForm.pin.trim());
        await AsyncStorage.setItem(APP_LOCK_PIN_KEY, authForm.pin.trim()).catch(() => undefined);
      }
      const registeredName = authForm.name.trim().split(/\s+/)[0] || 'there';
      setEntryCelebrationName(registeredName);
      setEntryCelebrationVisible(true);
      if (accountType === 'business') {
        await createBusinessProfile(
          authForm.name.trim(),
          'Sell products, accept payments, and manage customers.',
          bootstrapPayload.currentUserId,
        );
        setActiveView('Business');
      } else {
        setChatMode('personal');
        setActiveView('Chats');
      }
      pinHoldingRef.current = false;
      setAuthVisible(false);
      setAuthRequired(false);
      resetAuthForm();
      phoneAuthConfirmationRef.current = null;
      phoneAuthIdTokenRef.current = '';
      phoneAuthChallengeIdRef.current = '';
      phoneAuthProviderRef.current = '';
      forgotPinFlowRef.current = false;
      showToast('Registration complete. Opening your account...', 'success');
    } catch {
      showToast('Registration could not finish right now. Check your network and try again.', 'error', 3600);
    } finally {
      setAuthPendingAction('');
    }
  };

  const startCall = async (kind, peerUserId = activeChat?.peerUserId) => {
    setCallSheetVisible(false);
    if (!peerUserId || (activeCall && activeCall.state !== 'completed')) {
      if (activeCall && peerUserId && peerUserId !== activeChat?.peerUserId) {
        showToast('End the current call before starting another.', 'error');
      }
      if (!peerUserId) {
        return;
      }
      if (activeCall) {
        return;
      }
    }

    setCallError('');
    setCallMuted(false);
    setCallCameraOff(false);
    setCallMinimized(false);
    setCallControlsVisible(true);
    setCallSpeaker(false);

    const response = await fetch(`${API_BASE_URL}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantIds: [currentUserId, peerUserId],
        initiatorId: currentUserId,
        kind: kind.toLowerCase(),
        direction: 'outgoing',
      }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (payload.call) {
      upsertCall(payload.call);
      setActiveView('Chats');
      setChatScreen('list');
    }
  };
  startCallRef.current = startCall;

  const acceptIncomingCall = async () => {
    if (!incomingCall) {
      return;
    }

    try {
      await ensureCallMedia(incomingCall.kind);
      setCallError('');
    } catch (error) {
      setCallError(!CAN_USE_NATIVE_WEBRTC
        ? 'Use a development build for live calls.'
        : error?.message === 'permission-denied'
          ? 'Camera or microphone permission was denied.'
          : 'The camera did not start. Try answering again.');
      return;
    }
    await updateCallState(incomingCall.id, 'ongoing', incomingCall.durationSeconds);
    setIncomingCall(null);
  };

  const endActiveCall = async () => {
    if (!activeCall) {
      return;
    }

    const finalState = activeCall.state === 'ringing'
      ? (activeCall.initiatorId === currentUserId ? 'missed' : 'declined')
      : 'completed';
    await updateCallState(activeCall.id, finalState, activeCallSeconds);
    closePeerConnection();
  };

  const pickEmoji = (emoji) => {
    setMessageDraft((current) => `${current}${emoji}`);
    setEmojiTrayVisible(false);
  };

  const openImageViewer = (message) => {
    setMediaViewer({
      label: message.text,
      uri: message.imageUri ?? null,
    });
  };

  const playCue = async (name) => {
    if (CueSound?.start) {
      CueSound.start(name, false);
      return;
    }
    const source = CUE_SOUNDS[name];
    if (!source || Platform.OS !== 'android') {
      return;
    }
    try {
      if (!uiSoundRef.current) {
        uiSoundRef.current = createSound();
      }
      await uiSoundRef.current.stopPlayer().catch(() => undefined);
      await uiSoundRef.current.startPlayer(source);
    } catch {
      // Message tones are optional if the device cannot open the asset.
    }
  };
  playCueRef.current = playCue;

  const stopVoicePlayback = async () => {
    const sound = currentSoundRef.current;
    currentSoundRef.current = null;
    playbackTokenRef.current += 1;
    setVoicePlayback({ messageId: '', positionMs: 0, durationMs: 0, playing: false });
    if (!sound) {
      return;
    }
    sound.removePlayBackListener();
    sound.removePlaybackEndListener();
    await sound.stopPlayer().catch(() => undefined);
  };

  const playVoiceMessage = async (message) => {
    if (!message?.audioUri || playbackBusyRef.current) {
      return;
    }

    const activeSound = currentSoundRef.current;
    if (voicePlayback.messageId === message.id && activeSound) {
      playbackBusyRef.current = true;
      try {
        if (voicePlayback.playing) {
          await activeSound.pausePlayer();
          setVoicePlayback((current) => ({ ...current, playing: false }));
        } else {
          await activeSound.resumePlayer();
          setVoicePlayback((current) => ({ ...current, playing: true }));
        }
      } catch {
        setVoicePlayback({ messageId: '', positionMs: 0, durationMs: 0, playing: false });
      } finally {
        playbackBusyRef.current = false;
      }
      return;
    }

    playbackBusyRef.current = true;
    const token = playbackTokenRef.current + 1;
    playbackTokenRef.current = token;
    try {
      if (activeSound) {
        activeSound.removePlayBackListener();
        activeSound.removePlaybackEndListener();
        currentSoundRef.current = null;
        await activeSound.stopPlayer().catch(() => undefined);
      }
      if (token !== playbackTokenRef.current) {
        return;
      }
      const sound = createSound();
      currentSoundRef.current = sound;
      sound.setSubscriptionDuration(0.1);
      sound.addPlayBackListener((event) => {
        if (playbackTokenRef.current !== token || currentSoundRef.current !== sound) {
          return;
        }
        setVoicePlayback({
          messageId: message.id,
          positionMs: event.currentPosition ?? 0,
          durationMs: event.duration || 0,
          playing: true,
        });
      });
      sound.addPlaybackEndListener(() => {
        sound.removePlayBackListener();
        sound.removePlaybackEndListener();
        if (currentSoundRef.current === sound) {
          currentSoundRef.current = null;
        }
        if (playbackTokenRef.current === token) {
          setVoicePlayback({ messageId: '', positionMs: 0, durationMs: 0, playing: false });
        }
      });
      setVoicePlayback({ messageId: message.id, positionMs: 0, durationMs: 0, playing: true });
      await sound.startPlayer(message.audioUri);
    } catch {
      if (currentSoundRef.current) {
        currentSoundRef.current = null;
      }
      setVoicePlayback({ messageId: '', positionMs: 0, durationMs: 0, playing: false });
      showToast('Unable to play this voice note.', 'error');
    } finally {
      playbackBusyRef.current = false;
    }
  };

  const seekVoiceMessage = async (message, ratio) => {
    const sound = currentSoundRef.current;
    if (!sound || voicePlayback.messageId !== message.id || !voicePlayback.durationMs) {
      return;
    }
    const nextPosition = Math.max(0, Math.min(voicePlayback.durationMs - 150, ratio * voicePlayback.durationMs));
    await sound.seekToPlayer(nextPosition).catch(() => undefined);
    setVoicePlayback((current) => ({ ...current, positionMs: nextPosition }));
  };

  const startVoiceRecording = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission needed', 'Allow microphone access to send voice notes.');
          return;
        }
      }

      const recorder = createSound();
      recorder.setSubscriptionDuration(0.25);
      recorder.addRecordBackListener((event) => {
        const durationMs = event.currentPosition ?? 0;
        recordingDurationRef.current = durationMs;
        setRecordingLabel(`Recording ${getAudioDurationLabel(durationMs)}`);
      });
      await recorder.startRecorder(undefined, VOICE_RECORDER_AUDIO_SET);
      recordingRef.current = recorder;
      recordingDurationRef.current = 0;
      recordingPausedRef.current = false;
      setRecordingPaused(false);
      setVoiceDraft(null);
      setRecordingLabel('Recording 0:00');
      setIsRecording(true);
    } catch (error) {
      if (recordingRef.current) {
        recordingRef.current.removeRecordBackListener();
        recordingRef.current = null;
      }
      recordingDurationRef.current = 0;
      setRecordingLabel('');
      setIsRecording(false);
      Alert.alert('Recording failed', 'Voice note recording could not start.');
    }
  };

  const toggleRecordingPause = async () => {
    const recorder = recordingRef.current;
    if (!recorder) {
      return;
    }
    try {
      if (recordingPausedRef.current) {
        await recorder.resumeRecorder();
        recordingPausedRef.current = false;
        setRecordingPaused(false);
      } else {
        await recorder.pauseRecorder();
        recordingPausedRef.current = true;
        setRecordingPaused(true);
      }
    } catch {
      showToast('Could not pause the recording.', 'error');
    }
  };

  const finishVoiceRecording = async () => {
    if (!recordingRef.current) {
      return;
    }

    try {
      const recorder = recordingRef.current;
      if (recordingPausedRef.current) {
        await recorder.resumeRecorder().catch(() => undefined);
        recordingPausedRef.current = false;
      }
      const duration = recordingDurationRef.current;
      const uri = await recorder.stopRecorder();
      recorder.removeRecordBackListener();
      recordingRef.current = null;
      recordingDurationRef.current = 0;
      setIsRecording(false);
      setRecordingPaused(false);
      setRecordingLabel('');

      if (!uri) {
        return;
      }

      setVoiceDraft({
        uri,
        durationMs: duration,
        durationLabel: getAudioDurationLabel(duration),
      });
    } catch {
      if (recordingRef.current) {
        recordingRef.current.removeRecordBackListener();
        recordingRef.current = null;
      }
      recordingDurationRef.current = 0;
      recordingPausedRef.current = false;
      setIsRecording(false);
      setRecordingPaused(false);
      setRecordingLabel('');
      showToast('Voice note recording could not be completed.', 'error');
    }
  };

  const discardVoiceDraft = async () => {
    await stopVoicePlayback();
    setVoiceDraft(null);
  };

  const sendVoiceDraft = async () => {
    if (!voiceDraft?.uri) {
      return;
    }
    const { uri, durationMs, durationLabel } = voiceDraft;
    await stopVoicePlayback();
    setVoiceDraft(null);
    const clientRef = `mobile-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendMessage({
      id: `m${Date.now()}`,
      clientRef,
      mine: true,
      kind: 'voice',
      text: 'Voice note',
      time: 'Now',
      receiptState: 'pending',
      audioUri: uri,
      durationLabel,
    });
    queueOutgoing({
      chatId: selectedChatId,
      senderId: currentUserId,
      clientRef,
      kind: 'voice',
      text: 'Voice note',
      mediaUrls: [],
      durationSeconds: Math.max(1, Math.round(durationMs / 1000)),
    }, {
      localUri: uri,
      uploadName: `voice-${Date.now()}.m4a`,
      uploadType: inferMimeType(uri, 'audio/mp4'),
    });
  };

  const ensureCameraPermission = async () => {
    if (Platform.OS === 'android') {
      const already = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!already) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
            Alert.alert('Camera is blocked', 'Allow the camera in phone settings so ZynkUP can scan a web login code.', [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ]);
          }
          setCameraPermissionGranted(false);
          return false;
        }
      }
    }

    try {
      if (CameraKit?.requestDeviceCameraAuthorization) {
        const requested = await CameraKit.requestDeviceCameraAuthorization();
        if (!requested && Platform.OS !== 'android') {
          setCameraPermissionGranted(false);
          return false;
        }
      }
    } catch {
      // Android already granted the permission above.
    }

    setCameraPermissionGranted(true);
    return Boolean(Camera);
  };

  const emojiAnimatedStyle = {
    transform: [
      {
        scale: emojiAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.35],
        }),
      },
      {
        rotate: emojiAnim.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '10deg'],
        }),
      },
    ],
  };

  const renderAttachmentSheet = () => (
    <Modal transparent animationType="slide" visible={sheetStep !== 'closed'} onRequestClose={() => setSheetStep('closed')}>
      <Pressable style={styles.sheetOverlay} onPress={() => setSheetStep('closed')}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>
            {sheetStep === 'type' ? 'Choose attachment type' : `Choose ${attachmentType} source`}
          </Text>

          {sheetStep === 'type' ? (
            <>
              <Pressable
                style={styles.sheetOption}
                onPress={async () => {
                  setSheetStep('closed');
                  const granted = await ensureCameraPermission();
                  if (!granted || !Camera) {
                    showToast('Camera permission is needed to take a photo.', 'error');
                    return;
                  }
                  setChatCameraVisible(true);
                }}
              >
                <Text style={styles.sheetOptionTitle}>Camera</Text>
                <Text style={styles.sheetOptionBody}>Capture a photo in this chat</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={() => { setAttachmentType('image'); setSheetStep('source'); }}>
                <Text style={styles.sheetOptionTitle}>Image</Text>
                <Text style={styles.sheetOptionBody}>Open gallery or file manager</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={() => { setAttachmentType('video'); setSheetStep('source'); }}>
                <Text style={styles.sheetOptionTitle}>Video</Text>
                <Text style={styles.sheetOptionBody}>Open gallery or file manager</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={async () => {
                setAttachmentType('document');
                setSheetStep('closed');
                await openFiles('document');
              }}>
                <Text style={styles.sheetOptionTitle}>Document</Text>
                <Text style={styles.sheetOptionBody}>PDF, Word, and other files</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={async () => {
                setAttachmentType('audio');
                setSheetStep('closed');
                await openFiles('audio');
              }}>
                <Text style={styles.sheetOptionTitle}>Audio</Text>
                <Text style={styles.sheetOptionBody}>Send a song or recording</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={() => void shareCurrentLocation()}>
                <Text style={styles.sheetOptionTitle}>Location</Text>
                <Text style={styles.sheetOptionBody}>Share your current GPS position</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.sheetOption} onPress={() => chooseAttachmentSource('gallery')}>
                <Text style={styles.sheetOptionTitle}>Gallery</Text>
                <Text style={styles.sheetOptionBody}>Browse your photo or video library</Text>
              </Pressable>
              <Pressable style={styles.sheetOption} onPress={() => chooseAttachmentSource('files')}>
                <Text style={styles.sheetOptionTitle}>File Manager</Text>
                <Text style={styles.sheetOptionBody}>Browse device files</Text>
              </Pressable>
              <Pressable style={styles.sheetBack} onPress={() => setSheetStep('type')}>
                <Text style={styles.sheetBackText}>Back</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderCallSheet = () => (
    <Modal transparent animationType="fade" visible={callSheetVisible} onRequestClose={() => setCallSheetVisible(false)}>
      <Pressable style={styles.callDropdownOverlay} onPress={() => setCallSheetVisible(false)}>
        <Pressable style={styles.callDropdown} onPress={() => undefined}>
          <Pressable style={styles.callDropdownItem} onPress={() => void startCall('Audio')}>
            <Text style={styles.dialogActionTitle}>Audio call</Text>
          </Pressable>
          <Pressable style={styles.callDropdownItem} onPress={() => void startCall('Video')}>
            <Text style={styles.dialogActionTitle}>Video call</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderMediaViewer = () => (
    <Modal transparent animationType="fade" visible={Boolean(mediaViewer)} onRequestClose={() => setMediaViewer(null)}>
      <View style={styles.viewerOverlay}>
        <Pressable style={styles.viewerClose} onPress={() => setMediaViewer(null)}>
          <Text style={styles.viewerCloseText}>Close</Text>
        </Pressable>
        {mediaViewer?.uri ? (
          <Image resizeMode="contain" source={{ uri: mediaViewer.uri }} style={styles.viewerImage} />
        ) : (
          <View style={styles.viewerPlaceholder}>
            <Text style={styles.viewerPlaceholderTitle}>{mediaViewer?.label}</Text>
          </View>
        )}
      </View>
    </Modal>
  );

  const openPhoneLink = async (rawNumber) => {
    const response = await fetch(`${API_BASE_URL}/api/directory/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: rawNumber, userId: currentUserId }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    if (payload.registered && payload.user?.id) {
      setPhonePrompt({ ...payload.user, rawNumber });
      return;
    }
    const invite = `Hi, I am on ZynkUP. Join me so we can chat and call: https://zynkup.app`;
    Alert.alert('Not on ZynkUP yet', `${rawNumber} is not registered. Send an invite by SMS?`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Send invite',
        onPress: () => {
          Linking.openURL(`sms:${rawNumber.replace(/\s/g, '')}?body=${encodeURIComponent(invite)}`).catch(() => {
            showToast('Could not open the SMS app.', 'error');
          });
        },
      },
    ]);
  };

  const renderLinkedText = (text, style) => {
    const value = String(text || '');
    const nodes = [];
    let last = 0;
    PHONE_LINK_PATTERN.lastIndex = 0;
    let match = PHONE_LINK_PATTERN.exec(value);
    while (match) {
      const digits = match[0].replace(/\D/g, '');
      if (digits.length >= 8) {
        if (match.index > last) nodes.push(value.slice(last, match.index));
        const phoneText = match[0];
        nodes.push(
          <Text key={`${match.index}-${phoneText}`} style={styles.phoneLink} onPress={() => void openPhoneLink(phoneText)}>
            {phoneText}
          </Text>,
        );
        last = match.index + phoneText.length;
      }
      match = PHONE_LINK_PATTERN.exec(value);
    }
    if (!nodes.length) return <Text style={style}>{value}</Text>;
    if (last < value.length) nodes.push(value.slice(last));
    return <Text style={style}>{nodes}</Text>;
  };

  const savePromptContact = async () => {
    if (!phonePrompt?.id) return;
    const response = await fetch(`${API_BASE_URL}/api/contacts/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerUserId: currentUserId,
        linkedUserId: phonePrompt.id,
        name: phonePrompt.name,
        phone: phonePrompt.phone || phonePrompt.rawNumber,
      }),
    });
    if (!response.ok) {
      showToast('Could not save that number.', 'error');
      return;
    }
    setContactItems((current) => [
      { id: `saved-${phonePrompt.id}`, name: phonePrompt.name, phone: phonePrompt.phone, linkedUserId: phonePrompt.id, registered: true },
      ...current.filter((item) => item.linkedUserId !== phonePrompt.id),
    ]);
    setUsersById((current) => ({ ...current, [phonePrompt.id]: { ...(current[phonePrompt.id] || {}), ...phonePrompt } }));
    showToast('Number saved. You can both see statuses after you save each other.', 'success');
    setPhonePrompt(null);
  };

  const featureProduct = async (item) => {
    const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}/feature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, days: 7, note: item.boostNote || 'Featured product' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not send the feature request.', 'error');
      return;
    }
    showToast('Feature request sent. It stays on top after payment is confirmed.', 'success', 3600);
  };

  const takeDownProduct = async (item) => {
    const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ takenDown: true, isPublic: false }),
    });
    if (!response.ok) {
      showToast('Could not take this product down.', 'error');
      return;
    }
    setCatalogItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, takenDown: true, isPublic: false } : entry));
    setProductDetail(null);
    showToast('Product taken down.', 'success');
  };

  const describeCallMessage = (message) => {
    const video = message.callKind === 'video';
    const noun = video ? 'video call' : 'voice call';
    const state = message.callState
      || (/missed/i.test(message.text || '') ? 'missed' : /declined/i.test(message.text || '') ? 'declined' : 'completed');
    const outgoing = Boolean(message.mine);
    const label = !outgoing && state === 'missed'
      ? `Missed ${noun}`
      : !outgoing && state === 'declined'
        ? `Declined ${noun}`
        : `${outgoing ? 'Outgoing' : 'Incoming'} ${noun}`;
    const duration = state === 'completed' && message.durationSeconds > 0
      ? ` · ${Math.floor(message.durationSeconds / 60)}:${String(message.durationSeconds % 60).padStart(2, '0')}`
      : '';
    return { label: `${label}${duration}`, alert: state === 'missed' || state === 'declined', arrow: outgoing ? '↗' : '↙' };
  };

  const renderBubble = (message) => {
    if (message.kind === 'call') {
      const peerId = activeChat?.peerUserId;
      const described = describeCallMessage(message);
      return (
        <Pressable
          key={message.id}
          onPress={() => {
            if (!peerId) return;
            void startCall(message.callKind === 'video' ? 'Video' : 'Audio', peerId);
          }}
          onLongPress={() => {
            Alert.alert('Delete this call?', 'It disappears from this chat on this account.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => void deleteMessage(message, 'me') },
            ]);
          }}
          style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: described.alert ? '#fdeceb' : '#e7f6f1' }}
        >
          <Text style={{ color: described.alert ? '#d4544c' : '#0b6b57', fontWeight: '700', textAlign: 'center' }}>{described.arrow} {described.label}</Text>
          <Text style={{ color: '#5f7a74', fontSize: 12, textAlign: 'center' }}>Tap to call again · hold to delete</Text>
        </Pressable>
      );
    }
    const emojis = extractEmojiTokens(message.text ?? '');
    const emojiOnly = isEmojiOnlyMessage(message.text ?? '');

    const receiptGlyph = message.receiptState === 'pending' ? '◌' : message.receiptState === 'sent' ? '✓' : '✓✓';

    return (
      <SwipeReply enabled={!message.deletedForEveryone} onReply={() => setReplyTarget(message)}>
      <Pressable
        key={message.id}
        ref={(node) => {
          if (node) {
            messageNodeRefs.current[message.id] = node;
          }
        }}
        style={[
          styles.messageBubble,
          message.mine ? styles.messageMine : styles.messageTheirs,
          emojiOnly ? styles.emojiBubble : null,
          message.deletedForEveryone ? styles.messageDeletedBubble : null,
          message.automated ? styles.messageAutomatedBubble : null,
        ]}
        onLongPress={() => {
          if (!message.deletedForEveryone) {
            setMessageActionTarget(message);
          }
        }}
        delayLongPress={280}
        onPress={() => {
          if (message.kind === 'image') {
            openImageViewer(message);
            return;
          }

          if (message.kind === 'voice' || message.kind === 'audio') {
            return;
          }

          if (message.kind === 'file' && message.fileUri) {
            Linking.openURL(message.fileUri).catch(() => {
              showToast('Could not open that document.', 'error');
            });
            return;
          }

          if (message.kind === 'location' && message.location) {
            Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(message.location)}`).catch(() => {
              showToast('Could not open maps.', 'error');
            });
          }

          if (emojiOnly) {
            playEmojiMessage(message);
          }
        }}
      >
        {!message.mine && activeChat?.kind === 'group' ? (
          <Text style={styles.groupSenderName}>{message.anonymous ? 'Anonymous' : displayNameFor(message.senderId, 'Member')}</Text>
        ) : null}
        {message.actorName ? (
          <Text style={styles.groupSenderName}>Sent as {message.actorName}</Text>
        ) : null}
        {message.mine && message.anonymous ? (
          <Text style={styles.groupSenderName}>Anonymous</Text>
        ) : null}
        {message.replyPreview ? (
          <Pressable
            style={styles.replyQuoteCard}
            onPress={() => {
              const node = messageNodeRefs.current[message.replyToMessageId];
              const scroller = threadRef.current;
              if (!node || !scroller?.scrollTo) {
                return;
              }
              stickToLatestRef.current = false;
              node.measureLayout(
                scroller,
                (_x, y) => scroller.scrollTo({ y: Math.max(0, y - 24), animated: true }),
                () => undefined,
              );
            }}
          >
            <Text numberOfLines={2} style={styles.replyQuoteText}>{message.replyPreview}</Text>
          </Pressable>
        ) : null}
        {message.kind === 'image' ? (
          <>
            {message.imageUri ? (
              <Image source={{ uri: message.imageUri }} style={styles.messageImage} />
            ) : (
              <View style={styles.imageFallback}>
                <Text style={styles.imageFallbackText}>{message.text}</Text>
              </View>
            )}
            <Text style={styles.messageCaption}>{message.text}</Text>
          </>
        ) : null}

        {message.kind === 'video' ? (
          message.videoUri ? (
            <Video
              source={{ uri: message.videoUri }}
              style={styles.messageImage}
              resizeMode="cover"
              paused
              controls
            />
          ) : (
            <Text style={styles.messageText}>{message.text || 'Video'}</Text>
          )
        ) : null}

        {(message.kind === 'voice' || message.kind === 'audio') ? (() => {
          const active = voicePlayback.messageId === message.id;
          const durationMs = active && voicePlayback.durationMs
            ? voicePlayback.durationMs
            : ((message.durationSeconds || 0) * 1000);
          const positionMs = active ? voicePlayback.positionMs : 0;
          const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
          const remainingLabel = active && durationMs
            ? formatPlaybackClock(Math.max(0, durationMs - positionMs))
            : (message.durationLabel || '0:00');
          const transcriptReady = message.transcriptStatus === 'ready' && Boolean(message.transcript);
          const transcriptPending = message.transcriptStatus === 'pending' || transcribeBusyId === message.id;
          const showTranscribe = !transcriptReady
            && (message.transcriptStatus === 'unavailable'
              || message.transcriptStatus === 'failed'
              || !message.transcriptStatus);
          return (
            <View style={styles.voiceNoteBlock}>
              <View style={styles.voiceNote}>
                <Pressable style={styles.voicePlayButton} onPress={() => void playVoiceMessage(message)}>
                  <Text style={styles.voiceIcon}>{active && voicePlayback.playing ? '❚❚' : '▶'}</Text>
                </Pressable>
                <Pressable
                  style={styles.voiceBarTrack}
                  onLayout={(event) => {
                    voiceBarWidthRef.current = event.nativeEvent.layout.width || voiceBarWidthRef.current;
                  }}
                  onPress={(event) => {
                    const width = voiceBarWidthRef.current || 1;
                    void seekVoiceMessage(message, event.nativeEvent.locationX / width);
                  }}
                >
                  <View style={[styles.voiceBarFill, { width: `${Math.round(progress * 100)}%` }]} />
                </Pressable>
                <Text style={styles.voiceDuration}>{remainingLabel}</Text>
              </View>
              {transcriptReady ? (
                <Text style={styles.voiceTranscriptText}>{message.transcript}</Text>
              ) : null}
              {transcriptPending ? (
                <Text style={styles.voiceTranscriptMeta}>Transcribing…</Text>
              ) : null}
              {showTranscribe && !transcriptPending ? (
                <Pressable
                  style={styles.voiceTranscribeChip}
                  onPress={() => void requestVoiceTranscript(message)}
                >
                  <Text style={styles.voiceTranscribeChipText}>Transcribe</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })() : null}

        {message.kind === 'file' ? (
          <View style={styles.attachmentCard}>
            <Text style={styles.attachmentTitle}>DOCUMENT</Text>
            <Text style={styles.attachmentName}>{message.text || 'File'}</Text>
            <Text style={styles.attachmentMeta}>{message.fileUri ? 'Tap to open' : 'Waiting for upload'}</Text>
          </View>
        ) : null}

        {message.kind === 'location' ? (
          <View style={styles.locationCard}>
            <View style={styles.locationMap}>
              <Text style={styles.locationPin}>📍</Text>
            </View>
            <Text style={styles.locationTitle}>{message.text && message.text !== 'Shared location' ? message.text : 'Shared location'}</Text>
            <Text style={styles.locationMeta}>Tap to open in Maps</Text>
          </View>
        ) : null}

        {emojiOnly ? (
          <View style={styles.emojiRow}>
            {emojis.map((token, index) => {
              const active = emojiPlayback?.messageId === message.id && emojiPlayback.currentToken === token;
              return active ? (
                <AnimatedText key={`${message.id}-${token}-${index}`} style={[styles.emojiText, emojiAnimatedStyle]}>
                  {token}
                </AnimatedText>
              ) : (
                <Text key={`${message.id}-${token}-${index}`} style={styles.emojiText}>
                  {token}
                </Text>
              );
            })}
          </View>
        ) : null}

        {message.automated ? <Text style={styles.automatedBadge}>Automated reply</Text> : null}
        {message.kind === 'text' ? renderLinkedText(message.text, styles.messageText) : null}
        {message.kind === 'text' && message.text && !message.deletedForEveryone ? (() => {
          const translation = messageTranslations[message.id];
          const busy = translateBusyId === message.id;
          const picking = translatePickerId === message.id;
          return (
            <View style={styles.messageTranslationBlock}>
              {translation ? (
                <>
                  <Text style={styles.messageTranslationText}>{translation.translatedText}</Text>
                  <Text style={styles.messageTranslationBadge}>
                    {translation.partial || translation.needsProvider
                      ? (translation.notice || 'Partial · review before relying on it')
                      : (
                        TRANSLATE_TARGET_OPTIONS.find((item) => item.code === translation.targetLanguage)?.label
                        || translation.targetLanguage
                        || 'en'
                      )}
                  </Text>
                </>
              ) : null}
              {picking ? (
                <View style={styles.translateLangRow}>
                  {TRANSLATE_TARGET_OPTIONS.map((option) => (
                    <Pressable
                      key={option.code}
                      style={[
                        styles.translateChip,
                        option.code === 'en' ? styles.translateChipDefault : null,
                      ]}
                      disabled={busy}
                      onPress={() => {
                        setTranslatePickerId('');
                        void requestMessageTranslation(message, option.code);
                      }}
                    >
                      <Text style={styles.translateChipText}>
                        {option.code === 'en' ? `${option.label} · default` : option.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={styles.translateChip}
                    onPress={() => setTranslatePickerId('')}
                  >
                    <Text style={styles.translateChipText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.translateChip}
                  onPress={() => pickTranslateLanguage(message)}
                  disabled={busy}
                >
                  <Text style={styles.translateChipText}>{busy ? 'Translating…' : 'Translate'}</Text>
                </Pressable>
              )}
            </View>
          );
        })() : null}
        {message.catalogItemId ? (
          <View style={styles.catalogActionRow}>
            <Pressable
              style={styles.draftAction}
              onPress={() => {
                const product = catalogItems.find((item) => item.id === message.catalogItemId);
                if (product) {
                  void payForCatalogItem(product, product.sellerId);
                }
              }}
            >
              <Text style={styles.draftActionText}>Pay</Text>
            </Pressable>
            <Pressable
              style={styles.draftAction}
              onPress={() => void Share.share({ message: message.text || 'Product' })}
            >
              <Text style={styles.draftActionText}>Share</Text>
            </Pressable>
          </View>
        ) : null}
        {message.receiptId ? (
          <View style={styles.catalogActionRow}>
            <Pressable style={styles.draftAction} onPress={() => void openSaleReceipt(message.receiptId)}>
              <Text style={styles.draftActionText}>View receipt</Text>
            </Pressable>
            <Pressable
              style={styles.draftAction}
              onPress={() => {
                const receipt = saleReceipts.find((item) => item.id === message.receiptId);
                void Share.share({ message: receipt ? formatSaleReceiptShare(receipt) : (message.text || 'Receipt') });
              }}
            >
              <Text style={styles.draftActionText}>Share</Text>
            </Pressable>
          </View>
        ) : null}

        {message.documentId ? (
          <Pressable
            style={styles.documentChip}
            onPress={() => void openCommerceDocument(message.documentId)}
          >
            <Text style={styles.documentChipLabel}>
              {(message.documentKind === 'invoice' ? 'Invoice' : 'Quote')}
            </Text>
            <Text style={styles.documentChipMeta} numberOfLines={1}>
              {message.text || 'Open document'}
            </Text>
          </Pressable>
        ) : null}

        {message.attachment && message.kind !== 'image' ? (
          <View style={styles.attachmentCard}>
            <Text style={styles.attachmentTitle}>{message.attachment.kind.toUpperCase()}</Text>
            <Text style={styles.attachmentName}>{message.attachment.name}</Text>
            <Text style={styles.attachmentMeta}>Opened from {message.attachment.source}</Text>
          </View>
        ) : null}

        <View style={styles.messageMetaRow}>
          <Text style={styles.messageTime}>{message.time}</Text>
          {message.mine && appSettings.readReceiptsEnabled ? (
            <Text
              style={[
                styles.receiptBadge,
                message.receiptState === 'read' ? styles.receiptBadgeRead : null,
              ]}
            >
              {receiptGlyph}
            </Text>
          ) : null}
        </View>
      </Pressable>
      </SwipeReply>
    );
  };

  const renderComposerActions = () => {
    const hasText = messageDraft.trim().length > 0;

    if (hasText) {
      return (
        <Pressable style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      );
    }

    return (
      <View style={styles.composerActionRow}>
        <Pressable style={styles.roundButton} onPress={() => setEmojiTrayVisible((current) => !current)}>
          <Text style={styles.roundButtonText}>☺</Text>
        </Pressable>
        <Pressable style={styles.roundButton} onPress={() => setSheetStep('type')}>
          <Text style={styles.roundButtonText}>＋</Text>
        </Pressable>
        <Pressable
          style={[styles.micButton, isRecording ? styles.micButtonRecording : null]}
          onPress={() => {
            if (isRecording) {
              void finishVoiceRecording();
              return;
            }
            void startVoiceRecording();
          }}
        >
          <Text style={styles.micButtonText}>{isRecording ? '■' : '🎤'}</Text>
        </Pressable>
      </View>
    );
  };

  const photoForUser = (userId) => {
    if (!userId) {
      return '';
    }
    if (userId === currentUserId) {
      return profile.photoUri || usersById[userId]?.photoUri || '';
    }
    return usersById[userId]?.photoUri || '';
  };

  const statusTextSize = (value) => {
    const length = String(value || '').trim().length;
    if (length <= 24) return 42;
    if (length <= 70) return 32;
    if (length <= 140) return 24;
    if (length <= 280) return 18;
    return 15;
  };

  const statusItemsFor = (userId) => updatesFeed.find((entry) => entry.userId === userId)?.items ?? [];

  const statusItemSeen = (item) => {
    if (!item) return true;
    if (item.userId === currentUserId) return false;
    return seenStatusIds.includes(item.id) || (item.views ?? []).some((view) => view.userId === currentUserId);
  };

  const userHasStatus = (userId) => statusItemsFor(userId).length > 0;

  const openStatusForUser = (userId) => {
    const index = updatesFeed.findIndex((entry) => entry.userId === userId);
    if (index < 0) {
      return;
    }
    setAvatarPrompt(null);
    setActiveView('Explore');
    openStatusViewer(index);
  };

  const onAvatarPress = (userId, name) => {
    if (!userId) {
      return;
    }
    const photoUri = photoForUser(userId);
    if (userHasStatus(userId)) {
      setAvatarPrompt({ userId, name, photoUri });
      return;
    }
    if (photoUri) {
      setPhotoPreview({ uri: photoUri, name });
    }
  };

  const renderPersonAvatar = ({ userId, name, size = 52, onPress }) => {
    const photoUri = photoForUser(userId);
    const items = statusItemsFor(userId);
    const hasStatus = items.length > 0;
    const unseen = items.some((item) => !statusItemSeen(item));
    const ringColor = !hasStatus ? 'transparent' : (unseen ? '#25D366' : '#c5cdd6');
    const innerSize = size - (hasStatus ? 8 : 0);
    const body = (
      <View
        style={[
          styles.personAvatarOuter,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: hasStatus && items.length < 2 ? 2.5 : 0,
            borderColor: ringColor,
          },
        ]}
      >
        {items.length > 1 ? items.slice(0, 8).map((item, index, list) => {
          const angle = ((360 / list.length) * index - 90) * (Math.PI / 180);
          const radius = size / 2 - 3;
          const tick = list.length > 4 ? 7 : 10;
          return (
            <View
              key={item.id}
              style={{
                position: 'absolute',
                width: tick,
                height: 3.5,
                borderRadius: 2,
                backgroundColor: statusItemSeen(item) ? '#c5cdd6' : '#25D366',
                left: size / 2 + radius * Math.cos(angle) - tick / 2,
                top: size / 2 + radius * Math.sin(angle) - 1.5,
                transform: [{ rotate: `${(360 / list.length) * index}deg` }],
              }}
            />
          );
        }) : null}
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={{ width: innerSize, height: innerSize, borderRadius: innerSize / 2 }}
          />
        ) : (
          <View style={[styles.personAvatarFallback, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
            <Text style={styles.personAvatarLetter}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>
    );
    if (!onPress) {
      return body;
    }
    return (
      <Pressable onPress={onPress} hitSlop={6}>
        {body}
      </Pressable>
    );
  };

  const renderToneMenu = () => (
    <View style={styles.aiToneMenu}>
      <Pressable style={styles.aiToneMenuButton} onPress={() => setAiToneMenuVisible((current) => !current)}>
        <Text style={styles.aiToneMenuButtonText}>Tone · {aiRewriteTone} ▾</Text>
      </Pressable>
      {aiToneMenuVisible ? (
        <View style={styles.aiToneMenuList}>
          {['polite', 'concise', 'professional', 'friendly', 'apologetic'].map((tone) => (
            <Pressable
              key={tone}
              style={styles.aiToneMenuItem}
              onPress={() => {
                setAiRewriteTone(tone);
                setAiToneMenuVisible(false);
              }}
            >
              <Text style={[styles.aiToneMenuItemText, aiRewriteTone === tone ? styles.aiToneMenuItemTextOn : null]}>{tone}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  const renderChatDetail = () => {
    if (!activeChat) {
      return null;
    }
    return (
      <View style={[styles.detailScreen, { paddingBottom: keyboardInset || insets.bottom, backgroundColor: chatWallpaper === 'night' ? '#10141a' : chatWallpaper === 'plain' ? '#efeae2' : '#0c1c17' }]}>
      <View style={styles.detailHeader}>
        <Pressable style={styles.iconCircle} onPress={() => setChatScreen('list')}>
          <Text style={styles.iconText}>←</Text>
        </Pressable>
        {renderPersonAvatar({
          userId: activeChat.peerUserId,
          name: activeChat.name,
          size: 40,
          onPress: () => onAvatarPress(activeChat.peerUserId, activeChat.name),
        })}
        <Pressable style={styles.detailHeaderText} onPress={() => setPeerProfileVisible(true)}>
          <Text style={styles.detailTitle}>{headerLabelFor(activeChat.peerUserId, activeChat.name)}</Text>
          <Text style={styles.detailSubtitle}>{getPresenceLabel(activeChat)}</Text>
        </Pressable>
        <View style={styles.detailHeaderActions}>
          <Pressable style={styles.iconCircle} onPress={() => setChatMenuVisible(true)}>
            <Text style={styles.iconText}>⋮</Text>
          </Pressable>
          <Pressable style={styles.iconCircle} onPress={() => setCallSheetVisible(true)}>
            <Text style={styles.iconText}>☎</Text>
          </Pressable>
          <Pressable style={styles.iconCircle} onPress={() => setNewChatVisible(true)}>
            <Text style={styles.iconText}>✎</Text>
          </Pressable>
        </View>
      </View>

      <View pointerEvents="none" style={styles.wallpaperMarks}>
        {chatWallpaper === 'plain' ? null : ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'].map((mark, index) => (
          <Text
            key={`${mark}-${index}`}
            style={[
              styles.wallpaperMark,
              { top: 30 + (index % 4) * 140, left: 24 + (index % 3) * 110 },
            ]}
          >
            {mark}
          </Text>
        ))}
      </View>
      <ScrollView
        ref={threadRef}
        style={[styles.thread, styles.wallpaperBase, chatWallpaper === 'plain' ? styles.wallpaperPlain : chatWallpaper === 'night' ? styles.wallpaperNight : styles.wallpaperZynkup]}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => {
          if (stickToLatestRef.current) {
            threadRef.current?.scrollToEnd({ animated: false });
          }
        }}
        onScrollBeginDrag={() => {
          stickToLatestRef.current = false;
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
          if (distanceFromBottom < 120) {
            stickToLatestRef.current = true;
          }
        }}
        scrollEventThrottle={80}
      >
        {messages.map(renderBubble)}
      </ScrollView>

      {emojiTrayVisible ? (
        <View style={styles.emojiTray}>
          {emojiOptions.map((emoji) => (
            <Pressable key={emoji} onPress={() => pickEmoji(emoji)} style={styles.emojiTrayButton}>
              <Text style={styles.emojiTrayText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {isRecording ? (
        <View style={styles.recordingBanner}>
          <Animated.View style={[styles.recordPulse, { opacity: recordPulse }]} />
          <Text style={styles.recordingBannerText}>
            {recordingPaused ? `Paused ${recordingLabel.replace('Recording ', '')}` : recordingLabel}
          </Text>
          <Pressable style={styles.draftAction} onPress={() => void toggleRecordingPause()}>
            <Text style={styles.draftActionText}>{recordingPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable style={styles.draftAction} onPress={() => void finishVoiceRecording()}>
            <Text style={styles.draftActionText}>Done</Text>
          </Pressable>
        </View>
      ) : null}

      {voiceDraft ? (
        <View style={styles.recordingBanner}>
          <Pressable
            style={styles.voicePlayButton}
            onPress={() => void playVoiceMessage({
              id: 'voice-draft',
              audioUri: voiceDraft.uri,
              durationLabel: voiceDraft.durationLabel,
              durationSeconds: Math.round((voiceDraft.durationMs || 0) / 1000),
            })}
          >
            <Text style={styles.voiceIcon}>
              {voicePlayback.messageId === 'voice-draft' && voicePlayback.playing ? '❚❚' : '▶'}
            </Text>
          </Pressable>
          <Text style={styles.recordingBannerText}>{voiceDraft.durationLabel}</Text>
          <Pressable style={styles.draftAction} onPress={() => void discardVoiceDraft()}>
            <Text style={styles.draftActionText}>Discard</Text>
          </Pressable>
          <Pressable style={[styles.draftAction, styles.draftActionSend]} onPress={() => void sendVoiceDraft()}>
            <Text style={styles.draftActionText}>Send</Text>
          </Pressable>
        </View>
      ) : null}

      {replyTarget ? (
        <View style={styles.replyComposerBar}>
          <View style={styles.replyComposerCopy}>
            <Text style={styles.replyComposerLabel}>Replying</Text>
            <Text numberOfLines={1} style={styles.replyComposerText}>{replyTarget.text}</Text>
          </View>
          <Pressable onPress={() => setReplyTarget(null)}>
            <Text style={styles.replyComposerClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {scamWarningBanner?.chatId === activeChat.id && scamWarningBanner?.warning?.risky ? (
        <View style={styles.scamWarningBanner}>
          <View style={styles.replyComposerCopy}>
            <Text style={styles.scamWarningTitle}>
              {(scamWarningBanner.warning.signals || []).some((entry) => entry.code === 'pin_request')
                ? 'PIN / OTP warning'
                : 'Scam warning'}
            </Text>
            <Text style={styles.scamWarningText}>
              {scamWarningBanner.warning.advice
                || 'Be careful. Never share MoMo PINs or OTPs.'}
              {scamWarningBanner.warning.disclaimer
                ? ` ${scamWarningBanner.warning.disclaimer}`
                : ''}
            </Text>
          </View>
          <Pressable onPress={() => setScamWarningBanner(null)}>
            <Text style={styles.replyComposerClose}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable style={styles.identityComposer} onPress={() => setIdentitySheetVisible(true)}>
        <Text style={styles.identityComposerText}>
          {(activeChat?.space || 'personal') === (activeBusinessId || 'personal')
            ? `Sending as ${identityLabel}`
            : (activeChat?.space || 'personal') === 'personal'
              ? 'This chat is personal. Switch to Personal to reply.'
              : 'This chat belongs to a business. Switch to it to reply.'}
        </Text>
      </Pressable>
      {activeChat?.kind === 'group' ? (
        <Pressable
          style={[styles.anonymousToggle, anonymousCompose ? styles.anonymousToggleOn : null]}
          onPress={() => setAnonymousCompose((current) => !current)}
        >
          <Text style={styles.anonymousToggleText}>
            {anonymousCompose ? 'Anonymous on · 5 a day in this room' : 'Send as anonymous'}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.aiAssistRow}>
        <Pressable
          style={styles.aiAssistButton}
          onPress={() => openAiHelperSheet('draft')}
        >
          <Text style={styles.aiAssistButtonText}>AI helper</Text>
        </Pressable>
        <Pressable
          style={[styles.aiAssistButton, summaryBusy ? styles.aiAssistButtonBusy : null]}
          disabled={summaryBusy}
          onPress={() => void requestChatSummary('unread')}
        >
          <Text style={styles.aiAssistButtonText}>{summaryBusy ? '…' : 'Summarise'}</Text>
        </Pressable>
        <Pressable
          style={[styles.aiAssistButton, aiAssistBusy ? styles.aiAssistButtonBusy : null]}
          disabled={aiAssistBusy}
          onPress={() => void requestSuggestedReplies()}
        >
          <Text style={styles.aiAssistButtonText}>{aiAssistBusy ? '…' : 'Suggest reply'}</Text>
        </Pressable>
        <Pressable
          style={[styles.aiAssistButton, aiAssistBusy ? styles.aiAssistButtonBusy : null]}
          disabled={aiAssistBusy || !messageDraft.trim()}
          onPress={() => void requestRewriteDraft()}
        >
          <Text style={styles.aiAssistButtonText}>Rewrite</Text>
        </Pressable>
        <Pressable
          style={[styles.aiAssistButton, dictateBusy ? styles.aiAssistButtonBusy : null]}
          disabled={dictateBusy}
          onPress={openDictateSheet}
        >
          <Text style={styles.aiAssistButtonText}>Dictate</Text>
        </Pressable>
      </View>
      {renderToneMenu()}
      {aiSuggestions.length ? (
        <View style={styles.aiChipRow}>
          {aiSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id || suggestion.text}
              style={styles.aiSuggestionChip}
              onPress={() => applyAiSuggestion(suggestion.text)}
            >
              <Text numberOfLines={2} style={styles.aiSuggestionChipText}>{suggestion.text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {aiRewriteVariants.length > 1 ? (
        <View style={styles.aiChipRow}>
          {aiRewriteVariants.map((variant) => (
            <Pressable
              key={variant.id || variant.text}
              style={styles.aiSuggestionChip}
              onPress={() => applyAiSuggestion(variant.text)}
            >
              <Text numberOfLines={2} style={styles.aiSuggestionChipText}>
                {variant.tone ? `${variant.tone}: ` : ''}{variant.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          value={messageDraft}
          onChangeText={(value) => {
            setMessageDraft(value);
            emitTyping(true);
            if (typingTimeoutRef.current) {
              clearTimeout(typingTimeoutRef.current);
            }
            typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1200);
          }}
          placeholder="Message"
          placeholderTextColor="#7d8b92"
          multiline={!appSettings.enterIsSend}
          blurOnSubmit={appSettings.enterIsSend}
          returnKeyType={appSettings.enterIsSend ? 'send' : 'default'}
          onSubmitEditing={() => {
            if (appSettings.enterIsSend) {
              sendMessage();
            }
          }}
          textAlignVertical="top"
          style={styles.composerInput}
        />
        {renderComposerActions()}
      </View>
    </View>
    );
  };

  const dismissHomeCard = (cardId) => {
    const next = [...new Set([...dismissedCards, cardId])];
    setDismissedCards(next);
    void AsyncStorage.setItem(DISMISSED_CARDS_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  const buildHomeCards = (mode) => {
    const unreadChats = visibleChatItems.filter((chat) => Number(chat.unread || 0) > 0);
    const unreadCount = unreadChats.reduce((sum, chat) => sum + Number(chat.unread || 0), 0);
    const pendingRequests = chatRequests.filter((item) => item.state === 'pending' && item.toUserId === currentUserId);
    const missedCalls = calls.filter((call) => call.state === 'missed' || call.state === 'declined');
    const pendingPayments = payHistoryItems.filter((item) => /pending|awaiting|queued/i.test(String(item.status || '')));
    const lowStockItems = filteredCatalogItems.filter((item) => {
      if (item.trackStock === false) return false;
      const stock = Number(item.stockQuantity ?? 0);
      const threshold = Number(item.lowStockThreshold ?? 2);
      return stock <= threshold;
    });
    const cards = [];

    if (mode === 'personal') {
      if (unreadCount > 0) {
        cards.push({
          id: 'personal-unread',
          title: unreadCount === 1 ? '1 unread chat' : `${unreadCount} unread messages`,
          body: unreadChats[0]?.name ? `Latest in ${displayNameFor(unreadChats[0].peerUserId, unreadChats[0].name)}` : 'Open Chats to catch up',
          action: () => {
            setChatListTab('recent');
            if (unreadChats[0]?.id) openChat(unreadChats[0].id);
          },
          dismissible: false,
        });
      }
      if (pendingRequests.length) {
        cards.push({
          id: 'personal-requests',
          title: pendingRequests.length === 1 ? '1 chat request' : `${pendingRequests.length} chat requests`,
          body: 'Someone wants to message you',
          action: () => setChatListTab('requests'),
          dismissible: false,
        });
      }
      if (missedCalls.length) {
        cards.push({
          id: 'personal-missed-calls',
          title: missedCalls.length === 1 ? '1 missed call' : `${missedCalls.length} missed calls`,
          body: missedCalls[0]?.name ? `Last from ${missedCalls[0].name}` : 'Review your call list',
          action: () => setChatListTab('calls'),
          dismissible: true,
        });
      }
      if (pendingPayments.length) {
        cards.push({
          id: 'personal-pending-pay',
          title: pendingPayments.length === 1 ? '1 payment waiting' : `${pendingPayments.length} payments waiting`,
          body: 'Open Pay to check the status',
          action: () => setActiveView('Pay'),
          dismissible: true,
        });
      }
      if (!cards.length) {
        cards.push({
          id: 'personal-quiet',
          title: 'You are caught up',
          body: activeBusinessId ? 'Switch to Business for shop tasks' : 'Start a chat or explore status',
          action: () => {
            if (activeBusinessId) {
              setActiveView('Business');
              return;
            }
            setActiveView('Explore');
          },
          dismissible: true,
        });
      }
    }

    if (mode === 'business') {
      if (!businesses.length) {
        cards.push({
          id: 'business-create',
          title: 'Create your first business',
          body: 'Keep shop work separate from personal chats',
          action: () => setIdentitySheetVisible(true),
          dismissible: false,
        });
      } else {
        if (lowStockItems.length) {
          cards.push({
            id: 'business-low-stock',
            title: lowStockItems.length === 1 ? '1 product is low on stock' : `${lowStockItems.length} products are low on stock`,
            body: lowStockItems[0]?.title || 'Open your catalog',
            action: () => setBusinessPanel('catalog'),
            dismissible: false,
          });
        }
        if (!filteredCatalogItems.length) {
          cards.push({
            id: 'business-empty-catalog',
            title: 'Add your first product',
            body: 'Customers can browse once the catalog is live',
            action: () => setBusinessPanel('catalog'),
            dismissible: true,
          });
        }
        if (pendingPayments.length) {
          cards.push({
            id: 'business-pending-pay',
            title: pendingPayments.length === 1 ? '1 payment needs attention' : `${pendingPayments.length} payments need attention`,
            body: 'Open receipts to follow up',
            action: () => setBusinessPanel('receipts'),
            dismissible: false,
          });
        }
        if (contactItems.filter((contact) => contact.registered || contact.linkedUserId).length === 0) {
          cards.push({
            id: 'business-customers',
            title: 'Find customers on ZynkUP',
            body: 'Sync contacts to see who already joined',
            action: () => {
              void syncPhoneContacts(currentUserId);
              setBusinessPanel('customers');
            },
            dismissible: true,
          });
        }
        if (!cards.length) {
          cards.push({
            id: 'business-quiet',
            title: 'Shop looks clear',
            body: 'Catalog, customers, and receipts are ready when you need them',
            action: () => setBusinessPanel('catalog'),
            dismissible: true,
          });
        }
      }
    }

    return cards
      .filter((card) => !card.dismissible || !dismissedCards.includes(card.id))
      .slice(0, 3);
  };

  const renderHomeCards = (mode) => {
    const cards = buildHomeCards(mode);
    if (!cards.length) {
      return null;
    }
    return (
      <View style={styles.homeCardsWrap}>
        <Text style={styles.homeCardsLabel}>{mode === 'business' ? 'Needs attention' : 'For you'}</Text>
        {cards.map((card) => (
          <Pressable key={card.id} style={styles.homeCard} onPress={card.action}>
            <View style={styles.homeCardCopy}>
              <Text style={styles.homeCardTitle}>{card.title}</Text>
              <Text style={styles.homeCardBody}>{card.body}</Text>
            </View>
            {card.dismissible ? (
              <Pressable
                style={styles.homeCardDismiss}
                onPress={(event) => {
                  event?.stopPropagation?.();
                  dismissHomeCard(card.id);
                }}
              >
                <Text style={styles.homeCardDismissText}>Hide</Text>
              </Pressable>
            ) : (
              <Text style={styles.homeCardChevron}>›</Text>
            )}
          </Pressable>
        ))}
      </View>
    );
  };

  const renderChatList = () => {
    const unreadCount = visibleChatItems.filter((chat) => Number(chat.unread || 0) > 0).length;
    const requestCount = chatRequests.filter((item) => item.state === 'pending' && item.toUserId === currentUserId).length;
    const listedChats = visibleChatItems.filter((chat) => {
      if (chatListTab === 'unread') return Number(chat.unread || 0) > 0;
      if (chatListTab === 'groups') return chat.kind === 'group';
      return true;
    });

    const renderChatRow = (chat, index) => (
      <View key={chat.id} style={styles.chatHomeRow}>
        <View style={styles.chatAvatarSlot}>
          {renderPersonAvatar({
            userId: chat.peerUserId,
            name: chat.name,
            size: 56,
            onPress: () => onAvatarPress(chat.peerUserId, chat.name),
          })}
          {chat.unread > 0 ? <View style={styles.chatHomePresenceDot} /> : null}
        </View>
        <Pressable
          style={styles.chatHomeCopy}
          onPress={() => openChat(chat.id)}
          onLongPress={() => setChatActionChat(chat)}
        >
          <View style={styles.chatHomeCopyInner}>
          <View style={styles.chatHomeTopRow}>
            <View style={styles.chatHomeNameRow}>
              {favoriteChatIds.includes(chat.id) ? (
                <Text style={styles.chatHomeFavoriteStar}>★</Text>
              ) : null}
              <Text numberOfLines={1} style={styles.chatHomeName}>{displayNameFor(chat.peerUserId, chat.name)}</Text>
              {mutedChatIds.includes(chat.id) ? <Text style={styles.chatHomeMuteIcon}>🔕</Text> : null}
              {lockedChatIds.includes(chat.id) ? <Text style={styles.chatHomeMuteIcon}>🔒</Text> : null}
              {/(store|shop|business|biz|kitchen|board)/i.test(chat.name) ? (
                <Text style={styles.chatHomeBadge}>BIZ</Text>
              ) : null}
            </View>
            <Text style={styles.chatHomeTime}>{chat.time}</Text>
          </View>
          <View style={styles.chatHomeBottomRow}>
            <Text numberOfLines={1} style={styles.chatHomePreview}>
              {lockedChatIds.includes(chat.id) ? 'Locked' : (peerTypingByChat[chat.id] ? 'typing…' : (/^-?\d+(?:\.\d+)?\s*,/.test(chat.preview || '') ? 'Shared location' : chat.preview))}
            </Text>
            {chat.unread > 0 ? (
              <View style={styles.chatHomeUnread}>
                <Text style={styles.chatHomeUnreadText}>{chat.unread}</Text>
              </View>
            ) : (
              <View style={styles.chatHomeMuted}>
                <Text style={styles.chatHomeMutedText}>-</Text>
              </View>
            )}
          </View>
          </View>
        </Pressable>
      </View>
    );

    return (
      <View style={styles.chatListScreen}>
        <View style={styles.chatListHeader}>
          <View style={styles.chatListTitleBlock}>
            <Image source={brandMark} style={styles.chatListMark} />
            <View>
              <Text style={styles.chatListTitle}>Chats</Text>
              <Pressable onPress={() => setIdentitySheetVisible(true)}>
                <Text style={styles.chatListIdentity}>{identityLabel} ▾</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.lightHeaderActions}>
            <Pressable
              style={styles.chatListAction}
              onPress={() => setChatSearchOpen((current) => !current)}
            >
              <Text style={styles.chatListActionText}>⌕</Text>
            </Pressable>
            <Pressable
              style={styles.chatListAction}
              onPress={() => setActiveView('Profile')}
            >
              <Text style={styles.chatListActionText}>⋮</Text>
            </Pressable>
          </View>
        </View>

        {appNotice ? (
          <View style={[styles.businessAlertCard, { marginHorizontal: 16 }]}>
            <Text style={styles.businessAlertText}>{appNotice}</Text>
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chatFilterRow}>
          {[
            ['recent', 'All'],
            ['unread', unreadCount ? `Unread  ${unreadCount}` : 'Unread'],
            ['groups', 'Groups'],
            ['calls', 'Calls'],
            ['requests', requestCount ? `Requests  ${requestCount}` : 'Requests'],
          ].map(([id, label]) => (
            <Pressable key={id} style={[styles.chatFilterChip, chatListTab === id ? styles.chatFilterChipOn : null]} onPress={() => setChatListTab(id)}>
              <Text style={[styles.chatFilterText, chatListTab === id ? styles.chatFilterTextOn : null]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {chatListTab === 'calls' ? renderCalls() : null}

        {chatListTab !== 'calls' && chatSearchOpen ? (
          <TextInput
            value={chatSearchQuery}
            onChangeText={setChatSearchQuery}
            placeholder="Search chats"
            placeholderTextColor="#9aa3b2"
            style={styles.chatSearchInput}
            autoFocus
          />
        ) : null}

        {chatListTab !== 'calls' && archivedChatIds.length ? (
          <Pressable style={styles.archiveRow} onPress={() => setShowArchivedChats((current) => !current)}>
            <Text style={styles.archiveIcon}>▦</Text>
            <Text style={styles.archiveText}>
              {showArchivedChats ? 'Back to chats' : `Archived (${archivedChatIds.length})`}
            </Text>
          </Pressable>
        ) : null}

        {chatListTab === 'calls' ? null : <View style={styles.chatListShell}>
          <ScrollView
            style={styles.lightScroll}
            contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset + 72 }]}
            showsVerticalScrollIndicator={false}
          >
            {chatListTab === 'recent' || chatListTab === 'unread' || chatListTab === 'groups' ? renderHomeCards(activeBusinessId ? 'business' : 'personal') : null}
            {chatListTab === 'requests' ? (
              <View>
                <Text style={styles.lightSectionLabel}>CHAT REQUESTS</Text>
                {chatRequests.filter((item) => item.state !== 'rejected').length ? chatRequests.filter((item) => item.state !== 'rejected').map((request) => {
                  const otherId = request.fromUserId === currentUserId ? request.toUserId : request.fromUserId;
                  const incoming = request.toUserId === currentUserId && request.state === 'pending';
                  return (
                    <View key={request.id} style={styles.statusFeedCard}>
                      <Text style={styles.statusFeedName}>{displayNameFor(otherId)}</Text>
                      <Text style={styles.statusFeedTime}>{request.state === 'pending' ? (incoming ? 'Wants to chat' : 'Waiting for them') : 'Accepted'}</Text>
                      {incoming ? (
                        <View style={styles.catalogActionRow}>
                          <Pressable style={styles.catalogChip} onPress={() => void fetch(`${API_BASE_URL}/api/chat-requests/${request.id}/accept`, { method: 'POST' }).then((response) => response.json()).then((payload) => {
                            setChatRequests((current) => current.map((item) => item.id === request.id ? payload.request : item));
                            if (payload.chat) {
                              const mapped = mapChatFromServer(payload.chat, currentUserId, usersById);
                              setChatItems((current) => [mapped, ...current.filter((item) => item.id !== mapped.id)]);
                            }
                            showToast('Request accepted. You can chat now.', 'success');
                          })}>
                            <Text style={styles.catalogChipText}>Accept</Text>
                          </Pressable>
                          <Pressable style={styles.catalogChip} onPress={() => void fetch(`${API_BASE_URL}/api/chat-requests/${request.id}/reject`, { method: 'POST' }).then(() => {
                            setChatRequests((current) => current.filter((item) => item.id !== request.id));
                          })}>
                            <Text style={styles.catalogChipText}>Reject</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                }) : <Text style={styles.cardBody}>No chat requests.</Text>}
              </View>
            ) : null}
            {chatListTab === 'recent' || chatListTab === 'unread' || chatListTab === 'groups' ? (
              listedChats.length ? listedChats.map((chat, index) => renderChatRow(chat, index)) : (
                <View style={styles.emptyChatCard}>
                  <Text style={styles.cardTitle}>{chatListTab === 'unread' ? 'No unread chats' : chatListTab === 'groups' ? 'No groups yet' : 'No chats yet'}</Text>
                  <Text style={styles.cardBody}>Start a new conversation with one of your registered contacts.</Text>
                  <Pressable
                    style={styles.sendButtonWide}
                    onPress={() => {
                      void syncPhoneContacts(currentUserId);
                      setNewChatVisible(true);
                    }}
                  >
                    <Text style={styles.sendButtonText}>New conversation</Text>
                  </Pressable>
                </View>
              )
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.chatFab, { bottom: lightContentBottomInset + 12 }]}
            onPress={() => {
              void syncPhoneContacts(currentUserId);
              setNewChatQuery('');
              setNewChatVisible(true);
            }}
          >
            <Text style={styles.chatFabText}>+</Text>
          </Pressable>
        </View>}
      </View>
    );
  };

  const renderCalls = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      {calls.length ? null : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No calls yet</Text>
          <Text style={styles.cardBody}>Open a chat and start an audio or video call. Calls with your contacts show up here.</Text>
        </View>
      )}
      {calls.map((call) => {
        const outgoing = call.initiatorId === currentUserId;
        const unanswered = call.state === 'missed' || call.state === 'declined';
        const missed = unanswered;
        const directionLabel = !outgoing && call.state === 'missed'
          ? 'Missed'
          : !outgoing && call.state === 'declined'
            ? 'Declined'
            : outgoing
              ? 'Outgoing'
              : 'Incoming';
        const arrow = outgoing ? '↗' : '↙';
        const started = formatCallStamp(call.startedAt) || call.time;
        const ended = formatCallStamp(call.endedAt);
        const duration = call.durationSeconds > 0 ? getAudioDurationLabel(call.durationSeconds * 1000) : '';
        return (
          <Pressable key={call.id} style={styles.callLogRow} onPress={() => {
            const peerId = call.peerUserId;
            if (!peerId) return;
            void startCall(call.kind === 'Video' ? 'Video' : 'Audio', peerId);
          }} onLongPress={() => {
            Alert.alert('Delete this call?', 'It disappears from your call list.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  setCalls((current) => current.filter((item) => item.id !== call.id));
                  void fetch(`${API_BASE_URL}/api/calls/${encodeURIComponent(call.id)}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId }),
                  });
                },
              },
            ]);
          }}>
            {renderPersonAvatar({
              userId: call.peerUserId,
              name: call.name,
              size: 48,
              onPress: () => onAvatarPress(call.peerUserId, call.name),
            })}
            <View style={styles.callLogCopy}>
              <Text style={[styles.callLogName, missed ? styles.callLogMissed : null]}>{call.name}</Text>
              <Text style={[styles.callLogMeta, missed ? styles.callLogMissed : null]}>
                {arrow} {directionLabel}{duration ? ` · ${duration}` : ''} · {call.kind}
              </Text>
              <Text style={styles.callLogTime}>
                {started}{ended ? ` – ${ended}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const renderPay = () => (
    <View style={styles.lightScreen}>
      <View style={styles.lightHeader}>
        <Image source={brandLockup} style={styles.brandHeaderLockup} resizeMode="contain" />
        <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Profile')}>
          <Text style={styles.lightHeaderActionText}>◔</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.lightScroll}
        contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.payHeroCard}>
          <Text style={styles.payHeroLabel}>Wallet balance</Text>
          <Text style={styles.payHeroAmount}>{accountCurrency} 0.00</Text>
          <Text style={styles.payHeroMeta}>No mobile-money wallet linked yet</Text>
          <View style={styles.payHeroActions}>
            {[
              { label: 'Send', icon: '↗', action: 'send' },
              { label: 'Request', icon: '+', action: 'request' },
              { label: 'Top up', icon: '▭', action: 'topup' },
              { label: 'Orders', icon: '▣', action: 'orders' },
              { label: 'History', icon: '◔', action: 'history' },
            ].map((action) => (
              <Pressable
                key={action.label}
                style={styles.payHeroAction}
                onPress={() => {
                  setPayForm({ amount: '', phone: '', note: '' });
                  if (action.action === 'orders') {
                    setOrderRoleFilter('buyer');
                    void loadCommerceOrders('buyer');
                  }
                  setPaySheet(action.action);
                }}
              >
                <View style={styles.payHeroActionIcon}>
                  <Text style={styles.payHeroActionIconText}>{action.icon}</Text>
                </View>
                <Text style={styles.payHeroActionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.lightSectionTitle}>Quick send</Text>
        <View style={styles.quickSendRow}>
          {payQuickContacts.slice(0, 4).map((contact, index) => (
            <Pressable
              key={contact.id}
              style={styles.quickSendItem}
              onPress={() => {
                setPayForm({ amount: '', phone: contact.phone || '', note: '' });
                setPaySheet('send');
              }}
            >
              {photoForUser(contact.userId) ? (
                <Image source={{ uri: photoForUser(contact.userId) }} style={styles.quickSendAvatar} />
              ) : (
                <View style={[styles.quickSendAvatar, { backgroundColor: ['#dff3ec', '#f8eedb', '#dbe7f4', '#f0dff0'][index % 4] }]}>
                  <Text style={styles.quickSendAvatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text numberOfLines={1} style={styles.quickSendName}>{contact.name.split(' ')[0]}</Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.quickSendItem}
            onPress={() => {
              setPayForm({ amount: '', phone: '', note: '' });
              setPaySheet('send');
            }}
          >
            <View style={[styles.quickSendAvatar, styles.quickSendAvatarAdd]}>
              <Text style={styles.quickSendAvatarAddText}>+</Text>
            </View>
            <Text style={styles.quickSendName}>New</Text>
          </Pressable>
        </View>

        <Text style={styles.lightSectionTitle}>Recent transactions</Text>
        <View style={styles.payTransactionList}>
          {payHistoryItems.length ? null : (
            <Text style={styles.cardBody}>No payments yet. Send, request, or top up to see them here.</Text>
          )}
          {payHistoryItems.map((transaction, index, list) => (
            <View key={transaction.id} style={[styles.payTransactionRow, index === list.length - 1 ? styles.payTransactionRowLast : null]}>
              <View style={[styles.payTransactionAvatar, { backgroundColor: ['#dff3ec', '#dbe7f4', '#e9efe1'][index % 3] }]}>
                <Text style={styles.payTransactionAvatarText}>{transaction.title.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.payTransactionCopy}>
                <Text numberOfLines={1} style={styles.payTransactionTitle}>{transaction.title}</Text>
                <Text style={styles.payTransactionMeta}>{transaction.time}</Text>
              </View>
              <Text style={[styles.payTransactionAmount, transaction.positive ? styles.payTransactionAmountPositive : null]}>
                {transaction.amount}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  const createCommunity = async () => {
    const name = communityName.trim();
    if (name.length < 2) {
      showToast('Enter a community name.', 'error');
      return;
    }
    const response = await fetch(`${API_BASE_URL}/api/communities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, name, privacy: 'public' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not create the community.', 'error');
      return;
    }
    setCommunityName('');
    setExploreReload((current) => current + 1);
    showToast('Community created.', 'success');
  };

  const joinCommunity = async (communityId) => {
    const response = await fetch(`${API_BASE_URL}/api/communities/${communityId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not join.', 'error');
      return;
    }
    setExploreReload((current) => current + 1);
    showToast('Joined.', 'success');
  };

  const rsvpEvent = async (eventId) => {
    const response = await fetch(`${API_BASE_URL}/api/events/${eventId}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, status: 'going' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not RSVP.', 'error');
      return;
    }
    setCommunityEvents((current) => current.map((item) => item.id === eventId ? { ...item, ...(payload.event || {}), myRsvp: { status: 'going' } } : item));
    showToast('You are going.', 'success');
  };

  const startGame = async (gameSlug) => {
    const response = await fetch(`${API_BASE_URL}/api/games/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId, gameSlug }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || 'Could not start the game.', 'error');
      return;
    }
    showToast(payload.session?.status === 'lobby' ? 'Game lobby is open.' : 'Game started.', 'success');
  };

  const renderExplore = () => (
    <View style={styles.lightScreen}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chatFilterRow}>
        {[
          ['status', 'Status'],
          ['community', 'Community'],
          ['events', 'Events'],
          ['games', 'Games'],
        ].map(([id, label]) => (
          <Pressable key={id} style={[styles.chatFilterChip, exploreSection === id ? styles.chatFilterChipOn : null, styles.exploreChip]} onPress={() => setExploreSection(id)}>
            <Text style={[styles.chatFilterText, exploreSection === id ? styles.chatFilterTextOn : null, exploreSection === id ? null : styles.exploreChipText]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {exploreSection === 'status' ? renderStatus() : (
        <ScrollView contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}>
          {exploreBusy ? <ActivityIndicator color="#7C3AED" style={{ marginTop: 24 }} /> : null}
          {exploreSection === 'community' ? (
            <View>
              <Text style={styles.lightSectionLabel}>YOUR COMMUNITIES</Text>
              {communitiesMine.length ? communitiesMine.map((community) => (
                <View key={community.id} style={styles.statusFeedCard}>
                  <Text style={styles.statusFeedName}>{community.name}</Text>
                  <Text style={styles.statusFeedBody}>{community.description || `${community.memberCount || 1} members · ${community.privacy || 'public'}`}</Text>
                </View>
              )) : <Text style={styles.cardBody}>You have not joined a community yet.</Text>}
              <Text style={styles.lightSectionLabel}>DISCOVER</Text>
              {communitiesDiscover.filter((community) => !communitiesMine.some((mine) => mine.id === community.id)).map((community) => (
                <View key={community.id} style={styles.statusFeedCard}>
                  <Text style={styles.statusFeedName}>{community.name}</Text>
                  <Text style={styles.statusFeedBody}>{community.description || community.privacy || 'Public community'}</Text>
                  <Pressable style={styles.catalogChip} onPress={() => void joinCommunity(community.id)}>
                    <Text style={styles.catalogChipText}>Join</Text>
                  </Pressable>
                </View>
              ))}
              <TextInput
                value={communityName}
                onChangeText={setCommunityName}
                placeholder="New community name"
                placeholderTextColor="#7d8b92"
                style={styles.input}
              />
              <Pressable style={styles.sendButtonWide} onPress={() => void createCommunity()}>
                <Text style={styles.sendButtonText}>Create community</Text>
              </Pressable>
            </View>
          ) : null}
          {exploreSection === 'events' ? (
            <View>
              <Text style={styles.lightSectionLabel}>EVENTS</Text>
              {communityEvents.length ? communityEvents.map((event) => (
                <View key={event.id} style={styles.statusFeedCard}>
                  <Text style={styles.statusFeedName}>{event.title}</Text>
                  <Text style={styles.statusFeedBody}>{event.startsAt ? new Date(event.startsAt).toLocaleString() : 'Time to be announced'} · {event.status || 'scheduled'}</Text>
                  <Pressable style={styles.catalogChip} onPress={() => void rsvpEvent(event.id)}>
                    <Text style={styles.catalogChipText}>{event.myRsvp?.status === 'going' ? 'Going' : 'RSVP'}</Text>
                  </Pressable>
                </View>
              )) : <Text style={styles.cardBody}>No events yet. Communities can host them.</Text>}
            </View>
          ) : null}
          {exploreSection === 'games' ? (
            <View>
              <Text style={styles.lightSectionLabel}>GAMES</Text>
              {gameCatalog.length ? gameCatalog.map((game) => (
                <View key={game.slug || game.id} style={styles.statusFeedCard}>
                  <Text style={styles.statusFeedName}>{game.name || game.title}</Text>
                  <Text style={styles.statusFeedBody}>{game.description || game.pointsNote || 'Points stay on your profile. They are not cash.'}</Text>
                  <Pressable style={styles.catalogChip} onPress={() => void startGame(game.slug)} disabled={Boolean(game.comingSoon)}>
                    <Text style={styles.catalogChipText}>{game.comingSoon ? 'Soon' : 'Play'}</Text>
                  </Pressable>
                </View>
              )) : <Text style={styles.cardBody}>Games will show here when the catalog is available.</Text>}
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );

  const renderStatus = () => {
    const myStatusRaw = updatesFeed.find((entry) => entry.userId === currentUserId);
    const myStatus = myStatusRaw
      ? { ...myStatusRaw, items: (myStatusRaw.items || []).filter((item) => statusStillLive(item)) }
      : null;
    const otherUpdates = updatesFeed.filter((entry) => entry.userId !== currentUserId);

    return (
      <View style={styles.lightScreen}>
        <View style={styles.lightHeader}>
          <View>
            <Text style={styles.appWordmark}>
              Expl<Text style={styles.appWordmarkAccent}>ore</Text>
            </Text>
            <Text style={styles.identityChipText}>Status and marketplace</Text>
          </View>
          <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Profile')}>
            <Text style={styles.lightHeaderActionText}>◌</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.lightScroll}
          contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}
          showsVerticalScrollIndicator={false}
        >
          {appNotice ? (
            <View style={styles.businessAlertCard}>
              <Text style={styles.businessAlertText}>{appNotice}</Text>
            </View>
          ) : null}
          <View style={styles.statusComposerCard}>
            <Pressable
              onPress={() => {
                if (myStatus?.items?.length) {
                  openStatusViewer(updatesFeed.findIndex((entry) => entry.userId === currentUserId));
                  return;
                }
                setStatusComposerVisible(true);
              }}
            >
              {renderPersonAvatar({
                userId: currentUserId,
                name: profile.name || 'You',
                size: 58,
              })}
            </Pressable>
            <Pressable style={styles.statusComposerCopy} onPress={() => setStatusComposerVisible(true)}>
              <Text style={styles.statusAddTitle}>{myStatus?.items?.length ? 'My status' : 'Add your status'}</Text>
              <Text style={styles.statusAddMeta}>
                {myStatus?.items?.[0]?.createdAt
                  ? formatClock(myStatus.items[0].createdAt)
                  : 'Photo · Video · Text · Product'}
              </Text>
            </Pressable>
            <Pressable style={styles.statusAddBadge} onPress={() => setStatusComposerVisible(true)}>
              <Text style={styles.statusComposerPlus}>+</Text>
            </Pressable>
          </View>

          <View style={styles.modeSwitch}>
            {[
              ['contacts', 'My contacts'],
              ['marketplace', 'Marketplace'],
              ['public', 'Public'],
            ].map(([id, label]) => (
              <Pressable key={id} style={[styles.modeSwitchButton, statusTab === id ? styles.modeSwitchButtonActive : null]} onPress={() => setStatusTab(id)}>
                <Text style={[styles.modeSwitchText, statusTab === id ? styles.modeSwitchTextActive : null]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.lightSectionLabel}>{statusTab === 'contacts' ? 'CONTACTS' : statusTab === 'marketplace' ? 'MARKETPLACE' : 'PUBLIC'}</Text>
          {statusTab === 'contacts' ? otherUpdates.filter((entry) => (entry.items ?? []).some((item) => {
            if (!statusStillLive(item)) return false;
            const audience = item.audience || 'contacts';
            return audience !== 'public' && audience !== 'marketplace' && isMutualContact(entry.userId);
          })).map((entry) => {
            const latestStatus = entry.items?.[0];
            const feedIndex = updatesFeed.findIndex((candidate) => candidate.userId === entry.userId);
            return (
              <Pressable key={entry.userId} style={styles.statusFeedCard} onPress={() => openStatusViewer(feedIndex)}>
                <View style={styles.statusFeedAvatarWrap}>
                  {renderPersonAvatar({ userId: entry.userId, name: entry.name, size: 52 })}
                </View>
                <View style={styles.statusFeedCopy}>
                  <Text numberOfLines={1} style={styles.statusFeedName}>{displayNameFor(entry.userId, entry.name)}</Text>
                  <Text style={styles.statusFeedTime}>{latestStatus?.createdAt ? formatClock(latestStatus.createdAt) : 'Just now'}</Text>
                  <Text numberOfLines={2} style={styles.statusFeedBody}>
                    {latestStatus?.text || latestStatus?.assets?.[0]?.caption || 'Tap to view latest update'}
                  </Text>
                </View>
                <View style={[styles.statusFeedDot, entry.items?.every((item) => statusItemSeen(item)) ? styles.statusFeedDotSeen : null]} />
              </Pressable>
            );
          }) : null}
          {statusTab === 'public' ? (
            <View style={styles.publicGrid}>
              {updatesFeed.flatMap((entry) => (entry.items ?? []).filter((item) => statusStillLive(item) && (item.audience || 'contacts') === 'public').map((item) => ({
                ...item,
                authorName: entry.userId === currentUserId ? 'You' : displayNameFor(entry.userId, entry.name),
              }))).sort((left, right) => {
                const mine = (right.userId === currentUserId) - (left.userId === currentUserId);
                if (mine) return mine;
                return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
              }).map((item) => {
                const feedIndex = updatesFeed.findIndex((candidate) => candidate.userId === item.userId);
                const cover = item.assets?.find((asset) => asset.url)?.url;
                return (
                  <Pressable key={item.id} style={styles.publicCard} onPress={() => openStatusViewer(feedIndex)}>
                    {cover ? <Image source={{ uri: cover }} style={styles.publicCardImage} /> : <View style={[styles.publicCardImage, { backgroundColor: item.backgroundColor || '#8d3a3a' }]} />}
                    <View style={styles.publicCardShade} />
                    <View style={styles.publicCardLogo}>
                      {renderPersonAvatar({ userId: item.userId, name: item.authorName, size: 34 })}
                    </View>
                    <Text numberOfLines={2} style={styles.publicCardName}>{item.authorName}</Text>
                    {item.userId === currentUserId ? (
                      <Pressable style={styles.publicTakeDown} onPress={() => deleteStatus(item.id)}>
                        <Text style={styles.publicTakeDownText}>Take down</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {statusTab === 'marketplace' ? (
            <>
              <TextInput value={catalogSearch} onChangeText={setCatalogSearch} placeholder="Search products" placeholderTextColor="#7d8b92" style={styles.input} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                {PRODUCT_CATEGORIES.map((category) => (
                  <Pressable key={category} style={[styles.marketFilterChip, marketCategory === category ? styles.marketFilterChipOn : null]} onPress={() => setMarketCategory(category)}>
                    <Text style={styles.marketFilterText}>{category}</Text>
                  </Pressable>
                ))}
                {['Any', 'Under 500', '500-2000', '2000+'].map((band) => (
                  <Pressable key={band} style={[styles.marketFilterChip, marketPrice === band ? styles.marketFilterChipOn : null]} onPress={() => setMarketPrice(band)}>
                    <Text style={styles.marketFilterText}>{band}</Text>
                  </Pressable>
                ))}
                {['All', accountCountry?.name || 'My country'].filter(Boolean).map((region) => (
                  <Pressable key={region} style={[styles.marketFilterChip, marketRegion === region ? styles.marketFilterChipOn : null]} onPress={() => setMarketRegion(region)}>
                    <Text style={styles.marketFilterText}>{region}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.marketGrid}>
                {catalogItems.filter((item) => {
                  const status = item.status || 'active';
                  return item.isPublic && !item.takenDown && status !== 'archived' && status !== 'draft';
                }).filter((item) => {
                  if (marketCategory !== 'All' && item.category !== marketCategory) return false;
                  const amount = Number(item.priceAmount || 0);
                  if (marketPrice === 'Under 500' && amount >= 500) return false;
                  if (marketPrice === '500-2000' && (amount < 500 || amount > 2000)) return false;
                  if (marketPrice === '2000+' && amount < 2000) return false;
                  const query = catalogSearch.trim().toLowerCase();
                  if (query && !`${item.title} ${item.description} ${item.seller} ${item.location}`.toLowerCase().includes(query)) return false;
                  return true;
                }).sort((left, right) => {
                  const mine = (right.sellerId === currentUserId) - (left.sellerId === currentUserId);
                  if (mine) return mine;
                  const leftBoost = left.boostedUntil && new Date(left.boostedUntil) > new Date();
                  const rightBoost = right.boostedUntil && new Date(right.boostedUntil) > new Date();
                  if (leftBoost !== rightBoost) return rightBoost - leftBoost;
                  return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
                }).map((item) => {
                  const boosted = item.boostedUntil && new Date(item.boostedUntil) > new Date();
                  return (
                    <Pressable key={item.id} style={styles.marketCard} onPress={() => { setProductImageIndex(0); setProductDetail(item); }}>
                      {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.marketCardImage} /> : <View style={[styles.marketCardImage, styles.catalogManageImageFallback]} />}
                      {boosted ? <Text style={styles.marketBoostBadge}>{item.boostText || 'Featured'}</Text> : null}
                      <Text style={styles.marketPrice}>{item.price}</Text>
                      <Text numberOfLines={2} style={styles.marketTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={styles.marketMeta}>{item.location || accountCountry?.name || 'Nearby'} · {item.condition || 'New'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

        </ScrollView>
      </View>
    );
  };

  const renderBusiness = () => {
    const businessName = profile.businessName || profile.name || 'Your business';
    const registeredCustomers = contactItems.filter((contact) => contact.registered || contact.linkedUserId);
    const customerCount = businessCustomers.length || registeredCustomers.length;
    const dueFollowUps = businessCustomers.filter(
      (customer) => customer.followUpAt && new Date(customer.followUpAt).getTime() <= Date.now(),
    ).length;
    const sellerOrders = commerceOrders.filter((order) => order.sellerUserId === currentUserId);
    const orderCount = sellerOrders.length || payHistoryItems.length;
    const openOrderCount = sellerOrders.filter((order) => !['completed', 'cancelled', 'refunded'].includes(order.state)).length;
    const catalogCount = filteredCatalogItems.length;

    return (
      <View style={styles.lightScreen}>
        <View style={styles.lightHeader}>
          <Text style={styles.businessModeTitle}>
            Business <Text style={styles.appWordmarkAccent}>Mode</Text>
          </Text>
          <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Profile')}>
            <Text style={styles.lightHeaderActionText}>≋</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.lightScroll}
          contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={styles.identityComposer} onPress={() => setIdentitySheetVisible(true)}>
            <Text style={styles.identityComposerText}>
              {activeBusiness ? `Working as ${activeBusiness.name}` : 'Personal mode. Create or switch to a business.'}
            </Text>
          </Pressable>

          {renderHomeCards('business')}

          {!businesses.length ? (
            <View style={styles.businessHeroCard}>
              <Text style={styles.businessHeroTitle}>Create a business</Text>
              <Text style={styles.businessHeroMeta}>Your personal chats stay separate.</Text>
              <TextInput
                value={businessDraft.name}
                onChangeText={(value) => setBusinessDraft((current) => ({ ...current, name: value }))}
                placeholder="Business name"
                placeholderTextColor="#9aa3b2"
                style={styles.chatSearchInput}
              />
              <TextInput
                value={businessDraft.description}
                onChangeText={(value) => setBusinessDraft((current) => ({ ...current, description: value }))}
                placeholder="What you sell"
                placeholderTextColor="#9aa3b2"
                style={styles.chatSearchInput}
              />
              <Pressable style={styles.authDarkButton} onPress={() => void createBusinessProfile()}>
                <Text style={styles.authDarkButtonText}>Create business</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.businessHeroCard}>
            <Text numberOfLines={1} style={styles.businessHeroTitle}>
              {activeBusiness?.name || businessName}
              {(activeBusiness?.verificationStatus || '') === 'approved' ? ' ✓' : ''}
            </Text>
            <Text style={styles.businessHeroMeta}>
              {activeBusiness
                ? `${(activeBusiness.visibility || 'draft') === 'published' ? 'Public storefront' : 'Draft'} · ${(activeBusiness.verificationStatus || 'unverified') === 'approved' ? 'Verified' : (activeBusiness.verificationStatus || 'unverified') === 'pending' ? 'Verification pending' : 'Not verified'}`
                : accountCountry?.name
                  ? `${accountCurrency} · ${accountCountry.name}`
                  : accountCurrency}
            </Text>
            <View style={styles.businessStatsRow}>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>{catalogCount}</Text>
                <Text style={styles.businessStatLabel}>Products</Text>
              </View>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>{openOrderCount || orderCount}</Text>
                <Text style={styles.businessStatLabel}>Orders</Text>
              </View>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>{customerCount}</Text>
                <Text style={styles.businessStatLabel}>Customers</Text>
              </View>
            </View>
            {activeBusiness ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Pressable style={styles.authDarkButton} onPress={openSalesDashboard}>
                  <Text style={styles.authDarkButtonText}>Sales dashboard</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={openBusinessStorefrontEditor}>
                  <Text style={styles.ghostButtonText}>Edit storefront</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={[styles.authDarkButton, { marginTop: 12 }]} onPress={openSalesDashboard}>
                <Text style={styles.authDarkButtonText}>Sales dashboard</Text>
              </Pressable>
            )}
          </View>

          {activeBusiness && activeBusiness.ownerUserId === currentUserId ? (
            <View style={styles.businessHeroCard}>
              <Text style={styles.businessHeroTitle}>Staff</Text>
              <Text style={styles.businessHeroMeta}>Staff see this business only. They cannot open your personal chats.</Text>
              {(activeBusiness.members || []).map((member) => (
                <Text key={member.userId} style={styles.businessHeroMeta}>
                  {member.userId === currentUserId ? 'You' : (usersById[member.userId]?.name || member.userId)} · {member.role}
                </Text>
              ))}
              <TextInput
                value={staffDraft.phone}
                onChangeText={(value) => setStaffDraft((current) => ({ ...current, phone: value }))}
                placeholder="Staff phone number"
                placeholderTextColor="#9aa3b2"
                keyboardType="phone-pad"
                style={styles.chatSearchInput}
              />
              <View style={styles.modeSwitch}>
                {['manager', 'sales', 'support'].map((role) => (
                  <Pressable
                    key={role}
                    style={[styles.modeSwitchButton, staffDraft.role === role ? styles.modeSwitchButtonActive : null]}
                    onPress={() => setStaffDraft((current) => ({ ...current, role }))}
                  >
                    <Text style={[styles.modeSwitchText, staffDraft.role === role ? styles.modeSwitchTextActive : null]}>{role}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.authDarkButton} onPress={() => void addBusinessStaff()}>
                <Text style={styles.authDarkButtonText}>Add staff</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.businessGrid}>
            <Pressable style={styles.businessGridCard} onPress={openSalesDashboard}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>▦</Text></View>
              <Text style={styles.businessGridTitle}>Dashboard</Text>
              <Text style={styles.businessGridMeta}>Sales & stock</Text>
            </Pressable>
            <Pressable style={styles.businessGridCard} onPress={openBusinessStorefrontEditor}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◎</Text></View>
              <Text style={styles.businessGridTitle}>Storefront</Text>
              <Text style={styles.businessGridMeta}>
                {(activeBusiness?.visibility || 'draft') === 'published' ? 'Public profile' : 'Draft · publish'}
              </Text>
            </Pressable>
            <Pressable style={styles.businessGridCard} onPress={() => setBusinessPanel('catalog')}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>▤</Text></View>
              <Text style={styles.businessGridTitle}>My catalog</Text>
              <Text style={styles.businessGridMeta}>{catalogCount} products live</Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadBusinessCustomers();
                void syncPhoneContacts(currentUserId, { quiet: true });
                setSelectedCustomer(null);
                setBusinessPanel('customers');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◌</Text></View>
              <Text style={styles.businessGridTitle}>Customers</Text>
              <Text style={styles.businessGridMeta}>
                {dueFollowUps ? `${dueFollowUps} follow-ups` : `${customerCount} records`}
              </Text>
            </Pressable>
            <Pressable style={styles.businessGridCard} onPress={() => openOrdersPanel('seller')}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>▣</Text></View>
              <Text style={styles.businessGridTitle}>Orders</Text>
              <Text style={styles.businessGridMeta}>
                {openOrderCount ? `${openOrderCount} open` : `${sellerOrders.length} total`}
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadInventoryAlerts();
                setBusinessPanel('inventory');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>▥</Text></View>
              <Text style={styles.businessGridTitle}>Inventory</Text>
              <Text style={styles.businessGridMeta}>
                {inventoryAlerts.filter((alert) => alert.state === 'open').length
                  ? `${inventoryAlerts.filter((alert) => alert.state === 'open').length} alerts`
                  : 'Stock & alerts'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadSaleReceipts();
                setBusinessPanel('receipts');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>□</Text></View>
              <Text style={styles.businessGridTitle}>Receipts</Text>
              <Text style={styles.businessGridMeta}>
                {saleReceipts.filter((item) => item.sellerUserId === currentUserId && item.state === 'issued').length || 'Auto-generated'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                setSelectedDocument(null);
                void loadCommerceDocuments();
                setBusinessPanel('documents');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◫</Text></View>
              <Text style={styles.businessGridTitle}>Quotes & invoices</Text>
              <Text style={styles.businessGridMeta}>
                {commerceDocuments.length ? `${commerceDocuments.length} docs` : 'Create & send'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadAutoReplyConfig();
                void loadAutoReplyLogs();
                setBusinessPanel('autoreplies');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>↻</Text></View>
              <Text style={styles.businessGridTitle}>Auto-replies</Text>
              <Text style={styles.businessGridMeta}>
                {autoReplyConfig?.enabled ? 'On' : 'Off'} · {(autoReplyConfig?.rules || []).length} rules
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadBusinessAiConfig();
                setBusinessAiAskResult(null);
                setBusinessPanel('businessai');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>✦</Text></View>
              <Text style={styles.businessGridTitle}>Business AI</Text>
              <Text style={styles.businessGridMeta}>
                {businessAiConfig?.enabled ? 'On' : 'Paused'} · {(businessAiConfig?.faq || []).length} FAQ
              </Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void loadBroadcastCampaigns();
                setBusinessPanel('broadcast');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◍</Text></View>
              <Text style={styles.businessGridTitle}>Broadcast</Text>
              <Text style={styles.businessGridMeta}>
                {broadcastAudiencePreview.opted_in
                  ? `${broadcastAudiencePreview.opted_in} opted in`
                  : 'Opted-in only'}
              </Text>
            </Pressable>
            {activeBusiness && (activeBusiness.visibility || 'draft') === 'published' ? (
              <Pressable
                style={styles.businessGridCard}
                onPress={() => void openPublicBusiness(activeBusiness.id)}
              >
                <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◇</Text></View>
                <Text style={styles.businessGridTitle}>Preview</Text>
                <Text style={styles.businessGridMeta}>See public page</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderSettingsToggle = (label, value, onValueChange, helper) => (
    <View style={styles.settingsToggleRow}>
      <View style={styles.settingsToggleCopy}>
        <Text style={styles.settingsToggleLabel}>{label}</Text>
        {helper ? <Text style={styles.settingsToggleHelper}>{helper}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#3a4650', true: '#2f8f7b' }}
        thumbColor={value ? '#dff7f1' : '#d0d7dc'}
      />
    </View>
  );

  const renderPrivacyChoice = (label, key) => (
    <View style={styles.settingsChoiceBlock}>
      <Text style={styles.settingsToggleLabel}>{label}</Text>
      <View style={styles.settingsChoiceRow}>
        {['everyone', 'contacts', 'nobody'].map((option) => (
          <Pressable
            key={`${key}-${option}`}
            style={[
              styles.settingsChoiceChip,
              appSettings[key] === option ? styles.settingsChoiceChipActive : null,
            ]}
            onPress={() => updateAppSetting(key, option, { syncProfile: true })}
          >
            <Text
              style={[
                styles.settingsChoiceChipText,
                appSettings[key] === option ? styles.settingsChoiceChipTextActive : null,
              ]}
            >
              {option === 'everyone' ? 'Everyone' : option === 'contacts' ? 'My contacts' : 'Nobody'}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const renderSettingsPanelBody = () => {
    if (settingsPanel === 'favorites') {
      return (
        <ScrollView style={styles.settingsPanelScroll}>
          <Text style={styles.cardBody}>Favorite chats stay pinned at the top of Chats, like WhatsApp.</Text>
          {chatItems.length ? (
            chatItems.map((chat) => {
              const isFavorite = favoriteChatIds.includes(chat.id);
              return (
                <Pressable key={chat.id} style={styles.settingsListRow} onPress={() => toggleFavoriteChat(chat.id)}>
                  <View style={styles.settingsListCopy}>
                    <Text style={styles.settingsListTitle}>{chat.name}</Text>
                    <Text style={styles.settingsListSubtitle}>{chat.preview || 'No messages yet'}</Text>
                  </View>
                  <Text style={styles.settingsListChevron}>{isFavorite ? '★' : '☆'}</Text>
                </Pressable>
              );
            })
          ) : (
            <Text style={styles.cardBody}>No chats yet. Start a conversation first.</Text>
          )}
        </ScrollView>
      );
    }

    if (settingsPanel === 'business') {
      return (
        <View style={styles.settingsPanelBody}>
          <Text style={styles.cardBody}>Jump into business tools without leaving Settings.</Text>
          {[
            { label: 'Open Business mode', action: () => { setSettingsPanel(''); setActiveView('Business'); } },
            { label: 'My catalog', action: () => { setSettingsPanel(''); setActiveView('Business'); setBusinessPanel('catalog'); } },
            { label: 'Broadcast list', action: () => { setSettingsPanel(''); setActiveView('Business'); setBusinessPanel('broadcast'); } },
            { label: 'Customers', action: () => { setSettingsPanel(''); setActiveView('Business'); setBusinessPanel('customers'); } },
          ].map((item) => (
            <Pressable key={item.label} style={styles.settingsListRow} onPress={item.action}>
              <Text style={styles.settingsListTitle}>{item.label}</Text>
              <Text style={styles.settingsListChevron}>›</Text>
            </Pressable>
          ))}
        </View>
      );
    }

    if (settingsPanel === 'history') {
      return (
        <View style={styles.settingsPanelBody}>
          <Text style={styles.cardBody}>
            {Object.values(messagesByChat).reduce((count, list) => count + (list?.length ?? 0), 0)} messages stored on this device.
          </Text>
          <Pressable
            style={styles.settingsListRow}
            onPress={() => {
              showToast(`Export ready: ${chatItems.length} chats on this device.`, 'success', 2800);
            }}
          >
            <View style={styles.settingsListCopy}>
              <Text style={styles.settingsListTitle}>Export chat</Text>
              <Text style={styles.settingsListSubtitle}>Prepare a local summary of your conversations</Text>
            </View>
            <Text style={styles.settingsListChevron}>›</Text>
          </Pressable>
          <Pressable style={styles.settingsListRow} onPress={clearChatHistory}>
            <View style={styles.settingsListCopy}>
              <Text style={[styles.settingsListTitle, styles.settingsDangerText]}>Clear all chats</Text>
              <Text style={styles.settingsListSubtitle}>Deletes local history on this phone</Text>
            </View>
            <Text style={styles.settingsListChevron}>›</Text>
          </Pressable>
        </View>
      );
    }

    if (settingsPanel === 'account') {
      return (
        <ScrollView style={styles.settingsPanelScroll}>
          <Text style={styles.settingsSectionCaption}>Profile</Text>
          <TextInput
            value={profile.name}
            onChangeText={(value) => setProfile((current) => ({ ...current, name: value }))}
            placeholder="Name"
            placeholderTextColor="#7d8b92"
            style={styles.input}
          />
          <TextInput
            value={profile.about}
            onChangeText={(value) => setProfile((current) => ({ ...current, about: value }))}
            placeholder="About"
            placeholderTextColor="#7d8b92"
            style={styles.input}
          />
          <TextInput
            value={profile.phone}
            editable={false}
            placeholder="Phone number"
            placeholderTextColor="#7d8b92"
            style={[styles.input, styles.inputReadonly]}
          />
          <Text style={styles.settingsSectionCaption}>Security</Text>
          {renderSettingsToggle(
            'Use a PIN',
            !appSettings.pinDisabled,
            (value) => {
              updateAppSetting('pinDisabled', !value);
              updateAppSetting('appLockEnabled', value, { syncProfile: true });
              if (!value) {
                pinHoldingRef.current = false;
                setAppUnlocked(true);
                setAppLockPin('');
                AsyncStorage.removeItem(APP_LOCK_PIN_KEY).catch(() => undefined);
                showToast('PIN is off. This phone opens ZynkUP without asking.', 'success', 2600);
              } else {
                showToast('PIN is on. Set a 4–6 digit PIN below, then save.', 'info', 2600);
              }
            },
            'Turn this off if you do not want a PIN when you open ZynkUP. Your account stays on this phone.',
          )}
          <TextInput
            value={accountPinDraft}
            onChangeText={setAccountPinDraft}
            placeholder="Set 4–6 digit PIN"
            placeholderTextColor="#7d8b92"
            keyboardType="number-pad"
            maxLength={6}
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            style={styles.sendButtonWide}
            onPress={() => {
              if (!appSettings.pinDisabled && !/^\d{4,6}$/.test(accountPinDraft.trim()) && !appLockPin) {
                showToast('Enter a 4–6 digit PIN, or turn Use a PIN off.', 'error');
                return;
              }
              void saveProfileToServer(
                {},
                {},
                { pin: /^\d{4,6}$/.test(accountPinDraft.trim()) ? accountPinDraft.trim() : undefined },
              );
              setAccountPinDraft('');
            }}
          >
            <Text style={styles.sendButtonText}>Save account</Text>
          </Pressable>
          <Pressable
            style={styles.settingsListRow}
            onPress={() => {
              Alert.alert(
                'Delete account?',
                'Account deletion will be available once server purge is enabled. Contact support for now.',
                [{ text: 'OK' }],
              );
            }}
          >
            <Text style={[styles.settingsListTitle, styles.settingsDangerText]}>Delete my account</Text>
            <Text style={styles.settingsListChevron}>›</Text>
          </Pressable>
        </ScrollView>
      );
    }

    if (settingsPanel === 'privacy') {
      const blockedIds = profile.blockedUserIds || [];
      return (
        <ScrollView style={styles.settingsPanelScroll}>
          <Text style={styles.settingsSectionCaption}>Who can see</Text>
          {renderPrivacyChoice('Last seen & online', 'lastSeenPrivacy')}
          {renderPrivacyChoice('Profile photo', 'profilePhotoPrivacy')}
          {renderPrivacyChoice('About', 'aboutPrivacy')}
          {renderPrivacyChoice('Typing indicator', 'typingPrivacy')}
          <View style={styles.settingsChoiceBlock}>
            <Text style={styles.settingsToggleLabel}>Status</Text>
            <View style={styles.settingsChoiceRow}>
              {['contacts', 'close-friends', 'nobody'].map((option) => (
                <Pressable
                  key={`status-${option}`}
                  style={[
                    styles.settingsChoiceChip,
                    appSettings.statusPrivacy === option ? styles.settingsChoiceChipActive : null,
                  ]}
                  onPress={() => updateAppSetting('statusPrivacy', option, { syncProfile: true })}
                >
                  <Text
                    style={[
                      styles.settingsChoiceChipText,
                      appSettings.statusPrivacy === option ? styles.settingsChoiceChipTextActive : null,
                    ]}
                  >
                    {option === 'contacts' ? 'My contacts' : option === 'close-friends' ? 'Close friends' : 'Nobody'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Text style={styles.settingsSectionCaption}>Who can reach you</Text>
          {renderPrivacyChoice('Calls', 'callPrivacy')}
          {renderPrivacyChoice('Group invites', 'groupInvitePrivacy')}
          {renderSettingsToggle(
            'Read receipts',
            appSettings.readReceiptsEnabled,
            (value) => updateAppSetting('readReceiptsEnabled', value, { syncProfile: true }),
            'If off, you will not send or see blue ticks. Delivered ticks still work.',
          )}
          <Text style={styles.settingsSectionCaption}>Marketing preferences</Text>
          <Text style={styles.cardBody}>
            Businesses you bought from keep a customer record. Opting in is required before they can broadcast to you.
          </Text>
          <Pressable style={styles.catalogChip} onPress={() => void loadCustomerPreferences()}>
            <Text style={styles.catalogChipText}>Refresh preferences</Text>
          </Pressable>
          {customerPrefs.length ? null : (
            <Text style={styles.cardBody}>No business customer records linked to you yet.</Text>
          )}
          {customerPrefs.map((pref) => (
            <View key={pref.customerId} style={styles.sheetOption}>
              <Text style={styles.sheetOptionTitle}>
                Seller {pref.sellerUserId}
              </Text>
              <Text style={styles.sheetOptionBody}>
                Status: {pref.marketingConsent}
              </Text>
              <View style={styles.stockControls}>
                <Pressable
                  style={styles.catalogChip}
                  onPress={() => void updateMyMarketingPreference(pref.customerId, 'opted_in')}
                >
                  <Text style={styles.catalogChipText}>Opt in</Text>
                </Pressable>
                <Pressable
                  style={styles.catalogChip}
                  onPress={() => void updateMyMarketingPreference(pref.customerId, 'opted_out')}
                >
                  <Text style={styles.catalogChipText}>Opt out</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <Text style={styles.settingsSectionCaption}>Locked chats</Text>
          <Text style={styles.cardBody}>
            Locked chats need your PIN. Notifications hide the message text. This does not stop screenshots.
          </Text>
          {lockedChatIds.length ? lockedChatIds.map((chatId) => {
            const chat = chatItems.find((item) => item.id === chatId);
            return (
              <Pressable key={chatId} style={styles.settingsListRow} onPress={() => toggleLockChat(chatId)}>
                <View style={styles.settingsListCopy}>
                  <Text style={styles.settingsListTitle}>{chat?.name || 'Locked chat'}</Text>
                  <Text style={styles.settingsListSubtitle}>Tap to unlock</Text>
                </View>
                <Text style={styles.settingsListChevron}>🔒</Text>
              </Pressable>
            );
          }) : (
            <Text style={styles.cardBody}>No locked chats yet. Long-press a chat to lock it.</Text>
          )}
          <Text style={styles.settingsSectionCaption}>Blocked</Text>
          {blockedIds.length ? blockedIds.map((userId) => (
            <Pressable key={userId} style={styles.settingsListRow} onPress={() => void unblockUser(userId)}>
              <View style={styles.settingsListCopy}>
                <Text style={styles.settingsListTitle}>{displayNameFor(userId, usersById[userId]?.name || 'Blocked user')}</Text>
                <Text style={styles.settingsListSubtitle}>Tap to unblock</Text>
              </View>
              <Text style={styles.settingsListChevron}>›</Text>
            </Pressable>
          )) : (
            <Text style={styles.cardBody}>Nobody is blocked. Open a chat profile to block someone.</Text>
          )}
        </ScrollView>
      );
    }

    if (settingsPanel === 'chats') {
      return (
        <View style={styles.settingsPanelBody}>
          {renderSettingsToggle(
            'Enter is send',
            appSettings.enterIsSend,
            (value) => updateAppSetting('enterIsSend', value),
            'Enter key sends your message instead of a new line',
          )}
          {renderSettingsToggle(
            'Media auto-download',
            appSettings.mediaAutoDownload,
            (value) => updateAppSetting('mediaAutoDownload', value),
            'Automatically fetch photos and videos in chats',
          )}
          {renderSettingsToggle(
            'Save to camera roll',
            appSettings.saveToCameraRoll,
            (value) => updateAppSetting('saveToCameraRoll', value),
            'Keep received media on this device',
          )}
        </View>
      );
    }

    if (settingsPanel === 'notifications') {
      return (
        <View style={styles.settingsPanelBody}>
          {renderSettingsToggle(
            'Message notifications',
            appSettings.messageNotifications,
            (value) => updateAppSetting('messageNotifications', value),
            'Show alerts for new messages',
          )}
          {renderSettingsToggle(
            'Show preview',
            appSettings.showNotificationPreview,
            (value) => updateAppSetting('showNotificationPreview', value),
            'Include message text in notifications',
          )}
          {renderSettingsToggle(
            'Conversation tones',
            appSettings.conversationTones,
            (value) => updateAppSetting('conversationTones', value),
            'Play a sound when chats update',
          )}
        </View>
      );
    }

    if (settingsPanel === 'storage') {
      const messageCount = Object.values(messagesByChat).reduce((count, list) => count + (list?.length ?? 0), 0);
      return (
        <View style={styles.settingsPanelBody}>
          <Text style={styles.cardBody}>
            {messageCount} messages · {catalogItems.length} catalog items · {favoriteChatIds.length} favorites
          </Text>
          {renderSettingsToggle(
            'Low data mode',
            appSettings.lowDataMode,
            (value) => updateAppSetting('lowDataMode', value),
            'Reduce media auto-download on cellular',
          )}
          <Pressable style={styles.settingsListRow} onPress={clearLocalMediaCache}>
            <View style={styles.settingsListCopy}>
              <Text style={styles.settingsListTitle}>Clear cache</Text>
              <Text style={styles.settingsListSubtitle}>Remove temporary media selections</Text>
            </View>
            <Text style={styles.settingsListChevron}>›</Text>
          </Pressable>
        </View>
      );
    }

    if (settingsPanel === 'help') {
      return (
        <ScrollView style={styles.settingsPanelScroll}>
          <Text style={styles.cardBody}>Need help? Send feedback and we will improve ZynkUP with you.</Text>
          {[
            'How do I link a desktop device?',
            'How do payments work?',
            'How do I create a catalog?',
          ].map((faq) => (
            <Pressable
              key={faq}
              style={styles.settingsListRow}
              onPress={() => showToast(faq, 'info', 2800)}
            >
              <Text style={styles.settingsListTitle}>{faq}</Text>
              <Text style={styles.settingsListChevron}>›</Text>
            </Pressable>
          ))}
          <TextInput
            value={feedbackDraft}
            onChangeText={setFeedbackDraft}
            placeholder="Tell us what to improve..."
            placeholderTextColor="#7d8b92"
            multiline
            style={styles.textArea}
          />
          <Pressable
            style={styles.sendButtonWide}
            onPress={() => {
              if (!feedbackDraft.trim()) {
                showToast('Write feedback first.', 'error');
                return;
              }
              setFeedbackDraft('');
              showToast('Thanks — feedback sent to the ZynkUP team.', 'success', 3200);
              setSettingsPanel('');
            }}
          >
            <Text style={styles.sendButtonText}>Send feedback</Text>
          </Pressable>
        </ScrollView>
      );
    }

    return null;
  };

  const renderSettings = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      <Text style={styles.secondaryTitle}>Profile</Text>
      <Pressable style={styles.profileHero} onPress={() => setSettingsPanel('account')}>
        {profile.photoUri ? (
          <Image source={{ uri: profile.photoUri }} style={styles.profileImage} />
        ) : (
          <View style={[styles.profileImage, styles.profileImageFallback]}>
            <Text style={styles.profileImageFallbackText}>
              {(profile.name || 'ZU').slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <Pressable onPress={() => void pickProfilePhoto()}>
          <Text style={styles.editPhotoText}>Edit photo</Text>
        </Pressable>
        {profile.profileVideoUri ? (
          <Video
            source={{ uri: profile.profileVideoUri }}
            style={styles.profileVideoPreview}
            resizeMode="cover"
            repeat
            muted
            paused={false}
          />
        ) : null}
        <Pressable onPress={() => void pickProfileVideo()}>
          <Text style={styles.editPhotoText}>{profile.profileVideoUri ? 'Replace profile video' : 'Add profile video'}</Text>
        </Pressable>
        {profile.profileVideoUri ? (
          <Pressable onPress={() => void removeProfileVideo()}>
            <Text style={styles.editPhotoText}>Remove profile video</Text>
          </Pressable>
        ) : null}
        <Text style={styles.settingsProfileName}>{profile.name || 'Your name'}</Text>
        <Text style={styles.settingsProfileMeta}>{profile.about || 'Hey there! I am using ZynkUP.'}</Text>
        <Text style={styles.settingsProfileMeta}>{profile.phone || 'Add your phone number'}</Text>
        <Text style={styles.settingsProfileMeta}>{accountCurrency}{accountCountry?.name ? ` · ${accountCountry.name}` : ''}</Text>
      </Pressable>

      <Pressable style={styles.sendButtonWide} onPress={() => void syncPhoneContacts(currentUserId)}>
        <Text style={styles.sendButtonText}>Sync contacts</Text>
      </Pressable>

      <View style={styles.card}>
        {SETTINGS_MENU.map((section) => (
          <Pressable
            key={section.id}
            style={styles.settingsMenuRow}
            onPress={() => setSettingsPanel(section.id)}
          >
            <View style={styles.settingsMenuIconWrap}>
              <Text style={styles.settingsMenuIcon}>{section.icon}</Text>
            </View>
            <View style={styles.settingsMenuCopy}>
              <Text style={styles.settingsMenuTitle}>{section.title}</Text>
              <Text style={styles.settingsMenuSubtitle}>{section.subtitle}</Text>
            </View>
            <Text style={styles.settingsListChevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Linked devices</Text>
        <Text style={styles.cardMeta}>
          {linkedDeviceSlots.linkedCount} of {linkedDeviceSlots.limit} web devices linked. {linkedDeviceSlots.remaining} left.
        </Text>
        <Pressable
          style={styles.sendButtonWide}
          onPress={async () => {
            const granted = await ensureCameraPermission();
            if (!granted) {
              setDeviceLinkMessage('Camera permission is needed to scan a desktop QR code.');
              return;
            }
            setDeviceLinkMessage('');
            setDeviceScannerVisible(true);
          }}
          disabled={deviceLinking}
        >
          <Text style={styles.sendButtonText}>{deviceLinking ? 'Linking...' : 'Link devices'}</Text>
        </Pressable>
        {deviceLinkMessage ? <Text style={styles.cardMeta}>{deviceLinkMessage}</Text> : null}
        {linkedDevices.length ? linkedDevices.map((device) => (
          <View key={device.deviceId} style={styles.deviceRow}>
            <View style={styles.deviceRowCopy}>
              <Text style={styles.sheetOptionTitle}>{device.label}</Text>
              <Text style={styles.sheetOptionBody}>{device.platform} · last seen {formatClock(device.lastSeenAt)}</Text>
            </View>
            <Pressable style={styles.ghostButton} onPress={() => void unlinkDevice(device.deviceId)}>
              <Text style={styles.ghostButtonText}>Log out</Text>
            </Pressable>
          </View>
        )) : <Text style={styles.cardBody}>No extra linked devices yet.</Text>}
        <Pressable style={styles.ghostButton} onPress={() => void signOutKeepAccount()}>
          <Text style={styles.ghostButtonText}>Log out of this phone</Text>
        </Pressable>
      </View>

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(settingsPanel)}
        onRequestClose={() => setSettingsPanel('')}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>
                {SETTINGS_MENU.find((item) => item.id === settingsPanel)?.title || 'Settings'}
              </Text>
              <Pressable onPress={() => setSettingsPanel('')}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            {renderSettingsPanelBody()}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );

  const renderEntryCelebration = () => {
    const highlights = [
      { icon: '💬', title: 'Chat with anyone', body: 'your contacts are already here.' },
      { icon: '💸', title: 'Send money instantly', body: 'MoMo connected. Zero stress.' },
      { icon: '🛒', title: 'Shop from status', body: 'tap any product and buy right there.' },
      { icon: '🤖', title: 'AI is always with you', body: 'replies, translations, scam alerts.' },
    ];

    return (
      <View style={styles.celebrationScreen}>
        <View style={styles.celebrationConfettiOne} />
        <View style={styles.celebrationConfettiTwo} />
        <View style={styles.celebrationConfettiThree} />
        <View style={styles.celebrationCard}>
          <View style={styles.celebrationCheck}>
            <Text style={styles.celebrationCheckText}>✓</Text>
          </View>
          <Text style={styles.celebrationTitle}>You're in,</Text>
          <Text style={styles.celebrationAccent}>{celebrationDisplayName}! 🎉</Text>
          <Text style={styles.celebrationSubtitle}>ZynkUP is ready. Here's everything waiting for you.</Text>
          <View style={styles.celebrationFeatureList}>
            {highlights.map((item) => (
              <View key={item.title} style={styles.celebrationFeatureCard}>
                <Text style={styles.celebrationFeatureIcon}>{item.icon}</Text>
                <Text style={styles.celebrationFeatureText}>
                  <Text style={styles.celebrationFeatureTitle}>{item.title}</Text>
                  {` — ${item.body}`}
                </Text>
              </View>
            ))}
          </View>
          <Pressable
            style={styles.celebrationButton}
            onPress={() => {
              setEntryCelebrationVisible(false);
            }}
          >
            <Text style={styles.celebrationButtonText}>Open ZynkUP →</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const renderToast = () => {
    if (!toastState.visible || !toastState.message) {
      return null;
    }

    return (
      <View pointerEvents="box-none" style={styles.toastOverlay}>
        <Pressable
          style={[
            styles.toastCard,
            toastState.type === 'success'
              ? styles.toastCardSuccess
              : toastState.type === 'error'
                ? styles.toastCardError
                : styles.toastCardInfo,
          ]}
          onPress={dismissToast}
        >
          <Text style={styles.toastText}>{toastState.message}</Text>
        </Pressable>
      </View>
    );
  };

  const renderBrandButton = (label, onPress, disabled = false) => (
    <Pressable
      style={[styles.brandButton, disabled ? styles.brandButtonDisabled : null]}
      disabled={disabled}
      onPress={onPress}
    >
      <ImageBackground source={brandGradient} style={styles.brandButtonFill} imageStyle={styles.brandButtonImage}>
        <Text style={styles.brandButtonText}>{label}</Text>
      </ImageBackground>
    </Pressable>
  );

  const renderAuthGate = (dismissible = false) => {
    const authContainerStyle = authMode === 'welcome' ? styles.authWelcomeScreen : styles.authFlowScreen;
    const authContentStyle = authMode === 'welcome' ? styles.authWelcomeCard : styles.authFlowCard;
    const authFooter = (() => {
      if (authMode === 'welcome') {
        return (
          <View style={styles.authWelcomeFooter}>
            {renderBrandButton(
              authPendingAction === 'lookup' || authPendingAction === 'pin-login' ? 'Please wait...' : 'Log In  →',
              () => void signInFromWelcome(),
              isAuthBusy,
            )}
            <Text style={styles.authSwitchRow}>
              New to ZynkUP?{' '}
              <Text style={styles.authSwitchLink} onPress={() => setAuthMode('phone')}>Create Account</Text>
            </Text>
          </View>
        );
      }

      if (authMode === 'phone') {
        return (
          <View style={styles.authStepFooter}>
            {renderBrandButton(
              authPendingAction === 'lookup' || authPendingAction === 'send-code' ? 'Please wait...' : 'Continue  →',
              () => void continueWithPhone(),
              isAuthBusy,
            )}
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'pin') {
        return (
          <View style={styles.authStepFooter}>
            {renderBrandButton(
              authPendingAction === 'pin-login' ? 'Signing in...' : 'Log In  →',
              () => void loginWithPin(),
              isAuthBusy,
            )}
            <Pressable disabled={isAuthBusy} onPress={() => void startForgotPinAuth()} style={{ marginTop: 12 }}>
              <Text style={styles.authResendAccent}>Forgot PIN? Verify with OTP</Text>
            </Pressable>
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'otp') {
        return (
          <View style={styles.authStepFooter}>
            {renderBrandButton(
              authPendingAction === 'verify-otp' ? 'Verifying...' : 'Verify code  →',
              () => void verifyPhoneOtp(),
              isAuthBusy,
            )}
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'reset-pin') {
        return (
          <View style={styles.authStepFooter}>
            {renderBrandButton(
              authPendingAction === 'reset-pin' ? 'Saving...' : 'Save PIN & continue',
              () => void resetPinAfterOtp(),
              isAuthBusy,
            )}
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'profile') {
        return (
          <View style={styles.authStepFooter}>
            {renderBrandButton('Continue  →', continueFromProfileStep, false)}
          </View>
        );
      }

      return (
        <View style={styles.authStepFooter}>
          {renderBrandButton(
            authPendingAction === 'register' ? 'Please wait...' : "Let's go  →",
            () => void completePhoneRegistration(),
            !authForm.accountType || isAuthBusy,
          )}
          <Text style={styles.authInlineStatusText}>
            {isAuthBusy
              ? authPendingLabel
              : authForm.accountType
                ? 'Selection saved. Tap the button to continue.'
                : 'Select Personal or Business, then tap the button.'}
          </Text>
        </View>
      );
    })();

    const content = (
      <View style={authContainerStyle}>
        {authMode === 'welcome' ? (
          <View style={authContentStyle}>
            <View style={styles.authLoginBrand}>
              <Image source={brandMark} style={styles.authLoginMark} resizeMode="contain" />
              <Image source={brandWordmark} style={styles.authLoginWordmark} resizeMode="contain" />
            </View>
            <Text style={styles.authLoginTitle}>Welcome Back</Text>
            <Text style={styles.authLoginSubtitle}>Log in to your account</Text>
            <View style={styles.authLoginField}>
              <Text style={styles.authLoginFieldIcon}>☎</Text>
              <Pressable style={styles.authLoginCode} onPress={() => setCountryPickerVisible(true)}>
                <Text style={styles.authLoginCodeText}>{selectedAuthCountry?.dialCode || '+233'}</Text>
              </Pressable>
              <TextInput
                value={authForm.phone}
                onChangeText={(value) => setAuthForm((current) => ({ ...current, phone: value }))}
                placeholder="Phone number"
                placeholderTextColor="#8d93a8"
                keyboardType="phone-pad"
                style={styles.authLoginInput}
              />
            </View>
            <View style={styles.authLoginField}>
              <Text style={styles.authLoginFieldIcon}>🔒</Text>
              <TextInput
                value={authForm.pin}
                onChangeText={(value) => setAuthForm((current) => ({ ...current, pin: value.replace(/\D/g, '').slice(0, 6) }))}
                placeholder="PIN"
                placeholderTextColor="#8d93a8"
                keyboardType="number-pad"
                secureTextEntry={!authSecretVisible}
                maxLength={6}
                style={styles.authLoginInput}
              />
              <Pressable onPress={() => setAuthSecretVisible((current) => !current)} hitSlop={8}>
                <Text style={styles.authLoginEye}>{authSecretVisible ? '🙈' : '👁'}</Text>
              </Pressable>
            </View>
            <Pressable
              disabled={isAuthBusy}
              onPress={() => void startForgotPinAuth()}
              style={styles.authForgotWrap}
            >
              <Text style={styles.authForgotText}>Forgot PIN?</Text>
            </Pressable>
            {authFooter}
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.authFlowScroll}
              contentContainerStyle={[styles.authFlowScrollContent, { paddingBottom: authBottomInset + 110 }]}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={authContentStyle}>
                <>
                  <View style={styles.authStepBrand}>
                    <Image source={brandMark} style={styles.authStepMark} resizeMode="contain" />
                    <Image source={brandWordmark} style={styles.authStepWordmark} resizeMode="contain" />
                  </View>
                  <View style={styles.authStepHeader}>
                    <Pressable style={styles.authBackButton} onPress={goBackAuthStep}>
                      <Text style={styles.authBackButtonText}>‹</Text>
                    </Pressable>
                    <View style={styles.authProgressTrack}>
                      <View style={[styles.authProgressFill, { width: authProgressWidth }]} />
                    </View>
                    <Text style={styles.authProgressLabel}>{authStepNumber} of 4</Text>
                  </View>
    
                  {authMode === 'phone' ? (
                    <>
                      <Text style={styles.authStepEmoji}>📱</Text>
                      <Text style={styles.authStepTitle}>What's your</Text>
                      <Text style={styles.authStepAccent}>phone number?</Text>
                      <Text style={styles.authStepBody}>Returning users sign in with their PIN.</Text>
                      <Text style={styles.authStepBody}>New numbers verify once with OTP.</Text>
                      <View style={styles.authPhoneRow}>
                        <Pressable style={styles.authCountryChip} onPress={() => setCountryPickerVisible(true)}>
                          <Text style={styles.authCountryChipText}>
                            {selectedAuthCountry?.dialCode || '+233'}
                          </Text>
                          <Text style={styles.authCountryChevron}>▾</Text>
                        </Pressable>
                        <TextInput
                          value={authForm.phone}
                          onChangeText={(value) => setAuthForm((current) => ({ ...current, phone: value }))}
                          placeholder="024 398 4046"
                          placeholderTextColor="#8a8f9d"
                          keyboardType="phone-pad"
                          style={styles.authPhoneInput}
                        />
                      </View>
                      <Text style={styles.authStepHint}>Your number is encrypted and never shared with anyone.</Text>
                    </>
                  ) : null}

                  {authMode === 'pin' || authMode === 'reset-pin' ? (
                    <>
                      <Text style={styles.authStepEmoji}>🔑</Text>
                      <Text style={styles.authStepTitle}>{authMode === 'reset-pin' ? 'Choose a' : 'Enter your'}</Text>
                      <Text style={styles.authStepAccent}>{authMode === 'reset-pin' ? 'new PIN' : 'PIN'}</Text>
                      <Text style={styles.authStepBody}>
                        {authMode === 'reset-pin'
                          ? 'Use 4–6 digits. You will use this PIN next time you sign in.'
                          : `For ${authForm.verifiedPhone || normalizeAuthPhone(authForm.countryCode || '+233', authForm.phone || '')}`}
                      </Text>
                      {lockNotice ? (
                        <Text style={styles.authStepBody}>{lockNotice.title}: {lockNotice.body}. Unlock to open it.</Text>
                      ) : null}
                      <View style={styles.authOtpRow}>
                        {authPinDigits.map((digit, index) => (
                          <View
                            key={`pin-${index}`}
                            style={[styles.authOtpBox, digit ? styles.authOtpBoxFilled : null]}
                          >
                            <Text style={[styles.authOtpBoxText, digit ? styles.authOtpBoxTextFilled : null]}>
                              {digit ? '•' : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                      <View style={styles.authKeypadGrid}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((key) => (
                          <Pressable
                            key={`pin-key-${key === '' ? 'blank' : key}`}
                            style={[styles.authKeypadKey, key === '' ? styles.authKeypadKeyBlank : null]}
                            onPress={() => {
                              if (key === '') {
                                return;
                              }
                              if (key === '⌫') {
                                removePinDigit();
                                return;
                              }
                              appendPinDigit(String(key));
                            }}
                          >
                            <Text style={styles.authKeypadKeyText}>{key}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}
    
                  {authMode === 'otp' ? (
                    <>
                      <Text style={styles.authStepEmoji}>🔐</Text>
                      <Text style={styles.authStepTitle}>Enter the</Text>
                      <Text style={styles.authStepAccent}>6-digit code</Text>
                      <Text style={styles.authStepBody}>Sent to {authForm.verifiedPhone || normalizeAuthPhone(authForm.countryCode || '+233', authForm.phone || '')}</Text>
                      <Text style={styles.authStepBody}>
                        {forgotPinFlowRef.current ? 'Verify to reset your PIN.' : 'Check your SMS.'}
                      </Text>
                      <View style={styles.authOtpRow}>
                        {authOtpDigits.map((digit, index) => (
                          <View
                            key={`otp-${index}`}
                            style={[styles.authOtpBox, digit ? styles.authOtpBoxFilled : null]}
                          >
                            <Text style={[styles.authOtpBoxText, digit ? styles.authOtpBoxTextFilled : null]}>{digit}</Text>
                          </View>
                        ))}
                      </View>
                      <Pressable onPress={() => void startPhoneAuth()}>
                        <Text style={styles.authResendText}>
                          Didn't get it? <Text style={styles.authResendAccent}>Resend code</Text>
                        </Text>
                      </Pressable>
                      <View style={styles.authKeypadGrid}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map((key) => (
                          <Pressable
                            key={`key-${key === '' ? 'blank' : key}`}
                            style={[styles.authKeypadKey, key === '' ? styles.authKeypadKeyBlank : null]}
                            onPress={() => {
                              if (key === '') {
                                return;
                              }
                              if (key === '⌫') {
                                removeOtpDigit();
                                return;
                              }
                              appendOtpDigit(String(key));
                            }}
                          >
                            <Text style={styles.authKeypadKeyText}>{key}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </>
                  ) : null}
    
                  {authMode === 'profile' ? (
                    <>
                      <Pressable style={styles.authProfilePhotoWrap} onPress={() => void pickAuthProfilePhoto()}>
                        {authForm.photoUri ? (
                          <Image source={{ uri: authForm.photoUri }} style={styles.authProfilePhotoImage} />
                        ) : (
                          <View style={styles.authProfilePhotoPlaceholder}>
                            <Text style={styles.authProfilePhotoEmoji}>😊</Text>
                            <View style={styles.authProfilePhotoAdd}>
                              <Text style={styles.authProfilePhotoAddText}>+</Text>
                            </View>
                          </View>
                        )}
                      </Pressable>
                      <Text style={styles.authPhotoHelper}>Add a photo or video</Text>
                      <Text style={styles.authFieldLabel}>YOUR NAME</Text>
                      <TextInput
                        value={authForm.name}
                        onChangeText={(value) =>
                          setAuthForm((current) => ({
                            ...current,
                            name: value,
                            username: current.username ? current.username : deriveAuthUsername(value),
                          }))
                        }
                        placeholder="Kweku Mensah"
                        placeholderTextColor="#8a8f9d"
                        style={styles.authProfileInput}
                      />
                      <Text style={styles.authFieldLabel}>YOUR ZYNK ID</Text>
                      <View style={styles.authUsernameRow}>
                        <View style={styles.authUsernamePrefix}>
                          <Text style={styles.authUsernamePrefixText}>@</Text>
                        </View>
                        <TextInput
                          value={authForm.username}
                          onChangeText={(value) =>
                            setAuthForm((current) => ({
                              ...current,
                              username: value.replace(/[^a-z0-9.]/gi, '').toLowerCase(),
                            }))
                          }
                          placeholder="kweku.mensah"
                          placeholderTextColor="#8a8f9d"
                          autoCapitalize="none"
                          style={styles.authUsernameInput}
                        />
                      </View>
                      <Text style={styles.authUsernameHint}>@{authForm.username || 'your.zynk.id'} is available</Text>
                      <Text style={styles.authFieldLabel}>LANGUAGE</Text>
                      <TextInput
                        value={authForm.language}
                        onChangeText={(value) => setAuthForm((current) => ({ ...current, language: value }))}
                        placeholderTextColor="#8a8f9d"
                        style={styles.authProfileInput}
                      />
                      <Text style={styles.authFieldLabel}>CREATE PIN</Text>
                      <TextInput
                        value={authForm.pin}
                        onChangeText={(value) => setAuthForm((current) => ({ ...current, pin: value.replace(/[^\d]/g, '').slice(0, 6) }))}
                        placeholder="4–6 digit PIN"
                        placeholderTextColor="#8a8f9d"
                        keyboardType="number-pad"
                        secureTextEntry
                        style={styles.authProfileInput}
                      />
                    </>
                  ) : null}
    
                  {authMode === 'account' ? (
                    <>
                      <Text style={styles.authStepTitle}>How will you use</Text>
                      <Text style={styles.authStepAccent}>ZynkUP?</Text>
                      <Text style={[styles.authStepBody, styles.authAccountCopy]}>
                        Pick one to start - you can always switch later.
                      </Text>
                      {[
                        {
                          key: 'personal',
                          title: 'Personal',
                          body: "Chat with friends and family, send and receive money, see what's happening near you.",
                        },
                        {
                          key: 'business',
                          title: 'Business',
                          body: 'Sell products, accept payments, manage customers, track your sales - all in one place.',
                        },
                      ].map((option) => {
                        const selected = authForm.accountType === option.key;
                        return (
                          <Pressable
                            key={option.key}
                            style={[styles.authAccountCard, selected ? styles.authAccountCardSelected : null]}
                            onPress={() => {
                              submitSelectedAccountType(option.key);
                            }}
                          >
                            <View style={styles.authAccountCardTop}>
                              <Text style={styles.authAccountEmoji}>{option.key === 'business' ? '🛒' : '😊'}</Text>
                              {selected ? (
                                <View style={styles.authAccountCheck}>
                                  <Text style={styles.authAccountCheckText}>✓</Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.authAccountTitle}>{option.title}</Text>
                            <Text style={styles.authAccountBody}>{option.body}</Text>
                          </Pressable>
                        );
                      })}
                      <Text style={styles.authAccountFootnote}>ZynkUP is free to use. Business features are always available.</Text>
                    </>
                  ) : null}
                </>
              </View>
            </ScrollView>
            <View style={[styles.authFooterDock, { paddingBottom: authBottomInset }]}>
              {authFooter}
            </View>
          </>
        )}
      </View>
    );

    if (!dismissible) {
      return content;
    }

    return (
      <Pressable
        style={styles.authDismissOverlay}
        onPress={() => {
          if (!authRequired) {
            setAuthVisible(false);
          }
        }}
      >
        {content}
      </Pressable>
    );
  };

  if (!bootstrapReady || !startContinued) {
    const onCityScreen = startStep === 'city';
    return (
      <View style={styles.bootstrapScreen}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {onCityScreen ? (
          <>
            <Image source={brandSplashCity} style={styles.bootstrapArt} resizeMode="cover" />
            <SafeAreaView style={styles.splashContinueWrap} edges={['bottom', 'left', 'right']} pointerEvents="box-none">
              <View style={styles.splashContinue}>
                {renderBrandButton(
                  bootstrapReady ? 'Continue' : 'Please wait...',
                  () => setStartContinued(true),
                  !bootstrapReady,
                )}
              </View>
            </SafeAreaView>
          </>
        ) : (
          <SafeAreaView style={styles.splashStage} edges={['top', 'bottom', 'left', 'right']}>
            <Image source={brandSplashLogo} style={styles.splashLogo} resizeMode="contain" />
          </SafeAreaView>
        )}
      </View>
    );
  }

  if (!currentUserId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {renderAuthGate()}
        <Modal
          transparent
          animationType="slide"
          visible={countryPickerVisible}
          onRequestClose={() => setCountryPickerVisible(false)}
        >
          <Pressable style={styles.dialogOverlay} onPress={() => setCountryPickerVisible(false)}>
            <Pressable style={styles.sheetDialog} onPress={() => undefined}>
              <Text style={styles.dialogTitle}>Select country code</Text>
              <TextInput
                value={countrySearch}
                onChangeText={setCountrySearch}
                placeholder="Search country or code"
                placeholderTextColor="#7d8b92"
                style={styles.input}
              />
              <ScrollView style={styles.countryList}>
                {filteredCountryOptions.slice(0, 120).map((country) => (
                  <Pressable
                    key={`${country.code}-${country.dialCode}`}
                    style={styles.countryRow}
                    onPress={() => {
                      setAuthForm((current) => ({ ...current, countryCode: country.dialCode }));
                      setCountryPickerVisible(false);
                      setCountrySearch('');
                    }}
                  >
                    <Text style={styles.sheetOptionTitle}>{country.name}</Text>
                    <Text style={styles.sheetOptionBody}>{country.dialCode}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
        {renderToast()}
      </SafeAreaView>
    );
  }

  if (entryCelebrationVisible) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        {renderEntryCelebration()}
        {renderToast()}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={activeView === 'Chats' ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />

      {activeView === 'Chats' && chatScreen === 'detail' ? (
        renderChatDetail()
      ) : (
        <View style={styles.screen}>
          {activeView === 'Chats' ? renderChatList() : null}
          {activeView === 'Explore' ? renderExplore() : null}
          {activeView === 'Pay' ? renderPay() : null}
          {activeView === 'Business' ? renderBusiness() : null}
          {activeView === 'Profile' ? renderSettings() : null}

          <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 28) + 22 }]}>
            {tabs.map((tab) => (
              <Pressable
                key={tab}
                style={[styles.bottomNavItem, activeView === tab ? styles.bottomNavItemOn : null]}
                onPress={() => {
                  setActiveView(tab);
                  setChatScreen('list');
                }}
              >
                <View style={styles.bottomNavIconWrap}>
                  <Text style={[styles.bottomNavIcon, activeView === tab ? styles.bottomNavIconActive : null]}>
                    {tab === 'Chats' ? '◫' : tab === 'Explore' ? '◉' : tab === 'Pay' ? '▭' : tab === 'Business' ? '⌂' : '◎'}
                  </Text>
                  {tabBadges[tab] ? (
                    <View style={styles.bottomNavBadge}>
                      <Text style={styles.bottomNavBadgeText}>{tabBadges[tab]}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.bottomNavLabel, activeView === tab ? styles.bottomNavLabelActive : null]}>{tab}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {renderAttachmentSheet()}
      <Modal
        transparent
        animationType="fade"
        visible={identitySheetVisible}
        onRequestClose={() => setIdentitySheetVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setIdentitySheetVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Who are you using?</Text>
            <Text style={styles.cardBody}>Personal chats stay separate from each business.</Text>
            <Pressable style={styles.settingsListRow} onPress={() => void switchIdentity('')}>
              <Text style={styles.settingsListTitle}>Personal{activeBusinessId ? '' : ' · active'}</Text>
            </Pressable>
            {businesses.map((business) => (
              <Pressable key={business.id} style={styles.settingsListRow} onPress={() => void switchIdentity(business.id)}>
                <Text style={styles.settingsListTitle}>
                  {business.name}{business.id === activeBusinessId ? ' · active' : ''}
                </Text>
                <Text style={styles.businessHeroMeta}>{business.members?.find((member) => member.userId === currentUserId)?.role || 'business'}</Text>
              </Pressable>
            ))}
            <TextInput
              value={businessDraft.name}
              onChangeText={(value) => setBusinessDraft((current) => ({ ...current, name: value }))}
              placeholder="New business name"
              placeholderTextColor="#9aa3b2"
              style={styles.chatSearchInput}
            />
            <Pressable style={styles.authDarkButton} onPress={() => void createBusinessProfile()}>
              <Text style={styles.authDarkButtonText}>Create business</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {renderCallSheet()}
      {renderMediaViewer()}
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(messageActionTarget)}
        onRequestClose={() => setMessageActionTarget(null)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setMessageActionTarget(null)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Message</Text>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setReplyTarget(messageActionTarget);
                setMessageActionTarget(null);
              }}
            >
              <Text style={styles.sheetOptionTitle}>Reply</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                void copyMessageText(messageActionTarget?.text);
                setMessageActionTarget(null);
              }}
            >
              <Text style={styles.sheetOptionTitle}>Copy</Text>
            </Pressable>
            {messageActionTarget?.kind === 'text' && messageActionTarget?.text && !messageActionTarget?.deletedForEveryone ? (
              <Pressable
                style={styles.sheetOption}
                onPress={() => pickTranslateLanguage(messageActionTarget)}
              >
                <Text style={styles.sheetOptionTitle}>Translate</Text>
              </Pressable>
            ) : null}
            {(messageActionTarget?.kind === 'voice' || messageActionTarget?.kind === 'audio')
              && !(messageActionTarget?.transcriptStatus === 'ready' && messageActionTarget?.transcript) ? (
              <Pressable
                style={styles.sheetOption}
                onPress={() => {
                  const target = messageActionTarget;
                  setMessageActionTarget(null);
                  void requestVoiceTranscript(target);
                }}
              >
                <Text style={styles.sheetOptionTitle}>Transcribe</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.sheetOption}
              onPress={() => void forwardMessage(messageActionTarget)}
            >
              <Text style={styles.sheetOptionTitle}>Forward</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => void deleteMessage(messageActionTarget, 'me')}
            >
              <Text style={styles.sheetOptionTitle}>Delete for me</Text>
            </Pressable>
            {messageActionTarget?.mine ? (
              <Pressable
                style={styles.sheetOption}
                onPress={() => void deleteMessage(messageActionTarget, 'everyone')}
              >
                <Text style={[styles.sheetOptionTitle, styles.settingsDangerText]}>Delete for everyone</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.sheetBack} onPress={() => setMessageActionTarget(null)}>
              <Text style={styles.sheetBackText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="slide"
        visible={chatCameraVisible}
        onRequestClose={() => setChatCameraVisible(false)}
      >
        <View style={styles.chatCameraScreen}>
          {Camera ? (
            <Camera
              ref={chatCameraRef}
              style={styles.chatCameraPreview}
              cameraType={CameraKit?.CameraType?.Back ?? 'back'}
              flashMode="auto"
            />
          ) : (
            <View style={styles.chatCameraPreview}>
              <Text style={styles.cardBody}>Camera unavailable in this build.</Text>
            </View>
          )}
          <View style={[styles.chatCameraActions, { paddingBottom: modalBottomInset + 12 }]}>
            <Pressable style={styles.ghostButton} onPress={() => setChatCameraVisible(false)}>
              <Text style={styles.ghostButtonText}>Close</Text>
            </Pressable>
            <Pressable
              style={styles.sendButtonWide}
              onPress={async () => {
                try {
                  const capture = await chatCameraRef.current?.capture?.();
                  const uri = capture?.uri || capture?.path;
                  if (!uri) {
                    showToast('Could not capture photo.', 'error');
                    return;
                  }
                  setChatCameraVisible(false);
                  showToast('Uploading photo...', 'info', 0);
                  const uploaded = await uploadUris([uri.startsWith('file://') ? uri : `file://${uri}`], {
                    names: [`chat-cam-${Date.now()}.jpg`],
                    fallbackType: 'image/jpeg',
                  });
                  const mediaUrl = uploaded[0] || uri;
                  const clientRef = `mobile-cam-${Date.now()}`;
                  const message = {
                    id: `m${Date.now()}`,
                    clientRef,
                    mine: true,
                    kind: 'image',
                    text: 'Photo',
                    time: 'Now',
                    imageUri: mediaUrl,
                    receiptState: 'pending',
                    replyToMessageId: replyTarget?.id,
                    replyPreview: replyTarget?.text?.slice(0, 140),
                  };
                  appendMessage(message);
                  queueOutgoing({
                    chatId: selectedChatId,
                    senderId: currentUserId,
                    clientRef,
                    kind: 'image',
                    text: 'Photo',
                    mediaUrls: uploaded[0] ? [uploaded[0]] : [],
                    replyToMessageId: replyTarget?.id,
                    replyPreview: replyTarget?.text?.slice(0, 140),
                  }, uploaded[0] ? {} : {
                    localUri: uri,
                    uploadName: `camera-${Date.now()}.jpg`,
                    uploadType: 'image/jpeg',
                  });
                  setReplyTarget(null);
                  showToast('Photo sent', 'success');
                } catch {
                  showToast('Camera capture failed.', 'error');
                }
              }}
            >
              <Text style={styles.sendButtonText}>Capture</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={statusComposerVisible}
        onRequestClose={() => setStatusComposerVisible(false)}
      >
        <View style={[styles.statusComposerOverlay, statusComposerMode === 'text' ? styles.statusComposerOverlayFill : null]}>
          <View style={[styles.statusComposerSheet, statusComposerMode === 'text' ? styles.statusComposerSheetFill : null, { paddingBottom: modalBottomInset + keyboardInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Create status</Text>
              <Pressable onPress={() => setStatusComposerVisible(false)}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.statusModeRow}>
              {[
                { id: 'text', label: 'Text' },
                { id: 'photo', label: 'Photo' },
                { id: 'video', label: 'Video' },
              ].map((mode) => (
                <Pressable
                  key={mode.id}
                  style={[styles.statusModeChip, statusComposerMode === mode.id ? styles.statusModeChipActive : null]}
                  onPress={() => {
                    setStatusComposerMode(mode.id);
                    if (mode.id === 'text') {
                      setStatusAssetUris([]);
                    }
                  }}
                >
                  <Text style={[styles.statusModeChipText, statusComposerMode === mode.id ? styles.statusModeChipTextActive : null]}>
                    {mode.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {statusComposerMode === 'text' ? (
              <ScrollView
                style={[styles.statusCanvasScroll, { backgroundColor: statusBackgroundColor }]}
                contentContainerStyle={styles.statusCanvasContent}
                keyboardShouldPersistTaps="handled"
              >
                <TextInput
                  value={statusDraft}
                  onChangeText={(value) => setStatusDraft(value.slice(0, STATUS_TEXT_LIMIT))}
                  placeholder="Type a status"
                  placeholderTextColor="rgba(255,255,255,0.72)"
                  multiline
                  textAlign="center"
                  maxLength={STATUS_TEXT_LIMIT}
                  style={[
                    styles.statusCanvasInput,
                    {
                      fontSize: Math.min(statusFontSize, statusTextSize(statusDraft)),
                      fontFamily: statusFontFamily === 'System' ? undefined : statusFontFamily,
                    },
                  ]}
                />
              </ScrollView>
            ) : (
              <Pressable
                style={styles.statusMediaPicker}
                onPress={() => void pickMultipleImages('status', statusComposerMode)}
              >
                <Text style={styles.statusMediaPickerTitle}>
                  {statusAssetUris.length
                    ? `${statusAssetUris.length} ${statusComposerMode}${statusAssetUris.length > 1 ? 's' : ''} selected`
                    : `Tap to choose ${statusComposerMode}`}
                </Text>
                <Text style={styles.statusMediaPickerMeta}>Photo, video, or product update</Text>
                {statusAssetUris.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaPreviewRow}>
                    {statusAssetUris.map((uri) => (
                      statusComposerMode === 'video' ? (
                        <Video key={uri} source={{ uri }} style={styles.mediaPreviewThumb} paused resizeMode="cover" />
                      ) : (
                        <Image key={uri} source={{ uri }} style={styles.mediaPreviewThumb} />
                      )
                    ))}
                  </ScrollView>
                ) : null}
              </Pressable>
            )}
            {statusComposerMode === 'text' ? null : (
              <TextInput
                value={statusDraft}
                onChangeText={setStatusDraft}
                placeholder="Add a caption (optional)"
                placeholderTextColor="#7d8b92"
                multiline
                style={styles.textArea}
              />
            )}
            {statusComposerMode === 'text' ? (
              <>
                <Pressable style={styles.statusToolsToggle} onPress={() => setStatusToolsOpen((current) => !current)}>
                  <Text style={styles.statusToolsToggleText}>{statusToolsOpen ? 'Hide style' : 'Style ▾'}</Text>
                </Pressable>
                {statusToolsOpen ? (
                  <ScrollView style={styles.statusToolsPanel}>
                <Text style={styles.statusOptionLabel}>Background</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusOptionRow}>
                  {statusBackgroundOptions.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => setStatusBackgroundColor(color)}
                      style={[
                        styles.statusColorChip,
                        { backgroundColor: color },
                        statusBackgroundColor === color ? styles.statusColorChipActive : null,
                      ]}
                    />
                  ))}
                </ScrollView>
                <Text style={styles.statusOptionLabel}>Font</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusOptionRow}>
                  {statusFontOptions.map((font) => (
                    <Pressable
                      key={font}
                      onPress={() => setStatusFontFamily(font)}
                      style={[styles.statusFontChip, statusFontFamily === font ? styles.statusFontChipActive : null]}
                    >
                      <Text style={[styles.statusFontChipText, { fontFamily: font === 'System' ? undefined : font }]}>{font}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Text style={styles.statusOptionLabel}>Size</Text>
                <View style={styles.statusSizeRow}>
                  {[22, 30, 38].map((size) => (
                    <Pressable
                      key={size}
                      onPress={() => setStatusFontSize(size)}
                      style={[styles.statusSizeChip, statusFontSize === size ? styles.statusFontChipActive : null]}
                    >
                      <Text style={styles.statusFontChipText}>{size}</Text>
                    </Pressable>
                  ))}
                </View>
                  </ScrollView>
                ) : null}
              </>
            ) : null}
            <View style={styles.catalogActionRow}>
              {[
                ['contacts', 'My contacts'],
                ['public', 'Public'],
              ].map(([id, label]) => (
                <Pressable key={id} style={styles.catalogChip} onPress={() => setStatusAudience(id)}>
                  <Text style={styles.catalogChipText}>{statusAudience === id ? `✓ ${label}` : label}</Text>
                </Pressable>
              ))}
            </View>
            {filteredCatalogItems.filter((item) => (item.status || 'active') === 'active' && !item.takenDown).length ? (
              <>
                <Text style={styles.lightSectionLabel}>TAG A PRODUCT</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  <Pressable
                    style={[styles.marketFilterChip, !statusTaggedProductId ? styles.marketFilterChipOn : null]}
                    onPress={() => setStatusTaggedProductId('')}
                  >
                    <Text style={styles.marketFilterText}>No product</Text>
                  </Pressable>
                  {filteredCatalogItems
                    .filter((item) => (item.status || 'active') === 'active' && !item.takenDown)
                    .slice(0, 20)
                    .map((item) => (
                      <Pressable
                        key={item.id}
                        style={[styles.marketFilterChip, statusTaggedProductId === item.id ? styles.marketFilterChipOn : null]}
                        onPress={() => setStatusTaggedProductId(item.id)}
                      >
                        <Text style={styles.marketFilterText} numberOfLines={1}>{item.title}</Text>
                      </Pressable>
                    ))}
                </ScrollView>
              </>
            ) : null}
            <Pressable style={styles.sendButtonWide} onPress={() => void postStatus()}>
              <Text style={styles.sendButtonText}>
                {statusTaggedProductId ? 'Post status with product' : 'Post status'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(activeStatusGroup && activeStatusItem)}
        onRequestClose={closeStatusViewer}
      >
        <View style={styles.storyOverlay}>
          <View style={styles.storySheet}>
            <View style={styles.storyTop}>
              <View style={styles.storyProgressRow}>
                {visibleStatusItems.map((item, index) => (
                  <View key={item.id} style={styles.storyProgressTrack}>
                    <View
                      style={[
                        styles.storyProgressFill,
                        {
                          width:
                            index < activeStatusItemIndex
                              ? '100%'
                              : index === activeStatusItemIndex
                                ? `${Math.round(statusProgress * 100)}%`
                                : '0%',
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <View style={styles.storyHeader}>
                <View style={styles.storyHeaderUser}>
                  <View style={styles.storyHeaderAvatar}>
                    <Text style={styles.storyHeaderAvatarText}>{activeStatusGroup?.avatar ?? 'ST'}</Text>
                  </View>
                  <View>
                    <Text style={styles.storyHeaderTitle}>{displayNameFor(activeStatusGroup?.userId, activeStatusGroup?.name ?? 'Status')}</Text>
                    <Text style={styles.storyHeaderMeta}>{activeStatusItem?.createdAt ? formatClock(activeStatusItem.createdAt) : ''}</Text>
                  </View>
                </View>
                <Pressable onPress={closeStatusViewer}>
                  <Text style={styles.storyClose}>Close</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.storyBody}>
              <Pressable style={styles.storyNavLeft} onPress={() => moveStatus('previous')} />
              <Pressable
                style={styles.storyMediaShell}
                onPressIn={() => setStatusHoldActive(true)}
                onPressOut={() => setStatusHoldActive(false)}
              >
                {activeStatusItem?.assets?.[0]?.kind === 'video' && activeStatusItem?.assets?.[0]?.url ? (
                  <Video
                    controls={false}
                    paused={statusPlaybackPaused}
                    repeat={false}
                    resizeMode="contain"
                    source={{ uri: activeStatusItem.assets[0].url }}
                    style={styles.storyMedia}
                  />
                ) : activeStatusItem?.assets?.[0]?.url ? (
                  <Image resizeMode="contain" source={{ uri: activeStatusItem.assets[0].url }} style={styles.storyMedia} />
                ) : (
                  <View style={[styles.storyFallback, { backgroundColor: activeStatusItem?.backgroundColor ?? '#162235' }]}>
                    <Text
                      style={[
                        styles.storyFallbackText,
                        {
                          fontSize: activeStatusItem?.fontSize
                            ? Math.min(activeStatusItem.fontSize, statusTextSize(activeStatusItem?.text))
                            : statusTextSize(activeStatusItem?.text),
                          fontFamily: activeStatusItem?.fontFamily === 'System' ? undefined : activeStatusItem?.fontFamily,
                        },
                      ]}
                    >
                      {activeStatusItem?.text || activeStatusGroup?.name?.slice(0, 1) || 'S'}
                    </Text>
                  </View>
                )}
              </Pressable>
              <Pressable style={styles.storyNavRight} onPress={() => moveStatus('next')} />
              <View style={[styles.storyCaption, { bottom: Math.max(insets.bottom, 36) + 8, zIndex: 30 }]}>
                  {activeStatusItem?.assets?.length ? (
                    <Text style={styles.storyCaptionBody}>
                      {activeStatusItem?.assets?.[0]?.caption || ''}
                    </Text>
                  ) : null}
                  {activeStatusItem?.catalogItemId ? (
                    <Pressable
                      style={styles.sendButtonWide}
                      onPress={() => void openStatusProduct(activeStatusItem.catalogItemId, activeStatusItem.id)}
                    >
                      <Text style={styles.sendButtonText}>View product</Text>
                    </Pressable>
                  ) : null}
                  <View style={styles.storyStatsRow}>
                    <Pressable onPress={openViewerList}>
                      <Text style={styles.storyStatText}>Views {activeStatusItem?.views?.length ?? 0}</Text>
                    </Pressable>
                    {activeStatusItem?.userId && activeStatusItem.userId !== currentUserId && activeStatusItem.audience === 'public' && !isMutualContact(activeStatusItem.userId) ? (
                      <Pressable onPress={() => void sendChatRequest(activeStatusItem.userId, 'From your public status')}>
                        <Text style={styles.storyStatText}>Request chat</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => setStatusThreadVisible(true)}>
                      <Text style={styles.storyStatText}>Replies {activeStatusItem?.comments?.length ?? 0}</Text>
                    </Pressable>
                    <Pressable onPress={openReactorList}>
                      <Text style={styles.storyStatText}>Reactions {activeStatusItem?.reactions?.length ?? 0}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.storyReactionRow}>
                    {statusReactionOptions.map((emoji) => (
                      <Pressable
                        key={emoji}
                        style={[
                          styles.storyReactionChip,
                          (activeStatusItem?.reactions ?? []).some((reaction) => reaction.userId === currentUserId && reaction.emoji === emoji)
                            ? styles.storyReactionChipActive
                            : null,
                        ]}
                        onPress={() => submitStatusReaction(emoji)}
                        onLongPress={openReactorList}
                      >
                        <Text style={styles.storyReactionChipText}>{emoji}</Text>
                        <Text style={styles.storyReactionCount} onPress={openReactorList}>
                          {(activeStatusItem?.reactions ?? []).filter((reaction) => reaction.emoji === emoji).length}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.storyActionRow}>
                    <Pressable style={styles.storyActionButton} onPress={() => submitStatusReaction('❤️')}>
                      <Text style={styles.storyActionButtonText}>♡</Text>
                    </Pressable>
                    <Pressable style={[styles.storyActionButton, styles.storyActionButtonPrimary]} onPress={() => setStatusReplyVisible(true)}>
                      <Text style={[styles.storyActionButtonText, styles.storyActionButtonTextPrimary]}>Reply</Text>
                    </Pressable>
                    <Pressable style={[styles.storyActionButton, styles.storyActionButtonDone]} onPress={closeStatusViewer}>
                      <Text style={[styles.storyActionButtonText, styles.storyActionButtonTextPrimary]}>Done</Text>
                    </Pressable>
                  </View>
                  {(activeStatusItem?.comments?.length ?? 0) > 0 ? (
                    <View style={styles.storyCommentPreview}>
                      <Text style={styles.storyCommentText}>
                        Latest reply: {activeStatusItem.comments[activeStatusItem.comments.length - 1]?.text}
                      </Text>
                    </View>
                  ) : null}
                </View>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={statusReplyVisible}
        onRequestClose={() => setStatusReplyVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setStatusReplyVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Reply</Text>
            {activeStatusItem?.comments?.length ? activeStatusItem.comments.slice(-3).map((comment) => {
              const meta = getUserMeta(comment.userId);
              return (
                <View key={comment.id} style={styles.storyCommentItem}>
                  <View style={styles.storyCommentIdentity}>
                    <View style={styles.storyCommentAvatar}>
                      <Text style={styles.storyCommentAvatarText}>{meta.avatar}</Text>
                    </View>
                    <View style={styles.storyCommentCopy}>
                      <Text style={styles.storyCommentAuthor}>{meta.name}</Text>
                      <Text style={styles.storyCommentMeta}>{formatClock(comment.updatedAt ?? comment.createdAt)}</Text>
                    </View>
                  </View>
                  <Text style={styles.storyCommentText}>{comment.text}</Text>
                </View>
              );
            }) : null}
            <TextInput
              value={statusCommentDraft}
              onChangeText={setStatusCommentDraft}
              placeholder="Write a reply"
              placeholderTextColor="#9ab0b8"
              multiline
              style={styles.storyCommentEditor}
            />
            <View style={styles.storyCommentActions}>
              <Pressable onPress={() => setStatusReplyVisible(false)}>
                <Text style={styles.storyCommentActionText}>Discard</Text>
              </Pressable>
              <Pressable onPress={submitStatusComment}>
                <Text style={styles.storyCommentActionText}>Send</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={statusReactorsVisible}
        onRequestClose={() => setStatusReactorsVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setStatusReactorsVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Reactions</Text>
            {statusReactors.length ? statusReactors.map((reactor) => (
              <View key={`${reactor.userId}-${reactor.reactedAt}`} style={styles.viewerRow}>
                <Text style={styles.cardBody}>{reactor.emoji} {reactor.name}</Text>
                <Text style={styles.cardMeta}>{formatClock(reactor.reactedAt)}</Text>
              </View>
            )) : <Text style={styles.cardBody}>No reactions yet.</Text>}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={statusViewersVisible}
        onRequestClose={() => setStatusViewersVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setStatusViewersVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Viewed by</Text>
            {statusViewers.length ? statusViewers.map((viewer) => (
              <View key={`${viewer.userId}-${viewer.viewedAt}`} style={styles.viewerRow}>
                <Text style={styles.cardBody}>{viewer.name}</Text>
                <Text style={styles.cardMeta}>{formatClock(viewer.viewedAt)}</Text>
              </View>
            )) : <Text style={styles.cardBody}>No viewers yet.</Text>}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={statusThreadVisible}
        onRequestClose={() => setStatusThreadVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setStatusThreadVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Replies</Text>
            {activeStatusItem?.comments?.length ? activeStatusItem.comments.map((comment) => {
              const isMine = comment.userId === currentUserId;
              const isEditing = editingStatusCommentId === comment.id;
              const meta = getUserMeta(comment.userId);
              return (
                <View key={comment.id} style={styles.storyCommentItem}>
                  <View style={styles.storyCommentHeader}>
                    <View style={styles.storyCommentIdentity}>
                      <View style={styles.storyCommentAvatar}>
                        <Text style={styles.storyCommentAvatarText}>{meta.avatar}</Text>
                      </View>
                      <View style={styles.storyCommentCopy}>
                        <Text style={styles.storyCommentAuthor}>{meta.name}</Text>
                        <Text style={styles.storyCommentMeta}>
                          {formatClock(comment.updatedAt ?? comment.createdAt)}{comment.updatedAt ? ' edited' : ''}
                        </Text>
                      </View>
                    </View>
                    {isMine ? (
                      <View style={styles.storyCommentActions}>
                        <Pressable onPress={() => startEditingStatusComment(comment.id, comment.text)}>
                          <Text style={styles.storyCommentActionText}>Edit</Text>
                        </Pressable>
                        <Pressable onPress={() => removeStatusComment(comment.id)}>
                          <Text style={[styles.storyCommentActionText, styles.storyCommentDeleteText]}>Delete</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                  {isEditing ? (
                    <>
                      <TextInput
                        value={editingStatusCommentText}
                        onChangeText={setEditingStatusCommentText}
                        multiline
                        style={styles.storyCommentEditor}
                      />
                      <View style={styles.storyCommentActions}>
                        <Pressable onPress={saveStatusCommentEdit}>
                          <Text style={styles.storyCommentActionText}>Save</Text>
                        </Pressable>
                        <Pressable onPress={() => { setEditingStatusCommentId(null); setEditingStatusCommentText(''); }}>
                          <Text style={styles.storyCommentActionText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <Text style={styles.storyCommentText}>{comment.text}</Text>
                  )}
                </View>
              );
            }) : <Text style={styles.cardBody}>No replies yet.</Text>}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={Boolean(productDetail)} animationType="slide" onRequestClose={() => setProductDetail(null)}>
        <View style={styles.productScreen}>
          <View style={styles.productTopBar}>
            <Pressable onPress={() => setProductDetail(null)}><Text style={styles.storyClose}>Close</Text></Pressable>
            <Text style={styles.productTopTitle}>Product</Text>
            <View style={{ width: 48 }} />
          </View>
          {productDetail ? (
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              {(productDetail.imageUris?.length ? productDetail.imageUris : [productDetail.imageUri].filter(Boolean)).length ? (
                <Image
                  source={{ uri: (productDetail.imageUris?.length ? productDetail.imageUris : [productDetail.imageUri])[productImageIndex] }}
                  style={styles.productHero}
                />
              ) : <View style={[styles.productHero, { backgroundColor: '#d9e4df' }]} />}
              <ScrollView horizontal contentContainerStyle={styles.marketFilterRow}>
                {(productDetail.imageUris || []).map((uri, index) => (
                  <Pressable key={uri} onPress={() => setProductImageIndex(index)}>
                    <Image source={{ uri }} style={[styles.productThumb, productImageIndex === index ? styles.productThumbOn : null]} />
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.productBody}>
                <Text style={styles.marketPrice}>{productDetail.price}</Text>
                <Text style={styles.productName}>{productDetail.title}</Text>
                {productDetail.boostText ? <Text style={styles.marketBoostBadge}>{productDetail.boostText}</Text> : null}
                <Text style={styles.productCopy}>{productDetail.description}</Text>
                <Text style={styles.marketMeta}>{productDetail.location || 'Location not set'} · {productDetail.condition || 'New'} · {productDetail.category}</Text>
                <Text style={styles.productSeller}>{displayNameFor(productDetail.sellerId, productDetail.seller || 'Seller')}</Text>
                <Pressable style={styles.sendButtonWide} onPress={() => { setProductDetail(null); void sendCatalogCard(productDetail, productDetail.sellerId); }}>
                  <Text style={styles.sendButtonText}>Message seller</Text>
                </Pressable>
                <Pressable style={styles.ghostButton} onPress={() => { setProductDetail(null); void startCall('Audio', productDetail.sellerId); }}>
                  <Text style={styles.ghostButtonText}>Call seller</Text>
                </Pressable>
                {productDetail.sellerId === currentUserId ? (
                  <>
                    <Pressable style={styles.ghostButton} onPress={() => void featureProduct(productDetail)}>
                      <Text style={styles.ghostButtonText}>Feature this product</Text>
                    </Pressable>
                    <Pressable style={styles.ghostButton} onPress={() => void takeDownProduct(productDetail)}>
                      <Text style={styles.ghostButtonText}>Take down</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
      <Modal transparent visible={Boolean(phonePrompt)} animationType="fade" onRequestClose={() => setPhonePrompt(null)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setPhonePrompt(null)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{phonePrompt?.name || 'On ZynkUP'}</Text>
            <Text style={styles.cardBody}>{phonePrompt?.phone}{phonePrompt?.username ? ` · ${phonePrompt.username}` : ''}</Text>
            <Text style={styles.cardMeta}>Statuses stay private until you both save each other.</Text>
            <Pressable style={styles.sendButtonWide} onPress={() => { const userId = phonePrompt?.id; setPhonePrompt(null); void createDirectChat(userId); }}>
              <Text style={styles.sendButtonText}>Chat</Text>
            </Pressable>
            <Pressable style={styles.ghostButton} onPress={() => { const userId = phonePrompt?.id; setPhonePrompt(null); void startCall('Audio', userId); }}>
              <Text style={styles.ghostButtonText}>Call</Text>
            </Pressable>
            <Pressable style={styles.ghostButton} onPress={() => void savePromptContact()}>
              <Text style={styles.ghostButtonText}>Save number</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={Boolean(businessPanel)}
        onRequestClose={() => setBusinessPanel('')}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>
                {businessPanel === 'dashboard'
                  ? 'Sales dashboard'
                  : businessPanel === 'profile'
                    ? 'Storefront'
                    : businessPanel === 'catalog'
                      ? 'My catalog'
                      : businessPanel === 'customers'
                        ? 'Customers'
                        : businessPanel === 'orders'
                          ? 'Orders'
                          : businessPanel === 'inventory'
                            ? 'Inventory'
                            : businessPanel === 'receipts'
                              ? 'Receipts'
                              : businessPanel === 'documents'
                                ? 'Quotes & invoices'
                                : businessPanel === 'autoreplies'
                                  ? 'Auto-replies'
                                  : businessPanel === 'businessai'
                                    ? 'Business AI'
                                    : 'Broadcast'}
              </Text>
              <Pressable onPress={() => setBusinessPanel('')}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>

            {businessPanel === 'dashboard' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  {[
                    ['today', 'Today'],
                    ['7d', '7 days'],
                    ['30d', '30 days'],
                  ].map(([id, label]) => (
                    <Pressable
                      key={id}
                      style={[styles.marketFilterChip, salesDashboardPeriod === id ? styles.marketFilterChipOn : null]}
                      onPress={() => {
                        setSalesDashboardPeriod(id);
                        void loadSalesDashboard(id);
                      }}
                    >
                      <Text style={styles.marketFilterText}>{label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {salesDashboard ? (
                  <>
                    <Text style={styles.cardBody}>
                      {salesDashboard.periodStart ? new Date(salesDashboard.periodStart).toLocaleDateString() : ''}
                      {' – '}
                      {salesDashboard.periodEnd ? new Date(salesDashboard.periodEnd).toLocaleDateString() : ''}
                      {' · '}
                      {salesDashboard.currency}
                      {salesDashboard.estimated ? ' · Estimated' : ' · Live'}
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      Updated {salesDashboard.lastUpdatedAt ? new Date(salesDashboard.lastUpdatedAt).toLocaleString() : ''}
                    </Text>
                    <View style={styles.businessStatsRow}>
                      <Pressable
                        style={styles.businessStatCard}
                        onPress={() => {
                          setBusinessPanel('');
                          openOrdersPanel('seller');
                        }}
                      >
                        <Text style={styles.businessStatValue}>{salesDashboard.metrics?.pendingOrders ?? 0}</Text>
                        <Text style={styles.businessStatLabel}>Pending orders</Text>
                      </Pressable>
                      <Pressable
                        style={styles.businessStatCard}
                        onPress={() => {
                          void loadSaleReceipts();
                          setBusinessPanel('receipts');
                        }}
                      >
                        <Text style={styles.businessStatValue}>{salesDashboard.metrics?.confirmedSalesCount ?? 0}</Text>
                        <Text style={styles.businessStatLabel}>Confirmed sales</Text>
                      </Pressable>
                      <Pressable
                        style={styles.businessStatCard}
                        onPress={() => setBusinessPanel('catalog')}
                      >
                        <Text style={styles.businessStatValue}>{salesDashboard.metrics?.lowStockCount ?? 0}</Text>
                        <Text style={styles.businessStatLabel}>Low stock</Text>
                      </Pressable>
                    </View>
                    {salesDashboard.canSeeFinance ? (
                      <>
                        <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>SALES (NOT PROFIT)</Text>
                        <Text style={styles.sheetOptionTitle}>
                          Gross sales {moneyLabel(salesDashboard.metrics?.grossSales, salesDashboard.currency)}
                        </Text>
                        <Text style={styles.sheetOptionBody}>
                          Refunds {moneyLabel(salesDashboard.metrics?.refunds, salesDashboard.currency)}
                          {' · '}
                          Net sales {moneyLabel(salesDashboard.metrics?.netSales, salesDashboard.currency)}
                        </Text>
                        <Text style={styles.sheetOptionBody}>
                          Cash received {moneyLabel(salesDashboard.metrics?.cashReceived, salesDashboard.currency)}
                          {' (confirmed payments only)'}
                        </Text>
                        <Text style={styles.sheetOptionBody}>
                          {salesDashboard.metrics?.grossProfitAvailable
                            ? `Gross profit ${moneyLabel(salesDashboard.metrics?.grossProfit, salesDashboard.currency)} · COGS ${moneyLabel(salesDashboard.metrics?.costOfGoodsSold, salesDashboard.currency)}`
                            : 'Gross profit unavailable — add cost prices on products first.'}
                        </Text>
                        <Text style={styles.cardBody}>{salesDashboard.metrics?.grossProfitNote}</Text>
                      </>
                    ) : (
                      <Text style={styles.cardBody}>Financial totals are limited to owners and managers.</Text>
                    )}
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>TOP PRODUCTS</Text>
                    {(salesDashboard.topProducts || []).length ? null : (
                      <Text style={styles.sheetOptionBody}>No confirmed sales in this period.</Text>
                    )}
                    {(salesDashboard.topProducts || []).map((product) => (
                      <Text key={product.catalogItemId || product.title} style={styles.sheetOptionBody}>
                        {product.title} · {product.units} sold
                        {product.revenue != null ? ` · ${moneyLabel(product.revenue, salesDashboard.currency)}` : ''}
                      </Text>
                    ))}
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>LOW STOCK</Text>
                    {(salesDashboard.lowStock || []).length ? null : (
                      <Text style={styles.sheetOptionBody}>Stock looks fine right now.</Text>
                    )}
                    {(salesDashboard.lowStock || []).map((item) => (
                      <Pressable key={item.id} style={styles.sheetOption} onPress={() => setBusinessPanel('catalog')}>
                        <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                        <Text style={styles.sheetOptionBody}>
                          {item.stockQuantity} left · alert at {item.lowStockThreshold}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={[styles.ghostButton, { marginTop: 12 }]}
                      onPress={() => {
                        const lines = [
                          `ZynkUP sales report (${salesDashboard.period})`,
                          `Currency ${salesDashboard.currency}`,
                          `Pending orders ${salesDashboard.metrics?.pendingOrders ?? 0}`,
                          `Confirmed sales ${salesDashboard.metrics?.confirmedSalesCount ?? 0}`,
                          salesDashboard.canSeeFinance
                            ? `Gross sales ${salesDashboard.metrics?.grossSales} · Net sales ${salesDashboard.metrics?.netSales} · Cash received ${salesDashboard.metrics?.cashReceived}`
                            : null,
                          `Low stock ${salesDashboard.metrics?.lowStockCount ?? 0}`,
                        ].filter(Boolean);
                        void Share.share({ message: lines.join('\n') });
                      }}
                    >
                      <Text style={styles.ghostButtonText}>Share report</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.cardBody}>Loading sales figures…</Text>
                )}
              </ScrollView>
            ) : null}

            {businessPanel === 'profile' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.cardBody}>
                  {(activeBusiness?.visibility || 'draft') === 'published'
                    ? 'Your storefront is public. Anyone on ZynkUP can open it.'
                    : 'This storefront is a draft. Publish when you are ready for customers to find you.'}
                </Text>
                <TextInput
                  value={businessDraft.name}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, name: value }))}
                  placeholder="Business name"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={businessDraft.description}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, description: value }))}
                  placeholder="What you sell"
                  placeholderTextColor="#7d8b92"
                  multiline
                  style={styles.textArea}
                />
                <TextInput
                  value={businessDraft.location}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, location: value }))}
                  placeholder="Location / city"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={businessDraft.hours}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, hours: value }))}
                  placeholder="Hours (e.g. Mon–Sat 9–6)"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={businessDraft.contactButtonLabel}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, contactButtonLabel: value }))}
                  placeholder="Contact button label"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={businessDraft.logoUrl}
                  onChangeText={(value) => setBusinessDraft((current) => ({ ...current, logoUrl: value }))}
                  placeholder="Logo URL (https)"
                  placeholderTextColor="#7d8b92"
                  autoCapitalize="none"
                  style={styles.input}
                />
                {renderSettingsToggle(
                  'Show phone on storefront',
                  businessDraft.showPhone,
                  (value) => setBusinessDraft((current) => ({ ...current, showPhone: value })),
                  'Only when published. Customers can call or message you.',
                )}
                <Pressable style={styles.sendButtonWide} onPress={() => void saveBusinessStorefront()}>
                  <Text style={styles.sendButtonText}>Save storefront</Text>
                </Pressable>
                {(activeBusiness?.visibility || 'draft') !== 'published' ? (
                  <Pressable
                    style={[styles.sendButtonWide, { marginTop: 10 }]}
                    onPress={() => void saveBusinessStorefront({ visibility: 'published' })}
                  >
                    <Text style={styles.sendButtonText}>Publish storefront</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[styles.ghostButton, { marginTop: 10 }]}
                    onPress={() => void saveBusinessStorefront({ visibility: 'draft' })}
                  >
                    <Text style={styles.ghostButtonText}>Unpublish (back to draft)</Text>
                  </Pressable>
                )}
                <Text style={[styles.lightSectionLabel, { marginTop: 18 }]}>VERIFICATION</Text>
                <Text style={styles.cardBody}>
                  {(activeBusiness?.verificationStatus || 'unverified') === 'approved'
                    ? 'Verified. Customers see a checkmark on your storefront.'
                    : (activeBusiness?.verificationStatus || '') === 'pending'
                      ? 'Pending review. We will update this after checking your details.'
                      : (activeBusiness?.verificationStatus || '') === 'rejected'
                        ? `Not approved${activeBusiness?.verificationReviewNote ? `: ${activeBusiness.verificationReviewNote}` : '.'}`
                        : 'Request a verified badge so customers know you are a real business.'}
                </Text>
                {(activeBusiness?.verificationStatus || 'unverified') !== 'approved' ? (
                  <>
                    <TextInput
                      value={businessDraft.verificationNote}
                      onChangeText={(value) => setBusinessDraft((current) => ({ ...current, verificationNote: value }))}
                      placeholder="Business registration, location, or proof note"
                      placeholderTextColor="#7d8b92"
                      multiline
                      style={styles.textArea}
                    />
                    <Pressable style={styles.ghostButton} onPress={() => void requestBusinessVerification()}>
                      <Text style={styles.ghostButtonText}>
                        {(activeBusiness?.verificationStatus || '') === 'pending' ? 'Resubmit verification' : 'Request verification'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </ScrollView>
            ) : null}

            {businessPanel === 'catalog' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <TextInput
                  value={catalogSearch}
                  onChangeText={setCatalogSearch}
                  placeholder="Search products"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  {['All', 'active', 'draft', 'out_of_stock', 'archived'].map((status) => (
                    <Pressable
                      key={status}
                      style={[styles.marketFilterChip, catalogStatusFilter === status ? styles.marketFilterChipOn : null]}
                      onPress={() => setCatalogStatusFilter(status)}
                    >
                      <Text style={styles.marketFilterText}>{status === 'out_of_stock' ? 'Out of stock' : status}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable style={styles.ghostButton} onPress={() => pickMultipleImages('catalog')}>
                  <Text style={styles.ghostButtonText}>
                    {catalogImageUris.length ? `${catalogImageUris.length} image(s) selected` : 'Add product images'}
                  </Text>
                </Pressable>
                {catalogImageUris.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaPreviewRow}>
                    {catalogImageUris.map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.mediaPreviewThumb} />
                    ))}
                  </ScrollView>
                ) : null}
                <TextInput
                  value={catalogForm.title}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, title: value }))}
                  placeholder="Product title"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.price}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, price: value }))}
                  placeholder={`Price (${accountCurrency})`}
                  placeholderTextColor="#7d8b92"
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.stockQuantity}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, stockQuantity: value.replace(/[^\d]/g, '') }))}
                  placeholder="Stock quantity"
                  placeholderTextColor="#7d8b92"
                  keyboardType="number-pad"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.costPrice}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, costPrice: value }))}
                  placeholder={`Cost price (${accountCurrency}) — for gross profit`}
                  placeholderTextColor="#7d8b92"
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.lowStockThreshold}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, lowStockThreshold: value.replace(/[^\d]/g, '') }))}
                  placeholder="Low-stock alert threshold"
                  placeholderTextColor="#7d8b92"
                  keyboardType="number-pad"
                  style={styles.input}
                />
                {renderSettingsToggle(
                  'Track stock',
                  catalogForm.trackStock,
                  (value) => setCatalogForm((current) => ({ ...current, trackStock: value })),
                  'Turn off if you do not count units for this product.',
                )}
                <TextInput
                  value={catalogForm.description}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, description: value }))}
                  placeholder="Describe the product, what is included, and how to collect it"
                  placeholderTextColor="#7d8b92"
                  multiline
                  style={styles.textArea}
                />
                <TextInput
                  value={catalogForm.location}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, location: value }))}
                  placeholder="Area or city"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.variantName}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, variantName: value }))}
                  placeholder="Variant name (e.g. Storage, Colour)"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={catalogForm.variantOptions}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, variantOptions: value }))}
                  placeholder="Options, comma-separated (e.g. 64GB, 128GB)"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  {PRODUCT_CATEGORIES.filter((category) => category !== 'All').map((category) => (
                    <Pressable key={category} style={[styles.marketFilterChip, catalogForm.category === category ? styles.marketFilterChipOn : null]} onPress={() => setCatalogForm((current) => ({ ...current, category }))}>
                      <Text style={styles.marketFilterText}>{category}</Text>
                    </Pressable>
                  ))}
                  {['New', 'Used'].map((condition) => (
                    <Pressable key={condition} style={[styles.marketFilterChip, catalogForm.condition === condition ? styles.marketFilterChipOn : null]} onPress={() => setCatalogForm((current) => ({ ...current, condition }))}>
                      <Text style={styles.marketFilterText}>{condition}</Text>
                    </Pressable>
                  ))}
                  {['active', 'draft'].map((status) => (
                    <Pressable key={status} style={[styles.marketFilterChip, catalogForm.status === status ? styles.marketFilterChipOn : null]} onPress={() => setCatalogForm((current) => ({ ...current, status }))}>
                      <Text style={styles.marketFilterText}>{status}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable style={styles.sendButtonWide} onPress={() => void addCatalogItem()}>
                  <Text style={styles.sendButtonText}>{catalogForm.status === 'draft' ? 'Save draft' : 'Publish product'}</Text>
                </Pressable>
                <Text style={styles.lightSectionLabel}>CATALOGUE</Text>
                {filteredCatalogItems.map((item) => (
                  <View key={item.id} style={styles.catalogManageRow}>
                    {item.imageUri ? (
                      <Image source={{ uri: item.imageUri }} style={styles.catalogManageImage} />
                    ) : (
                      <View style={[styles.catalogManageImage, styles.catalogManageImageFallback]}>
                        <Text style={styles.cardMeta}>No img</Text>
                      </View>
                    )}
                    <View style={styles.catalogManageCopy}>
                      <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                      <Text style={styles.sheetOptionBody}>
                        {item.price} · {item.status || 'active'}
                        {item.trackStock === false
                          ? ' · Stock not tracked'
                          : ` · Stock ${item.stockQuantity ?? 0}${Number(item.stockQuantity ?? 0) <= Number(item.lowStockThreshold ?? 2) ? ' · Low stock' : ''}`}
                      </Text>
                      {(item.variants || []).length ? (
                        <Text style={styles.sheetOptionBody}>
                          {(item.variants || []).map((variant) => `${variant.name}: ${(variant.options || []).join(', ')}`).join(' · ')}
                        </Text>
                      ) : null}
                      {item.availabilityUpdatedAt ? (
                        <Text style={styles.sheetOptionBody}>
                          Availability updated {new Date(item.availabilityUpdatedAt).toLocaleString()}
                        </Text>
                      ) : null}
                      <View style={styles.stockControls}>
                        <Pressable
                          style={styles.stockButton}
                          onPress={() => void adjustCatalogStock(item.id, (item.stockQuantity ?? 0) - 1)}
                        >
                          <Text style={styles.stockButtonText}>-</Text>
                        </Pressable>
                        <Pressable
                          style={styles.stockButton}
                          onPress={() => void adjustCatalogStock(item.id, (item.stockQuantity ?? 0) + 1)}
                        >
                          <Text style={styles.stockButtonText}>+</Text>
                        </Pressable>
                      </View>
                      <View style={styles.catalogActionRow}>
                        <Pressable style={styles.catalogChip} onPress={() => void setCatalogVisibility(item, !item.isPublic)}>
                          <Text style={styles.catalogChipText}>{item.isPublic ? 'Public' : 'Make public'}</Text>
                        </Pressable>
                        {(item.status || 'active') !== 'active' ? (
                          <Pressable style={styles.catalogChip} onPress={() => void setCatalogItemStatus(item, 'active')}>
                            <Text style={styles.catalogChipText}>Activate</Text>
                          </Pressable>
                        ) : null}
                        {(item.status || 'active') !== 'archived' ? (
                          <Pressable style={styles.catalogChip} onPress={() => void setCatalogItemStatus(item, 'archived')}>
                            <Text style={styles.catalogChipText}>Archive</Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={styles.catalogChip} onPress={() => void postCatalogToStatus(item, 'contacts')}>
                          <Text style={styles.catalogChipText}>Post to status</Text>
                        </Pressable>
                        <Pressable style={styles.catalogChip} onPress={() => void postCatalogToStatus(item, 'marketplace')}>
                          <Text style={styles.catalogChipText}>Post to marketplace</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {businessPanel === 'customers' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {selectedCustomer ? (
                  <>
                    <Pressable
                      style={styles.catalogChip}
                      onPress={() => {
                        setSelectedCustomer(null);
                        setCustomerOrders([]);
                      }}
                    >
                      <Text style={styles.catalogChipText}>Back to list</Text>
                    </Pressable>
                    <Text style={styles.sheetOptionTitle}>{selectedCustomer.displayName}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {selectedCustomer.phone || 'No phone'}
                      {selectedCustomer.customerUserId ? ' · On ZynkUP' : ''}
                      {' · '}
                      {selectedCustomer.marketingConsent === 'opted_in'
                        ? 'Marketing opted in'
                        : selectedCustomer.marketingConsent === 'opted_out'
                          ? 'Marketing opted out'
                          : 'Marketing consent unknown'}
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      {selectedCustomer.orderCount || 0} orders · spent{' '}
                      {selectedCustomer.currency || profile.currency || 'GHS'}{' '}
                      {Number(selectedCustomer.totalSpent || 0).toFixed(2)}
                    </Text>
                    {selectedCustomer.tags?.length ? (
                      <Text style={styles.sheetOptionBody}>Tags: {selectedCustomer.tags.join(', ')}</Text>
                    ) : null}
                    {selectedCustomer.followUpAt ? (
                      <Text style={styles.sheetOptionBody}>
                        Follow-up {new Date(selectedCustomer.followUpAt).toLocaleString()}
                        {selectedCustomer.followUpNote ? ` · ${selectedCustomer.followUpNote}` : ''}
                      </Text>
                    ) : null}
                    <View style={styles.stockControls}>
                      {selectedCustomer.customerUserId ? (
                        <Pressable
                          style={styles.catalogChip}
                          onPress={() => {
                            setBusinessPanel('');
                            void createDirectChat(selectedCustomer.customerUserId);
                          }}
                        >
                          <Text style={styles.catalogChipText}>Message</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={styles.catalogChip}
                        onPress={() =>
                          void updateBusinessCustomer(selectedCustomer.id, {
                            followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                            followUpNote: 'Follow up tomorrow',
                          })
                        }
                      >
                        <Text style={styles.catalogChipText}>Follow up tomorrow</Text>
                      </Pressable>
                      <Pressable
                        style={styles.catalogChip}
                        onPress={() => void updateBusinessCustomer(selectedCustomer.id, { marketingConsent: 'opted_out' })}
                      >
                        <Text style={styles.catalogChipText}>Mark opted out</Text>
                      </Pressable>
                      <Pressable
                        style={styles.catalogChip}
                        onPress={() => void deleteBusinessCustomer(selectedCustomer.id)}
                      >
                        <Text style={styles.catalogChipText}>Delete record</Text>
                      </Pressable>
                    </View>
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>NOTES</Text>
                    <TextInput
                      value={customerNoteDraft}
                      onChangeText={setCustomerNoteDraft}
                      placeholder="Add a private note"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <Pressable style={styles.sendButtonWide} onPress={() => void addCustomerNote(selectedCustomer.id)}>
                      <Text style={styles.sendButtonText}>Save note</Text>
                    </Pressable>
                    {(selectedCustomer.notes || []).map((note) => (
                      <View key={note.id} style={styles.sheetOption}>
                        <Text style={styles.sheetOptionBody}>{note.text}</Text>
                        <Text style={styles.sheetOptionBody}>{new Date(note.createdAt).toLocaleString()}</Text>
                      </View>
                    ))}
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>PURCHASE HISTORY</Text>
                    {customerOrders.length ? null : (
                      <Text style={styles.sheetOptionBody}>No linked orders yet.</Text>
                    )}
                    {customerOrders.map((order) => (
                      <View key={order.id} style={styles.sheetOption}>
                        <Text style={styles.sheetOptionTitle}>{order.itemTitle}</Text>
                        <Text style={styles.sheetOptionBody}>
                          {order.state} · {order.currency} {Number(order.totalAmount || 0).toFixed(2)} ·{' '}
                          {new Date(order.createdAt).toLocaleDateString()}
                        </Text>
                      </View>
                    ))}
                  </>
                ) : (
                  <>
                    <Text style={styles.cardBody}>
                      Customer records are separate from personal profiles. Orders create a record automatically. Marketing
                      stays unknown until the customer opts in.
                    </Text>
                    <Text style={styles.lightSectionLabel}>ADD CUSTOMER</Text>
                    <TextInput
                      value={customerForm.displayName}
                      onChangeText={(value) => setCustomerForm((current) => ({ ...current, displayName: value }))}
                      placeholder="Name"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <TextInput
                      value={customerForm.phone}
                      onChangeText={(value) => setCustomerForm((current) => ({ ...current, phone: value }))}
                      placeholder="Phone"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                      keyboardType="phone-pad"
                    />
                    <TextInput
                      value={customerForm.tags}
                      onChangeText={(value) => setCustomerForm((current) => ({ ...current, tags: value }))}
                      placeholder="Tags (comma separated)"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <TextInput
                      value={customerForm.note}
                      onChangeText={(value) => setCustomerForm((current) => ({ ...current, note: value }))}
                      placeholder="First note (optional)"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <Pressable style={styles.sendButtonWide} onPress={() => void createBusinessCustomer()}>
                      <Text style={styles.sendButtonText}>Save customer</Text>
                    </Pressable>
                    <Pressable style={styles.catalogChip} onPress={() => void loadBusinessCustomers()}>
                      <Text style={styles.catalogChipText}>Refresh records</Text>
                    </Pressable>
                    <Pressable style={styles.catalogChip} onPress={() => void syncPhoneContacts(currentUserId)}>
                      <Text style={styles.catalogChipText}>Sync phone contacts</Text>
                    </Pressable>
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>CUSTOMER RECORDS</Text>
                    {businessCustomers.length ? null : (
                      <Text style={styles.cardBody}>No CRM records yet. Save one above or wait for an order.</Text>
                    )}
                    {businessCustomers.map((customer) => {
                      const due =
                        customer.followUpAt && new Date(customer.followUpAt).getTime() <= Date.now();
                      return (
                        <Pressable
                          key={customer.id}
                          style={styles.sheetOption}
                          onPress={() => void loadCustomerDetail(customer.id)}
                        >
                          <Text style={styles.sheetOptionTitle}>
                            {customer.displayName}
                            {due ? ' · Follow-up due' : ''}
                          </Text>
                          <Text style={styles.sheetOptionBody}>
                            {(customer.tags || []).join(', ') || 'No tags'}
                            {' · '}
                            {customer.orderCount || 0} orders
                            {' · '}
                            {customer.marketingConsent}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>PHONE BOOK ON ZYNKUP</Text>
                    {contactItems.filter((contact) => contact.registered || contact.linkedUserId).map((contact) => (
                      <View key={contact.id} style={styles.contactPickRow}>
                        {renderPersonAvatar({
                          userId: contact.linkedUserId,
                          name: contact.name,
                          size: 44,
                          onPress: () => onAvatarPress(contact.linkedUserId, contact.name),
                        })}
                        <Pressable style={styles.contactPickCopy} onPress={() => void importContactAsCustomer(contact)}>
                          <Text style={styles.sheetOptionTitle}>{contact.name}</Text>
                          <Text style={styles.sheetOptionBody}>{contact.phone} · Tap to add to CRM</Text>
                        </Pressable>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            ) : null}

            {businessPanel === 'inventory' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.cardBody}>
                  Low-stock alerts fire when quantity reaches each product threshold. Sales and adjustments are recorded in the inventory ledger.
                </Text>
                <Text style={styles.lightSectionLabel}>OPEN ALERTS</Text>
                {inventoryAlerts.filter((alert) => alert.state === 'open').length ? null : (
                  <Text style={styles.sheetOptionBody}>No open stock alerts.</Text>
                )}
                {inventoryAlerts.filter((alert) => alert.state === 'open').map((alert) => (
                  <View key={alert.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{alert.title}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {alert.stockQuantity} left · alert at {alert.lowStockThreshold}
                    </Text>
                    <Pressable style={styles.catalogChip} onPress={() => void reviewInventoryAlert(alert.id)}>
                      <Text style={styles.catalogChipText}>Mark reviewed</Text>
                    </Pressable>
                  </View>
                ))}
                <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>TRACKED PRODUCTS</Text>
                {filteredCatalogItems.filter((item) => item.trackStock !== false).map((item) => {
                  const low = Number(item.stockQuantity ?? 0) <= Number(item.lowStockThreshold ?? 2);
                  return (
                    <View key={item.id} style={styles.sheetOption}>
                      <Text style={styles.sheetOptionTitle}>{item.title}{low ? ' · Low' : ''}</Text>
                      <Text style={styles.sheetOptionBody}>
                        Stock {item.stockQuantity ?? 0} · threshold {item.lowStockThreshold ?? 2}
                      </Text>
                      <View style={styles.stockControls}>
                        <Pressable style={styles.stockButton} onPress={() => void adjustCatalogStock(item.id, (item.stockQuantity ?? 0) - 1)}>
                          <Text style={styles.stockButtonText}>-</Text>
                        </Pressable>
                        <Pressable style={styles.stockButton} onPress={() => void adjustCatalogStock(item.id, (item.stockQuantity ?? 0) + 1)}>
                          <Text style={styles.stockButtonText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : null}

            {businessPanel === 'orders' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  {[
                    ['seller', 'Selling'],
                    ['buyer', 'Buying'],
                    ['all', 'All'],
                  ].map(([id, label]) => (
                    <Pressable
                      key={id}
                      style={[styles.marketFilterChip, orderRoleFilter === id ? styles.marketFilterChipOn : null]}
                      onPress={() => {
                        setOrderRoleFilter(id);
                        void loadCommerceOrders(id);
                      }}
                    >
                      <Text style={styles.marketFilterText}>{label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {commerceOrders.length ? null : (
                  <Text style={styles.cardBody}>No orders yet. When someone buys from a tagged status or catalogue, it shows here.</Text>
                )}
                {commerceOrders.map((order) => {
                  const item = order.items?.[0];
                  return (
                    <Pressable
                      key={order.id}
                      style={styles.sheetOption}
                      onPress={() => openOrderDetail(order)}
                    >
                      <Text style={styles.sheetOptionTitle}>{item?.title || 'Order'}</Text>
                      <Text style={styles.sheetOptionBody}>
                        {order.id} · {orderStateLabel(order.state)} · {order.currency} {order.totalAmount}
                      </Text>
                      <Text style={styles.sheetOptionBody}>
                        Qty {item?.quantity || 1}
                        {order.sellerUserId === currentUserId ? ' · You sell' : ' · You buy'}
                        {' · '}
                        {new Date(order.createdAt).toLocaleString()}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {businessPanel === 'receipts' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {saleReceipts.length ? null : (
                  <Text style={styles.cardBody}>
                    No sale receipts yet. A receipt is created automatically when an order is marked paid.
                  </Text>
                )}
                {saleReceipts.map((receipt) => (
                  <Pressable key={receipt.id} style={styles.sheetOption} onPress={() => setReceiptDetail(receipt)}>
                    <Text style={styles.sheetOptionTitle}>{receipt.receiptNumber}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {receipt.businessName || receipt.sellerName} · {receipt.currency} {receipt.totalAmount}
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      {receipt.state} · {new Date(receipt.issuedAt || receipt.createdAt).toLocaleString()}
                    </Text>
                  </Pressable>
                ))}
                {payHistoryItems.length ? (
                  <>
                    <Text style={[styles.lightSectionLabel, { marginTop: 16 }]}>WALLET HISTORY</Text>
                    {payHistoryItems.map((receipt) => (
                      <View key={receipt.id} style={styles.sheetOption}>
                        <Text style={styles.sheetOptionTitle}>{receipt.title}</Text>
                        <Text style={styles.sheetOptionBody}>{receipt.time} · {receipt.amount}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </ScrollView>
            ) : null}

            {businessPanel === 'autoreplies' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.cardBody}>
                  Rule-based replies only. No invented prices or stock. Customers can type “human” to pause automation for that chat.
                </Text>
                <Pressable
                  style={styles.sendButtonWide}
                  onPress={() => void saveAutoReplyConfig({ enabled: !autoReplyConfig?.enabled })}
                >
                  <Text style={styles.sendButtonText}>
                    {autoReplyConfig?.enabled ? 'Pause all auto-replies' : 'Turn auto-replies on'}
                  </Text>
                </Pressable>
                <Text style={styles.lightSectionLabel}>GREETING</Text>
                <Pressable
                  style={styles.catalogChip}
                  onPress={() =>
                    void saveAutoReplyConfig({ greetingEnabled: !autoReplyConfig?.greetingEnabled })
                  }
                >
                  <Text style={styles.catalogChipText}>
                    First-message greeting: {autoReplyConfig?.greetingEnabled === false ? 'Off' : 'On'}
                  </Text>
                </Pressable>
                <TextInput
                  value={autoReplyConfig?.greetingText || ''}
                  onChangeText={(value) => setAutoReplyConfig((current) => ({ ...(current || {}), greetingText: value }))}
                  onBlur={() => void saveAutoReplyConfig({ greetingText: autoReplyConfig?.greetingText || '' })}
                  placeholder="Thanks for messaging us..."
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Text style={styles.lightSectionLabel}>AWAY MESSAGE</Text>
                <Pressable
                  style={styles.catalogChip}
                  onPress={() => void saveAutoReplyConfig({ awayEnabled: !autoReplyConfig?.awayEnabled })}
                >
                  <Text style={styles.catalogChipText}>
                    Away fallback: {autoReplyConfig?.awayEnabled === false ? 'Off' : 'On'}
                  </Text>
                </Pressable>
                <TextInput
                  value={autoReplyConfig?.awayText || ''}
                  onChangeText={(value) => setAutoReplyConfig((current) => ({ ...(current || {}), awayText: value }))}
                  onBlur={() => void saveAutoReplyConfig({ awayText: autoReplyConfig?.awayText || '' })}
                  placeholder="We are away right now..."
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Text style={styles.lightSectionLabel}>OPENING HOURS</Text>
                <TextInput
                  value={autoReplyConfig?.hoursText || ''}
                  onChangeText={(value) => setAutoReplyConfig((current) => ({ ...(current || {}), hoursText: value }))}
                  onBlur={() => void saveAutoReplyConfig({ hoursText: autoReplyConfig?.hoursText || '' })}
                  placeholder="Mon–Sat 9am–6pm"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <Text style={styles.lightSectionLabel}>FAQ RULES</Text>
                {(autoReplyConfig?.rules || []).map((rule) => (
                  <View key={rule.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{(rule.keywords || []).join(', ')}</Text>
                    <Text style={styles.sheetOptionBody}>{rule.response}</Text>
                    <Pressable style={styles.catalogChip} onPress={() => void removeAutoReplyRule(rule.id)}>
                      <Text style={styles.catalogChipText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
                <TextInput
                  value={autoReplyRuleDraft.keywords}
                  onChangeText={(value) => setAutoReplyRuleDraft((current) => ({ ...current, keywords: value }))}
                  placeholder="Keywords (comma separated)"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={autoReplyRuleDraft.response}
                  onChangeText={(value) => setAutoReplyRuleDraft((current) => ({ ...current, response: value }))}
                  placeholder="Fixed reply text"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Pressable style={styles.sendButtonWide} onPress={() => void addAutoReplyRule()}>
                  <Text style={styles.sendButtonText}>Add rule</Text>
                </Pressable>
                <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>RECENT ACTIVITY</Text>
                {autoReplyLogs.length ? null : (
                  <Text style={styles.sheetOptionBody}>No automated replies logged yet.</Text>
                )}
                {autoReplyLogs.slice(0, 12).map((log) => (
                  <View key={log.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{log.source}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {new Date(log.createdAt).toLocaleString()} · chat {log.chatId}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {businessPanel === 'businessai' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.cardBody}>
                  Policy- and FAQ-backed answers only. Replies are labeled Automated and never auto-send.
                </Text>
                <Pressable
                  style={[styles.sendButtonWide, businessAiBusy ? styles.aiAssistButtonBusy : null]}
                  disabled={businessAiBusy}
                  onPress={() => void saveBusinessAiConfig({ enabled: !businessAiConfig?.enabled })}
                >
                  <Text style={styles.sendButtonText}>
                    {businessAiConfig?.enabled ? 'Pause Business AI' : 'Enable Business AI'}
                  </Text>
                </Pressable>
                <Text style={styles.lightSectionLabel}>BUSINESS POLICY</Text>
                <TextInput
                  value={businessAiConfig?.policyText || ''}
                  onChangeText={(value) => setBusinessAiConfig((current) => ({ ...(current || {}), policyText: value }))}
                  onBlur={() => void saveBusinessAiConfig({ policyText: businessAiConfig?.policyText || '' })}
                  placeholder="What customers should know about your shop"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Text style={styles.lightSectionLabel}>DELIVERY POLICY</Text>
                <TextInput
                  value={businessAiConfig?.deliveryPolicy || ''}
                  onChangeText={(value) => setBusinessAiConfig((current) => ({ ...(current || {}), deliveryPolicy: value }))}
                  onBlur={() => void saveBusinessAiConfig({ deliveryPolicy: businessAiConfig?.deliveryPolicy || '' })}
                  placeholder="Delivery areas, timing, fees"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Text style={styles.lightSectionLabel}>REFUND POLICY</Text>
                <TextInput
                  value={businessAiConfig?.refundPolicy || ''}
                  onChangeText={(value) => setBusinessAiConfig((current) => ({ ...(current || {}), refundPolicy: value }))}
                  onBlur={() => void saveBusinessAiConfig({ refundPolicy: businessAiConfig?.refundPolicy || '' })}
                  placeholder="Returns and refunds"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Text style={styles.lightSectionLabel}>FAQ</Text>
                {(businessAiConfig?.faq || []).map((item, index) => (
                  <View key={`${item.question}-${index}`} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{item.question}</Text>
                    <Text style={styles.sheetOptionBody}>{item.answer}</Text>
                    <Pressable style={styles.catalogChip} onPress={() => void removeBusinessAiFaq(index)}>
                      <Text style={styles.catalogChipText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
                <TextInput
                  value={businessAiFaqDraft.question}
                  onChangeText={(value) => setBusinessAiFaqDraft((current) => ({ ...current, question: value }))}
                  placeholder="FAQ question"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <TextInput
                  value={businessAiFaqDraft.answer}
                  onChangeText={(value) => setBusinessAiFaqDraft((current) => ({ ...current, answer: value }))}
                  placeholder="Approved answer"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Pressable style={styles.sendButtonWide} onPress={() => void addBusinessAiFaq()}>
                  <Text style={styles.sendButtonText}>Add FAQ</Text>
                </Pressable>
                <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>TEST ASK</Text>
                <TextInput
                  value={businessAiAskDraft}
                  onChangeText={setBusinessAiAskDraft}
                  placeholder="Ask as a customer would…"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                  multiline
                />
                <Pressable
                  style={[styles.sendButtonWide, businessAiBusy ? styles.aiAssistButtonBusy : null]}
                  disabled={businessAiBusy || !businessAiAskDraft.trim()}
                  onPress={() => void askBusinessAi()}
                >
                  <Text style={styles.sendButtonText}>{businessAiBusy ? 'Asking…' : 'Ask Business AI'}</Text>
                </Pressable>
                {businessAiAskResult ? (
                  <View style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>Automated</Text>
                    <Text style={styles.sheetOptionBody}>{businessAiAskResult.answer}</Text>
                    <Text style={styles.summaryNotice}>
                      {businessAiAskResult.escalate ? 'Escalate: yes — hand to a human' : 'Escalate: no'}
                      {businessAiAskResult.confidence != null ? ` · confidence ${businessAiAskResult.confidence}` : ''}
                      {businessAiAskResult.source ? ` · ${businessAiAskResult.source}` : ''}
                    </Text>
                    {businessAiAskResult.disclosure ? (
                      <Text style={styles.summaryNotice}>{businessAiAskResult.disclosure}</Text>
                    ) : null}
                    {(businessAiAskResult.products || []).length ? (
                      <Text style={styles.summaryNotice}>
                        Products: {(businessAiAskResult.products || []).map((p) => p.title || p.name || p.id).join(', ')}
                      </Text>
                    ) : null}
                    <Text style={styles.summaryNotice}>autoSend: false — review before sending</Text>
                  </View>
                ) : null}
              </ScrollView>
            ) : null}

            {businessPanel === 'documents' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {selectedDocument ? (
                  <>
                    <Pressable
                      style={styles.catalogChip}
                      onPress={() => setSelectedDocument(null)}
                    >
                      <Text style={styles.catalogChipText}>Back to list</Text>
                    </Pressable>
                    <Text style={styles.sheetOptionTitle}>
                      {selectedDocument.number} · {selectedDocument.kind === 'invoice' ? 'Invoice' : 'Quote'}
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      {selectedDocument.customerName}
                      {selectedDocument.customerPhone ? ` · ${selectedDocument.customerPhone}` : ''}
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      {selectedDocument.state} · {moneyLabel(selectedDocument.totalAmount, selectedDocument.currency)}
                    </Text>
                    {(selectedDocument.lines || []).map((line) => (
                      <View key={line.id || `${line.title}-${line.quantity}`} style={styles.sheetOption}>
                        <Text style={styles.sheetOptionTitle}>{line.title}</Text>
                        <Text style={styles.sheetOptionBody}>
                          {line.quantity} × {moneyLabel(line.unitPrice, selectedDocument.currency)}
                          {' = '}
                          {moneyLabel(line.amount ?? (line.quantity * line.unitPrice), selectedDocument.currency)}
                        </Text>
                      </View>
                    ))}
                    {selectedDocument.notes ? (
                      <Text style={styles.sheetOptionBody}>Notes: {selectedDocument.notes}</Text>
                    ) : null}
                    {selectedDocument.expiresAt ? (
                      <Text style={styles.sheetOptionBody}>
                        Expires {new Date(selectedDocument.expiresAt).toLocaleString()}
                      </Text>
                    ) : null}
                    {selectedDocument.dueAt ? (
                      <Text style={styles.sheetOptionBody}>
                        Due {new Date(selectedDocument.dueAt).toLocaleString()}
                      </Text>
                    ) : null}
                    <View style={styles.catalogActionRow}>
                      {selectedDocument.sellerUserId === currentUserId
                        && ['draft', 'rejected'].includes(selectedDocument.state) ? (
                        <Pressable
                          style={styles.catalogChip}
                          onPress={() => void runDocumentAction(selectedDocument.id, 'send', {
                            chatId: selectedDocument.chatId || selectedChatId || undefined,
                          })}
                        >
                          <Text style={styles.catalogChipText}>Send</Text>
                        </Pressable>
                      ) : null}
                      {selectedDocument.state === 'sent'
                        && (selectedDocument.customerUserId === currentUserId
                          || selectedDocument.sellerUserId === currentUserId) ? (
                        <>
                          <Pressable
                            style={styles.catalogChip}
                            onPress={() => void runDocumentAction(selectedDocument.id, 'accept')}
                          >
                            <Text style={styles.catalogChipText}>Accept</Text>
                          </Pressable>
                          <Pressable
                            style={styles.catalogChip}
                            onPress={() => void runDocumentAction(selectedDocument.id, 'reject')}
                          >
                            <Text style={styles.catalogChipText}>Reject</Text>
                          </Pressable>
                        </>
                      ) : null}
                      {selectedDocument.sellerUserId === currentUserId
                        && selectedDocument.kind === 'quotation'
                        && ['sent', 'accepted'].includes(selectedDocument.state) ? (
                        <Pressable
                          style={styles.catalogChip}
                          onPress={() => void runDocumentAction(selectedDocument.id, 'convert')}
                        >
                          <Text style={styles.catalogChipText}>Convert to invoice</Text>
                        </Pressable>
                      ) : null}
                      {selectedDocument.sellerUserId === currentUserId
                        && selectedDocument.kind === 'invoice'
                        && selectedDocument.state !== 'paid'
                        && selectedDocument.state !== 'voided' ? (
                        <Pressable
                          style={styles.catalogChip}
                          onPress={() => void runDocumentAction(selectedDocument.id, 'mark-paid', {
                            markCashReceived: true,
                          })}
                        >
                          <Text style={styles.catalogChipText}>Mark paid (cash)</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={styles.catalogChip}
                        onPress={() => void openCommerceDocument(selectedDocument.id, { openPanel: false })}
                      >
                        <Text style={styles.catalogChipText}>Refresh</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardBody}>
                      Create a quotation or invoice, send it in chat, and track accept / pay states.
                    </Text>
                    <Text style={styles.lightSectionLabel}>NEW DOCUMENT</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                      {[
                        ['quotation', 'Quote'],
                        ['invoice', 'Invoice'],
                      ].map(([id, label]) => (
                        <Pressable
                          key={id}
                          style={[styles.marketFilterChip, documentForm.kind === id ? styles.marketFilterChipOn : null]}
                          onPress={() => setDocumentForm((current) => ({ ...current, kind: id }))}
                        >
                          <Text style={styles.marketFilterText}>{label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    <TextInput
                      value={documentForm.customerName}
                      onChangeText={(value) => setDocumentForm((current) => ({ ...current, customerName: value }))}
                      placeholder="Customer name"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <TextInput
                      value={documentForm.customerPhone}
                      onChangeText={(value) => setDocumentForm((current) => ({ ...current, customerPhone: value }))}
                      placeholder="Customer phone (optional)"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                      keyboardType="phone-pad"
                    />
                    <TextInput
                      value={documentForm.lineTitle}
                      onChangeText={(value) => setDocumentForm((current) => ({ ...current, lineTitle: value }))}
                      placeholder="Line item title"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <View style={styles.documentFormRow}>
                      <TextInput
                        value={documentForm.lineQty}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, lineQty: value }))}
                        placeholder="Qty"
                        placeholderTextColor="#7d8b92"
                        style={[styles.input, styles.documentFormHalf]}
                        keyboardType="decimal-pad"
                      />
                      <TextInput
                        value={documentForm.linePrice}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, linePrice: value }))}
                        placeholder={`Unit price (${accountCurrency})`}
                        placeholderTextColor="#7d8b92"
                        style={[styles.input, styles.documentFormHalf]}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={styles.documentFormRow}>
                      <TextInput
                        value={documentForm.discountAmount}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, discountAmount: value }))}
                        placeholder="Discount (optional)"
                        placeholderTextColor="#7d8b92"
                        style={[styles.input, styles.documentFormHalf]}
                        keyboardType="decimal-pad"
                      />
                      <TextInput
                        value={documentForm.taxAmount}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, taxAmount: value }))}
                        placeholder="Tax (optional)"
                        placeholderTextColor="#7d8b92"
                        style={[styles.input, styles.documentFormHalf]}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <TextInput
                      value={documentForm.notes}
                      onChangeText={(value) => setDocumentForm((current) => ({ ...current, notes: value }))}
                      placeholder="Notes (optional)"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                      multiline
                    />
                    {documentForm.kind === 'quotation' ? (
                      <TextInput
                        value={documentForm.expiresAt}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, expiresAt: value }))}
                        placeholder="Expiry (ISO date, optional)"
                        placeholderTextColor="#7d8b92"
                        style={styles.input}
                      />
                    ) : (
                      <TextInput
                        value={documentForm.dueAt}
                        onChangeText={(value) => setDocumentForm((current) => ({ ...current, dueAt: value }))}
                        placeholder="Due date (ISO date, optional)"
                        placeholderTextColor="#7d8b92"
                        style={styles.input}
                      />
                    )}
                    <Pressable style={styles.sendButtonWide} onPress={() => void createCommerceDocument({ sendNow: false })}>
                      <Text style={styles.sendButtonText}>Save draft</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.sendButtonWide, { marginTop: 10 }]}
                      onPress={() => void createCommerceDocument({ sendNow: true })}
                    >
                      <Text style={styles.sendButtonText}>Save & send</Text>
                    </Pressable>
                    <Text style={[styles.lightSectionLabel, { marginTop: 16 }]}>YOUR DOCUMENTS</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                      {[
                        ['all', 'All'],
                        ['quotation', 'Quotes'],
                        ['invoice', 'Invoices'],
                      ].map(([id, label]) => (
                        <Pressable
                          key={id}
                          style={[styles.marketFilterChip, documentKindFilter === id ? styles.marketFilterChipOn : null]}
                          onPress={() => {
                            setDocumentKindFilter(id);
                            void loadCommerceDocuments(currentUserId, id === 'all' ? '' : id);
                          }}
                        >
                          <Text style={styles.marketFilterText}>{label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    <Pressable style={styles.catalogChip} onPress={() => void loadCommerceDocuments(currentUserId, documentKindFilter === 'all' ? '' : documentKindFilter)}>
                      <Text style={styles.catalogChipText}>Refresh</Text>
                    </Pressable>
                    {commerceDocuments.length ? null : (
                      <Text style={styles.sheetOptionBody}>No documents yet.</Text>
                    )}
                    {commerceDocuments.map((doc) => (
                      <Pressable
                        key={doc.id}
                        style={styles.sheetOption}
                        onPress={() => setSelectedDocument(doc)}
                      >
                        <Text style={styles.sheetOptionTitle}>
                          {doc.number} · {doc.kind === 'invoice' ? 'Invoice' : 'Quote'}
                        </Text>
                        <Text style={styles.sheetOptionBody}>
                          {doc.customerName} · {doc.state}
                        </Text>
                        <Text style={styles.sheetOptionBody}>
                          {moneyLabel(doc.totalAmount, doc.currency)}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </ScrollView>
            ) : null}

            {businessPanel === 'broadcast' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.cardBody}>
                  Marketing always requires opt-in — even for “all customers”. Segments only include opted-in people.
                </Text>
                <Text style={styles.lightSectionLabel}>AUDIENCE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                  {[
                    ['opted_in', 'Opted in', broadcastAudiencePreview.opted_in],
                    ['repeat_buyers', 'Repeat buyers', broadcastAudiencePreview.repeat_buyers],
                    ['all_customers', 'All customers', broadcastAudiencePreview.all_customers],
                  ].map(([id, label, count]) => (
                    <Pressable
                      key={id}
                      style={[styles.marketFilterChip, broadcastSegment === id ? styles.marketFilterChipOn : null]}
                      onPress={() => setBroadcastSegment(id)}
                    >
                      <Text style={styles.marketFilterText}>{label} · {count}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <TextInput
                  value={broadcastDraft}
                  onChangeText={setBroadcastDraft}
                  placeholder="Hi customers — new arrivals just dropped..."
                  placeholderTextColor="#7d8b92"
                  multiline
                  style={styles.textArea}
                />
                <Pressable style={styles.sendButtonWide} onPress={() => void sendBroadcast()}>
                  <Text style={styles.sendButtonText}>Send broadcast</Text>
                </Pressable>
                <Pressable style={[styles.catalogChip, { marginTop: 12 }]} onPress={() => void loadBroadcastCampaigns()}>
                  <Text style={styles.catalogChipText}>Refresh campaigns</Text>
                </Pressable>
                <Text style={[styles.lightSectionLabel, { marginTop: 16 }]}>CAMPAIGN HISTORY</Text>
                {broadcastCampaigns.length ? null : (
                  <Text style={styles.sheetOptionBody}>No campaigns yet.</Text>
                )}
                {broadcastCampaigns.map((campaign) => (
                  <View key={campaign.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle} numberOfLines={2}>{campaign.text}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {campaign.status} · {campaign.segment}
                      {' · '}
                      {campaign.sentCount || 0}/{campaign.audienceCount || 0} sent
                    </Text>
                    <Text style={styles.sheetOptionBody}>
                      {new Date(campaign.createdAt).toLocaleString()}
                    </Text>
                    {['draft', 'sending'].includes(campaign.status) ? (
                      <Pressable
                        style={styles.catalogChip}
                        onPress={() => void cancelBroadcastCampaign(campaign.id)}
                      >
                        <Text style={styles.catalogChipText}>Cancel</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(paySheet)}
        onRequestClose={() => setPaySheet('')}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>
                {paySheet === 'send'
                  ? 'Send money'
                  : paySheet === 'request'
                    ? 'Request money'
                    : paySheet === 'topup'
                      ? 'Top up wallet'
                      : paySheet === 'orders'
                        ? 'My orders'
                        : 'Payment history'}
              </Text>
              <Pressable onPress={() => setPaySheet('')}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            {paySheet === 'orders' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {commerceOrders.length ? null : (
                  <Text style={styles.cardBody}>No purchases yet. Order from a tagged status or product page.</Text>
                )}
                {commerceOrders.map((order) => {
                  const item = order.items?.[0];
                  return (
                    <Pressable key={order.id} style={styles.sheetOption} onPress={() => openOrderDetail(order)}>
                      <Text style={styles.sheetOptionTitle}>{item?.title || 'Order'}</Text>
                      <Text style={styles.sheetOptionBody}>
                        {orderStateLabel(order.state)} · {order.currency} {order.totalAmount}
                      </Text>
                      <Text style={styles.sheetOptionBody}>{new Date(order.createdAt).toLocaleString()}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {paySheet === 'history' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {payHistoryItems.length ? null : (
                  <Text style={styles.cardBody}>No payments yet.</Text>
                )}
                {payHistoryItems.map((item) => (
                  <View key={item.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                    <Text style={styles.sheetOptionBody}>{item.time} · {item.amount}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {paySheet && paySheet !== 'history' && paySheet !== 'orders' ? (
              <View>
                {(paySheet === 'send' || paySheet === 'request') ? (
                  <TextInput
                    value={payForm.phone}
                    onChangeText={(value) => setPayForm((current) => ({ ...current, phone: value }))}
                    placeholder="Phone number"
                    placeholderTextColor="#7d8b92"
                    keyboardType="phone-pad"
                    style={styles.input}
                  />
                ) : null}
                <TextInput
                  value={payForm.amount}
                  onChangeText={(value) => setPayForm((current) => ({ ...current, amount: value }))}
                  placeholder={`Amount (${accountCurrency})`}
                  placeholderTextColor="#7d8b92"
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
                <TextInput
                  value={payForm.note}
                  onChangeText={(value) => setPayForm((current) => ({ ...current, note: value }))}
                  placeholder="Note (optional)"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <Text style={styles.cardMeta}>
                  Provider keys can be added later. The flow is wired to `/api/payments/intent`.
                </Text>
                <Pressable style={styles.sendButtonWide} onPress={() => void submitPayAction()}>
                  <Text style={styles.sendButtonText}>
                    {paySheet === 'send' ? 'Send' : paySheet === 'request' ? 'Request' : 'Top up'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(orderDetail)}
        onRequestClose={() => setOrderDetail(null)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Order details</Text>
              <Pressable onPress={() => setOrderDetail(null)}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            {orderDetail ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.sheetOptionTitle}>{orderDetail.items?.[0]?.title || 'Order'}</Text>
                <Text style={styles.sheetOptionBody}>{orderDetail.id}</Text>
                <Text style={styles.sheetOptionBody}>
                  {orderStateLabel(orderDetail.state)} · {orderDetail.currency} {orderDetail.totalAmount}
                </Text>
                <Text style={styles.sheetOptionBody}>
                  Qty {orderDetail.items?.[0]?.quantity || 1}
                  {(orderDetail.items?.[0]?.variantSelections || []).length
                    ? ` · ${(orderDetail.items[0].variantSelections || []).map((entry) => `${entry.name}: ${entry.option}`).join(', ')}`
                    : ''}
                </Text>
                <Text style={styles.sheetOptionBody}>
                  {orderDetail.sellerUserId === currentUserId ? 'You are the seller' : 'You are the buyer'}
                </Text>
                {orderDetail.deliveryReference ? (
                  <Text style={styles.sheetOptionBody}>
                    Delivery ref: {orderDetail.deliveryReference}
                  </Text>
                ) : null}
                {orderDetail.fulfilmentNote ? (
                  <Text style={styles.sheetOptionBody}>
                    Fulfilment note: {orderDetail.fulfilmentNote}
                  </Text>
                ) : null}
                {orderDetail.sellerUserId === currentUserId
                  && (orderDetail.state === 'processing' || orderDetail.state === 'dispatched') ? (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={styles.lightSectionLabel}>DELIVERY TRACKING</Text>
                    <TextInput
                      value={orderDeliveryDraft.deliveryReference}
                      onChangeText={(value) => setOrderDeliveryDraft((current) => ({
                        ...current,
                        deliveryReference: value,
                      }))}
                      placeholder="Delivery reference / tracking #"
                      placeholderTextColor="#7d8b92"
                      style={styles.input}
                    />
                    <TextInput
                      value={orderDeliveryDraft.fulfilmentNote}
                      onChangeText={(value) => setOrderDeliveryDraft((current) => ({
                        ...current,
                        fulfilmentNote: value,
                      }))}
                      placeholder="Fulfilment note"
                      placeholderTextColor="#7d8b92"
                      multiline
                      style={[styles.input, styles.textArea]}
                    />
                  </View>
                ) : null}
                {orderDetail.receiptId ? (
                  <Pressable
                    style={[styles.sendButtonWide, { marginTop: 12 }]}
                    onPress={() => void openSaleReceipt(orderDetail.receiptId)}
                  >
                    <Text style={styles.sendButtonText}>View receipt</Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.sheetOptionBody, { marginTop: 8 }]}>
                    Receipt appears after payment is confirmed.
                  </Text>
                )}
                <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>HISTORY</Text>
                {(orderDetail.history || []).slice().reverse().map((entry, index) => (
                  <Text key={`${entry.at}-${index}`} style={styles.sheetOptionBody}>
                    {orderStateLabel(entry.state)} · {new Date(entry.at).toLocaleString()}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </Text>
                ))}
                <View style={[styles.catalogActionRow, { marginTop: 16 }]}>
                  {[...sellerOrderActions(orderDetail), ...buyerOrderActions(orderDetail)].map(([state, label]) => (
                    <Pressable
                      key={state}
                      style={styles.catalogChip}
                      onPress={() => runSellerOrderAction(orderDetail, state)}
                    >
                      <Text style={styles.catalogChipText}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                {orderDetail.buyerUserId === currentUserId || orderDetail.sellerUserId === currentUserId ? (
                  <Pressable
                    style={[styles.ghostButton, { marginTop: 10 }]}
                    onPress={() => {
                      const peerId = orderDetail.sellerUserId === currentUserId
                        ? orderDetail.buyerUserId
                        : orderDetail.sellerUserId;
                      setOrderDetail(null);
                      setBusinessPanel('');
                      setPaySheet('');
                      void createDirectChat(peerId);
                    }}
                  >
                    <Text style={styles.ghostButtonText}>Open chat</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="slide"
        visible={Boolean(receiptDetail)}
        onRequestClose={() => setReceiptDetail(null)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Receipt</Text>
              <Pressable onPress={() => setReceiptDetail(null)}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            {receiptDetail ? (
              <ScrollView style={styles.businessPanelScroll}>
                <Text style={styles.sheetOptionTitle}>{receiptDetail.receiptNumber}</Text>
                <Text style={styles.sheetOptionBody}>{receiptDetail.businessName || receiptDetail.sellerName}</Text>
                <Text style={styles.sheetOptionBody}>Buyer: {receiptDetail.buyerName}</Text>
                <Text style={styles.sheetOptionBody}>
                  {receiptDetail.state} · {new Date(receiptDetail.issuedAt || receiptDetail.createdAt).toLocaleString()}
                </Text>
                <Text style={[styles.lightSectionLabel, { marginTop: 12 }]}>ITEMS</Text>
                {(receiptDetail.items || []).map((item, index) => (
                  <Text key={`${item.catalogItemId}-${index}`} style={styles.sheetOptionBody}>
                    {item.title} x{item.quantity} · {item.currency} {item.price}
                    {(item.variantSelections || []).length
                      ? ` · ${(item.variantSelections || []).map((entry) => `${entry.name}: ${entry.option}`).join(', ')}`
                      : ''}
                  </Text>
                ))}
                <Text style={[styles.sheetOptionTitle, { marginTop: 12 }]}>
                  Total {receiptDetail.currency} {receiptDetail.totalAmount}
                </Text>
                <Text style={styles.sheetOptionBody}>
                  Payment: {receiptDetail.paymentMethod} · {receiptDetail.paymentReference}
                </Text>
                <View style={[styles.catalogActionRow, { marginTop: 16 }]}>
                  <Pressable
                    style={styles.sendButtonWide}
                    onPress={() => void Share.share({ message: formatSaleReceiptShare(receiptDetail) })}
                  >
                    <Text style={styles.sendButtonText}>Share receipt</Text>
                  </Pressable>
                  {receiptDetail.orderId ? (
                    <Pressable
                      style={styles.ghostButton}
                      onPress={() => {
                        const order = commerceOrders.find((entry) => entry.id === receiptDetail.orderId);
                        setReceiptDetail(null);
                        if (order) openOrderDetail(order);
                      }}
                    >
                      <Text style={styles.ghostButtonText}>Open order</Text>
                    </Pressable>
                  ) : null}
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={newChatVisible}
        onRequestClose={() => setNewChatVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setNewChatVisible(false)}>
          <Pressable style={[styles.dialog, styles.newChatDialog]} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>New chat</Text>
            <Text style={styles.cardBody}>Contacts on ZynkUP from your phone book</Text>
            <TextInput
              value={newChatQuery}
              onChangeText={setNewChatQuery}
              placeholder="Search name or phone"
              placeholderTextColor="#7d8b92"
              style={styles.input}
            />
            <View style={styles.catalogActionRow}>
              <TextInput
                value={newChatNumber}
                onChangeText={setNewChatNumber}
                placeholder="Message a number, even if it is not saved"
                placeholderTextColor="#7d8b92"
                keyboardType="phone-pad"
                style={[styles.input, { flex: 1 }]}
              />
              <Pressable style={styles.catalogChip} onPress={() => void openPhoneLink(newChatNumber)}>
                <Text style={styles.catalogChipText}>Find</Text>
              </Pressable>
            </View>
            <View style={styles.catalogActionRow}>
              <Pressable style={styles.catalogChip} onPress={() => { setRoomPicking(false); setRoomSelection([]); }}>
                <Text style={styles.catalogChipText}>Chat</Text>
              </Pressable>
              <Pressable style={styles.catalogChip} onPress={() => setRoomPicking(true)}>
                <Text style={styles.catalogChipText}>Chat room</Text>
              </Pressable>
            </View>
            {roomPicking ? (
              <TextInput
                value={roomTitle}
                onChangeText={setRoomTitle}
                placeholder="Room name"
                placeholderTextColor="#7d8b92"
                style={styles.input}
              />
            ) : null}
            <ScrollView style={styles.newChatList}>
              {(() => {
                const query = newChatQuery.trim().toLowerCase();
                const registeredContacts = contactItems.filter((contact) => contact.registered && contact.linkedUserId);
                const unique = [];
                const seen = new Set();
                registeredContacts.forEach((contact) => {
                  if (!contact.linkedUserId || seen.has(contact.linkedUserId) || contact.linkedUserId === currentUserId) {
                    return;
                  }
                  seen.add(contact.linkedUserId);
                  unique.push(contact);
                });
                const selfRow = currentUserId ? [{
                  id: `self-${currentUserId}`,
                  name: 'Message yourself',
                  phone: 'Notes, lists, and files',
                  linkedUserId: currentUserId,
                }] : [];
                const rows = [...(roomPicking ? [] : selfRow), ...unique].filter((entry) => {
                  if (!query) return true;
                  return (
                    entry.name?.toLowerCase().includes(query)
                    || String(entry.phone || '').toLowerCase().includes(query)
                  );
                });

                if (!rows.length) {
                  return (
                    <View style={styles.emptyChatCard}>
                      <Text style={styles.cardBody}>
                        No registered contacts yet. Sync your phone book after signing in, or invite friends to ZynkUP.
                      </Text>
                      <Pressable style={styles.sendButtonWide} onPress={() => void syncPhoneContacts(currentUserId)}>
                        <Text style={styles.sendButtonText}>Sync phone book</Text>
                      </Pressable>
                    </View>
                  );
                }

                return rows.map((entry) => (
                  <View key={entry.id} style={styles.contactPickRow}>
                    {renderPersonAvatar({
                      userId: entry.linkedUserId,
                      name: entry.name,
                      size: 44,
                      onPress: () => onAvatarPress(entry.linkedUserId, entry.name),
                    })}
                    <Pressable
                      style={styles.contactPickCopy}
                      onPress={() => {
                        if (roomPicking) {
                          setRoomSelection((current) => (
                            current.includes(entry.linkedUserId)
                              ? current.filter((id) => id !== entry.linkedUserId)
                              : [...current, entry.linkedUserId]
                          ));
                          return;
                        }
                        setNewChatVisible(false);
                        void createDirectChat(entry.linkedUserId);
                      }}
                    >
                      <Text style={styles.sheetOptionTitle}>
                        {roomSelection.includes(entry.linkedUserId) ? '✓ ' : ''}{entry.name}
                      </Text>
                      <Text style={styles.sheetOptionBody}>
                        {entry.linkedUserId === currentUserId
                          ? 'Message yourself'
                          : `${entry.phone} · ${entry.presence === 'online' ? 'Online' : 'On ZynkUP'}`}
                      </Text>
                    </Pressable>
                  </View>
                ));
              })()}
            </ScrollView>
            {roomPicking ? (
              <Pressable
                style={styles.sendButtonWide}
                onPress={() => {
                  if (roomSelection.length < 1) {
                    showToast('A chat room needs at least 2 people. Pick someone to add.', 'error');
                    return;
                  }
                  void (async () => {
                    const response = await fetch(`${API_BASE_URL}/api/chats/rooms`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        userId: currentUserId,
                        title: roomTitle.trim() || 'Chat room',
                        memberIds: roomSelection,
                      }),
                    });
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok || !payload.chat) {
                      showToast(payload.error || 'Could not create the chat room.', 'error');
                      return;
                    }
                    const mappedChat = mapChatFromServer(payload.chat, currentUserId, usersById);
                    setChatItems((current) => [mappedChat, ...current.filter((item) => item.id !== mappedChat.id)]);
                    setSelectedChatId(mappedChat.id);
                    setChatScreen('detail');
                    setNewChatVisible(false);
                    setRoomPicking(false);
                    setRoomSelection([]);
                    setRoomTitle('');
                  })();
                }}
              >
                <Text style={styles.sendButtonText}>Create chat room ({roomSelection.length})</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="slide"
        visible={Boolean((incomingCall || activeCall) && !(callMinimized && activeCall?.state === 'ongoing'))}
        onRequestClose={() => undefined}
      >
        {(() => {
          const call = activeCall || incomingCall;
          if (!call) {
            return null;
          }
          const localUrl = localCallStream?.toURL?.() || '';
          const remoteUrl = remoteCallStream?.toURL?.() || '';
          const videoTrackLive = (stream) => Boolean(stream?.getVideoTracks?.().some((track) => track.enabled && track.readyState === 'live' && !track.muted));
          const localVideoLive = videoTrackLive(localCallStream) && !callCameraOff;
          const remoteVideoLive = videoTrackLive(remoteCallStream) && !remoteCameraOff;
          const mainIsLocal = localVideoLarge || !remoteVideoLive;
          const mainUrl = mainIsLocal ? localUrl : remoteUrl;
          const pipIsLocal = !mainIsLocal;
          const pipUrl = (localVideoLive || remoteVideoLive) && localUrl && remoteUrl ? (pipIsLocal ? localUrl : remoteUrl) : '';
          const mainVideoLive = mainIsLocal ? localVideoLive : remoteVideoLive;
          const pipVideoLive = pipUrl ? (pipIsLocal ? localVideoLive : remoteVideoLive) : false;
          const stageUserId = mainIsLocal ? currentUserId : call.peerUserId;
          const canAnswer = call.state === 'ringing' && call.initiatorId !== currentUserId;
          const peerOnline = usersById[call.peerUserId]?.presence === 'online' || callPhase === 'ringing';
          const callerPhase = call.initiatorId === currentUserId ? (peerOnline ? 'Ringing' : 'Calling...') : 'Incoming call';
          const remoteLive = Boolean(remoteCallStream?.getTracks?.()?.some((track) => track.readyState === 'live' && track.enabled));
          const photoUri = photoForUser(stageUserId) || photoForUser(call.peerUserId);
          const stageName = mainIsLocal ? (profile.name || 'You') : (call.name || '?');
          return (
            <Pressable style={styles.callScreen} onPress={revealCallControls}>
              {call.kind === 'Video' && mainUrl && mainVideoLive && RTCViewNative && !phoneLocked ? (
                <RTCViewNative streamURL={mainUrl} style={styles.callStageMain} objectFit="cover" mirror={mainIsLocal} />
              ) : (
                <View style={styles.callStageMain}>
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.callFullPhoto} resizeMode="cover" />
                  ) : (
                    <View style={styles.callFullPhotoFallback}>
                      <Text style={styles.callFullPhotoLetter}>{stageName.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              )}
              {call.kind === 'Video' && pipUrl && RTCViewNative && !phoneLocked ? (
                <Pressable style={styles.callStagePip} onPress={() => setLocalVideoLarge((current) => !current)}>
                  {pipVideoLive ? (
                    <RTCViewNative streamURL={pipUrl} style={styles.callStagePipVideo} objectFit="cover" mirror={pipIsLocal} />
                  ) : (
                    <View style={styles.callStagePipVideo}>
                      <Text style={styles.callFullPhotoLetter}>{(pipIsLocal ? profile.name : call.name || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                </Pressable>
              ) : null}
              {callControlsVisible || call.state !== 'ongoing' || call.kind !== 'Video' ? (
              <View style={styles.callScreenTop}>
                <Text style={styles.callScreenName}>{call.name}</Text>
                <Text style={styles.callScreenStatus}>
                  {call.state === 'ongoing'
                    ? `${getAudioDurationLabel(activeCallSeconds * 1000)} · ${remoteLive ? 'Connected' : 'Connecting'}`
                    : callerPhase}
                </Text>
                {callError ? <Text style={styles.callScreenError}>{callError}</Text> : null}
              </View>
              ) : null}
              {callControlsVisible || call.state !== 'ongoing' || call.kind !== 'Video' ? (
              <View style={styles.callScreenActions}>
                {(() => {
                  const answered = call.state === 'ongoing';
                  const videoCall = call.kind === 'Video';
                  const control = (label, onPress, enabled, active) => (
                    <Pressable
                      key={label}
                      disabled={!enabled}
                      style={[styles.callControl, active ? styles.callControlActive : null, enabled ? null : styles.callControlDisabled]}
                      onPress={() => {
                        if (!enabled) return;
                        if (phoneLocked && (label === 'Video' || label === 'Camera' || label === 'Cam off' || label === 'Flip')) {
                          if (CueSound?.promptUnlock) {
                            Promise.resolve(CueSound.promptUnlock()).then((unlocked) => {
                              setPhoneLocked(!unlocked);
                              if (!unlocked) showToast('Unlock the phone to use video.', 'info');
                            }).catch(() => showToast('Unlock the phone to use video.', 'info'));
                          } else {
                            showToast('Unlock the phone to use video.', 'info');
                          }
                          return;
                        }
                        onPress();
                      }}
                    >
                      <Text style={[styles.callControlText, enabled ? null : styles.callControlTextDisabled]}>{label}</Text>
                    </Pressable>
                  );
                  return (
                    <>
                      {control(callMuted ? 'Unmute' : 'Mute', () => setCallAudioMuted(!callMuted), answered, callMuted)}
                      {control(callSpeakerOn ? 'Speaker' : 'Earpiece', () => setCallSpeaker(!callSpeakerOn), true, callSpeakerOn)}
                      {videoCall
                        ? control(callCameraOff ? 'Camera' : 'Cam off', () => setCallVideoEnabled(callCameraOff), true, callCameraOff)
                        : control('Video', () => {
                          emitCallSignal(call.id, 'video-upgrade', { from: currentUserId }, call.peerUserId);
                          showToast('Asked them to switch to video.', 'info');
                        }, answered, false)}
                      {videoCall ? control('Flip', flipCallCamera, answered, false) : null}
                      {videoCall ? control('Share', () => void shareCallScreen(), answered, false) : null}
                      {control('Add', () => setCallInviteVisible(true), answered, false)}
                      {control('Min', () => setCallMinimized(true), answered, false)}
                    </>
                  );
                })()}
                {canAnswer ? (
                  <Pressable style={[styles.callRoundButton, styles.callAnswerButton]} onPress={() => void acceptIncomingCall()}>
                    <Text style={styles.callRoundButtonText}>Answer</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.callRoundButton, styles.callEndButton]}
                  onPress={() => {
                    if (canAnswer && incomingCall) {
                      void updateCallState(incomingCall.id, 'declined', 0);
                      return;
                    }
                    void endActiveCall();
                  }}
                >
                  <Text style={styles.callRoundButtonText}>{call.state === 'ongoing' ? 'End' : 'Cancel'}</Text>
                </Pressable>
              </View>
              ) : null}
            </Pressable>
          );
        })()}
      </Modal>
      <Modal transparent animationType="fade" visible={chatMenuVisible} onRequestClose={() => setChatMenuVisible(false)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setChatMenuVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{activeChat?.name || 'Chat'}</Text>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setChatMenuVisible(false);
                openAiHelperSheet('suggest_reply');
              }}
            >
              <Text style={styles.sheetOptionTitle}>AI helper</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setChatMenuVisible(false);
                void requestChatSummary('unread');
              }}
            >
              <Text style={styles.sheetOptionTitle}>Summarise unread</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setChatMenuVisible(false);
                void requestChatSummary('recent');
              }}
            >
              <Text style={styles.sheetOptionTitle}>Summarise recent</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { setChatMenuVisible(false); toggleLockChat(activeChat.id); if (lockedChatIds.includes(activeChat?.id)) setChatScreen('list'); }}>
              <Text style={styles.sheetOptionTitle}>{lockedChatIds.includes(activeChat?.id) ? 'Unlock chat' : 'Lock chat'}</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                const current = Number(activeChat?.disappearAfterSeconds || 0);
                const next = current === 0 ? 86400 : current === 86400 ? 604800 : current === 604800 ? 7776000 : 0;
                setChatMenuVisible(false);
                void setChatDisappear(activeChat.id, next);
              }}
            >
              <Text style={styles.sheetOptionTitle}>
                Disappearing · {
                  Number(activeChat?.disappearAfterSeconds || 0) === 0
                    ? 'Off'
                    : Number(activeChat?.disappearAfterSeconds) === 86400
                      ? '24 hours'
                      : Number(activeChat?.disappearAfterSeconds) === 604800
                        ? '7 days'
                        : '90 days'
                }
              </Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { setChatMenuVisible(false); toggleMuteChat(activeChat.id); }}>
              <Text style={styles.sheetOptionTitle}>{mutedChatIds.includes(activeChat?.id) ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { setChatMenuVisible(false); toggleArchiveChat(activeChat.id); setChatScreen('list'); }}>
              <Text style={styles.sheetOptionTitle}>{archivedChatIds.includes(activeChat?.id) ? 'Unarchive' : 'Archive'}</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { setChatMenuVisible(false); toggleFavoriteChat(activeChat.id); }}>
              <Text style={styles.sheetOptionTitle}>{favoriteChatIds.includes(activeChat?.id) ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
            {activeChat?.kind === 'group' ? (
              <Pressable style={styles.sheetOption} onPress={() => {
                setGroupTitleDraft(activeChat.name || '');
                setChatMenuVisible(false);
                setGroupInfoVisible(true);
              }}>
                <Text style={styles.sheetOptionTitle}>Group info</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.sheetOption} onPress={() => {
              const next = chatWallpaper === 'zynkup' ? 'night' : chatWallpaper === 'night' ? 'plain' : 'zynkup';
              setChatWallpaper(next);
              void AsyncStorage.setItem(WALLPAPER_KEY, next);
              setChatMenuVisible(false);
            }}>
              <Text style={styles.sheetOptionTitle}>Wallpaper · {chatWallpaper === 'zynkup' ? 'ZynkUP' : chatWallpaper === 'night' ? 'Night' : 'Light'}</Text>
            </Pressable>
            <Pressable style={styles.sheetBack} onPress={() => setChatMenuVisible(false)}>
              <Text style={styles.sheetBackText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={summarySheetVisible}
        onRequestClose={() => setSummarySheetVisible(false)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, styles.summarySheet, { paddingBottom: modalBottomInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Summarise</Text>
              <Pressable onPress={() => setSummarySheetVisible(false)}>
                <Text style={styles.sheetBackText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.aiToneRow}>
              {['unread', 'recent'].map((scope) => (
                <Pressable
                  key={scope}
                  style={[styles.aiToneChip, summaryScope === scope ? styles.aiToneChipActive : null]}
                  disabled={summaryBusy}
                  onPress={() => void requestChatSummary(scope)}
                >
                  <Text style={[styles.aiToneChipText, summaryScope === scope ? styles.aiToneChipTextActive : null]}>
                    {scope}
                  </Text>
                </Pressable>
              ))}
            </View>
            {summaryBusy && !summaryResult ? (
              <ActivityIndicator color="#8fd6c4" />
            ) : null}
            <ScrollView style={styles.summaryScroll} contentContainerStyle={styles.summaryScrollContent}>
              {summaryResult?.summary?.overview ? (
                <Text style={styles.summaryOverview}>{summaryResult.summary.overview}</Text>
              ) : null}
              {summaryResult?.summary?.notice || summaryResult?.summary ? (
                <Text style={styles.summaryNotice}>
                  {summaryResult?.summary?.notice
                    || 'Action items are suggestions only. Review the chat before acting.'}
                </Text>
              ) : null}
              {[
                { key: 'questions', title: 'Questions' },
                { key: 'decisions', title: 'Decisions' },
                { key: 'actionSuggestions', title: 'Action suggestions' },
                { key: 'highlights', title: 'Highlights' },
              ].map((section) => {
                const items = summaryResult?.summary?.[section.key] || [];
                if (!items.length) {
                  return null;
                }
                return (
                  <View key={section.key} style={styles.summarySection}>
                    <Text style={styles.summarySectionTitle}>{section.title}</Text>
                    {items.map((item) => (
                      <Pressable
                        key={`${section.key}-${item.messageId}-${item.sentAt}`}
                        style={styles.summaryItem}
                        onPress={() => {
                          setSummarySheetVisible(false);
                          scrollToMessageId(item.messageId);
                        }}
                      >
                        <Text style={styles.summaryItemText}>{item.text}</Text>
                        <Text style={styles.summaryItemMeta}>
                          {displayNameFor(item.senderId, 'Member')} · tap to jump
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
              {!summaryBusy && summaryResult?.summary && !(
                (summaryResult.summary.questions || []).length
                || (summaryResult.summary.decisions || []).length
                || (summaryResult.summary.actionSuggestions || []).length
                || (summaryResult.summary.highlights || []).length
              ) ? (
                <Text style={styles.summaryNotice}>No extractable items in this scope.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={dictateSheetVisible}
        onRequestClose={() => setDictateSheetVisible(false)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset + keyboardInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Dictate</Text>
              <Pressable onPress={() => setDictateSheetVisible(false)}>
                <Text style={styles.sheetBackText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.summaryNotice}>
              Use your keyboard mic (on-device) to speak into the box below, or paste text. Review before send — dictation never sends automatically.
            </Text>
            <TextInput
              value={dictateDraft}
              onChangeText={setDictateDraft}
              placeholder="Speak or paste here…"
              placeholderTextColor="#7d8b92"
              multiline
              autoFocus
              textAlignVertical="top"
              style={styles.dictateInput}
            />
            <View style={styles.aiAssistRow}>
              <Pressable
                style={[styles.aiAssistButton, dictateBusy ? styles.aiAssistButtonBusy : null]}
                disabled={dictateBusy || !dictateDraft.trim()}
                onPress={() => void normalizeDictateDraft()}
              >
                <Text style={styles.aiAssistButtonText}>{dictateBusy ? '…' : 'Normalize'}</Text>
              </Pressable>
              <Pressable
                style={styles.aiAssistButton}
                disabled={!dictateDraft.trim()}
                onPress={() => useDictateInComposer(dictateDraft)}
              >
                <Text style={styles.aiAssistButtonText}>Use in draft</Text>
              </Pressable>
            </View>
            <Text style={styles.summaryNotice}>Label: review before send</Text>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={aiHelperSheetVisible}
        onRequestClose={() => setAiHelperSheetVisible(false)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, styles.summarySheet, { paddingBottom: modalBottomInset + keyboardInset }]}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>AI helper</Text>
              <Pressable onPress={() => setAiHelperSheetVisible(false)}>
                <Text style={styles.sheetBackText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.summaryScrollContent}>
              <Text style={styles.summaryNotice}>
                Pick a task, review the result, then put it in your draft. Nothing is sent automatically.
              </Text>
              <View style={styles.aiToneRow}>
                {[
                  ['draft', 'Draft'],
                  ['rewrite', 'Rewrite'],
                  ['summarise', 'Summarise'],
                  ['translate', 'Translate'],
                  ['suggest_reply', 'Suggest'],
                  ['explain', 'Explain'],
                ].map(([id, label]) => (
                  <Pressable
                    key={id}
                    style={[styles.aiToneChip, aiHelperTask === id ? styles.aiToneChipActive : null]}
                    onPress={() => {
                      setAiHelperTask(id);
                      setAiHelperPayload(null);
                    }}
                  >
                    <Text style={[styles.aiToneChipText, aiHelperTask === id ? styles.aiToneChipTextActive : null]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {(aiHelperTask === 'draft' || aiHelperTask === 'rewrite' || aiHelperTask === 'translate' || aiHelperTask === 'explain') ? renderToneMenu() : null}
              {aiHelperTask === 'translate' ? (
                <View style={styles.aiToneRow}>
                  {['en', 'tw', 'ga', 'ee', 'pcm'].map((code) => (
                    <Pressable
                      key={code}
                      style={[styles.aiToneChip, aiHelperTargetLang === code ? styles.aiToneChipActive : null]}
                      onPress={() => setAiHelperTargetLang(code)}
                    >
                      <Text style={[styles.aiToneChipText, aiHelperTargetLang === code ? styles.aiToneChipTextActive : null]}>
                        {code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <TextInput
                value={aiHelperPrompt}
                onChangeText={setAiHelperPrompt}
                placeholder={
                  aiHelperTask === 'draft'
                    ? 'Describe what to draft…'
                    : aiHelperTask === 'explain'
                      ? 'Text to explain…'
                      : 'Optional prompt or text…'
                }
                placeholderTextColor="#7d8b92"
                multiline
                textAlignVertical="top"
                style={styles.dictateInput}
              />
              <Pressable
                style={styles.settingsToggleRow}
                onPress={() => setAiHelperConsent((current) => !current)}
              >
                <View style={styles.settingsToggleCopy}>
                  <Text style={styles.settingsToggleLabel}>Share chat context</Text>
                  <Text style={styles.settingsToggleHelper}>
                    Required for suggest / summarise. Confirms consentToShareContext when chat is used.
                  </Text>
                </View>
                <Switch
                  value={aiHelperConsent}
                  onValueChange={setAiHelperConsent}
                  trackColor={{ false: '#3a4650', true: '#2f8f7b' }}
                  thumbColor={aiHelperConsent ? '#dff7f1' : '#d0d7dc'}
                />
              </Pressable>
              <View style={styles.aiAssistRow}>
                <Pressable
                  style={[styles.aiAssistButton, aiHelperBusy ? styles.aiAssistButtonBusy : null]}
                  disabled={aiHelperBusy}
                  onPress={() => void runAiHelper()}
                >
                  <Text style={styles.aiAssistButtonText}>{aiHelperBusy ? '…' : 'Run'}</Text>
                </Pressable>
                {aiHelperPayload?.result ? (
                  <Pressable
                    style={styles.aiAssistButton}
                    onPress={() => applyAiHelperToDraft(aiHelperPayload.result)}
                  >
                    <Text style={styles.aiAssistButtonText}>Use in draft</Text>
                  </Pressable>
                ) : null}
              </View>
              {aiHelperBusy && !aiHelperPayload ? (
                <ActivityIndicator color="#8fd6c4" />
              ) : null}
              {aiHelperPayload?.result ? (
                <Text style={styles.summaryOverview}>{aiHelperPayload.result}</Text>
              ) : null}
              {aiHelperPayload?.summary?.overview ? (
                <>
                  <Text style={styles.summaryOverview}>{aiHelperPayload.summary.overview}</Text>
                  <Pressable
                    style={styles.aiAssistButton}
                    onPress={() => applyAiHelperToDraft(aiHelperPayload.summary.overview)}
                  >
                    <Text style={styles.aiAssistButtonText}>Use summary in draft</Text>
                  </Pressable>
                </>
              ) : null}
              {(aiHelperPayload?.suggestions || []).length ? (
                <View style={styles.aiChipRow}>
                  {aiHelperPayload.suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion.id || suggestion.text}
                      style={styles.aiSuggestionChip}
                      onPress={() => applyAiHelperToDraft(suggestion.text)}
                    >
                      <Text numberOfLines={3} style={styles.aiSuggestionChipText}>{suggestion.text}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {aiHelperPayload?.notice ? (
                <Text style={styles.summaryNotice}>{aiHelperPayload.notice}</Text>
              ) : null}
              <Text style={styles.summaryNotice}>autoSend: false</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={Boolean(statusProductSheet)}
        onRequestClose={() => {
          setStatusProductSheet(null);
          setStatusProductSeller(null);
        }}
      >
        <View style={styles.peerProfileScreen}>
          <Pressable
            style={styles.viewerClose}
            onPress={() => {
              setStatusProductSheet(null);
              setStatusProductSeller(null);
            }}
          >
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          {statusProductSheet?.imageUrls?.[0] ? (
            <Image source={{ uri: statusProductSheet.imageUrls[0] }} style={styles.peerCatalogImage} />
          ) : null}
          <Text style={styles.peerProfileName}>{statusProductSheet?.title}</Text>
          <Text style={styles.peerProfileMeta}>
            {statusProductSheet?.currency} {statusProductSheet?.price}
            {statusProductSheet?.purchasable === false ? ' · Unavailable' : ''}
          </Text>
          <Text style={styles.peerProfileMeta}>
            {statusProductSeller?.businessName || statusProductSeller?.name || 'Seller'}
            {statusProductSeller?.verified ? ' ✓' : ''}
          </Text>
          <Text style={styles.peerProfileMeta}>{statusProductSheet?.description || ''}</Text>
          {(statusProductSheet?.variants || []).map((variant) => (
            <View key={variant.id || variant.name} style={{ marginBottom: 8, paddingHorizontal: 20 }}>
              <Text style={styles.lightSectionLabel}>{variant.name}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketFilterRow}>
                {(variant.options || []).map((option) => (
                  <Pressable
                    key={option}
                    style={[styles.marketFilterChip, statusVariantPicks[variant.name] === option ? styles.marketFilterChipOn : null]}
                    onPress={() => setStatusVariantPicks((current) => ({ ...current, [variant.name]: option }))}
                  >
                    <Text style={styles.marketFilterText}>{option}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}
          <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
            <TextInput
              value={statusOrderQuantity}
              onChangeText={(value) => setStatusOrderQuantity(value.replace(/[^\d]/g, '') || '1')}
              placeholder="Quantity"
              placeholderTextColor="#7d8b92"
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
          <View style={[styles.catalogActionRow, { paddingHorizontal: 20, marginTop: 8 }]}>
            {statusProductSheet?.sellerId && statusProductSheet.sellerId !== currentUserId ? (
              <Pressable
                style={styles.ghostButton}
                onPress={() => {
                  const sellerId = statusProductSheet.sellerId;
                  setStatusProductSheet(null);
                  setStatusProductSeller(null);
                  void createDirectChat(sellerId);
                }}
              >
                <Text style={styles.ghostButtonText}>Chat seller</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.sendButtonWide}
              onPress={() => void placeStatusProductOrder()}
            >
              <Text style={styles.sendButtonText}>
                {statusProductSheet?.purchasable === false ? 'Unavailable' : 'Order & pay'}
              </Text>
            </Pressable>
          </View>
          {statusProductSeller?.businessId ? (
            <Pressable
              style={[styles.ghostButton, { marginHorizontal: 20, marginTop: 10 }]}
              onPress={() => {
                const businessId = statusProductSeller.businessId;
                setStatusProductSheet(null);
                setStatusProductSeller(null);
                void openPublicBusiness(businessId);
              }}
            >
              <Text style={styles.ghostButtonText}>Open business storefront</Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={Boolean(publicBusinessView)}
        onRequestClose={() => {
          setPublicBusinessView(null);
          setPublicBusinessCatalog([]);
        }}
      >
        <View style={styles.peerProfileScreen}>
          <Pressable
            style={styles.viewerClose}
            onPress={() => {
              setPublicBusinessView(null);
              setPublicBusinessCatalog([]);
            }}
          >
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          {publicBusinessView?.logoUrl ? (
            <Image source={{ uri: publicBusinessView.logoUrl }} style={{ width: 96, height: 96, borderRadius: 48, marginBottom: 12 }} />
          ) : (
            renderPersonAvatar({ userId: publicBusinessView?.ownerUserId, name: publicBusinessView?.name, size: 96 })
          )}
          <Text style={styles.peerProfileName}>
            {publicBusinessView?.name || 'Business'}
            {publicBusinessView?.verified ? ' ✓' : ''}
          </Text>
          <Text style={styles.peerProfileMeta}>
            {publicBusinessView?.verified ? 'Verified business' : 'Business on ZynkUP'}
            {publicBusinessView?.location ? ` · ${publicBusinessView.location}` : ''}
          </Text>
          {publicBusinessView?.hours ? <Text style={styles.peerProfileMeta}>{publicBusinessView.hours}</Text> : null}
          <Text style={styles.peerProfileMeta}>{publicBusinessView?.description || 'No description yet.'}</Text>
          {publicBusinessView?.showPhone && publicBusinessView?.phone ? (
            <Text style={styles.peerProfileMeta}>{publicBusinessView.phone}</Text>
          ) : null}
          <View style={[styles.catalogActionRow, { paddingHorizontal: 20, marginTop: 8 }]}>
            {publicBusinessView?.ownerUserId && publicBusinessView.ownerUserId !== currentUserId ? (
              <Pressable
                style={styles.sendButtonWide}
                onPress={() => {
                  const ownerId = publicBusinessView.ownerUserId;
                  setPublicBusinessView(null);
                  setPublicBusinessCatalog([]);
                  void createDirectChat(ownerId);
                }}
              >
                <Text style={styles.sendButtonText}>{publicBusinessView?.contactButtonLabel || 'Chat'}</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView style={styles.peerCatalogList}>
            <Text style={styles.peerProfileName}>Products</Text>
            {publicBusinessCatalog.length ? null : (
              <Text style={styles.peerProfileMeta}>No public products yet.</Text>
            )}
            {publicBusinessCatalog.map((item) => (
              <View key={item.id} style={styles.peerCatalogCard}>
                {(item.imageUri || item.imageUrls?.[0]) ? (
                  <Image source={{ uri: item.imageUri || item.imageUrls[0] }} style={styles.peerCatalogImage} />
                ) : null}
                <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                <Text style={styles.sheetOptionBody}>
                  {item.currency ? `${item.currency} ${item.price}` : item.price}
                  {(item.status || 'active') === 'out_of_stock' ? ' · Out of stock' : ''}
                </Text>
                {(item.variants || []).length ? (
                  <Text style={styles.sheetOptionBody}>
                    {(item.variants || []).map((variant) => `${variant.name}: ${(variant.options || []).join(', ')}`).join(' · ')}
                  </Text>
                ) : null}
              </View>
            ))}
            {publicBusinessView?.ownerUserId && publicBusinessView.ownerUserId !== currentUserId ? (
              <View style={{ marginTop: 16, marginBottom: 28 }}>
                <Text style={styles.lightSectionLabel}>REPORT</Text>
                <TextInput
                  value={businessReportDraft}
                  onChangeText={setBusinessReportDraft}
                  placeholder="Why are you reporting this business?"
                  placeholderTextColor="#7d8b92"
                  multiline
                  style={styles.textArea}
                />
                <Pressable style={styles.ghostButton} onPress={() => void reportPublicBusiness()}>
                  <Text style={styles.ghostButtonText}>Report business</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
      <Modal transparent animationType="slide" visible={peerProfileVisible} onRequestClose={() => setPeerProfileVisible(false)}>
        <View style={styles.peerProfileScreen}>
          <Pressable style={styles.viewerClose} onPress={() => setPeerProfileVisible(false)}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const photoUri = photoForUser(activeChat?.peerUserId);
              if (photoUri) {
                setPhotoPreview({ uri: photoUri, name: activeChat?.name });
              }
            }}
          >
            {renderPersonAvatar({ userId: activeChat?.peerUserId, name: activeChat?.name, size: 140 })}
          </Pressable>
          <Text style={styles.peerProfileName}>{displayNameFor(activeChat?.peerUserId, activeChat?.name)}</Text>
          <Text style={styles.peerProfileMeta}>{getPresenceLabel(activeChat)}</Text>
          <Text style={styles.peerProfileMeta}>{usersById[activeChat?.peerUserId]?.username ? `@${usersById[activeChat.peerUserId].username}` : ''}</Text>
          <Text style={styles.peerProfileMeta}>{usersById[activeChat?.peerUserId]?.about || 'No about yet'}</Text>
          <Text style={styles.peerProfileMeta}>{usersById[activeChat?.peerUserId]?.phone || ''}</Text>
          {activeChat?.peerUserId ? (
            <Pressable
              style={[styles.ghostButton, { marginHorizontal: 20, marginBottom: 12 }]}
              onPress={() => void openPublicBusiness(null, activeChat.peerUserId)}
            >
              <Text style={styles.ghostButtonText}>View business storefront</Text>
            </Pressable>
          ) : null}
          <ScrollView style={styles.peerCatalogList}>
            <Text style={styles.peerProfileName}>Catalog</Text>
            {catalogItems.filter((item) => item.sellerId === activeChat?.peerUserId && item.isPublic).length ? null : (
              <Text style={styles.peerProfileMeta}>No public products yet.</Text>
            )}
            {catalogItems.filter((item) => item.sellerId === activeChat?.peerUserId && item.isPublic).map((item) => (
              <View key={item.id} style={styles.peerCatalogCard}>
                {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.peerCatalogImage} /> : null}
                <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                <Text style={styles.sheetOptionBody}>{item.price}</Text>
                <View style={styles.catalogActionRow}>
                  <Pressable style={styles.draftAction} onPress={() => void sendCatalogCard(item, activeChat?.peerUserId)}>
                    <Text style={styles.draftActionText}>Add to cart</Text>
                  </Pressable>
                  <Pressable style={styles.draftAction} onPress={() => void payForCatalogItem(item, activeChat?.peerUserId)}>
                    <Text style={styles.draftActionText}>Pay</Text>
                  </Pressable>
                  <Pressable style={styles.draftAction} onPress={() => void Share.share({ message: `${item.title} · ${item.price}` })}>
                    <Text style={styles.draftActionText}>Share</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          {activeChat?.peerUserId ? (
            <Pressable
              style={[styles.sendButtonWide, { marginHorizontal: 20, marginBottom: 24 }]}
              onPress={() => {
                const targetUserId = activeChat.peerUserId;
                const alreadyBlocked = (profile.blockedUserIds || []).includes(targetUserId);
                Alert.alert(
                  alreadyBlocked ? 'Unblock this person?' : 'Block this person?',
                  alreadyBlocked
                    ? 'They will be able to message and call you again.'
                    : 'They will not be able to message or call you. Your personal chats stay on this phone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: alreadyBlocked ? 'Unblock' : 'Block',
                      style: alreadyBlocked ? 'default' : 'destructive',
                      onPress: () => {
                        if (alreadyBlocked) {
                          void unblockUser(targetUserId);
                          return;
                        }
                        void blockUser(targetUserId);
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={styles.sendButtonText}>
                {(profile.blockedUserIds || []).includes(activeChat.peerUserId) ? 'Unblock' : 'Block'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Modal>
      <Modal transparent animationType="fade" visible={Boolean(avatarPrompt)} onRequestClose={() => setAvatarPrompt(null)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setAvatarPrompt(null)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{avatarPrompt?.name}</Text>
            <Text style={styles.cardBody}>This contact has a status update.</Text>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                if (avatarPrompt?.photoUri) {
                  setPhotoPreview({ uri: avatarPrompt.photoUri, name: avatarPrompt.name });
                }
                setAvatarPrompt(null);
              }}
            >
              <Text style={styles.sheetOptionTitle}>View profile photo</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => openStatusForUser(avatarPrompt?.userId)}>
              <Text style={styles.sheetOptionTitle}>View status</Text>
            </Pressable>
            <Pressable style={styles.sheetBack} onPress={() => setAvatarPrompt(null)}>
              <Text style={styles.sheetBackText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal transparent animationType="fade" visible={Boolean(photoPreview)} onRequestClose={() => setPhotoPreview(null)}>
        <View style={styles.viewerOverlay}>
          <Pressable style={styles.viewerClose} onPress={() => setPhotoPreview(null)}>
            <Text style={styles.viewerCloseText}>Close</Text>
          </Pressable>
          {photoPreview?.uri ? (
            <Image resizeMode="contain" source={{ uri: photoPreview.uri }} style={styles.viewerImage} />
          ) : null}
        </View>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={authVisible}
        onRequestClose={() => {
          if (!authRequired) {
            setAuthVisible(false);
          }
        }}
      >
        {renderAuthGate(true)}
      </Modal>
      <Modal transparent animationType="fade" visible={Boolean(unlockChatId)} onRequestClose={() => setUnlockChatId('')}>
        <Pressable style={styles.dialogOverlay} onPress={() => setUnlockChatId('')}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Unlock chat</Text>
            <Text style={styles.sheetOptionBody}>Enter the PIN from Profile.</Text>
            <TextInput
              value={unlockPin}
              onChangeText={setUnlockPin}
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
              placeholder="PIN"
              placeholderTextColor="#7d8b92"
              style={styles.input}
            />
            <Pressable style={styles.sendButtonWide} onPress={confirmChatUnlock}>
              <Text style={styles.sendButtonText}>Open</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal transparent animationType="fade" visible={Boolean(chatActionChat)} onRequestClose={() => setChatActionChat(null)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setChatActionChat(null)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{chatActionChat?.name || 'Chat'}</Text>
            <Pressable style={styles.sheetOption} onPress={() => { toggleLockChat(chatActionChat.id); setChatActionChat(null); }}>
              <Text style={styles.sheetOptionTitle}>{lockedChatIds.includes(chatActionChat?.id) ? 'Unlock chat' : 'Lock chat'}</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { toggleFavoriteChat(chatActionChat.id); setChatActionChat(null); }}>
              <Text style={styles.sheetOptionTitle}>{favoriteChatIds.includes(chatActionChat?.id) ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { toggleMuteChat(chatActionChat.id); setChatActionChat(null); }}>
              <Text style={styles.sheetOptionTitle}>{mutedChatIds.includes(chatActionChat?.id) ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={() => { toggleArchiveChat(chatActionChat.id); setChatActionChat(null); }}>
              <Text style={styles.sheetOptionTitle}>{archivedChatIds.includes(chatActionChat?.id) ? 'Unarchive' : 'Archive'}</Text>
            </Pressable>
            {chatActionChat?.kind === 'group' ? (
              <Pressable style={styles.sheetOption} onPress={() => {
                const chatId = chatActionChat.id;
                setChatActionChat(null);
                void fetch(`${API_BASE_URL}/api/chats/${chatId}?userId=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' })
                  .then((response) => {
                    if (!response.ok) {
                      showToast('Could not delete that chat room.', 'error');
                      return;
                    }
                    setChatItems((current) => current.filter((item) => item.id !== chatId));
                    if (selectedChatId === chatId) {
                      setChatScreen('list');
                    }
                    showToast('Chat room deleted.', 'success');
                  })
                  .catch(() => showToast('Could not delete that chat room.', 'error'));
              }}>
                <Text style={styles.sheetOptionTitle}>Delete chat room</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.sheetBack} onPress={() => setChatActionChat(null)}>
              <Text style={styles.sheetBackText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={appSettings.appLockEnabled && !appSettings.pinDisabled && !appUnlocked && Boolean(appLockPin)}
        onRequestClose={() => undefined}
      >
        <View style={styles.lockOverlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>App locked</Text>
            <Text style={styles.cardBody}>Enter your PIN to open ZynkUP.</Text>
            {lockNotice ? <Text style={[styles.cardBody, { color: '#d4544c' }]}>{lockNotice.title}: {lockNotice.body}. Unlock to open it.</Text> : null}
            <TextInput
              value={unlockPinDraft}
              onChangeText={setUnlockPinDraft}
              placeholder="••••"
              placeholderTextColor="#7d8b92"
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
              style={styles.input}
            />
            <Pressable
              style={styles.sendButtonWide}
              onPress={() => {
                if (unlockPinDraft.trim() === appLockPin) {
                  setAppUnlocked(true);
                  setUnlockPinDraft('');
                  showToast('Welcome back', 'success', 1400);
                  return;
                }
                showToast('Incorrect PIN', 'error');
              }}
            >
              <Text style={styles.sendButtonText}>Unlock</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        animationType="slide"
        visible={countryPickerVisible}
        onRequestClose={() => setCountryPickerVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setCountryPickerVisible(false)}>
          <Pressable style={styles.sheetDialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Select country code</Text>
            <TextInput
              value={countrySearch}
              onChangeText={setCountrySearch}
              placeholder="Search country or code"
              placeholderTextColor="#7d8b92"
              style={styles.input}
            />
            <ScrollView style={styles.countryList}>
              {filteredCountryOptions.slice(0, 120).map((country) => (
                <Pressable
                  key={`${country.code}-${country.dialCode}`}
                  style={styles.countryRow}
                  onPress={() => {
                    setAuthForm((current) => ({ ...current, countryCode: country.dialCode }));
                    setCountryPickerVisible(false);
                    setCountrySearch('');
                  }}
                >
                  <Text style={styles.sheetOptionTitle}>{country.name}</Text>
                  <Text style={styles.sheetOptionBody}>{country.dialCode}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={deviceScannerVisible}
        onRequestClose={() => setDeviceScannerVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setDeviceScannerVisible(false)}>
          <Pressable style={styles.sheetDialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Link devices</Text>
            <Text style={styles.cardBody}>
              {deviceLinking
                ? 'Finishing secure desktop link...'
                : 'Scan the desktop QR code from the web login screen.'}
            </Text>
            {cameraPermissionGranted && Camera ? (
              <Camera
                allowedBarcodeTypes={['qr']}
                cameraType="back"
                onError={() => {
                  setDeviceLinkMessage('Camera could not start on this device.');
                }}
                onReadCode={deviceLinking ? undefined : ({ nativeEvent }) => {
                  if (!deviceScannerVisible) {
                    return;
                  }
                  void confirmLinkedDesktop(nativeEvent.codeStringValue);
                }}
                resizeMode="cover"
                scanBarcode
                scanThrottleDelay={1500}
                style={styles.scannerView}
              />
            ) : (
              <Text style={styles.cardBody}>
                {Camera
                  ? 'Allow the camera, then scan the code shown on the web login screen.'
                  : 'The camera scanner is not in this install yet. Update the app, then scan the web login code.'}
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {callMinimized && activeCall?.state === 'ongoing' ? (
        activeCall.kind === 'Video' && remoteCallStream?.toURL?.() && RTCViewNative ? (
          <View
            {...callFloatResponder.panHandlers}
            style={[styles.callFloat, { left: floatPos.x, top: floatPos.y }]}
          >
            <RTCViewNative streamURL={remoteCallStream.toURL()} style={styles.callFloatVideo} objectFit="cover" />
            <Text style={styles.callFloatTime}>{getAudioDurationLabel(activeCallSeconds * 1000)}</Text>
          </View>
        ) : (
          <Pressable style={styles.callMiniBar} onPress={() => { setCallMinimized(false); setCallControlsVisible(true); }}>
            <Text style={styles.callMiniName}>{activeCall.name}</Text>
            <Text style={styles.callMiniTime}>{getAudioDurationLabel(activeCallSeconds * 1000)}</Text>
          </Pressable>
        )
      ) : null}
      <Modal transparent animationType="fade" visible={callInviteVisible} onRequestClose={() => setCallInviteVisible(false)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setCallInviteVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Add to call</Text>
            <Text style={styles.cardBody}>They get an invite and can join by calling you.</Text>
            <ScrollView style={styles.newChatList}>
              {contactItems.filter((contact) => contact.registered && contact.linkedUserId && contact.linkedUserId !== currentUserId && contact.linkedUserId !== activeCall?.peerUserId)
                .filter((contact, index, list) => list.findIndex((item) => item.linkedUserId === contact.linkedUserId) === index)
                .map((contact) => (
                  <Pressable
                    key={contact.linkedUserId}
                    style={styles.sheetOption}
                    onPress={() => {
                      socketRef.current?.emit('call:invite', {
                        toUserId: contact.linkedUserId,
                        fromUserId: currentUserId,
                        fromName: profile.name || 'Someone',
                        kind: activeCall?.kind || 'Audio',
                      });
                      setCallInviteVisible(false);
                      showToast(`Invited ${contact.name}.`, 'success');
                    }}
                  >
                    <Text style={styles.sheetOptionTitle}>{contact.name}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal transparent animationType="slide" visible={groupInfoVisible && activeChat?.kind === 'group'} onRequestClose={() => setGroupInfoVisible(false)}>
        <Pressable style={styles.dialogOverlay} onPress={() => setGroupInfoVisible(false)}>
          <Pressable style={styles.sheetDialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{activeChat?.name || 'Chat room'}</Text>
            <TextInput
              value={groupTitleDraft}
              onChangeText={setGroupTitleDraft}
              placeholder="Room name"
              placeholderTextColor="#7d8b92"
              style={styles.input}
            />
            {((activeChat?.adminIds?.length ? activeChat.adminIds : (activeChat?.participants || []).slice(0, 1)).includes(currentUserId)) ? (
              <Pressable style={styles.sendButtonWide} onPress={() => {
                void fetch(`${API_BASE_URL}/api/chats/${activeChat.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: currentUserId, title: groupTitleDraft.trim() }),
                }).then(async (response) => {
                  const payload = await response.json().catch(() => ({}));
                  if (!response.ok) {
                    showToast(payload.error || 'Could not rename the room.', 'error');
                    return;
                  }
                  showToast('Room name updated.', 'success');
                }).catch(() => showToast('Could not rename the room.', 'error'));
              }}>
                <Text style={styles.sendButtonText}>Save name</Text>
              </Pressable>
            ) : null}
            <Text style={styles.lightSectionLabel}>MEMBERS</Text>
            <ScrollView style={styles.newChatList}>
              {(activeChat?.participants || []).map((memberId) => {
                const admins = activeChat?.adminIds?.length ? activeChat.adminIds : (activeChat?.participants || []).slice(0, 1);
                const iAmAdmin = admins.includes(currentUserId);
                const memberIsAdmin = admins.includes(memberId);
                return (
                  <View key={memberId} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>
                      {memberId === currentUserId ? 'You' : displayNameFor(memberId, 'Member')}{memberIsAdmin ? ' · Admin' : ''}
                    </Text>
                    {iAmAdmin && memberId !== currentUserId ? (
                      <View style={styles.catalogActionRow}>
                        <Pressable onPress={() => {
                          void fetch(`${API_BASE_URL}/api/chats/${activeChat.id}/admins`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: currentUserId, memberId, admin: !memberIsAdmin }),
                          }).then(async (response) => {
                            const payload = await response.json().catch(() => ({}));
                            if (!response.ok) showToast(payload.error || 'Could not update admin.', 'error');
                          }).catch(() => showToast('Could not update admin.', 'error'));
                        }}>
                          <Text style={styles.catalogChipText}>{memberIsAdmin ? 'Dismiss admin' : 'Make admin'}</Text>
                        </Pressable>
                        <Pressable onPress={() => {
                          void fetch(`${API_BASE_URL}/api/chats/${activeChat.id}/members/${memberId}?userId=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' })
                            .then(async (response) => {
                              const payload = await response.json().catch(() => ({}));
                              if (!response.ok) showToast(payload.error || 'Could not remove that person.', 'error');
                            }).catch(() => showToast('Could not remove that person.', 'error'));
                        }}>
                          <Text style={styles.catalogChipText}>Remove</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            {((activeChat?.adminIds?.length ? activeChat.adminIds : (activeChat?.participants || []).slice(0, 1)).includes(currentUserId)) ? (
              <>
                <Text style={styles.lightSectionLabel}>ADD SOMEONE</Text>
                <ScrollView style={styles.newChatList}>
                  {contactItems.filter((contact) => contact.linkedUserId && !(activeChat?.participants || []).includes(contact.linkedUserId))
                    .filter((contact, index, list) => list.findIndex((item) => item.linkedUserId === contact.linkedUserId) === index)
                    .map((contact) => (
                      <Pressable key={contact.linkedUserId} style={styles.sheetOption} onPress={() => {
                        void fetch(`${API_BASE_URL}/api/chats/${activeChat.id}/members`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: currentUserId, memberIds: [contact.linkedUserId] }),
                        }).then(async (response) => {
                          const payload = await response.json().catch(() => ({}));
                          if (!response.ok) showToast(payload.error || 'Could not add that person.', 'error');
                          else showToast(`${contact.name} added.`, 'success');
                        }).catch(() => showToast('Could not add that person.', 'error'));
                      }}>
                        <Text style={styles.sheetOptionTitle}>{contact.name}</Text>
                      </Pressable>
                    ))}
                </ScrollView>
              </>
            ) : null}
            <Pressable style={styles.sheetOption} onPress={() => {
              void fetch(`${API_BASE_URL}/api/chats/${activeChat.id}/members/${currentUserId}?userId=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' })
                .then(() => {
                  setGroupInfoVisible(false);
                  setChatScreen('list');
                })
                .catch(() => showToast('Could not leave the room.', 'error'));
            }}>
              <Text style={styles.sheetOptionTitle}>Leave room</Text>
            </Pressable>
            <Pressable style={styles.sheetBack} onPress={() => setGroupInfoVisible(false)}>
              <Text style={styles.sheetBackText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      {renderToast()}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  toastOverlay: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    zIndex: 200,
    alignItems: 'center',
  },
  toastCard: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  toastCardInfo: {
    backgroundColor: '#111827',
    borderColor: '#1f2937',
  },
  toastCardSuccess: {
    backgroundColor: '#0f2e25',
    borderColor: '#10b981',
  },
  toastCardError: {
    backgroundColor: '#32161b',
    borderColor: '#ef4444',
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  centerTitle: {
    color: '#f6f7f8',
    fontSize: 19,
    fontWeight: '700',
  },
  topActions: {
    flexDirection: 'row',
    gap: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#f6f7f8',
    fontSize: 18,
    fontWeight: '700',
  },
  archiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 22,
    paddingBottom: 14,
    minHeight: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#171717',
  },
  archiveIcon: {
    color: '#8b8f94',
    fontSize: 18,
  },
  archiveText: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '600',
  },
  chatList: {
    flex: 1,
  },
  chatRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#171717',
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#25323a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#f6f7f8',
    fontSize: 15,
    fontWeight: '700',
  },
  chatRowCopy: {
    flex: 1,
    justifyContent: 'center',
  },
  chatRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
    maxWidth: '72%',
  },
  chatTime: {
    color: '#8b8f94',
    fontSize: 14,
  },
  chatTimeActive: {
    color: '#60a5fa',
  },
  chatRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatPreview: {
    flex: 1,
    color: '#8b8f94',
    fontSize: 14,
    lineHeight: 19,
  },
  unreadBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#edf4ff',
    fontWeight: '800',
    fontSize: 12,
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginBottom: 8,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 8,
    borderRadius: 28,
    backgroundColor: '#12082A',
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
    paddingVertical: 6,
    borderRadius: 22,
  },
  bottomNavItemOn: {
    backgroundColor: '#7C3AED',
  },
  bottomNavComposeWrap: {
    flex: 1,
    alignItems: 'center',
    marginTop: -28,
  },
  bottomNavComposeButton: {
    width: 84,
    height: 66,
    borderRadius: 22,
    backgroundColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#15c79a',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 10,
  },
  bottomNavComposeText: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '500',
    marginTop: -2,
  },
  bottomNavIconWrap: {
    position: 'relative',
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIcon: {
    color: '#8c909b',
    fontSize: 20,
  },
  bottomNavIconActive: {
    color: '#ffffff',
  },
  bottomNavLabel: {
    color: '#b7adc9',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  bottomNavLabelActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  bottomNavBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavBadgeText: {
    color: '#edf4ff',
    fontSize: 10,
    fontWeight: '800',
  },
  lightScreen: {
    flex: 1,
    backgroundColor: '#f4efe6',
  },
  lightHeader: {
    paddingTop: 22,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#ffffff',
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lightHeaderActions: {
    flexDirection: 'row',
    gap: 10,
  },
  lightHeaderAction: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#e7f7f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightHeaderActionText: {
    color: '#15c79a',
    fontSize: 18,
    fontWeight: '600',
  },
  appWordmark: {
    color: '#101828',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.9,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  appWordmarkAccent: {
    color: '#15c79a',
  },
  payWordmark: {
    color: '#101828',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.6,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  lightScroll: {
    flex: 1,
  },
  lightScrollContent: {
    paddingHorizontal: 22,
    paddingBottom: 28,
  },
  lightSectionLabel: {
    color: '#8a8f9d',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 12,
    marginTop: 10,
  },
  lightSectionTitle: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 14,
  },
  identityChipText: {
    color: '#128C7E',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  identityComposer: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#e7f6f3',
  },
  identityComposerText: {
    color: '#0f6f64',
    fontSize: 13,
    fontWeight: '700',
  },
  homeCardsWrap: {
    marginBottom: 18,
  },
  homeCardsLabel: {
    color: '#7f8591',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  homeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eceff3',
  },
  homeCardCopy: {
    flex: 1,
    paddingRight: 10,
  },
  homeCardTitle: {
    color: '#101828',
    fontSize: 16,
    fontWeight: '700',
  },
  homeCardBody: {
    color: '#667085',
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  homeCardChevron: {
    color: '#98a2b3',
    fontSize: 22,
    fontWeight: '400',
  },
  homeCardDismiss: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  homeCardDismissText: {
    color: '#98a2b3',
    fontSize: 12,
    fontWeight: '700',
  },
  modeSwitch: {
    marginHorizontal: 22,
    marginBottom: 18,
    padding: 4,
    borderRadius: 18,
    backgroundColor: '#e9eaee',
    flexDirection: 'row',
  },
  modeSwitchButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeSwitchButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#101828',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    elevation: 2,
  },
  modeSwitchText: {
    color: '#7f8591',
    fontSize: 16,
    fontWeight: '600',
  },
  modeSwitchTextActive: {
    color: '#15c79a',
    fontWeight: '700',
  },
  chatHomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  chatHomeAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    position: 'relative',
  },
  chatAvatarSlot: {
    marginRight: 14,
    position: 'relative',
  },
  chatHomeCopyInner: {
    flex: 1,
  },
  personAvatarOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b1418',
  },
  personAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d7efe4',
  },
  personAvatarLetter: {
    color: '#10221b',
    fontWeight: '800',
    fontSize: 18,
  },
  contactPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  contactPickCopy: {
    flex: 1,
  },
  callLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#24343c',
  },
  callLogCopy: {
    flex: 1,
  },
  callLogName: {
    color: '#f4f7f8',
    fontSize: 16,
    fontWeight: '700',
  },
  callLogMeta: {
    color: '#b7c6cc',
    marginTop: 2,
  },
  callLogTime: {
    color: '#8ea0a8',
    marginTop: 2,
    fontSize: 12,
  },
  callLogMissed: {
    color: '#d11a2a',
  },
  chatHomeAvatarText: {
    color: '#f8fbff',
    fontWeight: '800',
    fontSize: 18,
  },
  chatHomePresenceDot: {
    position: 'absolute',
    right: 2,
    bottom: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#15c79a',
    borderWidth: 2,
    borderColor: '#f5f5f7',
  },
  chatHomeCopy: {
    flex: 1,
  },
  chatHomeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  chatHomeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  chatHomeName: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  chatHomeBadge: {
    color: '#d97706',
    backgroundColor: '#fff2df',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  chatHomeTime: {
    color: '#8a8f9d',
    fontSize: 14,
  },
  chatHomeBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatHomePreview: {
    flex: 1,
    color: '#7b8190',
    fontSize: 14,
    lineHeight: 20,
  },
  chatHomeUnread: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF2D8A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  chatHomeUnreadText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  chatHomeMuted: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#eceef2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHomeMutedText: {
    color: '#9ba1af',
    fontWeight: '700',
  },
  payHeroCard: {
    backgroundColor: '#15c79a',
    borderRadius: 30,
    padding: 22,
    marginTop: 6,
    marginBottom: 18,
  },
  payHeroLabel: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 15,
    fontWeight: '700',
  },
  payHeroAmount: {
    color: '#ffffff',
    fontSize: 50,
    fontWeight: '900',
    letterSpacing: -1.4,
    marginTop: 8,
  },
  payHeroMeta: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 16,
    marginTop: 6,
  },
  payHeroActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 10,
  },
  payHeroAction: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  payHeroActionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  payHeroActionIconText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
  },
  payHeroActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  quickSendRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  quickSendItem: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  quickSendAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickSendAvatarText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 17,
  },
  quickSendAvatarAdd: {
    borderWidth: 1.5,
    borderColor: '#15c79a',
    backgroundColor: '#f5f5f7',
  },
  quickSendAvatarAddText: {
    color: '#15c79a',
    fontSize: 28,
    fontWeight: '500',
  },
  quickSendName: {
    color: '#7b8190',
    fontSize: 13,
    fontWeight: '600',
  },
  payTransactionList: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 4,
  },
  payTransactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e6e8ee',
  },
  payTransactionRowLast: {
    borderBottomWidth: 0,
  },
  payTransactionAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payTransactionAvatarText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 16,
  },
  payTransactionCopy: {
    flex: 1,
  },
  payTransactionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  payTransactionMeta: {
    color: '#8a8f9d',
    fontSize: 13,
    marginTop: 4,
  },
  payTransactionAmount: {
    color: '#ff6f7c',
    fontSize: 16,
    fontWeight: '800',
  },
  payTransactionAmountPositive: {
    color: '#15a77d',
  },
  statusComposerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d9dde4',
    marginBottom: 14,
  },
  statusComposerRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  statusComposerPlus: {
    color: '#15c79a',
    fontSize: 32,
    fontWeight: '400',
    marginTop: -2,
  },
  statusComposerCopy: {
    flex: 1,
  },
  statusAddTitle: {
    color: '#14221c',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  statusAddMeta: {
    color: '#8a8f9d',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  phoneLink: {
    color: '#128c7e',
    textDecorationLine: 'underline',
    fontWeight: '700',
  },
  publicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  publicCard: {
    width: '31.5%',
    height: 210,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#8d3a3a',
  },
  publicCardImage: {
    ...StyleSheet.absoluteFillObject,
  },
  publicCardShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  publicCardLogo: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 20,
  },
  publicCardName: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 28,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  publicTakeDown: {
    position: 'absolute',
    left: 8,
    bottom: 6,
  },
  publicTakeDownText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  marketFilterRow: {
    paddingVertical: 8,
    gap: 8,
  },
  marketFilterChip: {
    borderWidth: 1,
    borderColor: '#d5ddd8',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
  },
  marketFilterChipOn: {
    backgroundColor: '#d7f3ea',
    borderColor: '#12382f',
  },
  marketFilterText: {
    color: '#16352c',
    fontWeight: '700',
  },
  marketGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  marketCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7e3dc',
    marginBottom: 12,
    overflow: 'hidden',
  },
  marketCardImage: {
    width: '100%',
    height: 150,
    backgroundColor: '#e7eeea',
  },
  marketPrice: {
    color: '#138a45',
    fontSize: 18,
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  marketTitle: {
    color: '#14221c',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 10,
    marginTop: 4,
  },
  marketMeta: {
    color: '#66756e',
    fontSize: 12,
    paddingHorizontal: 10,
    paddingBottom: 10,
    marginTop: 4,
  },
  marketBoostBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#12382f',
    color: '#ffffff',
    overflow: 'hidden',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '700',
  },
  productScreen: {
    flex: 1,
    backgroundColor: '#f6f3ee',
  },
  productTopBar: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  productTopTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#14221c',
  },
  productHero: {
    width: '100%',
    height: 320,
    backgroundColor: '#ddd',
  },
  productThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    marginRight: 8,
  },
  productThumbOn: {
    borderWidth: 2,
    borderColor: '#12382f',
  },
  productBody: {
    padding: 16,
  },
  productName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#14221c',
    marginTop: 4,
  },
  productCopy: {
    color: '#24332c',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
  },
  productSeller: {
    marginTop: 8,
    marginBottom: 16,
    color: '#12382f',
    fontWeight: '700',
  },
  statusFeedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#eaecf0',
  },
  statusFeedAvatarWrap: {
    marginRight: 14,
  },
  statusFeedAvatarRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    borderColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFeedAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFeedAvatarText: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '800',
  },
  statusFeedCopy: {
    flex: 1,
  },
  statusFeedName: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  statusFeedTime: {
    color: '#8a8f9d',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  statusFeedBody: {
    color: '#7b8190',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  statusFeedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#15c79a',
    marginLeft: 10,
  },
  statusMineCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: '#eafaf4',
    borderWidth: 1,
    borderColor: '#c6efe0',
  },
  statusMineTitle: {
    color: '#0d4f3c',
    fontSize: 15,
    fontWeight: '800',
  },
  statusMineBody: {
    color: '#37695b',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  businessModeTitle: {
    color: '#101828',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.6,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  businessAlertCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f2c36b',
    backgroundColor: '#fff5e6',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 18,
  },
  businessAlertText: {
    color: '#d97706',
    fontSize: 15,
    fontWeight: '700',
  },
  businessHeroCard: {
    borderRadius: 30,
    backgroundColor: '#06101d',
    padding: 22,
    marginBottom: 20,
  },
  businessHeroTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  businessHeroMeta: {
    color: '#a0a9b5',
    fontSize: 15,
    marginTop: 4,
  },
  businessStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  businessStatCard: {
    flex: 1,
    backgroundColor: '#171d27',
    borderRadius: 20,
    padding: 16,
    minHeight: 100,
    justifyContent: 'space-between',
  },
  businessStatValue: {
    color: '#15c79a',
    fontSize: 23,
    fontWeight: '900',
  },
  businessStatLabel: {
    color: '#c9d0d8',
    fontSize: 14,
    lineHeight: 18,
  },
  businessGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
  },
  businessGridCard: {
    width: '48%',
    borderRadius: 24,
    backgroundColor: '#ffffff',
    padding: 18,
    borderWidth: 1,
    borderColor: '#eaecf0',
  },
  businessGridIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#e7f7f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  businessGridIcon: {
    color: '#15c79a',
    fontSize: 22,
    fontWeight: '700',
  },
  businessGridTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  chatListShell: {
    flex: 1,
  },
  chatListScreen: {
    flex: 1,
    backgroundColor: '#14082A',
  },
  chatListHeader: {
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chatListTitleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatListMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  chatListTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
  },
  chatListIdentity: {
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '700',
  },
  chatListAction: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chatListActionText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  chatFilterRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  chatFilterChip: {
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chatFilterChipOn: {
    backgroundColor: '#7C3AED',
  },
  chatFilterText: {
    color: '#d6d0e6',
    fontSize: 14,
    fontWeight: '700',
  },
  chatFilterTextOn: {
    color: '#ffffff',
  },
  exploreChip: {
    backgroundColor: '#ece7f8',
  },
  exploreChipText: {
    color: '#3b3354',
  },
  profileVideoPreview: {
    width: 120,
    height: 160,
    borderRadius: 16,
    marginTop: 12,
    backgroundColor: '#12082A',
  },
  aiToneMenu: {
    marginHorizontal: 12,
    marginBottom: 8,
  },
  aiToneMenuButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#1c1238',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiToneMenuButtonText: {
    color: '#f8fbff',
    fontWeight: '700',
  },
  aiToneMenuList: {
    marginTop: 6,
    borderRadius: 16,
    backgroundColor: '#1c1238',
    overflow: 'hidden',
  },
  aiToneMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiToneMenuItemText: {
    color: '#d6d0e6',
    fontSize: 15,
    textTransform: 'capitalize',
  },
  aiToneMenuItemTextOn: {
    color: '#ffffff',
    fontWeight: '800',
  },
  chatFab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0b3b34',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  chatFabText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '600',
    marginTop: -2,
  },
  newChatDialog: {
    maxHeight: '78%',
  },
  newChatList: {
    maxHeight: 360,
  },
  statusModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statusModeChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d7e0e4',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f7fafb',
  },
  statusModeChipActive: {
    backgroundColor: '#128C7E',
    borderColor: '#128C7E',
  },
  statusModeChipText: {
    color: '#44545b',
    fontWeight: '600',
  },
  statusModeChipTextActive: {
    color: '#ffffff',
  },
  statusMediaPicker: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d7e0e4',
    backgroundColor: '#f4f8f7',
    padding: 18,
    marginBottom: 12,
  },
  statusMediaPickerTitle: {
    color: '#10233e',
    fontSize: 16,
    fontWeight: '700',
  },
  statusMediaPickerMeta: {
    color: '#6b7a82',
    marginTop: 4,
  },
  businessPanelScroll: {
    maxHeight: 520,
  },
  documentFormRow: {
    flexDirection: 'row',
    gap: 10,
  },
  documentFormHalf: {
    flex: 1,
  },
  documentChip: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#12324a',
    gap: 2,
  },
  documentChipLabel: {
    color: '#9fd5c8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  documentChipMeta: {
    color: '#f4f8fb',
    fontWeight: '700',
    fontSize: 14,
  },
  catalogManageRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e4ebef',
  },
  catalogManageImage: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#eef3f5',
  },
  mediaPreviewRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  mediaPreviewThumb: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: '#eef3f5',
  },
  catalogManageImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogManageCopy: {
    flex: 1,
  },
  stockControls: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  stockButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#dff3ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockButtonText: {
    color: '#0b6b5b',
    fontSize: 18,
    fontWeight: '700',
  },
  businessGridMeta: {
    color: '#8a8f9d',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  celebrationScreen: {
    flex: 1,
    backgroundColor: '#020817',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 28,
    justifyContent: 'flex-start',
  },
  celebrationCard: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  celebrationConfettiOne: {
    position: 'absolute',
    top: '20%',
    left: 26,
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    transform: [{ rotate: '20deg' }],
  },
  celebrationConfettiTwo: {
    position: 'absolute',
    top: '36%',
    right: 34,
    width: 16,
    height: 10,
    borderRadius: 4,
    backgroundColor: '#6366f1',
    transform: [{ rotate: '-25deg' }],
  },
  celebrationConfettiThree: {
    position: 'absolute',
    bottom: '28%',
    left: 44,
    width: 18,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#14b8a6',
    transform: [{ rotate: '30deg' }],
  },
  celebrationCheck: {
    width: 92,
    height: 56,
    borderRadius: 22,
    backgroundColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 26,
  },
  celebrationCheckText: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginTop: -2,
  },
  celebrationTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    textAlign: 'center',
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  celebrationAccent: {
    color: '#15c79a',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    textAlign: 'center',
    marginTop: 2,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  celebrationSubtitle: {
    color: '#a0a9b5',
    fontSize: 17,
    lineHeight: 25,
    textAlign: 'center',
    marginTop: 18,
  },
  celebrationFeatureList: {
    gap: 12,
    marginTop: 24,
  },
  celebrationFeatureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.12)',
    padding: 16,
  },
  celebrationFeatureIcon: {
    fontSize: 20,
    marginTop: 2,
  },
  celebrationFeatureText: {
    flex: 1,
    color: '#d8e4f2',
    fontSize: 16,
    lineHeight: 22,
  },
  celebrationFeatureTitle: {
    color: '#ffffff',
    fontWeight: '800',
  },
  celebrationButton: {
    minHeight: 60,
    borderRadius: 20,
    backgroundColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  celebrationButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  detailScreen: {
    flex: 1,
    backgroundColor: '#0b1410',
    paddingTop: 12,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: '#10211b',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1b2b31',
  },
  detailHeaderText: {
    flex: 1,
  },
  detailHeaderActions: {
    flexDirection: 'row',
    gap: 8,
  },
  detailTitle: {
    color: '#f6f7f8',
    fontSize: 17,
    fontWeight: '700',
  },
  detailSubtitle: {
    color: '#94a6ad',
    fontSize: 13,
    marginTop: 2,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    padding: 16,
    gap: 10,
  },
  messageBubble: {
    maxWidth: '72%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  messageMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#10233e',
  },
  messageTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#1b262d',
  },
  emojiBubble: {
    paddingVertical: 16,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  emojiText: {
    fontSize: 34,
  },
  groupSenderName: {
    color: '#7dcea0',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  anonymousToggle: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#1b262d',
  },
  anonymousToggleOn: {
    backgroundColor: '#14532d',
  },
  anonymousToggleText: {
    color: '#f6f7f8',
    fontWeight: '700',
  },
  messageText: {
    color: '#f6f7f8',
    fontSize: 16,
    lineHeight: 22,
    flexShrink: 1,
  },
  messageImage: {
    width: 240,
    height: 220,
    borderRadius: 16,
  },
  imageFallback: {
    width: 240,
    height: 220,
    borderRadius: 16,
    backgroundColor: '#c6a67a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageFallbackText: {
    color: '#1e1f22',
    fontWeight: '700',
    fontSize: 18,
  },
  messageCaption: {
    color: '#f6f7f8',
    marginTop: 10,
    fontSize: 15,
  },
  voiceNoteBlock: {
    gap: 8,
    minWidth: 190,
  },
  voiceNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 190,
  },
  voiceTranscriptText: {
    color: '#e3ecef',
    fontSize: 14,
    lineHeight: 20,
  },
  voiceTranscriptMeta: {
    color: '#9ab0b8',
    fontSize: 12,
    fontWeight: '600',
  },
  voiceTranscribeChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  voiceTranscribeChipText: {
    color: '#f6f7f8',
    fontWeight: '700',
    fontSize: 12,
  },
  messageTranslationBlock: {
    marginTop: 8,
    gap: 6,
  },
  messageTranslationText: {
    color: '#d5e2e8',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  messageTranslationBadge: {
    color: '#9ab0b8',
    fontSize: 11,
    fontWeight: '600',
  },
  translateLangRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  translateChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  translateChipDefault: {
    backgroundColor: 'rgba(124,255,178,0.18)',
  },
  translateChipText: {
    color: '#f6f7f8',
    fontWeight: '700',
    fontSize: 12,
  },
  voiceIcon: {
    color: '#f6f7f8',
    fontSize: 16,
  },
  voiceBar: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  voicePlayButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  voiceBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.28)',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  voiceBarFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#7CFFB2',
  },
  recordPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff4d4f',
  },
  draftAction: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  draftActionSend: {
    backgroundColor: '#1f8f4e',
  },
  draftActionText: {
    color: '#f6f7f8',
    fontWeight: '700',
    fontSize: 13,
  },
  voiceDuration: {
    color: '#e3ecef',
    fontWeight: '700',
  },
  messageTime: {
    color: '#9ab0b8',
    fontSize: 11,
    textAlign: 'right',
  },
  messageMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  receiptBadge: {
    color: '#9ab0b8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: -1,
  },
  receiptBadgeRead: {
    color: '#60a5fa',
  },
  attachmentCard: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  attachmentTitle: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  attachmentName: {
    color: '#f6f7f8',
    fontSize: 14,
    fontWeight: '600',
  },
  attachmentMeta: {
    color: '#9ab0b8',
    fontSize: 12,
    marginTop: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1b2b31',
    backgroundColor: '#081216',
  },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 108,
    borderRadius: 24,
    backgroundColor: '#1b262d',
    color: '#f6f7f8',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  composerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiAssistRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  aiAssistButton: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#172228',
    borderWidth: 1,
    borderColor: '#2a3b42',
  },
  aiAssistButtonBusy: {
    opacity: 0.55,
  },
  aiAssistButtonText: {
    color: '#d5e2e8',
    fontWeight: '700',
    fontSize: 12,
  },
  aiToneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  aiToneChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1b262d',
  },
  aiToneChipActive: {
    backgroundColor: '#12324a',
  },
  aiToneChipText: {
    color: '#9ab0b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  aiToneChipTextActive: {
    color: '#f4f8fb',
  },
  aiChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  aiSuggestionChip: {
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#12324a',
  },
  aiSuggestionChipText: {
    color: '#f4f8fb',
    fontSize: 13,
    fontWeight: '600',
  },
  summarySheet: {
    maxHeight: '78%',
  },
  summaryScroll: {
    maxHeight: 420,
  },
  summaryScrollContent: {
    gap: 12,
    paddingBottom: 8,
  },
  summaryOverview: {
    color: '#f4f8fb',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
  },
  summaryNotice: {
    color: '#9ab0b8',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  summarySection: {
    gap: 8,
  },
  summarySectionTitle: {
    color: '#8fd6c4',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#172228',
    borderWidth: 1,
    borderColor: '#2a3b42',
    gap: 4,
  },
  summaryItemText: {
    color: '#e8f1f5',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  summaryItemMeta: {
    color: '#7d8b92',
    fontSize: 11,
    fontWeight: '600',
  },
  dictateInput: {
    minHeight: 120,
    maxHeight: 180,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#172228',
    borderWidth: 1,
    borderColor: '#2a3b42',
    color: '#f4f8fb',
    fontSize: 15,
    fontWeight: '500',
  },
  scamWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#3a1a1a',
    borderWidth: 1,
    borderColor: '#7a3030',
  },
  scamWarningTitle: {
    color: '#ff8f8f',
    fontSize: 12,
    fontWeight: '800',
  },
  scamWarningText: {
    color: '#f0cfcf',
    fontSize: 13,
    lineHeight: 18,
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1b262d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonText: {
    color: '#f6f7f8',
    fontSize: 20,
  },
  micButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: {
    backgroundColor: '#ff5b5b',
  },
  micButtonText: {
    color: '#edf4ff',
    fontSize: 20,
    fontWeight: '800',
  },
  sendButton: {
    borderRadius: 22,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonWide: {
    borderRadius: 16,
    backgroundColor: '#3b82f6',
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#edf4ff',
    fontWeight: '800',
  },
  ghostButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a3b42',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#0f171b',
  },
  ghostButtonText: {
    color: '#d5e2e8',
    fontWeight: '700',
  },
  emojiTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#111b21',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1b2b31',
  },
  emojiTrayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#1b262d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiTrayText: {
    fontSize: 22,
  },
  recordingBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#10222a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordingBannerText: {
    color: '#ff7070',
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
  },
  secondaryScreen: {
    flex: 1,
  },
  secondaryContent: {
    paddingTop: 52,
    paddingHorizontal: 18,
    paddingBottom: 24,
    gap: 12,
  },
  secondaryTitle: {
    color: '#f6f7f8',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 6,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  statusHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusHeaderActions: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    backgroundColor: '#111b21',
    color: '#f1f5f7',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  textArea: {
    backgroundColor: '#111b21',
    color: '#f1f5f7',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  statusStrip: {
    gap: 14,
    paddingVertical: 8,
    paddingRight: 18,
  },
  statusCard: {
    width: 190,
  },
  statusCardMedia: {
    height: 340,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#101d2b',
    position: 'relative',
  },
  statusCardImage: {
    width: '100%',
    height: '100%',
  },
  statusCardFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#162235',
  },
  statusCardFallbackText: {
    color: '#edf4ff',
    fontSize: 44,
    fontWeight: '800',
  },
  statusAvatarRing: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,12,18,0.45)',
  },
  statusAvatarInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0d121a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusAvatarText: {
    color: '#edf4ff',
    fontWeight: '800',
  },
  statusDeleteButton: {
    position: 'absolute',
    right: 12,
    top: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(5,10,16,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 2,
  },
  statusDeleteText: {
    color: '#f6f7f8',
    fontWeight: '700',
    fontSize: 12,
  },
  statusCardTitle: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },
  statusCountBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(8,14,24,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCountBadgeText: {
    color: '#edf4ff',
    fontSize: 12,
    fontWeight: '800',
  },
  statusManageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusManageCopy: {
    flex: 1,
  },
  statusDeleteInline: {
    borderRadius: 999,
    backgroundColor: '#162235',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  statusDeleteInlineText: {
    color: '#edf4ff',
    fontWeight: '700',
  },
  chipRow: {
    gap: 10,
    paddingVertical: 6,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#111b21',
  },
  categoryChipActive: {
    backgroundColor: '#3b82f6',
  },
  categoryChipText: {
    color: '#dbe5ea',
    fontWeight: '700',
  },
  categoryChipTextActive: {
    color: '#edf4ff',
  },
  catalogCard: {
    backgroundColor: '#111b21',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#233138',
  },
  catalogImage: {
    width: '100%',
    height: 180,
  },
  catalogCardBody: {
    padding: 16,
    gap: 6,
  },
  catalogTitle: {
    color: '#f1f5f7',
    fontSize: 18,
    fontWeight: '800',
  },
  catalogPrice: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '800',
  },
  catalogSeller: {
    color: '#b5c4ca',
    fontWeight: '700',
  },
  catalogDescription: {
    color: '#b5c4ca',
    lineHeight: 21,
  },
  catalogButton: {
    marginTop: 8,
    backgroundColor: '#3b82f6',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
  },
  catalogButtonText: {
    color: '#edf4ff',
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#111b21',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#233138',
    gap: 8,
  },
  emptyChatCard: {
    margin: 16,
    backgroundColor: '#111b21',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#233138',
    gap: 12,
  },
  cardTitle: {
    color: '#f1f5f7',
    fontSize: 16,
    fontWeight: '700',
  },
  cardBody: {
    color: '#c6d2d7',
    lineHeight: 20,
  },
  cardMeta: {
    color: '#8ea1aa',
  },
  contactLine: {
    color: '#c6d2d7',
    lineHeight: 20,
  },
  profileHero: {
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
  },
  profileImage: {
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  editPhotoText: {
    color: '#60a5fa',
    fontSize: 16,
    fontWeight: '700',
  },
  settingsLine: {
    color: '#c6d2d7',
    fontSize: 15,
    lineHeight: 24,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#10181d',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 12,
  },
  sheetTitle: {
    color: '#f6f7f8',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  sheetOption: {
    backgroundColor: '#172228',
    borderRadius: 16,
    padding: 16,
  },
  sheetOptionTitle: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  sheetOptionBody: {
    color: '#9ab0b8',
    lineHeight: 19,
  },
  countryPickerButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#223149',
    backgroundColor: '#0f1620',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  countryPickerButtonLabel: {
    color: '#edf4ff',
    fontSize: 16,
    fontWeight: '800',
  },
  countryPickerButtonValue: {
    color: '#8ea1aa',
  },
  countryList: {
    maxHeight: 360,
  },
  countryRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#223149',
  },
  scannerView: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'space-between',
    backgroundColor: '#0f1620',
    borderRadius: 14,
    padding: 12,
  },
  deviceRowCopy: {
    flex: 1,
  },
  sheetBack: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  sheetBackText: {
    color: '#60a5fa',
    fontWeight: '700',
  },
  dialog: {
    width: '92%',
    maxWidth: 560,
    alignSelf: 'center',
    backgroundColor: 'rgba(12, 19, 30, 0.96)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
    padding: 24,
    gap: 14,
  },
  sheetDialog: {
    marginHorizontal: 24,
    maxHeight: '82%',
    backgroundColor: '#111b21',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.72)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  authDismissOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 14, 0.9)',
  },
  authWelcomeScreen: {
    flex: 1,
    backgroundColor: '#070B24',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 54,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  authFlowScreen: {
    flex: 1,
    backgroundColor: '#070B24',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 34,
    paddingBottom: 12,
  },
  authFlowScroll: {
    flex: 1,
  },
  authFlowScrollContent: {
    paddingBottom: 4,
  },
  authWelcomeCard: {
    width: '100%',
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 8,
    paddingBottom: 18,
    overflow: 'visible',
  },
  authFlowCard: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 8,
  },
  authWelcomeBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  authWelcomeGlowOuter: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(34, 211, 238, 0.28)',
    top: -120,
    right: -120,
  },
  authWelcomeGlowInner: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(232, 121, 249, 0.32)',
    bottom: -120,
    left: -90,
  },
  authBrandIcon: {
    position: 'absolute',
    top: 32,
    right: 28,
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authBrandIconText: {
    color: '#f8fbff',
    fontSize: 24,
    fontWeight: '800',
  },
  authWelcomeTopSpacer: {
    flex: 1,
    minHeight: 120,
  },
  authBrandWordmark: {
    color: '#f8fbff',
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1.3,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  authBrandWordmarkAccent: {
    color: '#F5C518',
  },
  bootstrapScreen: {
    flex: 1,
    backgroundColor: '#070B18',
  },
  splashStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  splashLogo: {
    width: '100%',
    height: 120,
  },
  splashContinueWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  splashContinue: {
    paddingHorizontal: 28,
    paddingBottom: 108,
  },
  bootstrapArt: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  brandHeaderLockup: {
    width: 168,
    height: 42,
  },
  authLoginBrand: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 18,
  },
  authLoginMark: {
    width: 108,
    height: 108,
  },
  authLoginWordmark: {
    width: 210,
    height: 54,
    marginTop: 4,
  },
  authLoginTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  authLoginSubtitle: {
    color: '#c9d0e6',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 26,
  },
  authLoginField: {
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  authLoginFieldIcon: {
    color: '#9aa3bd',
    fontSize: 16,
    marginRight: 10,
  },
  authLoginCode: {
    marginRight: 8,
  },
  authLoginCodeText: {
    color: '#f8fbff',
    fontWeight: '700',
    fontSize: 15,
  },
  authLoginInput: {
    flex: 1,
    color: '#f8fbff',
    fontSize: 16,
    paddingVertical: 14,
  },
  authLoginEye: {
    fontSize: 16,
    marginLeft: 8,
  },
  authForgotWrap: {
    alignSelf: 'flex-end',
    marginBottom: 18,
    marginTop: 2,
  },
  authForgotText: {
    color: '#d5d8e6',
    fontSize: 14,
    fontWeight: '600',
  },
  authSwitchRow: {
    color: '#c9d0e6',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 15,
  },
  authSwitchLink: {
    color: '#22D3EE',
    fontWeight: '800',
  },
  brandButton: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  brandButtonDisabled: {
    opacity: 0.55,
  },
  brandButtonFill: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  brandButtonImage: {
    borderRadius: 28,
  },
  brandButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  authStepBrand: {
    alignItems: 'center',
    marginBottom: 8,
  },
  authStepMark: {
    width: 72,
    height: 72,
  },
  authStepWordmark: {
    width: 150,
    height: 38,
    marginTop: 2,
  },
  bootstrapLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  bootstrapLoaderSpinner: {
    marginTop: 24,
  },
  bootstrapLoaderTitle: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 18,
  },
  bootstrapLoaderBody: {
    color: '#9fb2c9',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 260,
  },
  authWelcomeTagline: {
    color: '#f8fbff',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    marginTop: 18,
  },
  authWelcomeSubline: {
    color: '#b7c7de',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  authPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 26,
  },
  authFeaturePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
  },
  authFeaturePillText: {
    color: '#d8e4f2',
    fontWeight: '700',
    fontSize: 13,
  },
  authWelcomeFooter: {
    marginTop: 28,
    gap: 12,
  },
  authPrimaryButton: {
    minHeight: 58,
    borderRadius: 28,
    backgroundColor: '#22D3EE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 0,
    overflow: 'hidden',
  },
  authPrimaryButtonText: {
    color: '#08111f',
    fontSize: 16,
    fontWeight: '800',
  },
  authSecondaryButton: {
    minHeight: 54,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  authSecondaryButtonText: {
    color: '#edf4ff',
    fontSize: 15,
    fontWeight: '700',
  },
  authLegalText: {
    color: '#97abc2',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 2,
  },
  authLegalLink: {
    color: '#22D3EE',
    fontWeight: '700',
  },
  authStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  authBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  authBackButtonText: {
    color: '#f8fbff',
    fontSize: 24,
    fontWeight: '500',
    marginTop: -2,
  },
  authProgressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginRight: 12,
  },
  authProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#E879F9',
  },
  authProgressLabel: {
    color: '#c4b5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  authStepEmoji: {
    fontSize: 40,
    marginBottom: 8,
    textAlign: 'center',
    alignSelf: 'center',
  },
  authStepTitle: {
    color: '#f8fbff',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    fontFamily: DISPLAY_FONT_FAMILY,
    textAlign: 'center',
  },
  authStepAccent: {
    color: '#22D3EE',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 8,
    fontFamily: DISPLAY_FONT_FAMILY,
    textAlign: 'center',
  },
  authStepBody: {
    color: '#c4b5fd',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  authPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 28,
    marginBottom: 14,
  },
  authCountryChip: {
    minHeight: 58,
    minWidth: 108,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
  },
  authCountryChipText: {
    color: '#f8fbff',
    fontSize: 16,
    fontWeight: '700',
  },
  authCountryChevron: {
    color: '#f8fbff',
    fontSize: 14,
    fontWeight: '700',
  },
  authPhoneInput: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 18,
  },
  authStepHint: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  authOtpRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginBottom: 14,
  },
  authOtpBox: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authOtpBoxFilled: {
    backgroundColor: 'rgba(34, 211, 238, 0.22)',
    borderColor: '#22D3EE',
  },
  authOtpBoxText: {
    color: '#f8fbff',
    fontSize: 21,
    fontWeight: '800',
  },
  authOtpBoxTextFilled: {
    color: '#f8fbff',
  },
  authResendText: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 14,
    textAlign: 'center',
  },
  authResendAccent: {
    color: '#f8fbff',
    fontWeight: '700',
  },
  authKeypadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  authKeypadKey: {
    width: '30%',
    aspectRatio: 1,
    maxHeight: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authKeypadKeyBlank: {
    backgroundColor: 'transparent',
  },
  authKeypadKeyText: {
    color: '#f8fbff',
    fontSize: 21,
    fontWeight: '700',
  },
  authFooterDock: {
    backgroundColor: '#070B24',
    paddingTop: 10,
  },
  authProfilePhotoWrap: {
    width: 118,
    height: 118,
    borderRadius: 34,
    backgroundColor: '#eef2f7',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  authProfilePhotoImage: {
    width: '100%',
    height: '100%',
  },
  authProfilePhotoPlaceholder: {
    flex: 1,
    backgroundColor: '#eef2f7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authProfilePhotoEmoji: {
    fontSize: 42,
  },
  authProfilePhotoAdd: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authProfilePhotoAddText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: -1,
  },
  authPhotoHelper: {
    color: '#6b7280',
    textAlign: 'center',
    fontSize: 13,
    marginBottom: 18,
  },
  authFieldLabel: {
    color: '#f8fbff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 10,
  },
  authProfileInput: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    color: '#f8fbff',
    fontSize: 15,
    paddingHorizontal: 16,
  },
  authUsernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
    overflow: 'hidden',
  },
  authUsernamePrefix: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authUsernamePrefixText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '700',
  },
  authUsernameInput: {
    flex: 1,
    color: '#f8fbff',
    fontSize: 15,
    paddingRight: 16,
    paddingVertical: 15,
  },
  authUsernameHint: {
    color: '#2563eb',
    fontSize: 12,
    marginTop: 8,
  },
  authAccountCopy: {
    marginTop: 2,
    marginBottom: 20,
  },
  authAccountCard: {
    borderRadius: 22,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 18,
    marginBottom: 12,
  },
  authAccountCardSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#60a5fa',
  },
  authAccountCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  authAccountEmoji: {
    fontSize: 26,
  },
  authAccountCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authAccountCheckText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  authAccountTitle: {
    color: '#f8fbff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  authAccountBody: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 21,
  },
  authAccountFootnote: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  authStepFooter: {
    marginTop: 24,
  },
  authDarkButton: {
    minHeight: 58,
    borderRadius: 28,
    backgroundColor: '#A855F7',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  authDarkButtonDisabled: {
    opacity: 0.7,
  },
  authDarkButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  authInlineStatusText: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  authBackdropPreview: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#01040a',
    overflow: 'hidden',
  },
  authBackdropGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 999,
    opacity: 0.22,
  },
  authBackdropGlowTop: {
    top: -40,
    left: -70,
    backgroundColor: '#2563eb',
  },
  authBackdropGlowBottom: {
    right: -80,
    bottom: -30,
    backgroundColor: '#1d4ed8',
  },
  authBackdropWord: {
    position: 'absolute',
    top: '14%',
    left: 26,
    color: '#d9e8ff',
    fontSize: 38,
    fontWeight: '900',
  },
  authBackdropChip: {
    position: 'absolute',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(14,23,36,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.18)',
  },
  authBackdropChipTitle: {
    top: '24%',
    right: 20,
  },
  authBackdropChipReply: {
    top: '44%',
    left: 22,
  },
  authBackdropChipCall: {
    bottom: '26%',
    left: 28,
  },
  authBackdropChipStatus: {
    bottom: '16%',
    right: 18,
  },
  authBackdropChipText: {
    color: '#dbe5ea',
    fontWeight: '700',
  },
  callDropdownOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'flex-end',
    paddingTop: 132,
    paddingRight: 18,
  },
  callDropdown: {
    width: 180,
    backgroundColor: '#111b21',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#223149',
    padding: 8,
    gap: 6,
  },
  callDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#172228',
  },
  dialogTitle: {
    color: '#f6f7f8',
    fontSize: 18,
    fontWeight: '800',
  },
  dialogAction: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#172228',
  },
  dialogActionTitle: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  dialogActionBody: {
    color: '#9ab0b8',
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: 24,
    zIndex: 1,
  },
  viewerCloseText: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
  },
  viewerImage: {
    width: '100%',
    height: '70%',
  },
  viewerPlaceholder: {
    width: '100%',
    height: '70%',
    borderRadius: 24,
    backgroundColor: '#d8b182',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerPlaceholderTitle: {
    color: '#1b1d20',
    fontSize: 24,
    fontWeight: '800',
  },
  statusComposerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  statusComposerSheet: {
    backgroundColor: '#10181d',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 14,
  },
  statusComposerOverlayFill: {
    justifyContent: 'flex-start',
  },
  statusComposerSheetFill: {
    flex: 1,
    borderRadius: 0,
  },
  statusCanvasScroll: {
    flex: 1,
    borderRadius: 18,
  },
  statusCanvasContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  statusCanvasInput: {
    color: '#ffffff',
    fontWeight: '800',
    textAlign: 'center',
    minHeight: 180,
  },
  statusToolsToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  statusToolsToggleText: {
    color: '#f6f7f8',
    fontWeight: '700',
  },
  statusToolsPanel: {
    maxHeight: 180,
  },
  statusComposerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusComposerTitle: {
    color: '#f6f7f8',
    fontSize: 20,
    fontWeight: '800',
  },
  statusComposerPreview: {
    minHeight: 160,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  statusComposerPreviewText: {
    color: '#f6f7f8',
    textAlign: 'center',
    fontWeight: '800',
  },
  statusOptionLabel: {
    color: '#c6d2d7',
    fontWeight: '700',
  },
  statusOptionRow: {
    gap: 10,
  },
  statusColorChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  statusColorChipActive: {
    borderColor: '#f6f7f8',
  },
  statusFontChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#172228',
  },
  statusFontChipActive: {
    backgroundColor: '#3b82f6',
  },
  statusFontChipText: {
    color: '#edf4ff',
    fontWeight: '700',
  },
  statusSizeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statusSizeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#172228',
  },
  storyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,6,12,0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
  },
  storySheet: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#050a12',
  },
  storyTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    paddingTop: 16,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(4,9,16,0.3)',
  },
  storyProgressRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  storyProgressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  storyProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#f5f7fa',
  },
  storyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  storyHeaderUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storyHeaderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0d121a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyHeaderAvatarText: {
    color: '#edf4ff',
    fontWeight: '800',
  },
  storyHeaderTitle: {
    color: '#f6f7f8',
    fontSize: 15,
    fontWeight: '800',
  },
  storyHeaderMeta: {
    color: '#cad4dc',
    fontSize: 12,
    marginTop: 2,
  },
  storyClose: {
    color: '#f6f7f8',
    fontSize: 15,
    fontWeight: '700',
  },
  storyBody: {
    flex: 1,
    position: 'relative',
  },
  storyNavLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 230,
    width: '28%',
    zIndex: 2,
  },
  storyNavRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 230,
    width: '28%',
    zIndex: 2,
  },
  storyMediaShell: {
    flex: 1,
    width: '100%',
    position: 'relative',
    backgroundColor: '#070b12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyMedia: {
    width: '100%',
    height: '100%',
  },
  storyFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#162235',
  },
  storyFallbackText: {
    color: '#edf4ff',
    fontSize: 42,
    fontWeight: '800',
    textAlign: 'center',
    paddingHorizontal: 28,
  },
  storyCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    zIndex: 6,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    backgroundColor: 'rgba(4,8,14,0.55)',
  },
  storyCaptionTitle: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '800',
  },
  storyCaptionBody: {
    color: '#edf3f8',
    lineHeight: 21,
    marginTop: 8,
  },
  storyStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 12,
  },
  storyStatText: {
    color: '#dbe5ea',
    fontSize: 13,
    fontWeight: '700',
  },
  storyReactionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  storyReactionChip: {
    minWidth: 58,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(15,24,36,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    flexDirection: 'row',
  },
  storyReactionChipActive: {
    backgroundColor: '#1d4ed8',
  },
  storyReactionChipText: {
    fontSize: 16,
    color: '#edf4ff',
    fontWeight: '700',
  },
  storyActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    alignItems: 'center',
  },
  storyActionButton: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(15,24,36,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  storyActionButtonPrimary: {
    flex: 1,
    backgroundColor: '#2f3640',
  },
  storyActionButtonDone: {
    backgroundColor: '#16a34a',
  },
  storyActionButtonText: {
    color: '#edf4ff',
    fontWeight: '800',
    fontSize: 15,
  },
  storyActionButtonTextPrimary: {
    color: '#f8fbff',
  },
  callVideoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  callVideoTile: {
    flex: 1,
    minHeight: 180,
    borderRadius: 18,
    backgroundColor: '#0a1018',
  },
  callVideoTilePlaceholder: {
    flex: 1,
    minHeight: 180,
    borderRadius: 18,
    backgroundColor: '#0a1018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callAudioRow: {
    gap: 10,
    marginTop: 14,
  },
  callScreen: {
    flex: 1,
    backgroundColor: '#070B24',
  },
  callStageMain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#12082E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callFullPhoto: {
    ...StyleSheet.absoluteFillObject,
  },
  callFullPhotoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1038',
  },
  callFullPhotoLetter: {
    color: '#f7fbfc',
    fontSize: 96,
    fontWeight: '800',
  },
  callStagePip: {
    position: 'absolute',
    top: 88,
    right: 16,
    width: 112,
    height: 168,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: '#111',
  },
  callStagePipVideo: {
    width: '100%',
    height: '100%',
  },
  callScreenTop: {
    position: 'absolute',
    top: 54,
    left: 20,
    right: 140,
  },
  callScreenName: {
    color: '#f7fbfc',
    fontSize: 28,
    fontWeight: '800',
  },
  callScreenStatus: {
    color: '#d5e4ea',
    marginTop: 4,
    fontSize: 15,
  },
  callScreenError: {
    color: '#ffb4b4',
    marginTop: 8,
  },
  callScreenActions: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 36,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  callControl: {
    minWidth: 72,
    height: 64,
    paddingHorizontal: 12,
    borderRadius: 32,
    backgroundColor: 'rgba(18, 12, 48, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callControlActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.28)',
  },
  callControlText: {
    color: '#f8fbff',
    fontSize: 13,
    fontWeight: '800',
  },
  callControlDisabled: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  callControlTextDisabled: {
    color: '#8b9794',
  },
  lockOverlay: {
    flex: 1,
    backgroundColor: '#070B24',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  callMiniBar: {
    position: 'absolute',
    top: 8,
    right: 10,
    zIndex: 40,
    backgroundColor: '#7C3AED',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  callMiniName: {
    color: '#ffffff',
    fontWeight: '800',
  },
  callMiniTime: {
    color: '#e7fff6',
    fontWeight: '700',
  },
  callFloat: {
    position: 'absolute',
    zIndex: 40,
    width: 112,
    height: 168,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#10211b',
  },
  callFloatVideo: {
    width: '100%',
    height: '100%',
  },
  callFloatTime: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    color: '#ffffff',
    fontWeight: '800',
  },
  callRoundButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callAnswerButton: {
    backgroundColor: '#22c55e',
  },
  callEndButton: {
    backgroundColor: '#FF2D3A',
  },
  callRoundButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 16,
  },
  callRoundSpacer: {
    width: 84,
    height: 84,
  },
  callSideButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  callSideButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  peerProfileScreen: {
    flex: 1,
    backgroundColor: '#0b1418',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  peerProfileName: {
    color: '#f7fbfc',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 16,
  },
  peerProfileMeta: {
    color: '#c5d5dc',
    fontSize: 15,
    textAlign: 'center',
  },
  peerCatalogList: {
    alignSelf: 'stretch',
    marginTop: 18,
    maxHeight: 320,
  },
  peerCatalogCard: {
    paddingVertical: 10,
    gap: 6,
  },
  peerCatalogImage: {
    width: '100%',
    height: 140,
    borderRadius: 12,
  },
  catalogActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  catalogChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#12324a',
  },
  catalogChipText: {
    color: '#f4f8fb',
    fontWeight: '700',
    fontSize: 13,
  },
  callAudioPill: {
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: '#0a1018',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  storyCommentList: {
    marginTop: 14,
    gap: 8,
  },
  storyCommentPreview: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(8,14,24,0.72)',
  },
  storyCommentItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(8,14,24,0.72)',
    gap: 10,
  },
  storyCommentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  storyCommentIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  storyCommentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#162235',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCommentAvatarText: {
    color: '#edf4ff',
    fontWeight: '800',
    fontSize: 12,
  },
  storyCommentCopy: {
    flex: 1,
  },
  storyCommentMeta: {
    color: '#9ab0b8',
    fontSize: 12,
    marginTop: 2,
  },
  storyCommentAuthor: {
    color: '#f6f7f8',
    fontWeight: '700',
  },
  storyCommentText: {
    color: '#dbe5ea',
    lineHeight: 19,
  },
  storyCommentActions: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  storyCommentActionText: {
    color: '#60a5fa',
    fontWeight: '700',
  },
  storyCommentDeleteText: {
    color: '#f87171',
  },
  storyCommentEditor: {
    borderRadius: 14,
    backgroundColor: '#111b21',
    color: '#f2f4f5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  viewerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#233138',
  },
  authTabRow: {
    flexDirection: 'row',
    gap: 8,
  },
  authTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#172228',
    alignItems: 'center',
  },
  authTabActive: {
    backgroundColor: '#3b82f6',
  },
  authTabText: {
    color: '#edf4ff',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  authAccountList: {
    gap: 10,
  },
  settingsProfileName: {
    color: '#f6f7f8',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  settingsProfileMeta: {
    color: '#9ab0b8',
    textAlign: 'center',
    lineHeight: 20,
  },
  profileImageFallback: {
    backgroundColor: '#1d4ed8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileImageFallbackText: {
    color: '#edf4ff',
    fontSize: 42,
    fontWeight: '800',
  },
  settingsMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#223149',
  },
  settingsMenuIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#172228',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsMenuIcon: {
    color: '#60a5fa',
    fontSize: 18,
    fontWeight: '700',
  },
  settingsMenuCopy: {
    flex: 1,
    gap: 2,
  },
  settingsMenuTitle: {
    color: '#f6f7f8',
    fontSize: 16,
    fontWeight: '700',
  },
  settingsMenuSubtitle: {
    color: '#8ea1aa',
    fontSize: 13,
    lineHeight: 18,
  },
  settingsPanelScroll: {
    maxHeight: 460,
  },
  settingsPanelBody: {
    gap: 12,
  },
  settingsSectionCaption: {
    color: '#8ea1aa',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
  },
  settingsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#223149',
  },
  settingsToggleCopy: {
    flex: 1,
    gap: 4,
  },
  settingsToggleLabel: {
    color: '#f6f7f8',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsToggleHelper: {
    color: '#8ea1aa',
    fontSize: 12,
    lineHeight: 17,
  },
  settingsChoiceBlock: {
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#223149',
  },
  settingsChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  settingsChoiceChip: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#172228',
  },
  settingsChoiceChipActive: {
    backgroundColor: '#1d4ed8',
  },
  settingsChoiceChipText: {
    color: '#c6d2d7',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  settingsChoiceChipTextActive: {
    color: '#edf4ff',
  },
  settingsListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#223149',
  },
  settingsListCopy: {
    flex: 1,
    gap: 3,
  },
  settingsListTitle: {
    color: '#f6f7f8',
    fontSize: 15,
    fontWeight: '700',
  },
  settingsListSubtitle: {
    color: '#8ea1aa',
    fontSize: 12,
    lineHeight: 17,
  },
  settingsListChevron: {
    color: '#7d8b92',
    fontSize: 22,
    fontWeight: '300',
  },
  settingsDangerText: {
    color: '#f87171',
  },
  inputReadonly: {
    opacity: 0.7,
  },
  chatHomeFavoriteStar: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '800',
    marginRight: 2,
  },
  chatHomeMuteIcon: {
    fontSize: 12,
  },
  chatSearchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: '#eef1f6',
    color: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  replyQuoteCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#60a5fa',
    backgroundColor: 'rgba(15,24,36,0.35)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
  },
  replyQuoteText: {
    color: '#dbe5ea',
    fontSize: 12,
    lineHeight: 16,
  },
  replyComposerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#172228',
  },
  replyComposerCopy: {
    flex: 1,
    gap: 2,
  },
  replyComposerLabel: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '700',
  },
  replyComposerText: {
    color: '#c6d2d7',
    fontSize: 13,
  },
  replyComposerClose: {
    color: '#9ab0b8',
    fontSize: 16,
    fontWeight: '700',
    padding: 4,
  },
  messageDeletedBubble: {
    opacity: 0.72,
  },
  messageAutomatedBubble: {
    borderWidth: 1,
    borderColor: '#9bb8b3',
  },
  automatedBadge: {
    fontSize: 11,
    color: '#5f7a75',
    marginBottom: 4,
    fontWeight: '600',
  },
  chatCameraScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  chatCameraPreview: {
    flex: 1,
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatCameraActions: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#0f1620',
  },
  locationCard: {
    width: 220,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#12352c',
  },
  locationMap: {
    height: 96,
    backgroundColor: '#1f6b52',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationPin: {
    fontSize: 28,
  },
  locationTitle: {
    color: '#f4fbf8',
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  locationMeta: {
    color: '#b7d7cb',
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
  },
  wallpaperMarks: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  wallpaperMark: {
    position: 'absolute',
    color: '#1f8a6d',
    fontSize: 42,
    fontWeight: '800',
    opacity: 0.12,
  },
  wallpaperBase: {
    backgroundColor: 'transparent',
  },
  wallpaperZynkup: {
    backgroundColor: 'transparent',
  },
  wallpaperNight: {
    backgroundColor: 'transparent',
  },
  wallpaperPlain: {
    backgroundColor: 'transparent',
  },
  statusAddBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#15c79a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusFeedDotSeen: {
    backgroundColor: '#c5cdd6',
  },
  storyReactionCount: {
    color: '#f7fbfc',
    fontWeight: '800',
    marginLeft: 4,
  },
});
