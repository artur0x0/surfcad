import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadCommandsCatalog } from '../src/catalog.mjs';
import { PROMPT_TOOL_NAMES } from '../src/prompt/promptTools.mjs';
import { packTarballEntry, parseNpmPackStdout } from './npmPackJson.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function npm(args, opts = {}) {
  const res = spawnSync('npm', args, {
    encoding: 'utf8',
    cwd: opts.cwd || PKG_ROOT,
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      ...opts.env,
    },
  });
  if (res.status !== 0) {
    const err = new Error(`npm ${args.join(' ')} failed (${res.status})\n${res.stdout}\n${res.stderr}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  return res;
}

test('npm pack tarball installs and lists MCP tools over stdio', { timeout: 120_000 }, async () => {
  const catalog = loadCommandsCatalog();
  const pack = npm(['pack', '--loglevel=error', '--json', '--pack-destination', PKG_ROOT]);
  const entry = packTarballEntry(parseNpmPackStdout(pack.stdout));
  const tgzName = entry.filename;
  const tgzPath = join(PKG_ROOT, tgzName);

  const installRoot = mkdtempSync(join(tmpdir(), 'surfcad-mcp-pack-'));
  let client = null;
  try {
    npm(['init', '-y'], { cwd: installRoot });
    npm(['install', tgzPath], { cwd: installRoot });

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['surfcad-mcp'],
      cwd: installRoot,
      env: {
        ...process.env,
        SURFCAD_MCP_START_RELAY: '0',
        SURFCAD_PAIRING_CODE: '',
      },
    });

    client = new Client({ name: 'surfcad-mcp-pack-smoke', version: '1.0.0' });
    await client.connect(transport);

    const pkgVersion = JSON.parse(
      readFileSync(join(installRoot, 'node_modules/surfcad-mcp/package.json'), 'utf8'),
    ).version;
    const serverInfo = client.getServerVersion();
    assert.equal(serverInfo?.name, 'surfcad-mcp');
    assert.equal(serverInfo?.version, pkgVersion, 'initialize serverInfo.version matches package.json');

    const { tools } = await client.listTools();
    // bridge commands + pair + guide + the local prompt tools
    assert.equal(tools.length, catalog.count + 2 + PROMPT_TOOL_NAMES.length, 'bridge commands, pair, guide, and local prompt tools');

  } finally {
    // Close in finally: a failed assertion used to leave the stdio child alive
    // and the whole unit suite hung on it.
    if (client) await client.close().catch(() => {});
    rmSync(installRoot, { recursive: true, force: true });
    try {
      rmSync(tgzPath);
    } catch {
      /* packed artifact may already be removed */
    }
  }
});
