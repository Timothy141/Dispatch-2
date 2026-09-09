import { EventEmitter } from 'node:events';

export type DomainEventType =
  | 'alert.created'
  | 'alert.updated'
  | 'dispatch.created'
  | 'dispatch.updated'
  | 'dispatch.delivery';

export interface DomainEvent<T = unknown> {
  type: DomainEventType;
  at: string;
  data: T;
}

export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish<T>(type: DomainEventType, data: T): void {
    const evt: DomainEvent<T> = { type, at: new Date().toISOString(), data };
    this.emitter.emit('event', evt);
  }
  subscribe(listener: (evt: DomainEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
