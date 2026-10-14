/**
 * Artur playtest toasts. The remote-ahead card has Get latest and Keep mine.
 * Get latest opens the Parts-list conflict dialog. Keep mine runs that
 * dialog's keep handler and dismisses the card. The delete Undo card is
 * 2× its one-line height.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PartFeed from '../../src/components/PartFeed.jsx';
import GitBehindToast from '../../src/components/GitBehindToast.jsx';
import { FeatureDeleteToast } from '../../src/components/FeatureEditDelete.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';
import {
  behindToastMessage,
  behindToastTarget,
  keepBehindToastTarget,
  openBehindToastTarget,
} from '../../src/utils/git/gitPull.js';

const PLATE = 'assemblies/Bracket/Plate.js';
const CHECK = {
  behindBy: 1,
  assemblyBehind: false,
  assemblyPath: 'assemblies/Bracket/.surf.json',
  partIds: [PLATE],
};
const PARTS = [{ id: PLATE, name: 'Plate' }];

export function renderPlaytestToastShot(el) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot)),
    ),
  );
}

function target() {
  return behindToastTarget(CHECK, [], { assemblyName: 'Bracket', parts: PARTS });
}

function Shot() {
  const feedRef = useRef(null);
  const [showBehind, setShowBehind] = useState(true);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    window.__BEHIND_CALLS__ = [];
    window.__TOAST_TARGET__ = target();
    window.__SHOW_DELETE__ = () => setShowDelete(true);
    window.__READY__ = true;
  }, []);

  const onChoice = async (choice) => {
    const calls = window.__BEHIND_CALLS__ || [];
    calls.push(choice);
    window.__BEHIND_CALLS__ = calls;
    return { status: choice.action === 'keep' ? 'kept' : 'ok', path: choice.path };
  };

  return React.createElement(
    'div',
    {
      'data-playtest-toast-shot': '',
      style: {
        position: 'relative',
        width: '100%',
        height: '100vh',
        background: '#111827',
        overflow: 'hidden',
      },
    },
    React.createElement(
      'div',
      { style: { position: 'absolute', left: -2000, top: 0, width: 320, height: '100%' } },
      React.createElement(PartFeed, {
        ref: feedRef,
        placement: 'desktop',
        isMobile: false,
        source: 'git',
        assemblyName: 'Bracket',
        rows: [{ id: PLATE, name: 'Plate', visible: true }],
        activeId: PLATE,
        behindPartIds: [PLATE],
        assemblyBehind: false,
        assemblyPath: CHECK.assemblyPath,
        onBehindChoice: onChoice,
      }),
    ),
    showBehind
      ? React.createElement(GitBehindToast, {
        message: behindToastMessage({ behindBy: 1 }),
        onGetLatest: () => {
          openBehindToastTarget(feedRef.current, target());
        },
        onKeepMine: () => {
          window.__KEEP_DONE__ = keepBehindToastTarget(feedRef.current, target()).finally(() => {
            setShowBehind(false);
          });
        },
        onDismiss: () => setShowBehind(false),
      })
      : null,
    showDelete
      ? React.createElement(FeatureDeleteToast, {
        lines: ['Deleted.'],
        canUndo: true,
        onUndo: () => setShowDelete(false),
        onDismiss: () => setShowDelete(false),
      })
      : null,
  );
}
