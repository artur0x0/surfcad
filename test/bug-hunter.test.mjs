/* eslint-env node */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudget } from '../scripts/bug-hunter/lib/budget.mjs';
import { parseExplorerAction } from '../scripts/bug-hunter/lib/parseAction.mjs';
import { classifyEnvelope, INTENTIONAL_REFUSAL_CODES } from '../scripts/bug-hunter/lib/invariants.mjs';
import { createLlmClient } from '../scripts/bug-hunter/lib/llmClient.mjs';
import { runExplorerLoop } from '../scripts/bug-hunter/lib/explorer.mjs';
import { minimizeSteps } from '../scripts/bug-hunter/lib/minimize.mjs';

test('parseExplorerAction accepts command and stop', () => {
  const cmd = parseExplorerAction({ command: 'status', args: {}, rationale: 'probe' });
  assert.equal(cmd.ok, true);
  assert.equal(cmd.command, 'status');
  const stop = parseExplorerAction({ stop: true, reason: 'done' });
  assert.equal(stop.stop, true);
});

test('intentional bridge refusals are not classified as bugs', () => {
  for (const code of ['confirm_required', 'real_repo_blocked']) {
    assert.ok(INTENTIONAL_REFUSAL_CODES.has(code));
    const kind = classifyEnvelope({ ok: false, error: { code, message: 'nope' } });
    assert.equal(kind.kind, 'refusal');
  }
  const runFail = classifyEnvelope({ ok: true, result: { ok: false, errors: ['bad'] } });
  assert.equal(runFail.kind, 'run_failure');
});

test('budget stops at max steps', () => {
  const budget = createBudget({ maxSteps: 2, maxCostUsd: 10, model: 'gpt-4o-mini' });
  assert.equal(budget.canContinue(), true);
  budget.recordStep({ prompt_tokens: 1, completion_tokens: 1 });
  budget.recordStep({ prompt_tokens: 1, completion_tokens: 1 });
  assert.equal(budget.canContinue(), false);
});

test('minimizeSteps drops removable commands', async () => {
  const calls = [];
  const steps = [
    { command: 'status', args: {} },
    { command: 'run', args: {} },
    { command: 'errors', args: {} },
  ];
  const min = await minimizeSteps(steps, async (prefix) => {
    calls.push(prefix.map((s) => s.command).join('>'));
    return prefix.some((s) => s.command === 'run');
  });
  assert.deepEqual(min.map((s) => s.command), ['run']);
});

test('explorer loop uses mocked LLM without network', async () => {
  let llmTurns = 0;
  const llm = {
    configured: true,
    async complete() {
      llmTurns += 1;
      if (llmTurns === 1) {
        return { message: { command: 'status', args: {} }, usage: { prompt_tokens: 10, completion_tokens: 5 } };
      }
      return { message: { stop: true, reason: 'done' }, usage: { prompt_tokens: 8, completion_tokens: 4 } };
    },
  };
  const budget = createBudget({ maxSteps: 5, maxCostUsd: 1, model: 'gpt-4o-mini' });
  const agentCall = async (_page, command) => {
    if (command === 'errors') return { ok: true, result: { errors: [] } };
    if (command === 'history') {
      return {
        ok: true,
        result: { head: 0, entries: [{ index: 0, current: true }], canUndo: false },
      };
    }
    return { ok: true, result: { ok: true, volume: 100, featureCount: 1 } };
  };
  const page = {
    evaluate: async () => [],
  };
  const { trace: outTrace, findings } = await runExplorerLoop({
    page,
    agentCall,
    llm,
    budget,
    consoleErrors: [],
  });
  assert.equal(findings.length, 0);
  assert.ok(outTrace.some((r) => r.command === 'status'));
  assert.ok(outTrace.some((r) => r.command === '(stop)'));
});

test('createLlmClient mock fetch parses chat response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        choices: [{ message: { content: '{"command":"status","args":{}}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    },
  });
  const client = createLlmClient({
    allowMissingKey: true,
    config: { baseUrl: 'http://mock', apiKey: 'test', model: 'gpt-4o-mini' },
    fetch: fetchImpl,
  });
  const out = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out.message.command, 'status');
});
