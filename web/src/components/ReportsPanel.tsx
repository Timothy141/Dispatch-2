import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../api';
import { minutes, SERVICE_META } from '../format';
import type { ReportSummary } from '../types';

interface Props {
  api: Api;
  toast: (m: string, err?: boolean) => void;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsPanel({ api, toast }: Props) {
  const [from, setFrom] = useState(day(new Date(Date.now() - 7 * 86400_000)));
  const [to, setTo] = useState(day(new Date()));
  const [data, setData] = useState<ReportSummary | null>(null);
  const toExclusive = `${to}T23:59:59.999Z`;

  const load = useCallback(async () => {
    try {
      setData(await api.reportSummary(`${from}T00:00:00.000Z`, toExclusive));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, from, toExclusive, toast]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="integrations">
      <div className="card">
        <div className="row">
          <h2>Reports</h2>
          <span className="spacer" />
          <label className="hint">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="inline" />
          </label>
          <label className="hint">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="inline" />
          </label>
          <a className="btn small" href={api.reportCsvUrl(`${from}T00:00:00.000Z`, toExclusive)}>
            ⬇ Download CSV
          </a>
        </div>
        {data && (
          <>
            <p className="hint">{data.total} incidents between {from} and {to}. Times are measured from the moment the request was made.</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Total</th>
                  <th>Completed</th>
                  <th>Cancelled</th>
                  <th>Unfulfilled</th>
                  <th>Open</th>
                  <th>Avg accept</th>
                  <th>Avg arrival</th>
                  <th>90% arrived within</th>
                </tr>
              </thead>
              <tbody>
                {data.byService.map((s) => (
                  <tr key={s.service}>
                    <td>
                      {SERVICE_META[s.service].icon} {SERVICE_META[s.service].label}
                    </td>
                    <td>{s.total}</td>
                    <td>{s.completed}</td>
                    <td>{s.cancelled}</td>
                    <td className={s.unfulfilled ? 'warn' : ''}>{s.unfulfilled}</td>
                    <td>{s.open}</td>
                    <td>{minutes(s.avgAcceptSeconds)}</td>
                    <td>{minutes(s.avgArrivalSeconds)}</td>
                    <td>{minutes(s.p90ArrivalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {data && (
        <div className="card">
          <h2>By unit</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Jobs</th>
                <th>Completed</th>
                <th>Avg arrival</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {data.byUnit.map((u) => (
                <tr key={u.responderId}>
                  <td>{u.unitName}</td>
                  <td>{u.jobs}</td>
                  <td>{u.completed}</td>
                  <td>{minutes(u.avgArrivalSeconds)}</td>
                  <td>{u.avgRating !== null ? `★ ${u.avgRating}` : '—'}</td>
                </tr>
              ))}
              {data.byUnit.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint">
                    No assigned incidents in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
