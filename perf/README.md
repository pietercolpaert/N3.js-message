# Performance suite

Benchmarks for n3.js-messages, in the spirit of the `perf/` directory of N3.js. All input is generated
(`data.js`, seeded PRNG), so every run benchmarks identical bytes. No dependencies beyond `n3`.

```
npm run perf                    # full run (about 1.5 minutes), writes .perf-results/latest.json
PERF_QUICK=1 npm run perf       # smoke run with smaller sizes (also: npm run perf -- --quick), about 10 seconds
npm run perf -- --filter=stream # only benchmarks whose name contains "stream"
npm run perf:compare            # guardrails + comparison with perf/baseline.json
npm run perf:compare -- other.json   # other baseline
PERF_SRC=/path/to/index.js npm run perf   # benchmark another build of the package (A/B)
```

`run.js` re-launches itself with `--expose-gc`, runs every benchmark once as warm-up and then 5 times (3 in quick mode),
and reports the median. `peak MB` is the heap growth right after the run without a gc (an approximation of the peak: input,
output and not yet collected garbage); `kept MB` is the heap growth after a forced gc while the result is still referenced.
The JSON contains the node version, platform, CPU, timestamp and every number.

## What is measured

Sizes: S = 10k quads, L = 100k quads (quick: 1k and 10k). "many" is 10k messages of 5 quads (quick: 1k), "few-large" is 10 messages
of 10k quads (quick: 1k). Documents are Turtle with prefixed names, plain/language/typed literals (some with escapes) and blank nodes;
writer inputs are quads with a few named graphs.

| benchmark | what |
| --- | --- |
| `plain-n3-S/L` | baseline: N3.js `Parser.parse` on an ordinary document |
| `messages-one-S/L` | `parseMessages` on the same quads, with a version line: one message |
| `messages-many`, `messages-few-large` | `parseMessages` on many small / few large messages |
| `stream-64k-S/L/many` | `MessageStreamParser`, 64 KiB Buffer chunks |
| `stream-16b-S/2S/many` | 16-byte chunks; `2S` has twice the quads of `S` |
| `stream-1ch-C/2C` | 1-character chunks on a 1k (`C`) and 2k (`2C`) quad document |
| `writer-one-nquads/trig`, `writer-many-nquads/trig` | `writeMessages`: one 100k-quad message, 10k messages |
| `writer-stream-many-nquads` | `MessageStreamWriter` on the 10k messages |
| `memory-stream` | 100k messages (17 MB, generated on the fly, never held in memory) through `MessageStreamParser` in 64 KiB chunks; the consumer drops each message; heap is sampled after gc at every 10% |

## Guardrails (`compare.js`)

Guardrails are ratios between benchmarks of one run, so they do not depend on machine speed. `perf:compare` exits non-zero only
when one is violated. Limits were set from 4 full and 6 quick runs of the suite (worst observed ratio over all of them, with the
`MessageScanner` quadratic bug described below patched in a scratch copy, as the limits describe healthy behaviour), leaving roughly
2 to 3 times headroom, because shared CI runners are noisier than a dev machine.

| guardrail | worst observed | limit | why |
| --- | --- | --- | --- |
| one-message `parseMessages` / plain N3.js (L) | 1.64 | 4 | the scanner and quad scoping are a constant-factor layer over N3.js (typically 1.0 to 1.4); 2.4x headroom |
| same, S | 2.82 | 6 | small documents are dominated by JIT warm-up and noise; 2.1x headroom |
| `MessageStreamParser` 64 KiB / `parseMessages` (L) | 0.97 | 3 | streaming should cost the same as parsing at once (about 0.9); 3x headroom |
| `parseMessages` / `MessageStreamParser` on the many-message log | 2.07 | 5 | same input, same work: a sync parse must not be superlinear in the number of messages (see finding); 2.4x headroom |
| time per quad, many small / few large messages | 1.71 | 4 | the per-message overhead must stay a constant; 2.3x headroom |
| 16-byte chunks / 64 KiB chunks (S) | 1.78 | 5 | many tiny chunks cost a constant factor, not O(input x chunks); 2.8x headroom |
| per-quad time, 16-byte chunks, 2S / S | 1.00 | 1.6 | linearity: linear is 1, quadratic would be 2 (doubling the input), so the limit lies between the worst noise (about 1.2) and 2 |
| per-quad time, 1-char chunks, 2C / C | 1.18 | 1.6 | same |
| heap growth while streaming 100k messages (MB) | 0.43 | 2 | flat heap: a leak of 100 bytes per message would be 10 MB; 4.6x headroom for gc timing noise |
| heap growth / streamed MB | 0.12 | 0.25 | the leak must not scale with the input |

