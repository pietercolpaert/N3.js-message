// Deterministic synthetic data for the performance suite.
//
// Everything is derived from a seeded PRNG (mulberry32), so every run, on every
// machine, benchmarks byte-identical input.
import { DataFactory } from 'n3';

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

const EX = 'http://example.org/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const PREFIXES = {
  ex: EX,
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  xsd: XSD,
};

const PREDICATES = [
  `${EX}p0`, `${EX}p1`, `${EX}p2`, `${EX}p3`, `${EX}knows`,
  `${PREFIXES.rdf}type`, `${PREFIXES.rdfs}label`, `${PREFIXES.foaf}name`,
].map(namedNode);
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'sensor', 'reading', 'value', 'observation', 'station', 'quality'];
const LANGS = ['en', 'nl', 'fr', 'de'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function randomLiteral(rng) {
  const text = `${pick(rng, WORDS)} ${pick(rng, WORDS)} ${Math.floor(rng() * 100000)}`;
  const kind = rng();
  if (kind < 0.4)
    return literal(text);
  if (kind < 0.55)
    return literal(`${text}, with "quotes"\nand a newline`);
  if (kind < 0.75)
    return literal(text, pick(rng, LANGS));
  if (kind < 0.9)
    return literal(String(Math.floor(rng() * 1000000)), namedNode(`${XSD}integer`));
  return literal((rng() * 100).toFixed(3), namedNode(`${XSD}decimal`));
}

// Creates `count` quads; `entities` bounds the number of distinct IRIs and
// blank nodes, `graphs` the number of named graphs (0 for the default graph only).
export function createQuads(rng, count, { entities = 1000, graphs = 0 } = {}) {
  const quads = [];
  for (let i = 0; i < count; i++) {
    const subject = rng() < 0.1 ? blankNode(`b${Math.floor(rng() * 50)}`) :
      namedNode(`${EX}s${Math.floor(rng() * entities)}`);
    const predicate = pick(rng, PREDICATES);
    const kind = rng();
    const object = kind < 0.45 ? randomLiteral(rng) :
      kind < 0.55 ? blankNode(`b${Math.floor(rng() * 50)}`) :
        namedNode(`${EX}o${Math.floor(rng() * entities)}`);
    const graph = graphs > 0 && rng() < 0.5 ? namedNode(`${EX}g${Math.floor(rng() * graphs)}`) : defaultGraph();
    quads.push(quad(subject, predicate, object, graph));
  }
  return quads;
}

function escapeString(value) {
  return value.replace(/[\\"\n]/g, c => c === '\n' ? '\\n' : `\\${c}`);
}

function iriToTurtle(iri) {
  for (const prefix in PREFIXES) {
    const ns = PREFIXES[prefix];
    if (iri.startsWith(ns) && /^[A-Za-z0-9]+$/.test(iri.slice(ns.length)))
      return `${prefix}:${iri.slice(ns.length)}`;
  }
  return `<${iri}>`;
}

function termToText(term, abbreviate) {
  switch (term.termType) {
  case 'NamedNode':
    return abbreviate ? iriToTurtle(term.value) : `<${term.value}>`;
  case 'BlankNode':
    return `_:${term.value}`;
  default: {
    const text = `"${escapeString(term.value)}"`;
    if (term.language)
      return `${text}@${term.language}`;
    if (term.datatype.value === `${XSD}string`)
      return text;
    return `${text}^^${termToText(term.datatype, abbreviate)}`;
  }
  }
}

// One statement per line, Turtle (prefixed names) or N-Triples (full IRIs); graphs are ignored
function triplesText(quads, abbreviate) {
  let text = '';
  for (const q of quads)
    text += `${termToText(q.subject, abbreviate)} ${termToText(q.predicate, abbreviate)} ${termToText(q.object, abbreviate)} .\n`;
  return text;
}

function prefixText() {
  return Object.entries(PREFIXES).map(([p, ns]) => `@prefix ${p}: <${ns}> .\n`).join('');
}

export const VERSION_TURTLE = '@version "1.2-messages" .\n';
export const VERSION_LINE = 'VERSION "1.2-messages"\n';

// ## Documents. All return { text, quads, messages, bytes }.
function result(text, quads, messages) {
  return { text, quads, messages, bytes: Buffer.byteLength(text) };
}

// An ordinary Turtle document (no message delimiters)
export function ordinaryTurtle(count, seed = 1) {
  const quads = createQuads(mulberry32(seed), count);
  return result(prefixText() + triplesText(quads, true), count, 1);
}

// An ordinary N-Triples document
export function ordinaryNTriples(count, seed = 1) {
  const quads = createQuads(mulberry32(seed), count);
  return result(triplesText(quads, false), count, 1);
}

// The same quads as `ordinaryTurtle`, announced as a message log with exactly one message
export function oneMessageTurtle(count, seed = 1) {
  const plain = ordinaryTurtle(count, seed);
  return result(VERSION_TURTLE + plain.text, count, 1);
}

// The text of one Turtle message with `quadsPerMessage` quads (messages are
// independent: prefixes are declared once, at the top of the log)
export function messageTurtle(index, quadsPerMessage, seed = 7) {
  return triplesText(createQuads(mulberry32(seed * 1000003 + index), quadsPerMessage), true);
}

export function messageLogHeader() {
  return VERSION_TURTLE + prefixText();
}

// A message log with `messages` messages of `quadsPerMessage` quads each
export function messageLog(messages, quadsPerMessage, seed = 7) {
  const parts = [messageLogHeader()];
  for (let i = 0; i < messages; i++) {
    if (i > 0)
      parts.push('@message .\n');
    parts.push(messageTurtle(i, quadsPerMessage, seed));
  }
  return result(parts.join(''), messages * quadsPerMessage, messages);
}

// Quad arrays (with a few named graphs) for the writer benchmarks
export function quadMessages(messages, quadsPerMessage, seed = 11) {
  const rng = mulberry32(seed);
  const list = [];
  for (let i = 0; i < messages; i++)
    list.push(createQuads(rng, quadsPerMessage, { graphs: 4 }));
  return list;
}
