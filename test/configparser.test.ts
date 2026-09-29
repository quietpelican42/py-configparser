/**
 * Behaviour checks. Every expected value here was produced by CPython 3.14.7's
 * configparser (see the differential tests for the exhaustive comparison).
 */
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ConfigParser,
  DuplicateOptionError,
  DuplicateSectionError,
  ExtendedInterpolation,
  InterpolationDepthError,
  InterpolationMissingOptionError,
  InterpolationSyntaxError,
  InvalidWriteError,
  MissingSectionHeaderError,
  MultilineContinuationError,
  NoOptionError,
  NoSectionError,
  ParsingError,
  RawConfigParser,
  UNNAMED_SECTION,
  UnnamedSectionDisabledError,
  ValueError,
  presets,
} from '../src/index.ts';

const tmp = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp', 'files');

function cp(text: string, options: ConstructorParameters<typeof ConfigParser>[0] = {}): ConfigParser {
  const p = new ConfigParser(options);
  p.readString(text);
  return p;
}

const own = (p: RawConfigParser, s: string) => Object.fromEntries(p.rawSection(s));

test('indented continuation lines form one multi-line value', () => {
  const p = presets.tox();
  p.readString('[testenv]\ndeps =\n    pytest>=7\n    py311: coverage\ncommands = pytest {posargs}\n');
  assert.deepEqual(own(p, 'testenv'), {
    deps: '\npytest>=7\npy311: coverage',
    commands: 'pytest {posargs}',
  });
});

test('blank lines stay inside a value; trailing blanks are stripped; comment lines inside are dropped', () => {
  const p = cp('[a]\nk = one\n\n  two\n\n# c\n  three\n\n\n[b]\nz=1');
  assert.equal(p.get('a', 'k'), 'one\n\ntwo\n\nthree');
  const q = cp('[a]\nk = v\n\n  notcont2 = x\n', { emptyLinesInValues: false });
  assert.equal(q.get('a', 'k'), 'v');
  assert.equal(q.get('a', 'notcont2'), 'x');
});

test('emptyLinesInValues=false: a line indented after a blank line is not a continuation', () => {
  const p = new ConfigParser({ emptyLinesInValues: false });
  assert.throws(() => p.readString('[a]\nk = v\n\n  notcont\n'), (e: unknown) => {
    assert.ok(e instanceof ParsingError);
    assert.equal(e.message, "Source contains parsing errors: '<string>'\n\t[line  4]: '  notcont\\n'");
    return true;
  });
});

test('the first delimiter wins and section names are not stripped', () => {
  const p = cp('[ a ]\nk = v = w: x\nname with spaces: y\n');
  assert.deepEqual(p.sections(), [' a ']);
  assert.equal(p.get(' a ', 'k'), 'v = w: x');
  assert.equal(p.get(' a ', 'Name With Spaces'.toLowerCase()), 'y');
});

test('inline comments need inline_comment_prefixes and preceding whitespace', () => {
  const plain = cp('[a]\nk = v # c\n');
  assert.equal(plain.get('a', 'k'), 'v # c');
  const p = cp('[a]\nk = v # c\nk2 = v#c\nk3 = v ;c\n', { inlineCommentPrefixes: ['#', ';'] });
  assert.deepEqual(own(p, 'a'), { k: 'v', k2: 'v#c', k3: 'v' });
});

test('DEFAULT is inherited, ordered defaults-first in items() and section-first in options()', () => {
  const p = cp('[s]\na=1\n[t]\nk=own\n', { defaults: { k: 'D' } });
  assert.deepEqual(p.items('s'), [['k', 'D'], ['a', '1']]);
  assert.deepEqual(p.options('t'), ['k']);
  assert.deepEqual(p.items('s', { raw: true, vars: { zz: '9' } }), [['k', 'D'], ['a', '1']]);
  assert.equal(p.write(), '[DEFAULT]\nk = D\n\n[s]\na = 1\n\n[t]\nk = own\n\n');
  assert.throws(() => p.options('DEFAULT'), NoSectionError);
});

