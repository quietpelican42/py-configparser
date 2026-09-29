# py-configparser

A port of CPython 3.14's `configparser` to TypeScript, for reading `setup.cfg`, `tox.ini`, `.flake8`, `mypy.ini`, `.coveragerc` and `.pypirc` the way the Python tools read them.

```ts
import { presets } from 'py-configparser';

const tox = presets.tox();
tox.readString('[testenv]\ndeps =\n    pytest>=7\n    py311: coverage\ncommands = pytest {posargs}\n', 'tox.ini');

tox.get('testenv', 'deps');      // "\npytest>=7\npy311: coverage"
tox.get('testenv', 'commands');  // "pytest {posargs}"
```

## Why

INI files written for Python tools are not the format npm parsers implement.

- A value continues on the following lines when they are indented deeper than the key. Most `setup.cfg` and `tox.ini` files use this for `install_requires`, `deps`, `commands` and `classifiers`.
- `:` and `=` both delimit, the first one wins, and keys such as `py311: coverage` on a continuation line are part of the value.
- `[DEFAULT]` values are inherited by every section, option names are lower-cased unless the tool disables that, and `%(name)s` is interpolated by some tools and not by others.
- Duplicate sections and options, a missing section header, a BOM and malformed lines are errors with specific messages and line numbers.

