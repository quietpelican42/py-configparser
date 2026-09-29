/**
 * Differential run against the local CPython (3.14 required).
 *
 *   node scripts/diff.ts [count=10000] [seed=1] [--keep-going]
 *
 * Generates `count` cases in chunks, runs each through scripts/oracle.py and
 * through this library, and compares the snapshots. Exits 1 on any mismatch,
 * 3 if python3 is missing or older than 3.14.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCase } from '../test/support/gen.ts';
import { probe, type Case } from '../test/support/probe.ts';
import { firstDiff } from '../test/support/compare.ts';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '.tmp');

export function runOracle(cases: Case[], tag: string): Record<string, unknown> {
  mkdirSync(work, { recursive: true });
  const inFile = join(work, `cases-${tag}.json`);
  const outFile = join(work, `results-${tag}.json`);
  writeFileSync(inFile, JSON.stringify(cases));
  const res = spawnSync('python3', [join(here, 'oracle.py'), inFile, outFile], { encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (res.error || res.status !== 0) {
    throw new Error(`oracle.py failed (status ${res.status}): ${res.error?.message ?? ''}${res.stderr}`);
  }
  const out = JSON.parse(readFileSync(outFile, 'utf8')) as { python: string; results: Record<string, unknown> };
  rmSync(inFile);
  rmSync(outFile);
  return out.results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const count = Number(args[0] ?? 10000);
  const seed = Number(args[1] ?? 1);
  const keepGoing = process.argv.includes('--keep-going');
  const chunk = 250;
  let bad = 0;
  let done = 0;
  const started = Date.now();
  for (let base = 0; base < count; base += chunk) {
    const cases: Case[] = [];
    for (let i = base; i < Math.min(count, base + chunk); i++) cases.push(generateCase(seed, i));
    let results: Record<string, unknown>;
    try {
      results = runOracle(cases, `${seed}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(3);
    }
    for (const c of cases) {
      const got = JSON.parse(JSON.stringify(probe(c)));
      const d = firstDiff(results[c.id], got);
      if (d) {
        bad++;
        console.log(`MISMATCH ${c.id}: ${d}`);
        if (bad <= 3) console.log(JSON.stringify(c).slice(0, 1500));
        if (!keepGoing && bad >= 5) process.exit(1);
      }
    }
    done += cases.length;
  }
  console.log(`${done} cases, seed ${seed}, ${bad} mismatches, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(bad ? 1 : 0);
}
