import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { BrandWordmark } from '../components/brand/BrandWordmark.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { useAuth } from '../hooks/useAuth';
import { ADMIN_STATS_DAYS, adminPageAccess } from '../utils/adminAccess.js';
import NotFoundPage from './NotFoundPage.jsx';
import MoldingCatalog from './admin/MoldingCatalog.jsx';
import MoldingResinLibrary from './admin/MoldingResinLibrary.jsx';
import MoldingLeads from './admin/MoldingLeads.jsx';

const METRICS = [
  { key: 'signups', label: 'Sign-ups' },
  { key: 'logins', label: 'Logins' },
  { key: 'activeUsers', label: 'Active users' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'orders', label: 'Orders' },
  { key: 'partnerSubmissions', label: 'Partner submissions' },
];

function MetricChart({ metricKey, title, total, series }) {
  const rows = Array.isArray(series) ? series : [];
  const max = Math.max(1, ...rows.map((row) => Number(row.count) || 0));
  const height = 72;
  const gap = 0.6;
  const barW = rows.length ? 100 / rows.length : 100;

  return (
    <section
      className="rounded-lg border border-chrome-border p-4"
      data-admin-metric={metricKey}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-ui font-semibold text-on-light">{title}</h2>
        <p className="text-ui-lg font-semibold text-on-light" data-admin-total="">
          {total}
        </p>
      </div>
      <svg
        viewBox={`0 0 100 ${height}`}
        className="mt-3 h-20 w-full text-on-light"
        role="img"
        aria-label={`${title}, ${rows.length} days`}
      >
        {rows.map((row, index) => {
          const count = Number(row.count) || 0;
          const barHeight = count <= 0 ? 0 : Math.max((count / max) * (height - 2), 1.2);
          return (
            <rect
              key={row.date || index}
              x={index * barW + gap / 2}
              y={height - barHeight}
              width={Math.max(barW - gap, 0.4)}
              height={barHeight}
              fill="currentColor"
            >
              <title>{`${row.date}: ${count}`}</title>
            </rect>
          );
        })}
      </svg>
    </section>
  );
}

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const access = adminPageAccess({ isLoading, isAdmin: user?.isAdmin === true });
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const showNotFound = useCallback(() => setForbidden(true), []);

  useEffect(() => {
    if (access !== 'allow') return undefined;
    let cancelled = false;
    setStats(null);
    setError('');
    setForbidden(false);
    fetch(`/api/admin/stats?days=${days}`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (!res.ok) {
          throw new Error('Could not load stats');
        }
        const body = await res.json();
        if (!cancelled) setStats(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Could not load stats');
      });
    return () => { cancelled = true; };
  }, [access, days]);

  if (access === 'not_found' || forbidden) {
    return <NotFoundPage />;
  }

  if (access === 'pending') {
    return (
      <div className="surface-light text-on-light font-ui flex h-dvh items-center justify-center">
        Loading…
      </div>
    );
  }

  const series = stats?.series || {};
  const totals = stats?.totals || {};

  return (
    <div
      data-admin-page=""
      className="surface-light text-on-light font-ui min-h-dvh"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-8 space-y-4">
          <BrandWordmark tone="splash" size={32} />
          <div className="flex flex-wrap items-center gap-2">
            <BarChart3 size={18} className="text-on-light" aria-hidden="true" />
            <h1 className="text-2xl font-semibold tracking-tight" data-admin-title="">
              Admin
            </h1>
          </div>
          <p className="text-ui text-muted-on-light">
            Counts from SurfCAD’s own database. No personal data.
          </p>
          <div className="flex flex-wrap gap-2" data-admin-range-toggle="" role="group" aria-label="Time range">
            {ADMIN_STATS_DAYS.map((value) => {
              const selected = days === value;
              return (
                <button
                  key={value}
                  type="button"
                  data-admin-range={String(value)}
                  aria-pressed={selected}
                  className={
                    selected
                      ? 'rounded-md px-3 py-1.5 text-ui-sm font-medium surface-panel text-on-dark'
                      : 'rounded-md px-3 py-1.5 text-ui-sm font-medium text-on-light'
                  }
                  onClick={() => setDays(value)}
                >
                  {value} days
                </button>
              );
            })}
          </div>
        </header>

        {error ? (
          <p className="text-ui text-on-light" role="alert" data-admin-error="">{error}</p>
        ) : null}

        {!stats && !error ? (
          <p className="text-ui text-muted-on-light" data-admin-loading="">Loading stats…</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {METRICS.filter((metric) => series[metric.key]).map((metric) => (
            <MetricChart
              key={metric.key}
              metricKey={metric.key}
              title={metric.label}
              total={totals[metric.key] ?? 0}
              series={series[metric.key]}
            />
          ))}
        </div>

        <MoldingCatalog onForbidden={showNotFound} />
        <MoldingResinLibrary onForbidden={showNotFound} />
        <MoldingLeads onForbidden={showNotFound} />

        <SiteFooter variant="light">
          <a href="/" className="underline underline-offset-4" data-admin-home="">
            Back to SurfCAD
          </a>
        </SiteFooter>
      </div>
    </div>
  );
}
