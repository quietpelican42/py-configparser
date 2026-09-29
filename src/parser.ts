/**
 * `RawConfigParser` and `ConfigParser`: a port of CPython 3.14's
 * `configparser`. Parsing, DEFAULT inheritance, interpolation, error text and
 * `write()` output follow the Python implementation line by line.
 *
 * Derived from CPython's Lib/configparser.py, Copyright (c) 2001 Python
 * Software Foundation; All Rights Reserved. Distributed under the PSF
 * License Agreement; the full text is in LICENSE-python.
 */
import {
  DuplicateOptionError,
  DuplicateSectionError,
  InvalidWriteError,
  KeyError,
  MissingSectionHeaderError,
  MultilineContinuationError,
  NoOptionError,
  NoSectionError,
  ParsingError,
  UnnamedSectionDisabledError,
} from './errors.ts';
import { Interpolation, type InterpolationParser, type Lookup, BasicInterpolation } from './interpolation.ts';
import { PY_WS, ValueError, isPySpace, pyFloat, pyInt, pyLower, pyReprAny, pyRstrip, pyStr, pyStrip } from './pystr.ts';
import { decodeBytes, readFileBytes, splitLines, universalNewlines } from './io.ts';

export const DEFAULTSECT = 'DEFAULT';

/** The section holding options that appear before any `[header]` (allowUnnamedSection). */
export const UNNAMED_SECTION: unique symbol = Symbol('UNNAMED_SECTION');

export type SectionName = string | typeof UNNAMED_SECTION;
/** An option value. `null` is an option without a value (allowNoValue). */
export type Value = string | null;
type Stored = string | null | string[];
type Entries = Record<string, unknown> | Map<string, unknown>;

export interface GetOptions {
  /** Skip interpolation. */
  raw?: boolean;
  /** Extra name/value pairs that take priority over the section and DEFAULT. */
  vars?: Entries | null;
  /** Returned instead of throwing when the section or option is missing. `undefined` is a valid fallback if the key is present. */
  fallback?: unknown;
}

export interface ItemsOptions {
  raw?: boolean;
  vars?: Entries | null;
}

export interface ParserOptions {
  /** Initial DEFAULT-section values. */
  defaults?: Entries | null;
  /** Accept options without a delimiter; their value is `null`. Default false. */
  allowNoValue?: boolean;
  /** Substrings that separate an option from its value. Default `['=', ':']`. */
  delimiters?: readonly string[];
  /** Prefixes for comment lines (a comment may be indented). Default `['#', ';']`. */
  commentPrefixes?: readonly string[] | null;
  /** Prefixes for comments after a value (must follow whitespace). Default none. */
  inlineCommentPrefixes?: readonly string[] | null;
  /** Reject duplicate sections and options within one source. Default true. */
  strict?: boolean;
  /** Keep blank lines inside multi-line values. Default true. */
  emptyLinesInValues?: boolean;
  /** Name of the special defaults section. Default `'DEFAULT'`. */
  defaultSection?: string;
  /** `null` disables interpolation. Default: `BasicInterpolation` for `ConfigParser`, none for `RawConfigParser`. */
  interpolation?: Interpolation | null;
  /** Named value converters, used through `getConverted(name, ...)`. */
  converters?: Record<string, (value: string | null) => unknown> | null;
  /** Accept options before the first header, in the `UNNAMED_SECTION` section. Default false. */
  allowUnnamedSection?: boolean;
  /** Maps option names on read, get and set. Default lowercases like Python's `str.lower`. */
  optionxform?: ((option: string) => string) | null;
}

export type Converter = (value: string | null) => unknown;

// ---- regular expressions ----------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
}

const WORD = (delim: string) => `(?:(?!${delim})[^${PY_WS}])`;

