/**
 * Regenerates test/fixtures/differential.json.gz: generated cases plus the
 * results CPython produced for them, so `npm test` can replay the comparison
 * without Python. Needs python3 >= 3.14.
 *
 *   node scripts/make-fixture.ts [count=400] [seed=20260929]
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCase } from '../test/support/gen.ts';
import { runOracle } from './diff.ts';
import { runStrOracle } from './diff-str.ts';
import { stringInputs } from '../test/support/strfn.ts';

const count = Number(process.argv[2] ?? 400);
const seed = Number(process.argv[3] ?? 20260929);
const cases = Array.from({ length: count }, (_, i) => generateCase(seed, i));
const results = runOracle(cases, 'fixture');
const strings = stringInputs(seed, 1500);
const str = runStrOracle(strings);
const out = { python: str.python, seed, cases, results, strings, strResults: str.results, cpHash: str.cp_hash };
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'differential.json.gz');
writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(out) + '\n'), { level: 9 }));
console.log(`wrote ${file}: ${count} cases, ${strings.length} strings, python ${str.python}`);
