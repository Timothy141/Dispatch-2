import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, createApi, loadSession, publicApi, saveSession, type Session } from './api';
import { Login } from './components/Login';
import { minutes } from './format';
import { DispatcherScreen } from './screens/DispatcherScreen';
import { RequesterScreen } from './screens/RequesterScreen';
import { ResponderScreen } from './screens/ResponderScreen';
import type { Catalogue, Stats } from './types';

interface Toast {
  id: number;
  msg: string;
  err: boolean;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [connection, setConnection] = useState('connecting');
  const [stats, setStats] = useState<Stats | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const api = useMemo(() => (session ? createApi(session.token) : null), [session]);

  const toast = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
    if (err && msg.match(/Sign in first|unauthorized/i)) logout();
  }, []);

  useEffect(() => {
    publicApi.catalogue().then(setCatalogue).catch((e) => toast(e.message, true));
  }, [toast]);

  // validate the stored token
  useEffect(() => {
    if (!api) return;
    api.me().catch((e) => {
      if (e instanceof ApiError && e.status === 401) logout();
    });
  }, [api]);

  const login = (s: Session) => {
    saveSession(s);
    setSession(s);
  };
  const logout = () => {
    saveSession(null);
    setSession(null);
    setStats(null);
  };

  if (!session || !api) return <Login onLogin={login} />;
  if (!catalogue) return <div className="empty">Loading…</div>;

  const role = session.user.role;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" /> DISPATCH
        </div>
        <span className="hint">{role === 'requester' ? 'Get help' : role === 'responder' ? 'Responder' : 'Control room'}</span>
        {role === 'dispatcher' && stats && (
          <div className="stats">
            <div className="stat">
              <b>{stats.searching + stats.unfulfilled}</b>
              <span>waiting</span>
            </div>
            <div className="stat">
              <b>{stats.active}</b>
              <span>active</span>
            </div>
            <div className="stat">
              <b>
                {stats.respondersAvailable}/{stats.respondersAvailable + stats.respondersBusy}
              </b>
              <span>units free</span>
            </div>
            <div className="stat">
              <b>{minutes(stats.avgAssignSeconds)}</b>
              <span>avg accept</span>
            </div>
            <div className="stat">
              <b>{minutes(stats.avgArrivalSeconds)}</b>
              <span>avg arrival</span>
            </div>
          </div>
        )}
        <span className="spacer" />
        <div className="conn" title="Live connection">
          <span className={`conn-dot ${connection}`} /> {connection}
        </div>
        <button className="btn small ghost" onClick={logout} title="Sign out">
          {session.user.name} ⏏
        </button>
      </header>
      {role === 'requester' && <RequesterScreen api={api} user={session.user} catalogue={catalogue} toast={toast} onConnection={setConnection} />}
      {role === 'responder' && <ResponderScreen api={api} user={session.user} catalogue={catalogue} toast={toast} onConnection={setConnection} />}
      {role === 'dispatcher' && <DispatcherScreen api={api} toast={toast} onConnection={setConnection} onStats={setStats} />}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
