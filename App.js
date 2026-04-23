import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio, ResizeMode, Video } from 'expo-av';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { mediaDevices, RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, RTCView } from 'react-native-webrtc';
import { io } from 'socket.io-client';

const AnimatedText = Animated.createAnimatedComponent(Text);
const tabs = ['Updates', 'Calls', 'Tools', 'Chats', 'Settings'];
const settingsSections = [
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
const emojiOptions = ['😀', '😂', '🤣', '😍', '🔥', '🙏', '🎉', '❤️'];
const tabBadges = {
  Updates: 0,
  Calls: 14,
  Tools: 0,
  Chats: 9,
  Settings: 1,
};
const categoryOptions = ['All', 'Fashion', 'Electronics', 'Home', 'Phones'];
const statusBackgroundOptions = ['#10233e', '#1f2937', '#14532d', '#7c2d12', '#581c87'];
const statusFontOptions = ['System', 'serif', 'monospace'];
const statusReactionOptions = ['❤️', '👍', '👎', '🔥', '😂'];
const EMOJI_REGEX = /\p{Extended_Pictographic}/gu;
const LAUGHING_EMOJIS = new Set(['😂', '🤣', '😆', '😄', '😹']);
const API_BASE_URL = Platform.select({
  android: 'http://10.0.2.2:4000',
  default: 'http://localhost:4000',
});
const DEVICE_STORAGE_KEY = 'zynkup-mobile-device-id';
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const WEBRTC_CONFIGURATION = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
};

const chats = [
  { id: 'c1', name: 'Mr.Hodalor', preview: '📷 Sunday outfit', unread: 0, presence: 'online', time: '19:02' },
  { id: 'c2', name: 'Chory', preview: 'Voice note', unread: 0, presence: 'last seen 3m ago', time: '19:01' },
  { id: 'c3', name: 'Chilenje C.o.C Youth', preview: '~~LEE/🦋🔥💯❣️: Copy the message...', unread: 10, presence: 'typing now', time: '18:49' },
  { id: 'c4', name: 'Princess', preview: 'New kitchen set just landed', unread: 2, presence: 'online', time: '18:27' },
];

const contacts = [
  { id: 'ct1', name: 'Mr.Hodalor', phone: '+260 97 734 0068', registered: true, presence: 'online' },
  { id: 'ct2', name: 'Chory', phone: '+260 96 734 0068', registered: true, presence: 'last seen 3m ago' },
  { id: 'ct3', name: 'Princess', phone: '+260 95 734 0068', registered: true, presence: 'online' },
  { id: 'ct4', name: 'Vendor Grace', phone: '+260 91 734 0068', registered: false, presence: 'invite needed' },
];

const initialStatuses = [
  { id: 's1', userId: 'u2', author: 'Aisha', text: 'Shipping onboarding screens today.', postedAt: '50m ago', assets: [] },
  { id: 's2', userId: 'u1', author: 'You', text: 'Working on catalog, calls, and voice notes.', postedAt: '10m ago', assets: [] },
];

const initialCalls = [
  { id: 'call1', name: 'Mr.Hodalor', kind: 'Video', state: 'Completed', time: 'Today, 19:02' },
  { id: 'call2', name: 'Princess', kind: 'Audio', state: 'Missed', time: 'Today, 18:27' },
];

const initialCatalogItems = [
  {
    id: 'p1',
    title: 'Church Suit',
    price: 'K 1,450',
    category: 'Fashion',
    seller: 'Temwa Lesa',
    description: 'Tailored two-piece suit with matching shirt.',
    imageUri: 'https://images.unsplash.com/photo-1593032465171-f295b07d0b32?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'p2',
    title: 'Samsung S23',
    price: 'K 12,800',
    category: 'Phones',
    seller: 'Tech World Zambia',
    description: 'Factory unlocked with charger and receipt.',
    imageUri: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'p3',
    title: 'Blender Pro',
    price: 'K 780',
    category: 'Home',
    seller: 'Princess Kitchen Store',
    description: 'Heavy duty blender for smoothies and sauces.',
    imageUri: 'https://images.unsplash.com/photo-1570222094114-d054a817e56b?auto=format&fit=crop&w=900&q=80',
  },
];

