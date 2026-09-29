/**
 * Runs one differential case against this library and produces the same
 * snapshot scripts/oracle.py produces from CPython. See that file for what is
 * probed. Case schema:
 *
 *   { id, cls: 'config' | 'raw',
 *     opts: { defaults?, allow_no_value?, delimiters?, comment_prefixes?, inline_comment_prefixes?,
 *             strict?, empty_lines_in_values?, default_section?, allow_unnamed_section?,
 *             interpolation?: 'basic' | 'extended' | 'none' | 'default' },
 *     xform: 'lower' | 'str',
 *     sources: ({ kind: 'string', text, source? } | { kind: 'bytes', b64, encoding, source? })[],
 *     vars?: Record<string, string | null>,
 *     ops?: unknown[][] }
 */
import {
  BasicInterpolation,
  ConfigParser,
  ExtendedInterpolation,
  RawConfigParser,
  UNNAMED_SECTION,
  type ParserOptions,
  type SectionName,
} from '../../src/index.ts';

export const UNNAMED = '\u0000<UNNAMED_SECTION>';

export interface Case {
  id: string;
  cls: 'config' | 'raw';
  opts: {
    defaults?: Record<string, string | null>;
    allow_no_value?: boolean;
    delimiters?: string[];
    comment_prefixes?: string[] | null;
    inline_comment_prefixes?: string[] | null;
    strict?: boolean;
    empty_lines_in_values?: boolean;
    default_section?: string;
    allow_unnamed_section?: boolean;
    interpolation?: 'basic' | 'extended' | 'none' | 'default';
  };
  xform: 'lower' | 'str';
  sources: Array<
    | { kind: 'string'; text: string; source?: string }
    | { kind: 'bytes'; b64: string; encoding: string; source?: string }
  >;
  vars?: Record<string, string | null>;
  ops?: unknown[][];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const tag = (s: unknown): unknown => (s === UNNAMED_SECTION ? UNNAMED : s);
const untag = (s: unknown): unknown => (s === UNNAMED ? UNNAMED_SECTION : s);

function err(e: unknown): Json {
  const x = e as Record<string, unknown> & { name: string; message: string };
  const attrs: Record<string, Json> = {};
  for (const name of ['section', 'option', 'source', 'lineno', 'line', 'reference']) {
    if (x[name] !== undefined && x[name] !== null) attrs[name] = (name === 'section' ? tag(x[name]) : x[name]) as Json;
  }
  if (x.name === 'ParsingError') attrs.errors = (x.errors as Array<[number, string]>).map(([n, l]) => [n, l]);
  return { cls: x.name, msg: x.message, attrs };
}

function f64hex(v: number): string {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, v);
  let out = '';
  for (let i = 0; i < 8; i++) out += b.getUint8(i).toString(16).padStart(2, '0');
  return out;
}

function enc(v: unknown): Json {
  if (v === null || typeof v === 'string') return v;
  if (typeof v === 'boolean') return { b: v };
  if (typeof v === 'bigint') return { i: v.toString() };
  if (typeof v === 'number') return Number.isInteger(v) && !Object.is(v, -0) ? { i: String(BigInt(v)) } : Number.isNaN(v) ? { f: 'nan' } : { f: f64hex(v) };
  if (Array.isArray(v)) return v.map(enc);
  throw new TypeError(`cannot encode ${typeof v}`);
}

function run(fn: () => unknown, floatContext = false): Json {
  try {
    const v = fn();
    // getfloat returns a JS number that may be integral (1.0): tag as float explicitly
    return { v: floatContext && typeof v === 'number' ? (Number.isNaN(v) ? { f: 'nan' } : { f: f64hex(v) }) : enc(v) };
  } catch (e) {
    return { e: err(e) };
  }
}

function make(c: Case): RawConfigParser {
  const o = c.opts;
  const p: ParserOptions = {};
  if ('defaults' in o) p.defaults = o.defaults ?? null;
  if ('allow_no_value' in o) p.allowNoValue = o.allow_no_value;
  if ('delimiters' in o) p.delimiters = o.delimiters;
  if ('comment_prefixes' in o) p.commentPrefixes = o.comment_prefixes;
  if ('inline_comment_prefixes' in o) p.inlineCommentPrefixes = o.inline_comment_prefixes;
  if ('strict' in o) p.strict = o.strict;
  if ('empty_lines_in_values' in o) p.emptyLinesInValues = o.empty_lines_in_values;
  if ('default_section' in o) p.defaultSection = o.default_section;
  if ('allow_unnamed_section' in o) p.allowUnnamedSection = o.allow_unnamed_section;
  const interp = o.interpolation ?? 'default';
  if (interp === 'basic') p.interpolation = new BasicInterpolation();
  else if (interp === 'extended') p.interpolation = new ExtendedInterpolation();
  else if (interp === 'none') p.interpolation = null;
  if (c.xform === 'str') p.optionxform = (s) => s;
  return c.cls === 'config' ? new ConfigParser(p) : new RawConfigParser(p);
}

