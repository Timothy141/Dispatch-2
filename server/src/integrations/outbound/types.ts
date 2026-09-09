import type { Alert, Dispatch, Responder, Site } from '../../domain/types.js';

export interface DispatchNotification {
  dispatch: Dispatch;
  alert: Alert | null;
  site: Site | null;
  responder: Responder;
  /** Link the responder can POST status updates to (no operator login needed). */
  callbackUrl: string;
}

export interface DeliveryResult {
  success: boolean;
  detail: string;
}

export interface OutboundChannel {
  readonly name: string;
  send(notification: DispatchNotification): Promise<DeliveryResult>;
}
