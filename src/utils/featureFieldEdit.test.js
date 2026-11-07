import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitFieldValue,
  featureSheetEditLift,
  fieldIsMultiline,
  isKeyboardField,
  isTouchEditDevice,
  keyboardOpen,
  keyboardField,
  numberFieldLabelParts,
  readFieldLabel,
  readFieldUnit,
  readFieldValue,
} from './featureFieldEdit.js';

function input(type, attrs = {}) {
  return {
    tagName: 'INPUT',
    disabled: false,
    closest: () => null,
    getAttribute: (name) => (name === 'type' ? type : (attrs[name] ?? null)),
  };
}

test('keyboard fields are typed inputs, textareas, and contenteditable', () => {
  for (const type of ['text', 'number', 'search', 'email', 'url', 'tel', 'password', '']) {
    assert.equal(isKeyboardField(input(type)), true, type || 'default text');
    assert.equal(fieldIsMultiline(input(type)), false);
  }
  const area = {
    tagName: 'TEXTAREA',
    disabled: false,
    closest: () => null,
    getAttribute: () => null,
    value: 'line',
  };
  assert.equal(isKeyboardField(area), true);
  assert.equal(fieldIsMultiline(area), true);
  assert.equal(readFieldValue(area), 'line');

  const host = {
    tagName: 'DIV',
    isContentEditable: true,
    textContent: 'note',
    value: 'nope',
    closest: (sel) => (sel === '[contenteditable]' ? host : null),
    getAttribute: (name) => (name === 'contenteditable' ? 'true' : null),
  };
  const child = {
    tagName: 'SPAN',
    isContentEditable: true,
    closest: (sel) => (sel === '[contenteditable]' ? host : null),
    getAttribute: () => null,
  };
  assert.equal(keyboardField(host), host);
  assert.equal(keyboardField(child), host);
  assert.equal(fieldIsMultiline(host), true);
  assert.equal(readFieldValue(host), 'note');

  const emptyAttr = {
    tagName: 'DIV',
    isContentEditable: false,
    closest: () => null,
    getAttribute: (name) => (name === 'contenteditable' ? '' : null),
  };
  assert.equal(keyboardField(emptyAttr), emptyAttr);
  const off = {
    tagName: 'DIV',
    isContentEditable: false,
    closest: () => null,
    getAttribute: (name) => (name === 'contenteditable' ? 'false' : null),
  };
  assert.equal(isKeyboardField(off), false);

  const nestedInput = {
    tagName: 'INPUT',
    disabled: false,
    closest: (sel) => (sel === '[contenteditable]' ? host : null),
    getAttribute: (name) => (name === 'type' ? 'email' : null),
  };
  assert.equal(keyboardField(nestedInput), nestedInput);

  for (const type of ['range', 'checkbox', 'radio', 'button', 'submit', 'file', 'color', 'hidden']) {
    assert.equal(isKeyboardField(input(type)), false, type);
  }
  assert.equal(isKeyboardField({
    tagName: 'SELECT', disabled: false, closest: () => null, getAttribute: () => null,
  }), false);
  assert.equal(isKeyboardField({
    tagName: 'BUTTON',
    closest: (sel) => (sel === '[contenteditable]' ? host : null),
    getAttribute: () => null,
  }), false);
  assert.equal(isKeyboardField({ ...input('text'), closest: () => ({}) }), false);
  assert.equal(isKeyboardField({ ...input('text'), disabled: true }), false);
  assert.equal(readFieldValue(input('text')), '');
});

test('commit writes a contenteditable host through textContent', () => {
  const events = [];
  const host = {
    tagName: 'DIV',
    isContentEditable: true,
    textContent: '',
    closest: (sel) => (sel === '[contenteditable]' ? host : null),
    getAttribute: () => 'true',
    dispatchEvent(event) { events.push(event.type); },
  };
  commitFieldValue(host, 'hello');
  assert.equal(host.textContent, 'hello');
  assert.ok(events.includes('input'));
});

test('touch is coarse pointer or a touch point; a mouse is not', () => {
  const media = (query) => ({ matches: query === '(pointer: coarse)' });
  assert.equal(isTouchEditDevice({ matchMedia: media, navigator: { maxTouchPoints: 0 } }), true);
  assert.equal(isTouchEditDevice({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 5 } }), true);
  assert.equal(isTouchEditDevice({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 0 } }), false);
});

