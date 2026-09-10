import { EventEmitter } from 'node:events';

export type DomainEventType =
  | 'request.created'
  | 'request.updated'
  | 'offer.created'
  | 'offer.updated'
  | 'responder.updated'
  | 'responder.location';

/**
 * Audience for an event. The SSE endpoint only forwards an event to a
 * connection whose user matches one of these (dispatchers get everything).
 */
export interface Audience {
  requesterId?: string | null;
  responderIds?: string[];
}

export interface DomainEvent<T = unknown> {
  type: DomainEventType;
  at: string;
  data: T;
  audience: Audience;
}

export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish<T>(type: DomainEventType, data: T, audience: Audience = {}): void {
    const evt: DomainEvent<T> = { type, at: new Date().toISOString(), data, audience };
    this.emitter.emit('event', evt);
  }
  subscribe(listener: (evt: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
