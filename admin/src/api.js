const STORAGE_KEY = 'zynkadmin-session';

export const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
};

export const saveSession = (session) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const clearSession = () => localStorage.removeItem(STORAGE_KEY);

export async function api(path, options = {}, session) {
  const current = session || loadSession();
  const base = (current?.apiBase || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(current?.token ? { Authorization: `Bearer ${current.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
