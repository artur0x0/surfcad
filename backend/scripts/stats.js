#!/usr/bin/env node
/**
 * Print sign-up / login monitoring aggregates (JSON or table).
 *
 * Usage:
 *   NODE_ENV=production node scripts/stats.js [--format json|table] [--days 7|30|120]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, disconnectDB } from '../db/connection.js';
import { fetchAdminStats } from '../services/adminStats.js';
import { parseArgs } from './statsArgs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export { parseArgs } from './statsArgs.js';

function printHelp() {
  console.log(`Usage: node scripts/stats.js [--format json|table] [--days 7|30|120]

Reads MongoDB (MONGODB_URI via backend config). No secrets are printed.
`);
}

function printTable(stats) {
  console.log(`Generated: ${stats.generatedAt}`);
  console.log(`Window: ${stats.days} day(s)`);
  console.log(`Totals: signups=${stats.totals.signups} logins=${stats.totals.logins} activeUsers=${stats.totals.activeUsers} quotes=${stats.totals.quotes} orders=${stats.totals.orders} partnerSubmissions=${stats.totals.partnerSubmissions}`);
  console.log('');

  const sections = [
    ['Sign-ups', stats.series.signups],
    ['Logins', stats.series.logins],
    ['Active users', stats.series.activeUsers],
    ['Quotes', stats.series.quotes],
    ['Orders', stats.series.orders],
    ['Partner submissions', stats.series.partnerSubmissions],
  ];

  for (const [title, rows] of sections) {
    console.log(title);
    if (!rows.length) {
      console.log('  (no data)');
      continue;
    }
    console.log('  date            count');
    for (const row of rows) {
      console.log(`  ${String(row.date).padEnd(14)}  ${String(row.count).padStart(6)}`);
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
    const stats = await fetchAdminStats({ days: opts.days });
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
