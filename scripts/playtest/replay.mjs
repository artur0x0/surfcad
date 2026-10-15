#!/usr/bin/env node
/**
 * Replay a saved playtest report (report.json `replay` block).
 *
 *   node scripts/playtest/replay.mjs path/to/report.json
 *   node scripts/playtest/replay.mjs   # uses PLAYTEST_OUT/latest/report.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertLocalhost,
  agentCall,
  findChrome,
  launchBrowser,
  openAgentPage,
  startPreviewServer,
  waitForServer,
} from './lib/harness.mjs';
import { getScenario } from './scenarios/index.mjs';

const reportPath = process.argv[2]
  || join(process.env.PLAYTEST_OUT || '', 'latest', 'report.json');

if (!existsSync(reportPath)) {
  console.error(`replay: missing report at ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const replay = report.replay;
if (!replay?.baseUrl || !Array.isArray(replay.scenarios)) {
  console.error('replay: report has no replay block');
  process.exit(1);
}

assertLocalhost(replay.baseUrl);

const exe = findChrome();
if (!exe) {
  console.error('replay: no Chrome');
  process.exit(1);
}

const port = Number(process.env.PLAYTEST_PORT || new URL(replay.baseUrl).port || 4174);
const { stop } = startPreviewServer(port);
let browser;
let failed = 0;

try {
  if (!(await waitForServer(`http://127.0.0.1:${port}/`))) {
    throw new Error('preview did not start');
  }
  browser = await launchBrowser(exe);

  for (const block of replay.scenarios) {
    const mod = getScenario(block.id);
    if (!mod) {
      console.log(`  skip unknown scenario ${block.id}`);
      failed += 1;
      continue;
    }
    const { page } = await openAgentPage(browser, {
      width: 1280,
      height: 800,
      baseUrl: replay.baseUrl,
      userId: mod.userId,
      assembly: mod.seedDoc(),
      parts: mod.seedParts(),
    });

    for (const step of block.steps || []) {
      const env = await agentCall(page, step.call, step.args);
      if (env.ok !== true) {
        failed += 1;
        console.log(`  ❌ ${block.id} ${step.call} — ${JSON.stringify(env.error)}`);
      } else {
        console.log(`  ✅ ${block.id} ${step.call}`);
      }
    }
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  stop();
}

if (failed) {
  console.log(`replay: ${failed} failure(s)`);
  process.exit(1);
}
console.log('replay: ok');
