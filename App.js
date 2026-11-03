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
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { io } from 'socket.io-client';
import { firebaseAuth, firebaseConfigReady, nativeFirebaseReady } from './firebaseConfig';

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
const DocumentPickerTypes = documentPickerModule?.types ?? {};
const launchImageLibrary = loadOptionalModule(() => require('react-native-image-picker'))?.launchImageLibrary
  ?? null;
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
const tabs = ['Chats', 'Calls', 'Status', 'Pay', 'Business'];
const SETTINGS_STORAGE_KEY = 'zynkup-mobile-app-settings';
const FAVORITES_STORAGE_KEY = 'zynkup-mobile-favorite-chats';
const MUTED_CHATS_STORAGE_KEY = 'zynkup-mobile-muted-chats';
const ARCHIVED_CHATS_STORAGE_KEY = 'zynkup-mobile-archived-chats';
const APP_LOCK_PIN_KEY = 'zynkup-mobile-app-lock-pin';
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
  readReceiptsEnabled: true,
  appLockEnabled: false,
};
const SETTINGS_MENU = [
  { id: 'favorites', title: 'Favorites', subtitle: 'Pin important chats to the top', icon: '★' },
  { id: 'business', title: 'Business tools', subtitle: 'Catalog, customers, broadcast', icon: '⌂' },
  { id: 'history', title: 'Chat history', subtitle: 'Export or clear conversations', icon: '▤' },
  { id: 'account', title: 'Account', subtitle: 'Security, phone number, delete account', icon: '◎' },
  { id: 'privacy', title: 'Privacy', subtitle: 'Last seen, read receipts, status', icon: '◌' },
  { id: 'chats', title: 'Chats', subtitle: 'Theme, media, enter is send', icon: '◫' },
  { id: 'notifications', title: 'Notifications', subtitle: 'Message alerts and previews', icon: '◉' },
  { id: 'storage', title: 'Storage and data', subtitle: 'Network usage and cache', icon: '▦' },
  { id: 'help', title: 'Help and feedback', subtitle: 'FAQ and contact support', icon: '?' },
];
const emojiOptions = ['😀', '😂', '🤣', '😍', '🔥', '🙏', '🎉', '❤️'];
const tabBadges = {
  Chats: 0,
  Calls: 0,
  Status: 0,
  Pay: 0,
  Business: 0,
};
const statusBackgroundOptions = ['#10233e', '#1f2937', '#14532d', '#7c2d12', '#581c87'];
const statusFontOptions = ['System', 'serif', 'monospace'];
const statusReactionOptions = ['❤️', '👍', '👎', '🔥', '😂'];
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const LAUGHING_EMOJIS = new Set(['😂', '🤣', '😆', '😄', '😹']);
const API_BASE_URL = Platform.select({
  // Use adb reverse for Android debug runs so the same host works on emulator and physical devices.
  android: 'http://localhost:4000',
  default: 'http://localhost:4000',
});
const DEVICE_STORAGE_KEY = 'zynkup-mobile-device-id';
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const BOOTSTRAP_TIMEOUT_MS = 5000;
const WEBRTC_CONFIGURATION = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

const COUNTRY_OPTIONS = Object.entries(countries)
  .flatMap(([code, country]) =>
    (country.phone ?? []).map((phoneCode) => ({
      code,
      name: country.name,
      dialCode: `+${phoneCode}`,
      flag: country.emoji ?? code,
    })),
  )
  .sort((left, right) => left.name.localeCompare(right.name));

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

