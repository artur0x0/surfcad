import { useCallback, useEffect, useState } from 'react';
import { moldingRequest } from '../../utils/moldingCatalogClient.js';

const fieldClass = 'mt-1 w-full rounded-md border border-chrome-border bg-transparent px-3 py-2 text-ui text-on-light font-ui min-h-11';
const primaryBtn = 'min-h-11 rounded-md px-3 py-2 text-ui-sm font-medium surface-panel text-on-dark disabled:opacity-60';

const STATUSES = [
  { value: 'sent', label: 'Sent' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const TYPE_LABEL = {
  firm_quote: 'Firm quote',
  human_review: 'Human review',
};

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

function draftFrom(lead) {
  return {
    status: lead.status,
    commission: String(lead.commissionOwedUsd ?? 0),
  };
}

export default function MoldingLeads({ onForbidden }) {
  const [partners, setPartners] = useState([]);
  const [leads, setLeads] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  const fail = useCallback((err) => {
    if (err?.status === 404) onForbidden();
    else setError(err?.message || 'Could not load leads');
  }, [onForbidden]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (partnerId) params.set('partnerId', partnerId);
    if (status) params.set('status', status);
    const query = params.toString();
    const [partnerBody, leadBody] = await Promise.all([
      moldingRequest('/api/admin/molding/partners'),
      moldingRequest(`/api/admin/molding/leads${query ? `?${query}` : ''}`),
    ]);
    const nextPartners = Array.isArray(partnerBody?.partners) ? partnerBody.partners : [];
    const nextLeads = Array.isArray(leadBody?.leads) ? leadBody.leads : [];
    setPartners(nextPartners);
    setLeads(nextLeads);
    setDrafts(Object.fromEntries(nextLeads.map((lead) => [lead._id, draftFrom(lead)])));
  }, [partnerId, status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load()
      .catch((err) => { if (!cancelled) fail(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, fail]);

  function setDraft(id, patch) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save(lead) {
    const draft = drafts[lead._id] || draftFrom(lead);
    const commission = String(draft.commission ?? '').trim();
    const n = Number(commission);
    if (commission === '' || !Number.isFinite(n) || n < 0) {
      setError('Commission must be 0 or greater');
      return;
    }
    setSavingId(lead._id);
    setError('');
    try {
      await moldingRequest(`/api/admin/molding/leads/${lead._id}`, {
        method: 'PATCH',
        body: { status: draft.status, commissionOwedUsd: n },
      });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="mt-12 space-y-4" data-admin-mold-leads="">
      <div className="space-y-2">
        <h2 className="text-ui-lg font-semibold text-on-light">Molding leads</h2>
        <p className="text-ui text-muted-on-light">
          Sent, quoted, won, or lost, and the commission owed. This page does not pay the partner
          and does not show who asked.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-ui-sm text-muted-on-light">
          Partner
          <select
            className={fieldClass}
            value={partnerId}
            data-admin-mold-lead-filter-partner=""
            onChange={(event) => setPartnerId(event.target.value)}
          >
            <option value="">All partners</option>
            {partners.map((partner) => (
              <option key={partner._id} value={partner._id}>
                {partner.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-ui-sm text-muted-on-light">
          Status
          <select
            className={fieldClass}
            value={status}
            data-admin-mold-lead-filter-status=""
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((row) => (
              <option key={row.value} value={row.value}>{row.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="text-ui text-on-light" role="alert" data-admin-mold-lead-error="">{error}</p>
      ) : null}
      {loading ? (
        <p className="text-ui text-muted-on-light" data-admin-mold-lead-loading="">Loading leads…</p>
      ) : null}

      <ul className="space-y-2">
        {!loading && leads.length === 0 ? (
          <li className="text-ui text-muted-on-light" data-admin-mold-lead-empty="">No molding leads yet.</li>
        ) : null}
        {leads.map((lead) => {
          const draft = drafts[lead._id] || draftFrom(lead);
          return (
            <li
              key={lead._id}
              className="space-y-3 rounded-lg border border-chrome-border p-3"
              data-admin-mold-lead={lead._id}
            >
              <div>
                <p className="text-ui font-medium text-on-light" data-admin-mold-lead-name="">
                  {lead.partnerName || lead.anonLabel}
                </p>
                <p className="text-ui-sm text-muted-on-light">
                  <span data-admin-mold-lead-type="">{TYPE_LABEL[lead.type] || lead.type}</span>
                  {lead.anonLabel ? ` · ${lead.anonLabel}` : ''}
                  {` · ${when(lead.createdAt)}`}
                  {` · ${lead.reviewFeePaid ? 'Review paid' : 'Review unpaid'}`}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <label className="block text-ui-sm text-muted-on-light">
                  Status
                  <select
                    className={fieldClass}
                    value={draft.status}
                    data-admin-mold-lead-status=""
                    onChange={(event) => setDraft(lead._id, { status: event.target.value })}
                  >
                    {STATUSES.map((row) => (
                      <option key={row.value} value={row.value}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-ui-sm text-muted-on-light">
                  Commission owed (USD)
                  <input
                    className={fieldClass}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={draft.commission}
                    data-admin-mold-lead-commission=""
                    onChange={(event) => setDraft(lead._id, { commission: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={savingId === lead._id}
                  data-admin-mold-lead-save=""
                  onClick={() => save(lead)}
                >
                  Save
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
