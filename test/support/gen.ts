/**
 * Seeded generator of differential test cases. Deterministic for a given
 * (seed, index): the PRNG is our own (mulberry32), not Python's or Node's.
 *
 * Each case picks a parser profile (class, constructor options, optionxform,
 * interpolation), then emits a file from a line grammar: headers (including
 * DEFAULT, repeated and odd names), options with varied delimiters and
 * spacing, continuation lines at varied indentation, blank and
 * whitespace-only lines, full-line and inline comments, valueless options,
 * malformed lines, interpolation references, booleans/ints/floats, unicode,
 * CRLF/CR line endings and a BOM.
 */
import type { Case } from './probe.ts';

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
  weighted<T>(xs: ReadonlyArray<readonly [number, T]>): T {
    const total = xs.reduce((a, [w]) => a + w, 0);
    let r = this.next() * total;
    for (const [w, v] of xs) {
      r -= w;
      if (r < 0) return v;
    }
    return (xs[xs.length - 1] as readonly [number, T])[1];
  }
}

const SECTION_NAMES = [
  'a', 'b', 'c', 'metadata', 'options', 'tox', 'testenv', 'testenv:py311', 'flake8', 'mypy-foo.*',
  'options.extras_require', 'coverage:run', 'x y', ' padded ', 'é', '日本語', 'a]b', '[nested]', 'with:colon',
  'with=eq', 'p%ct', 'dollar$', 'A', 'B', 'general', 'DEFAULT', 'DEFAULT', 'default', '', ' ', 'a b c', '#hash', ';semi',
];
const OPTION_NAMES = [
  'name', 'version', 'x', 'y', 'z', 'Key', 'MixedCase', 'my key', 'multi  word', 'deps', 'commands', 'description',
  'url', 'path', 'dir', 'base', 'a.b', 'a-b', 'a_b', 'k1', '1', 'é', 'ключ', 'k[]', 'k[0]', 'with#hash', 'semi;colon',
  'a b', 'envlist', 'python_requires', 'install_requires', 'flag', 'enabled', 'count', 'ratio', 'A', 'X', '[bracket', 'tab\tname',
];
const WORDS = [
  'foo', 'bar', 'baz', 'value', 'pytest>=7', 'py311: coverage', 'https://example.com/a?b=c&d=e', '/usr/local/bin', 'C:\\dir',
  '{posargs}', '{envname}', 'a, b, c', '1.2.3', 'x=y', 'k: v', 'quoted "text"', "it's", 'é', 'ñandú', '日本語', 'emoji 😀 x',
  'tab\there', 'a#b', 'a;b', 'a #b', 'a ;b', '#lead', ';lead', '//c', '-- c', '\u00a0nbsp', 'trail\u3000', '\u2028ls', 'nul\u0000x',
  'cr\rmid', 'ff\fmid', 'vt\u000bmid', '\ufeffbom', '[not a section]', '=', ':', '==', '::',
];
const BOOLS = ['yes', 'no', 'true', 'false', 'on', 'off', '1', '0', 'YES', 'False', 'On', ' TRUE ', 'maybe', '', '2', 'ﬀ'];
const NUMS = ['42', '-7', '+3', ' 8 ', '1_000', '1__0', '_1', '1_', '0x10', '007', '١٢٣', '1.5', '-0.0', '.5', '5.', '1e3', '1E-2', 'inf', '-Infinity', 'nan', '1_0.5', '1.5e_1', '9'.repeat(30), '1'.repeat(4400), '1e999', '', 'abc', '1 2'];
const PREFIXES = [['#', ';'], ['#'], [';'], ['//'], ['--', '#'], [], null, ['*'], ['|'], ['('], ['.'], ['\\'], ['['], ['$'], ['^'], ['?'], ['é'], ['😀'], ['#', ''], ['\t']] as const;
const INLINE = [null, ['#'], [';'], ['#', ';'], ['//'], [' ;'], ['*'], ['|'], ['.'], ['\\'], ['$'], ['('], ['é'], ['😀'], ['']] as const;
const DELIMS = [['=', ':'], ['='], [':'], ['=', ':', '=>'], ['::'], ['->', '='], ['='] , ['=', ':'], ['|'], ['$'], ['^'], ['('], ['\\'], ['.'], ['*'], ['?'], [' '], ['\t'], ['#'], ['é'], ['😀'], ['=='], ['['], [']'], ['{'], ['+'], [':', '=', ''], ['a']] as const;

