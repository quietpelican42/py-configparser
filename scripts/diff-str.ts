/**
 * Differential for the Python string helpers (repr, lower, strip, int, float)
 * against local CPython, over random strings and all 0x110000 code points.
 *
 *   node scripts/diff-str.ts [count=20000] [seed=1]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstDiff } from '../test/support/compare.ts';
import { cpHash, strResult, stringInputs } from '../test/support/strfn.ts';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '.tmp');

export function runStrOracle(strings: string[]): { python: string; cp_hash: string; results: unknown[] } {
  mkdirSync(work, { recursive: true });
  const inFile = join(work, 'strings.json');
  const outFile = join(work, 'strings-out.json');
  writeFileSync(inFile, JSON.stringify(strings));
  const res = spawnSync('python3', [join(here, 'oracle_str.py'), inFile, outFile], { encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error || res.status !== 0) throw new Error(`oracle_str.py failed (status ${res.status}): ${res.error?.message ?? ''}${res.stderr}`);
  const out = JSON.parse(readFileSync(outFile, 'utf8'));
  rmSync(inFile);
  rmSync(outFile);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Number(process.argv[2] ?? 20000);
  const seed = Number(process.argv[3] ?? 1);
  const strings = stringInputs(seed, count);
  const oracle = runStrOracle(strings);
  let bad = 0;
  strings.forEach((s, i) => {
    const d = firstDiff(oracle.results[i], JSON.parse(JSON.stringify(strResult(s))));
    if (d && bad++ < 10) console.log(`MISMATCH ${JSON.stringify(s).slice(0, 120)}: ${d}`);
  });
  const mine = cpHash();
  const hashOk = mine === oracle.cp_hash;
  console.log(`${count} strings, ${bad} mismatches; all-code-point digest ${hashOk ? 'equal' : `DIFFERS (${mine} vs ${oracle.cp_hash})`} (python ${oracle.python})`);
  process.exit(bad || !hashOk ? 1 : 0);
}
