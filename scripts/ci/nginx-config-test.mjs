#!/usr/bin/env node
/**
 * Syntax-check docs/nginx-surfcad.com.conf with the system nginx binary.
 * Uses a temp wrapper config, dummy TLS certs, and a copy of the site file
 * with snippet paths rewritten to the repo's docs/nginx-snippets/ copy.
 */
import { execSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const siteSrc = join(repoRoot, 'docs/nginx-surfcad.com.conf');
const snippetSrc = join(repoRoot, 'docs/nginx-snippets/surfcad-security.conf');
const workerSnippetSrc = join(repoRoot, 'docs/nginx-snippets/surfcad-worker-csp.conf');

const work = mkdtempSync(join(tmpdir(), 'surfcad-nginx-test-'));
const sslDir = join(work, 'ssl');
const snippetsDir = join(work, 'snippets');
mkdirSync(sslDir, { recursive: true });
mkdirSync(snippetsDir, { recursive: true });

cpSync(snippetSrc, join(snippetsDir, 'surfcad-security.conf'));
cpSync(workerSnippetSrc, join(snippetsDir, 'surfcad-worker-csp.conf'));

execSync(
  `openssl req -x509 -nodes -days 1 -newkey rsa:2048 -keyout "${join(sslDir, 'privkey.pem')}" -out "${join(sslDir, 'fullchain.pem')}" -subj "/CN=surfcad.com"`,
  { stdio: 'pipe' },
);

let site = readFileSync(siteSrc, 'utf8');
site = site.replaceAll('/etc/nginx/snippets/surfcad-security.conf', join(snippetsDir, 'surfcad-security.conf'));
site = site.replaceAll('/etc/nginx/snippets/surfcad-worker-csp.conf', join(snippetsDir, 'surfcad-worker-csp.conf'));
site = site.replaceAll('/etc/letsencrypt/live/surfcad.com/fullchain.pem', join(sslDir, 'fullchain.pem'));
site = site.replaceAll('/etc/letsencrypt/live/surfcad.com/privkey.pem', join(sslDir, 'privkey.pem'));
site = site.replaceAll('include /etc/letsencrypt/options-ssl-nginx.conf;', '');
site = site.replaceAll('ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;', '');
site = site.replaceAll('listen 80;', 'listen 18080;');
site = site.replaceAll('listen [::]:80;', 'listen [::]:18080;');
site = site.replaceAll('listen 443 ssl;', 'listen 18443 ssl;');
site = site.replaceAll('listen [::]:443 ssl ipv6only=on;', 'listen [::]:18443 ssl ipv6only=on;');

const sitePath = join(work, 'surfcad.com.conf');
writeFileSync(sitePath, site);

const mimeTypes = '/etc/nginx/mime.types';
const nginxConf = join(work, 'nginx.conf');
writeFileSync(
  nginxConf,
  `pid ${join(work, 'nginx.pid')};
events { worker_connections 64; }
http {
  access_log ${join(work, 'access.log')};
  error_log ${join(work, 'error.log')};
  client_body_temp_path ${join(work, 'body')};
  proxy_temp_path ${join(work, 'proxy')};
  fastcgi_temp_path ${join(work, 'fastcgi')};
  uwsgi_temp_path ${join(work, 'uwsgi')};
  scgi_temp_path ${join(work, 'scgi')};
  include ${mimeTypes};
  include ${sitePath};
}
`,
);

try {
  execSync(`nginx -t -c "${nginxConf}"`, { stdio: 'inherit' });
  console.log('nginx-config-test: ok');
} catch (err) {
  console.error('nginx-config-test: nginx -t failed');
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