export function generateCase(seed: number, index: number): Case {
  const r = new Rng((seed * 1000003 + index * 7919 + 12345) >>> 0);
  const cls: Case['cls'] = r.chance(0.6) ? 'config' : 'raw';
  const opts: Case['opts'] = {};
  const allowNoValue = r.chance(0.28);
  if (allowNoValue || r.chance(0.1)) opts.allow_no_value = allowNoValue;
  let delims: readonly string[] = ['=', ':'];
  if (r.chance(0.3)) {
    delims = r.pick(DELIMS);
    opts.delimiters = [...delims];
  }
  if (r.chance(0.2)) opts.comment_prefixes = r.pick(PREFIXES) === null ? null : [...(r.pick(PREFIXES) ?? [])];
  const inline = r.chance(0.4) ? r.pick(INLINE) : null;
  if (inline !== null || r.chance(0.05)) opts.inline_comment_prefixes = inline === null ? null : [...inline];
  if (r.chance(0.3)) opts.strict = r.chance(0.2);
  if (r.chance(0.3)) opts.empty_lines_in_values = r.chance(0.3);
  const defaultSection = r.chance(0.12) ? r.pick(['general', 'DFLT', 'default', 'x y']) : 'DEFAULT';
  if (defaultSection !== 'DEFAULT') opts.default_section = defaultSection;
  if (r.chance(0.12)) opts.allow_unnamed_section = true;
  const interpChoices: ReadonlyArray<readonly [number, NonNullable<Case['opts']['interpolation']>]> =
    cls === 'config'
      ? [[45, 'default'], [25, 'basic'], [15, 'extended'], [15, 'none']]
      : [[55, 'default'], [12, 'basic'], [23, 'extended'], [10, 'none']];
  const interp = r.weighted(interpChoices);
  if (interp !== 'default' || r.chance(0.05)) opts.interpolation = interp;
  if (r.chance(0.22)) {
    const d: Record<string, string | null> = {};
    for (let i = 0, n = 1 + r.int(3); i < n; i++) {
      d[r.pick(['x', 'y', 'Base', 'dir', 'A', 'a', 'k1', 'name'])] = r.chance(0.08) && allowNoValue ? null : refValue(r, ['x', 'y', 'dir']);
      if (r.chance(0.03)) d.bad = null;
    }
    opts.defaults = d;
  }
  const xform: Case['xform'] = r.chance(0.3) ? 'str' : 'lower';

  const nSources = r.chance(0.22) ? 2 + r.int(2) : 1;
  const sources: Case['sources'] = [];
  const pool: string[] = [];
  const sectionPool: string[] = [];
  for (let s = 0; s < nSources; s++) {
    const text = generateText(r, { delims, allowNoValue, defaultSection, pool, sectionPool, inline: inline ?? [] });
    if (r.chance(0.18)) {
      const enc = r.pick(['utf-8', 'utf-8-sig', 'latin-1'] as const);
      let t = text;
      if (enc === 'latin-1') t = t.replace(/[^\u0000-\u00ff]/g, '?');
      const bom = r.chance(0.4) ? '\ufeff' : '';
      const bytes = enc === 'latin-1' ? Buffer.from(bom.length ? t : t, 'latin1') : Buffer.from((enc === 'utf-8-sig' ? '' : '') + bom + t, 'utf8');
      const withBom = enc === 'utf-8-sig' && bom ? bytes : bytes;
      sources.push({ kind: 'bytes', b64: withBom.toString('base64'), encoding: enc, source: r.chance(0.5) ? 'setup.cfg' : 'x.cfg' });
    } else {
      sources.push({ kind: 'string', text, ...(r.chance(0.15) ? { source: r.pick(['a.ini', '<memory>', "it's.ini", 'é.cfg']) } : {}) });
    }
  }
  const c: Case = { id: `s${seed}-${index}`, cls, opts, xform, sources };
  if (r.chance(0.3)) {
    const v: Record<string, string | null> = {};
    for (let i = 0, n = 1 + r.int(2); i < n; i++) v[r.pick(['x', 'y', 'Extra', 'dir', ...pool.slice(0, 3)])] = r.chance(0.1) ? null : refValue(r, pool);
    c.vars = v;
  }
  if (r.chance(0.16)) {
    const ops: unknown[][] = [];
    for (let i = 0, n = 1 + r.int(3); i < n; i++) {
      const sec = r.pick([...sectionPool, 'new', '', defaultSection, 'nosuch', 'a']);
      switch (r.int(5)) {
        case 0: ops.push(['add_section', r.pick(['new', 'a', defaultSection, 'b'])]); break;
        case 1: ops.push(['set', sec, r.pick(OPTION_NAMES), r.chance(0.15) ? null : r.chance(0.3) ? refValue(r, pool) : r.pick(['', ' ', 'v', '%bad', '$bad', '%%', '${x}', 'multi\nline', 'cr\r\nlf'])]); break;
        case 2: ops.push(['remove_option', sec, r.pick(pool.length ? pool : ['x'])]); break;
        case 3: ops.push(['remove_section', sec]); break;
        default: ops.push(['read_dict', { [r.pick(['new', 'a', defaultSection])]: { [r.pick(['K', 'k', 'x'])]: r.pick(['1', 'v', '%(x)s', '']), ...(r.chance(0.3) ? { X: 'dup' } : {}) } }]);
      }
    }
    c.ops = ops;
  }
  return c;
}