function optRegex(delim: string, allowNoValue: boolean): RegExp {
  const w = WORD(delim);
  const option = `(?<option>${w}*(?:[${PY_WS}]+${w}+)*)`;
  const src = allowNoValue
    ? `^${option}[${PY_WS}]*(?:(?<vi>${delim})[${PY_WS}]*(?<value>[^\\n]*))?(?=\\n?$)`
    : `^${option}[${PY_WS}]*(?<vi>${delim})[${PY_WS}]*(?<value>[^\\n]*)(?=\\n?$)`;
  return new RegExp(src, 'u');
}

const SECTCRE = /^\[(?<header>[^\n]+)\]/u;

// ---- helpers ----------------------------------------------------------------

function entriesOf(e: Entries): Array<[string, unknown]> {
  return e instanceof Map ? [...e.entries()] : Object.entries(e);
}

class ChainMap implements Lookup {
  private readonly maps: Array<Map<string, Stored>>;
  constructor(...maps: Array<Map<string, Stored>>) {
    this.maps = maps;
  }
  get(key: string): string | null | undefined {
    for (const m of this.maps) {
      if (m.has(key)) return m.get(key) as string | null;
    }
    return undefined;
  }
}

class CommentSpec {
  private readonly pattern: RegExp | null;
  constructor(full: readonly string[], inline: readonly string[]) {
    const parts = [
      ...full.map((p) => `^(${escapeRegex(p)})[^\\n]*`),
      ...inline.map((p) => `(^|[${PY_WS}])(${escapeRegex(p)}[^\\n]*)`),
    ];
    this.pattern = parts.length ? new RegExp(parts.join('|'), 'gu') : null;
  }
  strip(text: string): string {
    return pyRstrip(this.pattern ? text.replace(this.pattern, '') : text);
  }
}

interface ReadState {
  elementsAdded: Set<string>;
  cursect: Map<string, Stored> | null;
  sectname: SectionName | null;
  optname: string | null;
  lineno: number;
  indentLevel: number;
  curIndentLevel: number;
  errors: ParsingError[];
}

const sectionKey = (name: SectionName | null) => (typeof name === 'symbol' ? 'u' : 's' + name);
const optionKey = (name: SectionName | null, option: string) => JSON.stringify([sectionKey(name), option]);

const BOOLEAN_STATES: ReadonlyMap<string, boolean> = new Map([
  ['1', true],
  ['yes', true],
  ['true', true],
  ['on', true],
  ['0', false],
  ['no', false],
  ['false', false],
  ['off', false],
]);

// ---- the parser -------------------------------------------------------------

/** A parser that does not interpolate by default. */
export class RawConfigParser implements InterpolationParser {
  static readonly SECTCRE: RegExp = SECTCRE;
  static readonly OPTCRE: RegExp = optRegex('=|:', false);
  static readonly OPTCRE_NV: RegExp = optRegex('=|:', true);
  static readonly BOOLEAN_STATES: ReadonlyMap<string, boolean> = BOOLEAN_STATES;

  protected _sections = new Map<SectionName, Map<string, Stored>>();
  protected _defaults = new Map<string, Stored>();
  protected _delimiters: string[];
  protected _optcre: RegExp;
  protected _comments: CommentSpec;
  protected _strict: boolean;
  protected _allowNoValue: boolean;
  protected _emptyLinesInValues: boolean;
  protected _allowUnnamedSection: boolean;
  protected _interpolation: Interpolation;
  protected _converters = new Map<string, Converter>();
  protected _xform: ((option: string) => string) | null;
  /** Name of the special defaults section. Assignable, as in Python. */
  defaultSection: string;
  /** Used to match section headers. */
  sectcre: RegExp = RawConfigParser.SECTCRE;
  /** Accepted boolean spellings, keyed by lower-cased text. */
  booleanStates: ReadonlyMap<string, boolean> = BOOLEAN_STATES;

