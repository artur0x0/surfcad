/**
 * `surfcad-mcp` argv. login / logout / status exit. Anything else starts
 * the stdio server. The token is never written to stdout or stderr.
 */

import { hostname } from 'node:os';
import { resolveAgentName, resolveServerUrl, selectRelayMode } from './remote/config.mjs';
import { loginDevice, loginWithCode } from './remote/login.mjs';
import { logoutDevice } from './remote/logout.mjs';
import { formatLoginStatus, readSavedLogin } from './remote/tokenStore.mjs';

const HELP = `surfcad-mcp

  npx surfcad-mcp
      MCP server on stdio. The local relay is the default.
  npx surfcad-mcp login [--name NAME] [--server URL]
      Device-code login at the SurfCAD agent server. Prints the code and
      the approval URL. The token is saved on this machine and is not printed.
  npx surfcad-mcp login --code CODE [--name NAME] [--server URL]
      Redeem a join code shown by SurfCAD on Safari, iOS, or a phone.
      The token is saved on this machine and is not printed.
  npx surfcad-mcp logout
      Revokes this machine's token on the server, then deletes the saved
      file. If the server cannot be reached, the file is still deleted.
  npx surfcad-mcp status

  --remote     Use the server relay. Requires a saved login.
  --local      Use the local relay even when a login is saved.
  --server URL Dev or staging origin (or set SURFCAD_AGENT_SERVER).
               Cleartext http is only allowed for localhost, 127.0.0.1, and ::1.
  --code CODE  Join code from the SurfCAD Connect Agent screen (ABCD-EFGH).
  --name NAME  Agent name for the approval page. Otherwise the MCP client
               name is used when the server starts, or SURFCAD_AGENT_NAME.

A saved login selects the server relay. These keep the local relay:
--local, SURFCAD_MCP_TRANSPORT=local, SURFCAD_AGENT_BRIDGE_WS_URL,
SURFCAD_AGENT_BRIDGE_WS_PORT, or a non-empty SURFCAD_PAIRING_CODE.
--remote and SURFCAD_MCP_TRANSPORT=remote win over those.
`;

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {'serve' | 'login' | 'logout' | 'status' | 'help'} */
  let command = 'serve';
  let name = '';
  let server = '';
  let code = '';
  let remote = false;
  let local = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'login' || arg === 'logout' || arg === 'status') {
      if (command !== 'serve') {
        throw Object.assign(new Error('Pass one command: login, logout, or status.'), { code: 'bad_args' });
      }
      command = arg;
      continue;
    }
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      command = 'help';
      continue;
    }
    if (arg === '--remote') {
      remote = true;
      continue;
    }
    if (arg === '--local') {
      local = true;
      continue;
    }
    if (arg === '--name' || arg.startsWith('--name=')) {
      const value = arg === '--name' ? argv[++i] : arg.slice('--name='.length);
      if (!value || value.startsWith('--')) {
        throw Object.assign(new Error('--name needs a value.'), { code: 'bad_args' });
      }
      name = value;
      continue;
    }
    if (arg === '--code' || arg.startsWith('--code=')) {
      const value = arg === '--code' ? argv[++i] : arg.slice('--code='.length);
      if (!value || value.startsWith('--')) {
        throw Object.assign(new Error('--code needs a value.'), { code: 'bad_args' });
      }
      code = value;
      continue;
    }
    if (arg === '--server' || arg.startsWith('--server=')) {
      const value = arg === '--server' ? argv[++i] : arg.slice('--server='.length);
      if (!value || value.startsWith('--')) {
        throw Object.assign(new Error('--server needs a value.'), { code: 'bad_args' });
      }
      server = value;
      continue;
    }
    throw Object.assign(new Error(`Unknown argument: ${arg}`), { code: 'bad_args' });
  }
  return { command, name, server, code, remote, local };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ remote: boolean, local: boolean }} flags
 */