Per-benchmark slowdown against `baseline.json` (more than `PERF_WARN_PERCENT`, default 50 percent) only prints a warning, and blocks
only with `PERF_STRICT=1`: absolute times are only comparable on the machine that recorded the baseline. The comparison is skipped
when the baseline and the latest run differ in quick/full mode.

To record a new baseline: `npm run perf && cp .perf-results/latest.json perf/baseline.json`.

## Finding (fixed): `parseMessages` was quadratic in the number of delimiters per chunk

The first version of the scanner called `out.charCodeAt(out.length - 1)` for every delimiter on a growing, concatenated string, which
makes V8 flatten the rope every time: O(delimiters x output). `parseMessages` hands the whole input to the scanner in one call, so
10k messages took 3.9 s (2.5k: 248 ms, 5k: 1,040 ms, 10k: 4,051 ms, 20k: 17,667 ms, x4 per doubling), about 40x the streaming parser.
The scanner now remembers the character before a delimiter candidate; the same workload takes 93 ms. The guardrails
`many-messages-sync-vs-stream` and `many-vs-few-messages` guard against a regression.

## Baseline (node v25.9.0, 12th Gen Intel(R) Core(TM) i7-1265U, linux/x64)

Recorded in `baseline.json` (full run, 5 iterations, median):

```
benchmark                       ms    quads    quads/s   msgs/s   MB/s  peak MB  kept MB
-------------------------  -------  -------  ---------  -------  -----  -------  -------
plain-n3-S                    16.2   10,000    618,528        -   20.1     15.3      3.5
plain-n3-L                   145.3  100,000    688,254        -   22.4     86.0     35.2
messages-one-S                22.5   10,000    444,725        -   14.5     14.7      3.8
messages-one-L               139.1  100,000    718,706        -   23.4     58.0     37.4
messages-many                 85.0   50,000    587,923  117,585   20.4     36.9     21.1
messages-few-large           147.0  100,000    680,417       68   22.1     59.3     37.3
stream-64k-S                  14.5   10,000    691,861        -   22.5     14.9      0.0
stream-64k-L                 127.5  100,000    784,390        -   25.5     63.0      0.0
stream-64k-many               61.5   50,000    813,287  162,657   28.2     25.5      0.0
stream-16b-S                  21.6   10,000    463,960        -   15.1     24.0      0.0
stream-16b-2S                 43.4   20,000    461,259        -   15.1     48.2      0.0
stream-16b-many              111.5   50,000    448,374   89,675   15.5      9.3      0.0
stream-1ch-C                   8.6    1,000    116,691        -    3.8     15.5      0.0
stream-1ch-2C                 16.9    2,000    118,021        -    3.8     31.2      0.0
writer-one-nquads             55.8  100,000  1,793,109        -  166.4     61.6      0.0
writer-one-trig               60.0  100,000  1,666,759        -  135.1     56.9      0.0
writer-many-nquads            42.5   50,000  1,176,529  235,306  110.9     41.1      0.0
writer-many-trig              48.1   50,000  1,039,307  207,861   86.8     42.0      0.0
writer-stream-many-nquads     42.2   50,000  1,185,209  237,042  111.7     52.1      0.0
memory-stream              1,293.1  500,000    386,677   77,335   13.4        -        -
rdfts-plain-S                 18.9   10,000    529,954        -   17.2     10.5      3.7
rdfts-plain-L                119.5  100,000    836,712        -   27.2     62.5     37.2
rdfts-messages-one-S          17.4   10,000    575,532        -   18.7     11.7      3.6
rdfts-messages-one-L         143.7  100,000    696,128        -   22.6     49.5     36.0
rdfts-messages-many           72.4   50,000    690,682  138,136   23.9     63.6     20.9
rdfts-messages-few-large     134.2  100,000    745,163       75   24.2     49.4     35.9
rdfts-stream-64k-L           147.1  100,000    679,606        -   22.1      7.1      0.0
rdfts-stream-64k-many         91.1   50,000    548,846  109,769   19.0      7.8      0.0
rdfts-stream-16b-S            39.4   10,000    254,082        -    8.3     43.6      0.1
rdfts-stream-16b-2S           68.0   20,000    294,253        -    9.6     21.6      0.0
rdfts-stream-16b-many        156.2   50,000    320,106   64,021   11.1     33.0      0.0
rdfts-stream-1ch-C            13.2    1,000     76,035        -    2.5     17.1      0.0
rdfts-stream-1ch-2C           21.9    2,000     91,482        -    3.0     33.6      0.0
rdfts-writer-one-nquads       59.6  100,000  1,677,812        -  155.7     63.7      0.0
rdfts-writer-one-trig         61.1  100,000  1,635,803        -  132.6     59.0      0.0
rdfts-writer-many-nquads      32.5   50,000  1,539,788  307,958  145.1     33.0      0.0
rdfts-writer-many-trig        36.4   50,000  1,374,039  274,808  114.7     30.4      0.0
rdfts-memory-stream        1,494.8  500,000    334,501   66,900   11.6        -        -

memory-stream: 100,000 messages, 17.3 MB streamed; heap after gc (MB): 7.5, 7.4, 7.3, 7.6, 7.6, 7.4, 7.2, 7.6, 7.5; growth 0.12 MB
rdfts-memory-stream: 100,000 messages, 17.3 MB streamed; heap after gc (MB): 8.0, 7.8, 7.6, 8.0, 7.9, 7.7, 7.6, 7.9, 7.8; growth 0.08 MB
```

