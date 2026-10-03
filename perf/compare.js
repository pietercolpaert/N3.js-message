// Compares `.perf-results/latest.json` with a baseline: `npm run perf:compare [baseline.json]`.
//
// 1. Guardrails (blocking): ratios between benchmarks of the SAME run, so they do not
//    depend on how fast the machine is. See perf/README.md for how every limit was chosen.
// 2. Baseline comparison (warning only, unless PERF_STRICT=1): per-benchmark slowdown
//    compared to the baseline file. Only meaningful on the machine that produced the baseline.
//
// Environment: PERF_STRICT=1 makes slowdowns blocking; PERF_WARN_PERCENT (default 50) is the slowdown that warns.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const latestOption = args.find(a => a.startsWith('--latest='));
const latestFile = path.resolve(latestOption ? latestOption.slice(9) : path.join(root, '.perf-results', 'latest.json'));
const baselineFile = path.resolve(positional[0] || path.join(root, 'perf', 'baseline.json'));
const strict = process.env.PERF_STRICT === '1';
const warnPercent = Number(process.env.PERF_WARN_PERCENT || 50);

function load(file, what) {
  if (!fs.existsSync(file)) {
    console.error(`${what} not found: ${file}${what === 'latest results' ? ' (run `npm run perf` first)' : ''}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function time(b, name) {
  return b[name].ms;
}

function perQuad(b, name) {
  return b[name].ms / b[name].quads;
}

// Every guardrail: a value computed from one run, and the limit it must stay under.
export const guardrails = [
  {
    id: 'one-message-vs-plain',
    description: 'parseMessages (one message) time / plain N3.js Parser time, large document',
    value: b => time(b, 'messages-one-L') / time(b, 'plain-n3-L'),
    max: 4,
  },
  {
    id: 'one-message-vs-plain-small',
    description: 'same, small document',
    value: b => time(b, 'messages-one-S') / time(b, 'plain-n3-S'),
    max: 6,
  },
  {
    id: 'stream-vs-sync',
    description: 'MessageStreamParser (64 KiB chunks) time / parseMessages time, large document',
    value: b => time(b, 'stream-64k-L') / time(b, 'messages-one-L'),
    max: 3,
  },
  {
    id: 'many-messages-sync-vs-stream',
    description: 'parseMessages / MessageStreamParser (64 KiB) on the same many-message log (sync must not be superlinear in the number of messages)',
    value: b => time(b, 'messages-many') / time(b, 'stream-64k-many'),
    max: 5,
  },
  {
    id: 'many-vs-few-messages',
    description: 'time per quad of many small messages / of few large messages (parseMessages)',
    value: b => perQuad(b, 'messages-many') / perQuad(b, 'messages-few-large'),
    max: 4,
  },
  {
    id: 'tiny-chunks-vs-64k',
    description: '16-byte chunks time / 64 KiB chunks time, same document',
    value: b => time(b, 'stream-16b-S') / time(b, 'stream-64k-S'),
    max: 5,
  },
  {
    id: 'tiny-chunks-linear',
    description: 'time per quad of 16-byte chunks, document of twice the size / document of normal size (linear: 1)',
    value: b => perQuad(b, 'stream-16b-2S') / perQuad(b, 'stream-16b-S'),
    max: 1.6,
  },
  {
    id: 'single-char-linear',
    description: 'time per quad of 1-character chunks, document of twice the size / normal size (linear: 1)',
    value: b => perQuad(b, 'stream-1ch-2C') / perQuad(b, 'stream-1ch-C'),
    max: 1.6,
  },
  {
    id: 'memory-flat',
    description: 'heap growth (MB, after gc) while streaming the many-message log, from 10% of the input to the end',
    value: b => b['memory-stream'].heapGrowthMB,
    max: 2,
    unit: 'MB',
  },
  {
    id: 'memory-vs-input',
    description: 'heap growth / streamed input size',
    value: b => b['memory-stream'].heapGrowthMB / b['memory-stream'].inputMB,
    max: 0.25,
  },
];

function runGuardrails(latest) {
  const failures = [];
  console.log(`Guardrails (ratios within one run; ${latest.meta.quick ? 'quick' : 'full'} run)`);
  for (const g of guardrails) {
    let value;
    try {
      value = g.value(latest.benchmarks);
    }
    catch {
      value = NaN;
    }
    const ok = Number.isFinite(value) && value <= g.max;
    if (!ok)
      failures.push(g);
    const shown = `${Number.isFinite(value) ? value.toFixed(2) : 'n/a'}${g.unit ? ` ${g.unit}` : ''}`;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${g.id.padEnd(30)} ${shown.padStart(8)}  max ${String(g.max).padEnd(5)}  ${g.description}`);
  }
  return failures;
}

