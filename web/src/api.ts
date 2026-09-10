import type { ApiKey, Catalogue, DetailView, GeocodeHit, HelpRequest, LatLng, Offer, Responder, Role, Service, Stats, TrackView, User, Webhook, WebhookDelivery } from './types';

export interface Session {
  token: string;
  user: User;
}

const KEY = 'dispatch.session.v2';
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
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

async function call<T>(method: string, url: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export const publicApi = {
  requestOtp: (phone: string) => call<{ sent: boolean; phone: string; expiresAt: string; provider: string }>('POST', '/api/auth/otp/request', null, { phone }),
  login: (body: { role: Role; name: string; phone: string; dispatcherCode?: string; code?: string }) =>
    call<{ user: User; token: string; responder: Responder | null }>('POST', '/api/auth/login', null, body),
  catalogue: () => call<Catalogue>('GET', '/api/catalogue', null),
};

export function createApi(token: string) {
  const c = <T>(method: string, url: string, body?: unknown) => call<T>(method, url, token, body);
  return {
    me: () => c<{ user: User; responder: Responder | null }>('GET', '/api/auth/me'),
    // requester
    createRequest: (body: { service: Service; lat: number; lng: number; address?: string; description?: string; flags?: string[] }) =>
      c<HelpRequest>('POST', '/api/requests', body),
    myRequests: () => c<HelpRequest[]>('GET', '/api/requests/mine'),
    track: (id: string) => c<TrackView>('GET', `/api/requests/${id}/track`),
    detail: (id: string) => c<DetailView>('GET', `/api/requests/${id}`),
    cancel: (id: string, reason?: string) => c<HelpRequest>('POST', `/api/requests/${id}/cancel`, { reason }),
    rate: (id: string, rating: number, comment?: string) => c<HelpRequest>('POST', `/api/requests/${id}/rate`, { rating, comment }),
    // responder
    responderMe: () => c<{ responder: Responder | null; activeJob: HelpRequest | null; offers: { offer: Offer; request: HelpRequest }[] }>('GET', '/api/responders/me'),
    saveProfile: (body: { service: Service; unitName: string; vehicle?: string; organisation?: string }) => c<Responder>('PUT', '/api/responders/me', body),
    setStatus: (status: 'available' | 'offline') => c<Responder>('POST', '/api/responders/me/status', { status }),
    setLocation: (p: LatLng & { heading?: number | null }) => c<Responder>('POST', '/api/responders/me/location', p),
    accept: (offerId: string) => c<HelpRequest>('POST', `/api/offers/${offerId}/accept`),
    decline: (offerId: string) => c<{ ok: true }>('POST', `/api/offers/${offerId}/decline`),
    progress: (id: string, status: 'en_route' | 'arrived' | 'completed', note?: string) => c<HelpRequest>('POST', `/api/requests/${id}/progress`, { status, note }),
    release: (id: string, reason?: string) => c<HelpRequest>('POST', `/api/requests/${id}/release`, { reason }),
    // dispatcher
    requests: (status: string) => c<HelpRequest[]>('GET', `/api/requests?status=${status}&limit=200`),
    responders: () => c<Responder[]>('GET', '/api/responders'),
    assign: (id: string, responderId: string) => c<HelpRequest>('POST', `/api/requests/${id}/assign`, { responderId }),
    retry: (id: string) => c<HelpRequest>('POST', `/api/requests/${id}/retry`),
    stats: () => c<Stats>('GET', '/api/stats'),
    // agent tooling
    geocode: (q: string) => c<GeocodeHit[]>('GET', `/api/geocode?q=${encodeURIComponent(q)}`),
    createCallout: (body: { service: Service; contactName: string; contactPhone: string; lat: number; lng: number; address?: string; description?: string; flags?: string[]; responderId?: string | null }) =>
      c<HelpRequest>('POST', '/api/callouts', body),
    // integrations
    apiKeys: () => c<ApiKey[]>('GET', '/api/integrations/keys'),
    createApiKey: (name: string, scopes: string[]) => c<ApiKey>('POST', '/api/integrations/keys', { name, scopes }),
    revokeApiKey: (id: string) => c<{ ok: true }>('DELETE', `/api/integrations/keys/${id}`),
    webhooks: () => c<Webhook[]>('GET', '/api/integrations/webhooks'),
    createWebhook: (body: { name: string; url: string; events: string[] }) => c<Webhook>('POST', '/api/integrations/webhooks', body),
    updateWebhook: (id: string, body: Partial<{ active: boolean; events: string[]; url: string; name: string }>) => c<Webhook>('PATCH', `/api/integrations/webhooks/${id}`, body),
    deleteWebhook: (id: string) => c<{ ok: true }>('DELETE', `/api/integrations/webhooks/${id}`),
    webhookDeliveries: (id: string) => c<WebhookDelivery[]>('GET', `/api/integrations/webhooks/${id}/deliveries`),
    testWebhook: (id: string) => c<{ delivered: boolean }>('POST', `/api/integrations/webhooks/${id}/test`),
    pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => c<{ ok: true }>('POST', '/api/push/subscriptions', sub),
    pushUnsubscribe: (endpoint: string) => c<{ ok: true }>('DELETE', '/api/push/subscriptions', { endpoint }),
    backups: () => c<{ enabled: boolean; dir: string; backups: { file: string; bytes: number; at: string }[] }>('GET', '/api/admin/backups'),
    runBackup: () => c<{ file: string; bytes: number }>('POST', '/api/admin/backups'),
    eventsUrl: () => `/api/events?token=${encodeURIComponent(token)}`,
  };
}
export type Api = ReturnType<typeof createApi>;
