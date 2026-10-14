/**
 * Delete-part dialog for the golden screenshots.
 * The harness calls window.renderPartDeleteDialog. No top-level return.
 */
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import PartFeed from '../../src/components/PartFeed.jsx';
import { AuthProvider } from '../../src/hooks/useAuth.jsx';
import { GithubSessionProvider } from '../../src/hooks/useGithubSession.jsx';

const PART_ID = 'assemblies/Widget/FilletKilla.js';

function Shot() {
  useEffect(() => {
    window.__PART_ID__ = PART_ID;
    window.__DELETED__ = null;
    window.__READY__ = true;
  }, []);

  const compact = typeof window !== 'undefined' && window.innerWidth < 500;

  return React.createElement(
    'div',
    {
      'data-part-delete-shot': '',
      style: { width: '100%', height: '100vh', background: '#111827' },
    },
    React.createElement(PartFeed, {
      placement: compact ? 'mobile' : 'desktop',
      isMobile: compact,
      source: 'git',
      assemblyName: 'Widget',
      rows: [{ id: PART_ID, name: 'FilletKilla', visible: true }],
      activeId: PART_ID,
      scripts: { [PART_ID]: 'const part = cube(1);\n' },
      onDeletePart: (id, opts) => {
        window.__DELETED__ = { id, fromRepo: !!opts?.fromRepo };
      },
    }),
  );
}

window.renderPartDeleteDialog = function renderPartDeleteDialog(el) {
  createRoot(el).render(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(GithubSessionProvider, null, React.createElement(Shot)),
    ),
  );
};
