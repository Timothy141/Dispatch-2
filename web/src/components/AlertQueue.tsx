import { useNow } from '../hooks/useNow';
import { ago, pct } from '../format';
import type { Alert } from '../types';
import { Badge } from './Badge';

export type QueueTab = 'open' | 'dispatched' | 'dismissed';

interface Props {
  alerts: Alert[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  tab: QueueTab;
  onTab: (t: QueueTab) => void;
}

export function AlertQueue({ alerts, selectedId, onSelect, tab, onTab }: Props) {
  const now = useNow();
  return (
    <section className="col alerts" aria-label="Alert queue">
      <div className="col-head">
        Alerts <span className="count">{alerts.length}</span>
        <div className="tabs" role="tablist">
          {(['open', 'dispatched', 'dismissed'] as QueueTab[]).map((t) => (
            <button key={t} role="tab" className={`tab ${tab === t ? 'active' : ''}`} onClick={() => onTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {alerts.length === 0 && <div className="empty">No {tab} alerts. Waiting for DeepAlert…</div>}
      {alerts.map((a) => (
        <button
          key={a.id}
          className={`alert-card sev-${a.severity} ${a.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(a.id)}
        >
          <div className="thumb" style={a.snapshotUrl ? { backgroundImage: `url("${a.snapshotUrl}")` } : undefined}>
            {!a.snapshotUrl && 'no image'}
          </div>
          <div>
            <div className="title">
              <span>{a.title}</span>
              <Badge value={a.severity} />
            </div>
            <div className="sub">
              <span>
                {a.siteName ?? 'Unknown site'}
                {a.cameraName ? ` · ${a.cameraName}` : ''}
              </span>
              <span className="age">{ago(a.receivedAt, now)}</span>
            </div>
            <div className="sub">
              <span>
                {a.source} · {pct(a.confidence)}
              </span>
              {a.status !== 'new' && <Badge value={a.status} kind="status" />}
            </div>
          </div>
        </button>
      ))}
    </section>
  );
}
