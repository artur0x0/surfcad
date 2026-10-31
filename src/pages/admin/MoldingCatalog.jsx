import { useCallback, useEffect, useState } from 'react';
import { moldingRequest } from '../../utils/moldingCatalogClient.js';
import {
  MACHINE_NUMBER_FIELDS,
  RATE_FIELDS,
  emptyMachineForm,
  emptyPartnerForm,
  emptyRateForm,
  emptyResinForm,
  machineFormFromRow,
  machinePayload,
  partnerFormFromRow,
  partnerPayload,
  rateFormFromRow,
  ratePayload,
  resinFormFromRow,
  resinPayload,
} from '../../utils/moldingCatalogForm.js';

const fieldClass = 'mt-1 w-full rounded-md border border-chrome-border bg-transparent px-3 py-2 text-ui text-on-light font-ui';
const primaryBtn = 'min-h-11 rounded-md px-3 py-2 text-ui-sm font-medium surface-panel text-on-dark disabled:opacity-60';
const quietBtn = 'min-h-11 rounded-md border border-chrome-border px-3 py-2 text-ui-sm font-medium text-on-light disabled:opacity-60';

function Field({ label, children }) {
  return (
    <label className="block text-ui-sm text-muted-on-light">
      {label}
      {children}
    </label>
  );
}