function refValue(r: Rng, pool: string[]): string {
  const n = pool.length ? r.pick(pool) : 'x';
  return r.pick([
    () => `%(${n})s`, () => `pre %(${n})s post`, () => '%%', () => `%(${n})s/%(${n})s`, () => '100%', () => '%(nosuch)s', () => '%(', () => '%x',
    () => `\${${n}}`, () => `\${a:${n}}`, () => `\${b:${n}} and \${${n}}`, () => '$$', () => '$', () => '${', () => '${nosuch}', () => '${a:b:c}', () => '${nosec:x}',
    () => `%(${n.toUpperCase()})s`, () => `\${${n.toUpperCase()}}`, () => `%(${n} )s`, () => 'plain',
  ])();
}

interface GenCtx {
  delims: readonly string[];
  allowNoValue: boolean;
  defaultSection: string;
  pool: string[];
  sectionPool: string[];
  inline: readonly string[];
}

function generateText(r: Rng, ctx: GenCtx): string {
  const lines: string[] = [];
  const nLines = r.weighted([[15, 2 + r.int(4)], [60, 4 + r.int(12)], [25, 12 + r.int(20)]]);
  const indentStyle = r.weighted([[70, 0], [10, 1], [10, 2], [10, 3]]); // base indent for option lines
  let hasSection = false;
  const sectionsHere: string[] = [];
  const optionsHere = new Map<string, string[]>();
  let cur = '';

  const indent = (n: number) => r.pick([' '.repeat(n), '\t'.repeat(Math.min(n, 2)), ' \t'.repeat(1)].slice(0, r.chance(0.8) ? 1 : 3));
  const delim = () => {
    const d = r.pick(ctx.delims);
    return r.weighted<string>([[40, ` ${d} `], [25, d], [15, `${d} `], [10, ` ${d}`], [5, `${d}\t`], [5, `  ${d}  `]]);
  };
  const commentText = () => r.pick(['comment', 'x = y', '[sec]', '', 'é', ' spaced']);
  const inlineComment = () => (ctx.inline.length && r.chance(0.35) ? r.pick(['  ', ' ', '\t', '']) + r.pick(ctx.inline) + commentText() : r.chance(0.1) ? ' #x' : r.chance(0.05) ? ' ;y' : '');
  const value = (): string => {
    const k = r.weighted<number>([[30, 0], [10, 1], [8, 2], [10, 3], [20, 4], [6, 5], [8, 6], [8, 7]]);
    switch (k) {
      case 0: return r.pick(WORDS);
      case 1: return r.pick(WORDS) + ' ' + r.pick(WORDS);
      case 2: return '';
      case 3: return refValue(r, ctx.pool);
      case 4: return r.pick(BOOLS);
      case 5: return r.pick(NUMS);
      case 6: return r.pick(NUMS);
      default: return r.pick(['  padded  ', '\tlead tab', 'trail \t', '"quoted"', 'a,\nb']);
    }
  };
  const header = () => {
    let name: string;
    if (sectionsHere.length && r.chance(dupChance)) name = r.pick(sectionsHere); // repeat -> duplicate
    else if (r.chance(mode === 'clean' ? 0.08 : 0.15)) name = ctx.defaultSection;
    else if (ctx.sectionPool.length && r.chance(0.2)) name = r.pick(ctx.sectionPool);
    else {
      const names = mode === 'hostile' ? SECTION_NAMES : SECTION_NAMES.filter((x) => x !== '' && !x.includes(']'));
      name = r.pick(names);
      for (let t = 0; t < 8 && (sectionsHere.includes(name) || name === ctx.defaultSection); t++) name = r.pick(names);
    }
    sectionsHere.push(name);
    ctx.sectionPool.push(name);
    hasSection = true;
    cur = name;
    const form = mode === 'clean' ? `[${name}]` : r.weighted<string>([[80, `[${name}]`], [8, `[${name}] ${r.pick(['#c', '; c', 'junk', ''])}`], [4, `  [${name}]`], [4, `[${name}`], [4, `${name}]`]]);
    return form + (r.chance(0.05) ? inlineComment() : '');
  };
  const optionName = () => {
    let n: string;
    const seen = optionsHere.get(cur);
    if (seen && seen.length && r.chance(dupChance)) n = r.pick(seen); // duplicate
    else {
      n = ctx.pool.length && r.chance(0.35) ? r.pick(ctx.pool) : r.pick(OPTION_NAMES);
      for (let t = 0; t < 10 && (seen ?? []).some((x) => x.toLowerCase() === n.toLowerCase()); t++) n = r.pick(OPTION_NAMES);
    }
    if (mode !== 'clean' && r.chance(0.08)) n = r.chance(0.5) ? n.toUpperCase() : n.toLowerCase(); // case-variant duplicate in lower mode
    ctx.pool.push(n);
    if (!optionsHere.has(cur)) optionsHere.set(cur, []);
    optionsHere.get(cur)?.push(n);
    return n;
  };

  const mode = r.weighted<'clean' | 'messy' | 'hostile'>([[45, 'clean'], [35, 'messy'], [20, 'hostile']]);
  const dupChance = mode === 'clean' ? 0 : mode === 'messy' ? 0.04 : 0.12;
  if (mode !== 'hostile' || r.chance(0.5)) lines.push(header());
  for (let i = 0; i < nLines; i++) {
    const k = mode === 'clean'
      ? r.weighted<string>([[10, 'header'], [50, 'option'], [22, 'cont'], [8, 'blank'], [2, 'ws'], [10, 'comment']])
      : mode === 'messy'
        ? r.weighted<string>([[10, 'header'], [44, 'option'], [18, 'cont'], [7, 'blank'], [3, 'ws'], [8, 'comment'], [ctx.allowNoValue ? 6 : 1, 'key-only'], [1, 'garbage'], [1, 'delim-only'], [2, 'lead-indented-comment']])
        : r.weighted<string>([[!hasSection ? 30 : 10, 'header'], [38, 'option'], [16, 'cont'], [7, 'blank'], [3, 'ws'], [8, 'comment'], [4, 'key-only'], [5, 'garbage'], [3, 'delim-only'], [2, 'lead-indented-comment']]);
    switch (k) {
      case 'header': lines.push(header()); break;
      case 'option': {
        if (!hasSection && mode !== 'hostile') lines.push(header());
        const ind = indentStyle ? indent(indentStyle) : '';
        lines.push(ind + optionName() + delim() + value() + inlineComment());
        break;
      }
      case 'cont': {
        const n = 1 + r.int(4);
        lines.push((r.chance(0.85) ? indent(n) : ' '.repeat(n)) + value() + inlineComment());
        break;
      }
      case 'blank': lines.push(''); break;
      case 'ws': lines.push(r.pick([' ', '\t', '   ', ' \t ', '\u00a0', '\u3000', '\x1c', '\x1f', '\x85', '\u2003', '\u200b', '\ufeff', '\x0b', '\x0c'])); break;
      case 'comment': lines.push(r.pick(['', '  ', '\t']) + r.pick(['#', ';', '//', '--', '#!', ';;']) + commentText()); break;
      case 'key-only': lines.push((indentStyle ? indent(indentStyle) : '') + optionName()); break;
      case 'garbage': lines.push(r.pick(['= value', ': value', ' = ', '==', '[', ']', '[]', '[ ]', delim().trim() + 'x', '\u00a0= x', 'a b = c', '=', '::'])); break;
      case 'delim-only': lines.push(optionName() + r.pick(ctx.delims)); break;
      default: lines.push(indent(2) + r.pick(['#', ';']) + commentText());
    }
  }

  const eol = r.weighted<string>([[70, '\n'], [15, '\r\n'], [5, '\r'], [10, 'mix']]);
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const e = eol === 'mix' ? r.pick(['\n', '\r\n']) : eol;
    text += lines[i] + (i === lines.length - 1 && r.chance(0.3) ? '' : e);
  }
  if (r.chance(0.05)) text = '\ufeff' + text;
  if (r.chance(0.05)) text = '\n\n' + text;
  return text;
}
