/**
 * Python `str` behaviour that `configparser` depends on: `repr`, `strip`,
 * `lower`, `int()` and `float()`. The Unicode-dependent parts use tables
 * generated from CPython (see scripts/gen-unicode.py), not the JS runtime's
 * Unicode database, which is a different version.
 */
import { DIGIT_ZEROS, LOWER, NONPRINTABLE } from './unicode-data.ts';

/** Body of a regex character class matching Python's `\s` / `str.isspace`. */
export const PY_WS = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

/** `str.isspace()` for one UTF-16 code unit (every Python space is in the BMP). */
export function isPySpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    (code >= 0x1c && code <= 0x20) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

export function pyStrip(s: string): string {
  return pyRstrip(pyLstrip(s));
}

export function pyLstrip(s: string): string {
  let i = 0;
  while (i < s.length && isPySpace(s.charCodeAt(i))) i++;
  return i === 0 ? s : s.slice(i);
}

export function pyRstrip(s: string): string {
  let j = s.length;
  while (j > 0 && isPySpace(s.charCodeAt(j - 1))) j--;
  return j === s.length ? s : s.slice(0, j);
}

// ---- Unicode tables -------------------------------------------------------

let nonPrintable: number[] | undefined;
function nonPrintableRanges(): number[] {
  if (nonPrintable) return nonPrintable;
  const out: number[] = [];
  let lastEnd = 0;
  for (const item of NONPRINTABLE.split(',')) {
    const [gap, len] = item.split('.') as [string, string];
    const start = lastEnd + parseInt(gap, 36);
    const end = start + parseInt(len, 36);
    out.push(start, end);
    lastEnd = end;
  }
  nonPrintable = out;
  return out;
}

function isPrintable(cp: number): boolean {
  if (cp === 0x20) return true;
  if (cp > 0x20 && cp < 0x7f) return true;
  const r = nonPrintableRanges();
  let lo = 0;
  let hi = r.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = r[mid * 2] as number;
    const e = r[mid * 2 + 1] as number;
    if (cp < s) hi = mid - 1;
    else if (cp > e) lo = mid + 1;
    else return false;
  }
  return true;
}

let digitZeros: number[] | undefined;
function zeros(): number[] {
  return (digitZeros ??= DIGIT_ZEROS.split(',').map((x) => parseInt(x, 36)));
}

/** Decimal value of a Unicode decimal digit (category Nd), or -1. */
function decimalValue(cp: number): number {
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x30;
  if (cp < 0x660) return -1;
  const z = zeros();
  let lo = 0;
  let hi = z.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const zero = z[mid] as number;
    if (cp < zero) hi = mid - 1;
    else if (cp > zero + 9) lo = mid + 1;
    else return cp - zero;
  }
  return -1;
}

let lowerMap: Map<number, string> | undefined;
function lowerTable(): Map<number, string> {
  if (lowerMap) return lowerMap;
  const m = new Map<number, string>();
  let cp = 0;
  for (const item of LOWER.split(',')) {
    const [delta, mapped] = item.split(':') as [string, string];
    cp += parseInt(delta, 36);
    m.set(cp, String.fromCodePoint(...mapped.split('.').map((x) => parseInt(x, 36))));
  }
  lowerMap = m;
  return m;
}

const CASED = /^\p{Cased}$/u;
const CASE_IGNORABLE = /^\p{Case_Ignorable}$/u;

/** Python's `str.lower()` (full case mapping plus the Final_Sigma rule). */
export function pyLower(s: string): string {
  let ascii = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) {
      ascii = false;
      break;
    }
  }
  if (ascii) return s.toLowerCase();
  const table = lowerTable();
  const cps = Array.from(s);
  let out = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i] as string;
    const cp = ch.codePointAt(0) as number;
    if (cp === 0x3a3) {
      out += finalSigma(cps, i) ? 'ς' : 'σ';
    } else {
      out += table.get(cp) ?? ch;
    }
  }
  return out;
}

function finalSigma(cps: string[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && CASE_IGNORABLE.test(cps[j] as string)) j--;
  if (!(j >= 0 && CASED.test(cps[j] as string))) return false;
  j = i + 1;
  while (j < cps.length && CASE_IGNORABLE.test(cps[j] as string)) j++;
  return j === cps.length || !CASED.test(cps[j] as string);
}

// ---- repr -------------------------------------------------------------------

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

/** Python's `repr(str)`. */
export function pyRepr(s: string): string {
  let squote = 0;
  let dquote = 0;
  for (const ch of s) {
    if (ch === "'") squote++;
    else if (ch === '"') dquote++;
  }
  const quote = squote > 0 && dquote === 0 ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + hex(cp, 2);
    else if (cp < 0x7f) out += ch;
    else if (isPrintable(cp)) out += ch;
    else if (cp <= 0xff) out += '\\x' + hex(cp, 2);
    else if (cp <= 0xffff) out += '\\u' + hex(cp, 4);
    else out += '\\U' + hex(cp, 8);
  }
  return out + quote;
}

