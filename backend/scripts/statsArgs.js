export function parseArgs(argv) {
  const opts = { format: 'json', days: 30 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--format') {
      opts.format = argv[i + 1] || 'json';
      i += 1;
    } else if (arg === '--days') {
      opts.days = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!['json', 'table'].includes(opts.format)) {
    throw new Error('--format must be json or table');
  }
  if (![7, 30, 120].includes(opts.days)) {
    throw new Error('--days must be 7, 30, or 120');
  }
  return opts;
}
