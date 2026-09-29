/**
 * Plain-JS checks against the built package, so they run on every Node version
 * in `engines` (the TypeScript suite needs type stripping and only runs on 24+).
 * The expected values are CPython 3.14 results.
 *
 *   npm run build && node --test test/smoke.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';

const {
  ConfigParser,
  RawConfigParser,
  ExtendedInterpolation,
  DuplicateOptionError,
  InterpolationMissingOptionError,
  MissingSectionHeaderError,
  ParsingError,
  UNNAMED_SECTION,
  pyRepr,
  presets,
} = await import('../dist/index.js');

test('continuation lines, DEFAULT inheritance, write()', () => {
  const p = presets.tox();
  p.readString('[DEFAULT]\nd = 1\n[testenv]\ndeps =\n    pytest>=7\n    py311: coverage\ncommands = pytest {posargs}\n');
  assert.equal(p.get('testenv', 'deps'), '\npytest>=7\npy311: coverage');
  assert.equal(p.get('testenv', 'd'), '1');
  assert.deepEqual(p.items('testenv'), [
    ['d', '1'],
    ['deps', '\npytest>=7\npy311: coverage'],
    ['commands', 'pytest {posargs}'],
  ]);
  assert.equal(p.write(), '[DEFAULT]\nd = 1\n\n[testenv]\ndeps = \n\tpytest>=7\n\tpy311: coverage\ncommands = pytest {posargs}\n\n');
});

test('setuptools preset preserves case and interpolates', () => {
  const p = presets.setuptools();
  p.readString('[a]\nKey = %(other)s!\nother = x\n');
  assert.equal(p.get('a', 'Key'), 'x!');
  assert.throws(() => p.get('a', 'key'), { name: 'NoOptionError' });
});

test('errors carry CPython messages', () => {
  assert.throws(() => new ConfigParser().readString('a=1'), (e) => {
    assert.ok(e instanceof MissingSectionHeaderError);
    assert.equal(e.message, "File contains no section headers.\nfile: '<string>', line: 1\n'a=1'");
    return true;
  });
  assert.throws(() => new ConfigParser().readString('[a]\nx=1\nX=2\n'), (e) => {
    assert.ok(e instanceof DuplicateOptionError);
    assert.equal(e.message, "While reading from '<string>' [line  3]: option 'x' in section 'a' already exists");
    return true;
  });
  assert.throws(() => new ConfigParser().readString('[a]\nx=1\nbad\n'), (e) => {
    assert.ok(e instanceof ParsingError);
    assert.deepEqual(e.errors, [[3, 'bad\n']]);
    return true;
  });
  const p = new ConfigParser({ interpolation: new ExtendedInterpolation() });
  p.readString('[a]\nx=${nosuch}\n');
  assert.throws(() => p.get('a', 'x'), InterpolationMissingOptionError);
});

test('BOM is kept by readString and dropped by utf-8-sig', () => {
  assert.throws(() => new ConfigParser().readString('﻿[a]\n'), MissingSectionHeaderError);
  const p = new ConfigParser();
  p.readBuffer(Buffer.from('﻿[a]\r\nk = v\r\n'), 'x.cfg', { encoding: 'utf-8-sig' });
  assert.equal(p.get('a', 'k'), 'v');
});

test('getters, unnamed section, pyRepr', () => {
  const p = new RawConfigParser({ allowUnnamedSection: true });
  p.readString('n = 1_000\nf = 1.5\nb = Yes\n');
  assert.equal(p.getInt(UNNAMED_SECTION, 'n'), 1000);
  assert.equal(p.getFloat(UNNAMED_SECTION, 'f'), 1.5);
  assert.equal(p.getBoolean(UNNAMED_SECTION, 'b'), true);
  assert.equal(pyRepr("it's\n"), '"it\'s\\n"');
});
