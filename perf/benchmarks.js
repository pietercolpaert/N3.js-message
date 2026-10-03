// The benchmark definitions. Each benchmark has a `name`, a `setup(sizes)` that
// prepares (untimed) input and returns a `run()` function; `run()` may be
// asynchronous and returns `{ quads, messages, bytes, extra? }`.
import { once } from 'events';
import { Writable } from 'stream';
import path from 'path';
import { pathToFileURL } from 'url';
import { Parser } from 'n3';
import {
  ordinaryTurtle, oneMessageTurtle, messageLog, messageLogHeader, messageTurtle, quadMessages,
} from './data.js';

// `PERF_SRC=/path/to/index.js` benchmarks another build of the package (for A/B comparisons)
const { MessageStreamParser, MessageStreamWriter, parseMessages, writeMessages } = await import(
  /* webpackChunkName: "messages" */ process.env.PERF_SRC ? pathToFileURL(path.resolve(process.env.PERF_SRC)).href : '../src/index.js');

// The other RDF Messages implementation for comparison: rdf-parser-ts and rdf-writer-ts (Node.js >= 22).
// Their benchmarks are left out where they cannot be loaded, or with PERF_NO_COMPETITORS=1.
async function loadCompetitor() {
  if (process.env.PERF_NO_COMPETITORS === '1')
    return null;
  try {
    return {
      ...await import(/* webpackChunkName: "rdf-parser-ts" */ 'rdf-parser-ts'),
      ...await import(/* webpackChunkName: "rdf-writer-ts" */ 'rdf-writer-ts'),
    };
  }
  catch (error) {
    console.error(`rdf-parser-ts / rdf-writer-ts not available (${error.code || error.message}): skipping the comparison`);
    return null;
  }
}
const competitor = await loadCompetitor();

export const CHUNK = 64 * 1024;

// Sizes of a full run (S = small, L = large) and of a smoke run.
export function sizes(quick) {
  return quick ?
    { S: 1000, L: 10000, tinyDoc: 1000, charDoc: 500, messages: 1000, fewMessages: 10, fewQuads: 1000, memoryMessages: 20000, perMessage: 5 } :
    { S: 10000, L: 100000, tinyDoc: 10000, charDoc: 1000, messages: 10000, fewMessages: 10, fewQuads: 10000, memoryMessages: 100000, perMessage: 5 };
}

function chunkBuffer(text, size) {
  const buffer = Buffer.from(text);
  const chunks = [];
  for (let i = 0; i < buffer.length; i += size)
    chunks.push(buffer.subarray(i, i + size));
  return chunks;
}

function chunkChars(text) {
  return Array.from(text);
}

// Pushes chunks through a MessageStreamParser and counts what comes out
async function streamParse(chunks) {
  const parser = new MessageStreamParser({ format: 'Turtle' });
  let quads = 0, messages = 0;
  parser.on('data', message => {
    messages++;
    quads += message.length;
  });
  const ended = once(parser, 'end');
  for (const chunk of chunks) {
    if (!parser.write(chunk))
      await once(parser, 'drain');
  }
  parser.end();
  await ended;
  return { quads, messages };
}

function streamBenchmark(name, makeDoc, makeChunks) {
  return {
    name,
    setup(s) {
      const doc = makeDoc(s);
      const chunks = makeChunks(doc.text);
      return async () => ({ ...await streamParse(chunks), bytes: doc.bytes, extra: { chunks: chunks.length } });
    },
  };
}

function parseBenchmark(name, makeDoc, parse) {
  return {
    name,
    setup(s) {
      const doc = makeDoc(s);
      return () => {
        const result = parse(doc.text);
        return { quads: doc.quads, messages: result.messages, bytes: doc.bytes, keep: result.value };
      };
    },
  };
}

function plainParse(text) {
  const quads = new Parser({ format: 'Turtle' }).parse(text);
  return { messages: 1, value: quads };
}

function messageParse(text) {
  const messages = parseMessages(text, { format: 'Turtle' });
  return { messages: messages.length, value: messages };
}

function writerBenchmark(name, makeMessages, format) {
  return {
    name,
    setup(s) {
      const messages = makeMessages(s);
      const quads = messages.reduce((n, m) => n + m.length, 0);
      return () => {
        const text = writeMessages(messages, { format });
        return { quads, messages: messages.length, bytes: Buffer.byteLength(text) };
      };
    },
  };
}

function oneLarge(s) {
  return quadMessages(1, s.L);
}

function manySmall(s) {
  return quadMessages(s.messages, s.perMessage);
}