## Comparison with rdf-parser-ts and rdf-writer-ts

[rdf-parser-ts](https://github.com/pietercolpaert/rdf-parser-ts) and its sibling [rdf-writer-ts](https://github.com/pietercolpaert/rdf-writer-ts)
(devDependencies, Node.js >= 22) also support RDF Messages, with a standalone parser instead of a layer over N3.js.
The `rdfts-*` benchmarks run the same generated documents and messages through them (`Parser#parse`/`parseMessages`, `StreamParser` with the
same chunks, `Writer#addMessage`); `rdfts-<name>` is the counterpart of `<name>`. Both produce the same number of quads and messages
(checked while developing the benchmarks). Skip them with `PERF_NO_COMPETITORS=1`; they are also skipped when the packages cannot be loaded.
`npm run perf:compare` prints the comparison, which is informational and never fails the run.

Same run as the baseline above (speed > 1: n3.js-messages is faster; the `rdfts-*` rows hold their absolute numbers):

```
  workload                                  ours quads/s  theirs quads/s   speed
  parse, ordinary document, 100k quads           688,254         836,712   x0.82
  parse, one message, 100k quads                 718,706         696,128   x1.03
  parse, 10k messages                            587,923         690,682   x0.85
  parse, 10 messages x 10k quads                 680,417         745,163   x0.91
  stream, 64 KiB chunks, 100k quads              784,390         679,606   x1.15
  stream, 64 KiB chunks, 10k messages            813,287         548,846   x1.48
  stream, 16-byte chunks, 10k quads              463,960         254,082   x1.83
  stream, 16-byte chunks, 10k messages           448,374         320,106   x1.40
  stream, 1-character chunks, 1k quads           116,691          76,035   x1.53
  write, one message, N-Quads                  1,793,109       1,677,812   x1.07
  write, one message, TriG                     1,666,759       1,635,803   x1.02
  write, 10k messages, N-Quads                 1,176,529       1,539,788   x0.76
  write, 10k messages, TriG                    1,039,307       1,374,039   x0.76
  stream of 100k messages                        386,677         334,501   x1.16   heap growth 0.12 MB vs 0.08 MB
```

Reading this, with the caveats of a single machine, one Node.js version and benchmarks that run in one process (JIT and gc state are shared,
the order is: ours first, then theirs):

- **Parsing a whole string** is faster with rdf-parser-ts: 0.82-0.91x for our `parseMessages`. This is expected, as `parseMessages` is N3.js plus
  a scanner (about as fast as plain N3.js parsing, see the guardrails), and rdf-parser-ts also parses an ordinary document 1.2x faster than N3.js.
- **Streaming** is faster here, 1.15x to 1.8x, and the gap is largest for tiny chunks (16 bytes: 1.4-1.8x), which fits the design of the two: our scanner and the
  N3.js lexer work incrementally, while rdf-parser-ts (by its own documentation) runs its core parser on every complete statement prefix of the
  buffered input. I did not profile it to confirm that this is the cause.
- **Writing** one large message is on par (1.02-1.07x); many small messages are faster with rdf-writer-ts (0.76x), as we create an N3.js writer per message.
- **Memory** is flat for both when streaming 100k messages (0.12 MB vs 0.08 MB heap growth, noise level).
