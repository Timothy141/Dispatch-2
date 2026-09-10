import { label, PRIORITY_COLOR, SERVICE_META } from '../format';
import type { Priority, RequestEvent, RequestStatus, Service } from '../types';
import { clock } from '../format';

export function ServiceBadge({ service }: { service: Service }) {
  const m = SERVICE_META[service];
  return (
    <span className="badge" style={{ background: `${m.color}26`, color: m.color }}>
      {m.icon} {m.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className="badge" style={{ background: `${PRIORITY_COLOR[priority]}26`, color: PRIORITY_COLOR[priority] }}>
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: RequestStatus | string }) {
  return <span className={`badge status ${status}`}>{label(status)}</span>;
}

const STEPS: RequestStatus[] = ['searching', 'assigned', 'en_route', 'arrived', 'completed'];
export function Stepper({ status }: { status: RequestStatus }) {
  const idx = STEPS.indexOf(status);
  const dead = status === 'cancelled' || status === 'unfulfilled';
  return (
    <div className={`stepper ${dead ? 'dead' : ''}`}>
      {STEPS.slice(0, -1).map((s, i) => (
        <div key={s} className={`step ${status === 'completed' || i < idx ? 'done' : i === idx ? 'current' : ''}`} title={label(s)} />
      ))}
    </div>
  );
}

export function Timeline({ events, names }: { events: RequestEvent[]; names?: Record<string, string> }) {
  return (
    <ul className="timeline">
      {events.map((e) => (
        <li key={e.id}>
          <span className="t">{clock(e.createdAt)}</span>
          <span>
            <b>{label(e.type)}</b> · {names?.[e.actor] ?? (e.actor === 'system' ? 'system' : e.actor.slice(0, 8))}
            {e.note && <div className="note">{e.note}</div>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <div className="stars" role={onChange ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star ${n <= value ? 'on' : ''}`} onClick={() => onChange?.(n)} disabled={!onChange} aria-label={`${n} star`}>
          ★
        </button>
      ))}
    </div>
  );
}
