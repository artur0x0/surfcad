/**
 * Relay preference and the signed-in agent's tokens, inside the Account pane.
 * Safari and a phone-width page always use the server. The radios still
 * save, so a later Chrome desktop visit can use Auto or Local only.
 */
import React, { useEffect, useState } from 'react';
import { formatAgentLastUsed, visibleAgentTokens } from '../agent/ws/agentSessionList.js';
import {
  isSafariFamily,
  readPhoneWidth,
  readRelayPreference,
  resolveRelayTarget,
  writeRelayPreference,
} from '../agent/ws/relayPreference.js';

const CITY_LOOKUP_CREDIT = 'IP geolocation by ipdata';
const CITY_LOOKUP_URL = 'https://ipdata.co/';

function useNarrowPage() {
  const [narrow, setNarrow] = useState(() => (
    typeof window === 'undefined' ? false : readPhoneWidth(window)
  ));
  useEffect(() => {
    const apply = () => setNarrow(readPhoneWidth(window));
    apply();
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null;
    mq?.addEventListener('change', apply);
    window.addEventListener('resize', apply);
    return () => {
      mq?.removeEventListener('change', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
  return narrow;
}

export default function AgentRelayAccount({ open = false }) {
  const narrow = useNarrowPage();
  const [preference, setPreference] = useState('auto');
  const [tokens, setTokens] = useState([]);
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const forcedServer = resolveRelayTarget({
    preference: 'local',
    userAgent,
    platform: typeof navigator === 'undefined' ? '' : navigator.platform,
    maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
    isMobile: narrow,
    innerWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
  }) === 'server';

  useEffect(() => {
    setPreference(readRelayPreference(typeof localStorage === 'undefined' ? null : localStorage));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    fetch('/agent/tokens', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { tokens: [] }))
      .then((body) => {
        if (!cancelled) setTokens(visibleAgentTokens(body?.tokens));
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => { cancelled = true; };
  }, [open]);

  const choose = (value) => {
    writeRelayPreference(typeof localStorage === 'undefined' ? null : localStorage, value);
    setPreference(value);
  };

  const revoke = async (id) => {
    const response = await fetch(`/agent/tokens/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) return;
    setTokens((rows) => rows.filter((row) => row.id !== id));
  };

  const showCredit = tokens.some((row) => row.city);

  return (
    <div className="pb-2 text-on-dark font-ui" data-agent-relay-account="">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-on-dark">
        Agent relay
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Agent relay">
        <button
          type="button"
          role="radio"
          aria-checked={preference === 'auto'}
          data-ui-action="data-agent-relay-auto"
          data-agent-relay="auto"
          className={`rounded-md px-2.5 py-1 text-ui-xs font-ui text-on-dark ${preference === 'auto' ? 'surface-success' : 'surface-quiet'}`}
          onClick={() => choose('auto')}
        >
          Auto
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={preference === 'local'}
          data-ui-action="data-agent-relay-local"
          data-agent-relay="local"
          className={`rounded-md px-2.5 py-1 text-ui-xs font-ui text-on-dark ${preference === 'local' ? 'surface-success' : 'surface-quiet'}`}
          onClick={() => choose('local')}
        >
          Local only
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={preference === 'server'}
          data-ui-action="data-agent-relay-server"
          data-agent-relay="server"
          className={`rounded-md px-2.5 py-1 text-ui-xs font-ui text-on-dark ${preference === 'server' ? 'surface-success' : 'surface-quiet'}`}
          onClick={() => choose('server')}
        >
          Server only
        </button>
      </div>
      {forcedServer ? (
        <p className="mt-1.5 text-ui-xs text-muted-on-dark" data-agent-relay-forced="">
          {isSafariFamily(userAgent)
            ? 'This browser uses the server relay.'
            : 'This page uses the server relay.'}
        </p>
      ) : null}
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-on-dark">
        Connected agents
      </p>
      {tokens.length === 0 ? (
        <p className="mt-1 text-ui-xs text-muted-on-dark" data-agent-token-empty="">No connected agents.</p>
      ) : (
        <ul className="mt-1" data-agent-token-list="">
          {tokens.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-2 py-1.5" data-agent-token={row.id}>
              <div className="min-w-0">
                <p className="truncate text-xs text-on-dark">{row.label || 'Agent'}</p>
                <p className="truncate text-ui-xs text-muted-on-dark">
                  {[row.machine, row.city ? `in ${row.city}` : ''].filter(Boolean).join(' ') || 'Machine unknown'}
                </p>
                <p className="text-ui-xs text-muted-on-dark">{formatAgentLastUsed(row.lastUsedAt)}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1 text-ui-xs font-ui text-on-dark surface-quiet"
                data-ui-action="data-agent-token-revoke"
                data-agent-token-revoke={row.id}
                onClick={() => { void revoke(row.id); }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCredit ? (
        <p className="mt-1 text-ui-xs text-muted-on-dark">
          <a className="text-on-dark underline" href={CITY_LOOKUP_URL}>{CITY_LOOKUP_CREDIT}</a>
        </p>
      ) : null}
    </div>
  );
}