  constructor(options: ParserOptions = {}) {
    const {
      defaults,
      allowNoValue = false,
      delimiters = ['=', ':'],
      commentPrefixes = ['#', ';'],
      inlineCommentPrefixes = null,
      strict = true,
      emptyLinesInValues = true,
      defaultSection = DEFAULTSECT,
      interpolation,
      converters,
      allowUnnamedSection = false,
      optionxform = null,
    } = options;
    this._xform = optionxform;
    this._delimiters = [...delimiters];
    const d = this._delimiters.map(escapeRegex).join('|');
    this._optcre =
      d === '=|:' ? (allowNoValue ? RawConfigParser.OPTCRE_NV : RawConfigParser.OPTCRE) : optRegex(d, allowNoValue);
    this._comments = new CommentSpec(commentPrefixes ?? [], inlineCommentPrefixes ?? []);
    this._strict = strict;
    this._allowNoValue = allowNoValue;
    this._emptyLinesInValues = emptyLinesInValues;
    this.defaultSection = defaultSection;
    this._allowUnnamedSection = allowUnnamedSection;
    let interp: unknown = interpolation;
    if (interp === undefined) interp = this.defaultInterpolation();
    if (interp === null) interp = new Interpolation();
    if (!(interp instanceof Interpolation)) {
      throw new TypeError(
        `interpolation= must be null or an instance of Interpolation; got an object of type ${typeof interp}`,
      );
    }
    this._interpolation = interp;
    this._converters.set('int', pyInt);
    this._converters.set('float', pyFloat);
    this._converters.set('boolean', (v) => this.convertToBoolean(v));
    if (converters) for (const [k, fn] of Object.entries(converters)) this.setConverter(k, fn);
    if (defaults && entriesOf(defaults).length) this.readDefaults(defaults);
  }

  protected defaultInterpolation(): Interpolation {
    return new Interpolation();
  }

  // -- names ------------------------------------------------------------------

  /** Maps an option name. Default is Python's `str.lower`. Override or pass `optionxform` in the options. */
  optionxform(option: string): string {
    return this._xform ? this._xform(option) : pyLower(option);
  }

  // -- mapping-ish accessors ------------------------------------------------

  /** The DEFAULT section's values (the live map). */
  defaults(): Map<string, Value> {
    return this._defaults as Map<string, Value>;
  }

  /** Section names, excluding DEFAULT. Includes `UNNAMED_SECTION` when allowUnnamedSection is set and options were read. */
  sections(): SectionName[] {
    return [...this._sections.keys()];
  }

  addSection(section: SectionName): void {
    if (section === this.defaultSection) throw new ValueError(`Invalid section name: ${pyReprAny(section)}`);
    if (section === UNNAMED_SECTION && !this._allowUnnamedSection) throw new UnnamedSectionDisabledError();
    if (this._sections.has(section)) throw new DuplicateSectionError(section);
    this._sections.set(section, new Map());
  }

  hasSection(section: SectionName): boolean {
    return this._sections.has(section);
  }

  /** Option names of a section, including inherited DEFAULT names. */
  options(section: SectionName): string[] {
    const own = this._sections.get(section);
    if (!own) throw new NoSectionError(section);
    const opts = new Map(own);
    for (const [k, v] of this._defaults) opts.set(k, v);
    return [...opts.keys()];
  }

  /** The options defined in the section itself (no DEFAULT inheritance, no interpolation). */
  rawSection(section: SectionName): ReadonlyMap<string, Value> {
    const own = this._sections.get(section);
    if (!own) throw new NoSectionError(section);
    return own as Map<string, Value>;
  }

  /** A view of one section (or of DEFAULT). */
  section(name: SectionName): SectionProxy {
    if (name !== this.defaultSection && !this.hasSection(name)) throw new KeyError(name);
    return new SectionProxy(this, name);
  }

  hasOption(section: SectionName | null | undefined, option: string): boolean {
    if (section === null || section === undefined || section === '' || section === this.defaultSection) {
      return this._defaults.has(this.optionxform(option));
    }
    const own = this._sections.get(section);
    if (!own) return false;
    const key = this.optionxform(option);
    return own.has(key) || this._defaults.has(key);
  }

