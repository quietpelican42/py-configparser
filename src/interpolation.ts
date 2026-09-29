/**
 * Interpolation handlers: none (`Interpolation`), `BasicInterpolation` and
 * `ExtendedInterpolation`, ported from CPython's Lib/configparser.py.
 *
 * Derived from CPython's Lib/configparser.py, Copyright (c) 2001 Python
 * Software Foundation; All Rights Reserved. See LICENSE-python.
 */
import {
  InterpolationDepthError,
  InterpolationMissingOptionError,
  InterpolationSyntaxError,
  MAX_INTERPOLATION_DEPTH,
  NoOptionError,
  NoSectionError,
} from './errors.ts';
import { pyRepr, ValueError as ValueErrorLike } from './pystr.ts';
import type { GetOptions, ItemsOptions, SectionName } from './parser.ts';

/** Read-only lookup. `undefined` means "no such key"; `null` is a valueless option. */
export interface Lookup {
  get(key: string): string | null | undefined;
}

/** What interpolation handlers need from a parser. */
export interface InterpolationParser {
  get(section: SectionName, option: string, options?: GetOptions): string | null;
  items(section: SectionName, options?: ItemsOptions): Array<[string, string | null]>;
  optionxform(option: string): string;
}

/** Dummy interpolation that passes the value through with no changes. */
export class Interpolation {
  beforeGet(_parser: InterpolationParser, _section: SectionName, _option: string, value: string | null, _defaults: Lookup): string | null {
    return value;
  }

  beforeSet(_parser: InterpolationParser, _section: SectionName, _option: string, value: string): string {
    return value;
  }

  beforeRead(_parser: InterpolationParser, _section: SectionName, _option: string, value: string | null): string | null {
    return value;
  }

  beforeWrite(_parser: InterpolationParser, _section: SectionName, _option: string, value: string | null): string | null {
    return value;
  }
}

const NONE_NOT_ITERABLE = "argument of type 'NoneType' is not a container or iterable";

/**
 * `%(name)s` interpolation as in the classic `ConfigParser`. `%%` is a literal
 * percent sign; any other use of `%` raises `InterpolationSyntaxError`.
 */
export class BasicInterpolation extends Interpolation {
  static readonly KEYCRE = /^%\(([^)]+)\)s/u;

  override beforeGet(parser: InterpolationParser, section: SectionName, option: string, value: string | null, defaults: Lookup): string {
    const accum: string[] = [];
    this.interpolateSome(parser, option, accum, value, section, defaults, 1);
    return accum.join('');
  }

  override beforeSet(_parser: InterpolationParser, _section: SectionName, _option: string, value: string): string {
    let tmp = value.replaceAll('%%', '');
    tmp = tmp.replace(/%\([^)]+\)s/gu, '');
    if (tmp.includes('%')) {
      throw new ValueErrorLike(`invalid interpolation syntax in ${pyRepr(value)} at position ${[...tmp.slice(0, tmp.indexOf('%'))].length}`);
    }
    return value;
  }

  protected interpolateSome(
    parser: InterpolationParser,
    option: string,
    accum: string[],
    rest: string | null,
    section: SectionName,
    map: Lookup,
    depth: number,
  ): void {
    const rawval = parser.get(section, option, { raw: true, fallback: rest });
    if (depth > MAX_INTERPOLATION_DEPTH) throw new InterpolationDepthError(option, section, rawval);
    while (rest) {
      const p = rest.indexOf('%');
      if (p < 0) {
        accum.push(rest);
        return;
      }
      if (p > 0) {
        accum.push(rest.slice(0, p));
        rest = rest.slice(p);
      }
      const c = rest.slice(1, 2);
      if (c === '%') {
        accum.push('%');
        rest = rest.slice(2);
      } else if (c === '(') {
        const m = BasicInterpolation.KEYCRE.exec(rest);
        if (m === null) {
          throw new InterpolationSyntaxError(option, section, `bad interpolation variable reference ${pyRepr(rest)}`);
        }
        const v0 = parser.optionxform(m[1] as string);
        rest = rest.slice(m[0].length);
        const v = map.get(v0);
        if (v === undefined) throw new InterpolationMissingOptionError(option, section, rawval, v0);
        if (v === null) throw new TypeError(NONE_NOT_ITERABLE);
        if (v.includes('%')) {
          this.interpolateSome(parser, option, accum, v, section, map, depth + 1);
        } else {
          accum.push(v);
        }
      } else {
        throw new InterpolationSyntaxError(
          option,
          section,
          `'%' must be followed by '%' or '(', found: ${pyRepr(rest)}`,
        );
      }
    }
  }
}

