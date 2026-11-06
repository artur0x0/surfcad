#!/usr/bin/env node
/**
 * Write public/THIRD_PARTY_NOTICES.txt, or fail if the committed file is stale.
 *
 *   node scripts/ci/generate-third-party-notices.mjs
 *   node scripts/ci/generate-third-party-notices.mjs --check
 *
 * Rust crates are the ones `cargo tree` links into the wasm32 FEA module
 * (`-e normal,no-proc-macro`). npm packages are the ones whose modules are
 * in the Vite production bundle, not the devDependency list and not every
 * production package that happens to be installed. Mesh, STEP reader, and
 * Emscripten notices are assembled from scripts/ci/license-texts/, which are
 * the upstream licence files at the pins in scripts/fea/build-mesh-wasm.mjs
 * and scripts/step/build-step-wasm.mjs. Those snapshots are what `--check`
 * reads, so those sections do not clone upstream on every CI run. The Rust
 * and npm sections are regenerated from the lockfile and the bundle.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, mergeConfig } from 'vite';
import baseConfig from '../../vite.config.js';
import { EMSDK_VERSION as STEP_EMSDK_VERSION, OCCT_PIN } from '../step/build-step-wasm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const TEXTS = join(HERE, 'license-texts');
const FEA = join(ROOT, 'packages/surfcad-fea');
const OUT = join(ROOT, 'public/THIRD_PARTY_NOTICES.txt');

const RULE = '--------------------------------------------------------------------------------';

function readText(path) {
  let text = readFileSync(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\s+$/, '');
}

function bundledText(rel) {
  return readText(join(TEXTS, rel));
}

function mitCopyrightHolder(pkg) {
  const cleaned = (pkg.authors || [])
    .map((author) => String(author).replace(/\s*<>\s*$/, '').trim())
    .filter(Boolean);
  if (cleaned.length) return `Copyright ${cleaned.join(', ')}`;
  const repo = String(pkg.repository || '');
  const match = repo.match(/github\.com\/([^/]+)\//);
  if (match) return `Copyright ${match[1]} (Cargo.toml names no author; ${repo})`;
  return 'Copyright holder is not named in Cargo.toml.';
}

function rustChannel() {
  const text = readFileSync(join(FEA, 'rust-toolchain.toml'), 'utf8');
  const match = text.match(/^channel = "([^"]+)"/m);
  if (!match) throw new Error('packages/surfcad-fea/rust-toolchain.toml has no channel');
  return match[1];
}

function cargo(args) {
  const result = spawnSync('cargo', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      RUSTUP_TOOLCHAIN: rustChannel(),
      // rust-cache sets CARGO_TERM_COLOR=always for later steps. Coloured
      // tree lines are not stable text, so this process always asks for plain
      // output. The parser still strips colour in case the variable is ignored.
      CARGO_TERM_COLOR: 'never',
    },
  });
  if (result.status !== 0) {
    throw new Error(`cargo ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function stripAnsi(text) {
  const esc = String.fromCharCode(0x1b);
  return text.split(esc).map((part, index) => (
    index === 0 ? part : part.replace(/^\[[0-9;]*m/, '')
  )).join('');
}

/** One `cargo tree -f {p}` line, or null when the line is progress noise. */
export function parseCargoTreeLine(raw) {
  const line = stripAnsi(raw).trim().replace(/\s+\(\*\)$/, '');
  if (!line || line.startsWith('Downloading') || line.startsWith('Downloaded') || line.startsWith('Updating')) {
    return null;
  }
  const match = line.match(/^(\S+) v(\S+?)(?:\s+\(.*\))?$/);
  if (!match) throw new Error(`unparsed cargo tree line: ${raw}`);
  return { name: match[1], version: match[2] };
}

function shippedRustIds() {
  const stdout = cargo([
    'tree',
    '--locked',
    '--manifest-path', join(FEA, 'Cargo.toml'),
    '--target', 'wasm32-unknown-unknown',
    '-e', 'normal,no-proc-macro',
    '--prefix', 'none',
    '-f', '{p}',
  ]);
  const ids = new Map();
  for (const raw of stdout.split('\n')) {
    const parsed = parseCargoTreeLine(raw);
    if (!parsed) continue;
    ids.set(`${parsed.name}@${parsed.version}`, parsed);
  }
  return [...ids.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
}

function cargoMetadata() {
  const stdout = cargo([
    'metadata',
    '--locked',
    '--format-version', '1',
    '--filter-platform', 'wasm32-unknown-unknown',
    '--manifest-path', join(FEA, 'Cargo.toml'),
  ]);
  return JSON.parse(stdout);
}

function licenseDocsIn(dir, extraRel) {
  const names = new Set();
  if (extraRel) names.add(extraRel);
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`cannot read ${dir}: ${err.message}`);
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (!/^(?:licen[cs]e|copying|unlicense|notice|copyright)(?:[-_.].*)?$/i.test(name)) continue;
    const full = join(dir, name);
    if (!statSync(full).isFile()) continue;
    names.add(name);
  }
  const docs = [...names].sort().map((name) => ({ label: name, text: readText(join(dir, name)) }));
  const unique = [];
  for (const doc of docs) {
    const prev = unique.find((item) => item.text === doc.text);
    if (prev) prev.labels.push(doc.label);
    else unique.push({ labels: [doc.label], text: doc.text });
  }
  return unique;
}

