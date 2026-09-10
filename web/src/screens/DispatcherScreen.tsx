import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api } from '../api';
import { CalloutModal } from '../components/CalloutModal';
import { IntegrationsPanel } from '../components/IntegrationsPanel';
import { Map, type MapMarker } from '../components/Map';
import { PriorityBadge, ServiceBadge, StatusBadge, Stepper, Timeline } from '../components/Common';
import { ago, km, minutes, SERVICE_META } from '../format';
import { useEvents } from '../hooks/useEvents';
import { useNow } from '../hooks/useNow';
import type { Catalogue, DetailView, HelpRequest, Responder, Stats } from '../types';

interface Props {
  api: Api;
  catalogue: Catalogue;
  toast: (m: string, err?: boolean) => void;
  onConnection: (s: string) => void;
  onStats: (s: Stats | null) => void;
}

type Tab = 'open' | 'closed';
const TAB_STATUS: Record<Tab, string> = { open: 'searching,unfulfilled,assigned,en_route,arrived', closed: 'completed,cancelled' };
const FALLBACK = { lat: -33.9249, lng: 18.4241 };

export function DispatcherScreen({ api, catalogue, toast, onConnection, onStats }: Props) {
  const [view, setView] = useState<'live' | 'integrations'>('live');
  const [calloutOpen, setCalloutOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('open');
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [units, setUnits] = useState<Responder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailView | null>(null);
  const [assignTo, setAssignTo] = useState('');
  const now = useNow();

  const refresh = useCallback(async () => {
    try {
      const [r, u, s] = await Promise.all([api.requests(TAB_STATUS[tab]), api.responders(), api.stats()]);
      setRequests(r);
      setUnits(u);
      onStats(s);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, tab, toast, onStats]);
  const refreshDetail = useCallback(async () => {
    if (!selectedId) return setDetail(null);
    try {
      setDetail(await api.detail(selectedId));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, selectedId, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    refreshDetail();
  }, [refreshDetail]);

  const connection = useEvents(
    api.eventsUrl(),
    useCallback(
      (type: string, data: unknown) => {
        if (type === 'responder.location') {
          const d = data as { responderId: string; lat: number; lng: number; heading: number | null };
          setUnits((u) => u.map((x) => (x.userId === d.responderId ? { ...x, lat: d.lat, lng: d.lng, heading: d.heading } : x)));
          return;
        }
        if (type === 'request.created') {
          const r = data as HelpRequest;
          toast(`New ${r.service} request ${r.reference} (${r.priority})`, r.priority === 'critical');
        }
        refresh();
        if (selectedId) refreshDetail();
      },
      [refresh, refreshDetail, selectedId, toast],
    ),
  );
  useEffect(() => onConnection(connection), [connection, onConnection]);

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    for (const u of units) {
      if (u.lat == null || u.lng == null || u.status === 'offline') continue;
      m.push({ id: `u-${u.userId}`, lat: u.lat, lng: u.lng, kind: 'unit', service: u.service, heading: u.heading, label: u.unitName, dim: u.status === 'busy' });
    }
    for (const r of requests) {
      if (tab === 'closed') continue;
      m.push({ id: `r-${r.id}`, lat: r.lat, lng: r.lng, kind: 'incident', service: r.service });
    }
    return m;
  }, [units, requests, tab]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      refresh();
      refreshDetail();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const sel = detail?.request ?? null;
  const candidates = sel ? units.filter((u) => u.service === sel.service && u.status !== 'busy') : [];
  const unitNames = useMemo(() => Object.fromEntries(units.map((u) => [u.userId, u.unitName])), [units]);

  const mapCenter = sel ?? (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : FALLBACK);

  if (view === 'integrations') {
    return (
      <div style={{ overflow: 'auto', minHeight: 0 }}>
        <div className="col-head" style={{ position: 'static' }}>
          <div className="view-tabs">
            <button className="tab" onClick={() => setView('live')}>
              Live
            </button>
            <button className="tab active">Integrations</button>
          </div>
        </div>
        <IntegrationsPanel api={api} toast={toast} />
      </div>
    );
  }

  return (
    <div className="dispatcher">
      {calloutOpen && (
        <CalloutModal
          api={api}
          catalogue={catalogue}
          units={units}
          center={mapCenter}
          onClose={() => setCalloutOpen(false)}
          onCreated={(r) => {
            setCalloutOpen(false);
            toast(`Call-out ${r.reference} ${r.status === 'assigned' ? 'sent to officer' : 'created, matching…'}`);
            setTab('open');
            setSelectedId(r.id);
            refresh();
          }}
        />
      )}
      <section className="col">
        <div className="col-head">
          <button className="btn small primary" onClick={() => setCalloutOpen(true)}>
            + New call-out
          </button>
          <span className="spacer" />
          <div className="view-tabs">
            <button className="tab active">Live</button>
            <button className="tab" onClick={() => setView('integrations')}>
              Integrations
            </button>
          </div>
        </div>
        <div className="col-head" style={{ top: 41 }}>
          Requests <span className="count">{requests.length}</span>
          <div className="tabs">
            {(['open', 'closed'] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {requests.length === 0 && <div className="empty">No {tab} requests.</div>}
        {requests.map((r) => (
          <button key={r.id} className={`list-item ${r.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(r.id)}>
            <div className="row">
              <ServiceBadge service={r.service} />
              <PriorityBadge priority={r.priority} />
              <StatusBadge status={r.status} />
              <span className="spacer" />
              <span className="mono">{r.reference}</span>
            </div>
            <div className="sub">
              {r.requesterName} · {r.address ?? `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`} · {ago(r.createdAt, now)} ago
              {r.source !== 'app' && <span className="badge status" style={{ marginLeft: 6 }}>{r.source === 'agent' ? 'call-out' : 'via API'}</span>}
            </div>
            <div className="sub">
              {r.responderId ? `${unitNames[r.responderId] ?? 'unit'} · ETA ${minutes(r.etaSeconds)}` : r.status === 'searching' ? 'Searching for a unit…' : ''}
              {r.flags.length > 0 && ` · ${r.flags.join(', ')}`}
            </div>
            <Stepper status={r.status} />
          </button>
        ))}
        <div className="col-head" style={{ position: 'static' }}>
          Units <span className="count">{units.filter((u) => u.status !== 'offline').length} online</span>
        </div>
        {units.map((u) => (
          <div key={u.userId} className="list-item">
            <div className="row">
              <span style={{ color: SERVICE_META[u.service].color }}>{SERVICE_META[u.service].icon}</span>
              <b>{u.unitName}</b>
              <StatusBadge status={u.status} />
              <span className="spacer" />
              {u.rating !== null && <span className="hint">★ {u.rating}</span>}
            </div>
            <div className="sub">
              {u.name} · {u.organisation ?? '—'} · {u.vehicle ?? '—'} · {u.locationAt ? `fix ${ago(u.locationAt, now)} ago` : 'no location'}
            </div>
          </div>
        ))}
      </section>

      <Map center={mapCenter} zoom={12} markers={markers} trail={detail?.trail ?? []} fit={!sel && markers.length > 0} />

      {sel && (
        <aside className="col">
          <div className="col-head">
            <span className="mono">{sel.reference}</span>
            <StatusBadge status={sel.status} />
            <span className="spacer" />
            <button className="btn small ghost" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <div style={{ padding: 12, display: 'grid', gap: 12 }}>
            <div className="row">
              <ServiceBadge service={sel.service} />
              <PriorityBadge priority={sel.priority} />
            </div>
            <Stepper status={sel.status} />
            <dl className="kv">
              <dt>Requester</dt>
              <dd>
                {sel.requesterName} · <a href={`tel:${sel.requesterPhone}`}>{sel.requesterPhone}</a>
              </dd>
              <dt>Location</dt>
              <dd>
                {sel.address ?? '—'} <span className="hint mono">({sel.lat.toFixed(5)}, {sel.lng.toFixed(5)})</span>
              </dd>
              {sel.flags.length > 0 && (
                <>
                  <dt>Situation</dt>
                  <dd>{sel.flags.join(', ')}</dd>
                </>
              )}
              {sel.description && (
                <>
                  <dt>Notes</dt>
                  <dd>{sel.description}</dd>
                </>
              )}
              <dt>Unit</dt>
              <dd>{detail?.responder ? `${detail.responder.unitName} (${detail.responder.name}, ${detail.responder.phone}) · ETA ${minutes(sel.etaSeconds)}` : '—'}</dd>
              {sel.rating !== null && (
                <>
                  <dt>Rating</dt>
                  <dd>★ {sel.rating}</dd>
                </>
              )}
            </dl>

            {(sel.status === 'searching' || sel.status === 'unfulfilled') && (
              <div className="card">
                <h3>Assign manually</h3>
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  <option value="">Choose a {sel.service} unit…</option>
                  {candidates.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.unitName} · {u.status} {u.lat != null && `· ${km(Math.round(dist(u as { lat: number; lng: number }, sel)))}`}
                    </option>
                  ))}
                </select>
                <div className="actions">
                  <button className="btn primary" disabled={!assignTo} onClick={() => act(() => api.assign(sel.id, assignTo), 'Unit assigned')}>
                    Assign
                  </button>
                  {sel.status === 'unfulfilled' && (
                    <button className="btn" onClick={() => act(() => api.retry(sel.id), 'Search restarted')}>
                      Retry search
                    </button>
                  )}
                </div>
              </div>
            )}
            {['searching', 'unfulfilled', 'assigned', 'en_route', 'arrived'].includes(sel.status) && (
              <button
                className="btn danger"
                onClick={() => {
                  const reason = prompt('Cancel reason');
                  if (reason !== null) act(() => api.cancel(sel.id, reason || undefined), 'Request cancelled');
                }}
              >
                Cancel request
              </button>
            )}

            {detail?.offers && detail.offers.length > 0 && (
              <div>
                <h3>Offers</h3>
                <ul className="timeline">
                  {detail.offers.map((o) => (
                    <li key={o.id}>
                      <span className="t">{km(o.distanceM)}</span>
                      <span>
                        <b>{o.responder?.unitName ?? o.responderId.slice(0, 8)}</b> <StatusBadge status={o.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail && (
              <div>
                <h3>Timeline</h3>
                <Timeline events={detail.events} names={{ ...unitNames, [sel.requesterId]: sel.requesterName }} />
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function dist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
