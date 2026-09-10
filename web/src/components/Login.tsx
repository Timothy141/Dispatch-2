import { useState } from 'react';
import { publicApi, type Session } from '../api';
import type { Role } from '../types';

interface Props {
  onLogin: (s: Session) => void;
}

const ROLES: { role: Role; title: string; blurb: string; icon: string }[] = [
  { role: 'requester', title: 'I need help', blurb: 'Request security, medical or fire response to your location.', icon: '🆘' },
  { role: 'responder', title: "I'm a responder", blurb: 'Go online, receive nearby jobs, navigate and update progress.', icon: '🚨' },
  { role: 'dispatcher', title: 'Agent / control room', blurb: 'Log call-outs for callers, send them to a response officer, see every unit live.', icon: '🎧' },
];

export function Login({ onLogin }: Props) {
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const r = await publicApi.login({ role, name: name.trim(), phone: phone.trim(), dispatcherCode: code || undefined });
      onLogin({ token: r.token, user: r.user });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-hero">
        <div className="brand big">
          <span className="brand-dot" /> DISPATCH
        </div>
        <p>On-demand security, medical and fire response. The nearest available unit, tracked live to your location.</p>
      </div>
      {!role ? (
        <div className="role-grid">
          {ROLES.map((r) => (
            <button key={r.role} className="role-card" onClick={() => setRole(r.role)}>
              <span className="role-icon">{r.icon}</span>
              <b>{r.title}</b>
              <span className="hint">{r.blurb}</span>
            </button>
          ))}
        </div>
      ) : (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2>
            {ROLES.find((r) => r.role === role)!.icon} {ROLES.find((r) => r.role === role)!.title}
          </h2>
          <div className="field">
            <label htmlFor="l-name">Your name</label>
            <input id="l-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={role === 'responder' ? 'e.g. Sipho Dlamini' : 'e.g. Thandi Mokoena'} autoFocus required />
          </div>
          <div className="field">
            <label htmlFor="l-phone">Mobile number</label>
            <input id="l-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" required />
            <div className="hint">Responders will call this number if they need to reach you.</div>
          </div>
          {role === 'dispatcher' && (
            <div className="field">
              <label htmlFor="l-code">Dispatcher code</label>
              <input id="l-code" type="password" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="actions">
            <button type="submit" className="btn primary big" disabled={busy || !name.trim() || phone.trim().length < 6}>
              {busy ? 'Signing in…' : 'Continue'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setRole(null)}>
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
