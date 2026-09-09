import { useState } from 'react';
import type { Session } from '../api';

interface Props {
  session: Session;
  error?: string | null;
  onSave: (s: Session) => void;
  onClose?: () => void;
}

export function SettingsModal({ session, error, onSave, onClose }: Props) {
  const [operator, setOperator] = useState(session.operator);
  const [apiKey, setApiKey] = useState(session.apiKey);
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-body">
        <h2>Operator sign-in</h2>
        <p className="hint">Your name is recorded against every acknowledgement and dispatch.</p>
        <div className="field">
          <label htmlFor="s-op">Operator name</label>
          <input id="s-op" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="e.g. T. Naidoo (Shift B)" autoFocus />
        </div>
        <div className="field">
          <label htmlFor="s-key">API key</label>
          <input id="s-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="OPERATOR_API_KEY from the server" />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="btn primary" disabled={!operator.trim()} onClick={() => onSave({ operator: operator.trim(), apiKey: apiKey.trim() })}>
            Continue
          </button>
          {onClose && (
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
