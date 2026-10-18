/**
 * Resolve an `open_assembly` name against the vault's assembly names.
 * Exact folder name opens. Several matches are an error. A missing name
 * is `not_found` and names what was asked for. No repo paths.
 */
import { NO_REPO_YET_CODE, NO_REPO_YET_COPY } from '../../utils/git/workingSidecar.js';
import { vaultSegment } from '../../utils/git/vaultLayout.js';

const PATH_IN_MESSAGE = /(?:^|\s)(?:assemblies|parts)\/\S+/g;

function cleanNames(available) {
  const names = [];
  const seen = new Set();
  for (const item of available || []) {
    if (typeof item !== 'string') continue;
    const seg = vaultSegment(item);
    if (!seg || seen.has(seg)) continue;
    seen.add(seg);
    names.push(seg);
  }
  return names;
}

export function assemblyListHint(names) {
  const list = Array.isArray(names) ? names.filter((name) => typeof name === 'string' && name) : [];
  if (!list.length) {
    return 'The vault has no assemblies. Create one and Save, then open that exact name.';
  }
  return `Available assemblies: ${list.join(', ')}.`;
}

/**
 * @param {unknown} requested
 * @param {string[]|null|undefined} available vault assembly names (folder names)
 * @returns {{ name: string } | { error: { code: string, message: string, details: object } }}
 */
export function resolveAssemblyOpenName(requested, available) {
  const raw = typeof requested === 'string' ? requested.trim() : '';
  const want = vaultSegment(raw);
  const names = cleanNames(available);
  const hint = assemblyListHint(names);
  if (!want) {
    return {
      error: {
        code: 'bad_args',
        message: 'open_assembly needs a non-empty name',
        details: { hint },
      },
    };
  }
  const exact = names.filter((name) => name === want);
  const folded = names.filter((name) => name.toLowerCase() === want.toLowerCase());
  if (exact.length === 1) return { name: exact[0] };
  if (folded.length > 1) {
    return {
      error: {
        code: 'ambiguous',
        message: `More than one assembly matches "${raw}".`,
        details: {
          hint: 'Assembly names are not unique. Pass an exact name from the list.',
          matches: folded,
        },
      },
    };
  }
  if (folded.length === 1) {
    return {
      error: {
        code: 'ambiguous',
        message: `No exact assembly named "${raw}". Closest match: ${folded[0]}.`,
        details: {
          hint: 'Pass the exact assembly name. A different spelling is not opened automatically.',
          matches: folded,
        },
      },
    };
  }
  return {
    error: {
      code: 'not_found',
      message: `No assembly named "${raw}".`,
      details: { hint, assemblies: names },
    },
  };
}

/**
 * Map a failed vault open onto a bridge error. Missing assemblies stay
 * `not_found` and the message does not include a repo path.
 */
export function assemblyOpenFailure(opened, requested, names) {
  const raw = String(opened?.error || '');
  const code = typeof opened?.code === 'string' ? opened.code : '';
  if (code === NO_REPO_YET_CODE || raw === NO_REPO_YET_COPY) {
    return { code: NO_REPO_YET_CODE, message: NO_REPO_YET_COPY };
  }
  if (code === 'not_found' || /assembly not found/i.test(raw)) {
    const decision = resolveAssemblyOpenName(requested, names || []);
    if (decision.error) return decision.error;
  }
  const message = raw.replace(PATH_IN_MESSAGE, '').replace(/\s+/g, ' ').trim() || 'Could not open assembly';
  return { code: code || 'git_blocked', message };
}
