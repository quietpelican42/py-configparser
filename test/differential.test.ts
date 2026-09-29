/**
 * Replays test/fixtures/differential.json.gz: generated cases plus the exact
 * results CPython 3.14.7 produced for them (regenerate with `npm run fixture`).
 * Needs no Python. test/live.test.ts runs the same comparison against a local
 * CPython on fresh cases.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { firstDiff } from './support/compare.ts';
import { probe, type Case } from './support/probe.ts';
import { cpHash, strResult } from './support/strfn.ts';

interface Fixture {
  python: string;
  seed: number;
  cases: Case[];
  results: Record<string, unknown>;
  strings: string[];
  strResults: unknown[];
  cpHash: string;
}

const file = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'differential.json.gz');
const fx = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Fixture;

test(`fixture: ${fx.cases.length} generated cases match CPython ${fx.python}`, () => {
  let bad = 0;
  for (const c of fx.cases) {
    const d = firstDiff(fx.results[c.id], JSON.parse(JSON.stringify(probe(c))));
    if (d) {
      bad++;
      if (bad <= 3) console.error(`${c.id}: ${d}`);
    }
  }
  assert.equal(bad, 0);
});

test('fixture: covers the behaviours it claims to', () => {
  const classes = new Set<string>();
  for (const r of Object.values(fx.results) as Array<{ ctor: { cls: string } | null; reads: Array<{ cls: string } | null> }>) {
    if (r.ctor) classes.add(r.ctor.cls);
    for (const e of r.reads) classes.add(e ? e.cls : 'ok');
  }
  for (const want of ['ok', 'ParsingError', 'MissingSectionHeaderError', 'DuplicateOptionError', 'DuplicateSectionError', 'MultilineContinuationError']) {
    assert.ok(classes.has(want), `fixture has no ${want} case`);
  }
});

test(`fixture: ${fx.strings.length} strings match CPython for repr, lower, strip, int, float`, () => {
  let bad = 0;
  fx.strings.forEach((s, i) => {
    const d = firstDiff(fx.strResults[i], JSON.parse(JSON.stringify(strResult(s))));
    if (d && bad++ < 3) console.error(`${JSON.stringify(s)}: ${d}`);
  });
  assert.equal(bad, 0);
});

test('fixture: all 0x110000 code points behave as in CPython (repr, lower, isspace, int, float)', () => {
  assert.equal(cpHash(), fx.cpHash);
});