  // -- reading ----------------------------------------------------------------

  /**
   * Reads and parses files. Files that cannot be opened are skipped. Returns
   * the paths that were read. Text is decoded, then universal newlines apply
   * (`\r\n` and `\r` become `\n`), as with Python's `open()`. A UTF-8 BOM is
   * kept and causes `MissingSectionHeaderError`; use `'utf-8-sig'` to drop it.
   */
  read(filenames: string | URL | Iterable<string | URL>, options: { encoding?: string } = {}): string[] {
    const list: Array<string | URL> =
      typeof filenames === 'string' || filenames instanceof URL ? [filenames] : [...filenames];
    const readOk: string[] = [];
    for (const filename of list) {
      const bytes = readFileBytes(filename);
      if (bytes === null) continue;
      const name = filename instanceof URL ? decodeURIComponent(filename.pathname) : filename;
      this.readBuffer(bytes, name, options);
      readOk.push(name);
    }
    return readOk;
  }

  /** Decodes `bytes` (default UTF-8, no BOM stripping), applies universal newlines and parses. */
  readBuffer(bytes: Uint8Array, source = '<bytes>', options: { encoding?: string } = {}): void {
    const text = universalNewlines(decodeBytes(bytes, options.encoding));
    this.readLines(splitLines(text), source);
  }

  /**
   * Reads lines from an iterable of strings (each element is one line,
   * normally with its terminator), or from a string split on `\n` only.
   */
  readFile(lines: string | Iterable<string>, source = '<???>'): void {
    this.readLines(typeof lines === 'string' ? splitLines(lines) : lines, source);
  }

  /**
   * Reads configuration text. Lines are split on `\n` only (a lone `\r` is
   * not a line break), like `io.StringIO`. A leading BOM is not removed.
   */
  readString(text: string, source = '<string>'): void {
    this.readLines(splitLines(text), source);
  }

  /** Reads sections from an object of objects (or Maps). Values are converted to strings. */
  readDict(dictionary: Entries | Map<SectionName, Entries>, source = '<dict>'): void {
    const elementsAdded = new Set<string>();
    const entries: Array<[unknown, unknown]> = dictionary instanceof Map ? [...dictionary.entries()] : Object.entries(dictionary);
    for (const [sectionIn, keys] of entries) {
      const section: SectionName = typeof sectionIn === 'symbol' ? (sectionIn as SectionName) : String(sectionIn);
      try {
        this.addSection(section);
      } catch (e) {
        if (e instanceof DuplicateSectionError || e instanceof ValueError) {
          if (this._strict && elementsAdded.has(sectionKey(section))) throw e;
        } else {
          throw e;
        }
      }
      elementsAdded.add(sectionKey(section));
      for (const [k, v] of entriesOf(keys as Entries)) {
        const key = this.optionxform(String(k));
        const value = v === null || v === undefined ? null : pyStr(v);
        if (this._strict && elementsAdded.has(optionKey(section, key))) throw new DuplicateOptionError(section, key, source);
        elementsAdded.add(optionKey(section, key));
        this.set(section, key, value);
      }
    }
  }

  protected readLines(lines: Iterable<string>, fpname: string): void {
    try {
      ParsingError.raiseAll(this.readInner(lines, fpname));
    } finally {
      this.joinMultilineValues();
    }
  }

