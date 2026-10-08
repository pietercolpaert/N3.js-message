# n3.js-messages

[![CI](https://github.com/pietercolpaert/n3.js-messages/actions/workflows/ci.yml/badge.svg)](https://github.com/pietercolpaert/n3.js-messages/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/pietercolpaert/n3.js-messages/badge.svg?branch=main)](https://coveralls.io/github/pietercolpaert/n3.js-messages?branch=main)
[![npm version](https://img.shields.io/npm/v/n3.js-messages.svg)](https://www.npmjs.com/package/n3.js-messages)
[![license](https://img.shields.io/npm/l/n3.js-messages.svg)](https://github.com/pietercolpaert/n3.js-messages/blob/main/LICENSE)

[RDF Messages](https://w3c-cg.github.io/rsp/spec/messages) for [N3.js](https://github.com/rdfjs/N3.js):
parse, stream and write message-delimited **Turtle, TriG, N-Triples and N-Quads**, with ordinary RDF/JS `Quad` objects.

## What this package is

An RDF Message Log is an RDF document in which `MESSAGE` delimiters group the triples or quads into *messages*, so that a
stream of RDF can be written to a file (or a socket) and read again as the same stream of messages.
This package adds that to N3.js **as an extension**: it depends on the public API of the `n3` package (a peer dependency), and
does not fork, patch or copy N3.js. The syntax of the statements is still parsed and written by N3.js.

## Status

RDF Messages is a *Living Document* of the [W3C RDF Stream Processing Community Group](https://www.w3.org/community/rsp/);
it is **not a W3C Recommendation**, and may still change. This package implements the specification of 25 September 2026
(upstream commit `9c3b947`) and is versioned `0.x` accordingly.

## Installation

```sh
npm install n3 n3.js-messages
```

Requires Node.js ≥ 18 and `n3` ≥ 2.13.7 < 3. The package works with `import` and `require`, and ships TypeScript declarations.

## Parsing

```js
import { parseMessages } from 'n3.js-messages';

const messages = parseMessages(`
VERSION "1.2-messages"
PREFIX ex: <http://example.org/>

ex:alice ex:says "Hello" .
MESSAGE
ex:bob ex:says "Hi" .
MESSAGE
MESSAGE
ex:carol ex:says "Bye" .
`, { format: 'Turtle' });

// An array of messages; a message is an array of RDF/JS quads, in document order
console.log(messages.length);        // 4 (the third message is empty)
console.log(messages[1][0].object);  // Literal "Hi"
```

`format` is `'Turtle'`, `'TriG'` (the default), `'N-Triples'` or `'N-Quads'` (or the matching media type).
Other options: `baseIRI`, `factory` (any RDF/JS `DataFactory`), `blankNodePrefix`, and `version` / `messages: true` to announce
a message log without a `VERSION` line (for example when the media type says so).
`MessageParser` offers callbacks instead of an array:

```js
import { MessageParser } from 'n3.js-messages';

new MessageParser({ format: 'TriG' }).parse(text, {
  onMessage: (error, message, prefixes, index) => { /* message === null at the end */ },
  onQuad: (error, quad, messageIndex) => { /* optional */ },
  onPrefix: (prefix, iri) => {},
  onVersion: label => {},
});
```

Messages are not merged, empty messages are preserved, and quads keep the order of the document.
A document that does not announce a `-messages` version is one message, and a delimiter in it is an error.

## Streaming

`MessageStreamParser` is a Node.js stream: text (or bytes) in, one array of quads per message out, **as soon as the message is
complete**, with normal backpressure. It never buffers the input, and keeps nothing of messages that it already emitted.

```js
import { createReadStream } from 'node:fs';
import { MessageStreamParser } from 'n3.js-messages';

const messages = createReadStream('log.trig').pipe(new MessageStreamParser({ format: 'TriG' }));
for await (const message of messages)
  console.log(`message with ${message.length} quads`);
// parser.on('prefix', (prefix, iri) => …) and parser.on('version', label => …) are emitted too
```

Chunk boundaries may be anywhere (inside `MESSAGE`, inside an IRI, between the bytes of a character, after the CR of a CRLF);
the result is identical to parsing the whole string at once.

## Writing

```js
import { MessageWriter, MessageStreamWriter, writeMessages } from 'n3.js-messages';
import { DataFactory } from 'n3';
const { namedNode, literal, quad } = DataFactory;

const writer = new MessageWriter(process.stdout, { format: 'TriG', prefixes: { ex: 'http://example.org/' } });
await writer.addMessage([quad(namedNode('http://example.org/alice'), namedNode('http://example.org/says'), literal('Hello'))]);
await writer.addMessage([]);                       // empty messages are written, too
await writer.end();

const text = writeMessages(messages, { format: 'N-Quads' });  // synchronous, returns a string
```

- Writes `VERSION "1.2-messages"` (`@version "1.2-messages".` in Turtle/TriG) first, and a delimiter after each message:
  `MESSAGE` in N-Triples and N-Quads, `@message .` in Turtle and TriG. A parser gets a message when it is written, and a trailing empty
  message survives a round trip.
- Each message starts from a clean serializer state, so consecutive messages in the same named graph are valid. Prefixes (and `baseIRI` with
  `writeBase: true`) are declared once; `addPrefix` declares more before the next message.
- `addMessage` and `end` accept a callback or return a promise. They complete when the output stream has accepted the data, not when it was queued.
- `MessageStreamWriter` is the `Transform` equivalent: messages in (object mode), text out.

## Blank node semantics

Blank node labels are **scoped to their message**: `_:a` in message 1 and `_:a` in message 2 are different blank nodes, also when the
whole log is parsed by one parser instance, from one stream, with any data factory. Within one message a label is one node.
Consequently, a blank node that the same quad objects share between two messages is *written* with the same label twice, and
comes back as two nodes. Prefixes and the base IRI, on the other hand, stay in effect across messages (and a later `PREFIX` overrides).

## Supported syntaxes

| Syntax | Version announcement | Delimiter | Graphs |
| --- | --- | --- | --- |
| Turtle | `VERSION "1.2-messages"` or `@version "1.2-messages" .` | `MESSAGE` or `@message .` | – |
| TriG | idem | `MESSAGE` or `@message .` | graph blocks |
| N-Triples | `VERSION "1.2-messages"` | `MESSAGE` (own line) | – |
| N-Quads | `VERSION "1.2-messages"` | `MESSAGE` (own line) | fourth term |

The labels `1.2-messages`, `1.2-basic-messages` and `1.1-messages` are accepted. Not supported: NDJSON-LD, YAML-LD, RDF/XML message logs,
Jelly, Notation3. Syntax details and ambiguities of the specification are in [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md).

## Specification compliance

The [RDF Messages test suite](https://w3c-cg.github.io/rsp/spec/messages-tests) is vendored at a pinned upstream revision and run by
`npm run test:spec` (see [spec/README.md](spec/README.md)). The suite is a prose document, so the cases are extracted from it
mechanically; each parsing case runs through the synchronous parser and through the stream parser with one character per chunk.

Result of the run for this version (node 25.9.0, n3 2.10.6): **16 passed, 0 failed, 12 skipped** of 28 cases.
The 12 skipped cases do not apply to RDF syntax parsers and serializers: 7 test protocol adapters (SSE, WebSocket, Kafka, MQTT, other brokers,
Jelly gRPC), and 5 are about NDJSON-LD, a different serialization. The run prints each skipped case with its reason.
`npm run test:spec:earl` writes an EARL report.

Beyond the suite there are 312 unit, regression, property and differential tests (100% statement, branch, function and line coverage),
including every possible two-chunk split of the fixtures, deterministic randomized chunking, per-byte streaming, and the regressions of
the review of N3.js [pull request 586](https://github.com/rdfjs/N3.js/pull/586), which proposed this feature for N3.js itself.

## Relationship to N3.js

- `n3` is a **peer dependency** (`>=2.13.7 <3`), so that an application has one N3.js installation. It is tested against n3 2.13.7 (minimum) and
  the latest 2.x, and against N3.js `main` in a scheduled, non-blocking job.
- This is not a fork. The N3.js maintainers asked for RDF Messages to live in a separate package until the specification matures
  (they proposed it in the discussion of pull request 586, which first added the feature to N3.js itself); this package is that package.
- N3.js parses the delimiters itself: the parser is created with `directives: ['message']`, and reports `MESSAGE` and `@message .`
  through `onDirective`, in order with the quads. The writer is a small subclass of `N3.Writer` that announces the log with the
  `version` option and ends every message with `_endStatement()` before it writes the delimiter.
  Blank node scoping per message is done by this package.

## Performance

`npm run perf` runs the benchmarks (`PERF_QUICK=1` for a smoke run) and writes `.perf-results/latest.json`; `npm run perf:compare` checks
ratio-based guardrails against each other and compares with `perf/baseline.json`. Method, thresholds and their rationale are in
[perf/README.md](perf/README.md). Measured on an Intel i7-1265U, node 25.9.0 (median of 5; quads/s):

| | plain N3.js | n3.js-messages |
| --- | --- | --- |
| parse 100k quads, one message | 688k | 719k (`parseMessages`), 784k (stream, 64 KiB chunks) |
| parse 10k messages × 5 quads | – | 588k (`parseMessages`), 813k (stream) |
| stream, 16-byte chunks (10k quads) | – | 464k |
| write 100k quads in one message (N-Quads) | – | 1.79M |
| write 10k messages (N-Quads) | – | 1.18M (235k messages/s) |

Streaming 100k messages (17 MB) through `MessageStreamParser` grows the heap by 0.12 MB (after gc).

### Comparison with rdf-parser-ts and rdf-writer-ts

[rdf-parser-ts](https://github.com/pietercolpaert/rdf-parser-ts) and its sibling [rdf-writer-ts](https://github.com/pietercolpaert/rdf-writer-ts)
also support RDF Messages, as standalone packages instead of a layer over N3.js. The benchmark suite runs the same generated documents
through both (`npm run perf`, then `npm run perf:compare`). Throughput in quads per second, median of 5, Intel i7-1265U, Node.js 25.9
(the higher number is faster; a speed above 1× means n3.js-messages is faster):

| Workload | n3.js-messages | rdf-parser-ts / rdf-writer-ts | Speed of n3.js-messages |
| --- | --- | --- | --- |
| Parse a string, one message, 100k quads | 719k | 696k | 1.03× |
| Parse a string, 10k messages × 5 quads | 588k | 691k | 0.85× |
| Parse a string, 10 messages × 10k quads | 680k | 745k | 0.91× |
| Stream, 64 KiB chunks, 100k quads | 784k | 680k | 1.15× |
| Stream, 64 KiB chunks, 10k messages | 813k | 549k | 1.48× |
| Stream, 16-byte chunks, 10k quads | 464k | 254k | 1.83× |
| Stream, 1-character chunks, 1k quads | 117k | 76k | 1.53× |
| Write one message, 100k quads, N-Quads | 1,793k | 1,678k | 1.07× |
| Write one message, 100k quads, TriG | 1,667k | 1,636k | 1.02× |
| Write 10k messages, N-Quads | 1,177k | 1,540k | 0.76× |
| Write 10k messages, TriG | 1,039k | 1,374k | 0.76× |

- **Streaming is where this package is ahead**: 1.15× to 1.8×, most for tiny chunks. The N3.js lexer works incrementally; by its
  documentation, rdf-parser-ts runs its parser over every complete statement prefix of the buffered input. I did not profile it to confirm the cause.
- **Parsing a whole string is faster with rdf-parser-ts** (0.85× to 0.91× for many messages or large ones, parity for one message): `parseMessages` is
  N3.js with an extra directive, so it is bounded by the speed of N3.js, which rdf-parser-ts also beats on ordinary documents (by 1.2×).
- **Writing**: on par for one large message; rdf-writer-ts is faster for many small messages (0.76×; measured before this package moved to one N3.js writer for the whole log).
- **Memory**: both stay flat while streaming 100k messages (17 MB): the heap grows by 0.12 MB here and
  0.08 MB with rdf-parser-ts.

Beyond speed, the choice is mostly about the ecosystem. Choose n3.js-messages if you already use N3.js (one parser and one set of syntax quirks, `n3` as a
shared peer dependency, Node.js 18+, messages as plain `Quad[]`, and a writer that starts every message from a clean state). Choose rdf-parser-ts and rdf-writer-ts if you do not need N3.js, or if parsing whole
documents and writing many tiny messages are your bottleneck (they need Node.js 22+ and use `rdf-data-factory` by default).
These are one machine's numbers from a single process: run `npm run perf` on yours; method and caveats are in [perf/README.md](perf/README.md).

## Development

```sh
npm ci
npm test               # unit, regression, property tests, with coverage (100% required)
npm run lint
npm run test:spec      # official RDF Messages test suite
npm run test:types     # TypeScript declarations
npm run test:package   # packs the tarball and tests it in a clean consumer project (needs network)
npm run perf
npm pack --dry-run
```

`FUZZ_SEED=… FUZZ_ITERATIONS=…` repeats the property test with another seed; a failure prints its seed and a minimized log.

## License

MIT. The vendored test suite in `spec/fixtures` keeps its upstream license (`spec/fixtures/LICENSE-UPSTREAM.md`).
