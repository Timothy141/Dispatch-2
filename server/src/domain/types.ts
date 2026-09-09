export const ALERT_STATUSES = ['new', 'acknowledged', 'dispatched', 'dismissed'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DISPATCH_STATUSES = [
  'requested',
  'acknowledged',
  'en_route',
  'on_scene',
  'resolved',
  'cancelled',
] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const RESPONDER_TYPES = [
  'armed_response',
  'guard',
  'police',
  'medical',
  'fire',
  'maintenance',
  'other',
] as const;
export type ResponderType = (typeof RESPONDER_TYPES)[number];

export const CHANNELS = ['webhook', 'log'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface Site {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  externalRef: string | null;
  defaultResponderId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Camera {
  id: string;
  siteId: string;
  name: string;
  externalRef: string | null;
  createdAt: string;
}

export interface Responder {
  id: string;
  name: string;
  type: ResponderType;
  channel: Channel;
  channelConfig: Record<string, unknown>;
  phone: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  source: string;
  externalId: string | null;
  siteId: string | null;
  siteName: string | null;
  cameraId: string | null;
  cameraName: string | null;
  eventType: string;
  confidence: number | null;
  severity: Severity;
  title: string;
  description: string | null;
  snapshotUrl: string | null;
  clipUrl: string | null;
  occurredAt: string;
  receivedAt: string;
  status: AlertStatus;
  handledBy: string | null;
  handledAt: string | null;
  dispatchId: string | null;
}

export interface Dispatch {
  id: string;
  reference: string;
  alertId: string | null;
  siteId: string | null;
  siteName: string | null;
  responderId: string;
  responderName: string;
  priority: Priority;
  reason: string;
  notes: string | null;
  requestedBy: string;
  status: DispatchStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface DispatchEvent {
  id: string;
  dispatchId: string;
  fromStatus: DispatchStatus | null;
  toStatus: DispatchStatus;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface DispatchDelivery {
  id: string;
  dispatchId: string;
  channel: string;
  attempt: number;
  success: boolean;
  detail: string | null;
  createdAt: string;
}

/** A source-agnostic alert produced by an inbound adapter. */
export interface NormalizedAlert {
  source: string;
  externalId: string | null;
  site: { externalRef: string | null; name: string | null };
  camera: { externalRef: string | null; name: string | null };
  eventType: string;
  confidence: number | null;
  severity: Severity;
  title: string;
  description: string | null;
  snapshotUrl: string | null;
  clipUrl: string | null;
  occurredAt: string;
  raw: unknown;
}
