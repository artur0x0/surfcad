#!/usr/bin/env node
/**
 * One-off idempotent migration: remove unused User.dob from MongoDB.
 * Run once on production after deploying the schema change (see docs/ops-upload-prune.md).
 *
 * Usage:
 *   NODE_ENV=production node scripts/unset-user-dob.js [--dry-run]
 */
import config from '../config/index.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import User from '../db/models/User.js';

function parseArgs(argv) {
  let dryRun = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '-h' || arg === '--help') {
      return { dryRun, help: true };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, help: false };
}

function printHelp() {
  console.log(`Usage: NODE_ENV=production node scripts/unset-user-dob.js [--dry-run]

  --dry-run   Count users with dob set; do not write
`);
}

async function main() {
  const { dryRun, help } = parseArgs(process.argv);
  if (help) {
    printHelp();
    return 0;
  }

  if (!config.mongodb?.uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  await connectDB();

  const filter = { dob: { $exists: true } };
  const count = await User.countDocuments(filter);

  if (dryRun) {
    console.log(`dry-run: ${count} user(s) would have dob unset`);
    await disconnectDB();
    return 0;
  }

  const result = await User.updateMany(filter, { $unset: { dob: 1 } });
  console.log(`unset dob on ${result.modifiedCount} user(s) (${count} matched)`);

  await disconnectDB();
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
