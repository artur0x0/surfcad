import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { agentRelayClusterReason, warnIfAgentRelayIsClustered } from '../agent/processMode.js';

describe('agent relay process mode', () => {
  test('warns when the process looks clustered and stays quiet otherwise', () => {
    assert.equal(agentRelayClusterReason({}, false), null);
    assert.equal(agentRelayClusterReason({ WEB_CONCURRENCY: '1' }, false), null);
    assert.equal(agentRelayClusterReason({ WEB_CONCURRENCY: '2' }, false), 'web_concurrency');
    assert.equal(agentRelayClusterReason({ NODE_APP_INSTANCE: '0' }, false), 'node_app_instance');
    assert.equal(agentRelayClusterReason({}, true), 'worker');
    const lines = [];
    warnIfAgentRelayIsClustered({
      env: {},
      isWorker: false,
      warn: (line) => lines.push(line),
    });
    assert.equal(lines.length, 0);
    warnIfAgentRelayIsClustered({
      env: { WEB_CONCURRENCY: '4' },
      isWorker: false,
      warn: (line) => lines.push(line),
    });
    assert.match(lines[0], /single Node process/);
    assert.match(lines[0], /web_concurrency/);
  });
});
