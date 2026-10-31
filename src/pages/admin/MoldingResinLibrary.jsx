import { useCallback, useEffect, useState } from 'react';
import { moldingRequest } from '../../utils/moldingCatalogClient.js';
import {
  LIBRARY_NUMBER_FIELDS,
  emptyLibraryForm,
  libraryFormFromRow,
  libraryPayload,
} from '../../utils/moldingResinLibraryForm.js';

const fieldClass = 'mt-1 w-full rounded-md border border-chrome-border bg-transparent px-3 py-2 text-ui text-on-light font-ui min-h-11';
const primaryBtn = 'min-h-11 rounded-md px-3 py-2 text-ui-sm font-medium surface-panel text-on-dark disabled:opacity-60';
const quietBtn = 'min-h-11 rounded-md border border-chrome-border px-3 py-2 text-ui-sm font-medium text-on-light disabled:opacity-60';

function band(low, high, unit) {
  return `${low}–${high} ${unit}`;
}

export default function MoldingResinLibrary({ onForbidden }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyLibraryForm);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fail = useCallback((err) => {
    if (err?.status === 404) onForbidden();
    else setError(err?.message || 'Could not load the resin library');
  }, [onForbidden]);

  const load = useCallback(async () => {
    const body = await moldingRequest('/api/admin/molding/resin-library');
    setRows(Array.isArray(body?.resins) ? body.resins : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    load()
      .catch((err) => { if (!cancelled) fail(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, fail]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startNew() {
    setEditingId('');
    setForm(emptyLibraryForm());
    setError('');
  }

  async function save(event) {
    event.preventDefault();
    const parsed = libraryPayload(form);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const path = editingId
        ? `/api/admin/molding/resin-library/${editingId}`
        : '/api/admin/molding/resin-library';
      await moldingRequest(path, {
        method: editingId ? 'PATCH' : 'POST',
        body: parsed.value,
      });
      startNew();
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(row) {
    setSaving(true);
    setError('');
    try {
      if (row.active === false) {
        await moldingRequest(`/api/admin/molding/resin-library/${row._id}`, {
          method: 'PATCH',
          body: { active: true },
        });
      } else {
        await moldingRequest(`/api/admin/molding/resin-library/${row._id}/deactivate`, { method: 'POST' });
      }
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-12 space-y-4" data-admin-mold-library="">
      <div className="space-y-2">
        <h2 className="text-ui-lg font-semibold text-on-light">Injection resin library</h2>
        <p className="text-ui text-muted-on-light">
          Generic properties for later suggestions. No price. Partner $/kg lists stay on the partner catalog.
        </p>
      </div>
      {error ? (
        <p className="text-ui text-on-light" role="alert" data-admin-mold-library-error="">{error}</p>
      ) : null}
      {loading ? (
        <p className="text-ui text-muted-on-light">Loading resin library…</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-chrome-border px-3 py-2"
              data-admin-mold-library-row=""
            >
              <p className="text-ui text-on-light" data-admin-mold-library-grade="">
                {row.grade}
                {' · '}
                {row.tensileModulusMpa}
                {' MPa · shrink '}
                {band(row.shrinkLowPct, row.shrinkHighPct, '%')}
                {' · wall '}
                {band(row.wallMinMm, row.wallMaxMm, 'mm')}
                {' · '}
                {row.active === false ? 'inactive' : 'active'}
              </p>
              <span className="flex gap-2">
                <button
                  type="button"
                  className={quietBtn}
                  onClick={() => {
                    setEditingId(row._id);
                    setForm(libraryFormFromRow(row));
                    setError('');
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={quietBtn}
                  disabled={saving}
                  onClick={() => deactivate(row)}
                >
                  {row.active === false ? 'Turn on' : 'Deactivate'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="space-y-3" onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-ui-sm text-muted-on-light">
            Grade
            <input
              className={fieldClass}
              value={form.grade}
              onChange={(event) => setField('grade', event.target.value)}
              data-admin-mold-field="library-grade"
            />
          </label>
          {LIBRARY_NUMBER_FIELDS.map(([key, label]) => (
            <label key={key} className="block text-ui-sm text-muted-on-light">
              {label}
              <input
                className={fieldClass}
                type="number"
                step="any"
                value={form[key]}
                onChange={(event) => setField(key, event.target.value)}
                data-admin-mold-field={`library-${key}`}
              />
            </label>
          ))}
          <label className="block text-ui-sm text-muted-on-light sm:col-span-2">
            Notes
            <input
              className={fieldClass}
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
              data-admin-mold-field="library-notes"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-ui text-on-light">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setField('active', event.target.checked)}
            data-admin-mold-field="library-active"
          />
          Active
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={saving} data-admin-mold-save-library="">
            {editingId ? 'Save resin' : 'Add resin'}
          </button>
          {editingId ? (
            <button type="button" className={quietBtn} onClick={startNew}>New resin</button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
