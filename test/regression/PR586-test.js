// Regression tests for the defects and edge cases that came up in the review of
// https://github.com/rdfjs/N3.js/pull/586 ("RDF Messages support added"),
// which this package replaces. Every test names the finding that it protects against.
import { MessageParser, MessageStreamParser, MessageWriter, parseMessages, writeMessages } from '../../src/index.js';
import { quad, iri, defaultGraph, render } from '../util.js';
import factory from '../fixtures/CustomFactory.js';
import { Writable } from 'stream';

const V = 'VERSION "1.2-messages"\n';
function line(s, o, graph = '') {
  return `<http://example.org/s${s}> <http://example.org/p> <http://example.org/o${o}>${graph} .\n`;
}
const g = iri('g');

describe('regressions from PR #586', () => {
  // "Don't require `onQuad` just to receive `onMessage`": `parse(input, { onMessage })`
  // never fired, because the parser took the synchronous path without an `onQuad` callback.
  it('delivers messages to an onMessage callback without any onQuad consumer', () => {
    const received = [];
    new MessageParser({ format: 'TriG' }).parse(`${V}${line(1, 1)}MESSAGE\n${line(2, 2)}`, { onMessage: (error, message) => message && received.push(message) });
    expect(received).toHaveLength(2);
  });

  it('delivers messages to a plain callback without any quad consumer', () => {
    const received = [];
    new MessageParser({ format: 'N-Quads' }).parse(`${V}${line(1, 1)}`, (error, message) => message && received.push(message));
    expect(received).toHaveLength(1);
  });

  // "Preserve blank-node isolation when `blankNodePrefix` is configured": the per-message
  // reset only ran without a configured prefix, so labels collapsed across messages.
  it.each(['_:custom', 'custom', ''])('keeps blank node labels message-local with blankNodePrefix %j', blankNodePrefix => {
    for (const format of ['TriG', 'N-Quads']) {
      const messages = new MessageParser({ format, blankNodePrefix }).parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .`);
      expect(messages[0][0].subject.equals(messages[1][0].subject)).toBe(false);
    }
  });

  // "Configured `blankNodePrefix` is dropped after the first RDF message": the prefix reset to `b…_`.
  it('keeps using the configured blankNodePrefix after the first message', () => {
    const messages = new MessageParser({ format: 'N-Quads', blankNodePrefix: 'fixed' }).parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .`);
    messages.forEach(message => expect(message[0].subject.value).toMatch(/^fixed/));
  });

  // Blank node scoping must also hold for a custom parser configuration, such as a
  // custom RDF/JS data factory, because it must not rely on N3.js' label prefix.
  it('keeps blank node labels message-local with a custom data factory and prefix', () => {
    const messages = new MessageParser({ format: 'TriG', factory, blankNodePrefix: 'x' }).parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .`);
    expect(messages[0][0].subject.equals(messages[1][0].subject)).toBe(false);
  });

  // "Reset message mode per `parse()` call to avoid cross-run state leakage": a parser
  // that announced messages in one document stayed in message mode for the next.
  it('does not stay in message mode for the next document of the same parser', () => {
    const parser = new MessageParser({ format: 'Turtle' });
    parser.parse(`${V}${line(1, 1)}`);
    expect(() => parser.parse(`${line(1, 1)}MESSAGE\n`)).toThrow(/did not announce/);
  });

  it('does not leak the message mode between stream parsers', async () => {
    const first = new MessageStreamParser({ format: 'N-Quads' });
    first.resume();
    first.end(`${V}${line(1, 1)}`);
    const second = new MessageStreamParser({ format: 'N-Quads' });
    second.on('data', () => {});
    const error = new Promise(resolve => second.on('error', resolve));
    second.end(`${line(1, 1)}MESSAGE\n`);
    expect((await error).message).toMatch(/did not announce/);
  });

  // "Reset graph state when starting a new message boundary": after closing a named
  // graph, the writer still believed the graph was open, so the next message that
  // started in the same graph was written without its graph block.
  it('reopens the named graph at the start of the next message', () => {
    const messages = [[quad(iri('s1'), iri('p'), iri('o1'), g)], [quad(iri('s2'), iri('p'), iri('o2'), g)]];
    for (const format of ['TriG', 'N-Quads']) {
      const text = writeMessages(messages, { format });
      expect(render(parseMessages(text, { format }))).toEqual(render(messages));
    }
    expect(writeMessages(messages, { format: 'TriG' }).match(/<http:\/\/example.org\/g> \{/g)).toHaveLength(2);
  });

  it('reopens the default graph after a named graph in the previous message', () => {
    const messages = [[quad(iri('s1'), iri('p'), iri('o1'), g)], [quad(iri('s2'), iri('p'), iri('o2'), defaultGraph())]];
    expect(render(parseMessages(writeMessages(messages, { format: 'TriG' }), { format: 'TriG' }))).toEqual(render(messages));
  });

  // "`addMessage` callback fires before writes are actually flushed": `done` was
  // invoked immediately, before the writes to an asynchronous stream completed.
  it('completes addMessage only after an asynchronous output acknowledged every write', async () => {
    const acknowledged = [];
    const output = new Writable({
      decodeStrings: false,
      write(chunk, encoding, done) {
        setTimeout(() => (acknowledged.push(chunk), done()), 2);
      },
    });
    const writer = new MessageWriter(output, { format: 'TriG', end: false });
    await writer.addMessage([quad(iri('s'), iri('p'), iri('o'), g), quad(iri('s2'), iri('p'), iri('o'), g)]);
    expect(acknowledged.join('')).toMatch(/\}\n@message \.\n$/);
  });

  // The same finding for a callback that has to wait for the output of an
  // earlier call, which was still pending.
  it('completes later calls after earlier pending writes', async () => {
    const acknowledged = [];
    const output = new Writable({
      decodeStrings: false,
      write(chunk, encoding, done) {
        setTimeout(() => (acknowledged.push(chunk), done()), 2);
      },
    });
    const writer = new MessageWriter(output, { format: 'N-Quads', end: false });
    writer.addMessage([quad(iri('s1'), iri('p'), iri('o'))], () => {});
    await writer.addMessage([quad(iri('s2'), iri('p'), iri('o'))]);
    expect(acknowledged.join('').match(/MESSAGE\n/g)).toHaveLength(2);
  });

  // "line syntaxes using the correct message delimiter": N-Triples and N-Quads only
  // have the SPARQL-style `MESSAGE` delimiter, there is no `@message .`.
  it.each(['N-Triples', 'N-Quads'])('writes and accepts only MESSAGE in %s', format => {
    const text = writeMessages([[quad(iri('s1'), iri('p'), iri('o1'))], [quad(iri('s2'), iri('p'), iri('o2'))]], { format });
    expect(text).toMatch(/\nMESSAGE\n/);
    expect(text).not.toMatch(/@message/);
    expect(text).toMatch(/^VERSION "1.2-messages"\n/);
    expect(() => parseMessages(text.replace(/\nMESSAGE\n/, '\n@message .\n'), { format })).toThrow();
  });

  // "parser behavior when delimiters occur in illegal grammar locations": a delimiter
  // inside an open graph block must be rejected, not split the graph block.
  it('rejects a delimiter in an open graph block instead of splitting the block', () => {
    const input = `${V}<http://example.org/g> {\n${line(1, 1)}MESSAGE\n${line(2, 2)}}\n`;
    expect(() => parseMessages(input, { format: 'TriG' })).toThrow(/MESSAGE/);
    expect(() => parseMessages(input.replace('MESSAGE', '@message .'), { format: 'TriG' })).toThrow(/@message/);
  });

  // "`@message` without trailing dot" must be an error, not a silently skipped token.
  it('rejects @message that is not followed by a dot', () => {
    expect(() => parseMessages(`${V}${line(1, 1)}@message <http://example.org/invalid>`, { format: 'Turtle' })).toThrow(/Expected declaration to end with a dot/);
  });

  // The PR's lexer needed `MESSAGE` to match at the very end of the input (`$` in the lookahead).
  it('accepts a MESSAGE delimiter at the very end of the input, with and without line break', () => {
    for (const format of ['Turtle', 'N-Quads']) {
      expect(parseMessages(`${V}${line(1, 1)}MESSAGE`, { format })).toHaveLength(1);
      expect(parseMessages(`${V}${line(1, 1)}MESSAGE\n`, { format })).toHaveLength(1);
    }
  });

  // Trailing delimiters: the specification says a delimiter followed by the end of the
  // input does not create an additional empty message, but a second one does.
  it('does not emit an additional empty message for a trailing delimiter', () => {
    expect(parseMessages(`${V}${line(1, 1)}MESSAGE\n`, { format: 'N-Quads' }).map(m => m.length)).toEqual([1]);
    expect(parseMessages(`${V}${line(1, 1)}MESSAGE\nMESSAGE\n`, { format: 'N-Quads' }).map(m => m.length)).toEqual([1, 0]);
  });

  // Mode must be derived from the version announcement (`-messages` suffix), not
  // from the mere occurrence of a delimiter.
  it('requires a "-messages" version announcement for delimiters', () => {
    expect(() => parseMessages(`VERSION "1.2"\n${line(1, 1)}MESSAGE\n`, { format: 'N-Quads' })).toThrow(/did not announce/);
  });
});
