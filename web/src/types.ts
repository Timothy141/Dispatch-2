export type Role = 'requester' | 'responder' | 'dispatcher';
export type Service = 'security' | 'medical' | 'fire';
export type Priority = 'standard' | 'urgent' | 'critical';
export type RequestStatus = 'searching' | 'assigned' | 'en_route' | 'arrived' | 'completed' | 'cancelled' | 'unfulfilled';
export type ResponderStatus = 'offline' | 'available' | 'busy';
export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export interface User {
  id: string;
  role: Role;
  name: string;
  phone: string;
}

export interface Responder {
  userId: string;
  name: string;
  phone: string;
  service: Service;
  unitName: string;
  organisation: string | null;
  vehicle: string | null;
  status: ResponderStatus;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  locationAt: string | null;
  rating: number | null;
  ratingCount: number;
  jobsCompleted: number;
}

export interface HelpRequest {
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
}

export interface RequestEvent {
  id: string;
  type: string;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface TrackView {
  request: HelpRequest;
  responder: null | {
    userId: string;
    name: string;
    phone: string;
    unitName: string;
    organisation: string | null;
    vehicle: string | null;
    service: Service;
    rating: number | null;
    lat: number | null;
    lng: number | null;
    heading: number | null;
    locationAt: string | null;
  };
  distanceM: number | null;
  etaSeconds: number | null;
  offersOutstanding: number;
  offersDeclined: number;
  events: RequestEvent[];
  trail: { lat: number; lng: number; at: string }[];
}

export interface DetailView {
  request: HelpRequest;
  responder: Responder | null;
  events: RequestEvent[];
  offers?: (Offer & { responder?: Responder })[];
  trail: { lat: number; lng: number; at: string }[];
}

export interface Catalogue {
  services: Service[];
  flags: Record<Service, { key: string; label: string; priority?: Priority }[]>;
  matching: { offerTimeoutSeconds: number; searchTimeoutSeconds: number; maxRadiusKm: number };
}

export interface Stats {
  searching: number;
  active: number;
  unfulfilled: number;
  requests24h: number;
  respondersAvailable: number;
  respondersBusy: number;
  avgAssignSeconds: number | null;
  avgArrivalSeconds: number | null;
}

export interface LatLng {
  lat: number;
  lng: number;
}
