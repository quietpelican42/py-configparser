/**
 * Live differential against a local CPython 3.14: fresh generated cases each
 * run through both implementations. Skips loudly when python3 is missing or
 * older than 3.14 (semantics differ before 3.14). Set PY_CONFIGPARSER_CASES to
 * change the case count (default 1500) and PY_CONFIGPARSER_SEED for the seed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runOracle } from '../scripts/diff.ts';
import { runStrOracle } from '../scripts/diff-str.ts';
import { firstDiff } from './support/compare.ts';
import { generateCase } from './support/gen.ts';
import { probe } from './support/probe.ts';
import { cpHash, strResult, stringInputs } from './support/strfn.ts';

function pythonVersion(): string | null {
  const r = spawnSync('python3', ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

const version = pythonVersion();
const [major, minor] = (version ?? '0.0').split('.').map(Number) as [number, number];
const usable = version !== null && (major > 3 || (major === 3 && minor >= 14));
const skip = usable ? false : `SKIPPED: live CPython differential needs python3 >= 3.14 on PATH (found ${version ?? 'none'}). Install Python 3.14 to run it.`;
if (!usable) console.warn(`\n*** ${skip}\n`);

test('live: generated cases match CPython', { skip }, () => {
  const count = Number(process.env.PY_CONFIGPARSER_CASES ?? 1500);
  const seed = Number(process.env.PY_CONFIGPARSER_SEED ?? 4242);
  const cases = Array.from({ length: count }, (_, i) => generateCase(seed, i));
  const results = runOracle(cases, 'live');
  let bad = 0;
  for (const c of cases) {
    const d = firstDiff(results[c.id], JSON.parse(JSON.stringify(probe(c))));
    if (d && bad++ < 3) console.error(`${c.id}: ${d}`);
  }
  assert.equal(bad, 0, `${bad} of ${count} cases differ from CPython (seed ${seed})`);
});

test('live: string helpers match CPython', { skip }, () => {
  const strings = stringInputs(Number(process.env.PY_CONFIGPARSER_SEED ?? 4242), 5000);
  const oracle = runStrOracle(strings);
  let bad = 0;
  strings.forEach((s, i) => {
    const d = firstDiff(oracle.results[i], JSON.parse(JSON.stringify(strResult(s))));
    if (d && bad++ < 3) console.error(`${JSON.stringify(s)}: ${d}`);
  });
  assert.equal(bad, 0);
  assert.equal(cpHash(), oracle.cp_hash);
});
