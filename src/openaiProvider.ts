/**
 * OpenAI helpers for ZynkUp AI features.
 * Uses OPENAI_API_KEY from env. Prefer gpt-4o-mini / whisper-1 for cost.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';

export const getOpenAiApiKey = () =>
  (process.env.OPENAI_API_KEY || process.env.SPEECH_TO_TEXT_API_KEY || '').trim();

export const hasOpenAi = () => Boolean(getOpenAiApiKey());

const chatModel = () =>
  (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';

const whisperModel = () =>
  (process.env.OPENAI_WHISPER_MODEL || 'whisper-1').trim() || 'whisper-1';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export async function openaiChat(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const key = getOpenAiApiKey();
  if (!key) throw new Error('OPENAI_API_KEY is not configured');

  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chatModel(),
      messages,
      temperature: options?.temperature ?? 0.4,
      max_tokens: options?.maxTokens ?? 800,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI chat failed (${response.status})`);
  }

  const text = payload.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('OpenAI returned an empty response');
  return text;
}

export async function openaiRewrite(text: string, tone: string): Promise<string> {
  return openaiChat(
    [
      {
        role: 'system',
        content:
          'You rewrite chat messages for ZynkUp. Keep the same meaning. '
          + 'Output ONLY the rewritten message — no quotes, labels, or explanation. '
          + 'Never invent facts, prices, or promises. Keep it send-ready and concise.',
      },
      {
        role: 'user',
        content: `Tone: ${tone}\n\nMessage:\n${text}`,
      },
    ],
    { temperature: 0.35, maxTokens: 400 },
  );
}

export async function openaiSuggestReplies(
  incomingText: string,
  tone?: string,
): Promise<Array<{ text: string; tone: string; reason: string }>> {
  const raw = await openaiChat(
    [
      {
        role: 'system',
        content:
          'You suggest short chat replies for a messaging app (Ghana / West Africa friendly). '
          + 'Return JSON only: {"suggestions":[{"text":"...","tone":"polite|concise|professional|friendly|apologetic","reason":"short_code"}]}. '
          + 'Give 3 suggestions. Drafts only — never send. No money/PIN/OTP advice that enables fraud.',
      },
      {
        role: 'user',
        content: `Preferred tone: ${tone || 'polite'}\n\nIncoming message:\n${incomingText}`,
      },
    ],
    { temperature: 0.5, maxTokens: 500 },
  );

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as {
      suggestions?: Array<{ text?: string; tone?: string; reason?: string }>;
    };
    const list = (parsed.suggestions || [])
      .map((entry) => ({
        text: (entry.text || '').trim(),
        tone: (entry.tone || tone || 'polite').trim(),
        reason: (entry.reason || 'openai').trim(),
      }))
      .filter((entry) => entry.text);
    if (list.length) return list.slice(0, 4);
  } catch {
    // fall through
  }

  return [{ text: raw.slice(0, 280), tone: tone || 'polite', reason: 'openai' }];
}

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  tw: 'Twi (Akan)',
  ga: 'Ga',
  ee: 'Ewe',
  pcm: 'Nigerian/Ghanaian Pidgin English',
  auto: 'auto-detect',
};

export async function openaiTranslate(
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
): Promise<{ translatedText: string; detectedSource?: string }> {
  const target = LANG_LABELS[targetLanguage] || targetLanguage;
  const source = LANG_LABELS[sourceLanguage || 'auto'] || sourceLanguage || 'auto-detect';
  const raw = await openaiChat(
    [
      {
        role: 'system',
        content:
          'You are a careful translator for West African chat (English, Twi, Ga, Ewe, Pidgin). '
          + 'Preserve meaning, names, numbers, and MoMo/order references. '
          + 'Return JSON only: {"translatedText":"...","detectedSource":"en|tw|ga|ee|pcm"}.',
      },
      {
        role: 'user',
        content: `Source language: ${source}\nTarget language: ${target}\n\nText:\n${text}`,
      },
    ],
    { temperature: 0.2, maxTokens: 600 },
  );

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const parsed = JSON.parse(start >= 0 ? raw.slice(start, end + 1) : raw) as {
      translatedText?: string;
      detectedSource?: string;
    };
    if (parsed.translatedText?.trim()) {
      return {
        translatedText: parsed.translatedText.trim(),
        detectedSource: parsed.detectedSource,
      };
    }
  } catch {
    // fall through
  }

  return { translatedText: raw };
}

export async function openaiTranscribeAudioUrl(
  audioUrl: string,
  language?: string,
): Promise<{ text: string; language?: string }> {
  const key = getOpenAiApiKey();
  if (!key) throw new Error('OPENAI_API_KEY is not configured');

  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new Error(`Could not download audio (${audioResponse.status})`);
  }

  const contentType = audioResponse.headers.get('content-type') || 'audio/mpeg';
  const buffer = Buffer.from(await audioResponse.arrayBuffer());
  const ext = contentType.includes('wav')
    ? 'wav'
    : contentType.includes('ogg')
      ? 'ogg'
      : contentType.includes('mp4') || contentType.includes('m4a')
        ? 'm4a'
        : contentType.includes('webm')
          ? 'webm'
          : 'mp3';

  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    `voice.${ext}`,
  );
  form.append('model', whisperModel());
  if (language && language !== 'auto') {
    // Whisper expects ISO-639-1; map regional codes loosely.
    const map: Record<string, string> = { tw: 'ak', ga: 'en', ee: 'en', pcm: 'en', en: 'en' };
    form.append('language', map[language] || language);
  }

  const response = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    text?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Whisper failed (${response.status})`);
  }

  const text = (payload.text || '').trim();
  if (!text) throw new Error('Whisper returned empty transcript');
  return { text, language: language || 'auto' };
}

export async function openaiSummarize(text: string): Promise<string> {
  return openaiChat(
    [
      {
        role: 'system',
        content:
          'Summarize this chat excerpt for a busy user. Use short bullets. '
          + 'No invented decisions. Flag money/PIN requests if present.',
      },
      { role: 'user', content: text.slice(0, 12000) },
    ],
    { temperature: 0.3, maxTokens: 500 },
  );
}

export async function openaiTwinDraft(
  inputPreview: string,
  task: string,
  context?: string,
): Promise<string> {
  return openaiChat(
    [
      {
        role: 'system',
        content:
          'You draft replies for a business AI Twin on ZynkUp. Drafts only — never send. '
          + 'Never approve refunds, transfers, discounts, or share PINs/OTPs. '
          + 'If data is missing, say the owner must confirm. Output only the draft message.',
      },
      {
        role: 'user',
        content: `Task: ${task}\nContext: ${context || 'none'}\n\nCustomer/input:\n${inputPreview}`,
      },
    ],
    { temperature: 0.4, maxTokens: 400 },
  );
}
