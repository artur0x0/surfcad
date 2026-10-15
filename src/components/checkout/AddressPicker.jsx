/**
 * Address book for checkout. Choose a saved address, add one, or set the
 * default. The first saved address is the one the first order creates.
 * UPS validate-on-blur is fail-open and never blocks pay.
 */
import React, { useState } from 'react';
import { Loader2, MapPin, Star } from 'lucide-react';
import { addressKey } from '../../utils/checkoutPage.js';

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const EMPTY = {
  name: '',
  street: '',
  street2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  country: 'US',
};

function fieldClass(invalid) {
  return `w-full bg-gray-800/50 border rounded-xl py-2.5 px-3 text-white placeholder-gray-500 focus:outline-none ${
    invalid ? 'border-red-500' : 'border-chrome-border focus:border-blue-500'
  }`;
}

export default function AddressPicker({
  addresses = [],
  selectedId = '',
  onSelect,
  onBookChange,
}) {
  const book = Array.isArray(addresses) ? addresses : [];
  const [adding, setAdding] = useState(book.length === 0);
  const [form, setForm] = useState(EMPTY);
  const [makeDefault, setMakeDefault] = useState(book.length === 0);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Name is required';
    if (!form.street.trim()) next.street = 'Street address is required';
    if (!form.city.trim()) next.city = 'City is required';
    if (!form.state) next.state = 'State is required';
    if (!form.zip.trim()) next.zip = 'ZIP code is required';
    else if (!/^\d{5}(-\d{4})?$/.test(form.zip.trim())) next.zip = 'Invalid ZIP code format';
    if (form.phone && !/^[\d\s\-()+]+$/.test(form.phone)) next.phone = 'Invalid phone number';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: null }));
  };

  const validateBlur = async () => {
    if (!form.street.trim() || !form.city.trim() || !form.state || !form.zip.trim()) return;
    try {
      const response = await fetch('/api/shipping/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address: { ...form, country: 'US' } }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.success && Array.isArray(data.suggestions) && data.suggestions.length) {
        setSuggestions(data.suggestions);
      }
    } catch {
      /* fail-open: a UPS miss does not block the address */
    }
  };

  const applySuggestion = (suggestion) => {
    setForm((prev) => ({
      ...prev,
      street: suggestion.street || prev.street,
      city: suggestion.city || prev.city,
      state: suggestion.state || prev.state,
      zip: suggestion.zip || prev.zip,
    }));
    setSuggestions([]);
  };

  const saveAddress = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch('/api/auth/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: { ...form, country: 'US' },
          makeDefault: book.length === 0 || makeDefault,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save address');
      const nextBook = Array.isArray(data.addresses) ? data.addresses : book;
      onBookChange?.(nextBook);
      const saved = data.address || nextBook[nextBook.length - 1];
      const key = saved ? addressKey(saved, nextBook.length - 1) : '';
      if (key) onSelect?.(key);
      setForm(EMPTY);
      setAdding(false);
      setSuggestions([]);
    } catch (err) {
      setFormError(err.message || 'Failed to save address');
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (address) => {
    const id = addressKey(address);
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch('/api/auth/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: { ...address, _id: address._id || address.id },
          makeDefault: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to update address');
      const nextBook = Array.isArray(data.addresses) ? data.addresses : book;
      onBookChange?.(nextBook);
      if (!selectedId) onSelect?.(id);
    } catch (err) {
      setFormError(err.message || 'Failed to update address');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-address-picker="" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2">
          <MapPin size={16} />
          Ship to
        </h3>
        {book.length > 0 && (
          <button
            type="button"
            data-address-add=""
            className="text-xs text-blue-300 hover:text-blue-200"
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? 'Cancel' : 'Add address'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-500">United States addresses only.</p>

      <div className="space-y-2">
        {book.map((address, index) => {
          const id = addressKey(address, index);
          const selected = id === selectedId;
          return (
            <div
              key={id}
              data-address-choice={id}
              data-address-selected={selected ? 'true' : 'false'}
              className={`rounded-xl border p-3 ${
                selected ? 'border-blue-400 bg-blue-500/10' : 'border-chrome-border bg-gray-800/30'
              }`}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onSelect?.(id)}
              >
                <p className="text-sm text-white">{address.name}</p>
                <p className="text-xs text-chrome-secondary">
                  {address.street}{address.street2 ? `, ${address.street2}` : ''}
                </p>
                <p className="text-xs text-chrome-secondary">
                  {address.city}, {address.state} {address.zip}
                </p>
              </button>
              <div className="mt-2 flex items-center gap-2">
                {address.isDefault ? (
                  <span className="text-[11px] text-amber-200" data-address-default-badge="">
                    Default
                  </span>
                ) : (
                  <button
                    type="button"
                    data-address-make-default=""
                    className="inline-flex items-center gap-1 text-[11px] text-gray-300 hover:text-white"
                    disabled={busy}
                    onClick={() => setDefault(address)}
                  >
                    <Star size={12} />
                    Set as default
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {adding && (
        <form onSubmit={saveAddress} className="space-y-3" data-address-form="">
          <label className="block text-xs text-chrome-secondary">
            Full name
            <input
              data-address-name=""
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              className={`${fieldClass(errors.name)} mt-1`}
            />
          </label>
          <label className="block text-xs text-chrome-secondary">
            Street
            <input
              data-address-street=""
              value={form.street}
              onChange={(e) => setField('street', e.target.value)}
              onBlur={validateBlur}
              className={`${fieldClass(errors.street)} mt-1`}
            />
          </label>
          <label className="block text-xs text-chrome-secondary">
            Apt, suite (optional)
            <input
              data-address-street2=""
              value={form.street2}
              onChange={(e) => setField('street2', e.target.value)}
              className={`${fieldClass(false)} mt-1`}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-chrome-secondary">
              City
              <input
                data-address-city=""
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
                onBlur={validateBlur}
                className={`${fieldClass(errors.city)} mt-1`}
              />
            </label>
            <label className="block text-xs text-chrome-secondary">
              State
              <select
                data-address-state=""
                value={form.state}
                onChange={(e) => setField('state', e.target.value)}
                onBlur={validateBlur}
                className={`${fieldClass(errors.state)} mt-1`}
              >
                <option value="">State</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-chrome-secondary">
              ZIP
              <input
                data-address-zip=""
                value={form.zip}
                onChange={(e) => setField('zip', e.target.value)}
                onBlur={validateBlur}
                className={`${fieldClass(errors.zip)} mt-1`}
              />
            </label>
            <label className="block text-xs text-chrome-secondary">
              Phone
              <input
                data-address-phone=""
                value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                className={`${fieldClass(errors.phone)} mt-1`}
              />
            </label>
          </div>
          {book.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                data-address-make-default-new=""
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Set as default
            </label>
          )}
          {suggestions.length > 0 && (
            <div className="space-y-1" data-address-suggestions="">
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.zip}-${index}`}
                  type="button"
                  className="block w-full text-left text-xs text-blue-300"
                  onClick={() => applySuggestion(suggestion)}
                >
                  Use {suggestion.street}, {suggestion.city}, {suggestion.state} {suggestion.zip}
                </button>
              ))}
            </div>
          )}
          {formError && <p className="text-xs text-red-300">{formError}</p>}
          <button
            type="submit"
            data-address-save=""
            disabled={busy}
            className="w-full rounded-xl bg-gray-200 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? <Loader2 className="mx-auto animate-spin" size={16} /> : 'Save address'}
          </button>
        </form>
      )}
    </section>
  );
}
