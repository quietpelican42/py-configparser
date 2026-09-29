/**
 * Reads config text the way three Python tools do and prints what each sees.
 *
 *   node examples/tools.ts
 */
import { ConfigParser, MissingSectionHeaderError, ParsingError, presets } from '../src/index.ts';

const toxIni = `[tox]
envlist = py{310,311}, lint

[testenv]
deps =
    pytest>=7
    py311: coverage
commands = pytest {posargs}
`;

const tox = presets.tox();
tox.readString(toxIni, 'tox.ini');
console.log('tox deps     :', JSON.stringify(tox.get('testenv', 'deps')));
console.log('tox commands :', JSON.stringify(tox.get('testenv', 'commands')));

const setupCfg = `[metadata]
name = demo
version = 1.0

[options]
python_requires = >=3.9
install_requires =
    requests>=2
    click
`;
const setup = presets.setuptools();
setup.readString(setupCfg, 'setup.cfg');
console.log('install_requires:', setup.get('options', 'install_requires')?.split('\n').filter(Boolean));

const flake8 = presets.flake8();
flake8.readString('[flake8]\nmax-line-length = 100\nper-file-ignores =\n    a.py: E501\n    b.py: F401\n', '.flake8');
console.log('flake8 max-line-length:', flake8.getInt('flake8', 'max-line-length'));

for (const [label, text] of [['bad line', '[a]\nk = 1\nnot an option\n'], ['no header', 'k = 1\n']] as const) {
  try {
    new ConfigParser().readString(text, 'demo.cfg');
  } catch (e) {
    const kind = e instanceof MissingSectionHeaderError ? 'MissingSectionHeaderError' : e instanceof ParsingError ? 'ParsingError' : 'other';
    console.log(`${label}: ${kind}: ${JSON.stringify((e as Error).message)}`);
  }
}

console.log(JSON.stringify(setup.write()));