  protected readInner(lines: Iterable<string>, fpname: string): ParsingError[] {
    const st: ReadState = {
      elementsAdded: new Set(),
      cursect: null,
      sectname: null,
      optname: null,
      lineno: 0,
      indentLevel: 0,
      curIndentLevel: 0,
      errors: [],
    };
    for (const line of lines) {
      st.lineno++;
      const trimmed = pyStrip(line);
      const clean = this._comments.strip(trimmed);
      const hasComments = trimmed !== clean;
      if (!clean) {
        if (this._emptyLinesInValues) {
          // add empty line to the value, but only if there was no comment on the line
          if (!hasComments && st.cursect !== null && st.optname) {
            const cur = st.cursect.get(st.optname);
            if (Array.isArray(cur)) cur.push('');
          }
        } else {
          // empty line marks end of value
          st.indentLevel = Infinity;
        }
        continue;
      }
      let indent = 0;
      while (indent < line.length && isPySpace(line.charCodeAt(indent))) indent++;
      st.curIndentLevel = indent < line.length ? indent : 0;
      if (this.handleContinuationLine(st, line, clean, fpname)) continue;
      this.handleRest(st, line, clean, fpname);
    }
    return st.errors;
  }

  private handleContinuationLine(st: ReadState, line: string, clean: string, fpname: string): boolean {
    const isContinue = st.cursect !== null && !!st.optname && st.curIndentLevel > st.indentLevel;
    if (isContinue) {
      const cur = (st.cursect as Map<string, Stored>).get(st.optname as string);
      if (cur === null) throw new MultilineContinuationError(fpname, st.lineno, line);
      (cur as string[]).push(clean);
    }
    return isContinue;
  }

  private handleRest(st: ReadState, line: string, clean: string, fpname: string): void {
    // a section header or option header?
    if (this._allowUnnamedSection && st.cursect === null) this.handleHeader(st, UNNAMED_SECTION, fpname);
    st.indentLevel = st.curIndentLevel;
    // is it a section header?
    const mo = this.sectcre.exec(clean);
    if (!mo && st.cursect === null) throw new MissingSectionHeaderError(fpname, st.lineno, line);
    if (mo) this.handleHeader(st, (mo.groups as { header: string }).header, fpname);
    else this.handleOption(st, line, clean, fpname);
  }

  private handleHeader(st: ReadState, sectname: SectionName, fpname: string): void {
    st.sectname = sectname;
    const existing = this._sections.get(sectname);
    if (existing) {
      if (this._strict && st.elementsAdded.has(sectionKey(sectname))) {
        throw new DuplicateSectionError(sectname, fpname, st.lineno);
      }
      st.cursect = existing;
      st.elementsAdded.add(sectionKey(sectname));
    } else if (sectname === this.defaultSection) {
      st.cursect = this._defaults;
    } else {
      st.cursect = new Map();
      this._sections.set(sectname, st.cursect);
      st.elementsAdded.add(sectionKey(sectname));
    }
    // So sections can't start with a continuation line
    st.optname = null;
  }

  private handleOption(st: ReadState, line: string, clean: string, fpname: string): void {
    st.indentLevel = st.curIndentLevel;
    const mo = this._optcre.exec(clean);
    if (!mo) {
      // a non-fatal parsing error occurred. set up the exception but keep going.
      // the exception is raised at the end of the source and lists all bogus lines
      st.errors.push(new ParsingError(fpname, st.lineno, line));
      return;
    }
    const g = mo.groups as { option: string; vi?: string; value?: string };
    st.optname = g.option;
    if (!st.optname) st.errors.push(new ParsingError(fpname, st.lineno, line));
    st.optname = this.optionxform(pyRstrip(st.optname));
    if (this._strict && st.elementsAdded.has(optionKey(st.sectname, st.optname))) {
      throw new DuplicateOptionError(st.sectname, st.optname, fpname, st.lineno);
    }
    st.elementsAdded.add(optionKey(st.sectname, st.optname));
    // This check is fine because the regex cannot match if it would set value to null
    if (g.value !== undefined) {
      (st.cursect as Map<string, Stored>).set(st.optname, [pyStrip(g.value)]);
    } else {
      // valueless option handling
      (st.cursect as Map<string, Stored>).set(st.optname, null);
    }
  }