/** Python's `repr(float)` for finite and non-finite doubles. */
export function pyFloatRepr(n: number): string {
  if (Number.isNaN(n)) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  const [mant, expStr] = Math.abs(n).toExponential().split('e') as [string, string];
  const exp = parseInt(expStr, 10);
  const digits = mant.replace('.', '');
  const sign = n < 0 ? '-' : '';
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    const e = Math.abs(exp).toString().padStart(2, '0');
    return `${sign}${m}e${exp < 0 ? '-' : '+'}${e}`;
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  if (digits.length <= exp + 1) return `${sign}${digits}${'0'.repeat(exp + 1 - digits.length)}.0`;
  return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
}

/** A JS value shown the way Python's `repr()` would show its counterpart. */
export function pyReprAny(v: unknown): string {
  if (typeof v === 'string') return pyRepr(v);
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'symbol') return v.description === 'UNNAMED_SECTION' ? '<UNNAMED_SECTION>' : String(v.description);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v).toString() : pyFloatRepr(v);
  return String(v);
}

/** Python's `str(value)` for the value types this library accepts. */
export function pyStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'symbol') return pyReprAny(v);
  return pyReprAny(v);
}

// ---- int() / float() ------------------------------------------------------

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}

/** Replaces Unicode decimal digits with ASCII digits; returns null on other input. */
function digitsPart(s: string): string | null {
  // digitpart: digit (["_"] digit)*
  let out = '';
  let prevDigit = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    const d = decimalValue(cp);
    if (d >= 0) {
      out += String(d);
      prevDigit = true;
    } else if (ch === '_' && prevDigit) {
      prevDigit = false;
      // must be followed by a digit; checked by the trailing test below
      out += '_';
    } else {
      return null;
    }
  }
  if (out === '' || out.endsWith('_')) return null;
  return out.replaceAll('_', '');
}

/** Whitespace `int()` and `float()` strip: ASCII whitespace plus non-ASCII Unicode spaces (not \x1c-\x1f). */
function stripNumeric(s: string): string {
  const ok = (c: number) => (c >= 0x09 && c <= 0x0d) || c === 0x20 || (c >= 0x80 && isPySpace(c));
  let i = 0;
  let j = s.length;
  while (i < j && ok(s.charCodeAt(i))) i++;
  while (j > i && ok(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

const INT_MAX_STR_DIGITS = 4300;

/** Python's `int(str)`. Returns a number when it is a safe integer, else a bigint. */
export function pyInt(input: unknown): number | bigint {
  if (typeof input !== 'string') {
    throw new TypeError(
      `int() argument must be a string, a bytes-like object or a real number, not '${input === null || input === undefined ? 'NoneType' : typeof input}'`,
    );
  }
  const s = stripNumeric(input);
  let i = 0;
  let neg = false;
  if (s[0] === '+' || s[0] === '-') {
    neg = s[0] === '-';
    i = 1;
  }
  const digits = digitsPart(s.slice(i));
  // CPython formats this with %.200R: the repr is cut to 200 characters
  if (digits === null) throw new ValueError(`invalid literal for int() with base 10: ${Array.from(pyRepr(input)).slice(0, 200).join('')}`);
  const stripped = digits.replace(/^0+(?=\d)/, '');
  if (digits.length > INT_MAX_STR_DIGITS) {
    throw new ValueError(
      `Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: value has ${digits.length} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  }
  const big = BigInt(stripped);
  const signed = neg ? -big : big;
  if (signed >= BigInt(Number.MIN_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(signed);
  return signed;
}

/** Python's `float(str)`. */
export function pyFloat(input: unknown): number {
  if (typeof input !== 'string') {
    throw new TypeError(
      `float() argument must be a string or a real number, not '${input === null || input === undefined ? 'NoneType' : typeof input}'`,
    );
  }
  const bad = () => new ValueError(`could not convert string to float: ${pyRepr(input)}`);
  const s = stripNumeric(input);
  let rest = s;
  let neg = false;
  if (rest[0] === '+' || rest[0] === '-') {
    neg = rest[0] === '-';
    rest = rest.slice(1);
  }
  const lower = rest.toLowerCase();
  if (lower === 'inf' || lower === 'infinity') return neg ? -Infinity : Infinity;
  if (lower === 'nan') return NaN;
  // digitpart ["." [digitpart]] | "." digitpart, then an optional exponent
  const m = /^([^.eE]*)(?:\.([^eE]*))?(?:[eE]([+-]?)(.*))?$/su.exec(rest);
  if (!m) throw bad();
  const [, intPart = '', fracPart, expSign = '', expPart] = m;
  const hasFrac = m[2] !== undefined;
  const hasExp = m[4] !== undefined;
  let intDigits: string | null = '';
  let fracDigits: string | null = '';
  if (intPart !== '') {
    intDigits = digitsPart(intPart);
    if (intDigits === null) throw bad();
  }
  if (hasFrac && fracPart !== '' && fracPart !== undefined) {
    fracDigits = digitsPart(fracPart);
    if (fracDigits === null) throw bad();
  }
  if (intDigits === '' && fracDigits === '') throw bad();
  let expDigits = '';
  if (hasExp) {
    const d = digitsPart(expPart as string);
    if (d === null) throw bad();
    expDigits = d;
  }
  const text = `${intDigits || '0'}.${fracDigits || '0'}${hasExp ? 'e' + expSign + expDigits : ''}`;
  const value = Number(text);
  return neg ? -value : value;
}
