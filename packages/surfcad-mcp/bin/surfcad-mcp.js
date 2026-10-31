#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';
import { runSurfcadMcpServer } from '../src/server.mjs';

try {
  const outcome = await runCli(process.argv.slice(2));
  if (outcome.action === 'exit') process.exit(outcome.code);
  await runSurfcadMcpServer({
    mode: outcome.mode,
    server: outcome.server,
    name: outcome.name,
  });
} catch (err) {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
}