  private joinMultilineValues(): void {
    const all: Array<[SectionName, Map<string, Stored>]> = [[this.defaultSection, this._defaults], ...this._sections];
    for (const [section, options] of all) {
      for (const [name, val0] of options) {
        const val = Array.isArray(val0) ? pyRstrip(val0.join('\n')) : val0;
        options.set(name, this._interpolation.beforeRead(this, section, name, val));
      }
    }
  }

  protected readDefaults(defaults: Entries): void {
    for (const [key, value] of entriesOf(defaults)) {
      this._defaults.set(this.optionxform(key), value === undefined ? null : (value as Value));
    }
  }

  // -- getting ----------------------------------------------------------------

  private unifyValues(section: SectionName, vars: Entries | null | undefined): ChainMap {
    let sectiondict = new Map<string, Stored>();
    const own = this._sections.get(section);
    if (own) sectiondict = own;
    else if (section !== this.defaultSection) throw new NoSectionError(section);
    // Update with the entry specific variables
    const vardict = new Map<string, Stored>();
    if (vars) {
      for (const [key, value] of entriesOf(vars)) {
        vardict.set(this.optionxform(key), value === null || value === undefined ? null : pyStr(value));
      }
    }
    return new ChainMap(vardict, sectiondict, this._defaults);
  }

  /**
   * Gets an option value. The lookup order is `vars`, the section, DEFAULT.
   * Interpolation is applied unless `raw`. Throws `NoSectionError` /
   * `NoOptionError` unless a `fallback` key is present in `options`.
   */
  get(section: SectionName, option: string, options: GetOptions & { fallback: unknown }): Value | unknown;
  get(section: SectionName, option: string, options?: GetOptions): Value;
  get(section: SectionName, option: string, options: GetOptions = {}): unknown {
    const hasFallback = 'fallback' in options;
    const { raw = false, vars, fallback } = options;
    let d: ChainMap;
    try {
      d = this.unifyValues(section, vars);
    } catch (e) {
      if (e instanceof NoSectionError && hasFallback) return fallback;
      throw e;
    }
    const opt = this.optionxform(option);
    const value = d.get(opt);
    if (value === undefined) {
      if (!hasFallback) throw new NoOptionError(opt, section);
      return fallback;
    }
    if (raw || value === null) return value;
    return this._interpolation.beforeGet(this, section, opt, value, d);
  }

  /** Gets a value and converts it with the named converter (`int`, `float`, `boolean` or one from the options). */
  getConverted(name: string, section: SectionName, option: string, options: GetOptions = {}): unknown {
    const conv = this._converters.get(name);
    if (!conv) throw new KeyError(name);
    const { raw, vars } = options;
    try {
      return conv(this.get(section, option, { raw, vars }));
    } catch (e) {
      if ((e instanceof NoSectionError || e instanceof NoOptionError) && 'fallback' in options) return options.fallback;
      throw e;
    }
  }

  /** Like `get`, converted with Python's `int()`. Returns a bigint outside the safe integer range. */
  getInt(section: SectionName, option: string, options: GetOptions = {}): number | bigint {
    return this.getConverted('int', section, option, options) as number | bigint;
  }

  /** Like `get`, converted with Python's `float()`. */
  getFloat(section: SectionName, option: string, options: GetOptions = {}): number {
    return this.getConverted('float', section, option, options) as number;
  }

  /** Like `get`, converted with `booleanStates` (1/yes/true/on, 0/no/false/off, any case). */
  getBoolean(section: SectionName, option: string, options: GetOptions = {}): boolean {
    return this.getConverted('boolean', section, option, options) as boolean;
  }

  /** The converter table (`int`, `float`, `boolean` plus custom ones). */
  get converters(): Map<string, Converter> {
    return this._converters;
  }

  setConverter(name: string, fn: Converter): void {
    if (name === '') throw new ValueError('Incompatible key: cannot use "" as a name');
    this._converters.set(name, fn);
  }

