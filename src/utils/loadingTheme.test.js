import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyLoadingTheme,
  clearLoadingTheme,
  loadingThemeForHour,
  readForcedLoadingHour,
  readLoadingTheme,
} from './loadingTheme.js';

test('loadingThemeForHour is dark from 19:00 through 06:59', () => {
  assert.equal(loadingThemeForHour(19), 'dark');
  assert.equal(loadingThemeForHour(23), 'dark');
  assert.equal(loadingThemeForHour(0), 'dark');
  assert.equal(loadingThemeForHour(6), 'dark');
});

test('loadingThemeForHour is light from 07:00 through 18:59', () => {
  assert.equal(loadingThemeForHour(7), 'light');
  assert.equal(loadingThemeForHour(12), 'light');
  assert.equal(loadingThemeForHour(18), 'light');
});

test('loadingThemeForHour covers both clock boundaries', () => {
  assert.equal(loadingThemeForHour(6), 'dark');
  assert.equal(loadingThemeForHour(7), 'light');
  assert.equal(loadingThemeForHour(18), 'light');
  assert.equal(loadingThemeForHour(19), 'dark');
});

test('boot script and helper share the hour inequality', () => {
  const helper = readFileSync(new URL('./loadingTheme.js', import.meta.url), 'utf8');
  const boot = readFileSync(new URL('../../public/loading-theme.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(helper, /hour >= 19 \|\| hour < 7/);
  assert.match(boot, /hour >= 19 \|\| hour < 7/);
  assert.match(boot, /__SURFCAD_LOADING_HOUR__/);
  assert.match(html, /src="\/loading-theme\.js"/);
  assert.match(html, /data-loading-theme/);
  assert.match(app, /readLoadingTheme/);
  assert.match(app, /splash-dark/);
  assert.match(app, /surface-splash-dark/);
});

test('applyLoadingTheme writes data-loading-theme from a forced hour', () => {
  const el = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    removeAttribute(name) { delete this.attrs[name]; },
  };
  const documentRef = { documentElement: el };
  assert.equal(applyLoadingTheme({ documentRef, hour: 19 }), 'dark');
  assert.equal(el.attrs['data-loading-theme'], 'dark');
  assert.equal(readLoadingTheme({ documentRef, hour: 12 }), 'dark');
  clearLoadingTheme(documentRef);
  assert.equal(readLoadingTheme({ documentRef, hour: 12 }), 'light');
});

test('readForcedLoadingHour only accepts 0–23 integers', () => {
  assert.equal(readForcedLoadingHour({ __SURFCAD_LOADING_HOUR__: 19 }), 19);
  assert.equal(readForcedLoadingHour({ __SURFCAD_LOADING_HOUR__: 7 }), 7);
  assert.equal(readForcedLoadingHour({ __SURFCAD_LOADING_HOUR__: 24 }), null);
  assert.equal(readForcedLoadingHour({ __SURFCAD_LOADING_HOUR__: 6.5 }), null);
  assert.equal(readForcedLoadingHour({}), null);
});
