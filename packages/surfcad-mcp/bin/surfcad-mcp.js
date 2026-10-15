#!/usr/bin/env node
import { runSurfcadMcpServer } from '../src/server.mjs';

runSurfcadMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