test('option names lower-case by default; optionxform can preserve case', () => {
  const lower = cp('[a]\nKey = 1\n');
  assert.deepEqual([...lower.rawSection('a').keys()], ['key']);
  assert.equal(lower.get('a', 'KEY'), '1');
  const keep = presets.setuptools();
  keep.readString('[a]\nKey = 1\n');
  assert.deepEqual([...keep.rawSection('a').keys()], ['Key']);
  assert.throws(() => keep.get('a', 'key'), NoOptionError);
});

test('error: MissingSectionHeaderError includes the raw line', () => {
  const p = new ConfigParser();
  assert.throws(() => p.readString('a=1'), (e: unknown) => {
    assert.ok(e instanceof MissingSectionHeaderError && e instanceof ParsingError);
    assert.equal(e.message, "File contains no section headers.\nfile: '<string>', line: 1\n'a=1'");
    assert.equal(e.lineno, 1);
    return true;
  });
});

test('a BOM from readString is not removed; utf-8-sig decoding removes it', () => {
  const p = new ConfigParser();
  assert.throws(() => p.readString('﻿[a]\nk=v'), (e: unknown) => {
    assert.equal((e as Error).message, "File contains no section headers.\nfile: '<string>', line: 1\n'\\ufeff[a]\\n'");
    return true;
  });
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[a]\nk=v\n')]);
  assert.throws(() => new ConfigParser().readBuffer(bytes, 'f.cfg'), MissingSectionHeaderError);
  const q = new ConfigParser();
  q.readBuffer(bytes, 'f.cfg', { encoding: 'utf-8-sig' });
  assert.equal(q.get('a', 'k'), 'v');
});

test('CRLF: readString strips the \\r; a lone \\r is not a line break; read() applies universal newlines', () => {
  const p = cp('[a]\r\nk = v\r\nm = w\r\n');
  assert.deepEqual(own(p, 'a'), { k: 'v', m: 'w' });
  const q = new ConfigParser();
  q.readString('[a]\rk = v\r');
  assert.deepEqual([q.sections(), own(q, 'a')], [['a'], {}]);
  const r = new ConfigParser();
  r.readBuffer(Buffer.from('[a]\rk = v\r  more\r'), 'cr.cfg');
  assert.equal(r.get('a', 'k'), 'v\nmore');
});

test('strict mode: duplicate sections and options', () => {
  assert.throws(() => cp('[a]\nx=1\n[a]\n'), (e: unknown) => {
    assert.ok(e instanceof DuplicateSectionError);
    assert.equal(e.message, "While reading from '<string>' [line  3]: section 'a' already exists");
    assert.equal(e.lineno, 3);
    return true;
  });
  assert.throws(() => cp('[a]\nx=1\nX=2\n'), (e: unknown) => {
    assert.ok(e instanceof DuplicateOptionError);
    assert.equal(e.message, "While reading from '<string>' [line  3]: option 'x' in section 'a' already exists");
    return true;
  });
  const loose = cp('[a]\nx=1\nX=2\n[a]\ny=3\n', { strict: false });
  assert.deepEqual(own(loose, 'a'), { x: '2', y: '3' });
});

test('strict duplicates are per source; a second source merges', () => {
  const p = new ConfigParser();
  p.readString('[a]\nx=1\n');
  p.readString('[a]\nx=2\ny=3\n[b]\nz=4\n');
  assert.deepEqual(p.sections(), ['a', 'b']);
  assert.deepEqual(own(p, 'a'), { x: '2', y: '3' });
});