test('label prefers data-field-label, then the label, then aria-label', () => {
  assert.equal(readFieldLabel({
    getAttribute: (name) => (name === 'data-field-label' ? 'Radius' : 'nope'),
  }), 'Radius');

  const control = { id: 'wall-n' };
  const label = {
    childNodes: [
      { nodeType: 1, textContent: 'Wall', contains: () => false },
      control,
    ],
  };
  const doc = {
    querySelector: (sel) => (sel === 'label[for="wall-n"]' ? label : null),
  };
  assert.equal(readFieldLabel({
    id: 'wall-n',
    ownerDocument: doc,
    closest: () => null,
    getAttribute: () => '',
  }), 'Wall');

  assert.equal(readFieldLabel({
    id: '',
    closest: () => null,
    getAttribute: (name) => (name === 'aria-label' ? 'Distance value' : ''),
  }), 'Distance');

  assert.equal(readFieldLabel({
    id: '',
    closest: () => null,
    getAttribute: () => '',
  }), '');
});

test('unit prefers data-unit, then a following span', () => {
  assert.equal(readFieldUnit({
    getAttribute: (name) => (name === 'data-unit' ? 'mm' : ''),
  }), 'mm');
  assert.equal(readFieldUnit({
    getAttribute: () => '',
    nextElementSibling: { tagName: 'SPAN', textContent: 'mm' },
  }), 'mm');
  assert.equal(readFieldUnit({
    getAttribute: () => '',
    nextElementSibling: null,
  }), '');
});

test('number captions keep a trailing unit separate from the label', () => {
  assert.deepEqual(numberFieldLabelParts('Force N'), { label: 'Force', unit: 'N' });
  assert.deepEqual(numberFieldLabelParts('Pressure MPa'), { label: 'Pressure', unit: 'MPa' });
  assert.deepEqual(numberFieldLabelParts('E MPa'), { label: 'E', unit: 'MPa' });
  assert.deepEqual(numberFieldLabelParts('Angle °'), { label: 'Angle', unit: '°' });
  assert.deepEqual(numberFieldLabelParts('Radius'), { label: 'Radius', unit: '' });
  assert.deepEqual(numberFieldLabelParts('ν'), { label: 'ν', unit: '' });
  assert.deepEqual(numberFieldLabelParts('Distance', 'mm'), { label: 'Distance', unit: 'mm' });
});

test('edit lift sits on the visual-viewport bottom, toolbar included', () => {
  // Stubbed visualViewport: rects stay in layout space, so the visible
  // band is [offsetTop, offsetTop + height].
  assert.equal(featureSheetEditLift({
    paneBottom: 664,
    docTop: 0,
    scrollY: 0,
    vvHeight: 280,
    vvOffsetTop: 47,
  }), 664 - (47 + 280));

  // Real visual-relative rects: the document top is -offsetTop.
  assert.equal(featureSheetEditLift({
    paneBottom: 664 - 47,
    docTop: -47,
    scrollY: 0,
    vvHeight: 280,
    vvOffsetTop: 47,
  }), (664 - 47) - 280);

  // The shell is already the visual viewport.
  assert.equal(featureSheetEditLift({
    paneBottom: 280,
    docTop: -47,
    vvHeight: 280,
    vvOffsetTop: 47,
  }), 0);
  assert.equal(featureSheetEditLift({
    paneBottom: 280,
    docTop: 0,
    vvHeight: 280,
    vvOffsetTop: 47,
  }), 0);

  // Keyboard closed.
  assert.equal(featureSheetEditLift({
    paneBottom: 664,
    docTop: 0,
    vvHeight: 664,
    vvOffsetTop: 0,
  }), 0);
});

test('keyboard open: the visual viewport is over 80px shorter than the layout viewport', () => {
  // The phone chat drops its pill margin on this, not on focus alone.
  assert.equal(keyboardOpen({ layoutHeight: 844, vvHeight: 544, vvOffsetTop: 0 }), true);
  assert.equal(keyboardOpen({ layoutHeight: 844, vvHeight: 500, vvOffsetTop: 44 }), true);
  // The Safari toolbar alone, or no change at all.
  assert.equal(keyboardOpen({ layoutHeight: 844, vvHeight: 780, vvOffsetTop: 0 }), false);
  assert.equal(keyboardOpen({ layoutHeight: 844, vvHeight: 844, vvOffsetTop: 0 }), false);
  // The viewport the offset explains is not a keyboard.
  assert.equal(keyboardOpen({ layoutHeight: 844, vvHeight: 744, vvOffsetTop: 100 }), false);
  assert.equal(keyboardOpen({ layoutHeight: 0, vvHeight: 544 }), false);
  assert.equal(keyboardOpen(), false);
});