  /** `[name, SectionProxy]` for DEFAULT and every section. */
  items(): Array<[SectionName, SectionProxy]>;
  /** `[option, value]` pairs of one section, with DEFAULT merged in. Interpolated unless `raw`. */
  items(section: SectionName, options?: ItemsOptions): Array<[string, Value]>;
  items(section?: SectionName, options: ItemsOptions = {}): unknown {
    if (section === undefined) {
      return [this.defaultSection, ...this._sections.keys()].map((n) => [n, new SectionProxy(this, n)]);
    }
    const { raw = false, vars } = options;
    const d = new Map<string, Stored>(this._defaults);
    const own = this._sections.get(section);
    if (own) for (const [k, v] of own) d.set(k, v);
    else if (section !== this.defaultSection) throw new NoSectionError(section);
    const origKeys = [...d.keys()];
    // Update with the entry specific variables
    if (vars) {
      for (const [key, value] of entriesOf(vars)) {
        d.set(this.optionxform(key), value === null || value === undefined ? null : pyStr(value));
      }
    }
    const lookup = new Map(d) as Map<string, string | null>;
    return origKeys.map((option) => [
      option,
      raw ? d.get(option) : this._interpolation.beforeGet(this, section, option, d.get(option) as string, lookup),
    ]);
  }

  // -- modifying --------------------------------------------------------------

  /** Sets an option. An empty or missing section name means DEFAULT. */
  set(section: SectionName | null | undefined, option: string, value: Value = null): void {
    if (value) value = this._interpolation.beforeSet(this, section as SectionName, option, value);
    let sectdict: Map<string, Stored>;
    if (section === null || section === undefined || section === '' || section === this.defaultSection) {
      sectdict = this._defaults;
    } else {
      const own = this._sections.get(section);
      if (!own) throw new NoSectionError(section);
      sectdict = own;
    }
    sectdict.set(this.optionxform(option), value);
  }

  removeOption(section: SectionName | null | undefined, option: string): boolean {
    let sectdict: Map<string, Stored>;
    if (section === null || section === undefined || section === '' || section === this.defaultSection) {
      sectdict = this._defaults;
    } else {
      const own = this._sections.get(section);
      if (!own) throw new NoSectionError(section);
      sectdict = own;
    }
    return sectdict.delete(this.optionxform(option));
  }

  removeSection(section: SectionName): boolean {
    return this._sections.delete(section);
  }

  // -- writing ----------------------------------------------------------------

  /**
   * Returns the configuration as INI text, exactly as CPython's `write()`
   * emits it. Comments are not preserved. Throws `InvalidWriteError` for keys
   * that would read back differently.
   */
  write(spaceAroundDelimiters = true): string {
    const d = spaceAroundDelimiters ? ` ${this._delimiters[0]} ` : (this._delimiters[0] as string);
    const out: string[] = [];
    if (this._defaults.size) this.writeSection(out, this.defaultSection, this._defaults, d);
    const unnamed = this._sections.get(UNNAMED_SECTION);
    if (unnamed && unnamed.size) this.writeSection(out, UNNAMED_SECTION, unnamed, d, true);
    for (const [section, items] of this._sections) {
      if (section === UNNAMED_SECTION) continue;
      this.writeSection(out, section, items, d);
    }
    return out.join('');
  }