test('ParsingError collects every bad line', () => {
  assert.throws(() => cp('[a]\nx=1\n= v\nbad line\n  also bad\n'), (e: unknown) => {
    assert.ok(e instanceof ParsingError);
    assert.equal(
      e.message,
      "Source contains parsing errors: '<string>'\n\t[line  3]: '= v\\n'\n\t[line  4]: 'bad line\\n'\n\t[line  5]: '  also bad\\n'",
    );
    assert.deepEqual(e.errors, [[3, '= v\n'], [4, 'bad line\n'], [5, '  also bad\n']]);
    return true;
  });
});

test('allowNoValue: valueless options are null; a continuation after one is an error', () => {
  const p = cp('[a]\nk\nv=\nm=1\n  2\n', { allowNoValue: true });
  assert.deepEqual(own(p, 'a'), { k: null, v: '', m: '1\n2' });
  assert.equal(p.write(false), '[a]\nk\nv=\nm=1\n\t2\n\n');
  assert.throws(() => cp('[a]\nk\n  cont\n', { allowNoValue: true }), (e: unknown) => {
    assert.ok(e instanceof MultilineContinuationError);
    assert.equal(e.message, "Key without value continued with an indented line.\nfile: '<string>', line: 3\n'  cont\\n'");
    return true;
  });
});

test('BasicInterpolation and its errors', () => {
  const p = cp('[a]\nx=%(y)s\ny=%(z)s\nz=%(x)s\nb=%(nope)s\nc=100%\nd=%%ok\ne=%(f)s/%(f)s\nf=1\n');
  assert.throws(() => p.get('a', 'x'), (e: unknown) => {
    assert.ok(e instanceof InterpolationDepthError);
    assert.equal(
      e.message,
      "Recursion limit exceeded in value substitution: option 'x' in section 'a' contains an interpolation key which cannot be substituted in 10 steps. Raw value: '%(y)s'",
    );
    return true;
  });
  assert.throws(() => p.get('a', 'b'), (e: unknown) => {
    assert.ok(e instanceof InterpolationMissingOptionError);
    assert.equal(
      e.message,
      "Bad value substitution: option 'b' in section 'a' contains an interpolation key 'nope' which is not a valid option name. Raw value: '%(nope)s'",
    );
    assert.equal(e.reference, 'nope');
    return true;
  });
  assert.throws(() => p.get('a', 'c'), (e: unknown) => {
    assert.ok(e instanceof InterpolationSyntaxError);
    assert.equal(e.message, "'%' must be followed by '%' or '(', found: '%'");
    return true;
  });
  assert.equal(p.get('a', 'd'), '%ok');
  assert.equal(p.get('a', 'd', { raw: true }), '%%ok');
  assert.equal(p.get('a', 'e'), '1/1');
  assert.equal(p.get('a', 'e', { vars: { f: 'V' } }), 'V/V');
});

test('ExtendedInterpolation resolves cross-section references', () => {
  const p = cp('[a]\nx=${b:y}/${z}\nz=1\n[b]\ny=2\n', { interpolation: new ExtendedInterpolation() });
  assert.equal(p.get('a', 'x'), '2/1');
  assert.throws(() => cp('[a]\nx=${nosec:y}\n', { interpolation: new ExtendedInterpolation() }).get('a', 'x'), InterpolationMissingOptionError);
});

test('getInt/getFloat/getBoolean, fallbacks and Python error text', () => {
  const p = cp('[a]\nn= 12 \nf=1.5\nb=YES\nx=maybe\nbig=123456789012345678901234567890\n');
  assert.equal(p.getInt('a', 'n'), 12);
  assert.equal(p.getFloat('a', 'f'), 1.5);
  assert.equal(p.getBoolean('a', 'b'), true);
  assert.equal(p.getInt('a', 'big'), 123456789012345678901234567890n);
  assert.throws(() => p.getBoolean('a', 'x'), (e: unknown) => e instanceof ValueError && e.message === 'Not a boolean: maybe');
  assert.throws(() => p.getInt('a', 'x'), (e: unknown) => e instanceof ValueError && e.message === "invalid literal for int() with base 10: 'maybe'");
  assert.equal(p.getInt('a', 'zz', { fallback: 5 }), 5);
  assert.equal(p.getInt('nosec', 'zz', { fallback: null }), null);
  assert.throws(() => p.getInt('nosec', 'zz'), (e: unknown) => e instanceof NoSectionError && e.message === "No section: 'nosec'");
  assert.throws(() => p.get('a', 'zz'), (e: unknown) => e instanceof NoOptionError && e.message === "No option 'zz' in section: 'a'");
  assert.equal(p.get('a', 'zz', { fallback: undefined }), undefined);
});

