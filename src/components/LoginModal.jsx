// New: components/LoginModal.jsx
// New component wrapping AuthStep, similar to OrderModal.

import React, { useState } from 'react';
import { X } from 'lucide-react';
import AuthStep from './order/AuthStep';
import ModalFit from './ModalFit';
import { saveEditorState, getAccountReturnUrl } from '../utils/editorStorage';
import { startGithubOAuth } from '../utils/git/githubAuth.js';
import { oauthStartPath } from '../utils/analyticsConsentAuth.js';

const LoginModal = ({ onClose, onComplete, currentScript, currentFilename }) => {
  const [error, setError] = useState(null);

  return (
    <ModalFit className="surface-scrim flex items-center justify-center z-50 px-4">
      <div className="modal-fit-panel surface-glass rounded-2xl shadow-2xl max-w-lg w-full flex flex-col border border-chrome-border/50">
        <div className="flex items-center justify-between p-5 border-b border-chrome-border/50">
          <h2 className="text-lg font-semibold text-white">Login</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-chrome-border/50 rounded-lg transition-colors">
            <X size={20} className="text-chrome-secondary" />
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mx-5 mt-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-300 text-xs underline mt-1"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <AuthStep
            onComplete={onComplete}
            onOAuthRedirect={(provider) => {
              saveEditorState({ currentScript, currentFilename });
              if (provider === 'github') {
                if (!startGithubOAuth()) {
                  setError('GitHub sign-in is not configured (set GITHUB_APP_CLIENT_ID)');
                }
                return;
              }
              window.location.href = oauthStartPath(provider, getAccountReturnUrl());
            }}
            onError={setError}
            orderContext={false}
          />
        </div>
      </div>
    </ModalFit>
  );
};

export default LoginModal;