  private writeSection(out: string[], sectionName: SectionName, items: Map<string, Stored>, delimiter: string, unnamed = false): void {
    if (!unnamed) out.push(`[${String(sectionName)}]\n`);
    for (const [key, value0] of items) {
      this.validateKeyContents(key);
      const value = this._interpolation.beforeWrite(this, sectionName, key, value0 as Value);
      let text: string;
      if (value !== null || !this._allowNoValue) {
        // Convert all possible line-endings into '\n\t'
        text = delimiter + pyStr(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\n', '\n\t');
      } else {
        text = '';
      }
      out.push(`${key}${text}\n`);
    }
    out.push('\n');
  }

  protected validateKeyContents(key: string): void {
    if (this.sectcre.test(key)) throw new InvalidWriteError(`Cannot write key ${key}; begins with section pattern`);
    for (const delim of this._delimiters) {
      if (key.includes(delim)) throw new InvalidWriteError(`Cannot write key ${key}; contains delimiter ${delim}`);
    }
  }

  protected convertToBoolean(value: string | null): boolean {
    if (value === null) throw new TypeError("'NoneType' object has no attribute 'lower'");
    const b = this.booleanStates.get(pyLower(value));
    if (b === undefined) throw new ValueError(`Not a boolean: ${value}`);
    return b;
  }

  protected validateValueTypes(section: unknown, option: unknown, value: unknown): void {
    if (section === UNNAMED_SECTION) {
      if (!this._allowUnnamedSection) throw new UnnamedSectionDisabledError();
    } else if (typeof section !== 'string') {
      throw new TypeError('section names must be strings or UNNAMED_SECTION');
    }
    if (typeof option !== 'string') throw new TypeError('option keys must be strings');
    if (!this._allowNoValue || value) {
      if (typeof value !== 'string') throw new TypeError('option values must be strings');
    }
  }
}

/** A parser that interpolates with `BasicInterpolation` by default and validates values in `set()`. */
export class ConfigParser extends RawConfigParser {
  protected override defaultInterpolation(): Interpolation {
    return new BasicInterpolation();
  }

  override set(section: SectionName | null | undefined, option: string, value: Value = null): void {
    this.validateValueTypes('', option, value);
    super.set(section, option, value);
  }

  override addSection(section: SectionName): void {
    this.validateValueTypes(section, '', '');
    super.addSection(section);
  }

  protected override readDefaults(defaults: Entries): void {
    const hold = this._interpolation;
    try {
      this._interpolation = new Interpolation();
      this.readDict({ [this.defaultSection]: defaults });
    } finally {
      this._interpolation = hold;
    }
  }
}

/** A view of one section of a parser (Python's `SectionProxy`). */
export class SectionProxy {
  readonly parser: RawConfigParser;
  readonly name: SectionName;

  constructor(parser: RawConfigParser, name: SectionName) {
    this.parser = parser;
    this.name = name;
  }

  /** Value of an option, or `fallback` (default `null`) when missing. */
  get(option: string, fallback: unknown = null, options: { raw?: boolean; vars?: Entries | null } = {}): unknown {
    return this.parser.get(this.name, option, { ...options, fallback });
  }

  getConverted(name: string, option: string, fallback: unknown = null, options: { raw?: boolean; vars?: Entries | null } = {}): unknown {
    return this.parser.getConverted(name, this.name, option, { ...options, fallback });
  }

  getInt(option: string, fallback: unknown = null, options = {}): unknown {
    return this.getConverted('int', option, fallback, options);
  }

  getFloat(option: string, fallback: unknown = null, options = {}): unknown {
    return this.getConverted('float', option, fallback, options);
  }

  getBoolean(option: string, fallback: unknown = null, options = {}): unknown {
    return this.getConverted('boolean', option, fallback, options);
  }

  has(option: string): boolean {
    return this.parser.hasOption(this.name, option);
  }

  /** Option names, including those inherited from DEFAULT. */
  keys(): string[] {
    return this.name === this.parser.defaultSection ? [...this.parser.defaults().keys()] : this.parser.options(this.name);
  }

  /** Interpolated value; throws `KeyError` if the option does not exist. */
  getItem(option: string): Value {
    if (!this.has(option)) throw new KeyError(option);
    return this.parser.get(this.name, option);
  }

  set(option: string, value: Value): void {
    (this.parser as ConfigParser).set(this.name, option, value);
  }

  delete(option: string): void {
    if (!(this.has(option) && this.parser.removeOption(this.name, option))) throw new KeyError(option);
  }
}
