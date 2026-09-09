import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, createApi, loadSession, saveSession, type Session } from './api';
import { AlertDetail } from './components/AlertDetail';
import { AlertQueue, type QueueTab } from './components/AlertQueue';
import { DispatchBoard, type BoardTab } from './components/DispatchBoard';
import { DispatchDrawer } from './components/DispatchDrawer';
import { ManualDispatchModal } from './components/ManualDispatchModal';
import { SettingsModal } from './components/SettingsModal';
import { useEvents } from './hooks/useEvents';
import type { Alert, Dispatch, Responder, Site, Stats } from './types';

const QUEUE_STATUS: Record<QueueTab, string> = { open: 'new,acknowledged', dispatched: 'dispatched', dismissed: 'dismissed' };
const BOARD_STATUS: Record<BoardTab, string> = { active: 'requested,acknowledged,en_route,on_scene', closed: 'resolved,cancelled' };

interface Toast {
  id: number;
  msg: string;
  err: boolean;
}

export default function App() {
  const [session, setSession] = useState<Session>(loadSession);
  const [needsLogin, setNeedsLogin] = useState(!session.operator);
  const [authError, setAuthError] = useState<string | null>(null);
  const api = useMemo(() => createApi(session), [session]);

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [queueTab, setQueueTab] = useState<QueueTab>('open');
  const [boardTab, setBoardTab] = useState<BoardTab>('active');
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [openDispatchId, setOpenDispatchId] = useState<string | null>(null);
  const [drawerVersion, setDrawerVersion] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        setAuthError('Invalid API key');
        setNeedsLogin(true);
      } else {
        toast(e instanceof Error ? e.message : String(e), true);
      }
    },
    [toast],
  );

  const refreshAlerts = useCallback(() => api.alerts(QUEUE_STATUS[queueTab]).then(setAlerts).catch(handleError), [api, queueTab, handleError]);
  const refreshDispatches = useCallback(
    () => api.dispatches(BOARD_STATUS[boardTab]).then(setDispatches).catch(handleError),
    [api, boardTab, handleError],
  );
  const refreshStats = useCallback(() => api.stats().then(setStats).catch(() => undefined), [api]);
  const refreshRefData = useCallback(
    () => Promise.all([api.responders().then(setResponders), api.sites().then(setSites)]).catch(handleError),
    [api, handleError],
  );

  useEffect(() => {
    if (needsLogin) return;
    refreshAlerts();
    refreshDispatches();
    refreshStats();
    refreshRefData();
    const t = setInterval(refreshStats, 30000);
    return () => clearInterval(t);
  }, [needsLogin, refreshAlerts, refreshDispatches, refreshStats, refreshRefData]);

  // Live updates: patch local state, then reconcile with the server.
  const onEvent = useCallback(
    (type: string, data: unknown) => {
      if (type.startsWith('alert.')) {
        const a = data as Alert;
        if (type === 'alert.created' && a.status === 'new' && queueTab === 'open') {
          setAlerts((prev) => (prev.some((x) => x.id === a.id) ? prev : [a, ...prev]));
          if (a.severity === 'critical') toast(`CRITICAL: ${a.title} at ${a.siteName ?? 'unknown site'}`, true);
        } else {
          refreshAlerts();
        }
        if (!a.siteId || !sites.some((s) => s.id === a.siteId)) refreshRefData();
      } else if (type.startsWith('dispatch.')) {
        refreshDispatches();
        if (openDispatchId && ((data as Dispatch).id === openDispatchId || (data as { dispatchId?: string }).dispatchId === openDispatchId)) {
          setDrawerVersion((v) => v + 1);
        }
      }
      refreshStats();
    },
    [queueTab, sites, openDispatchId, refreshAlerts, refreshDispatches, refreshStats, refreshRefData, toast],
  );
  const connection = useEvents(needsLogin ? '' : api.eventsUrl(), onEvent);

  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) ?? null;
  useEffect(() => {
    // Keep the selection valid after tab switches / list refreshes.
    if (selectedAlertId && !alerts.some((a) => a.id === selectedAlertId)) setSelectedAlertId(null);
  }, [alerts, selectedAlertId]);

  const saveLogin = (s: Session) => {
    saveSession(s);
    setSession(s);
    setAuthError(null);
    setNeedsLogin(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" /> DISPATCH
        </div>
        {stats && (
          <div className="stats">
            <div className="stat">
              <b>{stats.newAlerts}</b>
              <span>new alerts</span>
            </div>
            <div className="stat">
              <b>{stats.activeDispatches}</b>
              <span>active dispatches</span>
            </div>
            <div className="stat">
              <b>{stats.alerts24h}</b>
              <span>alerts 24h</span>
            </div>
            <div className="stat">
              <b>{stats.dispatches24h}</b>
              <span>dispatches 24h</span>
            </div>
          </div>
        )}
        <span className="spacer" />
        <div className="conn" title="Live event stream">
          <span className={`conn-dot ${connection}`} /> {connection}
        </div>
        <button className="btn small ghost" onClick={() => setNeedsLogin(true)}>
          {session.operator || 'Sign in'}
        </button>
      </header>

      <main className="layout">
        <AlertQueue alerts={alerts} selectedId={selectedAlertId} onSelect={setSelectedAlertId} tab={queueTab} onTab={setQueueTab} />
        <AlertDetail
          api={api}
          alert={selectedAlert}
          responders={responders}
          sites={sites}
          onChanged={refreshAlerts}
          onDispatched={(d) => {
            refreshAlerts();
            refreshDispatches();
            setOpenDispatchId(d.id);
          }}
          onOpenDispatch={setOpenDispatchId}
          toast={toast}
        />
        <DispatchBoard
          dispatches={dispatches}
          selectedId={openDispatchId}
          onSelect={setOpenDispatchId}
          tab={boardTab}
          onTab={setBoardTab}
          onManual={() => setManualOpen(true)}
        />
      </main>

      {openDispatchId && (
        <DispatchDrawer api={api} id={openDispatchId} version={drawerVersion} onClose={() => setOpenDispatchId(null)} toast={toast} />
      )}
      {manualOpen && (
        <ManualDispatchModal
          api={api}
          sites={sites}
          responders={responders}
          onClose={() => setManualOpen(false)}
          onCreated={(d) => {
            setManualOpen(false);
            toast(`Dispatched ${d.reference} → ${d.responderName}`);
            refreshDispatches();
            setOpenDispatchId(d.id);
          }}
        />
      )}
      {needsLogin && (
        <SettingsModal session={session} error={authError} onSave={saveLogin} onClose={session.operator ? () => setNeedsLogin(false) : undefined} />
      )}

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
