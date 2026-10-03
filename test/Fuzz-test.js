// Deterministic property test of the message framing layer.
//
// Random message logs are generated from a seed, together with the messages that
// they must parse to. Every log is parsed synchronously and in random chunks.
// A failure prints the seed and a minimized log, which reproduces it.
import { render, parseChunks, randomChunks, streamResult, mulberry32 } from './util.js';
import { parseMessages } from '../src/index.js';
import { Parser } from 'n3';

/* eslint-disable no-process-env */
// The environment makes the test repeatable with another seed, or longer
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS) || 150;
const BASE_SEED = Number(process.env.FUZZ_SEED) || 20260101;
/* eslint-enable no-process-env */

// Objects with text that looks like delimiters
// Pairs of source text and rendered form (see `render` in test/util.js)
function literal(source, value, suffix = '') {
  return [source, JSON.stringify(value) + suffix];
}
const LITERALS = [
  literal('"plain"', 'plain'),
  literal('"MESSAGE"', 'MESSAGE'),
  literal('"@message ."', '@message .'),
  literal('"a \\"MESSAGE\\" b"', 'a "MESSAGE" b'),
  literal('"line\\nMESSAGE\\nline"', 'line\nMESSAGE\nline'),
  literal('"VERSION \\"1.2-messages\\""', 'VERSION "1.2-messages"'),
  literal('"# MESSAGE"', '# MESSAGE'),
  literal('"\\u00e9\\u2603 \\U0001F600"', '\u00e9\u2603 \u{1F600}'),
];
const TURTLE_LITERALS = [
  literal('"""\nMESSAGE\n"""', '\nMESSAGE\n'),
  literal("'''@message .'''", '@message .'),
  literal('"""a "" MESSAGE ""\\""""', 'a "" MESSAGE """'),
  literal('"x"@message', 'x', '@message'),
];
const IRIS = ['o', 'MESSAGE', 'a#MESSAGE', '@message', 'x/MESSAGE/y', 'VERSION'];
const COMMENTS = ['# MESSAGE', '#MESSAGE\n#@message .', '# @message .', '#', '# VERSION "1.2-messages"'];
const SPACES = [' ', '  ', '\t', ' \t '];

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

// ### Generates a log description
function generate(seed) {
  const random = mulberry32(seed);
  const format = pick(random, ['Turtle', 'TriG', 'N-Triples', 'N-Quads']);
  const lineMode = /N-/.test(format);
  const literals = lineMode ? LITERALS : LITERALS.concat(TURTLE_LITERALS);
  const messages = Array.from({ length: Math.floor(random() * 7) }, () => ({
    blocks: !lineMode && format === 'TriG' && random() < 0.4,
    items: Array.from({ length: random() < 0.3 ? 0 : 1 + Math.floor(random() * 4) }, () => {
      const kind = random();
      if (kind < 0.2)
        return { comment: pick(random, COMMENTS) };
      const object = kind < 0.5 ? { iri: pick(random, IRIS) } : kind < 0.65 ? { blank: pick(random, ['a', 'b']) } : { literal: pick(random, literals) };
      return {
        subject: random() < 0.2 ? { blank: pick(random, ['a', 'b']) } : { iri: pick(random, IRIS) },
        object,
        graph: format === 'N-Quads' && random() < 0.5 ? pick(random, ['g1', 'g2']) : null,
      };
    }),
    // Turtle and TriG support two delimiter forms
    atForm: !lineMode && random() < 0.4,
  }));
  return {
    format,
    messages,
    announce: random() < 0.5 ? 'VERSION "1.2-messages"' : lineMode ? 'VERSION \'1.1-messages\'' : '@version "1.2-basic-messages" .',
    crlf: random() < 0.3,
    space: pick(random, SPACES),
    trailing: random() < 0.5,
  };
}

function iri(name) {
  return `<http://example.org/${name}>`;
}

// ### Writes the statements of a message as text, and computes their expected rendering
function buildMessage(log, message, blankCounter) {
  const nl = log.crlf ? '\r\n' : '\n';
  const labels = new Map();
  function blank(label) {
    if (!labels.has(label))
      labels.set(label, `_:b${blankCounter.next++}`);
    return labels.get(label);
  }
  const rendered = [];
  let body = '';
  for (const item of message.items) {
    if (item.comment)
      body += `${item.comment}${nl}`;
    else {
      const subject = item.subject.blank ? `_:${item.subject.blank}` : iri(item.subject.iri);
      const object = item.object.blank ? `_:${item.object.blank}` : item.object.literal ? item.object.literal[0] : iri(item.object.iri);
      const graph = item.graph ? ` ${iri(item.graph)}` : '';
      body += `${subject}${log.space}${iri('p')}${log.space}${object}${graph} .${nl}`;
      rendered.push([
        item.subject.blank ? blank(item.subject.blank) : iri(item.subject.iri), iri('p'),
        item.object.blank ? blank(item.object.blank) : item.object.literal ? item.object.literal[1] : iri(item.object.iri),
        graph.trim(),
      ].join(' ').trim() + (message.blocks ? ` ${iri('block')}` : ''));
    }
  }
  return { rendered, text: message.blocks ? `${iri('block')} {${nl}${body}}${nl}` : body };
}

