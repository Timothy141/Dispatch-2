import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../api';
import { ago, clock, SERVICE_META } from '../format';
import { useNow } from '../hooks/useNow';
import type { AuditEntry, Catalogue, Organisation, Responder, Service } from '../types';
import { StatusBadge } from './Common';

interface Props {
  api: Api;
  catalogue: Catalogue;
  toast: (m: string, err?: boolean) => void;
}

const kb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

export function AdminPanel({ api, catalogue, toast }: Props) {
  const [orgs, setOrgs] = useState<Organisation[]>([]);
  const [units, setUnits] = useState<Responder[]>([]);
  const [backups, setBackups] = useState<Awaited<ReturnType<Api['backups']>> | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [name, setName] = useState('');
  const [services, setServices] = useState<Service[]>(['security']);
  const [phone, setPhone] = useState('');
  const [cov, setCov] = useState({ lat: '', lng: '', radiusKm: '' });
  const now = useNow(5000);

  const refresh = useCallback(async () => {
    try {
      const [o, u, b, a] = await Promise.all([api.organisations(), api.units(), api.backups(), api.audit()]);
      setOrgs(o);
      setUnits(u);
      setBackups(b);
      setAudit(a);
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

  const coverage = cov.lat && cov.lng && cov.radiusKm ? { lat: Number(cov.lat), lng: Number(cov.lng), radiusKm: Number(cov.radiusKm) } : null;

  return (
    <div className="integrations">
      <div className="card">
        <h2>Organisations</h2>
        <p className="hint">Response companies. Give each one its join code; their officers enter it when setting up their unit. A coverage circle limits which incidents their units are offered.</p>
        <div className="form-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Organisation name" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Control-room phone (optional)" />
        </div>
        <div className="chips">
          {catalogue.services.map((s) => (
            <button key={s} className={`chip ${services.includes(s) ? 'on' : ''}`} onClick={() => setServices((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]))}>
              {SERVICE_META[s].icon} {SERVICE_META[s].label}
            </button>
          ))}
        </div>
        <div className="form-row three">
          <input value={cov.lat} onChange={(e) => setCov({ ...cov, lat: e.target.value })} placeholder="Coverage centre lat (optional)" />
          <input value={cov.lng} onChange={(e) => setCov({ ...cov, lng: e.target.value })} placeholder="Coverage centre lng" />
          <input value={cov.radiusKm} onChange={(e) => setCov({ ...cov, radiusKm: e.target.value })} placeholder="Radius km" />
        </div>
        <button
          className="btn primary"
          disabled={!name.trim() || services.length === 0}
          onClick={() =>
            run(async () => {
              await api.createOrganisation({ name: name.trim(), services, contactPhone: phone.trim() || null, coverage });
              setName('');
              setPhone('');
              setCov({ lat: '', lng: '', radiusKm: '' });
            }, 'Organisation created')
          }
        >
          Add organisation
        </button>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Services</th>
              <th>Join code</th>
              <th>Coverage</th>
              <th>Units</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className={o.active ? '' : 'dim'}>
                <td>
                  {o.name}
                  {o.contactPhone && <div className="hint">{o.contactPhone}</div>}
                </td>
                <td>{o.services.map((s) => SERVICE_META[s].icon).join(' ')}</td>
                <td className="mono">{o.joinCode}</td>
                <td className="hint">{o.coverage ? `${o.coverage.radiusKm} km around ${o.coverage.lat.toFixed(3)}, ${o.coverage.lng.toFixed(3)}` : 'anywhere'}</td>
                <td>{o.unitCount ?? 0}</td>
                <td className="row">
                  <button className="btn small ghost" onClick={() => confirm('Issue a new join code? The old one stops working.') && run(() => api.rotateJoinCode(o.id), 'New join code issued')}>
                    New code
                  </button>
                  <button className="btn small ghost" onClick={() => run(() => api.updateOrganisation(o.id, { active: !o.active }))}>
                    {o.active ? 'Pause' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr>
                <td colSpan={6} className="hint">
                  No organisations yet. Units without one operate independently.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Units</h2>
        <p className="hint">Every responder who has set up a unit. Deactivate units that should no longer receive jobs.</p>
        <table className="table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Person</th>
              <th>Service</th>
              <th>Organisation</th>
              <th>Status</th>
              <th>Jobs · ★</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.userId} className={u.active ? '' : 'dim'}>
                <td>
                  <input className="inline" defaultValue={u.unitName} onBlur={(e) => e.target.value.trim() && e.target.value !== u.unitName && run(() => api.updateUnit(u.userId, { unitName: e.target.value.trim() }), 'Unit renamed')} />
                </td>
                <td>
                  {u.name}
                  <div className="hint">{u.phone}</div>
                </td>
                <td>
                  <select className="inline" value={u.service} onChange={(e) => run(() => api.updateUnit(u.userId, { service: e.target.value as Service }), 'Service changed')}>
                    {catalogue.services.map((s) => (
                      <option key={s} value={s}>
                        {SERVICE_META[s].label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="inline" value={u.organisationId ?? ''} onChange={(e) => run(() => api.updateUnit(u.userId, { organisationId: e.target.value || null }), 'Organisation changed')}>
                    <option value="">Independent{u.organisation && !u.organisationId ? ` (${u.organisation})` : ''}</option>
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <StatusBadge status={u.active ? u.status : 'deactivated'} />
                  <div className="hint">{u.locationAt ? `fix ${ago(u.locationAt, now)} ago` : 'no location'}</div>
                </td>
                <td>
                  {u.jobsCompleted} {u.rating !== null && `· ★ ${u.rating}`}
                </td>
                <td>
                  <button className={`btn small ${u.active ? 'danger' : ''}`} onClick={() => run(() => api.updateUnit(u.userId, { active: !u.active }), u.active ? 'Unit deactivated' : 'Unit reactivated')}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr>
                <td colSpan={7} className="hint">
                  No units yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Backups</h2>
        {backups && (
          <>
            <p className="hint">
              {backups.enabled ? `Automatic copies are written to ${backups.dir}.` : 'Automatic backups are disabled on this server.'}{' '}
              {backups.offsite ? (backups.lastUpload ? ('key' in backups.lastUpload ? `Last off-site copy: ${backups.lastUpload.key} at ${clock(backups.lastUpload.at)}.` : `Last off-site upload failed: ${backups.lastUpload.error}`) : 'Off-site storage configured; no upload yet.') : 'Off-site storage not configured (set S3_* variables).'}
            </p>
            <button className="btn" disabled={!backups.enabled} onClick={() => run(() => api.runBackup(), 'Backup written')}>
              Back up now
            </button>
            <ul className="timeline">
              {backups.backups.slice(0, 8).map((b) => (
                <li key={b.file}>
                  <span className="t">{clock(b.at)}</span>
                  <span>
                    {b.file} · {kb(b.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h2>Audit log</h2>
        <ul className="timeline">
          {audit.map((a) => (
            <li key={a.id}>
              <span className="t">{clock(a.createdAt)}</span>
              <span>
                <b>{a.action}</b> <span className="hint">{a.entityType}</span>
                {a.details != null && <div className="note mono small">{JSON.stringify(a.details).slice(0, 160)}</div>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