// A memory benchmark: streams `memoryMessages` messages, generated on the fly (the
// input is never held in memory), and samples the heap after a forced gc.
// The consumer drops every message. If the parser leaks, heap grows with input.
async function memoryStream(s, gc, implementation) {
  const total = s.memoryMessages;
  const parser = implementation.createParser();
  let messages = 0, quads = 0, bytes = 0;
  const tally = { get messages() { return messages; }, set messages(value) { messages = value; }, quads: 0 };
  const consumer = new Writable({
    objectMode: true,
    write(item, encoding, done) {
      implementation.consume(item, tally);
      done();
    },
  });
  parser.pipe(consumer);
  const finished = once(consumer, 'finish');
  const samples = [];
  const every = Math.floor(total / 10);
  let pending = messageLogHeader();
  async function flush(force) {
    while (pending.length >= CHUNK || force && pending.length > 0) {
      const chunk = Buffer.from(pending.slice(0, CHUNK));
      pending = pending.slice(chunk.length);
      bytes += chunk.length;
      if (!parser.write(chunk))
        await once(parser, 'drain');
    }
  }
  for (let i = 0; i < total; i++) {
    pending += `${i > 0 ? '@message .\n' : ''}${messageTurtle(i, s.perMessage)}`;
    if (pending.length >= CHUNK)
      await flush(false);
    if ((i + 1) % every === 0 && i + 1 < total) {
      // Let the consumer catch up, then measure what is really retained
      await new Promise(resolve => setImmediate(resolve));
      gc();
      samples.push(process.memoryUsage().heapUsed);
    }
  }
  await flush(true);
  parser.end();
  await finished;
  quads = tally.quads;
  const MB = 1024 * 1024;
  // Growth: highest sample after the first one, compared to the first sample (10% of the input)
  const growth = Math.max(0, Math.max(...samples.slice(1)) - samples[0]);
  return {
    quads, messages, bytes,
    extra: {
      inputMB: bytes / MB,
      heapSamplesMB: samples.map(x => x / MB),
      heapGrowthMB: growth / MB,
    },
  };
}

// How the memory benchmark creates a parser and consumes its output: one array per message
const ownMemory = {
  createParser: () => new MessageStreamParser({ format: 'Turtle' }),
  consume(message, tally) {
    tally.messages++;
    tally.quads += message.length;
  },
};

export function createBenchmarks() {
  return [
    // (a) the baseline: N3.js on an ordinary document
    parseBenchmark('plain-n3-S', s => ordinaryTurtle(s.S), plainParse),
    parseBenchmark('plain-n3-L', s => ordinaryTurtle(s.L), plainParse),
    // (b) the same quads as one message
    parseBenchmark('messages-one-S', s => oneMessageTurtle(s.S), messageParse),
    parseBenchmark('messages-one-L', s => oneMessageTurtle(s.L), messageParse),
    // (c) many small messages, (d) few large messages
    parseBenchmark('messages-many', s => messageLog(s.messages, s.perMessage), messageParse),
    parseBenchmark('messages-few-large', s => messageLog(s.fewMessages, s.fewQuads), messageParse),
    // (e) realistic chunks
    streamBenchmark('stream-64k-S', s => oneMessageTurtle(s.S), t => chunkBuffer(t, CHUNK)),
    streamBenchmark('stream-64k-L', s => oneMessageTurtle(s.L), t => chunkBuffer(t, CHUNK)),
    streamBenchmark('stream-64k-many', s => messageLog(s.messages, s.perMessage), t => chunkBuffer(t, CHUNK)),
    // (f) pathological chunks: 16 bytes (same doc as stream-64k-S, and twice as large), and single characters
    streamBenchmark('stream-16b-S', s => oneMessageTurtle(s.S), t => chunkBuffer(t, 16)),
    streamBenchmark('stream-16b-2S', s => oneMessageTurtle(2 * s.S), t => chunkBuffer(t, 16)),
    streamBenchmark('stream-16b-many', s => messageLog(s.messages, s.perMessage), t => chunkBuffer(t, 16)),
    streamBenchmark('stream-1ch-C', s => oneMessageTurtle(s.charDoc), chunkChars),
    streamBenchmark('stream-1ch-2C', s => oneMessageTurtle(2 * s.charDoc), chunkChars),
    // (g) writers
    writerBenchmark('writer-one-nquads', oneLarge, 'N-Quads'),
    writerBenchmark('writer-one-trig', oneLarge, 'TriG'),
    writerBenchmark('writer-many-nquads', manySmall, 'N-Quads'),
    writerBenchmark('writer-many-trig', manySmall, 'TriG'),
    {
      name: 'writer-stream-many-nquads',
      setup(s) {
        const messages = manySmall(s);
        const quads = messages.reduce((n, m) => n + m.length, 0);
        return async () => {
          const writer = new MessageStreamWriter({ format: 'N-Quads' });
          let bytes = 0;
          writer.on('data', chunk => (bytes += chunk.length));
          const ended = once(writer, 'end');
          for (const message of messages) {
            if (!writer.write(message))
              await once(writer, 'drain');
          }
          writer.end();
          await ended;
          return { quads, messages: messages.length, bytes };
        };
      },
    },
    // (h) memory of a long stream; `setup` receives the gc function
    {
      name: 'memory-stream',
      once: true,
      setup(s, gc) {
        return () => memoryStream(s, gc, ownMemory);
      },
    },
    ...competitor ? competitorBenchmarks() : [],
  ];
}

