import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  comments?: Array<{ id: string; userId: string; text: string; createdAt: string }>;
  views?: Array<{ userId: string; viewedAt: string }>;
  createdAt: string;
};

type StatusViewer = {
  userId: string;
  name: string;
  avatar: string;
  viewedAt: string;
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
    comments?: Array<{ id: string; userId: string; text: string; createdAt: string }>;
    views?: Array<{ userId: string; viewedAt: string }>;
    createdAt: string;
  }>;
};

const API_BASE_URL = 'http://localhost:4000';
const DEVICE_STORAGE_KEY = 'zynkup-web-device-id';
const STATUS_IMAGE_DURATION_MS = 5000;
const STATUS_VIDEO_DURATION_MS = 60000;
const STATUS_REACTIONS = ['❤️', '👍', '👎', '🔥', '😂'];

const initialChats: Chat[] = [
  { id: 'c1', name: 'Mr.Hodalor', preview: '📷 Sunday outfit', time: '7:35 PM', unread: 0, presence: 'online' },
  { id: 'c2', name: '+260 96 7340068', preview: 'Voice note', time: '1:38 PM', unread: 0, presence: 'last seen recently' },
  { id: 'c3', name: 'Chilenje C.o.C Youth', preview: '~~LEE/🦋🔥💯❣️: Copy the message...', time: '6:49 PM', unread: 10, presence: 'typing...' },
  { id: 'c4', name: 'Chory', preview: 'Hi', time: '6:30 PM', unread: 0, presence: 'online' },
  { id: 'c5', name: 'Princess', preview: '📷 6 photos', time: 'Sunday', unread: 2, presence: 'online' },
];

const initialCatalogItems: CatalogItem[] = [
  {
    id: 'p1',
    title: 'Church Suit',
    price: 'K 1,450',
    seller: 'Temwa Lesa',
    category: 'Fashion',
    description: 'Tailored two-piece suit with same-day fitting available.',
    imageUrl: 'https://images.unsplash.com/photo-1593032465171-f295b07d0b32?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'p2',
    title: 'Samsung S23',
    price: 'K 12,800',
    seller: 'Tech World Zambia',
    category: 'Phones',
    description: 'Factory unlocked with charger, case, and receipt.',
    imageUrl: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: 'p3',
    title: 'Blender Pro',
    price: 'K 780',
    seller: 'Princess Kitchen Store',
    category: 'Home',
    description: 'Heavy-duty blender for smoothies and sauces.',
    imageUrl: 'https://images.unsplash.com/photo-1570222094114-d054a817e56b?auto=format&fit=crop&w=900&q=80',
  },
];

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

