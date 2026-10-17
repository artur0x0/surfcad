/**
 * About SurfCAD modal — golden screenshots.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import AboutModal from '../../src/components/AboutModal.jsx';

export function renderAboutModalShot(el) {
  createRoot(el).render(
    React.createElement(
      'div',
      {
        'data-about-modal-shot': '',
        style: { minHeight: '100vh', background: '#111827' },
      },
      React.createElement(AboutModal, { open: true, onClose: () => {} }),
    ),
  );
  window.__READY__ = true;
}
