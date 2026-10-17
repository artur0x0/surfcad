const UNKNOWN = 'unknown';

/** Full git sha injected at build time (or `unknown`). */
export function surfcadCommitSha() {
  try {
    if (typeof __SURFCAD_COMMIT__ !== 'undefined') {
      const value = String(__SURFCAD_COMMIT__).trim();
      return value || UNKNOWN;
    }
  } catch {
    // vite `define` absent in unit tests
  }
  return UNKNOWN;
}

/** ISO build timestamp injected at build time (or `unknown`). */
export function surfcadBuildTimeIso() {
  try {
    if (typeof __SURFCAD_BUILD_TIME__ !== 'undefined') {
      const value = String(__SURFCAD_BUILD_TIME__).trim();
      return value || UNKNOWN;
    }
  } catch {
    // vite `define` absent in unit tests
  }
  return UNKNOWN;
}

/** Short display hash (7 hex) for About UI; `unknown` when not a git sha. */
export function shortCommitSha(fullSha) {
  const raw = String(fullSha || '').trim();
  if (!raw || raw === UNKNOWN) return UNKNOWN;
  if (/^[0-9a-f]{7,40}$/i.test(raw)) return raw.slice(0, 7).toLowerCase();
  return UNKNOWN;
}

const SURFCAD_REPO = 'https://github.com/artur0x0/surfcad';

/** Commit page on GitHub, or null when sha is not known. */
export function commitGithubUrl(fullSha) {
  const raw = String(fullSha || '').trim();
  if (!raw || raw === UNKNOWN) return null;
  if (!/^[0-9a-f]{7,40}$/i.test(raw)) return null;
  return `${SURFCAD_REPO}/commit/${raw.toLowerCase()}`;
}

/**
 * Readable local build time for About UI.
 * @param {string} iso
 * @param {{ locale?: string, timeZone?: string }} [opts]
 */
export function formatSurfcadBuildTime(iso, opts = {}) {
  const raw = String(iso || '').trim();
  if (!raw || raw === UNKNOWN) return 'Unknown';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  const locale = opts.locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  const timeZone = opts.timeZone
    ?? (typeof Intl !== 'undefined' && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone)
    ?? 'UTC';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}

export function surfcadAboutBuildMeta() {
  const commit = surfcadCommitSha();
  return {
    commit,
    shortCommit: shortCommitSha(commit),
    commitUrl: commitGithubUrl(commit),
    buildTimeIso: surfcadBuildTimeIso(),
  };
}
