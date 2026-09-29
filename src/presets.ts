import { ConfigParser, RawConfigParser, type ParserOptions } from './parser.ts';

/**
 * Parser configurations used by Python tools. Each is a function returning a
 * new parser; pass `overrides` to change any option.
 *
 * Read files the way the tool does (see each description) to get the same
 * results, in particular the encoding.
 */
export const presets = {
  /** setuptools (`setup.cfg`): `ConfigParser()` with `%` interpolation, case-preserving keys, read as UTF-8. */
  setuptools: (overrides: ParserOptions = {}): ConfigParser =>
    new ConfigParser({ optionxform: (s) => s, ...overrides }),
  /** tox 4 (`tox.ini`): `ConfigParser(interpolation=None)`, keys lower-cased, read as UTF-8 with `read_string`. */
  tox: (overrides: ParserOptions = {}): ConfigParser => new ConfigParser({ interpolation: null, ...overrides }),
  /** coverage.py (`.coveragerc`, `setup.cfg`, `tox.ini`): `ConfigParser(interpolation=None)`, read as UTF-8. */
  coverage: (overrides: ParserOptions = {}): ConfigParser => new ConfigParser({ interpolation: null, ...overrides }),
  /** flake8 (`.flake8`, `tox.ini`, `setup.cfg`): `RawConfigParser()`. */
  flake8: (overrides: ParserOptions = {}): RawConfigParser => new RawConfigParser(overrides),
  /** mypy (`mypy.ini`, `setup.cfg`): `RawConfigParser()`. */
  mypy: (overrides: ParserOptions = {}): RawConfigParser => new RawConfigParser(overrides),
  /** twine (`.pypirc`): `RawConfigParser()`. */
  twine: (overrides: ParserOptions = {}): RawConfigParser => new RawConfigParser(overrides),
} as const;