// The same workloads with rdf-parser-ts and rdf-writer-ts (informational: it never fails the run)
const COMPETITOR_PAIRS = [
  ['plain-n3-L', 'rdfts-plain-L', 'parse, ordinary document, 100k quads'],
  ['messages-one-L', 'rdfts-messages-one-L', 'parse, one message, 100k quads'],
  ['messages-many', 'rdfts-messages-many', 'parse, 10k messages'],
  ['messages-few-large', 'rdfts-messages-few-large', 'parse, 10 messages x 10k quads'],
  ['stream-64k-L', 'rdfts-stream-64k-L', 'stream, 64 KiB chunks, 100k quads'],
  ['stream-64k-many', 'rdfts-stream-64k-many', 'stream, 64 KiB chunks, 10k messages'],
  ['stream-16b-S', 'rdfts-stream-16b-S', 'stream, 16-byte chunks, 10k quads'],
  ['stream-16b-many', 'rdfts-stream-16b-many', 'stream, 16-byte chunks, 10k messages'],
  ['stream-1ch-C', 'rdfts-stream-1ch-C', 'stream, 1-character chunks, 1k quads'],
  ['writer-one-nquads', 'rdfts-writer-one-nquads', 'write, one message, N-Quads'],
  ['writer-one-trig', 'rdfts-writer-one-trig', 'write, one message, TriG'],
  ['writer-many-nquads', 'rdfts-writer-many-nquads', 'write, 10k messages, N-Quads'],
  ['writer-many-trig', 'rdfts-writer-many-trig', 'write, 10k messages, TriG'],
  ['memory-stream', 'rdfts-memory-stream', 'stream of 100k messages'],
];

function compareToCompetitor(latest) {
  const rows = COMPETITOR_PAIRS.filter(([ours, theirs]) => latest.benchmarks[ours] && latest.benchmarks[theirs]);
  if (rows.length === 0)
    return;
  console.log('\nn3.js-messages vs rdf-parser-ts / rdf-writer-ts (informational; speed > 1 means n3.js-messages is faster)');
  console.log(`  ${'workload'.padEnd(40)} ${'ours quads/s'.padStart(13)} ${'theirs quads/s'.padStart(15)} ${'speed'.padStart(7)}`);
  for (const [ours, theirs, label] of rows) {
    const a = latest.benchmarks[ours], b = latest.benchmarks[theirs];
    const heap = a.heapGrowthMB === undefined ? '' : `   heap growth ${a.heapGrowthMB.toFixed(2)} MB vs ${b.heapGrowthMB.toFixed(2)} MB`;
    console.log(`  ${label.padEnd(40)} ${Math.round(a.quadsPerSec).toLocaleString('en-US').padStart(13)} ` +
      `${Math.round(b.quadsPerSec).toLocaleString('en-US').padStart(15)} ${`x${(a.quadsPerSec / b.quadsPerSec).toFixed(2)}`.padStart(7)}${heap}`);
  }
}

function compareToBaseline(latest, baseline) {
  console.log(`\nComparison with ${path.relative(root, baselineFile)} (baseline: ${baseline.meta.timestamp}, ${baseline.meta.cpu}, node ${baseline.meta.node})`);
  if (baseline.meta.quick !== latest.meta.quick) {
    console.log(`  skipped: the baseline is a ${baseline.meta.quick ? 'quick' : 'full'} run, the latest a ${latest.meta.quick ? 'quick' : 'full'} one`);
    return [];
  }
  if (baseline.meta.cpu !== latest.meta.cpu)
    console.log('  note: different CPU than the baseline, absolute differences are not meaningful');
  const slow = [];
  for (const name of Object.keys(latest.benchmarks).filter(n => !n.startsWith('rdfts-'))) {
    const was = baseline.benchmarks[name];
    if (!was)
      console.log(`  ${name.padEnd(28)} no baseline`);
    else {
      const ratio = latest.benchmarks[name].ms / was.ms;
      const warn = ratio > 1 + warnPercent / 100;
      if (warn)
        slow.push(name);
      console.log(`  ${warn ? 'SLOW' : '    '}  ${name.padEnd(28)} ${was.ms.toFixed(1).padStart(9)} ms -> ${latest.benchmarks[name].ms.toFixed(1).padStart(9)} ms  x${ratio.toFixed(2)}`);
    }
  }
  return slow;
}

const latest = load(latestFile, 'latest results');
const failures = runGuardrails(latest);
compareToCompetitor(latest);
let slow = [];
if (fs.existsSync(baselineFile))
  slow = compareToBaseline(latest, load(baselineFile, 'baseline'));
else
  console.log(`\nNo baseline at ${baselineFile}, skipping the baseline comparison`);

if (slow.length > 0) {
  console.log(`\n${strict ? 'ERROR' : 'warning'}: ${slow.length} benchmark(s) more than ${warnPercent}% slower than the baseline: ${slow.join(', ')}${strict ? '' : ' (not blocking; set PERF_STRICT=1 to block)'}`);
}
if (failures.length > 0)
  console.log(`\nERROR: ${failures.length} guardrail(s) violated: ${failures.map(g => g.id).join(', ')}`);
process.exit(failures.length > 0 || strict && slow.length > 0 ? 1 : 0);
