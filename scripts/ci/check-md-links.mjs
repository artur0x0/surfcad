#!/usr/bin/env node
/**
 * Resolve relative Markdown links (*.md, optional #fragment) and fail on missing targets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);

function walkMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkMd(abs, out);
    } else if (name.endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/** @param {string} body */
function extractMdLinks(body) {
  const links = [];
  const re = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(body))) {
    links.push(m[1].trim());
  }
  return links;
}

function isExternal(url) {
  return /^(?:https?:|mailto:|#)/i.test(url);
}

const files = walkMd(root);
const broken = [];

for (const file of files) {
  const body = readFileSync(file, 'utf8');
  const base = dirname(file);
  for (const raw of extractMdLinks(body)) {
    if (isExternal(raw)) continue;
    const [pathPart] = raw.split('#');
    if (!pathPart || !pathPart.endsWith('.md')) continue;
    const target = normalize(resolve(base, pathPart));
    if (!target.startsWith(root)) {
      broken.push({ from: file.slice(root.length + 1), link: raw, reason: 'escapes repo' });
      continue;
    }
    if (!existsSync(target)) {
      broken.push({ from: file.slice(root.length + 1), link: raw, reason: 'missing' });
    }
  }
}

if (broken.length) {
  console.error(`Broken Markdown links (${broken.length}):`);
  for (const b of broken) {
    console.error(`  ${b.from}: (${b.link}) — ${b.reason}`);
  }
  process.exit(1);
}

console.log(`Markdown link check OK (${files.length} files).`);
