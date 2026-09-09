import { useState } from 'react';
import type { Api } from '../api';
import type { Dispatch, Priority, Responder, Site } from '../types';

interface Props {
  api: Api;
  sites: Site[];
  responders: Responder[];
  onClose: () => void;
  onCreated: (d: Dispatch) => void;
}

export function ManualDispatchModal({ api, sites, responders, onClose, onCreated }: Props) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const site = sites.find((s) => s.id === siteId);
  const [responderId, setResponderId] = useState(site?.defaultResponderId ?? responders[0]?.id ?? '');
  const [priority, setPriority] = useState<Priority>('high');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.createDispatch({ siteId, responderId: responderId || null, priority, reason: reason.trim() });
      onCreated(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <h2>Manual dispatch</h2>
        <p className="hint">For activity spotted on a live feed that did not produce an alert.</p>
        <div className="field">
          <label htmlFor="m-site">Site</label>
          <select
            id="m-site"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              const s = sites.find((x) => x.id === e.target.value);
              if (s?.defaultResponderId) setResponderId(s.defaultResponderId);
            }}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-resp">Responder</label>
          <select id="m-resp" value={responderId} onChange={(e) => setResponderId(e.target.value)}>
            {responders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-prio">Priority</label>
          <select id="m-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['low', 'medium', 'high', 'critical'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-reason">Reason</label>
          <textarea id="m-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did you see?" />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="btn-dispatch" disabled={busy || !siteId || !responderId || !reason.trim()} onClick={submit}>
            Dispatch
          </button>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
