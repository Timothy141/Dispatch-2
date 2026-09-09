import { useNow } from '../hooks/useNow';
import { ago } from '../format';
import type { Dispatch, DispatchStatus } from '../types';
import { Badge } from './Badge';

const STEPS: DispatchStatus[] = ['requested', 'acknowledged', 'en_route', 'on_scene', 'resolved'];

export type BoardTab = 'active' | 'closed';

interface Props {
  dispatches: Dispatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: BoardTab;
  onTab: (t: BoardTab) => void;
  onManual: () => void;
}

export function Stepper({ status }: { status: DispatchStatus }) {
  const idx = status === 'cancelled' ? -1 : STEPS.indexOf(status);
  return (
    <div className={`stepper ${status === 'cancelled' ? 'cancelled' : ''}`} aria-label={`status ${status}`}>
      {STEPS.slice(0, -1).map((s, i) => (
        <div key={s} className={`step ${status === 'resolved' || i < idx ? 'done' : i === idx ? 'current' : ''}`} />
      ))}
    </div>
  );
}

export function DispatchBoard({ dispatches, selectedId, onSelect, tab, onTab, onManual }: Props) {
  const now = useNow();
  return (
    <section className="col dispatches" aria-label="Dispatch board">
      <div className="col-head">
        Dispatches <span className="count">{dispatches.length}</span>
        <div className="tabs">
          {(['active', 'closed'] as BoardTab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => onTab(t)}>
              {t}
            </button>
          ))}
          <button className="tab" onClick={onManual} title="Dispatch without an alert">
            + manual
          </button>
        </div>
      </div>
      {dispatches.length === 0 && <div className="empty">No {tab} dispatches.</div>}
      {dispatches.map((d) => (
        <button key={d.id} className={`dispatch-card ${d.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(d.id)}>
          <div className="row">
            <span className="ref">{d.reference}</span>
            <Badge value={d.priority} />
            <Badge value={d.status} kind="status" />
          </div>
          <div className="sub">
            {d.siteName ?? 'Unknown site'} → {d.responderName}
          </div>
          <div className="sub">
            {d.reason} · {ago(d.createdAt, now)} ago · by {d.requestedBy}
          </div>
          <Stepper status={d.status} />
        </button>
      ))}
    </section>
  );
}