function AppContent() {
  const insets = useSafeAreaInsets();
  const navBottomInset = Math.max(insets.bottom, 12);
  const authBottomInset = Math.max(insets.bottom + 18, 30);
  const modalBottomInset = Math.max(insets.bottom + 20, 28);
  const lightContentBottomInset = navBottomInset + 18;
  const [activeView, setActiveView] = useState('Chats');
  const [chatMode, setChatMode] = useState('personal');
  const [chatScreen, setChatScreen] = useState('list');
  const [selectedChatId, setSelectedChatId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [usersById, setUsersById] = useState({});
  const [chatItems, setChatItems] = useState(chats);
  const [contactItems, setContactItems] = useState(contacts);
  const [messageDraft, setMessageDraft] = useState('');
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
    photoUri: '',
  });
  const [settingsPanel, setSettingsPanel] = useState('');
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [favoriteChatIds, setFavoriteChatIds] = useState([]);
  const [mutedChatIds, setMutedChatIds] = useState([]);
  const [archivedChatIds, setArchivedChatIds] = useState([]);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const [messageActionTarget, setMessageActionTarget] = useState(null);
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
    category: 'Fashion',
    description: '',
    stockQuantity: '10',
  });
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory] = useState('All');
  const [statusAssetUris, setStatusAssetUris] = useState([]);
  const [catalogImageUris, setCatalogImageUris] = useState([]);
  const [updatesFeed, setUpdatesFeed] = useState([]);
  const [statusComposerVisible, setStatusComposerVisible] = useState(false);
  const [statusComposerMode, setStatusComposerMode] = useState('text'); // text | photo | video
  const [businessPanel, setBusinessPanel] = useState(''); // '' | catalog | customers | receipts | broadcast
  const [broadcastDraft, setBroadcastDraft] = useState('');
  const [paySheet, setPaySheet] = useState(''); // '' | send | request | topup | history
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
  const [recordingLabel, setRecordingLabel] = useState('');
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
  const phoneAuthConfirmationRef = useRef(null);
  const phoneAuthIdTokenRef = useRef('');
  const phoneAuthChallengeIdRef = useRef('');
  const phoneAuthProviderRef = useRef(''); // 'firebase' | 'backend'
  const forgotPinFlowRef = useRef(false);
  const toastTimeoutRef = useRef(null);
  const appSettingsRef = useRef(DEFAULT_APP_SETTINGS);

  const emojiAnim = useRef(new Animated.Value(0)).current;
  const animationRef = useRef(null);
  const timeoutsRef = useRef([]);
  const autoplayedRef = useRef(new Set());
  const recordingRef = useRef(null);
  const recordingDurationRef = useRef(0);
  const currentSoundRef = useRef(null);
  const socketRef = useRef(null);
  const updatesFeedRef = useRef([]);
  const statusGroupIndexRef = useRef(null);
  const statusItemIndexRef = useRef(0);
  const activeCallRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const callMediaStreamRef = useRef(null);
  const [cameraPermissionGranted, setCameraPermissionGranted] = useState(false);

  const activeChat = chatItems.find((chat) => chat.id === selectedChatId) ?? chatItems[0] ?? chats[0];
  const messages = messagesByChat[selectedChatId] ?? [];
  const activeStatusGroup = activeStatusGroupIndex === null ? null : updatesFeed[activeStatusGroupIndex] ?? null;
  const activeStatusItem = activeStatusGroup?.items?.[activeStatusItemIndex] ?? null;
  const statusPlaybackPaused =
    statusHoldActive ||
    statusThreadVisible ||
    statusReplyVisible ||
    statusViewersVisible ||
    statusReactorsVisible ||
    Boolean(statusCommentDraft.trim()) ||
    Boolean(editingStatusCommentId);

  const filteredCatalogItems = useMemo(() => {
    return catalogItems.filter((item) => {
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
    const businessMatcher = /(store|shop|business|board|room|receipt|market|kitchen|biz)/i;
    const query = chatSearchQuery.trim().toLowerCase();
    const personalChats = chatItems.filter((chat) => !businessMatcher.test(chat.name));
    const businessChats = chatItems.filter((chat) => businessMatcher.test(chat.name));
    const selectedItems = chatMode === 'business' ? businessChats : personalChats;
    const scoped = (selectedItems.length ? selectedItems : chatItems).filter((chat) => {
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
  }, [archivedChatIds, chatItems, chatMode, chatSearchQuery, favoriteChatIds, showArchivedChats]);

  const payQuickContacts = useMemo(() => {
    const merged = [
      ...contactItems.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone || '',
      })),
      ...chatItems.map((chat) => ({
        id: chat.id,
        name: chat.name,
        phone: usersById[chat.peerUserId]?.phone || '',
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

  const payTransactions = useMemo(() => {
    const base = payQuickContacts.slice(0, 3);
    const fallback = ['Afia', 'Maame Sika Store', 'Kwame'];
    return [0, 1, 2].map((index) => {
      const name = base[index]?.name ?? fallback[index];
      if (index === 0) {
        return { id: `${name}-sent`, title: `Sent to ${name}`, time: 'Today, 10:06 AM', amount: '-GHC 50', positive: false };
      }
      if (index === 1) {
        return { id: `${name}-merchant`, title: name, time: 'Today, 9:50 AM', amount: '-GHC 45', positive: false };
      }
      return { id: `${name}-received`, title: `Received from ${name}`, time: 'Yesterday, 3:12 PM', amount: '+GHC 200', positive: true };
    });
  }, [payQuickContacts]);

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

  const toggleArchiveChat = (chatId) => {
    const exists = archivedChatIds.includes(chatId);
    const next = exists ? archivedChatIds.filter((id) => id !== chatId) : [chatId, ...archivedChatIds];
    void persistArchivedChats(next);
    showToast(exists ? 'Chat unarchived' : 'Chat archived', 'success', 1400);
  };

  const mapServerMessage = (message, userId = currentUserId) => ({
    id: message.id,
    clientRef: message.clientRef,
    mine: message.senderId === userId,
    kind: message.deletedForEveryone ? 'text' : message.kind === 'file' ? 'text' : message.kind,
    text: message.text,
    time: formatClock(message.sentAt),
    imageUri: message.deletedForEveryone ? undefined : message.mediaUrls?.[0],
    audioUri: message.deletedForEveryone ? undefined : message.mediaUrls?.[0],
    videoUri: message.deletedForEveryone ? undefined : message.kind === 'video' ? message.mediaUrls?.[0] : undefined,
    durationLabel: message.durationSeconds ? getAudioDurationLabel(message.durationSeconds * 1000) : undefined,
    receiptState: message.state,
    replyToMessageId: message.replyToMessageId,
    replyPreview: message.replyPreview,
    deletedForEveryone: Boolean(message.deletedForEveryone),
  });

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
                kind: message.kind === 'image' || message.kind === 'voice' || message.kind === 'video' ? message.kind : 'text',
                text: message.text || 'Forwarded message',
                mediaUrls: message.imageUri || message.audioUri || message.videoUri
                  ? [message.imageUri || message.audioUri || message.videoUri].filter(Boolean)
                  : [],
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

  const getPresenceLabel = (chat) => {
    if (peerTypingByChat[chat?.id]) {
      return 'typing…';
    }
    const peer = usersById[chat?.peerUserId];
    if (!peer) {
      return chat?.presence || 'offline';
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
          about: nextProfile.about.trim() || 'Hey there! I am using ZynkUp.',
          phone: nextProfile.phone.trim() || undefined,
          username: nextProfile.username?.trim() || undefined,
          avatar,
          photoUri: nextProfile.photoUri || '',
          lastSeenPrivacy: nextSettings.lastSeenPrivacy,
          profilePhotoPrivacy: nextSettings.profilePhotoPrivacy,
          aboutPrivacy: nextSettings.aboutPrivacy,
          statusPrivacy: nextSettings.statusPrivacy,
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
          photoUri: payload.profile.photoUri ?? current.photoUri,
        }));
      }
      if (pinToSave.length === 4) {
        setAppLockPin(pinToSave);
        await AsyncStorage.setItem(APP_LOCK_PIN_KEY, pinToSave).catch(() => undefined);
      }
      if (nextSettings.appLockEnabled === false) {
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

    showToast('Uploading profile photo...', 'info', 0);
    try {
      const uploaded = await uploadUris([result.assets[0].uri], {
        names: [`profile-${Date.now()}.jpg`],
        fallbackType: 'image/jpeg',
      });
      const photoUri = uploaded[0] || result.assets[0].uri;
      setProfile((current) => ({ ...current, photoUri }));
      await saveProfileToServer({ photoUri });
    } catch {
      showToast('Could not upload profile photo.', 'error');
    }
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

  const hydrateBootstrapFromDevice = async (deviceIdHint) => {
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
            applyBootstrapPayload(payload);
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
          platform: Platform.OS,
          label: `${Platform.OS} device`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
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

  const resetPinAfterOtp = async () => {
    if (isAuthBusy) {
      return;
    }
    if (!isValidAuthPin(authForm.pin)) {
      showToast('Enter a new 4–6 digit PIN.', 'error');
      return;
    }
    if (!phoneAuthChallengeIdRef.current) {
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
          challengeId: phoneAuthChallengeIdRef.current,
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
        body: JSON.stringify({ countryCode, phoneNumber }),
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

      if (payload.registered && payload.hasPin) {
        forgotPinFlowRef.current = false;
        setAuthMode('pin');
        showToast('Welcome back. Enter your PIN.', 'success', 2200);
        return;
      }

      // New user or account without PIN — verify via OTP.
      forgotPinFlowRef.current = false;
      phoneAuthProviderRef.current = 'backend';
      await startBackendPhoneAuth(countryCode, phoneNumber, normalizedPhone);
    } catch {
      showToast('Network error while checking this phone number.', 'error');
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
    callMediaStreamRef.current?.getTracks?.().forEach((track) => track.stop());
    callMediaStreamRef.current = null;
    setLocalCallStream(null);
    setRemoteCallStream(null);
  };

  const ensureCallMedia = async (kind) => {
    if (!CAN_USE_NATIVE_WEBRTC || !mediaDevices) {
      throw new Error('native-webrtc-unavailable');
    }

    if (callMediaStreamRef.current) {
      return callMediaStreamRef.current;
    }

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'Video',
    });
    callMediaStreamRef.current = stream;
    setLocalCallStream(stream);
    return stream;
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

  const syncPhoneContacts = async (userId) => {
    if (!Contacts?.getAll) {
      return;
    }

    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CONTACTS);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        return;
      }
    } else {
      const permission = await Contacts.requestPermission();
      if (permission !== 'authorized') {
        return;
      }
    }

    const deviceContacts = await Contacts.getAll();
    const payloadContacts = deviceContacts
      .flatMap((contact) =>
        (contact.phoneNumbers ?? []).map((entry) => ({
          name: contact.displayName || 'Unknown',
          phone: entry.number ?? '',
        })),
      )
      .filter((contact) => contact.phone.trim().length >= 4);

    if (!payloadContacts.length) {
      setContactItems([]);
      return;
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
      return;
    }

    const payload = await response.json();
    setContactItems(payload.contacts ?? []);
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
    const remoteStream = await mediaDevices.getUserMedia({ audio: false, video: false }).catch(() => null);
    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteCallStream(stream);
      } else if (remoteStream) {
        remoteStream.addTrack(event.track);
        setRemoteCallStream(remoteStream);
      }
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

    const peerId = (chat.participants ?? []).find((participantId) => participantId !== userId);
    return userMap[peerId]?.name ?? chat.title;
  };

  const mapChatFromServer = (chat, userId, userMap) => {
    const peerUserId = chat.kind === 'direct'
      ? (chat.participants ?? []).find((participantId) => participantId !== userId)
      : undefined;
    const peer = peerUserId ? userMap[peerUserId] : null;
    return {
      id: chat.id,
      name: getChatTitle(chat, userId, userMap),
      preview: chat.lastMessagePreview,
      unread: chat.unreadCount ?? 0,
      presence: peer?.presence ?? 'offline',
      lastSeenAt: peer?.lastSeenAt,
      time: formatClock(chat.updatedAt ?? new Date().toISOString()),
      peerUserId,
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
    name: userId === currentUserId ? 'You' : (usersById[userId]?.name ?? userId),
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
      const mapped = mapServerMessage(incomingMessage, currentUserId);

      if (existingIndex >= 0) {
        const next = [...existing];
        next[existingIndex] = { ...next[existingIndex], ...mapped };
        return { ...current, [chatId]: next };
      }

      return { ...current, [chatId]: [...existing, mapped] };
    });
  };

  const upsertStatus = (status) => {
    const mappedStatus = {
      ...status,
      author: usersById[status.userId]?.name ?? (status.userId === currentUserId ? 'You' : 'User'),
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
              name: usersById[status.userId]?.name ?? (status.userId === currentUserId ? profile.name : 'Contact'),
              avatar: usersById[status.userId]?.avatar ?? (status.userId === currentUserId ? profile.name.slice(0, 2).toUpperCase() : 'CT'),
              latestAt: status.createdAt,
              items: [status],
            },
            ...current,
          ],
    );
  };

  const applyBootstrapPayload = (payload) => {
    const nextCurrentUserId = payload.currentUserId ?? '';
    setBootstrapReady(true);
    setAuthRequired(Boolean(payload.authRequired));
    setAuthVisible(Boolean(payload.authRequired) && !nextCurrentUserId);
    const nextUsersById = Object.fromEntries((payload.users ?? []).map((user) => [user.id, user]));
    setCurrentUserId(nextCurrentUserId);
    setCurrentDeviceId(payload.currentDeviceId ?? null);
    setUsersById(nextUsersById);
    setProfile((current) => ({
      ...current,
      name: payload.profile?.name ?? current.name,
      username: payload.profile?.username ?? current.username,
      about: payload.profile?.about ?? current.about,
      phone: payload.profile?.phone ?? current.phone,
      photoUri: payload.profile?.photoUri || current.photoUri,
    }));
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
        presence: contact.presence,
      })),
    );
    setMessagesByChat(
      Object.fromEntries(
        Object.entries(payload.messagesByChat ?? {}).map(([chatId, list]) => [
          chatId,
          list.map((message) => mapServerMessage(message, nextCurrentUserId)),
        ]),
      ),
    );
    const nextCalls = (payload.calls ?? []).map((call) => mapCallFromServer(call, nextCurrentUserId, nextUsersById));
    setCalls(nextCalls);
    const liveCall = nextCalls.find((call) => call.state === 'ongoing' || call.state === 'ringing') ?? null;
    setActiveCall(liveCall);
    setIncomingCall(nextCalls.find((call) => call.state === 'ringing' && call.initiatorId !== nextCurrentUserId) ?? null);
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
    setCatalogItems(
      (payload.catalogItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        price: `${item.currency ?? 'GHS'} ${item.price}`,
        category: item.category,
        seller: payload.users?.find((user) => user.id === item.sellerId)?.name ?? 'Seller',
        description: item.description,
        stockQuantity: item.stockQuantity ?? 0,
        imageUri: item.imageUrls?.[0] ?? null,
        imageUris: item.imageUrls ?? [],
      })),
    );
    if (!payload.authRequired && nextCurrentUserId) {
      void syncPhoneContacts(nextCurrentUserId);
      void fetchLinkedDevices(nextCurrentUserId);
    }
  };

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
      try {
        const response = await fetchWithTimeout(`${API_BASE_URL}/api/session/ensure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: storedDeviceId ?? undefined,
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
            setBootstrapReady(true);
          }
        }
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
        applyBootstrapPayload(payload.bootstrap);
      }
    });
    socket.on('message:new', (message) => {
      reconcileIncomingMessage(message.chatId, message);

      if (message.senderId !== currentUserId) {
        const settings = appSettingsRef.current;
        const viewingChat = chatScreen === 'detail' && selectedChatId === message.chatId;
        const nextReceipt =
          viewingChat && settings.readReceiptsEnabled ? 'read' : 'delivered';
        void syncReceiptState(message.id, nextReceipt);

        if (
          settings.messageNotifications &&
          !viewingChat &&
          !mutedChatIdsRef.current.includes(message.chatId)
        ) {
          const senderName = usersById[message.senderId]?.name || 'New message';
          const preview = settings.showNotificationPreview
            ? (message.text || (message.kind === 'image' ? 'Photo' : message.kind === 'voice' ? 'Voice message' : 'New message'))
            : 'New message';
          showToast(`${senderName}: ${preview}`, 'info', settings.conversationTones ? 2800 : 1800);
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
      setUsersById((current) => ({
        ...current,
        [userId]: {
          ...(current[userId] ?? { id: userId, name: 'Contact', avatar: 'CT' }),
          presence,
          lastSeenAt: lastSeenAt ?? current[userId]?.lastSeenAt,
        },
      }));
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
        const mapped = mapChatFromServer(chat, currentUserId, usersById);
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
            title: item.title,
            price: `${item.currency ?? 'GHS'} ${item.price}`,
            category: item.category,
            seller: profile.name,
            description: item.description,
            stockQuantity: item.stockQuantity ?? 0,
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
                category: item.category ?? entry.category,
                description: item.description ?? entry.description,
                stockQuantity: item.stockQuantity ?? entry.stockQuantity ?? 0,
                imageUri: item.imageUrls?.[0] ?? entry.imageUri,
                imageUris: item.imageUrls ?? entry.imageUris,
              }
            : entry,
        ),
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
    socket.on('call:created', (call) => {
      if ((call.participantIds ?? []).includes(currentUserId)) {
        upsertCall(call);
      }
    });
    socket.on('call:incoming', (call) => {
      if ((call.participantIds ?? []).includes(currentUserId)) {
        upsertCall(call);
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

      void (async () => {
        try {
          const connection = await ensurePeerConnection(currentCall);
          if (signalType === 'offer') {
            await connection.setRemoteDescription(new RTCSessionDescriptionNative(payload));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            emitCallSignal(callId, 'answer', answer, fromUserId);
            return;
          }

          if (signalType === 'answer') {
            await connection.setRemoteDescription(new RTCSessionDescriptionNative(payload));
            return;
          }

          if (signalType === 'ice-candidate' && payload) {
            await connection.addIceCandidate(new RTCIceCandidateNative(payload));
          }
        } catch {
          setCallError('Call signaling lost sync.');
        }
      })();
    });

    if (currentUserId) {
      socket.emit('presence:update', { userId: currentUserId, presence: 'online' });
    }

    return () => {
      if (currentUserId) {
        socket.emit('presence:update', { userId: currentUserId, presence: 'offline' });
      }
      socket.disconnect();
    };
  }, [chatScreen, currentDeviceId, currentUserId, profile.name, selectedChatId, usersById]);

  useEffect(() => {
    void (async () => {
      try {
        const [storedSettings, storedFavorites, storedMuted, storedArchived, storedPin] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_STORAGE_KEY),
          AsyncStorage.getItem(FAVORITES_STORAGE_KEY),
          AsyncStorage.getItem(MUTED_CHATS_STORAGE_KEY),
          AsyncStorage.getItem(ARCHIVED_CHATS_STORAGE_KEY),
          AsyncStorage.getItem(APP_LOCK_PIN_KEY),
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
        if (storedPin && storedPin.length === 4) {
          setAppLockPin(storedPin);
        }
        if (nextSettings.appLockEnabled && storedPin && storedPin.length === 4) {
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
    if (chatScreen !== 'detail' || !appSettings.readReceiptsEnabled) {
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
  }, [activeStatusItem?.id, currentUserId]);

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
    if (!activeCall || !socketRef.current) {
      return undefined;
    }

    setCallError('');
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

  const appendMessage = (message) => {
    setMessagesByChat((current) => ({
      ...current,
      [selectedChatId]: [...(current[selectedChatId] ?? []), message],
    }));
  };

  const upsertCall = (incomingCallPayload) => {
    const mapped = mapCallFromServer(incomingCallPayload, currentUserId, usersById);
    setCalls((current) => {
      const existingIndex = current.findIndex((item) => item.id === mapped.id);
      if (existingIndex >= 0) {
        const next = [...current];
        next[existingIndex] = mapped;
        return next;
      }
      return [mapped, ...current];
    });

    if (mapped.state === 'ringing' && mapped.initiatorId !== currentUserId) {
      setIncomingCall(mapped);
    }
    if (mapped.state === 'ringing' || mapped.state === 'ongoing') {
      setActiveCall(mapped);
    }
    if (['completed', 'missed', 'declined'].includes(mapped.state)) {
      setIncomingCall((current) => (current?.id === mapped.id ? null : current));
      setActiveCall((current) => (current?.id === mapped.id ? null : current));
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
        setActiveStatusItemIndex(Math.max(0, (previousGroup?.items?.length ?? 1) - 1));
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
  };

  const sendMessage = () => {
    if (!messageDraft.trim()) {
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
      receiptState: 'sent',
      replyToMessageId: replyTarget?.id,
      replyPreview: replyTarget?.text?.slice(0, 140),
    };

    appendMessage(message);
    emitTyping(false);
    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: selectedChatId,
        senderId: currentUserId,
        clientRef,
        kind,
        text,
        mediaUrls: [],
        replyToMessageId: replyTarget?.id,
        replyPreview: replyTarget?.text?.slice(0, 140),
      }),
    }).catch(() => undefined);
    setMessageDraft('');
    setReplyTarget(null);
    setEmojiTrayVisible(false);

    if (kind === 'emoji') {
      playEmojiMessage(message);
    }
  };

  const addCatalogItem = async () => {
    if (!catalogForm.title.trim() || !catalogForm.price.trim()) {
      Alert.alert('Incomplete item', 'Add at least a title and price for the catalog item.');
      return;
    }

    showToast('Saving catalog item...', 'info', 0);
    const uploadedImageUrls = await uploadUris(catalogImageUris, {
      names: catalogImageUris.map((_, index) => `catalog-${Date.now()}-${index}.jpg`),
      fallbackType: 'image/jpeg',
    }).catch(() => []);

    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: currentUserId,
          title: catalogForm.title.trim(),
          price: Number.parseFloat(catalogForm.price) || 0,
          currency: 'GHS',
          category: catalogForm.category,
          description: catalogForm.description.trim() || 'New item from your business catalog.',
          stockQuantity: Number.parseInt(catalogForm.stockQuantity, 10) || 0,
          imageUrls: uploadedImageUrls.length
            ? uploadedImageUrls
            : ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80'],
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(payload, 'Could not save catalog item.'), 'error', 3600);
        return;
      }
      showToast('Catalog item published.', 'success');
      setCatalogForm({
        title: '',
        price: '',
        category: 'Fashion',
        description: '',
        stockQuantity: '10',
      });
      setCatalogImageUris([]);
    } catch {
      showToast('Network error while saving catalog item.', 'error');
    }
  };

  const adjustCatalogStock = async (itemId, nextStock) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockQuantity: Math.max(0, nextStock) }),
      });
      if (!response.ok) {
        showToast('Could not update stock.', 'error');
        return;
      }
      const payload = await response.json();
      if (payload.item) {
        setCatalogItems((current) =>
          current.map((item) => (item.id === payload.item.id ? { ...item, ...payload.item } : item)),
        );
      }
    } catch {
      showToast('Network error while updating stock.', 'error');
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
          currency: 'GHS',
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
        amount: `${paySheet === 'request' ? '+' : '-'}GHC ${amount.toFixed(2)}`,
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

  const sendBroadcast = async () => {
    const text = broadcastDraft.trim();
    if (!text) {
      showToast('Write a broadcast message first.', 'error');
      return;
    }

    const recipients = [
      ...new Set(
        [
          ...contactItems.map((contact) => contact.linkedUserId).filter(Boolean),
          ...Object.keys(usersById).filter((id) => id !== currentUserId),
        ],
      ),
    ];

    if (!recipients.length) {
      showToast('No registered customers yet. Sync contacts first.', 'error', 3600);
      return;
    }

    showToast(`Broadcasting to ${recipients.length} customers...`, 'info', 0);
    let sent = 0;
    await Promise.all(
      recipients.map(async (peerUserId) => {
        try {
          const chatResponse = await fetch(`${API_BASE_URL}/api/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, peerUserId }),
          });
          if (!chatResponse.ok) {
            return;
          }
          const chatPayload = await chatResponse.json();
          const chatId = chatPayload.chat?.id;
          if (!chatId) {
            return;
          }
          await fetch(`${API_BASE_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              senderId: currentUserId,
              clientRef: `broadcast-${Date.now()}-${peerUserId}`,
              kind: 'text',
              text,
              mediaUrls: [],
            }),
          });
          sent += 1;
        } catch {
          // Keep broadcasting to remaining recipients.
        }
      }),
    );

    setBroadcastDraft('');
    setBusinessPanel('');
    showToast(sent ? `Broadcast sent to ${sent} customer${sent === 1 ? '' : 's'}.` : 'Broadcast could not be delivered.', sent ? 'success' : 'error', 4200);
  };

  const addAttachmentMessage = (kind, name, source, uri = null) => {
    const clientRef = `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    appendMessage({
      id: `m${Date.now()}`,
      clientRef,
      mine: true,
      kind,
      text: name,
      time: 'Now',
      receiptState: 'sent',
      attachment: { kind, name, source },
      imageUri: kind === 'image' ? uri : undefined,
      videoUri: kind === 'video' ? uri : undefined,
    });
    return clientRef;
  };

  const persistAttachmentMessage = async (kind, name, source, uri = null) => {
    const clientRef = addAttachmentMessage(kind, name, source, uri);

    const uploadedUrls = uri
      ? await uploadUris([uri], {
          names: [name],
          fallbackType:
            kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'application/octet-stream',
        }).catch(() => [])
      : [];

    fetch(`${API_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: selectedChatId,
        senderId: currentUserId,
        clientRef,
        kind: kind === 'document' ? 'file' : kind,
        text: name,
        mediaUrls: uploadedUrls,
      }),
    }).catch(() => undefined);
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
          : [DocumentPickerTypes.allFiles];
    try {
      const [asset] = await pickDocument({
        type,
        copyTo: 'cachesDirectory',
        allowMultiSelection: false,
      });
      persistAttachmentMessage(kind, asset.name, 'file manager', asset.uri);
    } catch (error) {
      if (!(isDocumentPickerErrorWithCode(error) && error.code === DocumentPickerErrorCodes.OPERATION_CANCELED)) {
        Alert.alert('Files', 'Unable to open the file picker right now.');
      }
    }
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
          audience: 'contacts',
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        showToast(getBackendErrorMessage(payload, 'Could not post status.'), 'error', 3600);
        return;
      }
      setStatusDraft('');
      setStatusAssetUris([]);
      setStatusComposerMode('text');
      setStatusComposerVisible(false);
      showToast('Status posted.', 'success');
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
        : 'Code sent. Enter the OTP to continue.',
      'success',
      4200,
    );
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

    // Emulators cannot complete Firebase reCAPTCHA/Play Integrity reliably, so
    // development builds use the backend OTP challenge (code 123456).
    const preferBackendOtp = typeof __DEV__ !== 'undefined' && __DEV__;

    try {
      if (preferBackendOtp) {
        await startBackendPhoneAuth(countryCode, phoneNumber, normalizedPhone);
        return;
      }

      if (!nativeFirebaseReady || !firebaseAuth) {
        showToast(
          'Firebase phone auth is not available in this runtime. Open the installed app, not Expo Go.',
          'error',
          3600,
        );
        return;
      }

      if (!firebaseConfigReady) {
        showToast('Firebase mobile auth is not configured yet.', 'error');
        return;
      }

      phoneAuthConfirmationRef.current = await firebaseAuth.signInWithPhoneNumber(normalizedPhone);
      phoneAuthProviderRef.current = 'firebase';
      phoneAuthChallengeIdRef.current = '';
      setAuthForm((current) => ({
        ...current,
        otp: '',
        verifiedPhone: normalizedPhone,
      }));
      setAuthMode('otp');
      showToast('Code sent. Enter the OTP to continue.', 'success');
    } catch (error) {
      const firebaseCode = error?.code ?? '';
      const firebaseMessage = error?.message ?? '';
      console.warn('Phone auth send failed', firebaseCode, firebaseMessage, normalizedPhone);

      if (!preferBackendOtp) {
        try {
          await startBackendPhoneAuth(countryCode, phoneNumber, normalizedPhone);
          return;
        } catch (backendError) {
          console.warn('Backend OTP fallback failed', backendError);
        }
      }

      const friendlyMessage =
        firebaseCode === 'auth/invalid-phone-number'
          ? `That phone number looks invalid (${normalizedPhone}). Check the country code and drop any leading 0.`
          : firebaseCode === 'auth/too-many-requests'
            ? 'Too many SMS attempts. Wait a bit, or use a Firebase test phone number on the emulator.'
            : firebaseCode === 'auth/missing-client-identifier' || firebaseCode === 'auth/app-not-authorized'
              ? 'Firebase rejected this Android app. Add the debug SHA-1/SHA-256 in the Firebase console.'
              : firebaseCode === 'auth/quota-exceeded'
                ? 'Firebase SMS quota exceeded for this project.'
                : firebaseMessage || error?.message
                  ? `Unable to send OTP: ${firebaseMessage || error.message}`
                  : 'Unable to send the OTP right now. Check the phone number and your Firebase SMS settings.';
      showToast(friendlyMessage, 'error', 4800);
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

      let credential = null;
      try {
        credential = await phoneAuthConfirmationRef.current.confirm(authForm.otp.trim());
      } catch (error) {
        const firebaseCode = error?.code ?? '';
        showToast(
          firebaseCode === 'auth/invalid-verification-code'
            ? 'Firebase rejected that code. Check the test number/code in Firebase and try again.'
            : 'The OTP is invalid or expired.',
          'error',
        );
        return;
      }

      const verifiedPhone = credential?.user?.phoneNumber ?? authForm.verifiedPhone;
      const idToken = await credential?.user?.getIdToken(true);
      if (!idToken || !verifiedPhone) {
        showToast('Firebase verification succeeded, but the secure token could not be read.', 'error', 3600);
        return;
      }
      phoneAuthIdTokenRef.current = idToken;

      const response = await fetch(`${API_BASE_URL}/api/auth/phone/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authDevicePayload(),
          idToken,
          phone: verifiedPhone,
          platform: Platform.OS,
          label: `${Platform.OS} device`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(getBackendErrorMessage(payload, 'Unable to verify this phone on the server.'), 'error', 4200);
        return;
      }

      await applyVerifiedPhoneSession(payload, verifiedPhone);
    } catch {
      setAuthForm((current) => ({
        ...current,
        verifiedPhone: authForm.verifiedPhone,
      }));
      setAuthMode('profile');
      showToast('Phone verified. Network sync is slow, so continue registration.', 'success', 3600);
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
              ? 'Business account on Zynkup.'
              : 'Personal account on Zynkup.',
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
      setChatMode(accountType === 'business' ? 'business' : 'personal');
      setActiveView(accountType === 'business' ? 'Business' : 'Chats');
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

  const startCall = async (kind) => {
    setCallSheetVisible(false);
    if (!activeChat?.peerUserId) {
      return;
    }

    try {
      await ensureCallMedia(kind);
      setCallError('');
    } catch {
      setCallError(CAN_USE_NATIVE_WEBRTC ? 'Camera or microphone permission was denied.' : 'Use a development build for live calls.');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participantIds: [currentUserId, activeChat.peerUserId],
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

  const acceptIncomingCall = async () => {
    if (!incomingCall) {
      return;
    }

    try {
      await ensureCallMedia(incomingCall.kind);
      setCallError('');
    } catch {
      setCallError(CAN_USE_NATIVE_WEBRTC ? 'Camera or microphone permission was denied.' : 'Use a development build for live calls.');
      return;
    }
    await updateCallState(incomingCall.id, 'ongoing', incomingCall.durationSeconds);
    setIncomingCall(null);
  };

  const endActiveCall = async () => {
    if (!activeCall) {
      return;
    }

    const finalState =
      activeCall.state === 'ringing' && activeCall.initiatorId !== currentUserId ? 'declined' : 'completed';
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

  const stopVoicePlayback = async () => {
    if (!currentSoundRef.current) {
      return;
    }

    const sound = currentSoundRef.current;
    currentSoundRef.current = null;
    sound.removePlayBackListener();
    sound.removePlaybackEndListener();
    await sound.stopPlayer().catch(() => undefined);
  };

  const playVoiceMessage = async (message) => {
    if (!message.audioUri) {
      Alert.alert('Voice note', 'This is a placeholder voice note preview.');
      return;
    }

    try {
      await stopVoicePlayback();
      const sound = createSound();
      currentSoundRef.current = sound;
      sound.addPlaybackEndListener(() => {
        sound.removePlayBackListener();
        sound.removePlaybackEndListener();
        if (currentSoundRef.current === sound) {
          currentSoundRef.current = null;
        }
      });
      await sound.startPlayer(message.audioUri);
    } catch (error) {
      Alert.alert('Voice note', 'Unable to play this recording on the current device.');
    }
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

  const stopVoiceRecording = async () => {
    if (!recordingRef.current) {
      return;
    }

    try {
      const recorder = recordingRef.current;
      const duration = recordingDurationRef.current;
      const uri = await recorder.stopRecorder();
      recorder.removeRecordBackListener();
      recordingRef.current = null;
      recordingDurationRef.current = 0;
      setIsRecording(false);
      setRecordingLabel('');

      if (!uri) {
        return;
      }

      const clientRef = `mobile-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      appendMessage({
        id: `m${Date.now()}`,
        clientRef,
        mine: true,
        kind: 'voice',
        text: 'Voice note',
        time: 'Now',
        receiptState: 'sent',
        audioUri: uri,
        durationLabel: getAudioDurationLabel(duration),
      });
      const uploadedUrls = await uploadUris([uri], {
        names: [`voice-${Date.now()}.mp4`],
        fallbackType: inferMimeType(uri, 'audio/mp4'),
      }).catch(() => []);
      fetch(`${API_BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: selectedChatId,
          senderId: currentUserId,
          clientRef,
          kind: 'voice',
          text: 'Voice note',
          mediaUrls: uploadedUrls.length ? uploadedUrls : [uri],
          durationSeconds: Math.max(1, Math.round(duration / 1000)),
        }),
      }).catch(() => undefined);
    } catch (error) {
      if (recordingRef.current) {
        recordingRef.current.removeRecordBackListener();
        recordingRef.current = null;
      }
      recordingDurationRef.current = 0;
      setIsRecording(false);
      setRecordingLabel('');
      Alert.alert('Recording failed', 'Voice note recording could not be completed.');
    }
  };

  const ensureCameraPermission = async () => {
    if (!CameraKit?.checkDeviceCameraAuthorizationStatus || !CameraKit?.requestDeviceCameraAuthorization) {
      setCameraPermissionGranted(false);
      return false;
    }

    try {
      const granted = await CameraKit.checkDeviceCameraAuthorizationStatus();
      if (granted) {
        setCameraPermissionGranted(true);
        return true;
      }

      const requested = await CameraKit.requestDeviceCameraAuthorization();
      setCameraPermissionGranted(Boolean(requested));
      return Boolean(requested);
    } catch (error) {
      setCameraPermissionGranted(false);
      return false;
    }
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
                <Text style={styles.sheetOptionBody}>Open file manager</Text>
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

  const renderBubble = (message) => {
    const emojis = extractEmojiTokens(message.text ?? '');
    const emojiOnly = isEmojiOnlyMessage(message.text ?? '');

    const receiptGlyph = message.receiptState === 'sent' ? '✓' : '✓✓';

    return (
      <Pressable
        key={message.id}
        style={[
          styles.messageBubble,
          message.mine ? styles.messageMine : styles.messageTheirs,
          emojiOnly ? styles.emojiBubble : null,
          message.deletedForEveryone ? styles.messageDeletedBubble : null,
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

          if (message.kind === 'voice') {
            playVoiceMessage(message);
            return;
          }

          if (emojiOnly) {
            playEmojiMessage(message);
          }
        }}
      >
        {message.replyPreview ? (
          <View style={styles.replyQuoteCard}>
            <Text numberOfLines={2} style={styles.replyQuoteText}>{message.replyPreview}</Text>
          </View>
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

        {message.kind === 'voice' ? (
          <View style={styles.voiceNote}>
            <Text style={styles.voiceIcon}>▶</Text>
            <View style={styles.voiceBar} />
            <Text style={styles.voiceDuration}>{message.durationLabel}</Text>
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

        {message.kind === 'text' ? <Text style={styles.messageText}>{message.text}</Text> : null}

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
          onPressIn={startVoiceRecording}
          onPressOut={stopVoiceRecording}
        >
          <Text style={styles.micButtonText}>{isRecording ? '■' : '🎤'}</Text>
        </Pressable>
      </View>
    );
  };

  const renderChatDetail = () => (
    <View style={styles.detailScreen}>
      <View style={styles.detailHeader}>
        <Pressable style={styles.iconCircle} onPress={() => setChatScreen('list')}>
          <Text style={styles.iconText}>←</Text>
        </Pressable>
        <View style={styles.detailHeaderText}>
          <Text style={styles.detailTitle}>{activeChat.name}</Text>
          <Text style={styles.detailSubtitle}>{getPresenceLabel(activeChat)}</Text>
        </View>
        <View style={styles.detailHeaderActions}>
          <Pressable
            style={styles.iconCircle}
            onPress={() => {
              Alert.alert(activeChat.name, 'Chat actions', [
                {
                  text: mutedChatIds.includes(activeChat.id) ? 'Unmute' : 'Mute',
                  onPress: () => toggleMuteChat(activeChat.id),
                },
                {
                  text: archivedChatIds.includes(activeChat.id) ? 'Unarchive' : 'Archive',
                  onPress: () => {
                    toggleArchiveChat(activeChat.id);
                    setChatScreen('list');
                  },
                },
                {
                  text: favoriteChatIds.includes(activeChat.id) ? 'Unpin' : 'Pin',
                  onPress: () => toggleFavoriteChat(activeChat.id),
                },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
          >
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

      <ScrollView style={styles.thread} contentContainerStyle={styles.threadContent}>
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
          <Text style={styles.recordingBannerText}>{recordingLabel}</Text>
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

  const renderChatList = () => {
    const recentChats = visibleChatItems.slice(0, 4);
    const earlierChats = visibleChatItems.slice(4);
    const avatarPalette = ['#dff3ec', '#f8eedb', '#e3edf7', '#f0dff0', '#e6f4f1'];

    const renderChatRow = (chat, index) => (
      <Pressable
        key={chat.id}
        style={styles.chatHomeRow}
        onPress={() => {
          setSelectedChatId(chat.id);
          setChatScreen('detail');
        }}
        onLongPress={() => {
          Alert.alert(chat.name, 'Chat actions', [
            {
              text: favoriteChatIds.includes(chat.id) ? 'Unpin' : 'Pin',
              onPress: () => toggleFavoriteChat(chat.id),
            },
            {
              text: mutedChatIds.includes(chat.id) ? 'Unmute' : 'Mute notifications',
              onPress: () => toggleMuteChat(chat.id),
            },
            {
              text: archivedChatIds.includes(chat.id) ? 'Unarchive' : 'Archive',
              onPress: () => toggleArchiveChat(chat.id),
            },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}
      >
        <View style={[styles.chatHomeAvatar, { backgroundColor: avatarPalette[index % avatarPalette.length] }]}>
          <Text style={styles.chatHomeAvatarText}>{chat.name.slice(0, 1).toUpperCase()}</Text>
          {chat.unread > 0 ? <View style={styles.chatHomePresenceDot} /> : null}
        </View>
        <View style={styles.chatHomeCopy}>
          <View style={styles.chatHomeTopRow}>
            <View style={styles.chatHomeNameRow}>
              {favoriteChatIds.includes(chat.id) ? (
                <Text style={styles.chatHomeFavoriteStar}>★</Text>
              ) : null}
              <Text numberOfLines={1} style={styles.chatHomeName}>{chat.name}</Text>
              {mutedChatIds.includes(chat.id) ? <Text style={styles.chatHomeMuteIcon}>🔕</Text> : null}
              {/(store|shop|business|biz|kitchen|board)/i.test(chat.name) ? (
                <Text style={styles.chatHomeBadge}>BIZ</Text>
              ) : null}
            </View>
            <Text style={styles.chatHomeTime}>{chat.time}</Text>
          </View>
          <View style={styles.chatHomeBottomRow}>
            <Text numberOfLines={1} style={styles.chatHomePreview}>
              {peerTypingByChat[chat.id] ? 'typing…' : chat.preview}
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
    );

    return (
      <View style={styles.lightScreen}>
        <View style={styles.lightHeader}>
          <Text style={styles.appWordmark}>
            Zynk<Text style={styles.appWordmarkAccent}>Up</Text>
          </Text>
          <View style={styles.lightHeaderActions}>
            <Pressable
              style={styles.lightHeaderAction}
              onPress={() => {
                void syncPhoneContacts(currentUserId);
                setNewChatVisible(true);
              }}
            >
              <Text style={styles.lightHeaderActionText}>+</Text>
            </Pressable>
            <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Settings')}>
              <Text style={styles.lightHeaderActionText}>⌁</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.modeSwitch}>
          {['personal', 'business'].map((mode) => (
            <Pressable
              key={mode}
              style={[styles.modeSwitchButton, chatMode === mode ? styles.modeSwitchButtonActive : null]}
              onPress={() => setChatMode(mode)}
            >
              <Text style={[styles.modeSwitchText, chatMode === mode ? styles.modeSwitchTextActive : null]}>
                {mode === 'personal' ? 'Personal' : 'Business'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={chatSearchQuery}
          onChangeText={setChatSearchQuery}
          placeholder="Search chats"
          placeholderTextColor="#9aa3b2"
          style={styles.chatSearchInput}
        />

        {archivedChatIds.length ? (
          <Pressable style={styles.archiveRow} onPress={() => setShowArchivedChats((current) => !current)}>
            <Text style={styles.archiveIcon}>▦</Text>
            <Text style={styles.archiveText}>
              {showArchivedChats ? 'Back to chats' : `Archived (${archivedChatIds.length})`}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.chatListShell}>
          <ScrollView
            style={styles.lightScroll}
            contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset + 72 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.lightSectionLabel}>{showArchivedChats ? 'ARCHIVED' : 'RECENT'}</Text>
            {recentChats.length ? recentChats.map((chat, index) => renderChatRow(chat, index)) : (
              <View style={styles.emptyChatCard}>
                <Text style={styles.cardTitle}>No chats yet</Text>
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
            )}

            {earlierChats.length ? <Text style={styles.lightSectionLabel}>EARLIER TODAY</Text> : null}
            {earlierChats.map((chat, index) => renderChatRow(chat, index + recentChats.length))}
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
        </View>
      </View>
    );
  };

  const renderCalls = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      <Text style={styles.secondaryTitle}>Calls</Text>
      {calls.map((call) => (
        <View key={call.id} style={styles.card}>
          <Text style={styles.cardTitle}>{call.name}</Text>
          <Text style={styles.cardBody}>{call.kind} call · {call.state.charAt(0).toUpperCase() + call.state.slice(1)}</Text>
          <Text style={styles.cardMeta}>{call.time}</Text>
        </View>
      ))}
    </ScrollView>
  );

  const renderPay = () => (
    <View style={styles.lightScreen}>
      <View style={styles.lightHeader}>
        <Text style={styles.payWordmark}>
          Zynk<Text style={styles.appWordmarkAccent}>Up</Text> Pay
        </Text>
        <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Settings')}>
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
          <Text style={styles.payHeroAmount}>GHC 1,240.50</Text>
          <Text style={styles.payHeroMeta}>MTN MoMo •••• 8821 · Synced now</Text>
          <View style={styles.payHeroActions}>
            {[
              { label: 'Send', icon: '↗', action: 'send' },
              { label: 'Request', icon: '+', action: 'request' },
              { label: 'Top up', icon: '▭', action: 'topup' },
              { label: 'History', icon: '◔', action: 'history' },
            ].map((action) => (
              <Pressable
                key={action.label}
                style={styles.payHeroAction}
                onPress={() => {
                  setPayForm({ amount: '', phone: '', note: '' });
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
              <View style={[styles.quickSendAvatar, { backgroundColor: ['#dff3ec', '#f8eedb', '#dbe7f4', '#f0dff0'][index % 4] }]}>
                <Text style={styles.quickSendAvatarText}>{contact.name.slice(0, 1).toUpperCase()}</Text>
              </View>
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
          {[...payHistoryItems, ...payTransactions].map((transaction, index, list) => (
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

  const renderStatus = () => {
    const myStatus = updatesFeed.find((entry) => entry.userId === currentUserId);
    const otherUpdates = updatesFeed.filter((entry) => entry.userId !== currentUserId);
    const avatarPalette = ['#dff3ec', '#f8eedb', '#e3edf7', '#f0dff0'];

    return (
      <View style={styles.lightScreen}>
        <View style={styles.lightHeader}>
          <Text style={styles.appWordmark}>
            Zynk<Text style={styles.appWordmarkAccent}>Up</Text>
          </Text>
          <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Settings')}>
            <Text style={styles.lightHeaderActionText}>◌</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.lightScroll}
          contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={styles.statusComposerCard} onPress={() => setStatusComposerVisible(true)}>
            <View style={styles.statusComposerRing}>
              <Text style={styles.statusComposerPlus}>+</Text>
            </View>
            <View style={styles.statusComposerCopy}>
              <Text style={styles.statusAddTitle}>Add your status</Text>
              <Text style={styles.statusAddMeta}>Photo · Video · Text · Product</Text>
            </View>
          </Pressable>

          <Text style={styles.lightSectionLabel}>RECENT UPDATES</Text>
          {otherUpdates.map((entry, index) => {
            const latestStatus = entry.items?.[0];
            const feedIndex = updatesFeed.findIndex((candidate) => candidate.userId === entry.userId);
            return (
              <Pressable key={entry.userId} style={styles.statusFeedCard} onPress={() => openStatusViewer(feedIndex)}>
                <View style={styles.statusFeedAvatarWrap}>
                  <View style={styles.statusFeedAvatarRing}>
                    <View style={[styles.statusFeedAvatar, { backgroundColor: avatarPalette[index % avatarPalette.length] }]}>
                      <Text style={styles.statusFeedAvatarText}>{entry.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.statusFeedCopy}>
                  <Text numberOfLines={1} style={styles.statusFeedName}>{entry.name}</Text>
                  <Text style={styles.statusFeedTime}>{latestStatus?.createdAt ? formatClock(latestStatus.createdAt) : 'Just now'}</Text>
                  <Text numberOfLines={2} style={styles.statusFeedBody}>
                    {latestStatus?.text || latestStatus?.assets?.[0]?.caption || 'Tap to view latest update'}
                  </Text>
                </View>
                <View style={styles.statusFeedDot} />
              </Pressable>
            );
          })}

          {myStatus?.items?.length ? (
            <Pressable
              style={styles.statusMineCard}
              onPress={() => openStatusViewer(updatesFeed.findIndex((entry) => entry.userId === currentUserId))}
              onLongPress={() => {
                const latestId = myStatus.items[0]?.id;
                if (latestId) {
                  void deleteStatus(latestId);
                }
              }}
            >
              <Text style={styles.statusMineTitle}>Your latest status</Text>
              <Text numberOfLines={2} style={styles.statusMineBody}>
                {myStatus.items[0]?.text || myStatus.items[0]?.assets?.[0]?.caption || 'Open and manage your latest update'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    );
  };

  const renderBusiness = () => {
    const businessName = profile.businessName || profile.name || authForm.name || 'Maame Sika Store';
    const customerCount = Math.max(contactItems.length, visibleChatItems.length, 12);
    const orderCount = Math.max(chatItems.length, 12);
    const catalogCount = Math.max(filteredCatalogItems.length, 24);
    const todaySales = 840 + (filteredCatalogItems.length * 5);

    return (
      <View style={styles.lightScreen}>
        <View style={styles.lightHeader}>
          <Text style={styles.businessModeTitle}>
            Business <Text style={styles.appWordmarkAccent}>Mode</Text>
          </Text>
          <Pressable style={styles.lightHeaderAction} onPress={() => setActiveView('Settings')}>
            <Text style={styles.lightHeaderActionText}>≋</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.lightScroll}
          contentContainerStyle={[styles.lightScrollContent, { paddingBottom: lightContentBottomInset }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.businessAlertCard}>
            <Text style={styles.businessAlertText}>Low stock alert: Ankara dress (2 left)</Text>
          </View>

          <View style={styles.businessHeroCard}>
            <Text numberOfLines={1} style={styles.businessHeroTitle}>{businessName}</Text>
            <Text style={styles.businessHeroMeta}>Verified business · Accra, Ghana</Text>
            <View style={styles.businessStatsRow}>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>GHC {todaySales}</Text>
                <Text style={styles.businessStatLabel}>Today's sales</Text>
              </View>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>{orderCount}</Text>
                <Text style={styles.businessStatLabel}>Orders</Text>
              </View>
              <View style={styles.businessStatCard}>
                <Text style={styles.businessStatValue}>98%</Text>
                <Text style={styles.businessStatLabel}>Response rate</Text>
              </View>
            </View>
          </View>

          <View style={styles.businessGrid}>
            <Pressable style={styles.businessGridCard} onPress={() => setBusinessPanel('catalog')}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>▤</Text></View>
              <Text style={styles.businessGridTitle}>My catalog</Text>
              <Text style={styles.businessGridMeta}>{catalogCount} products live</Text>
            </Pressable>
            <Pressable
              style={styles.businessGridCard}
              onPress={() => {
                void syncPhoneContacts(currentUserId);
                setBusinessPanel('customers');
              }}
            >
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◌</Text></View>
              <Text style={styles.businessGridTitle}>Customers</Text>
              <Text style={styles.businessGridMeta}>{customerCount} total</Text>
            </Pressable>
            <Pressable style={styles.businessGridCard} onPress={() => setBusinessPanel('receipts')}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>□</Text></View>
              <Text style={styles.businessGridTitle}>Receipts</Text>
              <Text style={styles.businessGridMeta}>Auto-generated</Text>
            </Pressable>
            <Pressable style={styles.businessGridCard} onPress={() => setBusinessPanel('broadcast')}>
              <View style={styles.businessGridIconWrap}><Text style={styles.businessGridIcon}>◍</Text></View>
              <Text style={styles.businessGridTitle}>Broadcast</Text>
              <Text style={styles.businessGridMeta}>Send to all customers</Text>
            </Pressable>
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
            'App lock',
            appSettings.appLockEnabled,
            (value) => updateAppSetting('appLockEnabled', value, { syncProfile: true }),
            'Require PIN when opening ZynkUp',
          )}
          <TextInput
            value={accountPinDraft}
            onChangeText={setAccountPinDraft}
            placeholder="Set 4–6 digit PIN"
            placeholderTextColor="#7d8b92"
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            style={styles.sendButtonWide}
            onPress={() => {
              if (appSettings.appLockEnabled && !/^\d{4,6}$/.test(accountPinDraft.trim()) && !appLockPin) {
                showToast('Enter a 4–6 digit PIN to enable app lock.', 'error');
                return;
              }
              void saveProfileToServer(
                {},
                {},
                { pin: accountPinDraft.trim().length === 4 ? accountPinDraft.trim() : undefined },
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
      return (
        <ScrollView style={styles.settingsPanelScroll}>
          {renderPrivacyChoice('Last seen & online', 'lastSeenPrivacy')}
          {renderPrivacyChoice('Profile photo', 'profilePhotoPrivacy')}
          {renderPrivacyChoice('About', 'aboutPrivacy')}
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
          {renderSettingsToggle(
            'Read receipts',
            appSettings.readReceiptsEnabled,
            (value) => updateAppSetting('readReceiptsEnabled', value, { syncProfile: true }),
            'If off, you won\'t send or see blue ticks in real time',
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
          <Text style={styles.cardBody}>Need help? Send feedback and we will improve ZynkUp with you.</Text>
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
              showToast('Thanks — feedback sent to the ZynkUp team.', 'success', 3200);
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
      <Text style={styles.secondaryTitle}>Settings</Text>
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
        <Text style={styles.settingsProfileName}>{profile.name || 'Your name'}</Text>
        <Text style={styles.settingsProfileMeta}>{profile.about || 'Hey there! I am using ZynkUp.'}</Text>
        <Text style={styles.settingsProfileMeta}>{profile.phone || 'Add your phone number'}</Text>
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
          <Text style={styles.celebrationSubtitle}>ZynkUp is ready. Here's everything waiting for you.</Text>
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
            <Text style={styles.celebrationButtonText}>Open ZynkUp →</Text>
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

  const renderAuthGate = (dismissible = false) => {
    const authContainerStyle = authMode === 'welcome' ? styles.authWelcomeScreen : styles.authFlowScreen;
    const authContentStyle = authMode === 'welcome' ? styles.authWelcomeCard : styles.authFlowCard;
    const authFooter = (() => {
      if (authMode === 'welcome') {
        return (
          <View style={styles.authWelcomeFooter}>
            <Pressable
              style={styles.authPrimaryButton}
              onPress={() => {
                setAuthMode('phone');
              }}
            >
              <Text style={styles.authPrimaryButtonText}>Get started - it's free</Text>
            </Pressable>
            <Pressable
              style={styles.authSecondaryButton}
              onPress={() => {
                setAuthMode('phone');
              }}
            >
              <Text style={styles.authSecondaryButtonText}>I already have an account</Text>
            </Pressable>
            <Text style={styles.authLegalText}>
              By continuing you agree to our <Text style={styles.authLegalLink}>Terms of Service</Text> &amp;{'\n'}
              <Text style={styles.authLegalLink}>Privacy Policy</Text>
            </Text>
          </View>
        );
      }

      if (authMode === 'phone') {
        return (
          <View style={styles.authStepFooter}>
            <Pressable
              style={[styles.authDarkButton, isAuthBusy ? styles.authDarkButtonDisabled : null]}
              disabled={isAuthBusy}
              onPress={() => void continueWithPhone()}
            >
              <Text style={styles.authDarkButtonText}>
                {authPendingAction === 'lookup' || authPendingAction === 'send-code' ? 'Please wait...' : 'Continue'}
              </Text>
            </Pressable>
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'pin') {
        return (
          <View style={styles.authStepFooter}>
            <Pressable
              style={[styles.authDarkButton, isAuthBusy ? styles.authDarkButtonDisabled : null]}
              disabled={isAuthBusy}
              onPress={() => void loginWithPin()}
            >
              <Text style={styles.authDarkButtonText}>{authPendingAction === 'pin-login' ? 'Signing in...' : 'Sign in'}</Text>
            </Pressable>
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
            <Pressable
              style={[styles.authDarkButton, isAuthBusy ? styles.authDarkButtonDisabled : null]}
              disabled={isAuthBusy}
              onPress={() => void verifyPhoneOtp()}
            >
              <Text style={styles.authDarkButtonText}>{authPendingAction === 'verify-otp' ? 'Verifying...' : 'Verify code'}</Text>
            </Pressable>
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'reset-pin') {
        return (
          <View style={styles.authStepFooter}>
            <Pressable
              style={[styles.authDarkButton, isAuthBusy ? styles.authDarkButtonDisabled : null]}
              disabled={isAuthBusy}
              onPress={() => void resetPinAfterOtp()}
            >
              <Text style={styles.authDarkButtonText}>{authPendingAction === 'reset-pin' ? 'Saving...' : 'Save PIN & continue'}</Text>
            </Pressable>
            {isAuthBusy ? <Text style={styles.authInlineStatusText}>{authPendingLabel}</Text> : null}
          </View>
        );
      }

      if (authMode === 'profile') {
        return (
          <View style={styles.authStepFooter}>
            <Pressable style={styles.authDarkButton} onPress={continueFromProfileStep}>
              <Text style={styles.authDarkButtonText}>Continue</Text>
            </Pressable>
          </View>
        );
      }

      return (
        <View style={styles.authStepFooter}>
          <Pressable
            style={[
              styles.authDarkButton,
              !authForm.accountType || isAuthBusy ? styles.authDarkButtonDisabled : null,
            ]}
            disabled={!authForm.accountType || isAuthBusy}
            onPress={() => void completePhoneRegistration()}
          >
            <Text style={styles.authDarkButtonText}>{authPendingAction === 'register' ? 'Please wait...' : "Let's go"}</Text>
          </Pressable>
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
          <View style={styles.authWelcomeBackdrop}>
            <View style={styles.authWelcomeGlowOuter} />
            <View style={styles.authWelcomeGlowInner} />
            <View style={styles.authBrandIcon}>
              <Text style={styles.authBrandIconText}>↑</Text>
            </View>
          </View>
        ) : null}
        {authMode === 'welcome' ? (
          <View style={authContentStyle}>
            <>
              <View style={styles.authWelcomeTopSpacer} />
              <Text style={styles.authBrandWordmark}>
                Zynk<Text style={styles.authBrandWordmarkAccent}>Up</Text>
              </Text>
              <Text style={styles.authWelcomeTagline}>Chat. Pay. Sell. All in one place.</Text>
              <Text style={styles.authWelcomeSubline}>Built for Africa. Built for you.</Text>
              <View style={styles.authPillRow}>
                {['Chat', 'Pay', 'Sell', 'Offline-ready', 'GH Ghana'].map((pill) => (
                  <View key={pill} style={styles.authFeaturePill}>
                    <Text style={styles.authFeaturePillText}>{pill}</Text>
                  </View>
                ))}
              </View>
            </>
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
                            {selectedAuthCountry ? `${selectedAuthCountry.code} ${selectedAuthCountry.dialCode}` : 'GH +233'}
                          </Text>
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
                      <Text style={styles.authStepAccent}>ZynkUp?</Text>
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
                      <Text style={styles.authAccountFootnote}>ZynkUp is free to use. Business features are always available.</Text>
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

  if (!bootstrapReady) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <View style={styles.bootstrapLoader}>
          <Text style={styles.authBrandWordmark}>
            Zynk<Text style={styles.authBrandWordmarkAccent}>Up</Text>
          </Text>
          <ActivityIndicator color="#ffffff" size="small" style={styles.bootstrapLoaderSpinner} />
          <Text style={styles.bootstrapLoaderTitle}>Starting your workspace...</Text>
          <Text style={styles.bootstrapLoaderBody}>Checking session and connecting to the server.</Text>
        </View>
        {renderToast()}
      </SafeAreaView>
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
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {activeView === 'Chats' && chatScreen === 'detail' ? (
        renderChatDetail()
      ) : (
        <View style={styles.screen}>
          {activeView === 'Chats' ? renderChatList() : null}
          {activeView === 'Calls' ? renderCalls() : null}
          {activeView === 'Status' ? renderStatus() : null}
          {activeView === 'Pay' ? renderPay() : null}
          {activeView === 'Business' ? renderBusiness() : null}
          {activeView === 'Settings' ? renderSettings() : null}

          <View style={[styles.bottomNav, { paddingBottom: navBottomInset + 4 }]}>
            {tabs.map((tab) => (
              <Pressable
                key={tab}
                style={styles.bottomNavItem}
                onPress={() => {
                  setActiveView(tab);
                  setChatScreen('list');
                }}
              >
                <View style={styles.bottomNavIconWrap}>
                  <Text style={[styles.bottomNavIcon, activeView === tab ? styles.bottomNavIconActive : null]}>
                    {tab === 'Chats' ? '◫' : tab === 'Calls' ? '☎' : tab === 'Status' ? '◉' : tab === 'Pay' ? '▭' : '⌂'}
                  </Text>
                  {tabBadges[tab] ? (
                    <View style={styles.bottomNavBadge}>
                      <Text style={styles.bottomNavBadgeText}>{tabBadges[tab]}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.bottomNavLabel, activeView === tab ? styles.bottomNavLabelActive : null]}>{tab}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {renderAttachmentSheet()}
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
                    receiptState: 'sent',
                    replyToMessageId: replyTarget?.id,
                    replyPreview: replyTarget?.text?.slice(0, 140),
                  };
                  appendMessage(message);
                  fetch(`${API_BASE_URL}/api/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chatId: selectedChatId,
                      senderId: currentUserId,
                      clientRef,
                      kind: 'image',
                      text: 'Photo',
                      mediaUrls: [mediaUrl],
                      replyToMessageId: replyTarget?.id,
                      replyPreview: replyTarget?.text?.slice(0, 140),
                    }),
                  }).catch(() => undefined);
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
        <View style={styles.statusComposerOverlay}>
          <View style={[styles.statusComposerSheet, { paddingBottom: modalBottomInset }]}>
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
              <View style={[styles.statusComposerPreview, { backgroundColor: statusBackgroundColor }]}>
                <Text
                  style={[
                    styles.statusComposerPreviewText,
                    {
                      fontSize: statusFontSize,
                      fontFamily: statusFontFamily === 'System' ? undefined : statusFontFamily,
                    },
                  ]}
                >
                  {statusDraft || 'Type your status'}
                </Text>
              </View>
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
                <Text style={styles.statusMediaPickerMeta}>WhatsApp-style media status with optional caption</Text>
              </Pressable>
            )}
            <TextInput
              value={statusDraft}
              onChangeText={setStatusDraft}
              placeholder={statusComposerMode === 'text' ? 'Share an update' : 'Add a caption (optional)'}
              placeholderTextColor="#7d8b92"
              multiline
              style={styles.textArea}
            />
            {statusComposerMode === 'text' ? (
              <>
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
              </>
            ) : null}
            <Pressable style={styles.sendButtonWide} onPress={() => void postStatus()}>
              <Text style={styles.sendButtonText}>Post status</Text>
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
                {activeStatusGroup?.items?.map((item, index) => (
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
                    <Text style={styles.storyHeaderTitle}>{activeStatusGroup?.name ?? 'Status'}</Text>
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
                          fontSize: activeStatusItem?.fontSize ?? 64,
                          fontFamily: activeStatusItem?.fontFamily === 'System' ? undefined : activeStatusItem?.fontFamily,
                        },
                      ]}
                    >
                      {activeStatusItem?.text || activeStatusGroup?.name?.slice(0, 1) || 'S'}
                    </Text>
                  </View>
                )}
                <View style={styles.storyCaption}>
                  <Text style={styles.storyCaptionTitle}>{activeStatusGroup?.name ?? 'Status'}</Text>
                  <Text style={styles.storyCaptionBody}>
                    {activeStatusItem?.text || activeStatusItem?.assets?.[0]?.caption || 'Status update'}
                  </Text>
                  <View style={styles.storyStatsRow}>
                    <Pressable onPress={openViewerList}>
                      <Text style={styles.storyStatText}>Views {activeStatusItem?.views?.length ?? 0}</Text>
                    </Pressable>
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
                      >
                        <Text style={styles.storyReactionChipText}>
                          {emoji} {(activeStatusItem?.reactions ?? []).filter((reaction) => reaction.emoji === emoji).length}
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
              </Pressable>
              <Pressable style={styles.storyNavRight} onPress={() => moveStatus('next')} />
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
                {businessPanel === 'catalog'
                  ? 'My catalog'
                  : businessPanel === 'customers'
                    ? 'Customers'
                    : businessPanel === 'receipts'
                      ? 'Receipts'
                      : 'Broadcast'}
              </Text>
              <Pressable onPress={() => setBusinessPanel('')}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>

            {businessPanel === 'catalog' ? (
              <ScrollView style={styles.businessPanelScroll}>
                <TextInput
                  value={catalogSearch}
                  onChangeText={setCatalogSearch}
                  placeholder="Search products"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <Pressable style={styles.ghostButton} onPress={() => pickMultipleImages('catalog')}>
                  <Text style={styles.ghostButtonText}>
                    {catalogImageUris.length ? `${catalogImageUris.length} image(s) selected` : 'Add product images'}
                  </Text>
                </Pressable>
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
                  placeholder="Price (GHS)"
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
                  value={catalogForm.description}
                  onChangeText={(value) => setCatalogForm((current) => ({ ...current, description: value }))}
                  placeholder="Description"
                  placeholderTextColor="#7d8b92"
                  multiline
                  style={styles.textArea}
                />
                <Pressable style={styles.sendButtonWide} onPress={() => void addCatalogItem()}>
                  <Text style={styles.sendButtonText}>Publish product</Text>
                </Pressable>
                <Text style={styles.lightSectionLabel}>LIVE PRODUCTS</Text>
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
                      <Text style={styles.sheetOptionBody}>{item.price} · Stock {item.stockQuantity ?? 0}</Text>
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
                    </View>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {businessPanel === 'customers' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {(contactItems.length
                  ? contactItems
                  : Object.values(usersById)
                      .filter((user) => user.id !== currentUserId)
                      .map((user) => ({
                        id: user.id,
                        name: user.name,
                        phone: user.phone,
                        linkedUserId: user.id,
                        registered: true,
                        presence: user.presence,
                      }))
                ).map((customer) => (
                  <Pressable
                    key={customer.id}
                    style={styles.sheetOption}
                    onPress={() => {
                      if (customer.linkedUserId) {
                        setBusinessPanel('');
                        void createDirectChat(customer.linkedUserId);
                      }
                    }}
                  >
                    <Text style={styles.sheetOptionTitle}>{customer.name}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {customer.phone}
                      {customer.registered ? ' · On ZynkUp' : ' · Invite pending'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {businessPanel === 'receipts' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {[...payHistoryItems, ...payTransactions].map((receipt) => (
                  <View key={receipt.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{receipt.title}</Text>
                    <Text style={styles.sheetOptionBody}>{receipt.time} · {receipt.amount}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}

            {businessPanel === 'broadcast' ? (
              <View>
                <Text style={styles.cardBody}>
                  Message every registered customer in one send — like WhatsApp Business broadcast lists.
                </Text>
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
              </View>
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
                      : 'Payment history'}
              </Text>
              <Pressable onPress={() => setPaySheet('')}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
            {paySheet === 'history' ? (
              <ScrollView style={styles.businessPanelScroll}>
                {[...payHistoryItems, ...payTransactions].map((item) => (
                  <View key={item.id} style={styles.sheetOption}>
                    <Text style={styles.sheetOptionTitle}>{item.title}</Text>
                    <Text style={styles.sheetOptionBody}>{item.time} · {item.amount}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : (
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
                  placeholder="Amount (GHS)"
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
            )}
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
            <Text style={styles.cardBody}>Contacts on ZynkUp from your phone book</Text>
            <TextInput
              value={newChatQuery}
              onChangeText={setNewChatQuery}
              placeholder="Search name or phone"
              placeholderTextColor="#7d8b92"
              style={styles.input}
            />
            <ScrollView style={styles.newChatList}>
              {(() => {
                const query = newChatQuery.trim().toLowerCase();
                const registeredContacts = contactItems.filter((contact) => contact.registered && contact.linkedUserId);
                const fallbackUsers = Object.values(usersById).filter((user) => user.id !== currentUserId);
                const rows = (registeredContacts.length ? registeredContacts : fallbackUsers.map((user) => ({
                  id: user.id,
                  name: user.name,
                  phone: user.phone,
                  linkedUserId: user.id,
                  registered: true,
                  presence: user.presence,
                }))).filter((entry) => {
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
                        No registered contacts yet. Sync your phone book after signing in, or invite friends to ZynkUp.
                      </Text>
                      <Pressable style={styles.sendButtonWide} onPress={() => void syncPhoneContacts(currentUserId)}>
                        <Text style={styles.sendButtonText}>Sync phone book</Text>
                      </Pressable>
                    </View>
                  );
                }

                return rows.map((entry) => (
                  <Pressable
                    key={entry.id}
                    style={styles.sheetOption}
                    onPress={() => {
                      setNewChatVisible(false);
                      void createDirectChat(entry.linkedUserId);
                    }}
                  >
                    <Text style={styles.sheetOptionTitle}>{entry.name}</Text>
                    <Text style={styles.sheetOptionBody}>
                      {entry.phone} · {entry.presence === 'online' ? 'Online' : 'On ZynkUp'}
                    </Text>
                  </Pressable>
                ));
              })()}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(incomingCall)}
        onRequestClose={() => setIncomingCall(null)}
      >
        <Pressable style={styles.dialogOverlay}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Incoming {incomingCall?.kind?.toLowerCase()} call</Text>
            <Text style={styles.cardBody}>{incomingCall?.name} is calling you.</Text>
            <View style={styles.storyActionRow}>
              <Pressable style={[styles.storyActionButton, styles.storyActionButtonPrimary]} onPress={() => void acceptIncomingCall()}>
                <Text style={[styles.storyActionButtonText, styles.storyActionButtonTextPrimary]}>Answer</Text>
              </Pressable>
              <Pressable style={styles.storyActionButton} onPress={() => incomingCall ? void updateCallState(incomingCall.id, 'declined', 0) : undefined}>
                <Text style={styles.storyActionButtonText}>Decline</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        animationType="fade"
        visible={Boolean(activeCall)}
        onRequestClose={() => undefined}
      >
        <Pressable style={styles.dialogOverlay}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>{activeCall?.kind} call</Text>
            <Text style={styles.cardBody}>{activeCall?.name}</Text>
            <Text style={styles.cardMeta}>{activeCall?.state === 'ongoing' ? getAudioDurationLabel(activeCallSeconds * 1000) : 'Ringing...'}</Text>
            {callError ? <Text style={styles.cardBody}>{callError}</Text> : null}
            {activeCall?.kind === 'Video' ? (
              <View style={styles.callVideoRow}>
                {localCallStream?.toURL && RTCViewNative ? <RTCViewNative streamURL={localCallStream.toURL()} style={styles.callVideoTile} objectFit="cover" /> : <View style={styles.callVideoTilePlaceholder}><Text style={styles.cardMeta}>Local video</Text></View>}
                {remoteCallStream?.toURL && RTCViewNative ? <RTCViewNative streamURL={remoteCallStream.toURL()} style={styles.callVideoTile} objectFit="cover" /> : <View style={styles.callVideoTilePlaceholder}><Text style={styles.cardMeta}>Waiting for peer</Text></View>}
              </View>
            ) : (
              <View style={styles.callAudioRow}>
                <View style={styles.callAudioPill}><Text style={styles.cardMeta}>Your mic is live</Text></View>
                <View style={styles.callAudioPill}><Text style={styles.cardMeta}>{remoteCallStream ? `${activeCall?.name} connected` : 'Waiting for peer'}</Text></View>
              </View>
            )}
            <View style={styles.storyActionRow}>
              {activeCall?.state === 'ringing' && activeCall?.initiatorId !== currentUserId ? (
                <Pressable style={[styles.storyActionButton, styles.storyActionButtonPrimary]} onPress={() => void acceptIncomingCall()}>
                  <Text style={[styles.storyActionButtonText, styles.storyActionButtonTextPrimary]}>Answer</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.storyActionButton, styles.storyActionButtonDone]} onPress={() => void endActiveCall()}>
                <Text style={[styles.storyActionButtonText, styles.storyActionButtonTextPrimary]}>
                  {activeCall?.state === 'ongoing' ? 'End Call' : 'Cancel'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
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
      <Modal
        transparent
        animationType="fade"
        visible={appSettings.appLockEnabled && !appUnlocked && Boolean(appLockPin)}
        onRequestClose={() => undefined}
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>App locked</Text>
            <Text style={styles.cardBody}>Enter your PIN to open ZynkUp.</Text>
            <TextInput
              value={unlockPinDraft}
              onChangeText={setUnlockPinDraft}
              placeholder="••••"
              placeholderTextColor="#7d8b92"
              keyboardType="number-pad"
              maxLength={4}
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
              <Text style={styles.cardBody}>Camera permission is required for scanning.</Text>
            )}
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
    paddingTop: 10,
    paddingBottom: 16,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d9dde4',
    backgroundColor: '#ffffff',
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
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
    color: '#15c79a',
  },
  bottomNavLabel: {
    color: '#7f8591',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  bottomNavLabelActive: {
    color: '#15c79a',
    fontWeight: '600',
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
    backgroundColor: '#f5f5f7',
  },
  lightHeader: {
    paddingTop: 52,
    paddingHorizontal: 22,
    paddingBottom: 16,
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
  chatHomeAvatarText: {
    color: '#111827',
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
    color: '#111827',
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
    backgroundColor: '#15c79a',
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
    color: '#111827',
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
  chatFab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#128C7E',
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
    backgroundColor: '#0a1013',
    paddingTop: 52,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 14,
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
  voiceNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 190,
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
  },
  recordingBannerText: {
    color: '#ff7070',
    fontWeight: '700',
    fontSize: 13,
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
    backgroundColor: '#030712',
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 54,
    paddingBottom: 28,
    overflow: 'hidden',
  },
  authFlowScreen: {
    flex: 1,
    backgroundColor: '#f4f5f7',
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
    backgroundColor: 'rgba(37, 99, 235, 0.26)',
    top: -120,
    right: -120,
  },
  authWelcomeGlowInner: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(29, 78, 216, 0.22)',
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
    color: '#60a5fa',
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
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  authPrimaryButtonText: {
    color: '#08111f',
    fontSize: 16,
    fontWeight: '800',
  },
  authSecondaryButton: {
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.18)',
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
    color: '#f8fbff',
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
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  authBackButtonText: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '500',
    marginTop: -2,
  },
  authProgressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    marginRight: 12,
  },
  authProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#111827',
  },
  authProgressLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  authStepEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  authStepTitle: {
    color: '#111827',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  authStepAccent: {
    color: '#111827',
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 8,
    fontFamily: DISPLAY_FONT_FAMILY,
  },
  authStepBody: {
    color: '#6b7280',
    fontSize: 14,
    lineHeight: 20,
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
    minWidth: 106,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  authCountryChipText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  authPhoneInput: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: '#f3f4f6',
    color: '#111827',
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: 18,
  },
  authStepHint: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
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
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authOtpBoxFilled: {
    backgroundColor: '#e5edff',
  },
  authOtpBoxText: {
    color: '#111827',
    fontSize: 21,
    fontWeight: '800',
  },
  authOtpBoxTextFilled: {
    color: '#1d4ed8',
  },
  authResendText: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 14,
  },
  authResendAccent: {
    color: '#111827',
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
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authKeypadKeyBlank: {
    backgroundColor: 'transparent',
  },
  authKeypadKeyText: {
    color: '#111827',
    fontSize: 21,
    fontWeight: '700',
  },
  authFooterDock: {
    backgroundColor: '#f4f5f7',
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
    color: '#111827',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 10,
  },
  authProfileInput: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    color: '#111827',
    fontSize: 15,
    paddingHorizontal: 16,
  },
  authUsernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
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
    color: '#111827',
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
    color: '#111827',
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
    borderRadius: 18,
    backgroundColor: '#111827',
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
    bottom: 0,
    width: '28%',
    zIndex: 2,
  },
  storyNavRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
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
    fontSize: 64,
    fontWeight: '800',
  },
  storyCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
});
