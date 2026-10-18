import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cacheDir = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/jsx-unit');

async function buildAndImport(options, key) {
  mkdirSync(cacheDir, { recursive: true });
  const outfile = join(cacheDir, `${key}.mjs`);
  await esbuild.build({
    ...options,
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    jsx: 'automatic',
    packages: 'external',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

/** Load a JSX module under node:test (no JSX loader in the unit runner). */
export async function importJsx(specifier) {
  const entry = fileURLToPath(specifier);
  const hash = createHash('sha1').update(readFileSync(entry)).digest('hex').slice(0, 16);
  return buildAndImport({ entryPoints: [entry] }, hash);
}

/** Bundle several app modules in one graph so context providers match. */
export async function importJsxSource(source, resolveDir) {
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 16);
  return buildAndImport({
    stdin: {
      contents: source,
      resolveDir,
      sourcefile: 'entry.jsx',
      loader: 'jsx',
    },
  }, `src-${hash}`);
}
