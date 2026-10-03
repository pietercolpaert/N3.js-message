// Runs the whole performance suite: `npm run perf`.
//
//   PERF_QUICK=1 npm run perf        (or: npm run perf -- --quick)   smoke run with smaller sizes
//   npm run perf -- --filter=stream   only benchmarks whose name contains "stream"
//   npm run perf -- --out=file.json   write the results elsewhere
//
// Every benchmark is warmed up once, then run several times; the median is reported.
// The suite re-launches itself with `--expose-gc`, so heap numbers are taken after a forced gc.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (typeof global.gc !== 'function') {
  const child = spawnSync(process.execPath, ['--expose-gc', ...process.argv.slice(1)], { stdio: 'inherit' });
  process.exit(child.status === null ? 1 : child.status);
}

const { createBenchmarks, sizes } = await import(/* webpackChunkName: "benchmarks" */ './benchmarks.js');

const quick = process.env.PERF_QUICK === '1' || args.includes('--quick');
function option(name) {
  return (args.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
}
const filter = option('filter');
const outFile = path.resolve(option('out') || path.join(root, '.perf-results', 'latest.json'));
const iterations = quick ? 3 : 5;
const MB = 1024 * 1024;

function gc() {
  global.gc();
  global.gc();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// One timed execution, with heap numbers
async function measure(run) {
  gc();
  const base = process.memoryUsage().heapUsed;
  const start = process.hrtime.bigint();
  const result = await run();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  // Without gc: input, result and garbage that was not yet collected (approximates the peak)
  const peak = process.memoryUsage().heapUsed;
  gc();
  // With gc, while the result is still reachable: what the parse retains
  const retained = process.memoryUsage().heapUsed;
  const keep = result.keep;
  result.keep = null;
  return { ms, peakMB: Math.max(0, peak - base) / MB, retainedMB: Math.max(0, retained - base) / MB, result, keep };
}

async function runBenchmark(benchmark, s) {
  const run = await benchmark.setup(s, gc);
  const n = benchmark.once ? 1 : iterations;
  if (!benchmark.once)
    await measure(run);
  const runs = [];
  for (let i = 0; i < n; i++)
    runs.push(await measure(run));
  const ms = median(runs.map(r => r.ms));
  const typical = runs.find(r => r.ms === ms) || runs[0];
  const { quads, messages, bytes, extra } = typical.result;
  return {
    ms,
    minMs: Math.min(...runs.map(r => r.ms)),
    maxMs: Math.max(...runs.map(r => r.ms)),
    iterations: n,
    quads,
    messages,
    bytes,
    quadsPerSec: quads / (ms / 1000),
    messagesPerSec: messages > 1 ? messages / (ms / 1000) : null,
    mbPerSec: bytes / MB / (ms / 1000),
    // Not meaningful for the long-running memory benchmark, which reports its own heap samples
    peakMB: benchmark.once ? null : median(runs.map(r => r.peakMB)),
    retainedMB: benchmark.once ? null : median(runs.map(r => r.retainedMB)),
    ...extra,
  };
}

function fmt(value, digits = 0) {
  return value === null || value === undefined ? '-' :
    value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const s = sizes(quick);
const results = {};
const benchmarks = createBenchmarks().filter(b => !filter || b.name.includes(filter));
console.log(`n3.js-messages performance suite (${quick ? 'quick' : 'full'}, ${iterations} iterations + warm-up, median)`);
console.log(`node ${process.version}, ${os.cpus()[0].model}, ${process.platform}/${process.arch}\n`);

const header = ['benchmark', 'ms', 'quads', 'quads/s', 'msgs/s', 'MB/s', 'peak MB', 'kept MB'];
const rows = [header];
for (const benchmark of benchmarks) {
  if (process.stdout.isTTY)
    process.stdout.write(`running ${benchmark.name} ...\r`);
  else
    console.error(`running ${benchmark.name}`);
  const r = await runBenchmark(benchmark, s);
  results[benchmark.name] = r;
  rows.push([benchmark.name, fmt(r.ms, 1), fmt(r.quads), fmt(r.quadsPerSec), fmt(r.messagesPerSec), fmt(r.mbPerSec, 1),
    fmt(r.peakMB, 1), fmt(r.retainedMB, 1)]);
}

const widths = [];
for (let i = 0; i < header.length; i++)
  widths.push(Math.max(...rows.map(r => r[i].length)));
function line(row) {
  return row.map((cell, i) => i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])).join('  ');
}
if (process.stdout.isTTY)
  process.stdout.write(`${' '.repeat(60)}\r`);
console.log(line(rows[0]));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
rows.slice(1).forEach(row => console.log(line(row)));
for (const name of ['memory-stream', 'rdfts-memory-stream']) {
  const memory = results[name];
  if (memory) {
    console.log(`\n${name}: ${fmt(memory.messages)} messages, ${fmt(memory.inputMB, 1)} MB streamed; heap after gc (MB): ` +
      `${memory.heapSamplesMB.map(x => x.toFixed(1)).join(', ')}; growth ${fmt(memory.heapGrowthMB, 2)} MB`);
  }
}

const output = {
  meta: {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: os.cpus()[0].model,
    cpus: os.cpus().length,
    quick,
    iterations,
    sizes: s,
    filter: filter || null,
  },
  benchmarks: results,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nresults written to ${path.relative(root, outFile)}`);