function flagsFromEnv(env, flags) {
  let { remote, local } = flags;
  if (!remote && !local) {
    const transport = typeof env.SURFCAD_MCP_TRANSPORT === 'string'
      ? env.SURFCAD_MCP_TRANSPORT.trim().toLowerCase()
      : '';
    if (transport === 'remote') remote = true;
    else if (transport === 'local') local = true;
  }
  return { remote, local };
}

/**
 * @param {string[]} argv
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fetch?: typeof fetch,
 *   io?: { stdout: (text: string) => void, stderr: (text: string) => void },
 *   machine?: string,
 * }} [options]
 * @returns {Promise<{ action: 'exit', code: number } | { action: 'serve', mode: 'local' | 'remote', server: string, name: string }>}
 */
export async function runCli(argv, options = {}) {
  const env = options.env || process.env;
  const io = options.io || {
    stdout: (text) => { process.stdout.write(text); },
    stderr: (text) => { process.stderr.write(text); },
  };
  /** @type {ReturnType<typeof parseArgs>} */
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr(`${err?.message || 'Bad arguments'}\n${HELP}`);
    return { action: 'exit', code: 1 };
  }
  if (parsed.command === 'help') {
    io.stdout(HELP);
    return { action: 'exit', code: 0 };
  }
  if (parsed.command === 'login' || parsed.command === 'logout' || parsed.command === 'status') {
    if (parsed.remote || parsed.local) {
      io.stderr('login, logout, and status do not take --remote or --local.\n');
      return { action: 'exit', code: 1 };
    }
  }
  try {
    if (parsed.command === 'login') {
      const serverUrl = resolveServerUrl({ flag: parsed.server, env });
      const name = resolveAgentName({ name: parsed.name, env });
      if (parsed.code) {
        await loginWithCode({
          serverUrl,
          code: parsed.code,
          name,
          machine: options.machine || hostname(),
          env,
          fetch: options.fetch,
        });
        io.stdout('Logged in. The token is saved on this machine and is not printed.\n');
        return { action: 'exit', code: 0 };
      }
      await loginDevice({
        serverUrl,
        name,
        machine: options.machine || hostname(),
        env,
        fetch: options.fetch,
        onCode: ({ userCode, approvalUrl }) => {
          io.stdout(`Code: ${userCode}\nApprove at: ${approvalUrl}\nWaiting for approval…\n`);
        },
      });
      io.stdout('Logged in. The token is saved on this machine and is not printed.\n');
      return { action: 'exit', code: 0 };
    }
    if (parsed.command === 'logout') {
      const result = await logoutDevice({ env, fetch: options.fetch });
      if (result.hadLogin && !result.confirmed) {
        io.stdout('Logged out on this machine. SurfCAD did not confirm the revoke, so that login may stay valid until it expires.\n');
      } else {
        io.stdout('Logged out.\n');
      }
      return { action: 'exit', code: 0 };
    }
    if (parsed.command === 'status') {
      const saved = await readSavedLogin(env);
      const serverUrl = resolveServerUrl({ flag: parsed.server, env, saved });
      io.stdout(formatLoginStatus(saved, serverUrl));
      return { action: 'exit', code: 0 };
    }
  } catch (err) {
    io.stderr(`${err?.message || 'Login failed'}\n`);
    return { action: 'exit', code: 1 };
  }

  const flags = flagsFromEnv(env, parsed);
  let saved = null;
  try {
    saved = await readSavedLogin(env);
  } catch (err) {
    io.stderr(`${err?.message || 'Saved login could not be read.'}\n`);
    return { action: 'exit', code: 1 };
  }
  const selected = selectRelayMode({
    remote: flags.remote,
    local: flags.local,
    loggedIn: Boolean(saved?.token),
    env,
  });
  if (!selected.ok) {
    io.stderr(`${selected.error}\n`);
    return { action: 'exit', code: 1 };
  }
  if (selected.mode === 'remote' && !saved?.token) {
    io.stderr('No saved login. Run npx surfcad-mcp login.\n');
    return { action: 'exit', code: 1 };
  }
  return {
    action: 'serve',
    mode: selected.mode,
    server: parsed.server,
    name: parsed.name,
  };
}