`ini.parse` turns `deps =\n    pytest>=7` into a key named `pytest>`. Tools that need these files in Node commonly match lines with regular expressions instead (Renovate's `setup-cfg` manager does).

Measured: `node bench/incumbents.ts corpus.json <dir with the incumbents installed>` on 280 real config files (157 `setup.cfg`, 103 `tox.ini`, 7 `pytest.ini`, 7 `.coveragerc`, 3 `.flake8`, 3 `mypy.ini`) from the 100 most-starred Python repositories and code-search hits. The expected result is CPython 3.14.7 `ConfigParser.read_string`, compared as exact `{section: {key: raw value}}`. The corpus leans toward files found by searching for `[metadata]`, `[testenv]` and similar, and 82% of the files have multi-line values.

```
280 files: CPython accepts 280, rejects 0
parser               exact match (accepted files)   errors raised on rejected files
ini                    45/280 =  16.1%      0/0
config-ini-parser      49/280 =  17.5%      0/0
configparser           49/280 =  17.5%      0/0
js-ini                 20/280 =   7.1%      0/0
multi-ini              38/280 =  13.6%      0/0
ini-simple-parser      49/280 =  17.5%      0/0
py-configparser       280/280 = 100.0%      0/0
```

The 280 files are third-party and are not in this repository. The 42-case feature suite is (`test/fixtures/features.json`); on it, seven cases are files CPython rejects, and a parser scores on those by also throwing:

```
42 files: CPython accepts 35, rejects 7
parser               exact match (accepted files)   errors raised on rejected files
ini                    15/35 =  42.9%      0/7
config-ini-parser      20/35 =  57.1%      3/7
configparser           22/35 =  62.9%      3/7
js-ini                 14/35 =  40.0%      2/7
multi-ini              18/35 =  51.4%      0/7
ini-simple-parser      21/35 =  60.0%      2/7
py-configparser       35/35 = 100.0%      7/7
```

Incumbents checked: `ini` 7.0.0, `config-ini-parser` 1.6.1, `configparser` 0.3.10, `js-ini` 1.6.0, `multi-ini` 2.3.2, `ini-simple-parser` 1.0.1. None handles continuation lines, CRLF, the BOM error or duplicate-option errors. `huafua-configparser` and `configparser-ts` expose a different API (file-based, no continuation lines) and were not scored; `confbox` and `read-ini-file` wrap `ini`.

## Installation

```sh
npm install py-configparser
```

Node >= 20.6. No runtime dependencies.

## Usage

### Read a tool's file the way the tool does

`presets` builds the parser each Python tool uses.

| Preset | Python equivalent | Used by |
|---|---|---|
| `presets.setuptools()` | `ConfigParser()` with `optionxform = str` | `setup.cfg` (setuptools reads it as UTF-8) |
| `presets.tox()` | `ConfigParser(interpolation=None)` | `tox.ini` (tox 4) |
| `presets.coverage()` | `ConfigParser(interpolation=None)` | `.coveragerc`, `setup.cfg`, `tox.ini` (coverage.py) |
| `presets.flake8()` | `RawConfigParser()` | `.flake8`, `tox.ini`, `setup.cfg` |
| `presets.mypy()` | `RawConfigParser()` | `mypy.ini`, `setup.cfg` |
| `presets.twine()` | `RawConfigParser()` | `.pypirc` |

Each takes an options object that overrides any [parser option](#parser-options). The equivalents were read from the installed tool sources (setuptools 84.0.0, tox 4.64.4, coverage 7.16.2, flake8 7.4.1, mypy 2.3.1, twine 7.0.0). tox does not override `optionxform`, so `presets.tox()` lower-cases option names.

```ts
import { readFileSync } from 'node:fs';
import { presets } from 'py-configparser';

const setup = presets.setuptools();
setup.readString(readFileSync('setup.cfg', 'utf8'), 'setup.cfg');
setup.get('options', 'install_requires').split('\n').filter(Boolean);
```

### Read files with an encoding

`read()` matches Python's `read(filenames, encoding)`: it skips files that cannot be opened, applies universal newlines, and keeps a UTF-8 BOM (which then raises `MissingSectionHeaderError`) unless the encoding is `utf-8-sig`.

```ts
const p = presets.coverage();
p.read('.coveragerc', { encoding: 'utf-8' });     // returns the paths it read
p.readBuffer(bytes, 'pyproject-extra.cfg', { encoding: 'utf-8-sig' });
```

`readString(text)` behaves like `read_string`: lines split on `\n` only, `\r` is stripped as whitespace, and a BOM is not removed. Decode and normalize before calling it if the tool does.

### Typed getters and fallbacks

```ts
p.getInt('flake8', 'max-line-length');             // Python int(): "1_000", " 8 ", Unicode digits
p.getFloat('a', 'ratio');
p.getBoolean('a', 'flag');                         // 1/yes/true/on, 0/no/false/off, any case
p.getInt('a', 'missing', { fallback: 79 });        // 79
p.get('a', 'x', { vars: { y: 'override' } });
p.items('a', { raw: true });                       // [option, value][], DEFAULT merged in
```

### Interpolation

`ConfigParser` interpolates `%(name)s` (`BasicInterpolation`) by default. Pass `ExtendedInterpolation` for `${section:name}`, or `interpolation: null` for none.

```ts
import { ConfigParser, ExtendedInterpolation } from 'py-configparser';

const p = new ConfigParser({ interpolation: new ExtendedInterpolation() });
p.readString('[a]\nx = ${b:y}/${z}\nz = 1\n[b]\ny = 2\n');
p.get('a', 'x');   // "2/1"
```

### Catch the same errors

```ts
import { ConfigParser, ParsingError, MissingSectionHeaderError } from 'py-configparser';

try {
  new ConfigParser().readString('[a]\nk = 1\nnot an option\n', 'demo.cfg');
} catch (e) {
  if (e instanceof ParsingError) console.log(e.message, e.errors);
}
// e.message: "Source contains parsing errors: 'demo.cfg'\n\t[line  3]: 'not an option\\n'"
// e.errors:  [[3, 'not an option\n']]
```

### Write

`write()` returns the text CPython's `write()` produces (comments are not preserved).

```ts
p.write();        // "[metadata]\nname = demo\n...\n\n"
p.write(false);   // "name=demo": no spaces around the delimiter
```

`node examples/tools.ts` reads a `tox.ini`, `setup.cfg` and `.flake8` sample and prints the values and two error messages.

## Reference

### Parser options

Passed as one object to `new ConfigParser(options)` or `new RawConfigParser(options)`. `RawConfigParser` has no interpolation by default; `ConfigParser` uses `BasicInterpolation` and validates types in `set`, `addSection` and `defaults`.

| Name | Type | Default | Python name and description |
|---|---|---|---|
| `defaults` | `Record<string, string \| null> \| Map` | none | `defaults`. Initial DEFAULT values. |
| `allowNoValue` | `boolean` | `false` | `allow_no_value`. Options without a delimiter get the value `null`. |
| `delimiters` | `string[]` | `['=', ':']` | `delimiters`. |
| `commentPrefixes` | `string[] \| null` | `['#', ';']` | `comment_prefixes`. Full-line comments; may be indented. |
| `inlineCommentPrefixes` | `string[] \| null` | `null` | `inline_comment_prefixes`. Must follow whitespace or start the line. |
| `strict` | `boolean` | `true` | `strict`. Duplicate sections and options within one source are errors. |
| `emptyLinesInValues` | `boolean` | `true` | `empty_lines_in_values`. `false` ends a value at a blank line. |
| `defaultSection` | `string` | `'DEFAULT'` | `default_section`. |
| `interpolation` | `Interpolation \| null` | see above | `interpolation`. `null` disables. |
| `converters` | `Record<string, (v: string \| null) => unknown>` | none | `converters`. Used through `getConverted(name, ...)`. |
| `allowUnnamedSection` | `boolean` | `false` | `allow_unnamed_section` (3.13+). Options before the first header go to `UNNAMED_SECTION`. |
| `optionxform` | `(name: string) => string` | Python `str.lower` | The `optionxform` hook. Applied to `defaults` too. |

### Methods

Names are the Python names in camelCase. `section` arguments accept `string` or `UNNAMED_SECTION`. A missing key throws `NoSectionError` or `NoOptionError` unless `fallback` is present in the options object.

| Method | Description |
|---|---|
| `readString(text, source = '<string>')` | `read_string`. |
| `readFile(lines, source = '<???>')` | `read_file`. `lines` is an iterable of lines (with terminators) or a string. |
| `read(filenames, { encoding })` | `read`. Returns the paths read. |
| `readBuffer(bytes, source, { encoding })` | Decode, apply universal newlines, parse. |
| `readDict(dict, source = '<dict>')` | `read_dict`. Values are converted to strings (`true` becomes `"True"`). |
| `get(section, option, { raw, vars, fallback })` | `get`. |
| `getInt`, `getFloat`, `getBoolean` | `getint`, `getfloat`, `getboolean`. `getInt` returns a `bigint` outside the safe integer range. |
| `getConverted(name, section, option, options)` | The `get<name>` methods Python generates for `converters`. |
| `items(section, { raw, vars })` | `items(section)`. With no argument: `[name, SectionProxy][]`. |
| `sections()`, `defaults()`, `options(section)`, `hasSection(s)`, `hasOption(s, o)` | Same as Python. `sections()` includes `UNNAMED_SECTION` once options were read into it. |
| `rawSection(section)` | The options defined in the section itself, without DEFAULT and interpolation (`parser._sections[s]`). |
| `section(name)` | A `SectionProxy` (`parser[name]`): `get`, `getInt`, `getFloat`, `getBoolean`, `getConverted`, `has`, `keys`, `getItem`, `set`, `delete`. |
| `set`, `addSection`, `removeOption`, `removeSection` | Same as Python, with the same validation errors. |
| `write(spaceAroundDelimiters = true)` | Returns the INI text. |
| `optionxform(name)` | Overridable in a subclass, or assign to it. |

### Exports

`ConfigParser`, `RawConfigParser`, `SectionProxy`, `presets`, `UNNAMED_SECTION`, `DEFAULTSECT`, `Interpolation`, `BasicInterpolation`, `ExtendedInterpolation`, `MAX_INTERPOLATION_DEPTH`, and the error classes below. `pyRepr` (Python's `repr(str)`) is exported because the error messages use it.

| Error | Python name | Extra fields |
|---|---|---|
| `ConfigParserError` | `Error` | `message` |
| `NoSectionError` | same | `section` |
| `NoOptionError` | same | `option`, `section` |
| `DuplicateSectionError` | same | `section`, `source`, `lineno` |
| `DuplicateOptionError` | same | `section`, `option`, `source`, `lineno` |
| `ParsingError` | same | `source`, `errors: [lineno, line][]` |
| `MissingSectionHeaderError` | same | `source`, `lineno`, `line` |
| `MultilineContinuationError` | same | `source`, `lineno`, `line` |
| `InterpolationError`, `InterpolationMissingOptionError`, `InterpolationSyntaxError`, `InterpolationDepthError` | same | `option`, `section` (and `reference`) |
| `UnnamedSectionDisabledError`, `InvalidWriteError` | same | |
| `ValueError`, `KeyError` | Python built-ins | thrown for the conversions and lookups where Python raises them |

`ParsingError`, `MissingSectionHeaderError` and `MultilineContinuationError` follow Python's hierarchy: the last two extend `ParsingError`, and all extend `ConfigParserError`.

## How it works

`src/parser.ts`, `src/interpolation.ts` and `src/errors.ts` are a close port of CPython's `Lib/configparser.py` (3.14.7): the same read loop, indentation rules, `_join_multiline_values` pass, strict-mode bookkeeping and `write()`. Parts that need care:

- The regular expressions (`SECTCRE`, `OPTCRE`, `OPTCRE_NV`, the comment patterns) are translated so they match the same text. Python's `.` becomes `[^\n]` (JS `.` also excludes `\r`, ` ` and ` `), `\s` becomes an explicit class of Python's whitespace, and `$` becomes a lookahead that also accepts a trailing newline.
- Python `str` behaviour is reimplemented on tables generated from CPython (`scripts/gen-unicode.py`, Unicode 16.0): `strip`, `lower` (including the final-sigma rule), `repr` (for error messages), and `int()` / `float()` including underscores, Unicode digits and the 4300-digit limit. Node 24 ships Unicode 17, so its built-in `toLowerCase` and `\s` are not used.
- Sources are handled as Python handles them. `readString` splits on `\n` only. `read` decodes, applies universal newlines, and does not remove a BOM.

Verification against CPython 3.14.7:

- `scripts/diff.ts` generates cases from a seeded line grammar and compares `scripts/oracle.py` (CPython) with this library. Each case is a parser configuration, one to three sources, optional edits, and a fixed set of probes. It compares the class, message, line number and fields of every exception; the parsed sections and options in order; `get` / `getInt` / `getFloat` / `getBoolean` with and without `raw`, `vars` and `fallback`; `items`; `options`; `hasOption`; and `write()` with and without spaces. The generator covers every constructor option, both interpolation modes, delimiters and comment prefixes containing regex metacharacters, continuation lines at mixed indentation, duplicates, DEFAULT, valueless options, Unicode whitespace, CRLF, lone CR and a BOM, and sources read as bytes with `utf-8`, `utf-8-sig` and `latin-1`.
- Last run: 30,000 cases (seeds 101 to 105, 6,000 each), 0 mismatches; 280 real files in 6 configurations each (setuptools, tox, flake8, extended interpolation, bytes as `utf-8` and `utf-8-sig`), 0 mismatches; the 42-case suite in the same configurations, 0 mismatches; 50,000 random strings and all 1,114,112 code points for the string helpers, 0 mismatches.
- Mutation check: changing `>` to `>=` in the continuation test, dropping the `has_comments` condition, or dropping one strict-mode `elements_added` update each makes the differential fail (1,088, 120 and 6 of 1,500 cases).
- `npm test` replays `test/fixtures/differential.json.gz` (400 generated cases and 1,500 strings with CPython 3.14.7's results) without Python.

## Limitations

- The target is CPython 3.14 behaviour. Older Pythons differ in places (`allow_unnamed_section` needs 3.13). Other versions were not run.
- No `dict_type`. No mapping-protocol methods (`parser[name] = ...`, `popitem`, `len`, iteration); use `section()`, `readDict()` and `sections()`. Python's dynamically named `get<converter>` methods are `getConverted(name, ...)`.
- Values are strings or `null`. `defaults` and `set` reject other types, as `ConfigParser` does. `readDict` accepts strings, `null`, booleans, bigints and integer numbers; a non-integer number is not accepted because JS cannot tell `1.0` from `1`.
- `read` and `readBuffer` decode the whole input before parsing. Python decodes lazily, so after a decoding error in the middle of a file Python has already parsed the earlier lines and this library has parsed none. Supported encodings: `utf-8`, `utf-8-sig`, `latin-1`, `ascii`, `utf-16le`, `utf-16be`. Invalid input throws an `Error` named `UnicodeDecodeError`.
- Python's `AttributeError` for `getBoolean` on a valueless option is a `TypeError` here (same message).
- `sections()` returns the `UNNAMED_SECTION` symbol when `allowUnnamedSection` is set and options were read before the first header.
- Only configparser semantics. `pytest.ini`, and `[pytest]` in `tox.ini` or `setup.cfg`, are read by pytest with `iniconfig`, whose rules differ. tox's own substitution (`{posargs}`, `{[section]key}`), factor conditions and `setup.cfg` directives (`file:`, `attr:`) are not evaluated; the values come back as raw strings.
- Unicode data comes from CPython 3.14.7 (Unicode 16.0). The final-sigma rule uses the runtime's `Cased` and `Case_Ignorable` properties.

## Compatibility

- Run: Node 24.20.0 on macOS, CPython 3.14.7 (differential), TypeScript 5.
- `engines` is `>=20.6.0`. `.github/workflows/test.yml` runs the built-package smoke test on Node 20.6, 22 and 24 in CI; that matrix was not run locally. Windows was not run.

## Development

```sh
npm install
npm run typecheck
npm test                 # unit tests, fixture replay, live CPython comparison
npm run build && npm run test:dist
```

The live tests in `test/live.test.ts` need `python3` 3.14 on `PATH` and skip with a warning otherwise.

```sh
npm run diff -- 20000 1                  # generated cases against CPython
npm run diff:str -- 50000 1              # repr, lower, strip, int, float and all code points
npm run diff:corpus -- corpus.json       # a list of {id, text} in six configurations
npm run bench -- corpus.json <dir>       # the incumbent table above
npm run fixture                          # regenerate test/fixtures/differential.json.gz
python3 scripts/gen-unicode.py > src/unicode-data.ts
```

## License

MIT. See [LICENSE](LICENSE).

The parser is derived from CPython's `Lib/configparser.py`, which is distributed under the PSF License Agreement. The copyright notice is kept in the derived source files and the full license text is in [LICENSE-python](LICENSE-python).