function App() {
  const [activeView, setActiveView] = useState<View>('chats');
  const [selectedChatId, setSelectedChatId] = useState<string>('c1');
  const [messageDraft, setMessageDraft] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('All');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>(initialCatalogItems);
  const [callSheetVisible, setCallSheetVisible] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('u1');
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');
  const [statusAssetFiles, setStatusAssetFiles] = useState<File[]>([]);
  const [catalogAssetFiles, setCatalogAssetFiles] = useState<File[]>([]);
  const [updatesFeed, setUpdatesFeed] = useState<UpdateGroup[]>([]);
  const [statuses, setStatuses] = useState<StatusItem[]>([]);
  const [activeStatusGroupIndex, setActiveStatusGroupIndex] = useState<number | null>(null);
  const [activeStatusItemIndex, setActiveStatusItemIndex] = useState(0);
  const [statusProgress, setStatusProgress] = useState(0);
  const [statusCommentDraft, setStatusCommentDraft] = useState('');
  const [statusViewers, setStatusViewers] = useState<StatusViewer[]>([]);
  const [statusViewersVisible, setStatusViewersVisible] = useState(false);
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
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({
    c1: [
      {
        id: 'm1',
        sender: 'other',
        kind: 'image',
        text: 'Sunday outfit',
        imageUrl:
          'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
        time: '7:02 PM',
      },
      {
        id: 'm2',
        sender: 'me',
        kind: 'text',
        text: 'Document preview ready',
        time: '7:02 PM',
      },
    ],
    c2: [
      {
        id: 'm3',
        sender: 'other',
        kind: 'voice',
        text: 'Voice note',
        durationLabel: '0:14',
        time: '1:38 PM',
      },
    ],
    c3: [
      {
        id: 'm4',
        sender: 'other',
        kind: 'text',
        text: '~~LEE/🦋🔥💯❣️: Copy the message and repost',
        time: '6:49 PM',
      },
    ],
    c4: [
      {
        id: 'm5',
        sender: 'other',
        kind: 'text',
        text: 'Hi',
        time: '6:30 PM',
      },
    ],
    c5: [
      {
        id: 'm6',
        sender: 'other',
        kind: 'image',
        text: '6 photos',
        imageUrl:
          'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
        time: 'Sunday',
      },
    ],
  });
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const statusInputRef = useRef<HTMLInputElement | null>(null);
  const catalogInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const [chatItems, setChatItems] = useState<Chat[]>(initialChats);
  const activeChat = chatItems.find((chat) => chat.id === selectedChatId) ?? chatItems[0] ?? initialChats[0];
  const messages = messagesByChat[activeChat.id] ?? [];
  const activeStatusGroup = activeStatusGroupIndex === null ? null : updatesFeed[activeStatusGroupIndex] ?? null;
  const activeStatusItem = activeStatusGroup?.items[activeStatusItemIndex] ?? null;
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

  const syncReceiptState = async (messageId: string, state: ReceiptState) => {
    await fetch(`${API_BASE_URL}/api/messages/${messageId}/receipt`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }).catch(() => undefined);
  };

  const applyBootstrap = (payload: any) => {
    setCurrentUserId(payload.currentUserId ?? 'u1');
    setCurrentDeviceId(payload.currentDeviceId ?? null);
    setProfile({
      name: payload.profile?.name ?? 'Temwa Lesa',
      about: payload.profile?.about ?? '',
      phone: payload.profile?.phone ?? '',
      photoUrl: payload.profile?.avatar?.startsWith?.('http')
        ? payload.profile.avatar
        : 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    });
    setChatItems(
      (payload.chats ?? []).map((chat: any) => ({
        id: chat.id,
        name: chat.title,
        preview: chat.lastMessagePreview,
        time: formatClock(chat.updatedAt ?? new Date().toISOString()),
        unread: chat.unreadCount ?? 0,
        presence: 'online',
      })),
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
    setStatuses(payload.statuses ?? []);
    setUpdatesFeed(payload.updatesFeed ?? []);
  };

  const closeStatusViewer = () => {
    setActiveStatusGroupIndex(null);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
  };

  const openStatusViewer = (groupIndex: number) => {
    setActiveStatusGroupIndex(groupIndex);
    setActiveStatusItemIndex(0);
    setStatusProgress(0);
    setStatusCommentDraft('');
    setStatusViewersVisible(false);
  };

  const moveStatus = useCallback((direction: 'next' | 'previous') => {
    if (activeStatusGroupIndex === null) {
      return;
    }

    const currentGroup = updatesFeed[activeStatusGroupIndex];
    if (!currentGroup) {
      closeStatusViewer();
      return;
    }

    if (direction === 'previous') {
      if (activeStatusItemIndex > 0) {
        setActiveStatusItemIndex((current) => current - 1);
        setStatusProgress(0);
        return;
      }

      if (activeStatusGroupIndex > 0) {
        const previousGroup = updatesFeed[activeStatusGroupIndex - 1];
        setActiveStatusGroupIndex(activeStatusGroupIndex - 1);
        setActiveStatusItemIndex(Math.max(0, (previousGroup?.items.length ?? 1) - 1));
        setStatusProgress(0);
      }
      return;
    }

    if (activeStatusItemIndex < currentGroup.items.length - 1) {
      setActiveStatusItemIndex((current) => current + 1);
      setStatusProgress(0);
      return;
    }

    if (activeStatusGroupIndex < updatesFeed.length - 1) {
      setActiveStatusGroupIndex(activeStatusGroupIndex + 1);
      setActiveStatusItemIndex(0);
      setStatusProgress(0);
      return;
    }

    closeStatusViewer();
  }, [activeStatusGroupIndex, activeStatusItemIndex, updatesFeed]);

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
          applyBootstrap(payload.bootstrap);
        }
        return;
      } catch {
        const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
        fetch(`${API_BASE_URL}/api/bootstrap${query}`)
          .then((response) => response.json())
          .then((payload) => {
            if (!cancelled) {
              applyBootstrap(payload);
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
        applyBootstrap(payload.bootstrap);
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
  }, [activeView, currentDeviceId, currentUserId, profile.name, reconcileIncomingMessage, selectedChatId, upsertStatus]);

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
    if (!activeStatusItem) {
      return;
    }

    fetch(`${API_BASE_URL}/api/statuses/${activeStatusItem.id}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId }),
    }).catch(() => undefined);

    const duration = getStatusItemDuration(activeStatusItem);
    const startedAt = Date.now();
    setStatusProgress(0);

    const timer = window.setInterval(() => {
      const ratio = Math.min(1, (Date.now() - startedAt) / duration);
      setStatusProgress(ratio);
      if (ratio >= 1) {
        window.clearInterval(timer);
        moveStatus('next');
      }
    }, 80);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeStatusGroupIndex, activeStatusItemIndex, activeStatusItem, currentUserId, moveStatus]);

  const sendMessage = () => {
    if (!messageDraft.trim()) {
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
              durationLabel: '0:05',
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
                durationSeconds: 5,
              }),
            }),
          )
          .catch(() => undefined);
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      recorder.start();
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
          {isRecording ? 'Stop' : 'Mic'}
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

  const renderChatsView = () => (
    <>
      <section className="chat-sidebar">
        <header className="chat-sidebar-header">
          <h1>Chats</h1>
          <button className="compose-square" type="button">✎</button>
        </header>

        <div className="search-box desktop-search">
          <input aria-label="Search chats" placeholder="Search" />
        </div>

        <div className="chat-list desktop-chat-list">
          {chatItems.map((chat) => (
            <button
              className={`chat-list-item desktop-chat-item ${chat.id === activeChat.id ? 'active' : ''}`}
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
          <input
            aria-label="Message composer"
            onChange={(event) => setMessageDraft(event.target.value)}
            placeholder="Type a message"
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
                  setSelectedChatId('c4');
                  setMessageDraft(`Hi, I want to buy ${item.title}. `);
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
          <p>Post multiple photos or text status and watch them appear in realtime.</p>
        </div>
      </header>

      <div className="updates-composer">
        <textarea
          onChange={(event) => setStatusText(event.target.value)}
          placeholder="Share an update"
          value={statusText}
        />
        <div className="updates-actions">
          <button onClick={() => statusInputRef.current?.click()} type="button">Add Photos</button>
          <button
            onClick={async () => {
              const assetUrls = await uploadFiles(statusAssetFiles).catch((): string[] => []);
              fetch(`${API_BASE_URL}/api/statuses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: currentUserId,
                  text: statusText,
                  assets: assetUrls.map((url: string) => ({ kind: 'image', url })),
                  audience: 'contacts',
                }),
              }).catch(() => undefined);
              setStatusText('');
              setStatusAssetFiles([]);
            }}
            type="button"
          >
            Post Update
          </button>
        </div>
      </div>

      <section className="status-board">
        <div className="status-board-header">
          <div>
            <h3>Status</h3>
            <p>{statuses.length} live update{statuses.length === 1 ? '' : 's'}</p>
          </div>
          <div className="status-board-actions">
            <button onClick={() => statusInputRef.current?.click()} type="button">📷+</button>
            <button type="button">✎</button>
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

  return (
    <div className="desktop-shell">
      <aside className="rail">
        <div className="rail-icons">
          <button className={`rail-button rail-badged ${activeView === 'chats' ? 'active' : ''}`} onClick={() => setActiveView('chats')} type="button">
            💬
            <span>25</span>
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
        <div className="modal-overlay" onClick={() => setCallSheetVisible(false)}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h3>Choose call type</h3>
            <button onClick={() => setCallSheetVisible(false)} type="button">Audio Call</button>
            <button onClick={() => setCallSheetVisible(false)} type="button">Video Call</button>
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

            <div className="status-viewer-body">
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
                    <span>Replies {activeStatusItem.comments?.length ?? 0}</span>
                    <span>Reactions {activeStatusItem.reactions?.length ?? 0}</span>
                  </div>
                  <div className="status-reaction-row">
                    {STATUS_REACTIONS.map((emoji) => (
                      <button key={emoji} className="status-reaction-button" onClick={() => submitStatusReaction(emoji)} type="button">
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="status-comment-row">
                    <input
                      onChange={(event) => setStatusCommentDraft(event.target.value)}
                      placeholder="Reply to status"
                      value={statusCommentDraft}
                    />
                    <button onClick={submitStatusComment} type="button">Send</button>
                  </div>
                  {activeStatusItem.comments?.length ? (
                    <div className="status-comment-list">
                      {activeStatusItem.comments.slice(-3).map((comment) => (
                        <div className="status-comment-item" key={comment.id}>
                          <strong>{comment.userId === currentUserId ? 'You' : comment.userId}</strong>
                          <span>{comment.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <button className="status-hit-zone right" onClick={() => moveStatus('next')} type="button" />
            </div>
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
    </div>
  );
}

export default App;
