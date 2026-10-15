import React, { useEffect, useRef, useState } from 'react';
import { BrandWordmark } from '../components/brand/BrandWordmark.jsx';
import { PARTNER_TYPES } from '../utils/partnerForm.js';
import { loadTurnstileScript, resolveTurnstileSiteKey } from '../utils/turnstile.js';

const PAPER = '#FAFAF9';
const INK = '#16171D';
const GREY = '#6B6E78';
const MIST = '#E6E7EB';

const fieldClass =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-base text-[#16171D] outline-none transition focus:border-[#16171D] focus:ring-2 focus:ring-[#16171D]/10';

const TURNSTILE_RETRY =
  'We could not verify your submission. Please refresh the page and try again.';

export default function PartnersPage() {
  const [partnerType, setPartnerType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const turnstileSiteKey = resolveTurnstileSiteKey();
  const turnstileContainerRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileContainerRef.current) return undefined;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !turnstileContainerRef.current || !window.turnstile) return;
        if (turnstileWidgetIdRef.current != null) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current);
          } catch {
            /* stale widget */
          }
        }
        turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          size: 'invisible',
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load form protection. Check your connection and refresh.');
        }
      });

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          /* gone */
        }
        turnstileWidgetIdRef.current = null;
      }
    };
  }, [turnstileSiteKey]);

  async function requestTurnstileToken() {
    if (!turnstileSiteKey) {
      if (import.meta.env.DEV) return '';
      throw new Error(TURNSTILE_RETRY);
    }
    await loadTurnstileScript();
    if (!window.turnstile || turnstileWidgetIdRef.current == null) {
      throw new Error(TURNSTILE_RETRY);
    }
    return new Promise((resolve, reject) => {
      window.turnstile.execute(turnstileWidgetIdRef.current, {
        callback: (token) => resolve(token),
        'error-callback': () => reject(new Error(TURNSTILE_RETRY)),
        'expired-callback': () => reject(new Error(TURNSTILE_RETRY)),
      });
    });
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get('name') || ''),
      email: String(data.get('email') || ''),
      company: String(data.get('company') || ''),
      website: String(data.get('website') || ''),
      partnerType: String(data.get('partnerType') || ''),
      partnerTypeOther: String(data.get('partnerTypeOther') || ''),
      message: String(data.get('message') || ''),
      company_fax: String(data.get('company_fax') || ''),
    };

    setSubmitting(true);
    try {
      const turnstileToken = await requestTurnstileToken();
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, turnstileToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not send your message');
      }
      setDone(true);
      form.reset();
      setPartnerType('');
      if (turnstileWidgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.reset(turnstileWidgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setError(err?.message || 'Could not send your message');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      data-partners-page=""
      className="h-dvh overflow-y-auto"
      style={{ background: PAPER, color: INK }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-10 space-y-4">
          <BrandWordmark tone="splash" size={32} />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" data-partners-title="">
              Become a partner
            </h1>
            <p className="text-base leading-relaxed" style={{ color: GREY }} data-partners-lead="">
              Tell us what you offer and how you would like to work with SurfCAD. We read every note.
            </p>
          </div>
        </header>

        {done ? (
          <section
            className="flex flex-1 flex-col justify-center space-y-4 rounded-2xl border p-8 text-center sm:p-10"
            style={{ borderColor: MIST }}
            data-partners-thanks=""
          >
            <h2 className="text-xl font-semibold">Thank you</h2>
            <p className="text-base leading-relaxed" style={{ color: GREY }}>
              We received your message and will be in touch at the email you provided.
            </p>
            <button
              type="button"
              className="mx-auto mt-2 text-sm font-medium underline underline-offset-4"
              style={{ color: INK }}
              data-partners-send-another=""
              onClick={() => setDone(false)}
            >
              Send another message
            </button>
          </section>
        ) : (
          <form
            className="space-y-5"
            data-partners-form=""
            onSubmit={onSubmit}
            noValidate
          >
            <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor="company_fax">Fax</label>
              <input id="company_fax" name="company_fax" type="text" tabIndex={-1} autoComplete="off" />
            </div>

            <div
              ref={turnstileContainerRef}
              data-partners-turnstile=""
              className="sr-only"
              aria-hidden="true"
            />

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name</span>
              <input
                name="name"
                type="text"
                required
                autoComplete="name"
                className={fieldClass}
                style={{ borderColor: MIST }}
                data-partners-field="name"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className={fieldClass}
                style={{ borderColor: MIST }}
                data-partners-field="email"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Company</span>
              <input
                name="company"
                type="text"
                required
                autoComplete="organization"
                className={fieldClass}
                style={{ borderColor: MIST }}
                data-partners-field="company"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Website</span>
              <input
                name="website"
                type="url"
                inputMode="url"
                placeholder="https://"
                autoComplete="url"
                className={fieldClass}
                style={{ borderColor: MIST }}
                data-partners-field="website"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">What do you offer?</span>
              <select
                name="partnerType"
                required
                value={partnerType}
                onChange={(e) => setPartnerType(e.target.value)}
                className={fieldClass}
                style={{ borderColor: MIST }}
                data-partners-field="partnerType"
              >
                <option value="">Select a partner type</option>
                {PARTNER_TYPES.map((row) => (
                  <option key={row.value} value={row.value}>{row.label}</option>
                ))}
              </select>
            </label>

            {partnerType === 'other' && (
              <label className="block space-y-1.5" data-partners-other-wrap="">
                <span className="text-sm font-medium">Describe what you offer</span>
                <input
                  name="partnerTypeOther"
                  type="text"
                  required
                  className={fieldClass}
                  style={{ borderColor: MIST }}
                  data-partners-field="partnerTypeOther"
                />
              </label>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Message</span>
              <textarea
                name="message"
                required
                rows={5}
                className={`${fieldClass} resize-y min-h-[8rem]`}
                style={{ borderColor: MIST }}
                data-partners-field="message"
              />
            </label>

            {error && (
              <p className="text-sm text-red-700" role="alert" data-partners-error="">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg px-4 py-3 text-base font-semibold text-white transition disabled:opacity-60"
              style={{ background: INK }}
              data-partners-submit=""
            >
              {submitting ? 'Sending…' : 'Submit'}
            </button>
          </form>
        )}

        <footer className="mt-12 text-center text-sm" style={{ color: GREY }}>
          <a href="/" className="underline underline-offset-4" data-partners-home="">
            Back to SurfCAD
          </a>
        </footer>
      </div>
    </div>
  );
}
