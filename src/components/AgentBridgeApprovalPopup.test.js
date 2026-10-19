import test from 'node:test';
import assert from 'node:assert/strict';
import { importJsx } from '../../test/jsxTestModule.js';

function buttons(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'button') out.push(node);
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) buttons(child, out);
  } else {
    buttons(children, out);
  }
  return out;
}

test('approval popup calls allow and deny and keeps the prompt copy', async () => {
  const { default: AgentBridgeApprovalPopup } = await importJsx(
    new URL('./AgentBridgeApprovalPopup.jsx', import.meta.url),
  );
  const calls = [];
  const el = AgentBridgeApprovalPopup({
    open: true,
    onAllow: () => calls.push('allow'),
    onDeny: () => calls.push('deny'),
  });
  assert.equal(el.props['data-agent-bridge-approval'], '');
  assert.match(el.props.className, /w-full/);
  assert.match(el.props.className, /justify-between/);
  assert.doesNotMatch(el.props.className, /w-max/);
  assert.doesNotMatch(el.props.className, /max-w-\[9rem\]/);
  const prompt = el.props.children.find((child) => child?.type === 'p');
  assert.equal(prompt.props.children, 'Allow this agent to control SurfCAD?');
  assert.doesNotMatch(prompt.props.className, /\binline\b/);
  const [allow, deny] = buttons(el);
  assert.equal(allow.props['aria-label'], 'Allow connection');
  assert.equal(allow.props['data-ui-action'], 'data-agent-bridge-approve');
  assert.equal(deny.props['aria-label'], 'Deny connection');
  assert.equal(deny.props['data-ui-action'], 'data-agent-bridge-reject');
  allow.props.onClick();
  deny.props.onClick();
  assert.deepEqual(calls, ['allow', 'deny']);
});

test('a closed approval popup renders nothing', async () => {
  const { default: AgentBridgeApprovalPopup } = await importJsx(
    new URL('./AgentBridgeApprovalPopup.jsx', import.meta.url),
  );
  assert.equal(AgentBridgeApprovalPopup({ open: false, onAllow() {}, onDeny() {} }), null);
});
