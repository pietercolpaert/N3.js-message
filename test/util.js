import { MessageParser, MessageStreamParser } from '../src/index.js';
import { DataFactory } from 'n3';
import { EventEmitter } from 'events';

const { namedNode, literal, blankNode, quad, defaultGraph } = DataFactory;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

export { namedNode, literal, blankNode, quad, defaultGraph };

// ### `iri` builds a named node in the test namespace
export function iri(name) {
  return namedNode(`http://example.org/${name}`);
}

// ### `render` converts messages into arrays of strings, in which blank nodes are
// numbered by first occurrence, so that equal renderings imply equal blank node sharing
export function render(messages) {
  const labels = new Map();
  function term(t) {
    switch (t.termType) {
    case 'NamedNode': return `<${t.value}>`;
    case 'BlankNode':
      if (!labels.has(t.value))
        labels.set(t.value, `_:b${labels.size}`);
      return labels.get(t.value);
    case 'Literal': {
      const lexical = JSON.stringify(t.value);
      return t.language ? `${lexical}@${t.language}` :
        t.datatype.value === XSD_STRING ? lexical : `${lexical}^^<${t.datatype.value}>`;
    }
    case 'Quad': return `<<${term(t.subject)} ${term(t.predicate)} ${term(t.object)}>>`;
    default: return '';
    }
  }
  return messages.map(message => message.map(({ subject, predicate, object, graph }) =>
    [term(subject), term(predicate), term(object), graph.termType === 'DefaultGraph' ? '' : term(graph)]
      .join(' ').trim()));
}

// ### `parseAll` parses synchronously and renders
export function parseAll(input, options) {
  return render(new MessageParser(options).parse(input));
}

// ### `parseChunks` parses an array of string chunks through the stream interface of `MessageParser`
export function parseChunks(chunks, options) {
  const stream = new EventEmitter();
  const messages = [];
  let error = null;
  new MessageParser(options).parse(stream, (e, message) => e ? (error = e) : message && messages.push(message));
  chunks.forEach(chunk => stream.emit('data', chunk));
  stream.emit('end');
  if (error)
    throw error;
  return messages;
}

// ### `splitEvery` splits a string into chunks of the given size
export function splitEvery(string, size) {
  const chunks = [];
  for (let i = 0; i < string.length; i += size)
    chunks.push(string.slice(i, i + size));
  return chunks;
}

// ### `streamResult` pipes chunks through `MessageStreamParser` and resolves with the messages
export function streamResult(chunks, options) {
  return new Promise((resolve, reject) => {
    const parser = new MessageStreamParser(options);
    const messages = [];
    parser.on('data', message => messages.push(message));
    parser.on('error', reject);
    parser.on('end', () => resolve(messages));
    chunks.forEach(chunk => parser.write(chunk));
    parser.end();
  });
}

// ### `mulberry32` is a small deterministic pseudo-random number generator
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ### `randomChunks` splits a string at random positions, using the generator
export function randomChunks(string, random, maxSize) {
  const chunks = [];
  for (let i = 0; i < string.length;) {
    const size = 1 + Math.floor(random() * maxSize);
    chunks.push(string.slice(i, i + size));
    i += size;
  }
  return chunks;
}
