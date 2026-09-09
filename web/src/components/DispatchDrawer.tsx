import { useEffect, useState } from 'react';
import type { Api } from '../api';
import { clock } from '../format';
import type { DispatchDetail, DispatchStatus } from '../types';
import { Badge } from './Badge';
import { Stepper } from './DispatchBoard';

interface Props {
  api: Api;
  id: string;
  version: number; // bump to refetch
  onClose: () => void;
  toast: (msg: string, err?: boolean) => void;
}

const LABEL: Record<DispatchStatus, string> = {
  requested: 'Requested',
  acknowledged: 'Responder acknowledged',
  en_route: 'En route',
  on_scene: 'On scene',
  resolved: 'Resolve',
  cancelled: 'Cancel',
};

export function DispatchDrawer({ api, id, version, onClose, toast }: Props) {
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.dispatch(id).then((d) => live && setDetail(d)).catch((e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [api, id, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const move = async (status: DispatchStatus) => {
    setBusy(true);
    setError(null);
    try {
      await api.setDispatchStatus(id, status, note.trim() || undefined);
      setNote('');
      toast(`${detail?.dispatch.reference} → ${status.replace('_', ' ')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const redeliver = async () => {
    setBusy(true);
    try {
      const r = await api.redeliver(id);
      toast(r.delivered ? 'Responder notified' : 'Delivery failed again', !r.delivered);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer" onClick={onClose} role="dialog" aria-modal="true">
      <div className="drawer-body" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{detail?.dispatch.reference ?? '…'}</h2>
          {detail && <Badge value={detail.dispatch.priority} />}
          {detail && <Badge value={detail.dispatch.status} kind="status" />}
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {detail && (
          <>
            <Stepper status={detail.dispatch.status} />
            <dl className="kv">
              <dt>Site</dt>
              <dd>
                {detail.site?.name ?? '—'}
                {detail.site?.address ? ` · ${detail.site.address}` : ''}
              </dd>
              <dt>Responder</dt>
              <dd>
                {detail.responder?.name ?? '—'} ({detail.responder?.channel})
                {detail.responder?.phone ? ` · ☎ ${detail.responder.phone}` : ''}
              </dd>
              <dt>Reason</dt>
              <dd>{detail.dispatch.reason}</dd>
              {detail.dispatch.notes && (
                <>
                  <dt>Notes</dt>
                  <dd>{detail.dispatch.notes}</dd>
                </>
              )}
              <dt>Requested by</dt>
              <dd>
                {detail.dispatch.requestedBy} at {clock(detail.dispatch.createdAt)}
              </dd>
              {detail.alert && (
                <>
                  <dt>Alert</dt>
                  <dd>
                    {detail.alert.title}
                    {detail.alert.snapshotUrl && (
                      <>
                        {' '}
                        <a href={detail.alert.snapshotUrl} target="_blank" rel="noreferrer">
                          snapshot
                        </a>
                      </>
                    )}
                  </dd>
                </>
              )}
            </dl>

            {detail.nextStatuses.length > 0 && (
              <div className="dispatch-panel">
                <h3>Update status</h3>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. ETA 6 min" />
                <div className="status-actions">
                  {detail.nextStatuses.map((s) => (
                    <button key={s} className={`btn small ${s === 'cancelled' ? 'danger' : s === 'resolved' ? 'primary' : ''}`} disabled={busy} onClick={() => move(s)}>
                      {LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="hint" style={{ margin: '0 0 6px' }}>
                TIMELINE
              </h3>
              <ul className="timeline">
                {detail.events.map((e) => (
                  <li key={e.id}>
                    <span className="t">{clock(e.createdAt)}</span>
                    <span>
                      <Badge value={e.toStatus} kind="status" /> by {e.actor}
                      {e.note && <div className="note">{e.note}</div>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="hint" style={{ margin: '0 0 6px' }}>
                RESPONDER NOTIFICATION
              </h3>
              {detail.deliveries.length === 0 && <div className="hint">Delivery pending…</div>}
              <ul className="timeline">
                {detail.deliveries.map((d) => (
                  <li key={d.id}>
                    <span className="t">{clock(d.createdAt)}</span>
                    <span>
                      {d.success ? '✅' : '❌'} {d.channel} attempt {d.attempt}
                      {d.detail && <div className="note">{d.detail}</div>}
                    </span>
                  </li>
                ))}
              </ul>
              {detail.deliveries.length > 0 && !detail.deliveries.some((d) => d.success) && (
                <button className="btn small" style={{ marginTop: 8 }} disabled={busy} onClick={redeliver}>
                  Retry notification
                </button>
              )}
              <div className="hint" style={{ marginTop: 8 }}>
                Responder callback URL (share with the responder if their system cannot receive webhooks):
                <br />
                <code>{detail.callbackUrl}</code>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
