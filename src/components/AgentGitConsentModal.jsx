import VaultPickerDialog from './VaultPickerDialog';
import { agentGitConsentPrompt } from '../agent/gitAgent.js';

/**
 * Shown when an agent git write hits the real GitHub adapter without session opt-in.
 */
export default function AgentGitConsentModal({
  command,
  repo,
  branch,
  onAllow,
  onDeny,
}) {
  const prompt = agentGitConsentPrompt(command, repo, branch);
  return (
    <VaultPickerDialog
      title="Allow agent git writes?"
      labelledBy="agent-git-consent-title"
      dataAttr="agent-git-consent"
      onClose={onDeny}
      footer={(
        <div className="mt-4 flex flex-wrap justify-end gap-2" data-agent-git-consent-actions="">
          <button
            type="button"
            data-ui-action="data-agent-git-consent-deny"
            data-agent-git-consent-deny=""
            className="rounded-md px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10"
            onClick={onDeny}
          >
            Deny
          </button>
          <button
            type="button"
            data-ui-action="data-agent-git-consent-allow"
            data-agent-git-consent-allow=""
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            onClick={onAllow}
          >
            Allow for this session
          </button>
        </div>
      )}
    >
      <p className="text-xs text-gray-300" data-agent-git-consent-prompt="">
        {prompt}
      </p>
      <p className="mt-2 text-[11px] text-chrome-secondary" data-agent-git-consent-command="">
        Command: <span className="font-mono text-gray-200">{command}</span>
      </p>
    </VaultPickerDialog>
  );
}
