import type { Alert, Dispatch, DispatchDetail, DispatchStatus, Priority, Responder, Site, Stats } from './types';

export interface Session {
  apiKey: string;
  operator: string;
}

const KEY = 'dispatch.session';

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { apiKey: '', operator: '' };
}
export function saveSession(s: Session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(session: Session) {
  const headers = () => ({
    'content-type': 'application/json',
    ...(session.apiKey ? { 'x-api-key': session.apiKey } : {}),
    ...(session.operator ? { 'x-operator': session.operator } : {}),
  });

  async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const j = await res.json();
        message = j.message ?? j.error ?? message;
      } catch {
        /* ignore */
      }
      throw new ApiError(res.status, message);
    }
    return res.json() as Promise<T>;
  }

  return {
    health: () => call<{ ok: boolean }>('GET', '/api/health'),
    stats: () => call<Stats>('GET', '/api/stats'),
    alerts: (status: string) => call<Alert[]>('GET', `/api/alerts?status=${status}&limit=200`),
    alert: (id: string) => call<Alert & { dispatches: Dispatch[] }>('GET', `/api/alerts/${id}`),
    acknowledge: (id: string) => call<Alert>('POST', `/api/alerts/${id}/acknowledge`),
    dismiss: (id: string, reason?: string) => call<Alert>('POST', `/api/alerts/${id}/dismiss`, { reason }),
    dispatchAlert: (id: string, body: { responderId: string | null; priority: Priority; notes?: string; reason?: string }) =>
      call<Dispatch>('POST', `/api/alerts/${id}/dispatch`, body),
    createDispatch: (body: { siteId: string; responderId: string | null; priority: Priority; reason: string; notes?: string }) =>
      call<Dispatch>('POST', '/api/dispatches', body),
    dispatches: (status: string) => call<Dispatch[]>('GET', `/api/dispatches?status=${status}&limit=200`),
    dispatch: (id: string) => call<DispatchDetail>('GET', `/api/dispatches/${id}`),
    setDispatchStatus: (id: string, status: DispatchStatus, note?: string) =>
      call<Dispatch>('POST', `/api/dispatches/${id}/status`, { status, note }),
    redeliver: (id: string) => call<{ delivered: boolean }>('POST', `/api/dispatches/${id}/redeliver`),
    responders: () => call<Responder[]>('GET', '/api/responders'),
    sites: () => call<Site[]>('GET', '/api/sites'),
    eventsUrl: () => `/api/events${session.apiKey ? `?apiKey=${encodeURIComponent(session.apiKey)}` : ''}`,
  };
}
export type Api = ReturnType<typeof createApi>;
