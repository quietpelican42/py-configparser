/**
 * How closely do INI parsers on npm match CPython's configparser?
 *
 *   node bench/incumbents.ts corpus.json [dir-with-node_modules]
 *
 * `corpus.json` is a list of `{ id, text }`. The expected result for each file
 * is CPython 3.14 `ConfigParser` read with `read_string` and case-preserving
 * keys: `{ section: { key: raw value } }`, plus a `DEFAULT` entry when it is
 * non-empty. A parser scores when its output equals that exactly; a file
 * CPython rejects scores when the parser also throws.
 *
 * Incumbents are loaded from the node_modules of the second argument (install
 * ini, config-ini-parser, configparser, ini-simple-parser, js-ini, multi-ini
 * there first). This library is always included.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigParser } from '../src/index.ts';
import { runOracle } from '../scripts/diff.ts';
import type { Case } from '../test/support/probe.ts';

type Obj = Record<string, Record<string, unknown>>;
const corpusPath = process.argv[2];
if (!corpusPath) {
  console.error('usage: node bench/incumbents.ts corpus.json [dir-with-node_modules]');
  process.exit(2);
}
const files = JSON.parse(readFileSync(corpusPath, 'utf8')) as Array<{ id: string; text: string }>;
const req = createRequire(resolve(process.argv[3] ?? '.') + '/');
const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'bench');
mkdirSync(scratch, { recursive: true });

const libs: Record<string, (text: string) => Obj> = {};
const tryLoad = (name: string, make: () => (text: string) => Obj) => {
  try {
    libs[name] = make();
  } catch (e) {
    console.error(`(not installed or unusable: ${name}: ${(e as Error).message.split('\n')[0]})`);
  }
};
tryLoad('ini', () => {
  const ini = req('ini');
  return (t) => ini.parse(t);
});
tryLoad('config-ini-parser', () => {
  const { ConfigIniParser } = req('config-ini-parser');
  return (t) => {
    const p = new ConfigIniParser('\n');
    p.parse(t);
    return Object.fromEntries(p.sections().map((s: string) => [s, Object.fromEntries(p.items(s))]));
  };
});
tryLoad('configparser', () => {
  const CP = req('configparser');
  return (t) => {
    const f = join(scratch, 'x.cfg');
    writeFileSync(f, t);
    const c = new CP();
    c.read(f);
    return Object.fromEntries(c.sections().map((s: string) => [s, Object.fromEntries(Object.entries(c.items(s)))]));
  };
});
tryLoad('js-ini', () => {
  const m = req('js-ini');
  return (t) => m.parse(t);
});
tryLoad('multi-ini', () => {
  const m = req('multi-ini');
  return (t) => {
    const f = join(scratch, 'y.cfg');
    writeFileSync(f, t);
    return m.read(f, { keep_quotes: true });
  };
});
tryLoad('ini-simple-parser', () => {
  const m = req('ini-simple-parser').default;
  return (t) => m(t);
});
libs['py-configparser'] = (t) => {
  const p = new ConfigParser({ optionxform: (s) => s });
  p.readString(t);
  const out: Obj = {};
  if (p.defaults().size) out.DEFAULT = Object.fromEntries(p.defaults());
  for (const s of p.sections()) out[s as string] = Object.fromEntries(p.rawSection(s));
  return out;
};

const cases: Case[] = files.map((f) => ({ id: f.id, cls: 'config', opts: {}, xform: 'str', sources: [{ kind: 'string', text: f.text }] }));
const oracle: Record<string, { reads: unknown[]; state: { defaults: Array<[string, unknown]>; raw: Array<[string, Array<[string, unknown]>]> } }> = {};
for (let i = 0; i < cases.length; i += 200) Object.assign(oracle, runOracle(cases.slice(i, i + 200), 'bench'));

const total = files.length;
let rejects = 0;
for (const f of files) if (oracle[f.id]?.reads[0]) rejects++;
console.log(`${total} files: CPython accepts ${total - rejects}, rejects ${rejects}`);
console.log(`${'parser'.padEnd(20)} exact match (accepted files)   errors raised on rejected files`);
for (const [name, fn] of Object.entries(libs)) {
  let ok = 0;
  let rejOk = 0;
  for (const f of files) {
    const o = oracle[f.id];
    if (!o) continue;
    let got: Obj | null = null;
    try {
      got = fn(f.text);
    } catch {
      got = null;
    }
    if (o.reads[0]) {
      if (got === null) rejOk++;
      continue;
    }
    const exp: Obj = {};
    if (o.state.defaults.length) exp.DEFAULT = Object.fromEntries(o.state.defaults);
    for (const [s, kv] of o.state.raw) exp[s] = Object.fromEntries(kv);
    if (got !== null && JSON.stringify(canon(got)) === JSON.stringify(canon(exp))) ok++;
  }
  const acc = total - rejects;
  console.log(`${name.padEnd(20)} ${String(ok).padStart(4)}/${acc} = ${((100 * ok) / acc).toFixed(1).padStart(5)}%      ${rejOk}/${rejects}`);
}
rmSync(scratch, { recursive: true, force: true });

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)]));
  }
  return v;
}
