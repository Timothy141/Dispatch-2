export type AlertStatus = 'new' | 'acknowledged' | 'dispatched' | 'dismissed';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type DispatchStatus = 'requested' | 'acknowledged' | 'en_route' | 'on_scene' | 'resolved' | 'cancelled';

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
  fromStatus: DispatchStatus | null;
  toStatus: DispatchStatus;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface Delivery {
  id: string;
  channel: string;
  attempt: number;
  success: boolean;
  detail: string | null;
  createdAt: string;
}

export interface DispatchDetail {
  dispatch: Dispatch;
  alert: Alert | null;
  site: Site | null;
  responder: Responder | null;
  events: DispatchEvent[];
  deliveries: Delivery[];
  callbackUrl: string;
  nextStatuses: DispatchStatus[];
}

export interface Responder {
  id: string;
  name: string;
  type: string;
  channel: string;
  phone: string | null;
  active: boolean;
}

export interface Site {
  id: string;
  name: string;
  address: string | null;
  defaultResponderId: string | null;
  notes: string | null;
}

export interface Stats {
  newAlerts: number;
  acknowledgedAlerts: number;
  activeDispatches: number;
  dispatches24h: number;
  alerts24h: number;
}
