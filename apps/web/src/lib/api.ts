// Zentraler API-Client: hängt das JWT an und kapselt Fehlerbehandlung.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const TOKEN_KEY = 'forecast_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, pfad: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${pfad}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const rawMsg = (data as { message?: unknown })?.message ?? `Fehler ${res.status}`;
    const msg = Array.isArray(rawMsg) ? rawMsg.join(', ') : typeof rawMsg === 'string' ? rawMsg : `Fehler ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** Lädt eine Datei mit Bearer-Auth herunter und stößt den Browser-Download an. */
export async function downloadDatei(pfad: string, methode: 'GET' | 'POST', dateiname: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE}${pfad}`, { method: methode, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = `Fehler ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? msg);
    } catch {
      /* Antwort war kein JSON */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
};
