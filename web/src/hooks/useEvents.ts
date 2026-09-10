import { useEffect, useRef, useState } from 'react';

export type ConnectionState = 'connecting' | 'live' | 'offline';
const TYPES = ['request.created', 'request.updated', 'offer.created', 'offer.updated', 'responder.updated', 'responder.location'];

export function useEvents(url: string | null, onEvent: (type: string, data: unknown) => void): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!url) {
      setState('offline');
      return;
    }
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const connect = () => {
      setState('connecting');
      es = new EventSource(url);
      es.addEventListener('hello', () => setState('live'));
      for (const type of TYPES) {
        es.addEventListener(type, (e) => {
          try {
            handler.current(type, JSON.parse((e as MessageEvent).data).data);
          } catch {
            /* ignore */
          }
        });
      }
      es.onerror = () => {
        setState('offline');
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [url]);
  return state;
}
