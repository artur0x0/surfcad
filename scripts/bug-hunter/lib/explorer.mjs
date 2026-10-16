import { parseExplorerAction } from './parseAction.mjs';
import {
  classifyEnvelope,
  consoleFindings,
  mergeFindings,
  probeEmptyNumberBoxes,
  readBridgeHealth,
} from './invariants.mjs';

const EXPLORER_SYSTEM = `You are a SurfCAD QA explorer driving window.surfcad bridge commands only.
Respond with JSON: { "command": "<name>", "args": { ... }, "rationale": "..." } or { "stop": true, "reason": "..." }.
Prefer safe read-only probes (status, feature_tree, list_faces) before mutating.
Do not call git writes, real vault saves, or commerce APIs.
If the session looks healthy and you have nothing useful to try, stop.`;

const SAFE_START_COMMANDS = [
  { command: 'status', args: {} },
  { command: 'feature_tree', args: {} },
  { command: 'list_faces', args: {} },
];

/**
 * @param {{ page, agentCall, llm, budget, commandHints?: string[], onFinding?: Function }} ctx
 */
export async function runExplorerLoop(ctx) {
  const trace = [];
  const findings = [];
  const consoleErrors = ctx.consoleErrors || [];

  const hints = ctx.commandHints || [
    'insert_cube', 'run', 'undo', 'redo', 'history', 'open_feature', 'edit_feature',
    'confirm_feature', 'list_faces', 'list_feature_edges', 'pick_edges', 'status', 'errors',
  ];

  while (ctx.budget.canContinue()) {
    const health = await readBridgeHealth(ctx.page, ctx.agentCall);
    const emptyBoxes = await probeEmptyNumberBoxes(ctx.page);
    const invariantHits = mergeFindings(
      health.findings,
      emptyBoxes.map((row) => ({ id: 'empty_number_box', detail: row.selector })),
      consoleFindings(consoleErrors.splice(0, consoleErrors.length)),
    );
    if (invariantHits.length) {
      const finding = {
        id: `invariant-${trace.length}`,
        title: invariantHits[0].id,
        summary: invariantHits.map((r) => r.detail || r.id).join('; '),
        steps: trace.map((t) => ({ command: t.command, args: t.args })),
        invariantHits,
      };
      findings.push(finding);
      ctx.onFinding?.(finding);
      break;
    }

    const statusSnap = health.status?.result || {};
    const messages = [
      { role: 'system', content: EXPLORER_SYSTEM },
      {
        role: 'user',
        content: JSON.stringify({
          allowedCommands: hints,
          stepsTaken: trace.length,
          lastStatus: {
            volume: statusSnap.volume,
            featureCount: statusSnap.featureCount,
            partName: statusSnap.partName,
          },
          recentTrace: trace.slice(-6).map((r) => ({ command: r.command, args: r.args, kind: r.kind })),
        }),
      },
    ];

    let action;
    try {
      const completion = await ctx.llm.complete({ messages });
      ctx.budget.recordStep(completion.usage);
      action = parseExplorerAction(completion.message);
    } catch (err) {
      trace.push({ command: '(llm)', args: {}, error: err.message, kind: 'llm_error' });
      break;
    }

    if (!action.ok) {
      trace.push({ command: '(parse)', args: {}, error: action.error, kind: 'parse_error' });
      break;
    }
    if (action.stop) {
      trace.push({ command: '(stop)', args: {}, rationale: action.reason, kind: 'stop' });
      break;
    }

    const env = await ctx.agentCall(ctx.page, action.command, action.args);
    const kind = classifyEnvelope(env);
    const row = {
      command: action.command,
      args: action.args,
      rationale: action.rationale,
      kind: kind.kind,
      refusal: kind.kind === 'refusal',
      envelope: env,
    };
    trace.push(row);

    if (kind.kind === 'bridge_error' || kind.kind === 'run_failure') {
      findings.push({
        id: `bridge-${trace.length}`,
        title: kind.kind,
        summary: kind.message || JSON.stringify(kind.errors || env.error),
        steps: trace.filter((t) => t.command && !t.command.startsWith('('))
          .map((t) => ({ command: t.command, args: t.args })),
        envelope: env,
      });
      ctx.onFinding?.(findings[findings.length - 1]);
      break;
    }
  }

  return { trace, findings };
}

/** Deterministic fallback when no LLM key — smoke the bridge with safe commands. */
export async function runDeterministicProbe(ctx) {
  const trace = [];
  for (const step of SAFE_START_COMMANDS) {
    const env = await ctx.agentCall(ctx.page, step.command, step.args);
    trace.push({ ...step, kind: classifyEnvelope(env).kind, envelope: env });
    ctx.budget.recordStep({});
  }
  return { trace, findings: [] };
}
