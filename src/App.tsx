import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import './App.css';

type View = 'chats' | 'catalog' | 'settings' | 'updates';
type ReceiptState = 'sent' | 'delivered' | 'read';

type Message = {
  id: string;
  clientRef?: string;
  sender: 'me' | 'other';
  kind: 'text' | 'image' | 'voice' | 'file';
  text: string;
  time: string;
  imageUrl?: string;
  audioUrl?: string;
  durationLabel?: string;
  receiptState?: ReceiptState;
};

type Chat = {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: number;
  presence: string;
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

type CatalogItem = {
  id: string;
  title: string;
  price: string;
  seller: string;
  category: string;
  description: string;
  imageUrl: string;
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

type AppUser = {
  id: string;
  name: string;
  avatar: string;
  phone: string;
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

const API_BASE_URL = 'http://localhost:4000';
const DEVICE_STORAGE_KEY = 'zynkup-web-device-id';
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const STATUS_REACTIONS = ['❤️', '👍', '👎', '🔥', '😂'];

const initialChats: Chat[] = [];

const initialCatalogItems: CatalogItem[] = [];

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

const categories = ['All', 'Fashion', 'Phones', 'Home', 'Electronics'];
const emojiChoices = ['😀', '😂', '🤣', '😍', '🔥', '🙏', '🎉', '❤️'];

const formatClock = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

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

const mapChatFromServer = (chat: any, userId: string, userList: AppUser[]) => ({
  id: chat.id,
  name: getChatTitle(chat, userId, userList),
  preview: chat.lastMessagePreview,
  time: formatClock(chat.updatedAt ?? new Date().toISOString()),
  unread: chat.unreadCount ?? 0,
  presence: 'online',
  peerUserId: chat.kind === 'direct'
    ? (chat.participants ?? []).find((participantId: string) => participantId !== userId)
    : undefined,
});

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
  const [mediaViewer, setMediaViewer] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [statusText, setStatusText] = useState('');
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
  const [profile, setProfile] = useState({
    name: 'Temwa Lesa',
    about: 'Seller, founder, and product operator.',
    phone: '+260765453163',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
  });
  const [catalogForm, setCatalogForm] = useState({
    title: '',
    price: '',
    category: 'Fashion',
    description: '',
  });
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  const catalogInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callMediaStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const applyBootstrapRef = useRef<(payload: any) => void>(() => undefined);
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
    if (callMediaStreamRef.current) {
      return callMediaStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video',
    });
    callMediaStreamRef.current = stream;
    setLocalCallStream(stream);
    return stream;
  };

  const emitCallSignal = (callId: string, signalType: 'offer' | 'answer' | 'ice-candidate', payload: unknown, toUserId?: string) => {
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
      const mapped = {
        id: incomingMessage.id,
        clientRef: incomingMessage.clientRef,
        sender: incomingMessage.senderId === currentUserId ? 'me' : 'other',
        kind: incomingMessage.kind === 'emoji' ? 'text' : incomingMessage.kind,
        text: incomingMessage.text,
        time: formatClock(incomingMessage.sentAt),
        imageUrl: incomingMessage.mediaUrls?.[0],
        audioUrl: incomingMessage.mediaUrls?.[0],
        durationLabel: incomingMessage.durationSeconds ? `0:${String(incomingMessage.durationSeconds).padStart(2, '0')}` : undefined,
        receiptState: incomingMessage.state,
      } satisfies Message;

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
      photoUrl: payload.profile?.avatar?.startsWith?.('http')
        ? payload.profile.avatar
        : 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    });
    const nextChats = (payload.chats ?? []).map((chat: any) => mapChatFromServer(chat, payload.currentUserId ?? 'u1', nextUsers));
    setChatItems(nextChats);
    setSelectedChatId((current) =>
      nextChats.some((chat: Chat) => chat.id === current) ? current : nextChats[0]?.id ?? '',
    );
    setMessagesByChat(
      Object.fromEntries(
        Object.entries(payload.messagesByChat ?? {}).map(([chatId, messageList]) => [
          chatId,
          (messageList as any[]).map((message) => ({
            id: message.id,
            clientRef: message.clientRef,
            sender: message.senderId === (payload.currentUserId ?? 'u1') ? 'me' : 'other',
            kind: message.kind === 'emoji' ? 'text' : message.kind,
            text: message.text,
            time: formatClock(message.sentAt),
            imageUrl: message.mediaUrls?.[0],
            audioUrl: message.mediaUrls?.[0],
            durationLabel: message.durationSeconds ? `0:${String(message.durationSeconds).padStart(2, '0')}` : undefined,
            receiptState: message.state,
          })),
        ]),
      ),
    );
    setCatalogItems(
      (payload.catalogItems ?? []).map((item: any) => ({
        id: item.id,
        title: item.title,
        price: `${item.currency ?? 'ZMW'} ${item.price}`,
        seller: payload.users?.find?.((user: any) => user.id === item.sellerId)?.name ?? 'Seller',
        category: item.category,
        description: item.description,
        imageUrl: item.imageUrls?.[0] ?? '',
      })),
    );
    const nextCalls = (payload.calls ?? []).map((call: any) => mapCallFromServer(call, payload.currentUserId ?? 'u1', nextUsers));
    setCalls(nextCalls);
    const liveCall = nextCalls.find((call: CallItem) => call.state === 'ongoing' || call.state === 'ringing') ?? null;
    setActiveCall(liveCall);
    setIncomingCall(
      nextCalls.find((call: CallItem) => call.state === 'ringing' && call.initiatorId !== (payload.currentUserId ?? 'u1')) ?? null,
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
        void syncReceiptState(
          message.id,
          activeView === 'chats' && message.chatId === selectedChatId ? 'read' : 'delivered',
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
        const mapped = mapChatFromServer(chat, currentUserId, users);
        if (current.some((item) => item.id === mapped.id)) {
          return current;
        }
        return [mapped, ...current];
      });
    });
    socket.on('catalog:itemCreated', (item) => {
      setCatalogItems((current) => [
        {
          id: item.id,
          title: item.title,
          price: `${item.currency ?? 'ZMW'} ${item.price}`,
          seller: profile.name,
          category: item.category,
          description: item.description,
          imageUrl: item.imageUrls?.[0] ?? '',
        },
        ...current,
      ]);
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

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, currentDeviceId, currentUserId, ensurePeerConnection, profile.name, reconcileIncomingMessage, selectedChatId, upsertCall, upsertStatus, users]);

  useEffect(() => {
    if (activeView !== 'chats') {
      return;
    }

    (messagesByChat[selectedChatId] ?? [])
      .filter((message) => message.sender === 'other' && message.receiptState !== 'read')
      .forEach((message) => {
        void syncReceiptState(message.id, 'read');
      });
  }, [activeView, messagesByChat, selectedChatId]);

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
  }, [localCallStream]);

  useEffect(() => {
    attachStreamToVideo(remoteVideoRef.current, remoteCallStream);
  }, [remoteCallStream]);

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

  const startCall = async (kind: 'audio' | 'video') => {
    if (!activeChat?.peerUserId) {
      return;
    }

    setCallSheetVisible(false);
    try {
      await ensureCallMedia(kind);
      setCallError(null);
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

    const finalState: CallState =
      activeCall.state === 'ringing' && activeCall.initiatorId !== currentUserId ? 'declined' : 'completed';
    await updateCallState(activeCall.id, finalState, activeCallSeconds);
    closePeerConnection();
  };

  const sendMessage = () => {
    if (!messageDraft.trim() || !activeChat) {
      return;
    }

    const optimistic = {
      id: `local-${Date.now()}`,
      clientRef: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: 'me' as const,
      kind: 'text' as const,
      text: messageDraft.trim(),
      time: 'Now',
      receiptState: 'sent' as const,
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: [...(current[activeChat.id] ?? []), optimistic],
    }));
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
      }),
    }).catch(() => undefined);
    setMessageDraft('');
  };

  const addCatalogItem = async () => {
    if (!catalogForm.title.trim() || !catalogForm.price.trim()) {
      return;
    }

    const imageUrls = await uploadFiles(catalogAssetFiles).catch(() => []);

    fetch(`${API_BASE_URL}/api/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerId: currentUserId,
        title: catalogForm.title.trim(),
        price: Number.parseFloat(catalogForm.price) || 0,
        currency: 'ZMW',
        category: catalogForm.category,
        description: catalogForm.description.trim() || 'New product from this seller.',
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
    });
    setCatalogAssetFiles([]);
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
        audience: 'contacts',
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
          <input aria-label="Search chats" placeholder="Search" />
        </div>

        <div className="chat-list desktop-chat-list">
          {chatItems.map((chat) => (
            <button
              className={`chat-list-item desktop-chat-item ${chat.id === activeChat?.id ? 'active' : ''}`}
              key={chat.id}
              onClick={() => setSelectedChatId(chat.id)}
              type="button"
            >
              <div className="avatar desktop-avatar">{chat.name.slice(0, 2).toUpperCase()}</div>
              <div className="chat-copy">
                <div className="chat-topline">
                  <strong>{chat.name}</strong>
                  <span>{chat.time}</span>
                </div>
                <div className="chat-bottomline">
                  <span>{chat.preview}</span>
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
              <small>{activeChat.presence}</small>
            </div>
          </div>
          <div className="desktop-chat-actions">
            <button onClick={() => setActiveView('catalog')} type="button">🏬</button>
            <button onClick={() => setCallSheetVisible(true)} type="button">☎</button>
          </div>
        </header>

        <section className="desktop-canvas">
          {messages.map((message) => (
            <article className={`message-bubble ${message.sender === 'me' ? 'mine' : 'theirs'}`} key={message.id}>
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
                {renderReceipt(message)}
              </div>
            </article>
          ))}
        </section>

        <footer className="composer desktop-composer">
          <textarea
            aria-label="Message composer"
            onChange={(event) => setMessageDraft(event.target.value)}
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
      </div>

      <section className="catalog-grid">
        {filteredCatalogItems.map((item) => (
          <article className="catalog-card" key={item.id}>
            <img alt={item.title} src={item.imageUrl} />
            <div className="catalog-card-body">
              <strong>{item.title}</strong>
              <span className="catalog-price">{item.price}</span>
              <small>{item.seller}</small>
              <p>{item.description}</p>
              <button
                onClick={() => {
                  setActiveView('chats');
                  const seller = users.find((user) => user.name === item.seller && user.id !== currentUserId);
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

  const renderSettingsView = () => (
    <main className="settings-shell">
      <aside className="settings-menu">
        <h2>Settings</h2>
        <input placeholder="Search" />
        <div className="settings-user">
          <img alt={profile.name} src={profile.photoUrl} />
          <strong>{profile.name}</strong>
        </div>
        <div className="settings-links">
          {settingsSections.map((section) => (
            <button key={section} type="button">{section}</button>
          ))}
        </div>
        <button className="settings-auth-button" onClick={() => void fetchLinkedDevices(currentUserId)} type="button">
          Refresh Linked Devices
        </button>
      </aside>

      <section className="settings-profile">
        <h2>Profile</h2>
        <div className="profile-top">
          <img alt={profile.name} src={profile.photoUrl} />
          <button type="button">Edit photo</button>
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
          <input onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} value={profile.phone} />
        </label>

        <div className="business-panel">
          <h3>Linked Devices</h3>
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

        <div className="business-panel">
          <h3>Add Catalog Item</h3>
          <button onClick={() => catalogInputRef.current?.click()} type="button">Upload Catalog Images</button>
          <input
            onChange={(event) => setCatalogForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Product title"
            value={catalogForm.title}
          />
          <input
            onChange={(event) => setCatalogForm((current) => ({ ...current, price: event.target.value }))}
            placeholder="Price"
            value={catalogForm.price}
          />
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
          <button onClick={addCatalogItem} type="button">Add To Catalog</button>
        </div>
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
          <small>You can link up to 5 devices. If you hit the limit, log out from one of your linked devices first.</small>
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
      <aside className="rail">
        <div className="rail-icons">
          <button className={`rail-button rail-badged ${activeView === 'chats' ? 'active' : ''}`} onClick={() => setActiveView('chats')} type="button">
            💬
            {chatItems.length ? <span>{chatItems.length}</span> : null}
          </button>
          <button className={`rail-button ${activeView === 'updates' ? 'active' : ''}`} onClick={() => setActiveView('updates')} type="button">◌</button>
          <button className={`rail-button ${activeView === 'catalog' ? 'active' : ''}`} onClick={() => setActiveView('catalog')} type="button">🏬</button>
          <button className={`rail-button ${activeView === 'settings' ? 'active' : ''}`} onClick={() => setActiveView('settings')} type="button">⚙</button>
          <button className="rail-button" type="button">☆</button>
        </div>
        <button className="rail-button rail-bottom" onClick={() => setActiveView('settings')} type="button">⚙</button>
      </aside>

      {activeView === 'chats' ? renderChatsView() : null}
      {activeView === 'updates' ? renderUpdatesView() : null}
      {activeView === 'catalog' ? renderCatalogView() : null}
      {activeView === 'settings' ? renderSettingsView() : null}

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

      {incomingCall ? (
        <div className="modal-overlay">
          <div className="dialog-card call-card">
            <h3>Incoming {incomingCall.kind} call</h3>
            <p>{incomingCall.peerName} is calling you now.</p>
            <div className="call-card-actions">
              <button className="status-viewer-action reply" onClick={() => void acceptIncomingCall()} type="button">Answer</button>
              <button className="status-viewer-action" onClick={() => void updateCallState(incomingCall.id, 'declined', 0)} type="button">Decline</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeCall ? (
        <div className="modal-overlay">
          <div className="dialog-card call-card active">
            <h3>{activeCall.kind === 'video' ? 'Video Call' : 'Audio Call'}</h3>
            <p>{activeCall.peerName}</p>
            <strong>{activeCall.state === 'ongoing' ? formatDurationLabel(activeCallSeconds) : 'Ringing...'}</strong>
            {callError ? <p>{callError}</p> : null}
            <div className={`call-media-grid ${activeCall.kind === 'video' ? 'video' : 'audio'}`}>
              {activeCall.kind === 'video' ? (
                <video autoPlay muted playsInline ref={localVideoRef} />
              ) : (
                <div className="call-audio-pill">Your mic is live</div>
              )}
              {activeCall.kind === 'video' ? (
                <video autoPlay playsInline ref={remoteVideoRef} />
              ) : (
                <div className="call-audio-pill">{remoteCallStream ? `${activeCall.peerName} connected` : 'Waiting for peer'}</div>
              )}
            </div>
            <div className="call-card-actions">
              {activeCall.state === 'ringing' && activeCall.initiatorId !== currentUserId ? (
                <button className="status-viewer-action reply" onClick={() => void acceptIncomingCall()} type="button">Answer</button>
              ) : null}
              <button className="status-viewer-action done" onClick={() => void endActiveCall()} type="button">
                {activeCall.state === 'ongoing' ? 'End Call' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
