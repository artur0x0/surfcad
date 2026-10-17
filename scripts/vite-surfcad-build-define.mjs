import { execSync } from 'node:child_process';

/**
 * Build-time git commit and timestamp for the client bundle (`vite` `define`).
 * Never throws — prod builds may run outside a git checkout.
 */
export function resolveSurfcadCommit() {
  const fromEnv = String(process.env.SURFCAD_COMMIT || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function resolveSurfcadBuildTime() {
  const fromEnv = String(process.env.SURFCAD_BUILD_TIME || '').trim();
  if (fromEnv) return fromEnv;
  return new Date().toISOString();
}

export function surfcadBuildDefine() {
  return {
    __SURFCAD_COMMIT__: JSON.stringify(resolveSurfcadCommit()),
    __SURFCAD_BUILD_TIME__: JSON.stringify(resolveSurfcadBuildTime()),
  };
}