const initialMessages = {
  c1: [
    {
      id: 'm1',
      mine: false,
      kind: 'image',
      text: 'Sunday outfit',
      time: '19:00',
      imageUri: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
    },
    { id: 'm2', mine: true, kind: 'text', text: 'This one really got me laughing.', time: '19:01' },
    { id: 'm3', mine: false, kind: 'emoji', text: '🤣😂', time: '19:02' },
  ],
  c2: [
    { id: 'm4', mine: false, kind: 'voice', text: 'Voice note', time: '18:57', durationLabel: '0:14' },
  ],
  c3: [
    { id: 'm5', mine: false, kind: 'text', text: 'Good morning family 😂🤣🔥', time: '18:49' },
  ],
  c4: [
    { id: 'm6', mine: false, kind: 'text', text: 'Let us try the new catalog flow.', time: '18:27' },
  ],
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

export default function App() {
  const [activeView, setActiveView] = useState('Chats');
  const [chatScreen, setChatScreen] = useState('list');
  const [selectedChatId, setSelectedChatId] = useState('c1');
  const [currentUserId, setCurrentUserId] = useState('u1');
  const [currentDeviceId, setCurrentDeviceId] = useState(null);
  const [usersById, setUsersById] = useState({});
  const [chatItems, setChatItems] = useState(chats);
  const [contactItems, setContactItems] = useState(contacts);
  const [messageDraft, setMessageDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [messagesByChat, setMessagesByChat] = useState(initialMessages);
  const [calls, setCalls] = useState(initialCalls);
  const [statuses, setStatuses] = useState(initialStatuses);
  const [catalogItems, setCatalogItems] = useState(initialCatalogItems);
  const [profile, setProfile] = useState({
    name: 'Temwa Lesa',
    username: '@temwalesa',
    about: 'Building a commerce-enabled chat product.',
    phone: '+260765453163',
    photoUri: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
  });
  const [catalogForm, setCatalogForm] = useState({
    title: '',
    price: '',
    category: 'Fashion',
    description: '',
  });
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('All');
  const [statusAssetUris, setStatusAssetUris] = useState([]);
  const [catalogImageUris, setCatalogImageUris] = useState([]);
  const [updatesFeed, setUpdatesFeed] = useState([]);
  const [statusComposerVisible, setStatusComposerVisible] = useState(false);
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
  const [authVisible, setAuthVisible] = useState(false);
  const [authMode, setAuthMode] = useState('switch');
  const [authForm, setAuthForm] = useState({ name: '', phone: '' });

  const emojiAnim = useRef(new Animated.Value(0)).current;
  const animationRef = useRef(null);
  const timeoutsRef = useRef([]);
  const autoplayedRef = useRef(new Set());
  const recordingRef = useRef(null);
  const recordingStartedAtRef = useRef(0);
  const recordingIntervalRef = useRef(null);
  const currentSoundRef = useRef(null);
  const socketRef = useRef(null);
  const updatesFeedRef = useRef([]);
  const statusGroupIndexRef = useRef(null);
  const statusItemIndexRef = useRef(0);
  const activeCallRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const callMediaStreamRef = useRef(null);

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

  const ensurePeerConnection = async (call) => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const connection = new RTCPeerConnection(WEBRTC_CONFIGURATION);
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

  const mapChatFromServer = (chat, userId, userMap) => ({
    id: chat.id,
    name: getChatTitle(chat, userId, userMap),
    preview: chat.lastMessagePreview,
    unread: chat.unreadCount ?? 0,
    presence: 'online',
    time: formatClock(chat.updatedAt ?? new Date().toISOString()),
    peerUserId: chat.kind === 'direct'
      ? (chat.participants ?? []).find((participantId) => participantId !== userId)
      : undefined,
  });

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
      const mapped = {
        id: incomingMessage.id,
        clientRef: incomingMessage.clientRef,
        mine: incomingMessage.senderId === currentUserId,
        kind: incomingMessage.kind === 'file' ? 'text' : incomingMessage.kind,
        text: incomingMessage.text,
        time: formatClock(incomingMessage.sentAt),
        imageUri: incomingMessage.mediaUrls?.[0],
        audioUri: incomingMessage.mediaUrls?.[0],
        durationLabel: incomingMessage.durationSeconds ? getAudioDurationLabel(incomingMessage.durationSeconds * 1000) : undefined,
        receiptState: incomingMessage.state,
      };

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
    const nextCurrentUserId = payload.currentUserId ?? 'u1';
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
    }));
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
          list.map((message) => ({
            id: message.id,
            clientRef: message.clientRef,
            mine: message.senderId === nextCurrentUserId,
            kind: message.kind === 'file' ? 'text' : message.kind,
            text: message.text,
            time: formatClock(message.sentAt),
            imageUri: message.mediaUrls?.[0],
            audioUri: message.mediaUrls?.[0],
            durationLabel: message.durationSeconds ? getAudioDurationLabel(message.durationSeconds * 1000) : undefined,
            receiptState: message.state,
          })),
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
        price: `${item.currency ?? 'ZMW'} ${item.price}`,
        category: item.category,
        seller: payload.users?.find((user) => user.id === item.sellerId)?.name ?? 'Seller',
        description: item.description,
        imageUri: item.imageUrls?.[0] ?? null,
        imageUris: item.imageUrls ?? [],
      })),
    );
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
    Speech.stop();
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

        Speech.stop();
        if (LAUGHING_EMOJIS.has(token)) {
          Speech.speak('ha ha ha ha', {
            language: 'en',
            rate: 1.0,
            pitch: 1.3,
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
        currentSoundRef.current.unloadAsync();
        currentSoundRef.current = null;
      }
    };
  }, [messages, chatScreen, selectedChatId]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapSession = async () => {
      const storedDeviceId = await AsyncStorage.getItem(DEVICE_STORAGE_KEY);
      try {
        const response = await fetch(`${API_BASE_URL}/api/session/ensure`, {
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
        fetch(`${API_BASE_URL}/api/bootstrap${query}`)
          .then((response) => response.json())
          .then((payload) => {
            if (!cancelled) {
              applyBootstrapPayload(payload);
            }
          })
          .catch(() => undefined);
      }
    };

    void bootstrapSession();

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
        void syncReceiptState(
          message.id,
          chatScreen === 'detail' && selectedChatId === message.chatId ? 'read' : 'delivered',
        );
      }
    });
    socket.on('chat:updated', (chat) => {
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
      setCatalogItems((current) => [
        {
          id: item.id,
          title: item.title,
          price: `${item.currency ?? 'ZMW'} ${item.price}`,
          category: item.category,
          seller: profile.name,
          description: item.description,
          imageUri: item.imageUrls?.[0] ?? null,
          imageUris: item.imageUrls ?? [],
        },
        ...current,
      ]);
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
          setCallError('Call signaling lost sync.');
        }
      })();
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [chatScreen, currentDeviceId, currentUserId, profile.name, selectedChatId, usersById]);

  useEffect(() => {
    if (chatScreen !== 'detail') {
      return;
    }

    (messagesByChat[selectedChatId] ?? [])
      .filter((message) => !message.mine && message.receiptState !== 'read')
      .forEach((message) => {
        void syncReceiptState(message.id, 'read');
      });
  }, [chatScreen, messagesByChat, selectedChatId]);

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
    };

    appendMessage(message);
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
      }),
    }).catch(() => undefined);
    setMessageDraft('');
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

    const uploadedImageUrls = await uploadUris(catalogImageUris, {
      names: catalogImageUris.map((_, index) => `catalog-${Date.now()}-${index}.jpg`),
      fallbackType: 'image/jpeg',
    }).catch(() => []);

    fetch(`${API_BASE_URL}/api/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerId: currentUserId,
        title: catalogForm.title.trim(),
        price: Number.parseFloat(catalogForm.price) || 0,
        currency: 'ZMW',
        category: catalogForm.category,
        description: catalogForm.description.trim() || 'New item from your business catalog.',
        imageUrls: uploadedImageUrls.length
          ? uploadedImageUrls
          : ['https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80'],
      }),
    }).catch(() => undefined);
    setCatalogForm({
      title: '',
      price: '',
      category: 'Fashion',
      description: '',
    });
    setCatalogImageUris([]);
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
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow gallery access to send media.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'video' ? ImagePicker.MediaTypeOptions.Videos : ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled && result.assets?.length) {
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
    const type = kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : '*/*';
    const result = await DocumentPicker.getDocumentAsync({
      type,
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (!result.canceled && result.assets?.length) {
      const asset = result.assets[0];
      persistAttachmentMessage(kind, asset.name, 'file manager', asset.uri);
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

  const pickMultipleImages = async (target) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow gallery access to select images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });

    if (!result.canceled && result.assets?.length) {
      const uris = result.assets.map((asset) => asset.uri);
      if (target === 'status') {
        setStatusAssetUris(uris);
      } else {
        setCatalogImageUris(uris);
      }
    }
  };

  const postStatus = async () => {
    if (!statusDraft.trim() && !statusAssetUris.length) {
      return;
    }

    const uploadedUrls = await uploadUris(statusAssetUris, {
      names: statusAssetUris.map((_, index) => `status-${Date.now()}-${index}.jpg`),
      fallbackType: 'image/jpeg',
    }).catch(() => []);

    fetch(`${API_BASE_URL}/api/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
        text: statusDraft.trim(),
        assets: uploadedUrls.map((uri, index) => ({
          kind: 'image',
          url: uri,
          caption: index === 0 ? statusDraft.trim() : '',
        })),
        backgroundColor: statusBackgroundColor,
        fontFamily: statusFontFamily,
        fontSize: statusFontSize,
        audience: 'contacts',
      }),
    }).catch(() => undefined);
    setStatusDraft('');
    setStatusAssetUris([]);
    setStatusComposerVisible(false);
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

  const submitAuth = async () => {
    const endpoint =
      authMode === 'login'
        ? '/api/auth/login'
        : authMode === 'register'
          ? '/api/auth/register'
          : '/api/auth/switch';
    const body =
      authMode === 'switch'
        ? {
            deviceId: currentDeviceId,
            userId: authForm.phone,
            platform: Platform.OS,
            label: `${Platform.OS} device`,
          }
        : {
            deviceId: currentDeviceId,
            phone: authForm.phone.trim(),
            name: authForm.name.trim(),
            platform: Platform.OS,
            label: `${Platform.OS} device`,
          };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (payload.session?.deviceId) {
      await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
      setCurrentDeviceId(payload.session.deviceId);
    }
    if (payload.bootstrap) {
      applyBootstrapPayload(payload.bootstrap);
    }
    setAuthVisible(false);
    setAuthForm({ name: '', phone: '' });
  };

  const switchToUser = async (userId) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: currentDeviceId,
        userId,
        platform: Platform.OS,
        label: `${Platform.OS} device`,
      }),
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (payload.session?.deviceId) {
      await AsyncStorage.setItem(DEVICE_STORAGE_KEY, payload.session.deviceId);
      setCurrentDeviceId(payload.session.deviceId);
    }
    if (payload.bootstrap) {
      applyBootstrapPayload(payload.bootstrap);
    }
    setAuthVisible(false);
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
      setCallError('Camera or microphone permission was denied.');
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
      setActiveView('Calls');
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

  const playVoiceMessage = async (message) => {
    if (!message.audioUri) {
      Alert.alert('Voice note', 'This is a placeholder voice note preview.');
      return;
    }

    try {
      if (currentSoundRef.current) {
        await currentSoundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync({ uri: message.audioUri });
      currentSoundRef.current = sound;
      await sound.playAsync();
    } catch (error) {
      Alert.alert('Voice note', 'Unable to play this recording on the current device.');
    }
  };

  const startVoiceRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow microphone access to send voice notes.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      recordingStartedAtRef.current = Date.now();
      setRecordingLabel('Recording 0:00');
      recordingIntervalRef.current = setInterval(() => {
        const durationMs = Date.now() - recordingStartedAtRef.current;
        setRecordingLabel(`Recording ${getAudioDurationLabel(durationMs)}`);
      }, 1000);
      setIsRecording(true);
    } catch (error) {
      Alert.alert('Recording failed', 'Voice note recording could not start.');
    }
  };

  const stopVoiceRecording = async () => {
    if (!recordingRef.current) {
      return;
    }

    try {
      const recording = recordingRef.current;
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      const duration = Date.now() - recordingStartedAtRef.current;
      recordingRef.current = null;
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      setIsRecording(false);
      setRecordingLabel('');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

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
        names: [`voice-${Date.now()}.m4a`],
        fallbackType: inferMimeType(uri, 'audio/m4a'),
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
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
      setIsRecording(false);
      setRecordingLabel('');
      recordingRef.current = null;
      Alert.alert('Recording failed', 'Voice note recording could not be completed.');
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
      <Pressable style={styles.dialogOverlay} onPress={() => setCallSheetVisible(false)}>
        <Pressable style={styles.dialog} onPress={() => undefined}>
          <Text style={styles.dialogTitle}>Choose call type</Text>
          <Pressable style={styles.dialogAction} onPress={() => void startCall('Audio')}>
            <Text style={styles.dialogActionTitle}>Audio call</Text>
            <Text style={styles.dialogActionBody}>Start a voice call with {activeChat.name}</Text>
          </Pressable>
          <Pressable style={styles.dialogAction} onPress={() => void startCall('Video')}>
            <Text style={styles.dialogActionTitle}>Video call</Text>
            <Text style={styles.dialogActionBody}>Start a video call with {activeChat.name}</Text>
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
        ]}
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
          {message.mine ? (
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
          <Text style={styles.detailSubtitle}>{activeChat.presence}</Text>
        </View>
        <View style={styles.detailHeaderActions}>
          <Pressable
            style={styles.iconCircle}
            onPress={() => {
              setActiveView('Tools');
              setChatScreen('list');
            }}
          >
            <Text style={styles.iconText}>🏬</Text>
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

      <View style={styles.composer}>
        <TextInput
          value={messageDraft}
          onChangeText={setMessageDraft}
          placeholder="Message"
          placeholderTextColor="#7d8b92"
          multiline
          textAlignVertical="top"
          style={styles.composerInput}
        />
        {renderComposerActions()}
      </View>
    </View>
  );

  const renderChatList = () => (
    <>
      <View style={styles.topBar}>
        <Pressable style={styles.iconCircle}>
          <Text style={styles.iconText}>⋯</Text>
        </Pressable>
        <Text style={styles.centerTitle}>Chats</Text>
        <View style={styles.topActions}>
          <Pressable style={styles.iconCircle} onPress={() => setActiveView('Tools')}>
            <Text style={styles.iconText}>🏬</Text>
          </Pressable>
          <Pressable style={styles.iconCircle} onPress={() => setCallSheetVisible(true)}>
            <Text style={styles.iconText}>☎</Text>
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.archiveRow}>
        <Text style={styles.archiveIcon}>▭</Text>
        <Text style={styles.archiveText}>Archived</Text>
      </Pressable>

      <ScrollView style={styles.chatList} showsVerticalScrollIndicator={false}>
        {chatItems.length ? chatItems.map((chat) => (
          <Pressable key={chat.id} style={styles.chatRow} onPress={() => { setSelectedChatId(chat.id); setChatScreen('detail'); }}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{chat.name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.chatRowCopy}>
              <View style={styles.chatRowTop}>
                <Text style={styles.chatName}>{chat.name}</Text>
                <Text style={[styles.chatTime, chat.unread > 0 ? styles.chatTimeActive : null]}>{chat.time}</Text>
              </View>
              <View style={styles.chatRowBottom}>
                <Text numberOfLines={2} style={styles.chatPreview}>{chat.preview}</Text>
                {chat.unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>{chat.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        )) : (
          <View style={styles.emptyChatCard}>
            <Text style={styles.cardTitle}>No chats yet</Text>
            <Text style={styles.cardBody}>Start a new conversation with one of your registered contacts.</Text>
            <Pressable style={styles.sendButtonWide} onPress={() => setNewChatVisible(true)}>
              <Text style={styles.sendButtonText}>New conversation</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </>
  );

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

  const renderCatalog = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      <Text style={styles.secondaryTitle}>Catalog</Text>
      <TextInput
        value={catalogSearch}
        onChangeText={setCatalogSearch}
        placeholder="Search products from sellers around the world"
        placeholderTextColor="#7d8b92"
        style={styles.input}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {categoryOptions.map((category) => (
          <Pressable
            key={category}
            onPress={() => setCatalogCategory(category)}
            style={[styles.categoryChip, catalogCategory === category ? styles.categoryChipActive : null]}
          >
            <Text style={[styles.categoryChipText, catalogCategory === category ? styles.categoryChipTextActive : null]}>
              {category}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {filteredCatalogItems.map((item) => (
        <View key={item.id} style={styles.catalogCard}>
          <Image source={{ uri: item.imageUri }} style={styles.catalogImage} />
          <View style={styles.catalogCardBody}>
            <Text style={styles.catalogTitle}>{item.title}</Text>
            <Text style={styles.catalogPrice}>{item.price}</Text>
            <Text style={styles.catalogSeller}>{item.seller}</Text>
            <Text style={styles.catalogDescription}>{item.description}</Text>
            <Pressable
              style={styles.catalogButton}
              onPress={() => {
                setActiveView('Chats');
                setChatScreen('detail');
                const seller = Object.values(usersById).find((user) => user.name === item.seller && user.id !== currentUserId);
                if (seller) {
                  void createDirectChat(seller.id, `Hi, I want to buy ${item.title}. `);
                } else {
                  setSelectedChatId('c4');
                  setMessageDraft(`Hi, I want to buy ${item.title}. `);
                }
              }}
            >
              <Text style={styles.catalogButtonText}>Chat seller</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Registered contacts</Text>
        {contactItems.map((contact) => (
          <Text key={contact.id} style={styles.contactLine}>
            {contact.name} · {contact.registered ? 'Registered' : 'Invite needed'}
          </Text>
        ))}
      </View>
    </ScrollView>
  );

  const renderStatus = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      <View style={styles.statusHeaderRow}>
        <Text style={styles.secondaryTitle}>Status</Text>
        <View style={styles.statusHeaderActions}>
          <Pressable style={styles.iconCircle} onPress={() => pickMultipleImages('status')}>
            <Text style={styles.iconText}>📷+</Text>
          </Pressable>
          <Pressable style={styles.iconCircle} onPress={() => setStatusComposerVisible(true)}>
            <Text style={styles.iconText}>✎</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusStrip}>
        {updatesFeed.map((entry, index) => {
          const latestStatus = entry.items?.[0];
          const cover = latestStatus?.assets?.[0]?.url || null;
          const isMine = entry.userId === currentUserId;
          return (
            <View key={entry.userId} style={styles.statusCard}>
              <Pressable style={styles.statusCardMedia} onPress={() => openStatusViewer(index)}>
                {cover ? (
                  <Image source={{ uri: cover }} style={styles.statusCardImage} />
                ) : (
                  <View style={styles.statusCardFallback}>
                    <Text style={styles.statusCardFallbackText}>{entry.name.slice(0, 1)}</Text>
                  </View>
                )}
                <View style={styles.statusAvatarRing}>
                  <View style={styles.statusAvatarInner}>
                    <Text style={styles.statusAvatarText}>{entry.name.slice(0, 2).toUpperCase()}</Text>
                  </View>
                </View>
                <View style={styles.statusCountBadge}>
                  <Text style={styles.statusCountBadgeText}>{entry.items.length}</Text>
                </View>
                {isMine && latestStatus ? (
                  <Pressable style={styles.statusDeleteButton} onPress={() => deleteStatus(latestStatus.id)}>
                    <Text style={styles.statusDeleteText}>Delete</Text>
                  </Pressable>
                ) : null}
              </Pressable>
              <Text style={styles.statusCardTitle}>{entry.name}</Text>
            </View>
          );
        })}
      </ScrollView>
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView style={styles.secondaryScreen} contentContainerStyle={styles.secondaryContent}>
      <Text style={styles.secondaryTitle}>Settings</Text>
      <View style={styles.profileHero}>
        <Image source={{ uri: profile.photoUri }} style={styles.profileImage} />
        <Text style={styles.editPhotoText}>Edit photo</Text>
      </View>

      <TextInput
        value={profile.about}
        onChangeText={(value) => setProfile((current) => ({ ...current, about: value }))}
        placeholder="About"
        placeholderTextColor="#7d8b92"
        style={styles.input}
      />
      <TextInput
        value={profile.name}
        onChangeText={(value) => setProfile((current) => ({ ...current, name: value }))}
        placeholder="Name"
        placeholderTextColor="#7d8b92"
        style={styles.input}
      />
      <TextInput
        value={profile.phone}
        onChangeText={(value) => setProfile((current) => ({ ...current, phone: value }))}
        placeholder="Phone number"
        placeholderTextColor="#7d8b92"
        style={styles.input}
      />

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settings menu</Text>
        {settingsSections.map((section) => (
          <Text key={section} style={styles.settingsLine}>{section}</Text>
        ))}
        <Pressable style={styles.sendButtonWide} onPress={() => { setAuthMode('switch'); setAuthVisible(true); }}>
          <Text style={styles.sendButtonText}>Switch or login</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add catalog item</Text>
        <Pressable style={styles.ghostButton} onPress={() => pickMultipleImages('catalog')}>
          <Text style={styles.ghostButtonText}>
            {catalogImageUris.length ? `${catalogImageUris.length} catalog image(s) selected` : 'Add multiple catalog images'}
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
          placeholder="Price"
          placeholderTextColor="#7d8b92"
          style={styles.input}
        />
        <TextInput
          value={catalogForm.category}
          onChangeText={(value) => setCatalogForm((current) => ({ ...current, category: value }))}
          placeholder="Category"
          placeholderTextColor="#7d8b92"
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
        <Pressable style={styles.sendButtonWide} onPress={addCatalogItem}>
          <Text style={styles.sendButtonText}>Add to catalog</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {activeView === 'Chats' && chatScreen === 'detail' ? (
        renderChatDetail()
      ) : (
        <View style={styles.screen}>
          {activeView === 'Chats' ? renderChatList() : null}
          {activeView === 'Calls' ? renderCalls() : null}
          {activeView === 'Tools' ? renderCatalog() : null}
          {activeView === 'Updates' ? renderStatus() : null}
          {activeView === 'Settings' ? renderSettings() : null}

          <View style={styles.bottomNav}>
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
                    {tab === 'Updates' ? '◌' : tab === 'Calls' ? '◐' : tab === 'Tools' ? '⌘' : tab === 'Chats' ? '◔' : '⚙'}
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
        animationType="slide"
        visible={statusComposerVisible}
        onRequestClose={() => setStatusComposerVisible(false)}
      >
        <View style={styles.statusComposerOverlay}>
          <View style={styles.statusComposerSheet}>
            <View style={styles.statusComposerHeader}>
              <Text style={styles.statusComposerTitle}>Create text status</Text>
              <Pressable onPress={() => setStatusComposerVisible(false)}>
                <Text style={styles.storyClose}>Close</Text>
              </Pressable>
            </View>
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
            <TextInput
              value={statusDraft}
              onChangeText={setStatusDraft}
              placeholder="Share an update"
              placeholderTextColor="#7d8b92"
              multiline
              style={styles.textArea}
            />
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
            <Pressable style={styles.sendButtonWide} onPress={postStatus}>
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
                    isLooping={false}
                    shouldPlay={!statusPlaybackPaused}
                    resizeMode={ResizeMode.CONTAIN}
                    source={{ uri: activeStatusItem.assets[0].url }}
                    style={styles.storyMedia}
                    useNativeControls={false}
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
        animationType="fade"
        visible={newChatVisible}
        onRequestClose={() => setNewChatVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setNewChatVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>New conversation</Text>
            <View style={styles.authAccountList}>
              {Object.values(usersById).filter((user) => user.id !== currentUserId).map((user) => (
                <Pressable key={user.id} style={styles.sheetOption} onPress={() => void createDirectChat(user.id)}>
                  <Text style={styles.sheetOptionTitle}>{user.name}</Text>
                  <Text style={styles.sheetOptionBody}>{user.phone}</Text>
                </Pressable>
              ))}
            </View>
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
                {localCallStream?.toURL ? <RTCView streamURL={localCallStream.toURL()} style={styles.callVideoTile} objectFit="cover" /> : <View style={styles.callVideoTilePlaceholder}><Text style={styles.cardMeta}>Local video</Text></View>}
                {remoteCallStream?.toURL ? <RTCView streamURL={remoteCallStream.toURL()} style={styles.callVideoTile} objectFit="cover" /> : <View style={styles.callVideoTilePlaceholder}><Text style={styles.cardMeta}>Waiting for peer</Text></View>}
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
        onRequestClose={() => setAuthVisible(false)}
      >
        <Pressable style={styles.dialogOverlay} onPress={() => setAuthVisible(false)}>
          <Pressable style={styles.dialog} onPress={() => undefined}>
            <Text style={styles.dialogTitle}>Account</Text>
            <View style={styles.authTabRow}>
              {['switch', 'login', 'register'].map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setAuthMode(mode)}
                  style={[styles.authTab, authMode === mode ? styles.authTabActive : null]}
                >
                  <Text style={styles.authTabText}>{mode}</Text>
                </Pressable>
              ))}
            </View>
            {authMode === 'switch' ? (
              <View style={styles.authAccountList}>
                {Object.values(usersById).map((user) => (
                  <Pressable key={user.id} style={styles.sheetOption} onPress={() => void switchToUser(user.id)}>
                    <Text style={styles.sheetOptionTitle}>{user.name}</Text>
                    <Text style={styles.sheetOptionBody}>{user.phone}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                {authMode === 'register' ? (
                  <TextInput
                    value={authForm.name}
                    onChangeText={(value) => setAuthForm((current) => ({ ...current, name: value }))}
                    placeholder="Full name"
                    placeholderTextColor="#7d8b92"
                    style={styles.input}
                  />
                ) : null}
                <TextInput
                  value={authForm.phone}
                  onChangeText={(value) => setAuthForm((current) => ({ ...current, phone: value }))}
                  placeholder="Phone number"
                  placeholderTextColor="#7d8b92"
                  style={styles.input}
                />
                <Pressable style={styles.sendButtonWide} onPress={() => void submitAuth()}>
                  <Text style={styles.sendButtonText}>Continue</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
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
    paddingBottom: 18,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#171717',
    backgroundColor: '#0d0d0d',
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  bottomNavIconWrap: {
    position: 'relative',
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNavIcon: {
    color: '#8b8f94',
    fontSize: 20,
  },
  bottomNavIconActive: {
    color: '#60a5fa',
  },
  bottomNavLabel: {
    color: '#8b8f94',
    fontSize: 11,
  },
  bottomNavLabelActive: {
    color: '#f6f7f8',
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
  sheetBack: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  sheetBackText: {
    color: '#60a5fa',
    fontWeight: '700',
  },
  dialog: {
    marginHorizontal: 24,
    backgroundColor: '#111b21',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 24,
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
});
