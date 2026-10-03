// Packs the package and checks it in a clean consumer project (ESM, CommonJS and TypeScript).
//
//   npm run test:package
//   N3_VERSION=2.0.0 npm run test:package
//
// Needs network access to the npm registry.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONSUMER_FIXTURES = path.join(ROOT, 'scripts', 'consumer');
const N3_VERSION = process.env.N3_VERSION || 'latest';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let failures = 0;

function pass(name, detail) {
  console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`);
}

function fail(name, error) {
  failures++;
  const message = error && error.stderr ? `${error.message}\n${error.stderr}${error.stdout || ''}` : (error && error.message) || error;
  console.log(`FAIL ${name}\n${String(message).trim().replace(/^/gm, '     ')}`);
}

// Runs a named check; failures are reported without stopping the other checks
function check(name, action) {
  try {
    const detail = action();
    pass(name, detail);
    return true;
  }
  catch (error) {
    fail(name, error);
    return false;
  }
}

function run(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function formatSize(bytes) {
  return bytes > 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${bytes} B`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n3js-messages-package-'));
try {
  console.log(`Temporary directory: ${tmp}`);
  console.log(`n3 version under test: ${N3_VERSION}`);

  // ## Pack
  const packDir = path.join(tmp, 'pack');
  fs.mkdirSync(packDir);
  let tarball, packed;
  try {
    const output = run(NPM, ['pack', '--json', '--pack-destination', packDir], { cwd: ROOT });
    packed = JSON.parse(output.slice(output.indexOf('[')))[0];
    tarball = path.join(packDir, packed.filename);
    pass('npm pack', packed.filename);
  }
  catch (error) {
    fail('npm pack', error);
    throw new Error('Cannot continue without a tarball');
  }

  // ## Tarball contents
  const files = packed.files.map(file => file.path).sort();
  console.log(`Tarball ${packed.filename}: ${formatSize(fs.statSync(tarball).size)} packed, ${formatSize(packed.unpackedSize)} unpacked, ${files.length} files`);
  for (const file of files)
    console.log(`  ${file}`);
  check('tarball contains only src/, lib/, index.d.ts, package.json, README, LICENSE', () => {
    const allowed = /^(?:src\/|lib\/|index\.d\.ts$|package\.json$|README(?:\.md)?$|LICENSE(?:\.md|\.txt)?$)/i;
    const development = /(?:^|\/)(?:test|perf|spec|scripts|scratch)\//;
    const unexpected = [];
    const leaked = [];
    for (const file of files) {
      if (!allowed.test(file))
        unexpected.push(file);
      if (development.test(file))
        leaked.push(file);
    }
    if (leaked.length > 0)
      throw new Error(`Development files in package: ${leaked.join(', ')}`);
    if (unexpected.length > 0)
      throw new Error(`Unexpected files: ${unexpected.join(', ')}`);
  });
  check('tarball contains the entry points', () => {
    for (const file of ['index.d.ts', 'package.json', 'src/index.js', 'lib/index.js', 'lib/package.json'])
      if (!files.includes(file))
        throw new Error(`Missing ${file}`);
  });
  const packedManifest = JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']));
  check('package.json declares n3 as peer and @rdfjs/types as dependency', () => {
    if (!packedManifest.peerDependencies || !packedManifest.peerDependencies.n3)
      throw new Error('Missing peerDependencies.n3');
    if (!packedManifest.dependencies || !packedManifest.dependencies['@rdfjs/types'])
      throw new Error('index.d.ts imports @rdfjs/types, but it is not in "dependencies"');
  });

  // ## Consumer project
  const consumer = path.join(tmp, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }));
  const npmConfig = ['--no-audit', '--no-fund', '--no-progress'];
  try {
    run(NPM, ['install', ...npmConfig, `n3@${N3_VERSION}`, tarball], { cwd: consumer });
    run(NPM, ['install', ...npmConfig, '--save-dev', 'typescript', '@types/node'], { cwd: consumer });
    pass('install tarball and n3 into a clean project');
  }
  catch (error) {
    fail('install tarball and n3 into a clean project', error);
    throw new Error('Cannot continue without an installed consumer');
  }
  const n3Installed = JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules', 'n3', 'package.json'), 'utf8')).version;
  console.log(`Installed n3 ${n3Installed}`);
  check(`n3 version matches request (${N3_VERSION})`, () => {
    if (N3_VERSION !== 'latest' && /^\d+\.\d+\.\d+$/.test(N3_VERSION) && n3Installed !== N3_VERSION)
      throw new Error(`Installed ${n3Installed}`);
    return n3Installed;
  });
  check('package is installed from the tarball, not linked', () => {
    if (fs.lstatSync(path.join(consumer, 'node_modules', 'n3.js-messages')).isSymbolicLink())
      throw new Error('node_modules/n3.js-messages is a symlink');
  });

  fs.copyFileSync(path.join(CONSUMER_FIXTURES, 'esm.mjs'), path.join(consumer, 'esm.mjs'));
  fs.copyFileSync(path.join(CONSUMER_FIXTURES, 'cjs.cjs'), path.join(consumer, 'cjs.cjs'));
  check('ESM consumer (import)', () => run(process.execPath, ['esm.mjs'], { cwd: consumer }).trim());
  check('CommonJS consumer (require), single n3 install', () => run(process.execPath, ['cjs.cjs'], { cwd: consumer }).trim());

  // ## TypeScript
  for (const file of ['types.mts', 'types.cts'])
    fs.copyFileSync(path.join(CONSUMER_FIXTURES, file), path.join(consumer, file));
  const rdfTypesInstalled = fs.existsSync(path.join(consumer, 'node_modules', '@rdfjs', 'types'));
  if (!rdfTypesInstalled) {
    // Make the TypeScript check independent of the missing dependency (reported above)
    run(NPM, ['install', ...npmConfig, '--save-dev', '@rdfjs/types'], { cwd: consumer });
  }
  fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true, noEmit: true, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', types: ['node'], skipLibCheck: false,
    },
    files: ['types.mts', 'types.cts'],
  }));
  check('TypeScript consumer compiles against index.d.ts (ESM and CJS)', () => {
    const tsc = path.join(consumer, 'node_modules', 'typescript', 'bin', 'tsc');
    const version = run(process.execPath, [tsc, '--version'], { cwd: consumer }).trim();
    run(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: consumer });
    return version.toLowerCase();
  });
}
catch (error) {
  if (!/^Cannot continue/.test(error.message))
    fail('unexpected error', error);
}
finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll package checks passed' : `\n${failures} package check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