/**
 * `${name}` / `${section:name}` interpolation, the syntax of `zc.buildout`.
 * `$$` is a literal dollar sign.
 */
export class ExtendedInterpolation extends Interpolation {
  static readonly KEYCRE = /^\$\{([^}]+)\}/u;

  override beforeGet(parser: InterpolationParser, section: SectionName, option: string, value: string | null, defaults: Lookup): string {
    const accum: string[] = [];
    this.interpolateSome(parser, option, accum, value, section, defaults, 1);
    return accum.join('');
  }

  override beforeSet(_parser: InterpolationParser, _section: SectionName, _option: string, value: string): string {
    let tmp = value.replaceAll('$$', '');
    tmp = tmp.replace(/\$\{[^}]+\}/gu, '');
    if (tmp.includes('$')) {
      throw new ValueErrorLike(`invalid interpolation syntax in ${pyRepr(value)} at position ${[...tmp.slice(0, tmp.indexOf('$'))].length}`);
    }
    return value;
  }

  protected interpolateSome(
    parser: InterpolationParser,
    option: string,
    accum: string[],
    rest: string | null,
    section: SectionName,
    map: Lookup,
    depth: number,
  ): void {
    const rawval = parser.get(section, option, { raw: true, fallback: rest });
    if (depth > MAX_INTERPOLATION_DEPTH) throw new InterpolationDepthError(option, section, rawval);
    while (rest) {
      const p = rest.indexOf('$');
      if (p < 0) {
        accum.push(rest);
        return;
      }
      if (p > 0) {
        accum.push(rest.slice(0, p));
        rest = rest.slice(p);
      }
      const c = rest.slice(1, 2);
      if (c === '$') {
        accum.push('$');
        rest = rest.slice(2);
      } else if (c === '{') {
        const m = ExtendedInterpolation.KEYCRE.exec(rest);
        if (m === null) {
          throw new InterpolationSyntaxError(option, section, `bad interpolation variable reference ${pyRepr(rest)}`);
        }
        const path = (m[1] as string).split(':');
        rest = rest.slice(m[0].length);
        let sect: SectionName = section;
        let opt = option;
        let v: string | null | undefined;
        if (path.length === 1) {
          opt = parser.optionxform(path[0] as string);
          v = map.get(opt);
          if (v === undefined) throw new InterpolationMissingOptionError(option, section, rawval, path.join(':'));
        } else if (path.length === 2) {
          sect = path[0] as string;
          opt = parser.optionxform(path[1] as string);
          try {
            v = parser.get(sect, opt, { raw: true });
          } catch (e) {
            if (e instanceof NoSectionError || e instanceof NoOptionError) {
              throw new InterpolationMissingOptionError(option, section, rawval, path.join(':'));
            }
            throw e;
          }
        } else {
          throw new InterpolationSyntaxError(option, section, `More than one ':' found: ${pyRepr(rest)}`);
        }
        if (v === null) continue;
        if (v.includes('$')) {
          this.interpolateSome(parser, opt, accum, v, sect, new Map(parser.items(sect, { raw: true })), depth + 1);
        } else {
          accum.push(v);
        }
      } else {
        throw new InterpolationSyntaxError(
          option,
          section,
          `'$' must be followed by '$' or '{', found: ${pyRepr(rest)}`,
        );
      }
    }
  }
}