function TextInput({ label, value, onChange, attr, type = 'text' }) {
  return (
    <Field label={label}>
      <input
        className={fieldClass}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        data-admin-mold-field={attr}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function ActiveBox({ checked, onChange, attr }) {
  return (
    <label className="flex items-center gap-2 text-ui text-on-light">
      <input
        type="checkbox"
        checked={checked}
        data-admin-mold-field={attr}
        onChange={(event) => onChange(event.target.checked)}
      />
      Active
    </label>
  );
}

function statusWord(active) {
  return active === false ? 'Inactive' : 'Active';
}

export default function MoldingCatalog({ onForbidden }) {
  const [partners, setPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [partnerForm, setPartnerForm] = useState(emptyPartnerForm);
  const [editingPartnerId, setEditingPartnerId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [machines, setMachines] = useState([]);
  const [resins, setResins] = useState([]);
  const [rate, setRate] = useState(null);
  const [machineForm, setMachineForm] = useState(emptyMachineForm);
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [resinForm, setResinForm] = useState(emptyResinForm);
  const [editingResinId, setEditingResinId] = useState(null);
  const [rateForm, setRateForm] = useState(emptyRateForm);

  const fail = useCallback((err) => {
    if (err?.status === 404) onForbidden();
    else setError(err?.message || 'Could not save the catalog');
  }, [onForbidden]);

  const loadPartners = useCallback(async () => {
    const body = await moldingRequest('/api/admin/molding/partners');
    setPartners(Array.isArray(body?.partners) ? body.partners : []);
  }, []);

  const loadFloor = useCallback(async (partnerId, { resetRateForm = true } = {}) => {
    if (!partnerId) {
      setMachines([]);
      setResins([]);
      setRate(null);
      if (resetRateForm) setRateForm(emptyRateForm());
      return;
    }
    const [machineBody, resinBody, rateBody] = await Promise.all([
      moldingRequest(`/api/admin/molding/machines?partnerId=${partnerId}`),
      moldingRequest(`/api/admin/molding/resins?partnerId=${partnerId}`),
      moldingRequest(`/api/admin/molding/rates?partnerId=${partnerId}`),
    ]);
    setMachines(Array.isArray(machineBody?.machines) ? machineBody.machines : []);
    setResins(Array.isArray(resinBody?.resins) ? resinBody.resins : []);
    const cards = Array.isArray(rateBody?.rates) ? rateBody.rates : [];
    const card = cards[0] || null;
    setRate(card);
    if (resetRateForm) setRateForm(rateFormFromRow(card));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadPartners()
      .catch((err) => { if (!cancelled) fail(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadPartners, fail]);

  useEffect(() => {
    let cancelled = false;
    loadFloor(selectedId).catch((err) => { if (!cancelled) fail(err); });
    return () => { cancelled = true; };
  }, [selectedId, loadFloor, fail]);

  async function run(task) {
    setSaving(true);
    setError('');
    try {
      await task();
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  }

  function selectPartner(row) {
    setSelectedId(row._id);
    setEditingPartnerId(row._id);
    setPartnerForm(partnerFormFromRow(row));
    setEditingMachineId(null);
    setMachineForm(emptyMachineForm());
    setEditingResinId(null);
    setResinForm(emptyResinForm());
  }

  function startNewPartner() {
    setEditingPartnerId(null);
    setPartnerForm(emptyPartnerForm());
  }

  return (
    <section className="mt-12 space-y-8" data-admin-mold-catalog="">
      <div className="space-y-2">
        <h2 className="text-ui-lg font-semibold text-on-light">Molding partners</h2>
        <p className="text-ui text-muted-on-light">
          Real names stay on this page. The public label is the stand-in a later quote can show.
          Region is free text until a fixed list exists.
        </p>
      </div>

      {error ? (
        <p className="text-ui text-on-light" role="alert" data-admin-mold-error="">{error}</p>
      ) : null}
      {loading ? (
        <p className="text-ui text-muted-on-light" data-admin-mold-loading="">Loading partners…</p>
      ) : null}

      <form
        className="space-y-3"
        data-admin-mold-partner-form=""
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = partnerPayload(partnerForm);
          if (parsed.error) {
            setError(parsed.error);
            return;
          }
          run(async () => {
            const path = editingPartnerId
              ? `/api/admin/molding/partners/${editingPartnerId}`
              : '/api/admin/molding/partners';
            const saved = await moldingRequest(path, {
              method: editingPartnerId ? 'PATCH' : 'POST',
              body: parsed.value,
            });
            await loadPartners();
            selectPartner(saved);
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Real name"
            attr="displayName"
            value={partnerForm.displayName}
            onChange={(displayName) => setPartnerForm((form) => ({ ...form, displayName }))}
          />
          <TextInput
            label="Public label"
            attr="anonLabel"
            value={partnerForm.anonLabel}
            onChange={(anonLabel) => setPartnerForm((form) => ({ ...form, anonLabel }))}
          />
          <TextInput
            label="Region"
            attr="region"
            value={partnerForm.region}
            onChange={(region) => setPartnerForm((form) => ({ ...form, region }))}
          />
          <TextInput
            label="Notes"
            attr="notes"
            value={partnerForm.notes}
            onChange={(notes) => setPartnerForm((form) => ({ ...form, notes }))}
          />
        </div>
        <ActiveBox
          attr="partner-active"
          checked={partnerForm.active}
          onChange={(active) => setPartnerForm((form) => ({ ...form, active }))}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={saving} data-admin-mold-save-partner="">
            {editingPartnerId ? 'Save partner' : 'Add partner'}
          </button>
          {editingPartnerId ? (
            <button type="button" className={quietBtn} disabled={saving} onClick={startNewPartner}>
              New partner
            </button>
          ) : null}
        </div>
      </form>

      <ul className="space-y-2" data-admin-mold-partner-list="">
        {partners.length === 0 && !loading ? (
          <li className="text-ui text-muted-on-light">No molding partners yet.</li>
        ) : null}
        {partners.map((row) => (
          <li
            key={row._id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-chrome-border p-3"
            data-admin-mold-partner={row._id}
          >
            <div>
              <p className="text-ui font-medium text-on-light">
                {row.anonLabel}
                <span className="ml-2 text-ui-sm font-normal text-muted-on-light">
                  {row.region} · {statusWord(row.active)}
                </span>
              </p>
              <p className="text-ui-sm text-muted-on-light" data-admin-mold-real-name="">{row.displayName}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quietBtn} onClick={() => selectPartner(row)}>
                Edit
              </button>
              <button
                type="button"
                className={quietBtn}
                disabled={saving}
                data-admin-mold-deactivate="partner"
                onClick={() => run(async () => {
                  if (row.active === false) {
                    await moldingRequest(`/api/admin/molding/partners/${row._id}`, {
                      method: 'PATCH',
                      body: { active: true },
                    });
                  } else {
                    await moldingRequest(`/api/admin/molding/partners/${row._id}/deactivate`, { method: 'POST' });
                  }
                  await loadPartners();
                })}
              >
                {row.active === false ? 'Turn on' : 'Deactivate'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {selectedId ? (
        <div className="space-y-8" data-admin-mold-floor="">
          <MachineBlock
            rows={machines}
            form={machineForm}
            setForm={setMachineForm}
            editingId={editingMachineId}
            saving={saving}
            onEdit={(row) => {
              setEditingMachineId(row._id);
              setMachineForm(machineFormFromRow(row));
            }}
            onClear={() => {
              setEditingMachineId(null);
              setMachineForm(emptyMachineForm());
            }}
            onDeactivate={(row) => run(async () => {
              const path = row.active === false
                ? `/api/admin/molding/machines/${row._id}`
                : `/api/admin/molding/machines/${row._id}/deactivate`;
              if (row.active === false) {
                await moldingRequest(path, { method: 'PATCH', body: { active: true } });
              } else {
                await moldingRequest(path, { method: 'POST' });
              }
              await loadFloor(selectedId, { resetRateForm: false });
            })}
            onSubmit={() => {
              const parsed = machinePayload(machineForm, selectedId);
              if (parsed.error) {
                setError(parsed.error);
                return;
              }
              run(async () => {
                const path = editingMachineId
                  ? `/api/admin/molding/machines/${editingMachineId}`
                  : '/api/admin/molding/machines';
                await moldingRequest(path, {
                  method: editingMachineId ? 'PATCH' : 'POST',
                  body: parsed.value,
                });
                setEditingMachineId(null);
                setMachineForm(emptyMachineForm());
                await loadFloor(selectedId, { resetRateForm: false });
              });
            }}
          />
          <ResinBlock
            rows={resins}
            form={resinForm}
            setForm={setResinForm}
            editingId={editingResinId}
            saving={saving}
            onEdit={(row) => {
              setEditingResinId(row._id);
              setResinForm(resinFormFromRow(row));
            }}
            onClear={() => {
              setEditingResinId(null);
              setResinForm(emptyResinForm());
            }}
            onDeactivate={(row) => run(async () => {
              if (row.active === false) {
                await moldingRequest(`/api/admin/molding/resins/${row._id}`, {
                  method: 'PATCH',
                  body: { active: true },
                });
              } else {
                await moldingRequest(`/api/admin/molding/resins/${row._id}/deactivate`, { method: 'POST' });
              }
              await loadFloor(selectedId, { resetRateForm: false });
            })}
            onSubmit={() => {
              const parsed = resinPayload(resinForm, selectedId);
              if (parsed.error) {
                setError(parsed.error);
                return;
              }
              run(async () => {
                const path = editingResinId
                  ? `/api/admin/molding/resins/${editingResinId}`
                  : '/api/admin/molding/resins';
                await moldingRequest(path, {
                  method: editingResinId ? 'PATCH' : 'POST',
                  body: parsed.value,
                });
                setEditingResinId(null);
                setResinForm(emptyResinForm());
                await loadFloor(selectedId, { resetRateForm: false });
              });
            }}
          />
          <RateBlock
            rate={rate}
            form={rateForm}
            setForm={setRateForm}
            saving={saving}
            onDeactivate={() => run(async () => {
              if (!rate) return;
              if (rate.active === false) {
                await moldingRequest(`/api/admin/molding/rates/${rate._id}`, {
                  method: 'PATCH',
                  body: { active: true },
                });
              } else {
                await moldingRequest(`/api/admin/molding/rates/${rate._id}/deactivate`, { method: 'POST' });
              }
              await loadFloor(selectedId);
            })}
            onSubmit={() => {
              const parsed = ratePayload(rateForm, selectedId);
              if (parsed.error) {
                setError(parsed.error);
                return;
              }
              run(async () => {
                const path = rate?._id
                  ? `/api/admin/molding/rates/${rate._id}`
                  : '/api/admin/molding/rates';
                await moldingRequest(path, {
                  method: rate?._id ? 'PATCH' : 'POST',
                  body: parsed.value,
                });
                await loadFloor(selectedId);
              });
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function RowList({ rows, render }) {
  if (!rows.length) return <p className="text-ui text-muted-on-light">None yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 text-ui text-on-light">
          {render(row)}
        </li>
      ))}
    </ul>
  );
}

function MachineBlock({
  rows, form, setForm, editingId, saving, onEdit, onClear, onDeactivate, onSubmit,
}) {
  return (
    <div className="space-y-3" data-admin-mold-machines="">
      <h3 className="text-ui font-semibold text-on-light">Machines</h3>
      <RowList
        rows={rows}
        render={(row) => (
          <>
            <span>
              {row.name}
              {' · '}
              {row.tonnage}
              {' t · '}
              {statusWord(row.active)}
            </span>
            <span className="flex gap-2">
              <button type="button" className={quietBtn} onClick={() => onEdit(row)}>Edit</button>
              <button type="button" className={quietBtn} disabled={saving} onClick={() => onDeactivate(row)}>
                {row.active === false ? 'Turn on' : 'Deactivate'}
              </button>
            </span>
          </>
        )}
      />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Name"
            attr="machine-name"
            value={form.name}
            onChange={(name) => setForm((current) => ({ ...current, name }))}
          />
          {MACHINE_NUMBER_FIELDS.map(([key, label]) => (
            <TextInput
              key={key}
              label={label}
              attr={key}
              type="number"
              value={form[key]}
              onChange={(next) => setForm((current) => ({ ...current, [key]: next }))}
            />
          ))}
        </div>
        <ActiveBox
          attr="machine-active"
          checked={form.active}
          onChange={(active) => setForm((current) => ({ ...current, active }))}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={saving} data-admin-mold-save-machine="">
            {editingId ? 'Save machine' : 'Add machine'}
          </button>
          {editingId ? (
            <button type="button" className={quietBtn} onClick={onClear}>New machine</button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function ResinBlock({
  rows, form, setForm, editingId, saving, onEdit, onClear, onDeactivate, onSubmit,
}) {
  return (
    <div className="space-y-3" data-admin-mold-resins="">
      <h3 className="text-ui font-semibold text-on-light">Resin prices</h3>
      <RowList
        rows={rows}
        render={(row) => (
          <>
            <span>
              {row.grade}
              {' · $'}
              {row.usdPerKg}
              /kg · {statusWord(row.active)}
            </span>
            <span className="flex gap-2">
              <button type="button" className={quietBtn} onClick={() => onEdit(row)}>Edit</button>
              <button type="button" className={quietBtn} disabled={saving} onClick={() => onDeactivate(row)}>
                {row.active === false ? 'Turn on' : 'Deactivate'}
              </button>
            </span>
          </>
        )}
      />
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput
            label="Grade"
            attr="grade"
            value={form.grade}
            onChange={(grade) => setForm((current) => ({ ...current, grade }))}
          />
          <TextInput
            label="USD per kg"
            attr="usdPerKg"
            type="number"
            value={form.usdPerKg}
            onChange={(usdPerKg) => setForm((current) => ({ ...current, usdPerKg }))}
          />
          <TextInput
            label="Density (g/cm³)"
            attr="densityGCm3"
            type="number"
            value={form.densityGCm3}
            onChange={(densityGCm3) => setForm((current) => ({ ...current, densityGCm3 }))}
          />
        </div>
        <ActiveBox
          attr="resin-active"
          checked={form.active}
          onChange={(active) => setForm((current) => ({ ...current, active }))}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={saving} data-admin-mold-save-resin="">
            {editingId ? 'Save resin' : 'Add resin'}
          </button>
          {editingId ? (
            <button type="button" className={quietBtn} onClick={onClear}>New resin</button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function RateBlock({ rate, form, setForm, saving, onDeactivate, onSubmit }) {
  return (
    <div className="space-y-3" data-admin-mold-rates="">
      <h3 className="text-ui font-semibold text-on-light">
        Mold pricing
        {rate ? (
          <span className="ml-2 text-ui-sm font-normal text-muted-on-light">{statusWord(rate.active)}</span>
        ) : null}
      </h3>
      <p className="text-ui-sm text-muted-on-light">
        One card per partner. Use 0 for an adder you do not charge.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {RATE_FIELDS.map(([key, label]) => (
            <TextInput
              key={key}
              label={label}
              attr={key}
              type="number"
              value={form[key]}
              onChange={(next) => setForm((current) => ({ ...current, [key]: next }))}
            />
          ))}
        </div>
        <ActiveBox
          attr="rate-active"
          checked={form.active}
          onChange={(active) => setForm((current) => ({ ...current, active }))}
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryBtn} disabled={saving} data-admin-mold-save-rate="">
            {rate?._id ? 'Save mold pricing' : 'Add mold pricing'}
          </button>
          {rate?._id ? (
            <button type="button" className={quietBtn} disabled={saving} onClick={onDeactivate}>
              {rate.active === false ? 'Turn on' : 'Deactivate'}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
