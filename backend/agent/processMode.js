import cluster from 'node:cluster';

/**
 * `/agent` state is in memory. Cluster workers and extra processes do not share it.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {boolean} [isWorker]
 * @returns {'worker' | 'web_concurrency' | 'node_app_instance' | null}
 */
export function agentRelayClusterReason(env = process.env, isWorker = cluster.isWorker) {
  if (isWorker) return 'worker';
  const concurrency = Number(env.WEB_CONCURRENCY);
  if (Number.isFinite(concurrency) && concurrency > 1) return 'web_concurrency';
  if (env.NODE_APP_INSTANCE != null && env.NODE_APP_INSTANCE !== '') return 'node_app_instance';
  return null;
}

/**
 * Log once when this process looks clustered. Does not refuse to boot.
 * @param {{ env?: NodeJS.ProcessEnv, isWorker?: boolean, warn?: (line: string) => void }} [opts]
 */
export function warnIfAgentRelayIsClustered(opts = {}) {
  const reason = agentRelayClusterReason(opts.env, opts.isWorker);
  if (!reason) return;
  const warn = opts.warn || console.warn;
  warn(`[agent] /agent keeps pairing, in-flight commands, and sockets in memory. Run a single Node process. This process looks clustered (${reason}).`);
}
