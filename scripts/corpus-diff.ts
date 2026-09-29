/**
 * Differential over a corpus of real config files, in setuptools, tox and
 * flake8 (raw) modes, each also read from bytes with utf-8 and utf-8-sig.
 *
 *   node scripts/corpus-diff.ts corpus.json
 *
 * `corpus.json` is a list of `{ "id": string, "text": string }`. The real-world
 * corpus used for the README numbers is third-party data and is not in this
 * repository; any list of files works.
 */
import { readFileSync, existsSync } from 'node:fs';
import { firstDiff } from '../test/support/compare.ts';
import { probe, type Case } from '../test/support/probe.ts';
import { runOracle } from './diff.ts';

const path = process.argv[2];
if (!path || !existsSync(path)) {
  console.error('usage: node scripts/corpus-diff.ts corpus.json   (list of {id, text}); file not found: ' + path);
  process.exit(2);
}
const files = JSON.parse(readFileSync(path, 'utf8')) as Array<{ id: string; text: string }>;
const modes: Array<[string, Pick<Case, 'cls' | 'opts' | 'xform'>]> = [
  ['setuptools', { cls: 'config', opts: {}, xform: 'str' }],
  ['tox', { cls: 'config', opts: { interpolation: 'none' }, xform: 'lower' }],
  ['flake8', { cls: 'raw', opts: {}, xform: 'lower' }],
  ['extended', { cls: 'config', opts: { interpolation: 'extended', strict: false }, xform: 'lower' }],
];
const cases: Case[] = [];
for (const f of files) {
  for (const [mode, m] of modes) {
    cases.push({ id: `${f.id}|${mode}`, ...m, sources: [{ kind: 'string', text: f.text, source: f.id }] });
  }
  const b64 = Buffer.from(f.text, 'utf8').toString('base64');
  cases.push({ id: `${f.id}|bytes-utf8`, cls: 'config', opts: {}, xform: 'str', sources: [{ kind: 'bytes', b64, encoding: 'utf-8', source: f.id }] });
  cases.push({ id: `${f.id}|bytes-sig`, cls: 'config', opts: {}, xform: 'str', sources: [{ kind: 'bytes', b64, encoding: 'utf-8-sig', source: f.id }] });
}
let bad = 0;
let errored = 0;
const chunk = 200;
for (let i = 0; i < cases.length; i += chunk) {
  const part = cases.slice(i, i + chunk);
  const results = runOracle(part, 'corpus');
  for (const c of part) {
    const exp = results[c.id] as { reads: unknown[] };
    if (exp.reads.some(Boolean)) errored++;
    const d = firstDiff(exp, JSON.parse(JSON.stringify(probe(c))));
    if (d) {
      bad++;
      if (bad <= 10) console.log(`MISMATCH ${c.id}: ${d}`);
    }
  }
}
console.log(`${files.length} files x ${modes.length + 2} configurations = ${cases.length} cases; CPython raised on ${errored}; ${bad} mismatches`);
process.exit(bad ? 1 : 0);