function copyrightLines(docs, authors) {
  const found = [];
  for (const doc of docs) {
    for (const line of doc.text.split('\n')) {
      const trimmed = line.trim().replace(/^[#/*\s]+/, '').trim();
      if (!trimmed || trimmed.length > 240) continue;
      if (/^the above copyright/i.test(trimmed)) continue;
      if (/copyright notice and this permission/i.test(trimmed)) continue;
      if (/copyright\s+\[/i.test(trimmed)) continue;
      const notice = /©/.test(trimmed)
        || /\(c\)\s*\d{4}/i.test(trimmed)
        || /\bcopyright\s+(?:\(c\)|\d{4})/i.test(trimmed);
      if (!notice) continue;
      found.push(trimmed);
      if (found.length >= 8) break;
    }
  }
  const unique = [...new Set(found)];
  if (unique.length) return unique;
  const fromAuthors = (authors || []).map((author) => String(author).trim()).filter(Boolean);
  if (fromAuthors.length) return fromAuthors.map((author) => `Copyright ${author}`);
  return ['No copyright line in the upstream licence file.'];
}

function rustSection() {
  const shipped = shippedRustIds();
  const metadata = cargoMetadata();
  const blocks = [];
  for (const { name, version } of shipped) {
    const pkg = metadata.packages.find((item) => item.name === name && item.version === version);
    if (!pkg) throw new Error(`cargo metadata has no ${name}@${version}`);
    const crateDir = dirname(pkg.manifest_path);
    let docs = licenseDocsIn(crateDir, pkg.license_file || '');
    if (docs.length === 0 && name === 'surfcad-fea') {
      docs = [{ labels: ['LICENSE (repository root)'], text: readText(join(ROOT, 'LICENSE')) }];
    }
    const licence = pkg.license || 'no licence field';
    if (docs.length === 0 && licence === 'MIT') {
      const holder = mitCopyrightHolder(pkg);
      docs = [{
        labels: ['MIT permission notice (Cargo.toml says MIT; the crate ships no licence file)'],
        text: `${holder}\n\n${bundledText('mit-permission.txt')}`,
      }];
    }
    if (docs.length === 0) throw new Error(`${name}@${version} has no licence file`);
    const lines = [
      `${name} ${version}`,
      `Licence: ${licence}`,
    ];
    if (name === 'surfcad-fea') {
      lines.push('This is the application\'s finite-element solver compiled into the wasm module.');
    }
    lines.push('Copyright:');
    let rights = copyrightLines(docs, pkg.authors);
    if (name === 'surfcad-fea') {
      rights = ['The repository LICENSE file does not name a copyright holder.'];
    }
    for (const line of rights) lines.push(`  ${line}`);
    lines.push('');
    for (const doc of docs) {
      lines.push(`Licence text (${doc.labels.join(', ')}):`);
      lines.push(doc.text);
      lines.push('');
    }
    blocks.push(lines.join('\n').replace(/\s+$/, ''));
  }
  return {
    count: shipped.length,
    text: [
      'Rust crates compiled into the finite-element solver',
      '---------------------------------------------------',
      '',
      `${shipped.length} crates. These are the normal, non-proc-macro dependencies of`,
      'packages/surfcad-fea for target wasm32-unknown-unknown (the crates linked',
      'into packages/surfcad-fea/pkg). Build-time proc-macros, host-only crates,',
      'and dev-dependencies are not in the wasm module and are not listed.',
      'Where a crate is dual-licensed, every upstream licence file is included.',
      'An Apache-2.0 NOTICE file is included when the crate ships one.',
      '',
      blocks.join(`\n\n${RULE}\n\n`),
    ].join('\n'),
  };
}

function packageFromModuleId(id) {
  const clean = String(id).replace(/\0/g, '').split('?')[0].replace(/\\/g, '/');
  const marker = '/node_modules/';
  const at = clean.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = clean.slice(at + marker.length);
  if (!rest || rest.startsWith('.')) return null;
  const parts = rest.split('/');
  if (parts[0].startsWith('@')) {
    if (!parts[1]) return null;
    const name = `${parts[0]}/${parts[1]}`;
    return { name, root: `${clean.slice(0, at)}${marker}${name}` };
  }
  return { name: parts[0], root: `${clean.slice(0, at)}${marker}${parts[0]}` };
}

function jszipMitText(full) {
  const marker = '\nGPL version 3\n';
  const idx = full.indexOf(marker);
  if (idx === -1) throw new Error('jszip licence file has no MIT / GPL split');
  const mit = full.slice(0, idx).replace(/^JSZip is dual licensed\.[\s\S]*?\n\n/, '').trim();
  if (!/MIT License/i.test(mit)) throw new Error('jszip MIT text was not found');
  return mit;
}

function stripJsComment(line) {
  return line.replace(/^\s*\/\/\s?/, '').trimEnd();
}

function jszipSection() {
  const jszipRoot = join(ROOT, 'node_modules/jszip');
  const pakoRoot = join(ROOT, 'node_modules/pako');
  const jszipPkg = JSON.parse(readFileSync(join(jszipRoot, 'package.json'), 'utf8'));
  const pakoPkg = JSON.parse(readFileSync(join(pakoRoot, 'package.json'), 'utf8'));
  const mit = jszipMitText(readText(join(jszipRoot, 'LICENSE.markdown')));
  const pakoMit = readText(join(pakoRoot, 'LICENSE'));
  const zlibLines = readFileSync(join(pakoRoot, 'lib/zlib/inflate.js'), 'utf8')
    .split('\n')
    .slice(2, 20)
    .map(stripJsComment)
    .join('\n')
    .trim();
  return [
    'jszip MIT election',
    '------------------',
    '',
    'jszip is used under the MIT licence, elected from (MIT OR GPL-3.0-or-later).',
    'It comes in via three-3mf-exporter, which depends on jszip. The Vite production',
    'bundle does not import three-3mf-exporter or jszip. backend/services/measurePart.js',
    'imports jszip, so the server-side order measurement path does ship it. The',
    'GPL-3.0-or-later alternative is not used, and no GPL source offer is made for jszip.',
    'pako is jszip\'s dependency and is included here for that path. It is not in the',
    'Vite bundle either.',
    '',
    `jszip@${jszipPkg.version}`,
    'Licence: (MIT OR GPL-3.0-or-later)',
    'Shipped under: MIT (elected)',
    'Copyright:',
    '  Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso',
    '',
    'Licence text (MIT portion of LICENSE.markdown):',
    mit,
    '',
    `pako@${pakoPkg.version}`,
    'Licence: (MIT AND Zlib)',
    'Copyright:',
    '  Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn',
    '  (C) 1995-2013 Jean-loup Gailly and Mark Adler',
    '  (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin',
    '',
    'Licence text (LICENSE, MIT):',
    pakoMit,
    '',
    'Licence text (lib/zlib/inflate.js header, Zlib):',
    zlibLines,
  ].join('\n');
}

async function shippedNpmPackages() {
  const ids = new Set();
  const collector = {
    name: 'shipped-npm-collector',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk' || !item.modules) continue;
        for (const id of Object.keys(item.modules)) ids.add(id);
      }
    },
  };
  const outDir = mkdtempSync(join(tmpdir(), 'surfcad-notices-'));
  try {
    await build(mergeConfig(baseConfig, {
      root: ROOT,
      configFile: false,
      logLevel: 'error',
      mode: 'production',
      plugins: [collector],
      build: {
        outDir,
        emptyOutDir: true,
        reportCompressedSize: false,
      },
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  const byKey = new Map();
  for (const id of ids) {
    const found = packageFromModuleId(id);
    if (!found) continue;
    const pkgPath = join(found.root, 'package.json');
    if (!statSync(pkgPath, { throwIfNoEntry: false })) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const version = String(pkg.version || '');
    const key = `${pkg.name}@${version}`;
    if (!byKey.has(key)) byKey.set(key, { pkg, root: found.root });
  }
  return [...byKey.values()].sort((a, b) => (
    a.pkg.name.localeCompare(b.pkg.name) || String(a.pkg.version).localeCompare(String(b.pkg.version), undefined, { numeric: true })
  ));
}

function npmLicenseExpression(pkg) {
  const { license, licenses } = pkg;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && !Array.isArray(license) && typeof license.type === 'string') {
    return license.type.trim();
  }
  const list = Array.isArray(license) ? license : licenses;
  if (Array.isArray(list) && list.length) {
    const types = list
      .map((entry) => (typeof entry === 'string' ? entry : entry?.type))
      .filter((entry) => typeof entry === 'string' && entry.trim());
    if (types.length) return types.map((entry) => entry.trim()).join(' OR ');
  }
  return '';
}

function npmAuthors(pkg) {
  const authors = [];
  if (typeof pkg.author === 'string') authors.push(pkg.author);
  else if (pkg.author && typeof pkg.author === 'object') {
    authors.push([pkg.author.name, pkg.author.email].filter(Boolean).join(' '));
  }
  if (Array.isArray(pkg.contributors)) {
    for (const contributor of pkg.contributors) {
      if (typeof contributor === 'string') authors.push(contributor);
      else if (contributor && contributor.name) authors.push(contributor.name);
    }
  }
  return authors.filter(Boolean);
}

async function npmSection() {
  const packages = await shippedNpmPackages();
  const blocks = [];
  for (const { pkg, root } of packages) {
    let docs = licenseDocsIn(root, '');
    const expression = npmLicenseExpression(pkg) || 'no licence field';
    const lines = [
      `${pkg.name}@${pkg.version}`,
      `Licence: ${expression}`,
    ];
    if (pkg.name === 'jszip') {
      lines.push('jszip is used under the MIT licence, elected from (MIT OR GPL-3.0-or-later).');
      lines.push('It is pulled in by three-3mf-exporter. The GPL-3.0-or-later alternative is not used,');
      lines.push('and no GPL source offer is made for jszip.');
      docs = docs.map((doc) => ({ ...doc, text: jszipMitText(doc.text) }));
    }
    if (docs.length === 0) throw new Error(`${pkg.name}@${pkg.version} has no licence file in the production bundle`);
    lines.push('Copyright:');
    for (const line of copyrightLines(docs, npmAuthors(pkg))) lines.push(`  ${line}`);
    lines.push('');
    for (const doc of docs) {
      lines.push(`Licence text (${doc.labels.join(', ')}):`);
      lines.push(doc.text);
      lines.push('');
    }
    blocks.push(lines.join('\n').replace(/\s+$/, ''));
  }
  return {
    count: packages.length,
    text: [
      'npm packages included in the production bundle',
      '----------------------------------------------',
      '',
      `${packages.length} packages. The list is the node_modules packages whose modules`,
      'Rollup places in the Vite production bundle (every input in vite.config.js,',
      'including the FEA worker). It is not the devDependency list, and it is not',
      'every package npm installs for production if the bundle never imports it.',
      'jszip is not in this list. Its MIT election is in the previous section.',
      '',
      blocks.join(`\n\n${RULE}\n\n`),
    ].join('\n'),
  };
}

function component(title, rows, docs, extraCopyright = []) {
  const copyright = [...extraCopyright];
  for (const doc of docs) {
    for (const line of copyrightLines([doc], [])) {
      if (line.startsWith('No copyright line')) continue;
      if (!copyright.includes(line)) copyright.push(line);
    }
  }
  if (copyright.length === 0) copyright.push('No copyright line in the upstream licence file.');
  const body = [
    title,
    ...rows,
    'Copyright:',
    ...copyright.map((line) => `  ${line}`),
    '',
  ];
  for (const doc of docs) {
    body.push(`Licence text (${doc.label}):`);
    body.push(doc.text);
    body.push('');
  }
  return body.join('\n').replace(/\s+$/, '');
}

function meshSection() {
  const mpl = bundledText('mesh/mpl-2.0.txt');
  const components = [
    component('fTetWild', [
      'Pin: 8118f810478e0e65a7bf2d8cecdc5e203a876e97',
      'Upstream: https://github.com/wildmeshing/fTetWild',
      'Licence: MPL-2.0',
      'The patched sources are scripts/fea/overlay/Rational.h and scripts/fea/overlay/Logger.cpp,',
      'copied over the upstream files by scripts/fea/build-mesh-wasm.mjs. Other files keep the',
      'copyright lines in their own MPL headers at the pinned commit.',
    ], [{ label: 'LICENSE.MPL2', text: mpl }], [
      'Copyright (C) 2019 Yixin Hu <yixin.hu@nyu.edu> (upstream src/external/Rational.h)',
      'Copyright (C) 2018 Jeremie Dumas <jeremie.dumas@ens-lyon.org> (upstream src/Logger.cpp)',
    ]),
    component('Geogram', [
      'Pin: v1.9.6 (fc3eb9bf44d2ee29686592e3ef5f5f4daeda27f8)',
      'Upstream: https://github.com/BrunoLevy/geogram',
      'Licence: BSD-3-Clause',
    ], [{ label: 'LICENSE', text: bundledText('mesh/geogram-bsd-3-clause.txt') }]),
    component('Geogram / amgcl', [
      'Pin: ab57038d68ee372ed5df280631051b91f17ed2d1 (Geogram submodule)',
      'Upstream: https://github.com/ddemidov/amgcl',
      'Licence: MIT',
      'Header-only, compiled into libgeogram (NL_WITH_AMGCL).',
    ], [{ label: 'LICENSE.md', text: bundledText('mesh/amgcl-mit.txt') }]),
    component('Geogram / libMeshb', [
      'Pin: 952a157c9d516b28cc6c69cd1550c3e48d4792f9 (Geogram submodule)',
      'Upstream: https://github.com/LoicMarechal/libMeshb',
      'Licence: MIT',
      'Compiled into libgeogram.',
    ], [
      { label: 'LICENSE.txt', text: bundledText('mesh/libmeshb-mit.txt') },
      { label: 'copyright.txt', text: bundledText('mesh/libmeshb-copyright.txt') },
    ]),
    component('Geogram / rply', [
      'Pin: 4296cc91b5c8c26d4e7d7aac0cee2b194ffc5800 (Geogram submodule)',
      'Upstream: https://github.com/diegonehab/rply',
      'Licence: MIT',
      'Compiled into libgeogram.',
    ], [{ label: 'LICENSE', text: bundledText('mesh/rply-mit.txt') }]),
    component('Geogram / zlib', [
      'Vendored in the Geogram v1.9.6 tree (src/lib/geogram/third_party/zlib).',
      'Licence: Zlib',
      'Compiled into libgeogram.',
    ], [{ label: 'LICENSE', text: bundledText('mesh/zlib.txt') }]),
    component('Geogram / PoissonRecon', [
      'Vendored in the Geogram v1.9.6 tree.',
      'Upstream project: Screened Poisson Surface Reconstruction, Michael Kazhdan and Matthew Bolitho.',
      'Licence: BSD-3-Clause style',
      'Compiled into libgeogram.',
    ], [{ label: 'LICENSE.txt', text: bundledText('mesh/poissonrecon-bsd.txt') }]),
    component('Geogram / xatlas', [
      'Vendored in the Geogram v1.9.6 tree.',
      'Upstream: https://github.com/jpcy/xatlas (and Thekla atlas, which xatlas derives from).',
      'Licence: MIT',
      'Compiled into libgeogram.',
    ], [{ label: 'xatlas.h licence comments', text: bundledText('mesh/xatlas-mit.txt') }]),
    component('Geogram / stb', [
      'Vendored in the Geogram v1.9.6 tree and compiled via image_serializer_stb.cpp and mesh_CSG.cpp.',
      'Public domain, Sean Barrett.',
      'stb_image v2.28, stb_image_write v1.07, stb_c_lexer v0.12.',
    ], [{ label: 'public-domain dedications', text: bundledText('mesh/stb-public-domain.txt') }], [
      'Public domain, Sean Barrett (stb_image v2.28, stb_image_write v1.07, stb_c_lexer v0.12).',
    ]),
    component('libigl', [
      'Pin: v2.6.0 (40e7900ccbd767f1f360e0eb10f0f1a6432e0993)',
      'Upstream: https://github.com/libigl/libigl',
      'Licence: MPL-2.0',
      'Core and predicates only. Copyleft and restricted modules are not compiled.',
      'File headers name the author of each file. One representative line is below.',
    ], [{ label: 'LICENSE.MPL2', text: mpl }], [
      'Copyright (C) 2015 Alec Jacobson <alecjacobson@gmail.com> (include/igl/AABB.h; other files name their authors)',
    ]),
    component('Shewchuk predicates', [
      'Pin: decb7bc1260e689cbe008109e3cc5d3a5a433aea',
      'Upstream: https://github.com/libigl/libigl-predicates',
      'Fetched by libigl v2.6.0 (cmake/recipes/external/predicates.cmake).',
      'Licence: public domain',
    ], [{ label: 'predicates.c dedication', text: bundledText('mesh/shewchuk-public-domain.txt') }], [
      'Placed in the public domain by Jonathan Richard Shewchuk, 18 May 1996.',
    ]),
    component('Eigen', [
      'Pin: 3.4.0 (3147391d946bb4b6c68edd901f2add6ac1f31f8c)',
      'Upstream: https://gitlab.com/libeigen/eigen',
      'Fetched by libigl v2.6.0 (cmake/recipes/external/eigen.cmake, GIT_TAG tags/3.4.0).',
      'Licence: MPL-2.0 for the subset compiled with EIGEN_MPL2_ONLY.',
      'LGPL headers are not compiled. COPYING.MPL2 at this tag is the text below.',
    ], [{ label: 'COPYING.MPL2', text: mpl }], [
      'Copyright (C) 2008-2015 Gael Guennebaud <gael.guennebaud@inria.fr> (Eigen/src/Core/util/Macros.h)',
      'Copyright (C) 2006-2008 Benoit Jacob <jacob.benoit.1@gmail.com> (Eigen/src/Core/util/Macros.h)',
    ]),
    component('fmt', [
      'Pin: 11.2.0 (40626af88bd7df9a5fb80be7b25ac85b122d6c21)',
      'Upstream: https://github.com/fmtlib/fmt',
      'Licence: MIT',
    ], [{ label: 'LICENSE', text: bundledText('mesh/fmt-mit.txt') }]),
    component('spdlog', [
      'Pin: v1.15.3 (6fa36017cfd5731d617e1a934f0e5ea9c4445b13)',
      'Upstream: https://github.com/gabime/spdlog',
      'Licence: MIT',
      'Built against the external fmt pin above.',
    ], [{ label: 'LICENSE', text: bundledText('mesh/spdlog-mit.txt') }]),
    component('json (jdumas/json)', [
      'Pin: 0901d33bf6e7dfe6f70fd9d142c8f5c6695c6c5b',
      'Upstream: https://github.com/jdumas/json',
      'Licence: MIT',
    ], [{ label: 'LICENSE.MIT', text: bundledText('mesh/json-mit.txt') }]),
    component('libtommath', [
      'Pin: v1.3.0 (95d80fd8229d05dd6cb4ec88bc8d4f5377ff00ef)',
      'Upstream: https://github.com/libtom/libtommath',
      'Licence: Unlicense (public domain)',
      'Used for fTetWild exact rationals in place of GMP.',
    ], [{ label: 'LICENSE', text: bundledText('mesh/libtommath-unlicense.txt') }], [
      'Released into the public domain under the Unlicense (LibTomMath authors).',
    ]),
    component('getRSS.c', [
      'Compiled inside fTetWild (upstream src/external/getRSS.c).',
      'Author: David Robert Nadeau, NadeauSoftware.com',
      'Licence: Creative Commons Attribution 3.0 Unported (CC BY 3.0)',
      'https://creativecommons.org/licenses/by/3.0/',
    ], [
      {
        label: 'attribution in getRSS.c',
        text: [
          'Author:  David Robert Nadeau',
          'Site:    http://NadeauSoftware.com/',
          'License: Creative Commons Attribution 3.0 Unported License',
          '         http://creativecommons.org/licenses/by/3.0/deed.en_US',
        ].join('\n'),
      },
      { label: 'CC-BY-3.0 legal code', text: bundledText('mesh/cc-by-3.0.txt') },
    ], [
      'David Robert Nadeau, NadeauSoftware.com. Creative Commons Attribution 3.0 Unported.',
    ]),
  ];
  return {
    count: components.length,
    text: [
      'Volume mesher',
      '--------------',
      '',
      `${components.length} components compiled into packages/surfcad-mesh/pkg.`,
      'Geogram\'s TetGen, Triangle, and HLBFGS copies are not compiled.',
      'libigl\'s copyleft and restricted modules are not compiled.',
      '',
      components.join(`\n\n${RULE}\n\n`),
    ].join('\n'),
  };
}

function stepSection() {
  const occt = [
    'Open CASCADE Technology (OCCT)',
    `Pin: ${OCCT_PIN.tag} (${OCCT_PIN.commit})`,
    'Upstream: https://github.com/Open-Cascade-SAS/OCCT',
    'Licence: LGPL-2.1-only WITH OCCT-exception-1.0',
    'Compiled without modification. Thirteen toolkits are compiled (TKernel, TKMath, TKG2d,',
    'TKG3d, TKGeomBase, TKBRep, TKGeomAlgo, TKTopAlgo, TKShHealing, TKMesh, TKXSBase, TKDE,',
    'TKDESTEP) and the linker keeps the objects the STEP reader and the mesher reach.',
    'Copyright:',
    '  Copyright (c) OPEN CASCADE SAS, and Matra Datavision for files written before 1999.',
    '  Each source file carries its own notice at the pinned tag.',
    '',
    'Licence text (LICENSE_LGPL_21.txt):',
    bundledText('step/lgpl-2.1.txt'),
    '',
    'Licence text (OCCT_LGPL_EXCEPTION.txt):',
    bundledText('step/occt-lgpl-exception.txt'),
  ].join('\n');
  const components = [
    occt,
    component('surfcad-step wrapper', [
      'Source: packages/surfcad-step/src/api.cpp in this application\'s source repository',
      'Licence: LGPL-2.1-only WITH OCCT-exception-1.0, the same terms as OCCT (texts above).',
      'The C interface around the OCCT STEP reader and mesher. It is the only',
      'application code in surfcad_step.wasm.',
    ], [], ['Copyright (c) 2026 the SurfCAD authors']),
    component('DELABELLA (inside OCCT, BRepMesh)', [
      `OCCT ${OCCT_PIN.tag}: src/ModelingAlgorithms/TKMesh/BRepMesh/delabella.cpp`,
      'Upstream: https://github.com/msokalski/delabella',
      'Licence: MIT',
    ], [{ label: 'delabella.cpp header', text: bundledText('step/delabella-mit.txt') }]),
    component('strtod by David M. Gay (inside OCCT, Standard)', [
      `OCCT ${OCCT_PIN.tag}: src/FoundationClasses/TKernel/Standard/Standard_Strtod.cxx`,
      'Licence: the permission notice in that file (Lucent Technologies).',
    ], [{ label: 'Standard_Strtod.cxx header', text: bundledText('step/strtod-lucent.txt') }]),
    component('Unicode conversion code (inside OCCT, NCollection)', [
      `OCCT ${OCCT_PIN.tag}: src/FoundationClasses/TKernel/NCollection/NCollection_UtfIterator.lxx`,
      'Licence: the Unicode, Inc. notice in that file.',
    ], [{ label: 'NCollection_UtfIterator.lxx notice', text: bundledText('step/unicode-notice.txt') }]),
    component('FlexLexer.h (inside OCCT, FlexLexer)', [
      `OCCT ${OCCT_PIN.tag}: src/FoundationClasses/TKernel/FlexLexer/FlexLexer.h`,
      'Licence: BSD (The Regents of the University of California).',
    ], [{ label: 'FlexLexer.h header', text: bundledText('step/flexlexer-bsd.txt') }]),
    component('Bison parser skeleton (inside OCCT, StepFile)', [
      `OCCT ${OCCT_PIN.tag}: src/DataExchange/TKDESTEP/StepFile/step.tab.cxx and step.tab.hxx`,
      'The STEP parser is Bison output. It is used under the special exception in the',
      'skeleton\'s notice, which lets a work that contains the skeleton be distributed',
      'under terms of its own choice. Here those terms are OCCT\'s. The GNU General',
      'Public License does not apply to this use and its text is not included.',
    ], [{ label: 'step.tab.cxx skeleton notice', text: bundledText('step/bison-skeleton-exception.txt') }]),
  ];
  return {
    count: components.length,
    text: [
      'STEP reader',
      '-----------',
      '',
      `${components.length} components in packages/surfcad-step/pkg (surfcad_step.wasm and its glue).`,
      'This software makes use of Open CASCADE Technology. How to obtain the source and',
      'how to run the application with a modified build are described earlier in this file.',
      '',
      components.join(`\n\n${RULE}\n\n`),
    ].join('\n'),
  };
}

function lgplSourceOffer() {
  return [
    'GNU Lesser General Public License 2.1 — the STEP reader',
    '-------------------------------------------------------',
    '',
    'STEP import uses Open CASCADE Technology (OCCT). OCCT is licensed under the',
    'GNU Lesser General Public License version 2.1 with the Open CASCADE',
    'exception version 1.0. Both texts are in the STEP reader section later in',
    'this file. You may use, study, modify, and replace the library under those',
    'terms.',
    '',
    'OCCT is distributed only inside surfcad_step.wasm. That WebAssembly file',
    'holds OCCT and a small wrapper, and no other part of the application. The',
    'application fetches it by URL when a STEP file is imported and calls the',
    'functions it exports. OCCT is not linked into any other file the',
    'application ships.',
    '',
    'Source',
    '  OCCT',
    '    Upstream: https://github.com/Open-Cascade-SAS/OCCT',
    `    Pinned tag: ${OCCT_PIN.tag}`,
    `    Pinned commit: ${OCCT_PIN.commit}`,
    '    Compiled without modification.',
    '  Wrapper and build files, in this application\'s source repository',
    '  (https://github.com/artur0x0/surfcad):',
    '    packages/surfcad-step/src/api.cpp',
    '      The wrapper. Its header comment documents the exported functions and',
    '      the layout of the result.',
    '    packages/surfcad-step/CMakeLists.txt',
    '      The list of OCCT toolkits that are compiled, and the compile and',
    '      link options.',
    '    scripts/step/build-step-wasm.mjs',
    `      Fetches OCCT at the pin and builds the module with Emscripten ${STEP_EMSDK_VERSION}.`,
    '',
    'Using a modified build',
    '  Run `node scripts/step/build-step-wasm.mjs` in a checkout of the',
    '  repository above, after changing OCCT or the wrapper. It writes',
    '  surfcad_step.wasm and surfcad_step.js to packages/surfcad-step/pkg.',
    '  A build works with the application when it exports surfcad_step_abi',
    '  (returning 1), surfcad_step_mesh, surfcad_step_free, malloc, and free',
    '  as api.cpp declares them. To run the application with your build, serve',
    '  your surfcad_step.wasm in place of the one the application requests, for',
    '  example with the local overrides feature of your browser\'s developer',
    '  tools, or build the application from the repository with your file in',
    '  packages/surfcad-step/pkg.',
  ].join('\n');
}

function emscriptenSection() {
  const pieces = [
    component('Emscripten', [
      'Pin: emsdk 6.0.12, Emscripten tag 6.0.12 (5488e0871d46d19a3209988190fa6a653126256f)',
      'Upstream: https://github.com/emscripten-core/emscripten',
      'Licence: MIT AND University of Illinois/NCSA Open Source License',
      'The shipped surfcad_mesh.js and surfcad_step.js glue is generated from this runtime.',
      'The emcc compiler itself is not shipped. The copyright line points at AUTHORS,',
      'which is included in full.',
    ], [
      { label: 'LICENSE', text: bundledText('emscripten/emscripten-license.txt') },
      { label: 'AUTHORS', text: bundledText('emscripten/emscripten-authors.txt') },
    ]),
    component('musl libc', [
      'Bundled with Emscripten 6.0.12 and statically linked into the mesher and STEP reader wasm.',
      'Upstream COPYRIGHT from that Emscripten tag (system/lib/libc/musl/COPYRIGHT).',
      'Licence: MIT, with the third-party attributions in that file.',
    ], [{ label: 'COPYRIGHT', text: bundledText('emscripten/musl-copyright.txt') }]),
    component('libc++', [
      'LLVM 22.1.8, as updated by Emscripten 6.0.6 and carried in emsdk 6.0.12.',
      'Statically linked into the mesher and STEP reader wasm.',
      'Upstream: https://github.com/llvm/llvm-project/blob/llvmorg-22.1.8/libcxx/LICENSE.TXT',
      'Licence: Apache-2.0 WITH LLVM-exception, plus the legacy terms in that file.',
    ], [{ label: 'libcxx/LICENSE.TXT', text: bundledText('emscripten/libcxx-license.txt') }]),
    component('libc++abi', [
      'LLVM 22.1.8, as updated by Emscripten 6.0.6 and carried in emsdk 6.0.12.',
      'Statically linked into the mesher and STEP reader wasm.',
      'Upstream: https://github.com/llvm/llvm-project/blob/llvmorg-22.1.8/libcxxabi/LICENSE.TXT',
      'Licence: Apache-2.0 WITH LLVM-exception, plus the legacy terms in that file.',
    ], [{ label: 'libcxxabi/LICENSE.TXT', text: bundledText('emscripten/libcxxabi-license.txt') }]),
    component('libunwind', [
      'LLVM 22.1.8, as updated by Emscripten 6.0.3 and carried in emsdk 6.0.12.',
      'Statically linked (the mesher and the STEP reader build with C++ exceptions).',
      'Upstream: https://github.com/llvm/llvm-project/blob/llvmorg-22.1.8/libunwind/LICENSE.TXT',
      'Licence: Apache-2.0 WITH LLVM-exception, plus the legacy terms in that file.',
    ], [{ label: 'libunwind/LICENSE.TXT', text: bundledText('emscripten/libunwind-license.txt') }]),
    component('compiler-rt', [
      'LLVM 22.1.8, as updated by Emscripten 6.0.3 and carried in emsdk 6.0.12.',
      'Statically linked into the mesher and STEP reader wasm.',
      'Upstream: https://github.com/llvm/llvm-project/blob/llvmorg-22.1.8/compiler-rt/LICENSE.TXT',
      'Licence: Apache-2.0 WITH LLVM-exception, plus the legacy terms in that file.',
    ], [{ label: 'compiler-rt/LICENSE.TXT', text: bundledText('emscripten/compiler-rt-license.txt') }]),
  ];
  return {
    count: pieces.length,
    text: [
      'Emscripten runtime linked into the volume mesher and the STEP reader',
      '-------------------------------------------------------------------',
      '',
      `${pieces.length} runtime components. emsdk 6.0.12 links musl, libc++, libc++abi,`,
      'libunwind, and compiler-rt into each wasm, and the JS glue is Emscripten\'s.',
      'Those are distributed with the application, so their notices are included.',
      '',
      pieces.join(`\n\n${RULE}\n\n`),
    ].join('\n'),
  };
}

function sourceOffer() {
  return [
    'Mozilla Public License 2.0 — how to obtain the source',
    '-----------------------------------------------------',
    '',
    'The volume mesher is distributed as WebAssembly (an Executable Form).',
    'fTetWild, libigl, and Eigen are Covered Software under the Mozilla Public',
    'License, v. 2.0. Source Code Form, including modifications, is available',
    'at no charge as follows. The MPL-2.0 text is included with each component',
    'later in this file. It matches the upstream licence file at each pin.',
    '',
    'fTetWild',
    '  Upstream: https://github.com/wildmeshing/fTetWild',
    '  Pinned commit: 8118f810478e0e65a7bf2d8cecdc5e203a876e97',
    '  Modifications in this application\'s source repository:',
    '    scripts/fea/overlay/Rational.h',
    '      Copied over src/external/Rational.h. Exact rationals use libtommath',
    '      instead of GMP.',
    '    scripts/fea/overlay/Logger.cpp',
    '      Copied over src/Logger.cpp. The logger uses spdlog\'s synchronous',
    '      null sink.',
    '    scripts/fea/build-mesh-wasm.mjs',
    '      Patches the pinned fTetWild CMakeLists.txt (C++ standard; the GMP',
    '      find, include, and link are removed) and',
    '      cmake/FloatTetwildDependencies.cmake (Emscripten Geogram platform,',
    '      TetGen, HLBFGS, and FPG forced off, and the OpenMP flag block',
    '      removed). It also patches Geogram\'s Emscripten platform file and',
    '      interval rounding.',
    '  Files that are not in that overlay or patch are the upstream tree at',
    '  the pinned commit.',
    '',
    'libigl',
    '  Upstream: https://github.com/libigl/libigl',
    '  Pinned release: v2.6.0',
    '  Pinned commit: 40e7900ccbd767f1f360e0eb10f0f1a6432e0993',
    '  This build compiles the core module and the predicates module only.',
    '  LIBIGL_COPYLEFT_CORE, LIBIGL_COPYLEFT_CGAL, LIBIGL_COPYLEFT_COMISO,',
    '  LIBIGL_COPYLEFT_TETGEN, LIBIGL_RESTRICTED_MATLAB, LIBIGL_RESTRICTED_MOSEK,',
    '  and LIBIGL_RESTRICTED_TRIANGLE are OFF. No local modifications.',
    '',
    'Eigen',
    '  Upstream: https://gitlab.com/libeigen/eigen',
    '  Pinned tag: 3.4.0',
    '  Pinned commit: 3147391d946bb4b6c68edd901f2add6ac1f31f8c',
    '  Fetched by libigl v2.6.0 (cmake/recipes/external/eigen.cmake).',
    '  Compiled with EIGEN_MPL2_ONLY, so only the MPL-2.0 subset is used.',
    '  LGPL headers are not compiled. No local modifications.',
  ].join('\n');
}

function introduction() {
  return [
    'Third-party notices',
    '====================',
    '',
    'This file is the notice for third-party code distributed with the',
    'application. The production build copies public/ into the site output,',
    'so this file ships. packages/surfcad-mesh/LICENSES.md is a developer note',
    'in the source tree and is not part of the production build. The same is',
    'true of packages/surfcad-step/LICENSES.md.',
    '',
    'This software makes use of Open CASCADE Technology (STEP import), under the',
    'GNU Lesser General Public License 2.1. See the section on that licence below.',
    '',
    'jszip is used under the MIT licence, elected from (MIT OR GPL-3.0-or-later).',
    'It comes in via three-3mf-exporter. The GPL-3.0-or-later alternative is not',
    'used. The MIT text is in the jszip section. The Vite bundle does not import it.',
    '',
  ].join('\n');
}

async function generate() {
  const mesh = meshSection();
  const step = stepSection();
  const emscripten = emscriptenSection();
  const rust = rustSection();
  const npm = await npmSection();
  const text = [
    introduction(),
    sourceOffer(),
    '',
    RULE,
    '',
    lgplSourceOffer(),
    '',
    RULE,
    '',
    mesh.text,
    '',
    RULE,
    '',
    step.text,
    '',
    RULE,
    '',
    emscripten.text,
    '',
    RULE,
    '',
    rust.text,
    '',
    RULE,
    '',
    jszipSection(),
    '',
    RULE,
    '',
    npm.text,
    '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  const notices = text.endsWith('\n') ? text : `${text}\n`;
  return {
    notices,
    counts: {
      mesh: mesh.count,
      step: step.count,
      emscripten: emscripten.count,
      rust: rust.count,
      npm: npm.count,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return import.meta.url === pathToFileURL(arg).href;
}

if (isDirectRun()) {
  const check = process.argv.includes('--check');
  const { notices, counts } = await generate();
  console.log(`notices: mesh ${counts.mesh}, step ${counts.step}, emscripten ${counts.emscripten}, rust ${counts.rust}, npm ${counts.npm}`);
  if (check) {
    const current = readText(OUT);
    const next = notices.replace(/\s+$/, '');
    if (current !== next) {
      const generated = join(tmpdir(), 'THIRD_PARTY_NOTICES.generated.txt');
      writeFileSync(generated, notices);
      spawnSync('diff', ['-u', OUT, generated], { stdio: 'inherit' });
      console.error('public/THIRD_PARTY_NOTICES.txt is stale. Run: node scripts/ci/generate-third-party-notices.mjs');
      process.exit(1);
    }
    console.log('third-party notices are up to date');
  } else {
    writeFileSync(OUT, notices);
    console.log(`wrote ${OUT}`);
  }
}