// ## The same workloads with rdf-parser-ts and rdf-writer-ts
// (`rdfts-<name>` is the counterpart of `<name>`)

// Pushes chunks through the StreamParser of rdf-parser-ts. Its output is a quad (or message quad) per
// item, so the messages are counted by their counter.
async function competitorStreamParse(chunks) {
  const parser = new competitor.StreamParser({});
  const tally = { quads: 0, messages: 0 };
  parser.on('data', item => competitorConsume(item, tally));
  const ended = once(parser, 'end');
  for (const chunk of chunks) {
    if (!parser.write(chunk))
      await once(parser, 'drain');
  }
  parser.end();
  await ended;
  return { quads: tally.quads, messages: tally.messages };
}

function competitorConsume(item, tally) {
  tally.quads++;
  const counter = item.messageCounter === undefined ? 0 : item.messageCounter;
  if (counter >= tally.messages)
    tally.messages = counter + 1;
}

function competitorStreamBenchmark(name, makeDoc, makeChunks) {
  return {
    name,
    setup(s) {
      const doc = makeDoc(s);
      const chunks = makeChunks(doc.text);
      return async () => ({ ...await competitorStreamParse(chunks), bytes: doc.bytes, extra: { chunks: chunks.length } });
    },
  };
}

function competitorWriterBenchmark(name, makeMessages, format) {
  return {
    name,
    setup(s) {
      const messages = makeMessages(s);
      const quads = messages.reduce((n, m) => n + m.length, 0);
      return () => {
        const writer = new competitor.Writer({ format });
        for (const message of messages)
          writer.addMessage(message);
        let text, failure = null;
        writer.end((error, output) => (failure = error, text = output));
        if (failure)
          throw failure;
        return { quads, messages: messages.length, bytes: Buffer.byteLength(text) };
      };
    },
  };
}

function competitorBenchmarks() {
  function plain(text) {
    return { messages: 1, value: new competitor.Parser().parse(text) };
  }
  function messageParseTs(text) {
    const messages = new competitor.Parser().parseMessages(text);
    return { messages: messages.length, value: messages };
  }
  return [
    parseBenchmark('rdfts-plain-S', s => ordinaryTurtle(s.S), plain),
    parseBenchmark('rdfts-plain-L', s => ordinaryTurtle(s.L), plain),
    parseBenchmark('rdfts-messages-one-S', s => oneMessageTurtle(s.S), messageParseTs),
    parseBenchmark('rdfts-messages-one-L', s => oneMessageTurtle(s.L), messageParseTs),
    parseBenchmark('rdfts-messages-many', s => messageLog(s.messages, s.perMessage), messageParseTs),
    parseBenchmark('rdfts-messages-few-large', s => messageLog(s.fewMessages, s.fewQuads), messageParseTs),
    competitorStreamBenchmark('rdfts-stream-64k-L', s => oneMessageTurtle(s.L), t => chunkBuffer(t, CHUNK)),
    competitorStreamBenchmark('rdfts-stream-64k-many', s => messageLog(s.messages, s.perMessage), t => chunkBuffer(t, CHUNK)),
    competitorStreamBenchmark('rdfts-stream-16b-S', s => oneMessageTurtle(s.S), t => chunkBuffer(t, 16)),
    competitorStreamBenchmark('rdfts-stream-16b-2S', s => oneMessageTurtle(2 * s.S), t => chunkBuffer(t, 16)),
    competitorStreamBenchmark('rdfts-stream-16b-many', s => messageLog(s.messages, s.perMessage), t => chunkBuffer(t, 16)),
    competitorStreamBenchmark('rdfts-stream-1ch-C', s => oneMessageTurtle(s.charDoc), chunkChars),
    competitorStreamBenchmark('rdfts-stream-1ch-2C', s => oneMessageTurtle(2 * s.charDoc), chunkChars),
    competitorWriterBenchmark('rdfts-writer-one-nquads', oneLarge, 'N-Quads'),
    competitorWriterBenchmark('rdfts-writer-one-trig', oneLarge, 'TriG'),
    competitorWriterBenchmark('rdfts-writer-many-nquads', manySmall, 'N-Quads'),
    competitorWriterBenchmark('rdfts-writer-many-trig', manySmall, 'TriG'),
    {
      name: 'rdfts-memory-stream',
      once: true,
      setup(s, gc) {
        return () => memoryStream(s, gc, {
          createParser: () => new competitor.StreamParser({}),
          consume: competitorConsume,
        });
      },
    },
  ];
}
