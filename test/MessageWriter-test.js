import { quad, iri, literal, blankNode, defaultGraph, render, streamResult } from './util.js';
import { MessageWriter, MessageStreamWriter, MessageParser, parseMessages, writeMessages } from '../src/index.js';
import { Writable, PassThrough } from 'stream';

const p = iri('p');
const g = iri('g');
function q1(n, graph) {
  return quad(iri(`s${n}`), p, iri(`o${n}`), graph || defaultGraph());
}

// A stream that acknowledges writes asynchronously, and records what it received
class SlowStream extends Writable {
  constructor(delay = 5) {
    super({ decodeStrings: false });
    this.chunks = [];
    this.delay = delay;
  }

  _write(chunk, encoding, done) {
    setTimeout(() => {
      this.chunks.push(chunk);
      done();
    }, this.delay);
  }
}

describe('MessageWriter', () => {
  describe('output', () => {
    it('writes one message in N-Quads', () => {
      expect(writeMessages([[q1(1)]], { format: 'N-Quads' })).toBe(
        'VERSION "1.2-messages"\n<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .\nMESSAGE\n');
    });

    it('writes multiple messages in N-Triples, with a delimiter after every message', () => {
      expect(writeMessages([[q1(1)], [q1(2), q1(3)]], { format: 'N-Triples' })).toBe(
        'VERSION "1.2-messages"\n' +
        '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .\nMESSAGE\n' +
        '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .\n' +
        '<http://example.org/s3> <http://example.org/p> <http://example.org/o3> .\nMESSAGE\n');
    });

    it('writes empty messages as consecutive delimiters', () => {
      expect(writeMessages([[], [q1(1)], []], { format: 'N-Quads' })).toBe(
        'VERSION "1.2-messages"\nMESSAGE\n<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .\nMESSAGE\nMESSAGE\n');
    });

    it('writes Turtle with the old-style version directive and delimiter', () => {
      expect(writeMessages([[q1(1)], [q1(2)]], { format: 'Turtle', prefixes: { ex: 'http://example.org/' } })).toBe(
        '@version "1.2-messages".\n@prefix ex: <http://example.org/>.\n\nex:s1 ex:p ex:o1.\n@message .\nex:s2 ex:p ex:o2.\n@message .\n');
    });

    it('writes TriG graph blocks per message', () => {
      expect(writeMessages([[q1(1, g)], [q1(2, g), q1(3)]], { format: 'TriG', prefixes: { ex: 'http://example.org/' } })).toBe(
        '@version "1.2-messages".\n@prefix ex: <http://example.org/>.\n\n' +
        'ex:g {\nex:s1 ex:p ex:o1\n}\n@message .\n' +
        'ex:g {\nex:s2 ex:p ex:o2\n}\nex:s3 ex:p ex:o3.\n@message .\n');
    });

    it('writes an empty log as just the announcement', () => {
      expect(writeMessages([], { format: 'N-Quads' })).toBe('VERSION "1.2-messages"\n');
      expect(writeMessages([], { format: 'TriG' })).toBe('@version "1.2-messages".\n');
    });

    it('declares prefixes and the base after the announcement, also in a log without messages', () => {
      expect(writeMessages([], { format: 'Turtle', prefixes: { ex: 'http://example.org/' }, baseIRI: 'http://example.org/', writeBase: true }))
        .toBe('@version "1.2-messages".\n@base <http://example.org/>.\n@prefix ex: <http://example.org/>.\n\n');
    });

    it('supports the other messages version labels', () => {
      expect(writeMessages([], { format: 'N-Quads', version: '1.1-messages' })).toBe('VERSION "1.1-messages"\n');
      expect(writeMessages([], { format: 'TriG', version: '1.2-basic-messages' })).toBe('@version "1.2-basic-messages".\n');
    });

    it('rejects versions that do not announce messages or are unsupported', () => {
      expect(() => new MessageWriter({ version: '1.2' })).toThrow(/Unsupported RDF Messages version/);
      expect(() => new MessageWriter({ version: '9.9-messages' })).toThrow(/Unsupported RDF Messages version/);
      expect(() => new MessageWriter({ format: 'JSON-LD' })).toThrow(/Unsupported RDF Messages format/);
    });

    it('writes literals with escapes, language tags and datatypes', () => {
      const quads = [quad(iri('s'), p, literal('a "quoted"\nvalue\\ \u2603')), quad(iri('s'), p, literal('hallo', 'nl')), quad(iri('s'), p, literal('5', iri('int')))];
      const text = writeMessages([quads], { format: 'N-Triples' });
      expect(render(parseMessages(text, { format: 'N-Triples' }))).toEqual(render([quads]));
    });

    it('writes the base IRI once', () => {
      const text = writeMessages([[q1(1)], [q1(2)]], { format: 'Turtle', baseIRI: 'http://example.org/', writeBase: true });
      expect(text.match(/@base/g)).toHaveLength(1);
      expect(render(parseMessages(text, { format: 'Turtle' }))).toEqual(render([[q1(1)], [q1(2)]]));
    });
  });

  describe('state does not leak between messages', () => {
    function roundTrip(messages, options) {
      return render(parseMessages(writeMessages(messages, options), { format: options.format }));
    }

    it('reopens a named graph that continues in the next message', () => {
      const messages = [[q1(1, g)], [q1(2, g)], [q1(3, g), q1(4, g)]];
      expect(roundTrip(messages, { format: 'TriG' })).toEqual(render(messages));
      expect(writeMessages(messages, { format: 'TriG' }).match(/<http:\/\/example.org\/g> \{/g)).toHaveLength(3);
    });

    it('repeats the subject in the next message', () => {
      const messages = [[quad(iri('s'), p, iri('o1'))], [quad(iri('s'), p, iri('o2'))]];
      const text = writeMessages(messages, { format: 'Turtle' });
      expect(text.match(/<http:\/\/example.org\/s>/g)).toHaveLength(2);
      expect(roundTrip(messages, { format: 'Turtle' })).toEqual(render(messages));
    });

    it('does not continue a predicate list across messages', () => {
      const messages = [[quad(iri('s'), p, iri('o1')), quad(iri('s'), p, iri('o2'))], [quad(iri('s'), p, iri('o3'))]];
      expect(roundTrip(messages, { format: 'Turtle' })).toEqual(render(messages));
    });

    it('switches between the default graph and a named graph at message boundaries', () => {
      const messages = [[q1(1, g)], [q1(2)], [q1(3, g)], [q1(4)]];
      expect(roundTrip(messages, { format: 'TriG' })).toEqual(render(messages));
    });

    it('scopes blank nodes: a shared blank node becomes distinct nodes in distinct messages', () => {
      const shared = blankNode('shared');
      const messages = [[quad(shared, p, iri('o1'))], [quad(shared, p, iri('o2'))]];
      const [a, b] = parseMessages(writeMessages(messages, { format: 'N-Quads' }), { format: 'N-Quads' }).map(message => message[0].subject);
      expect(a.equals(b)).toBe(false);
    });

    it('keeps blank nodes within a message', () => {
      const shared = blankNode('shared');
      const text = writeMessages([[quad(shared, p, iri('o1')), quad(iri('s'), p, shared)]], { format: 'TriG' });
      const [message] = parseMessages(text, { format: 'TriG' });
      expect(message[0].subject.equals(message[1].object)).toBe(true);
    });

    it('does not repeat prefixes in later messages, but declares new prefixes before the next message', () => {
      const writer = new MessageWriter({ format: 'Turtle', prefixes: { a: 'http://example.org/' } });
      writer.addMessage([q1(1)]);
      writer.addPrefix('b', 'http://other.example.org/');
      writer.addPrefix('a', 'http://example.org/');
      writer.addMessage([quad(iri('s'), p, quad.constructor === Function ? literal('x') : null)]);
      writer.addMessage([q1(3)]);
      let output;
      writer.end((error, result) => (output = result));
      expect(output.match(/@prefix a:/g)).toHaveLength(1);
      expect(output.match(/@prefix b:/g)).toHaveLength(1);
      expect(output.indexOf('@prefix b:')).toBeGreaterThan(output.indexOf('@message'));
      expect(parseMessages(output, { format: 'Turtle' })).toHaveLength(3);
    });

    it('declares a prefix that was added before the first message after the configured prefixes', () => {
      const writer = new MessageWriter({ format: 'TriG', prefixes: { a: 'http://example.org/' } });
      writer.addPrefix('b', { value: 'http://other.example.org/' });
      writer.addMessage([q1(1)]);
      let output;
      writer.end((error, result) => (output = result));
      expect(output).toMatch(/@prefix a: .*\n[^]*@prefix b: <http:\/\/other.example.org\/>/);
    });

    it('ignores prefixes in line formats', () => {
      const writer = new MessageWriter({ format: 'N-Quads', prefixes: { a: 'http://example.org/' } });
      writer.addPrefix('b', 'http://other.example.org/');
      writer.addMessage([q1(1)]);
      let output;
      writer.end((error, result) => (output = result));
      expect(output).not.toMatch(/prefix/i);
    });
  });

  describe('completion', () => {
    it('does not complete addMessage before the output stream accepted the data', async () => {
      const stream = new SlowStream();
      const writer = new MessageWriter(stream, { format: 'N-Quads' });
      let completed = false;
      const done = new Promise(resolve => writer.addMessage([q1(1), q1(2)], () => (completed = true, resolve())));
      expect(completed).toBe(false);
      expect(stream.chunks).toHaveLength(0);
      await done;
      expect(stream.chunks.join('')).toBe('VERSION "1.2-messages"\n' +
        '<http://example.org/s1> <http://example.org/p> <http://example.org/o1> .\n' +
        '<http://example.org/s2> <http://example.org/p> <http://example.org/o2> .\nMESSAGE\n');
    });

    it('completes immediately for an empty log with a synchronous output', () => {
      const writer = new MessageWriter({ format: 'N-Quads' });
      let completed = false;
      writer.addMessage([], () => (completed = true));
      expect(completed).toBe(true);
    });

    it('resolves a promise when no callback is given', async () => {
      const stream = new SlowStream();
      const writer = new MessageWriter(stream, { format: 'TriG' });
      await writer.addMessage([q1(1, g)]);
      expect(stream.chunks.length).toBeGreaterThan(0);
      await writer.addPrefix('x', 'http://x/');
      await writer.end();
      expect(stream.writableFinished).toBe(true);
    });

    it('does not complete end before the output is flushed and ended', async () => {
      const stream = new SlowStream();
      const writer = new MessageWriter(stream, { format: 'N-Quads' });
      writer.addMessage([q1(1)]);
      const finished = jest.fn();
      stream.on('finish', finished);
      await new Promise((resolve, reject) => writer.end(error => error ? reject(error) : resolve()));
      expect(finished).toHaveBeenCalled();
      expect(stream.chunks.join('')).toMatch(/MESSAGE\n$/);
    });

    it('does not end the output stream with end: false', async () => {
      const stream = new SlowStream();
      const writer = new MessageWriter(stream, { format: 'N-Quads', end: false });
      await writer.addMessage([q1(1)]);
      await writer.end();
      expect(stream.writableEnded).toBe(false);
      stream.end();
    });

    it('returns the output as a string from end, as a callback result or promise', async () => {
      const writer = new MessageWriter({ format: 'N-Quads' });
      writer.addMessage([q1(1)]);
      expect(await writer.end()).toMatch(/^VERSION "1.2-messages"\n/);
    });

    it('completes end repeatedly, but cannot write after end', async () => {
      const writer = new MessageWriter({ format: 'N-Quads' });
      await writer.end();
      await writer.end();
      const again = jest.fn();
      writer.end(again);
      expect(again).toHaveBeenCalledWith(null);
      await expect(writer.addMessage([q1(1)])).rejects.toThrow('Cannot write after end');
      await expect(writer.addPrefix('a', 'http://a/')).rejects.toThrow('Cannot write after end');
      const callback = jest.fn();
      writer.addMessage([], callback);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cannot write after end' }));
    });

    it('flushes into a pass-through stream that is read concurrently', async () => {
      const stream = new PassThrough({ encoding: 'utf8' });
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      const writer = new MessageWriter(stream, { format: 'N-Quads' });
      await writer.addMessage([q1(1)]);
      await writer.end();
      expect(chunks.join('')).toMatch(/s1.*\nMESSAGE\n$/);
    });
  });

  describe('defaults', () => {
    it('can be created without arguments, which writes TriG to a string', async () => {
      const writer = new MessageWriter();
      await writer.addMessage();
      await writer.addMessage([q1(1, g)]);
      expect(await writer.end()).toBe('@version "1.2-messages".\n@message .\n' +
        '<http://example.org/g> {\n<http://example.org/s1> <http://example.org/p> <http://example.org/o1>\n}\n@message .\n');
    });

    it('can be created with an output stream and without options', async () => {
      const stream = new SlowStream(0);
      const writer = new MessageWriter(stream);
      await writer.addMessage([q1(1)]);
      await writer.end();
      expect(stream.chunks.join('')).toMatch(/^@version "1.2-messages"\.\n/);
    });
  });

  describe('errors', () => {
    it('reports only the first of several errors', async () => {
      const failing = { write: (chunk, encoding, callback) => callback(new Error(`failure ${chunk.length}`)), end: callback => callback() };
      const writer = new MessageWriter(failing, { format: 'N-Quads' });
      const first = writer.addMessage([q1(1), q1(2)]);
      await expect(first).rejects.toThrow('failure 23');
      const quads = [{ subject: iri('s'), predicate: p, object: null, graph: defaultGraph() }, { subject: iri('s'), predicate: p, object: null, graph: defaultGraph() }];
      await expect(new MessageWriter({ format: 'TriG' }).addMessage(quads)).rejects.toThrow();
    });

    it('propagates write errors of the output stream to the callback', async () => {
      const failing = { write: (chunk, encoding, callback) => callback(new Error('disk full')), end: callback => callback() };
      const error = await new Promise(resolve => new MessageWriter(failing, { format: 'N-Quads' }).addMessage([q1(1)], resolve));
      expect(error.message).toBe('disk full');
    });

    it('propagates write errors of an asynchronous output stream to the promise', async () => {
      const failing = { write: (chunk, encoding, callback) => setImmediate(callback, new Error('async failure')), end: callback => callback() };
      await expect(new MessageWriter(failing, { format: 'N-Quads' }).addMessage([q1(1)])).rejects.toThrow('async failure');
    });

    it('propagates errors for terms that cannot be serialized', async () => {
      const writer = new MessageWriter({ format: 'N-Quads' });
      const bad = { subject: null, predicate: p, object: iri('o'), graph: defaultGraph() };
      await expect(writer.addMessage([bad])).rejects.toThrow();
    });

    it('propagates errors of end, and of an output that cannot end', async () => {
      const failing = { write: (chunk, encoding, callback) => callback(), end: callback => callback(new Error('end failed')) };
      await expect(new MessageWriter(failing, { format: 'N-Quads' }).end()).rejects.toThrow('end failed');
      const throwing = { write: (chunk, encoding, callback) => callback(), end: () => { throw new Error('end threw'); } };
      await expect(new MessageWriter(throwing, { format: 'N-Quads' }).end()).rejects.toThrow('end threw');
    });

    it('propagates write errors that occur before the end', async () => {
      const failing = { write: (chunk, encoding, callback) => callback(new Error('early')), end: callback => callback() };
      const writer = new MessageWriter(failing, { format: 'N-Quads' });
      await expect(writer.end()).rejects.toThrow('early');
    });

    it('reports an error to the callback of end', async () => {
      const failing = { write: (chunk, encoding, callback) => callback(new Error('early')), end: callback => callback() };
      const error = await new Promise(resolve => new MessageWriter(failing, { format: 'N-Quads' }).end(resolve));
      expect(error.message).toBe('early');
    });

    it('throws the error from writeMessages', () => {
      const bad = { subject: null, predicate: p, object: iri('o'), graph: defaultGraph() };
      expect(() => writeMessages([[bad]], { format: 'N-Quads' })).toThrow();
    });

    it('reports an error that is thrown when the version announcement cannot be written', async () => {
      const throwing = { write: () => { throw new Error('closed'); }, end: callback => callback() };
      await expect(new MessageWriter(throwing, { format: 'N-Quads' }).end()).rejects.toThrow('closed');
    });
  });

  describe('MessageStreamWriter', () => {
    it('serializes a stream of messages', async () => {
      const writer = new MessageStreamWriter({ format: 'N-Quads' });
      const output = [];
      writer.on('data', chunk => output.push(chunk));
      writer.write([q1(1)]);
      writer.write([]);
      writer.end([q1(2)]);
      await new Promise(resolve => writer.on('end', resolve));
      expect(render(parseMessages(output.join(''), { format: 'N-Quads' }))).toEqual(render([[q1(1)], [], [q1(2)]]));
    });

    it('round trips through the stream parser', async () => {
      const writer = new MessageStreamWriter({ format: 'TriG' });
      const messages = [[q1(1, g)], [], [q1(2, g), q1(3)]];
      let text = '';
      writer.on('data', chunk => (text += chunk));
      messages.forEach(message => writer.write(message));
      writer.end();
      await new Promise(resolve => writer.on('end', resolve));
      expect(render(await streamResult([text], { format: 'TriG' }))).toEqual(render(messages));
    });

    it('emits an error for messages that cannot be serialized', async () => {
      const writer = new MessageStreamWriter({ format: 'N-Quads' });
      const error = new Promise(resolve => writer.on('error', resolve));
      writer.write([{ subject: null, predicate: p, object: iri('o'), graph: defaultGraph() }]);
      expect(await error).toBeInstanceOf(Error);
    });

    it('does not end its own output twice', async () => {
      const writer = new MessageStreamWriter({ format: 'N-Quads' });
      writer.resume();
      writer.end();
      await new Promise(resolve => writer.on('end', resolve));
      expect(writer.writableEnded).toBe(true);
    });
  });

  describe('round trips', () => {
    it('parse -> write -> parse yields the same messages', () => {
      const parsed = new MessageParser({ format: 'TriG' }).parse(
        'VERSION "1.2-messages"\n@prefix ex: <http://example.org/> .\nex:s ex:p "a\\nb", "c"@en, 5, _:x .\n_:x ex:p ex:o .\nMESSAGE\nMESSAGE\nex:g { ex:s ex:p ex:o . ex:s2 ex:p [ ex:q 1 ] }\nMESSAGE\n_:x ex:p ex:o .');
      for (const format of ['TriG', 'N-Quads']) {
        const again = parseMessages(writeMessages(parsed, { format }), { format });
        expect(render(again)).toEqual(render(parsed));
      }
    });
  });
});
