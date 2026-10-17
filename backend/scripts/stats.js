#!/usr/bin/env node
/**
 * Print sign-up / login monitoring aggregates (JSON or table).
 *
 * Usage:
 *   NODE_ENV=production node scripts/stats.js [--format json|table]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../db/connection.js';
import { fetchAdminStats } from '../services/adminStats.js';
import { parseArgs } from './statsArgs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { parseArgs } from './statsArgs.js';

function printHelp() {
  console.log(`Usage: node scripts/stats.js [--format json|table]

Reads MongoDB (MONGODB_URI via backend config). No secrets are printed.
`);
}

function printTable(stats) {
  console.log(`Generated: ${stats.generatedAt}`);
  console.log(`Total users: ${stats.totalUsers}`);
  console.log(`Active signed-in users (last ${30}d session window): ${stats.activeSignedInUsers}`);
  console.log('');

  const sections = [
    ['Sign-ups / day (last 30)', stats.signups.perDay],
    ['Sign-ups / week (last 12)', stats.signups.perWeek],
    ['Sign-ups / month (last 12)', stats.signups.perMonth],
    ['Logins / day (last 30)', stats.logins.perDay],
    ['Logins / week (last 12)', stats.logins.perWeek],
    ['Logins / month (last 12)', stats.logins.perMonth],
  ];

  for (const [title, rows] of sections) {
    console.log(title);
    if (!rows.length) {
      console.log('  (no data)');
      continue;
    }
    const hasDistinct = rows[0].distinctUsers !== undefined;
    if (hasDistinct) {
      console.log('  period          logins  distinct_users');
      for (const row of rows) {
        console.log(`  ${row.period.padEnd(14)}  ${String(row.logins).padStart(6)}  ${String(row.distinctUsers).padStart(15)}`);
      }
    } else {
      console.log('  period          count');
      for (const row of rows) {
        console.log(`  ${row.period.padEnd(14)}  ${String(row.count).padStart(6)}`);
      }
    }
    console.log('');
  }
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }

  await connectDB();
  try {
    const stats = await fetchAdminStats();
    if (opts.format === 'table') {
      printTable(stats);
    } else {
      console.log(JSON.stringify(stats, null, 2));
    }
    return 0;
  } finally {
    await disconnectDB();
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
