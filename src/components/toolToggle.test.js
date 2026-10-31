import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importJsx } from '../../test/jsxTestModule.js';
import { TOOL_TOGGLE_ON, toolToggleClass } from './toolToggle.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const MOLD_TOGGLES = [
  ['data-wall-heatmap', 'wallActive'],
  ['data-mold-parting', 'partingActive'],
  ['data-mold-side-actions', 'sideActionsActive'],
  ['data-mold-draft', 'moldDraftActive'],
  ['data-mold-dfm', 'dfmActive'],
  ['data-mold-quote', 'quoteActive'],
];

function buttonOpenTag(html, marker) {
  const tags = html.match(/<button\b[^>]*>/g) || [];
  const tag = tags.find((item) => item.includes(marker));
  assert.ok(tag, `missing button ${marker}`);
  return tag;
}

function buttonClass(html, marker) {
  const tag = buttonOpenTag(html, marker);
  const cls = tag.match(/\bclass="([^"]*)"/);
  assert.ok(cls, `missing class on ${marker}`);
  return cls[1];
}

test('toolToggleClass is the Cross section enabled class', () => {
  assert.equal(toolToggleClass(false), 'tool-toggle');
  assert.equal(toolToggleClass(true), `tool-toggle ${TOOL_TOGGLE_ON}`);
  const css = read('src/index.css');
  const idle = css.match(/\.tool-toggle\s*\{([^}]*)\}/);
  const on = css.match(/\.tool-toggle\.tool-toggle-on\s*\{([^}]*)\}/);
  assert.ok(idle, 'missing .tool-toggle');
  assert.ok(on, 'missing .tool-toggle.tool-toggle-on');
  assert.match(idle[1], /text-blue-600/);
  assert.match(idle[1], /p-2/);
  assert.match(idle[1], /rounded/);
  assert.match(on[1], /text-green-600/);
  assert.match(on[1], /bg-green-100/);
  assert.match(css, /\.tool-toggle:hover\s*\{[^}]*bg-gray-100/);
  assert.match(css, /\.tool-toggle:active\s*\{[^}]*bg-blue-100/);
  const guide = read('docs/ui-style-guide.md');
  assert.match(guide, /toolToggleClass\(on\)/);
  assert.match(guide, /tool-toggle-on/);
  assert.match(guide, /Cross section/);
});

test('a molding toggle gets tool-toggle-on when on, and matches Cross section', async () => {
  const { default: CrossSectionPanel } = await importJsx(
    new URL('./CrossSectionPanel.jsx', import.meta.url),
  );
  const panel = read('src/components/CrossSectionPanel.jsx');
  const drawer = read('src/components/MoldingToolsControl.jsx');
  assert.doesNotMatch(panel, /surface-success/);
  assert.doesNotMatch(panel, /text-on-light/);
  assert.doesNotMatch(drawer, /surface-success/);
  assert.doesNotMatch(drawer, /text-on-light/);
  assert.match(panel, /className=\{toolToggleClass\(enabled\)\}/);
  assert.match(panel, /<MoldingToolsControl/);
  for (const [marker, prop] of MOLD_TOGGLES) {
    assert.match(drawer, new RegExp(`toolToggleClass\\(${prop}\\)`));
    assert.match(drawer, new RegExp(`data-ui-action="${marker}"`));
    assert.doesNotMatch(panel, new RegExp(`data-ui-action="${marker}"`));
  }

  const show = {
    showWall: true,
    showParting: true,
    showSideActions: true,
    showMoldDraft: true,
    showDfm: true,
    showQuote: true,
  };
  const handlers = {
    onToggle: () => {},
    onZoomToFit: () => {},
    onSnapView: () => {},
    onMeasurementToggle: () => {},
    onWallToggle: () => {},
    onPartingToggle: () => {},
    onSideActionsToggle: () => {},
    onMoldDraftToggle: () => {},
    onDfmToggle: () => {},
    onQuoteToggle: () => {},
  };

  function rail(props) {
    return renderToStaticMarkup(React.createElement(CrossSectionPanel, {
      ...handlers,
      ...show,
      moldToolsOpen: true,
      ...props,
    }));
  }

  for (const verticalRail of [true, false]) {
    const onHtml = rail({
      verticalRail,
      enabled: true,
      wallActive: true,
      partingActive: true,
      sideActionsActive: true,
      moldDraftActive: true,
      dfmActive: true,
      quoteActive: true,
    });
    const offHtml = rail({ verticalRail, enabled: false });
    const sectionOn = buttonClass(onHtml, 'data-ui-action="data-cross-section-toggle"');
    assert.equal(sectionOn, toolToggleClass(true));
    assert.equal(
      buttonClass(offHtml, 'data-ui-action="data-cross-section-toggle"'),
      toolToggleClass(false),
    );
    for (const [marker] of MOLD_TOGGLES) {
      const onClass = buttonClass(onHtml, marker);
      const offClass = buttonClass(offHtml, marker);
      assert.equal(onClass, sectionOn, marker);
      assert.equal(offClass, toolToggleClass(false), marker);
      assert.match(onClass, new RegExp(`\\b${TOOL_TOGGLE_ON}\\b`));
      assert.doesNotMatch(offClass, new RegExp(`\\b${TOOL_TOGGLE_ON}\\b`));
      assert.doesNotMatch(onClass, /surface-success|text-on-dark|text-on-light/);
      const onTag = buttonOpenTag(onHtml, marker);
      assert.match(onTag, /aria-pressed="true"/);
      assert.match(buttonOpenTag(offHtml, marker), /aria-pressed="false"/);
    }
  }
});
