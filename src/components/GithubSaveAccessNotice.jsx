import { safeGithubAppInstallUrl, GITHUB_INSTALL_ACTION_LABEL } from '../utils/git/githubAppInstall.js';

/**
 * Save-to-repo error body. When `installUrl` is the app install page, the
 * dialog offers that page. Other errors stay a single sentence.
 */
export default function GithubSaveAccessNotice({ message, installUrl }) {
  const href = safeGithubAppInstallUrl(installUrl);
  return (
    <div className="font-ui" data-git-save-access="">
      <p className="text-xs text-on-dark" data-git-commit-error="">{message}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex rounded-md px-3 py-1.5 text-xs font-ui font-medium text-on-dark no-underline surface-success"
          data-ui-action="data-git-install-app"
          data-git-install-app=""
          data-git-install-url={href}
        >
          {GITHUB_INSTALL_ACTION_LABEL}
        </a>
      ) : null}
    </div>
  );
}
