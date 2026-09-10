import { buildContext, type AppContext } from '../src/app.js';
import type { Service, User } from '../src/domain/types.js';

export const CBD = { lat: -33.9249, lng: 18.4241 };
/** Offset a point by roughly `km` kilometres north. */
export const north = (p: { lat: number; lng: number }, km: number) => ({ lat: p.lat + km / 111, lng: p.lng });

export function makeContext(overrides: Record<string, string> = {}): AppContext {
  return buildContext({
    logger: false,
    env: {
      DATABASE_PATH: ':memory:',
      OFFER_TIMEOUT_SECONDS: '20',
      OFFER_FANOUT: '2',
      MAX_RADIUS_KM: '30',
      SEARCH_TIMEOUT_SECONDS: '300',
      LOCATION_STALE_SECONDS: '300',
      AVERAGE_SPEED_KMH: '45',
      DISPATCHER_CODE: 'ctrl',
      WEB_DIST: '/nonexistent',
      ...overrides,
    },
  }, { info() {}, warn() {}, error() {}, debug() {} } as unknown as Console);
}

export function requester(ctx: AppContext, name = 'Thandi', phone = '0821111111'): User {
  return ctx.auth.login({ role: 'requester', name, phone }).user;
}

export function responder(
  ctx: AppContext,
  unit: string,
  service: Service,
  at: { lat: number; lng: number } | null,
  phone = `08200${Math.floor(Math.random() * 100000)}`,
): User {
  const { user } = ctx.auth.login({ role: 'responder', name: `${unit} crew`, phone });
  ctx.repo.upsertResponderProfile({ userId: user.id, service, unitName: unit });
  ctx.dispatch.setResponderStatus(user, 'available');
  if (at) ctx.dispatch.updateResponderLocation(user, at.lat, at.lng, null);
  return user;
}

export function dispatcher(ctx: AppContext): User {
  return ctx.auth.login({ role: 'dispatcher', name: 'Ops', phone: '0219999999', dispatcherCode: 'ctrl' }).user;
}

export const secondsLater = (s: number) => new Date(Date.now() + s * 1000);
