import React, { useEffect, useRef, useState } from 'react';
import { BrandWordmark } from '../components/brand/BrandWordmark.jsx';
import SiteFooter from '../components/SiteFooter.jsx';
import { PARTNER_TYPES } from '../utils/partnerForm.js';
import {
  TURNSTILE_LOAD_ERROR,
  TURNSTILE_VERIFY_ERROR,
  buildTurnstileRenderConfig,
  acquireTurnstileToken,
  runPartnerFormSubmit,
} from '../utils/partnerTurnstileFlow.js';
import { loadTurnstileScript, resolveTurnstileSiteKey } from '../utils/turnstile.js';

const PAPER = '#FAFAF9';
const INK = '#16171D';
const GREY = '#6B6E78';
const MIST = '#E6E7EB';

const fieldClass =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-base text-[#16171D] outline-none transition focus:border-[#16171D] focus:ring-2 focus:ring-[#16171D]/10';

export default function PartnersPage() {
  const [partnerType, setPartnerType] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const turnstileSiteKey = resolveTurnstileSiteKey();
  const turnstileContainerRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const turnstileTokenRef = useRef(null);

  useEffect(() => {
    const container = turnstileContainerRef.current;
    if (!turnstileSiteKey || !container) return undefined;
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
        turnstileTokenRef.current = null;
        const widgetId = window.turnstile.render(
          turnstileContainerRef.current,
          buildTurnstileRenderConfig(turnstileSiteKey, {
            onToken: (token) => {
              turnstileTokenRef.current = token;
            },
            onError: () => {
              turnstileTokenRef.current = null;
            },
            onExpired: () => {
              turnstileTokenRef.current = null;
            },
            onTimeout: () => {
              turnstileTokenRef.current = null;
            },
          }),
        );
        turnstileWidgetIdRef.current = widgetId;
        turnstileContainerRef.current.setAttribute('data-turnstile-widget-id', String(widgetId));
      })
      .catch(() => {
        if (!cancelled) {
          setError(TURNSTILE_LOAD_ERROR);
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
      container.removeAttribute('data-turnstile-widget-id');
      turnstileTokenRef.current = null;
    };
  }, [turnstileSiteKey]);

  function resetTurnstileWidget() {
    turnstileTokenRef.current = null;
    if (turnstileWidgetIdRef.current != null && window.turnstile) {
      try {
        window.turnstile.reset(turnstileWidgetIdRef.current);
      } catch {
        /* ignore */
      }
    }
  }

  function retryAfterError() {
    setError('');
    resetTurnstileWidget();
  }

  async function requestTurnstileToken() {
    if (!turnstileSiteKey) {
      if (import.meta.env.DEV) return '';
      throw new Error(TURNSTILE_VERIFY_ERROR);
    }
    await loadTurnstileScript();
    if (!window.turnstile || turnstileWidgetIdRef.current == null) {
      throw new Error(TURNSTILE_VERIFY_ERROR);
    }
    const widgetId = turnstileWidgetIdRef.current;
    const cached = turnstileTokenRef.current;
    turnstileTokenRef.current = null;
    if (cached) return cached;
    return acquireTurnstileToken(window.turnstile, widgetId);
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

    const result = await runPartnerFormSubmit({
      payload,
      requestTurnstileToken,
      setSubmitting,
    });

    if (result.ok) {
      setDone(true);
      form.reset();
      setPartnerType('');
      resetTurnstileWidget();
      return;
    }

    setError(result.error || TURNSTILE_VERIFY_ERROR);
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
              SurfCAD connects designers with fabricators, seamlessly. Integration is free, and we&apos;ll help set things up to fit your workflow. Get quote requests by email with the part attached and take it from there, or let us automate quoting and payment so you only receive qualified, paid orders. Have another idea for working together? Drop us a line.
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
              className="min-h-[65px]"
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
              <div className="flex flex-wrap items-center gap-3 text-sm text-red-700" role="alert" data-partners-error="">
                <span>{error}</span>
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  data-partners-retry=""
                  onClick={retryAfterError}
                >
                  Retry
                </button>
              </div>
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

        <SiteFooter variant="light">
          <a href="/" className="underline underline-offset-4" data-partners-home="">
            Back to SurfCAD
          </a>
        </SiteFooter>
      </div>
    </div>
  );
}
