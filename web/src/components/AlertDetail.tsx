import { useEffect, useMemo, useState } from 'react';
import type { Api } from '../api';
import { clock, pct } from '../format';
import type { Alert, Dispatch, Priority, Responder, Site } from '../types';
import { Badge } from './Badge';

interface Props {
  api: Api;
  alert: Alert | null;
  responders: Responder[];
  sites: Site[];
  onChanged: () => void;
  onDispatched: (d: Dispatch) => void;
  onOpenDispatch: (id: string) => void;
  toast: (msg: string, err?: boolean) => void;
}

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

function defaultPriority(a: Alert): Priority {
  return a.severity === 'critical' ? 'critical' : a.severity === 'high' ? 'high' : a.severity === 'medium' ? 'high' : 'medium';
}

export function AlertDetail({ api, alert, responders, sites, onChanged, onDispatched, onOpenDispatch, toast }: Props) {
  const site = useMemo(() => sites.find((s) => s.id === alert?.siteId) ?? null, [sites, alert?.siteId]);
  const [responderId, setResponderId] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('high');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<'ack' | 'dismiss' | 'dispatch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  // Reset the form whenever a different alert is selected.
  useEffect(() => {
    if (!alert) return;
    setResponderId(site?.defaultResponderId ?? responders[0]?.id ?? '');
    setPriority(defaultPriority(alert));
    setNotes('');
    setError(null);
    setConfirmDismiss(false);
  }, [alert?.id, site?.defaultResponderId, responders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alert) {
    return (
      <section className="col main">
        <div className="empty">
          <p>Select an alert to review the snapshot and dispatch a responder.</p>
          <p className="hint">Alerts arrive live from DeepAlert via the webhook. Use the simulator to generate test traffic.</p>
        </div>
      </section>
    );
  }

  const run = async (kind: typeof busy, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const canDispatch = alert.status === 'new' || alert.status === 'acknowledged';
  const responder = responders.find((r) => r.id === responderId);

  const dispatch = () =>
    run('dispatch', async () => {
      const d = await api.dispatchAlert(alert.id, { responderId: responderId || null, priority, notes: notes.trim() || undefined });
      toast(`Dispatched ${d.reference} → ${d.responderName}`);
      onDispatched(d);
    });

  return (
    <section className="col main" aria-label="Alert detail">
      <div className="detail">
        <h2>
          {alert.title} <Badge value={alert.severity} /> <Badge value={alert.status} kind="status" />
        </h2>

        <div className="snapshot">
          {alert.snapshotUrl ? <img src={alert.snapshotUrl} alt={`Snapshot from ${alert.cameraName ?? 'camera'}`} /> : 'No snapshot supplied'}
          <div className="overlay">
            <Badge value={alert.source} />
          </div>
          {alert.clipUrl && (
            <a className="clip" href={alert.clipUrl} target="_blank" rel="noreferrer">
              ▶ Open clip
            </a>
          )}
        </div>

        <div className="meta">
          <div>
            <label>Site</label>
            <b>{alert.siteName ?? '—'}</b>
            {site?.address && <div className="hint">{site.address}</div>}
          </div>
          <div>
            <label>Camera</label>
            <b>{alert.cameraName ?? '—'}</b>
          </div>
          <div>
            <label>Detection</label>
            <b>
              {alert.eventType.replace(/_/g, ' ')} · {pct(alert.confidence)}
            </b>
          </div>
          <div>
            <label>Occurred</label>
            <b>{clock(alert.occurredAt)}</b>
            <div className="hint">received {clock(alert.receivedAt)}</div>
          </div>
          {alert.handledBy && (
            <div>
              <label>Handled by</label>
              <b>{alert.handledBy}</b>
              {alert.handledAt && <div className="hint">{clock(alert.handledAt)}</div>}
            </div>
          )}
          {site?.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Site notes</label>
              <b>{site.notes}</b>
            </div>
          )}
          {alert.description && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Description</label>
              <b>{alert.description}</b>
            </div>
          )}
        </div>

        {alert.status === 'dispatched' && alert.dispatchId && (
          <div className="success">
            A responder has been dispatched for this alert.{' '}
            <button className="btn small" onClick={() => onOpenDispatch(alert.dispatchId!)}>
              View dispatch
            </button>
          </div>
        )}

        {canDispatch && (
          <div className="dispatch-panel">
            <h3>Dispatch responder</h3>
            <div className="form-row">
              <div className="field">
                <label htmlFor="responder">Responder</label>
                <select id="responder" value={responderId} onChange={(e) => setResponderId(e.target.value)}>
                  {responders.length === 0 && <option value="">No responders configured</option>}
                  {responders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.id === site?.defaultResponderId ? ' (site default)' : ''} · {r.channel}
                    </option>
                  ))}
                </select>
                {responder?.phone && <div className="hint">☎ {responder.phone}</div>}
              </div>
              <div className="field">
                <label>Priority</label>
                <div className="priority-group" role="radiogroup">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      role="radio"
                      aria-checked={priority === p}
                      className={`priority-btn ${p} ${priority === p ? 'active' : ''}`}
                      onClick={() => setPriority(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">Notes for responder (what you see)</label>
              <textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Two males at west fence with bolt cutters, moving toward loading bay"
              />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button
                className={`btn-dispatch ${busy === 'dispatch' ? 'busy' : ''}`}
                disabled={busy !== null || !responderId}
                onClick={dispatch}
              >
                {busy === 'dispatch' ? 'Dispatching…' : 'Dispatch'}
              </button>
              {alert.status === 'new' && (
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => run('ack', () => api.acknowledge(alert.id).then(onChanged))}
                >
                  Acknowledge
                </button>
              )}
              {!confirmDismiss ? (
                <button className="btn ghost" disabled={busy !== null} onClick={() => setConfirmDismiss(true)}>
                  Dismiss
                </button>
              ) : (
                <button
                  className="btn danger"
                  disabled={busy !== null}
                  onClick={() => run('dismiss', () => api.dismiss(alert.id, 'operator reviewed').then(onChanged))}
                >
                  Confirm dismiss
                </button>
              )}
            </div>
            <div className="hint">
              Dispatch notifies the responder immediately over their configured channel and records who pressed the button.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
