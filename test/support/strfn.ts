/** JS side of scripts/oracle_str.py: the same per-string results from this library's Python-string helpers. */
import { createHash } from 'node:crypto';
import { pyFloat, pyInt, pyLower, pyRepr, pyStrip } from '../../src/pystr.ts';
import { Rng } from './gen.ts';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function f64hex(v: number): string {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v);
  return Array.from({ length: 8 }, (_, i) => b.getUint8(i).toString(16).padStart(2, '0')).join('');
}

function attempt(fn: (s: string) => number | bigint, s: string, isFloat: boolean): Json {
  try {
    const v = fn(s);
    if (isFloat) return { f: Number.isNaN(v as number) ? 'nan' : f64hex(v as number) };
    return { i: String(v) };
  } catch (e) {
    const err = e as Error;
    return { e: [err.name, err.message] };
  }
}

export function strResult(s: string): Json {
  return {
    repr: pyRepr(s),
    lower: pyLower(s),
    strip: pyStrip(s),
    int: attempt(pyInt, s, false),
    float: attempt(pyFloat, s, true),
  };
}

function sortedJson(v: Json): string {
  if (Array.isArray(v)) return '[' + v.map(sortedJson).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + sortedJson((v as Record<string, Json>)[k] as Json)).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Python `json.dumps(..., separators=(",", ":"), ensure_ascii=True)` for the `{"i"|"f"|"e": ...}` shapes. */
function pyJson(v: Json): string {
  return sortedJson(v).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function cpHash(): string {
  const h = createHash('sha256');
  const chunks: string[] = [];
  for (let c = 0; c < 0x110000; c++) {
    const s = String.fromCodePoint(c);
    const lower = Array.from(pyLower(s), (x) => (x.codePointAt(0) as number).toString(16)).join('.');
    const i = attempt(pyInt, '1' + s + '2', false);
    const f = attempt(pyFloat, '1' + s + '.5', true);
    chunks.push(`${c.toString(16)}|${pyRepr(s)}|${lower}|${pyStrip(s) === '' ? 1 : 0}|${pyJson(i)}|${pyJson(f)}\n`);
    if (chunks.length === 4096) {
      h.update(chunks.join(''), 'utf8');
      chunks.length = 0;
    }
  }
  h.update(chunks.join(''), 'utf8');
  return h.digest('hex');
}

const PIECES = [
  '0', '1', '7', '9', '١', '٣', '०', '𝟙', '_', '__', '+', '-', '.', 'e', 'E', ' ', '\t', ' ', '　', '\x1c', 'x', 'inf', 'nan', 'Infinity', '-inf', '+nan', '_5', '5_', '1e5', '.5', '5.',
];
const ALPHABET = [
  'a', 'Z', 'Σ', 'σ', 'ς', 'İ', 'ẞ', 'ǅ', 'Ǆ', 'ß', 'é', 'É', "'", '"', '\\', '\n', '\r', '\t', '\x00', '\x7f', '\x85', '­', '́', '​', '’', '.', ':', ' ',
  '﻿', ' ', '日', '😀', '𝐀', '\ud800', '\udc00', '', '͸', '\u{10ffff}', '\u{e0001}', 'Ⅷ', 'ⓐ', 'ǰ', 'ŉ', 'ΐ', 'ﬃ',
];

export function stringInputs(seed: number, n: number): string[] {
  const r = new Rng(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = 1 + r.int(8);
    const src = i % 2 ? PIECES : ALPHABET;
    let s = '';
    for (let j = 0; j < len; j++) s += r.pick(src);
    if (i % 7 === 0) s = s.repeat(1 + r.int(60));
    out.push(s);
  }
  return out;
}
