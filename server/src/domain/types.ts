export const ROLES = ['requester', 'responder', 'dispatcher'] as const;
export type Role = (typeof ROLES)[number];

export const SERVICES = ['security', 'medical', 'fire'] as const;
export type Service = (typeof SERVICES)[number];

export const PRIORITIES = ['standard', 'urgent', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RESPONDER_STATUSES = ['offline', 'available', 'busy'] as const;
export type ResponderStatus = (typeof RESPONDER_STATUSES)[number];

export const REQUEST_STATUSES = [
  'searching',
  'assigned',
  'en_route',
  'arrived',
  'completed',
  'cancelled',
  'unfulfilled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Quick-tap situation flags per service; some escalate priority. */
export const SERVICE_FLAGS: Record<Service, { key: string; label: string; priority?: Priority }[]> = {
  security: [
    { key: 'in_progress', label: 'Happening right now', priority: 'urgent' },
    { key: 'armed', label: 'Suspects armed', priority: 'critical' },
    { key: 'injured', label: 'Someone injured', priority: 'critical' },
    { key: 'break_in', label: 'Break-in / intruder' },
    { key: 'hijacking', label: 'Hijacking / robbery', priority: 'critical' },
    { key: 'suspicious', label: 'Suspicious person or vehicle' },
  ],
  medical: [
    { key: 'unconscious', label: 'Unconscious', priority: 'critical' },
    { key: 'not_breathing', label: 'Not breathing / no pulse', priority: 'critical' },
    { key: 'bleeding', label: 'Severe bleeding', priority: 'critical' },
    { key: 'chest_pain', label: 'Chest pain / stroke signs', priority: 'critical' },
    { key: 'accident', label: 'Vehicle accident', priority: 'urgent' },
    { key: 'child', label: 'Child or infant', priority: 'urgent' },
  ],
  fire: [
    { key: 'people_trapped', label: 'People trapped', priority: 'critical' },
    { key: 'building', label: 'Building on fire', priority: 'critical' },
    { key: 'vehicle', label: 'Vehicle fire', priority: 'urgent' },
    { key: 'veld', label: 'Veld / grass fire' },
    { key: 'gas', label: 'Gas leak / chemicals', priority: 'critical' },
    { key: 'smoke_only', label: 'Smoke only, no flames' },
  ],
};

export function priorityFor(service: Service, flags: string[]): Priority {
  const defs = SERVICE_FLAGS[service];
  let p: Priority = service === 'security' ? 'standard' : 'urgent'; // medical & fire are urgent by default
  for (const f of flags) {
    const def = defs.find((d) => d.key === f);
    if (def?.priority === 'critical') return 'critical';
    if (def?.priority === 'urgent') p = 'urgent';
  }
  return p;
}

export interface User {
  id: string;
  role: Role;
  name: string;
  phone: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Responder {
  userId: string;
  name: string;
  phone: string;
  service: Service;
  unitName: string;
  organisation: string | null;
  vehicle: string | null;
  capabilities: string[];
  status: ResponderStatus;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  locationAt: string | null;
  rating: number | null;
  ratingCount: number;
  jobsCompleted: number;
  updatedAt: string;
}

export interface Request {
  id: string;
  reference: string;
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  service: Service;
  priority: Priority;
  lat: number;
  lng: number;
  address: string | null;
  description: string | null;
  flags: string[];
  status: RequestStatus;
  responderId: string | null;
  etaSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  rating: number | null;
  ratingComment: string | null;
  searchStartedAt: string;
}

export interface Offer {
  id: string;
  requestId: string;
  responderId: string;
  status: OfferStatus;
  distanceM: number;
  etaSeconds: number;
  offeredAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

export interface RequestEvent {
  id: string;
  requestId: string;
  type: string;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}