test('custom converters and section proxies', () => {
  const p = cp('[a]\nl = x, y ,z\nn = 3\n', { converters: { list: (v) => (v ?? '').split(',').map((s) => s.trim()) } });
  assert.deepEqual(p.getConverted('list', 'a', 'l'), ['x', 'y', 'z']);
  const s = p.section('a');
  assert.deepEqual(s.getConverted('list', 'l'), ['x', 'y', 'z']);
  assert.equal(s.getInt('n'), 3);
  assert.equal(s.get('missing'), null);
  assert.equal(s.get('missing', 'FB'), 'FB');
  assert.deepEqual(s.keys(), ['l', 'n']);
  assert.equal(s.has('N'), true);
  assert.throws(() => p.section('nope'), /nope/);
  assert.deepEqual(p.items().map(([n]) => n), ['DEFAULT', 'a']);
});

test('unnamed section (allowUnnamedSection)', () => {
  const p = cp('x=1\n[a]\ny=2\n', { allowUnnamedSection: true });
  assert.deepEqual(p.sections(), [UNNAMED_SECTION, 'a']);
  assert.equal(p.get(UNNAMED_SECTION, 'x'), '1');
  assert.equal(p.write(), 'x = 1\n\n[a]\ny = 2\n\n');
  assert.throws(() => new ConfigParser().addSection(UNNAMED_SECTION), UnnamedSectionDisabledError);
});

test('set / addSection validation matches ConfigParser and RawConfigParser', () => {
  const p = new ConfigParser();
  assert.throws(() => p.set('a', 'b', 'c'), NoSectionError);
  p.addSection('a');
  assert.throws(() => p.set('a', 'b', null), (e: unknown) => e instanceof TypeError && e.message === 'option values must be strings');
  assert.throws(() => p.set('a', 'b', '%x'), (e: unknown) => e instanceof ValueError && e.message === "invalid interpolation syntax in '%x' at position 0");
  assert.throws(() => p.addSection('a'), (e: unknown) => e instanceof DuplicateSectionError && e.message === "Section 'a' already exists");
  assert.throws(() => p.addSection('DEFAULT'), (e: unknown) => e instanceof ValueError && e.message === "Invalid section name: 'DEFAULT'");
  const r = new RawConfigParser();
  r.addSection('a');
  r.set('a', 'k', '%x');
  assert.equal(r.get('a', 'k'), '%x');
  r.set('a', '[k]', 'v');
  assert.throws(() => r.write(), (e: unknown) => e instanceof InvalidWriteError && e.message === 'Cannot write key [k]; begins with section pattern');
});

test('write() converts newlines to \\n\\t and honours spaceAroundDelimiters', () => {
  const p = cp('[a]\nk = 1\n  2\nz = None\n');
  assert.equal(p.write(), '[a]\nk = 1\n\t2\nz = None\n\n');
  assert.equal(p.write(false), '[a]\nk=1\n\t2\nz=None\n\n');
  const q = new ConfigParser({ delimiters: [':'] });
  q.readDict({ s: { k: 'a\r\nb' } });
  assert.equal(q.write(), '[s]\nk : a\n\tb\n\n');
});

test('valueless option written without allowNoValue becomes "None"', () => {
  const p = new RawConfigParser({ allowNoValue: true });
  p.readString('[a]\nk\n');
  assert.equal(p.write(), '[a]\nk\n\n');
  const q = new RawConfigParser();
  q.addSection('a');
  q.set('a', 'k', null);
  assert.equal(q.write(), '[a]\nk = None\n\n');
});

