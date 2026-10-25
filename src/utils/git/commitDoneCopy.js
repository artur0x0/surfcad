/**
 * Done-stage sentence for the Save dialog.
 * `status: 'committed'` is every successful write. The overwrite sentence
 * is only for an explicit force overwrite (`result.overwrote`).
 */
import { SAVE_QUEUED_COPY } from './workingSidecar.js';

export function gitCommitDoneMessage(result) {
  const status = result?.status;
  const sha = String(result?.sha || '').slice(0, 7);
  const branch = result?.branch || 'main';
  if (status === 'clean') return 'Nothing to commit.';
  if (status === 'already_upgraded') return 'This vault is already v2.';
  if (status === 'upgraded') return `Upgraded to v2 (${sha}).`;
  if (status === 'upgraded_and_saved') {
    return `Upgraded to v2 and saved working-copy edits (${sha}).`;
  }
  if (status === 'reloaded') {
    return 'Loaded the remote versions of the conflicting files. Other local edits stay in the working copy. Nothing was written to git.';
  }
  if (status === 'branched') {
    return `Saved on ${result?.branch || 'a new branch'} and switched the working copy.`;
  }
  if (status === 'committed') {
    if (result?.overwrote === true) {
      return `Overwrote the conflicting files on ${branch} (${sha}).`;
    }
    return `Committed ${(result?.files || []).length} file(s) to ${branch} (${sha}).`;
  }
  if (status === 'queued') return SAVE_QUEUED_COPY;
  if (result?.addedNames) return `Added ${result.addedNames} to the repo.`;
  return `Committed ${(result?.files || []).length} file(s) to ${branch} (${sha}).`;
}
