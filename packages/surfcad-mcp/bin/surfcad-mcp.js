#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';
import { runSurfcadMcpServer } from '../src/server.mjs';

/**
 * `process.exit` drops a stderr write that has not reached the OS yet,
 * so a bad flag can look like a silent non-zero exit. Finish the write first.
 * @param {NodeJS.WriteStream} stream
 */
function flushed(stream) {
  return new Promise((resolve) => {
    if (typeof stream.write !== 'function') {
      resolve();
      return;
    }
    // A full pipe with no reader must not hang login. 50 ms is enough for
    // a live stderr to take the error and the usage text.
    const timer = setTimeout(resolve, 50);
    stream.write('', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

try {
  const outcome = await runCli(process.argv.slice(2));
  if (outcome.action === 'exit') {
    await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
    process.exit(outcome.code);
  }
  await runSurfcadMcpServer({
    mode: outcome.mode,
    server: outcome.server,
    name: outcome.name,
  });
} catch (err) {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
}