test('readDict converts values and detects duplicates in strict mode', () => {
  const p = new ConfigParser({ allowNoValue: true });
  p.readDict({ a: { x: 1, y: true, z: null } });
  assert.deepEqual(own(p, 'a'), { x: '1', y: 'True', z: null });
  assert.throws(() => new ConfigParser().readDict({ a: { x: '1', X: '2' } }), DuplicateOptionError);
});

test('constructor defaults are not interpolated and must be strings', () => {
  const p = new ConfigParser({ defaults: { a: '%(b)s', B: 'v' } });
  assert.deepEqual([...p.defaults()], [['a', '%(b)s'], ['b', 'v']]);
  assert.throws(() => new ConfigParser({ defaults: { a: null } }), TypeError);
  assert.ok(new ConfigParser({ defaults: { a: null }, allowNoValue: true }));
});

test('custom delimiters and comment prefixes', () => {
  const p = cp('[a]\nk => v\nm::w\n// note\n#h => not a comment\nq = r => s\n', { delimiters: ['=>', '::'], commentPrefixes: ['//'] });
  assert.deepEqual(own(p, 'a'), { k: 'v', m: 'w', '#h': 'not a comment', 'q = r': 's' });
});

test('presets', () => {
  assert.ok(presets.setuptools() instanceof ConfigParser);
  assert.ok(presets.flake8() instanceof RawConfigParser && !(presets.flake8() instanceof ConfigParser));
  const t = presets.tox();
  t.readString('[a]\nk = 100%\n');
  assert.equal(t.get('a', 'k'), '100%');
  const s = presets.setuptools();
  s.readString('[a]\nk = 100%\n');
  assert.throws(() => s.get('a', 'k'), InterpolationSyntaxError);
  const m = presets.mypy();
  m.readString('[mypy]\nignore = %not interpolated\n');
  assert.equal(m.get('mypy', 'ignore'), '%not interpolated');
});

test('read(): reads files, skips missing ones, keeps source names in errors', () => {
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const good = join(tmp, 'setup.cfg');
  const bad = join(tmp, 'bad.cfg');
  const bom = join(tmp, 'bom.cfg');
  writeFileSync(good, '[metadata]\r\nname = pkg\r\nclassifiers =\r\n    A\r\n    B\r\n');
  writeFileSync(bad, '[a]\nk=1\nk=2\n');
  writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[a]\nk=v\n')]));
  const p = new ConfigParser();
  assert.deepEqual(p.read([join(tmp, 'missing.cfg'), good, tmp]), [good]);
  assert.equal(p.get('metadata', 'classifiers'), '\nA\nB');
  assert.throws(() => new ConfigParser().read(bad), (e: unknown) => {
    assert.ok(e instanceof DuplicateOptionError);
    assert.equal(e.message, `While reading from '${bad}' [line  3]: option 'k' in section 'a' already exists`);
    return true;
  });
  assert.throws(() => new ConfigParser().read(bom), MissingSectionHeaderError);
  const q = new ConfigParser();
  assert.deepEqual(q.read(bom, { encoding: 'utf-8-sig' }), [bom]);
  assert.equal(q.get('a', 'k'), 'v');
  assert.throws(() => new ConfigParser().read(good, { encoding: 'nope' }), RangeError);
  writeFileSync(join(tmp, 'latin.cfg'), Buffer.from('[a]\nk = caf\xe9\n', 'latin1'));
  const l = new ConfigParser();
  l.read(join(tmp, 'latin.cfg'), { encoding: 'latin-1' });
  assert.equal(l.get('a', 'k'), 'café');
  assert.throws(() => new ConfigParser().read(join(tmp, 'latin.cfg')), /decode failed/);
  rmSync(tmp, { recursive: true, force: true });
});
