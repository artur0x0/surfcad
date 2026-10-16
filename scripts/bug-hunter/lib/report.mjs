import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} outDir
 * @param {object} payload
 */
export function writeBugHunterReport(outDir, payload) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'report.json');
  const mdPath = join(outDir, 'report.md');
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(mdPath, formatMarkdown(payload));
  return { jsonPath, mdPath };
}

function formatMarkdown(report) {
  const lines = [];
  lines.push('# SurfCAD bug hunter report');
  lines.push('');
  lines.push(`- **Started:** ${report.startedAt}`);
  lines.push(`- **Finished:** ${report.finishedAt}`);
  lines.push(`- **Duration:** ${report.durationMs} ms`);
  lines.push(`- **Base URL:** ${report.baseUrl}`);
  lines.push(`- **Overall:** ${report.ok ? 'PASS (no new bugs)' : 'FINDINGS'}`);
  if (report.budget) {
    lines.push(`- **Explorer steps:** ${report.budget.steps} (cap ${report.budget.maxSteps})`);
    lines.push(`- **Est. cost:** $${report.budget.estimatedCostUsd?.toFixed(4) ?? '0'} (cap $${report.budget.maxCostUsd})`);
  }
  lines.push('');

  if (report.seeds?.length) {
    lines.push('## Regression seeds');
    lines.push('');
    lines.push('| Seed | Result |');
    lines.push('| --- | --- |');
    for (const row of report.seeds) {
      lines.push(`| ${row.id} | ${row.ok ? 'pass' : '**fail**'} |`);
    }
    lines.push('');
  }

  if (report.findings?.length) {
    lines.push('## Findings');
    lines.push('');
    for (const f of report.findings) {
      lines.push(`### ${f.title || f.id}`);
      lines.push('');
      lines.push(f.summary || '');
      lines.push('');
      if (f.minimizedSteps?.length) {
        lines.push('**Minimal repro (bridge commands):**');
        lines.push('');
        lines.push('```json');
        lines.push(JSON.stringify(f.minimizedSteps, null, 2));
        lines.push('```');
        lines.push('');
      }
      if (f.screenshots?.length) {
        for (const shot of f.screenshots) {
          lines.push(`![screenshot](${shot})`);
        }
        lines.push('');
      }
    }
  }

  if (report.explorerTrace?.length) {
    lines.push('## Explorer trace');
    lines.push('');
    lines.push('| # | Command | Result |');
    lines.push('| ---: | --- | --- |');
    report.explorerTrace.forEach((row, i) => {
      const mark = row.finding ? '**bug**' : (row.refusal ? 'refusal' : 'ok');
      lines.push(`| ${i + 1} | \`${row.command}\` | ${mark} |`);
    });
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
