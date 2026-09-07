// The command line and the window, kept honest about each other.
//
// Thirty-two flags and a window that reached ten of them, with nothing saying
// which of the other twenty-two were decisions. These tests make the answer
// compulsory: a flag added without an entry fails the build, and so does an
// entry claiming the window sends something the worker never reads.
//
// "The window" used to be a native shell. It is now the page `--serve` serves,
// which is what those shells were always drawing anyway — so the contract in
// src/options.mjs survived them unchanged, and only the file these tests read
// it against had to move: `worker/index.mjs` instead of `CrawlSettings.swift`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OPTIONS, runParameters, notInApp } from '../src/options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every flag `bin/seo-audit.mjs` actually parses. */
const parsedFlags = () =>
  new Set([...read('bin/seo-audit.mjs').matchAll(/arg === '(--[a-z-]+)'/g)].map((m) => m[1]));

/** Every query parameter name the worker reads, whatever the receiver is called.
 *
 *  `.get(` rather than `searchParams.get(`, and that is the whole point of the
 *  looser pattern: half the run parameters are read inside helpers —
 *  `psiOptions()`, `hostOptions()`, `searchConsoleProperty()`, `agentFor()` —
 *  which take the searchParams under another name. Matching the qualified form
 *  missed eight of the sixteen and called them broken. */
const workerParameters = () =>
  new Set([...read('worker/index.mjs').matchAll(/\.get\('([a-zA-Z-]+)'\)/g)].map((m) => m[1]));

/** Names the same `.get(` pattern picks up that are not run parameters, each
 *  one belonging to something else: two request headers, the unlock form's
 *  field, and the parameters of endpoints other than /stream. Listed rather
 *  than pattern-matched, so a new one has to be looked at. */
const NOT_RUN_PARAMETERS = new Set([
  'cookie', 'authorization',           // headers, read off the request
  'token',                             // the unlock form's field
  'url',                               // /stream's target, not a crawl setting
  'since', 'sort', 'dir',              // /reports, listing the kept runs
  'as', 'format',                      // /render and the export endpoints
]);

test('every flag the command line parses has an answer about the window', () => {
  const declared = new Set(OPTIONS.map((o) => o.flag));
  const missing = [...parsedFlags()].filter((flag) => !declared.has(flag));

  assert.deepEqual(missing, [],
    `${missing.join(', ')} is parsed by the CLI and missing from src/options.mjs. Add it with ` +
    'app: true if the window should reach it, or a string saying why it should not. ' +
    '"not yet" is a fine reason; an unrecorded one is not.');
});

test('the table does not describe flags that no longer exist', () => {
  const parsed = parsedFlags();
  const stale = OPTIONS.map((o) => o.flag).filter((flag) => !parsed.has(flag));
  assert.deepEqual(stale, [], `${stale.join(', ')} is in src/options.mjs and the CLI does not parse it`);
});

test('a flag the table says the window sends, the worker reads', () => {
  const seen = workerParameters();
  const claimed = runParameters();
  assert.ok(claimed.length > 0, 'the table should describe some run parameters');

  const broken = claimed.filter((o) => !seen.has(o.query));
  assert.deepEqual(broken.map((o) => o.flag), [],
    `src/options.mjs says the page sends ${broken.map((o) => o.query).join(', ')} and ` +
    'worker/index.mjs never reads it. Wire it up, or change the entry to say why it does not.');
});

test('a parameter the worker reads is one the table knows about', () => {
  // The other direction, and the one that catches the worst of the four
  // failures: a control the page draws for a parameter no flag corresponds to
  // is a setting that quietly does nothing.
  //
  // Not circular. `formFields()` is generated *from* this table, so comparing
  // the two would prove nothing; `worker/index.mjs` is written separately by
  // hand, which is what makes it worth reading.
  const known = new Set(OPTIONS.map((o) => o.query).filter(Boolean));
  const orphans = [...workerParameters()]
    .filter((name) => !known.has(name) && !NOT_RUN_PARAMETERS.has(name));
  assert.deepEqual(orphans, [],
    `the worker reads ${orphans.join(', ')}, which no flag in src/options.mjs corresponds to. ` +
    'Add the flag, or add the name to NOT_RUN_PARAMETERS with a note saying what it belongs to.');
});


// The version used to live in four files, because the bundled shells carried
// their own and refused to start when theirs and the engine's disagreed. There
// is one now, and the release workflow derives the image tags from the git tag
// rather than from any file — so all that is left to check is that the one
// remaining copy is a shape `docker/metadata-action` can read as semver.
test('the version is a plain semver', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/,
    'the release workflow tags images with type=semver, which needs a plain x.y.z');
});

test('a CHANGELOG version says Added or Fixed once, not twice', () => {
  // Entries get inserted by anchoring on a neighbour, and when the anchor is in
  // another section the result is a second heading of the same name. It has
  // happened before three releases in a row and was caught by eye each time;
  // the section becomes the release notes, so the fourth would have shipped.
  const text = read('CHANGELOG.md');
  const versions = [...text.matchAll(/^## \[[^\]]+\].*$/gm)];
  const wrong = [];

  for (const [i, heading] of versions.entries()) {
    const body = text.slice(heading.index, versions[i + 1]?.index ?? text.length);
    const seen = new Map();
    for (const [, kind] of body.matchAll(/^### (\w+)$/gm)) {
      seen.set(kind, (seen.get(kind) ?? 0) + 1);
    }
    for (const [kind, times] of seen) {
      if (times > 1) wrong.push(`${heading[0].trim()} has ${times} "### ${kind}" sections`);
    }
  }

  assert.deepEqual(wrong, [], wrong.join('; '));
});

test('every reason is a sentence somebody can act on', () => {
  for (const { flag, reason } of notInApp()) {
    assert.equal(typeof reason, 'string', `${flag} needs a reason, not ${reason}`);
    assert.ok(reason.length > 12, `${flag}: "${reason}" does not say enough to be a decision`);
  }
});

test('nothing is declared twice', () => {
  const flags = OPTIONS.map((o) => o.flag);
  assert.equal(new Set(flags).size, flags.length, 'a flag appears twice in src/options.mjs');
  const queries = OPTIONS.map((o) => o.query).filter(Boolean);
  assert.equal(new Set(queries).size, queries.length, 'two flags claim the same query parameter');
});

test('no source file is a binary file to git', () => {
  // Three files had a literal NUL byte in them, each used as a separator or a
  // placeholder — correct values, written the wrong way. A raw control byte
  // makes the whole file binary: `grep` skips it and `git diff` refuses to show
  // it, which is how a glob matcher sat in src/config.mjs for months while
  // somebody went looking for one.
  //
  // The value is fine. Write it as an escape.
  const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(mjs|js|json|md|yml|html|css|sh)$/.test(f));

  const offenders = [];
  for (const file of tracked) {
    const bytes = readFileSync(join(root, file));
    for (const byte of bytes) {
      // Everything below space except tab, newline and carriage return.
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
        offenders.push(file);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [],
    `${offenders.join(', ')} contains a raw control byte. Write it as an escape ` +
    '(\\u0000) so the file stays text.');
});

