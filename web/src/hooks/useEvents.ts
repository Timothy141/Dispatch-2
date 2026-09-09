import { useEffect, useRef, useState } from 'react';

export type ConnectionState = 'connecting' | 'live' | 'offline';

/** Subscribe to the server's SSE stream; invokes onEvent(type, data) for each domain event. */
export function useEvents(url: string, onEvent: (type: string, data: unknown) => void): ConnectionState {
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
      for (const type of ['alert.created', 'alert.updated', 'dispatch.created', 'dispatch.updated', 'dispatch.delivery']) {
        es.addEventListener(type, (e) => {
          try {
            const evt = JSON.parse((e as MessageEvent).data);
            handler.current(type, evt.data);
          } catch {
            /* ignore malformed */
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