// ### Writes the log description as text, and computes the expected messages
function build(log) {
  const nl = log.crlf ? '\r\n' : '\n';
  const blankCounter = { next: 0 };
  let text = `${log.announce}${nl}`;
  const expected = [];
  log.messages.forEach((message, index) => {
    const built = buildMessage(log, message, blankCounter);
    text += built.text;
    expected.push(built.rendered);
    // A final non-empty message does not need a delimiter, but an empty one does
    if (index < log.messages.length - 1 || log.trailing || built.rendered.length === 0)
      text += message.atForm ? `@message${log.space}.${nl}` : `MESSAGE${log.space}${index % 2 ? '# comment' : ''}${nl}`;
  });
  return { text, expected };
}

// ### Checks a log description, and returns a description of the first problem
async function check(log, seed) {
  const { text, expected } = build(log);
  try {
    if (JSON.stringify(render(parseMessages(text, { format: log.format }))) !== JSON.stringify(expected))
      return 'synchronous result differs';
    const random = mulberry32(seed ^ 0x9E3779B9);
    for (let i = 0; i < 4; i++)
      if (JSON.stringify(render(parseChunks(randomChunks(text, random, 1 + i * 5), { format: log.format }))) !== JSON.stringify(expected))
        return `chunked result differs (maximum chunk size ${1 + i * 5})`;
    if (JSON.stringify(render(await streamResult([...text], { format: log.format }))) !== JSON.stringify(expected))
      return 'character-by-character stream result differs';
  }
  catch (error) {
    return `threw ${error.message}`;
  }
  return null;
}

// ### Lists the logs that have one message or one statement less than the given log
function smallerLogs(log) {
  const candidates = [];
  log.messages.forEach((message, m) => {
    candidates.push({ ...log, messages: log.messages.filter((x, i) => i !== m) });
    message.items.forEach((item, i) => candidates.push({
      ...log,
      messages: log.messages.map((x, j) => j === m ? { ...x, items: x.items.filter((y, k) => k !== i) } : x),
    }));
  });
  return candidates;
}

// ### Greedily removes parts of a failing log, while it keeps failing
async function minimize(log, seed) {
  for (const candidate of smallerLogs(log))
    if (await check(candidate, seed))
      return minimize(candidate, seed);
  return log;
}

describe('message framing (property test)', () => {
  it(`parses ${ITERATIONS} generated logs like their description, in every chunking (base seed ${BASE_SEED})`, async () => {
    let checked = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const seed = BASE_SEED + i;
      const log = generate(seed);
      const problem = await check(log, seed);
      if (problem) {
        const minimal = await minimize(log, seed);
        throw new Error(`Framing failure (${problem}) with seed ${seed}, format ${log.format}.\n` +
                        `Minimized log, which reproduces it:\n${JSON.stringify(build(minimal).text)}`);
      }
      checked++;
    }
    expect(checked).toBe(ITERATIONS);
  });

  it('generates logs that actually contain what the generator promises', () => {
    const texts = Array.from({ length: 150 }, (_, i) => build(generate(BASE_SEED + i)).text);
    expect(texts.some(text => /"[^"\n]*MESSAGE[^"]*"/.test(text))).toBe(true);
    expect(texts.some(text => text.includes('@message .') && text.includes('\r\n'))).toBe(true);
    expect(texts.some(text => text.includes('{\n'))).toBe(true);
    expect(texts.some(text => text.includes('<http://example.org/MESSAGE>'))).toBe(true);
    expect(texts.some(text => /^VERSION/.test(text) && /\nMESSAGE\s*\n\s*MESSAGE/.test(text))).toBe(true);
  });

  it('reports the seed and a minimized input when the framing is wrong', async () => {
    expect.assertions(4);
    // Break the expectation on purpose: this documents the failure format
    const log = generate(BASE_SEED);
    const broken = { ...log, messages: [...log.messages, { blocks: false, items: [{ subject: { iri: 's' }, object: { iri: 'o' }, graph: null }], atForm: false }] };
    const { text } = build(broken);
    expect(await check(broken, BASE_SEED)).toBeNull();
    const wrongExpectation = { ...broken, announce: 'VERSION "1.2"' };
    const problem = await check(wrongExpectation, BASE_SEED);
    expect(problem).toMatch(/threw .*did not announce|result differs/);
    const minimal = await minimize(wrongExpectation, BASE_SEED);
    expect(minimal.messages.length).toBeLessThanOrEqual(1);
    expect(text).toContain('MESSAGE');
  });

  it('agrees with N3.js for the single message of a log without delimiters', () => {
    // Differential test: stripping the framing yields what N3.js parses
    const document = '@prefix ex: <http://example.org/> .\nex:s ex:p "MESSAGE", """a\nMESSAGE""" ;\n  ex:q [ ex:r ex:o ] , ( 1 2 ) .\n';
    const [message] = parseMessages(`@version "1.2-messages" .\n${document}`, { format: 'Turtle' });
    expect(render([message])).toEqual(render([new Parser({ format: 'Turtle' }).parse(document)]));
  });
});