function readSource(p: RawConfigParser, s: Case['sources'][number]): void {
  if (s.kind === 'string') p.readString(s.text, s.source ?? '<string>');
  else p.readBuffer(Buffer.from(s.b64, 'base64'), s.source ?? 'x.cfg', { encoding: s.encoding });
}

function applyOp(p: RawConfigParser, op: unknown[]): void {
  const [kind, ...a] = op.map((x) => (typeof x === 'string' ? untag(x) : x));
  switch (kind) {
    case 'add_section':
      return p.addSection(a[0] as SectionName);
    case 'set':
      return p.set(a[0] as SectionName, a[1] as string, a[2] as string | null);
    case 'remove_option':
      p.removeOption(a[0] as SectionName, a[1] as string);
      return;
    case 'remove_section':
      p.removeSection(a[0] as SectionName);
      return;
    case 'read_dict':
      return p.readDict(a[0] as Record<string, Record<string, string | null>>);
    default:
      throw new Error(`unknown op ${String(kind)}`);
  }
}

function state(p: RawConfigParser, c: Case): Json {
  const vars = c.vars && Object.keys(c.vars).length ? c.vars : null;
  const st: Record<string, Json> = {
    sections: p.sections().map((s) => tag(s) as string),
    defaults: [...p.defaults()].map(([k, v]) => [k, v]),
    raw: p.sections().map((s) => [tag(s) as string, [...p.rawSection(s)].map(([k, v]) => [k, v])]),
  };
  const names: SectionName[] = [p.defaultSection, ...p.sections()];
  const probes: Json[] = [];
  for (const s of names) {
    const entry: Record<string, Json> = { s: tag(s) as string };
    entry.options = run(() => p.options(s));
    entry.items = run(() => p.items(s).map(([k, v]) => [k, v]));
    entry.items_raw = run(() => p.items(s, { raw: true }).map(([k, v]) => [k, v]));
    entry.items_vars = run(() => p.items(s, { vars }).map(([k, v]) => [k, v]));
    const optnames = s === p.defaultSection ? [...p.defaults().keys()] : p.options(s);
    entry.opts = optnames.map((o) => [
      o,
      {
        get: run(() => p.get(s, o)),
        raw: run(() => p.get(s, o, { raw: true })),
        vars: run(() => p.get(s, o, { vars })),
        int: run(() => p.getInt(s, o)),
        float: run(() => p.getFloat(s, o), true),
        bool: run(() => p.getBoolean(s, o)),
        has: p.hasOption(s, o),
        has_up: p.hasOption(s, o.toUpperCase()),
      },
    ]);
    entry.missing = run(() => p.get(s, '__missing__'));
    entry.fallback = run(() => p.get(s, '__missing__', { fallback: 'FB' }));
    entry.has_missing = p.hasOption(s, '__missing__');
    probes.push(entry);
  }
  st.probes = probes;
  st.nosec = run(() => p.get('__nosec__', 'a'));
  st.nosec_fb = run(() => p.get('__nosec__', 'a', { fallback: null }));
  st.has_section = [p.hasSection('a'), p.hasSection(p.defaultSection), p.hasSection('__nosec__')];
  st.has_option_none = [p.hasOption(null, 'a'), p.hasOption('', 'a')];
  st.items_names = run(() => p.items().map(([k]) => tag(k) as string));
  st.write = run(() => p.write(true));
  st.write_nospace = run(() => p.write(false));
  return st;
}

/** The snapshot for one case, in the same shape as the oracle's. */
export function probe(c: Case): Json {
  const out: { ctor: Json; reads: Json[]; ops: Json[]; state: Json } = { ctor: null, reads: [], ops: [], state: null };
  let p: RawConfigParser;
  try {
    p = make(c);
  } catch (e) {
    out.ctor = err(e);
    return out;
  }
  for (const s of c.sources) {
    try {
      readSource(p, s);
      out.reads.push(null);
    } catch (e) {
      out.reads.push(err(e));
    }
  }
  for (const op of c.ops ?? []) {
    try {
      applyOp(p, op);
      out.ops.push(null);
    } catch (e) {
      out.ops.push(err(e));
    }
  }
  out.state = state(p, c);
  return out;
}
