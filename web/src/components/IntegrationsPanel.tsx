import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../api';
import { ago, clock } from '../format';
import type { ApiKey, Webhook, WebhookDelivery } from '../types';
import { useNow } from '../hooks/useNow';

interface Props {
  api: Api;
  toast: (m: string, err?: boolean) => void;
}

const SCOPES = ['requests:write', 'requests:read', 'responders:read'];
const EVENTS = ['*', 'request.*', 'request.created', 'request.updated', 'offer.*', 'responder.updated', 'responder.location'];

export function IntegrationsPanel({ api, toast }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [revealed, setRevealed] = useState<{ kind: 'key' | 'secret'; value: string; name: string } | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['requests:write', 'requests:read']);
  const [hookName, setHookName] = useState('');
  const [hookUrl, setHookUrl] = useState('');
  const [hookEvents, setHookEvents] = useState<string[]>(['request.*']);
  const [deliveries, setDeliveries] = useState<{ id: string; rows: WebhookDelivery[] } | null>(null);
  const now = useNow(5000);

  const refresh = useCallback(async () => {
    try {
      const [k, h] = await Promise.all([api.apiKeys(), api.webhooks()]);
      setKeys(k);
      setHooks(h);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, toast]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const base = window.location.origin;

  return (
    <div className="integrations">
      <div className="card">
        <h2>Connect other systems</h2>
        <p className="hint">
          Other cloud apps (alarm platforms, CCTV analytics, call-centre CRMs, Zapier / Make, SMS gateways) can create call-outs and receive live updates. Full reference:{' '}
          <a href="/api/docs" target="_blank" rel="noreferrer">
            API docs
          </a>{' '}
          ·{' '}
          <a href="/api/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
        </p>
        <pre className="code">{`POST ${base}/api/v1/callouts
x-api-key: <your key>
{ "service": "security", "contactName": "Mrs Naidoo", "contactPhone": "+27821234567",
  "lat": -33.9249, "lng": 18.4241, "address": "12 Long St", "flags": ["in_progress"],
  "responderId": null }`}</pre>
      </div>

      {revealed && (
        <div className="card reveal">
          <b>Copy this {revealed.kind === 'key' ? 'API key' : 'webhook secret'} for “{revealed.name}” now. It will not be shown again.</b>
          <code className="mono secret">{revealed.value}</code>
          <div className="actions">
            <button className="btn small" onClick={() => navigator.clipboard?.writeText(revealed.value).then(() => toast('Copied'))}>
              Copy
            </button>
            <button className="btn small ghost" onClick={() => setRevealed(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>API keys (incoming)</h3>
        <div className="form-row">
          <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Name, e.g. Alarm panel bridge" />
          <div className="chips">
            {SCOPES.map((s) => (
              <button key={s} className={`chip ${keyScopes.includes(s) ? 'on' : ''}`} onClick={() => setKeyScopes((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]))}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn primary"
          disabled={!keyName.trim() || keyScopes.length === 0}
          onClick={() =>
            run(async () => {
              const k = await api.createApiKey(keyName.trim(), keyScopes);
              setRevealed({ kind: 'key', value: k.key!, name: k.name });
              setKeyName('');
            })
          }
        >
          Create key
        </button>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Scopes</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? 'dim' : ''}>
                <td>{k.name}</td>
                <td className="mono">{k.prefix}…</td>
                <td>{k.scopes.join(', ')}</td>
                <td>{k.revokedAt ? 'revoked' : k.lastUsedAt ? `${ago(k.lastUsedAt, now)} ago` : 'never'}</td>
                <td>{!k.revokedAt && <button className="btn small danger" onClick={() => confirm(`Revoke “${k.name}”?`) && run(() => api.revokeApiKey(k.id), 'Key revoked')}>Revoke</button>}</td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="hint">
                  No keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Webhooks (outgoing)</h3>
        <p className="hint">We POST every subscribed event to your HTTPS URL, signed with HMAC-SHA256 in the x-dispatch-signature header, and retry on failure.</p>
        <div className="form-row">
          <input value={hookName} onChange={(e) => setHookName(e.target.value)} placeholder="Name, e.g. Control-room CRM" />
          <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} placeholder="https://your-system.example/hooks/dispatch" />
        </div>
        <div className="chips">
          {EVENTS.map((ev) => (
            <button key={ev} className={`chip ${hookEvents.includes(ev) ? 'on' : ''}`} onClick={() => setHookEvents((c) => (c.includes(ev) ? c.filter((x) => x !== ev) : [...c, ev]))}>
              {ev}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          disabled={!hookName.trim() || !hookUrl.trim() || hookEvents.length === 0}
          onClick={() =>
            run(async () => {
              const h = await api.createWebhook({ name: hookName.trim(), url: hookUrl.trim(), events: hookEvents });
              setRevealed({ kind: 'secret', value: h.secret!, name: h.name });
              setHookName('');
              setHookUrl('');
            })
          }
        >
          Add webhook
        </button>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Events</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h.id} className={h.active ? '' : 'dim'}>
                <td>{h.name}</td>
                <td className="mono small">{h.url}</td>
                <td>{h.events.join(', ')}</td>
                <td className="row">
                  <button className="btn small" onClick={() => run(async () => { const r = await api.testWebhook(h.id); toast(r.delivered ? 'Test delivered' : 'Test failed – check deliveries', !r.delivered); })}>
                    Test
                  </button>
                  <button className="btn small ghost" onClick={() => run(async () => setDeliveries({ id: h.id, rows: await api.webhookDeliveries(h.id) }))}>
                    Deliveries
                  </button>
                  <button className="btn small ghost" onClick={() => run(() => api.updateWebhook(h.id, { active: !h.active }))}>
                    {h.active ? 'Pause' : 'Resume'}
                  </button>
                  <button className="btn small danger" onClick={() => confirm(`Delete “${h.name}”?`) && run(() => api.deleteWebhook(h.id), 'Webhook deleted')}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {hooks.length === 0 && (
              <tr>
                <td colSpan={4} className="hint">
                  No webhooks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {deliveries && (
          <div>
            <h3>Recent deliveries</h3>
            <ul className="timeline">
              {deliveries.rows.length === 0 && <li className="hint">None yet.</li>}
              {deliveries.rows.map((d) => (
                <li key={d.id}>
                  <span className="t">{clock(d.createdAt)}</span>
                  <span>
                    {d.success ? '✅' : '❌'} {d.eventType} · attempt {d.attempt} {d.statusCode ? `· HTTP ${d.statusCode}` : ''} {d.error && <span className="note">{d.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
