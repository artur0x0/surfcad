import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} outDir
 * @param {object} payload
 */
export function writeReport(outDir, payload) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'report.json');
  const mdPath = join(outDir, 'summary.md');
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(mdPath, formatMarkdown(payload));
  return { jsonPath, mdPath };
}

function formatMarkdown(report) {
  const lines = [];
  lines.push('# SurfCAD agent playtest report');
  lines.push('');
  lines.push(`- **Started:** ${report.startedAt}`);
  lines.push(`- **Finished:** ${report.finishedAt}`);
  lines.push(`- **Duration:** ${report.durationMs} ms`);
  lines.push(`- **Base URL:** ${report.baseUrl}`);
  lines.push(`- **Scenarios:** ${report.scenarios.length}`);
  lines.push(`- **Steps:** ${report.totals.steps} (${report.totals.passed} passed, ${report.totals.failed} failed)`);
  lines.push(`- **Overall:** ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push('');

  if (Array.isArray(report.findings) && report.findings.length) {
    lines.push('## Findings');
    lines.push('');
    for (const row of report.findings) {
      lines.push(`- ${row}`);
    }
    lines.push('');
  }

  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.title || scenario.id}`);
    lines.push('');
    lines.push(`Status: **${scenario.ok ? 'pass' : 'fail'}** (${scenario.durationMs} ms)`);
    if (scenario.notes) lines.push(`> ${scenario.notes}`);
    lines.push('');
    lines.push('| Step | ms | Result | Detail |');
    lines.push('| --- | ---: | --- | --- |');
    for (const step of scenario.steps) {
      const mark = step.ok ? 'pass' : '**fail**';
      const detail = (step.detail || '').replace(/\|/g, '\\|').slice(0, 120);
      lines.push(`| ${step.id} | ${step.ms} | ${mark} | ${detail} |`);
    }
    lines.push('');
    if (scenario.screenshots?.length) {
      lines.push('Screenshots:');
      for (const shot of scenario.screenshots) {
        lines.push(`- \`${shot}\``);
      }
      lines.push('');
    }
  }

  if (report.invariants?.length) {
    lines.push('## Global invariants');
    lines.push('');
    for (const inv of report.invariants) {
      lines.push(`- ${inv.ok ? '✅' : '❌'} ${inv.id}${inv.detail ? ` — ${inv.detail}` : ''}`);
    }
    lines.push('');
  }

  if (report.consoleErrors?.length) {
    lines.push('## Console / page errors');
    lines.push('');
    for (const err of report.consoleErrors.slice(0, 20)) {
      lines.push(`- \`${err}\``);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
