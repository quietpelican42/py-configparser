/**
 * Error classes mirroring CPython's `configparser` exceptions. Names, fields
 * and message text are the same as in Python (3.14).
 *
 * Derived from CPython's Lib/configparser.py, Copyright (c) 2001 Python
 * Software Foundation; All Rights Reserved. See LICENSE-python.
 */
import { pyRepr, pyReprAny } from './pystr.ts';

export const MAX_INTERPOLATION_DEPTH = 10;

const pad2 = (n: number) => String(n).padStart(2, ' ');

/** Python's `configparser.Error`. */
export class ConfigParserError extends Error {
  constructor(msg = '') {
    super(msg);
    this.name = 'Error';
  }
}

export class NoSectionError extends ConfigParserError {
  section: unknown;
  constructor(section: unknown) {
    super(`No section: ${pyReprAny(section)}`);
    this.name = 'NoSectionError';
    this.section = section;
  }
}

export class DuplicateSectionError extends ConfigParserError {
  section: unknown;
  source: string | undefined;
  lineno: number | undefined;
  constructor(section: unknown, source?: string, lineno?: number) {
    let msg: string;
    if (source !== undefined) {
      msg = `While reading from ${pyRepr(source)}`;
      if (lineno !== undefined) msg += ` [line ${pad2(lineno)}]`;
      msg += `: section ${pyReprAny(section)} already exists`;
    } else {
      msg = `Section ${pyReprAny(section)} already exists`;
    }
    super(msg);
    this.name = 'DuplicateSectionError';
    this.section = section;
    this.source = source;
    this.lineno = lineno;
  }
}

export class DuplicateOptionError extends ConfigParserError {
  section: unknown;
  option: string;
  source: string | undefined;
  lineno: number | undefined;
  constructor(section: unknown, option: string, source?: string, lineno?: number) {
    const tail = `${pyRepr(option)} in section ${pyReprAny(section)} already exists`;
    let msg: string;
    if (source !== undefined) {
      msg = `While reading from ${pyRepr(source)}`;
      if (lineno !== undefined) msg += ` [line ${pad2(lineno)}]`;
      msg += `: option ${tail}`;
    } else {
      msg = `Option ${tail}`;
    }
    super(msg);
    this.name = 'DuplicateOptionError';
    this.section = section;
    this.option = option;
    this.source = source;
    this.lineno = lineno;
  }
}

export class NoOptionError extends ConfigParserError {
  option: string;
  section: unknown;
  constructor(option: string, section: unknown) {
    super(`No option ${pyRepr(option)} in section: ${pyReprAny(section)}`);
    this.name = 'NoOptionError';
    this.option = option;
    this.section = section;
  }
}

/** Base class for interpolation-related errors. */
export class InterpolationError extends ConfigParserError {
  option: string;
  section: unknown;
  constructor(option: string, section: unknown, msg: string) {
    super(msg);
    this.name = 'InterpolationError';
    this.option = option;
    this.section = section;
  }
}

export class InterpolationMissingOptionError extends InterpolationError {
  reference: string;
  constructor(option: string, section: unknown, rawval: unknown, reference: string) {
    super(
      option,
      section,
      `Bad value substitution: option ${pyRepr(option)} in section ${pyReprAny(section)} contains ` +
        `an interpolation key ${pyRepr(reference)} which is not a valid option name. ` +
        `Raw value: ${pyReprAny(rawval)}`,
    );
    this.name = 'InterpolationMissingOptionError';
    this.reference = reference;
  }
}

export class InterpolationSyntaxError extends InterpolationError {
  constructor(option: string, section: unknown, msg: string) {
    super(option, section, msg);
    this.name = 'InterpolationSyntaxError';
  }
}

export class InterpolationDepthError extends InterpolationError {
  constructor(option: string, section: unknown, rawval: unknown) {
    super(
      option,
      section,
      `Recursion limit exceeded in value substitution: option ${pyRepr(option)} ` +
        `in section ${pyReprAny(section)} contains an interpolation key which ` +
        `cannot be substituted in ${MAX_INTERPOLATION_DEPTH} steps. Raw value: ${pyReprAny(rawval)}`,
    );
    this.name = 'InterpolationDepthError';
  }
}

/** Raised (after the whole source is read) for lines that are not valid syntax. */
export class ParsingError extends ConfigParserError {
  source: string;
  /** `[lineno, line]` pairs; `line` includes its line terminator, as in Python. */
  errors: Array<[number, string]> = [];
  constructor(source: string, lineno?: number, line?: string) {
    super(`Source contains parsing errors: ${pyRepr(source)}`);
    this.name = 'ParsingError';
    this.source = source;
    if (lineno !== undefined && line !== undefined) this.append(lineno, line);
  }

  append(lineno: number, line: string): void {
    this.errors.push([lineno, line]);
    this.message += `\n\t[line ${pad2(lineno)}]: ${pyRepr(line)}`;
  }

  combine(others: Iterable<ParsingError>): this {
    const messages = [this.message];
    for (const other of others) {
      for (const [lineno, line] of other.errors) {
        this.errors.push([lineno, line]);
        messages.push(`\n\t[line ${pad2(lineno)}]: ${pyRepr(line)}`);
      }
    }
    this.message = messages.join('');
    return this;
  }

  /** Combine any number of ParsingErrors into one and throw it. */
  static raiseAll(exceptions: ParsingError[]): void {
    const [first, ...rest] = exceptions;
    if (first) throw first.combine(rest);
  }
}

export class MissingSectionHeaderError extends ParsingError {
  lineno: number;
  line: string;
  constructor(filename: string, lineno: number, line: string) {
    super(filename);
    this.name = 'MissingSectionHeaderError';
    this.message = `File contains no section headers.\nfile: ${pyRepr(filename)}, line: ${lineno}\n${pyRepr(line)}`;
    this.lineno = lineno;
    this.line = line;
  }
}

export class MultilineContinuationError extends ParsingError {
  lineno: number;
  line: string;
  constructor(filename: string, lineno: number, line: string) {
    super(filename);
    this.name = 'MultilineContinuationError';
    this.message = `Key without value continued with an indented line.\nfile: ${pyRepr(filename)}, line: ${lineno}\n${pyRepr(line)}`;
    this.lineno = lineno;
    this.line = line;
  }
}

export class UnnamedSectionDisabledError extends ConfigParserError {
  constructor() {
    super('Support for UNNAMED_SECTION is disabled.');
    this.name = 'UnnamedSectionDisabledError';
  }
}

export class InvalidWriteError extends ConfigParserError {
  constructor(msg = '') {
    super(msg);
    this.name = 'InvalidWriteError';
  }
}

/** Python's `KeyError`, raised by the section-proxy accessors. */
export class KeyError extends Error {
  key: unknown;
  constructor(key: unknown) {
    super(pyReprAny(key));
    this.name = 'KeyError';
    this.key = key;
  }
}
