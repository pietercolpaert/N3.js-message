import CustomFactory from './fixtures/CustomFactory.js';
import documents from './fixtures/documents.js';
import { render, parseAll, iri } from './util.js';
import { MessageParser, parseMessages } from '../src/index.js';
import { Readable } from 'stream';

const V = 'VERSION "1.2-messages"\n';
function T(s, o, g) {
  return `<http://example.org/s${s}> <http://example.org/p> <http://example.org/o${o}>${g ? ` <http://example.org/g${g}>` : ''} .\n`;
}

function R(s, o, g) {
  return `<http://example.org/s${s}> <http://example.org/p> <http://example.org/o${o}>${g ? ` <http://example.org/g${g}>` : ''}`;
}

// Resolves with the messages, prefixes and first error that a callback-style parse reports
function callbackResult(input, options) {
  return new Promise(resolve => {
    const result = { messages: [], error: null, prefixes: null };
    new MessageParser(options).parse(input, (error, message, prefixes) => {
      result.error = result.error || error;
      if (message)
        result.messages.push(message);
      if (error || !message) {
        result.prefixes = prefixes;
        resolve(result);
      }
    });
  });
}

describe('MessageParser', () => {
  describe('documents', () => {
    it.each(documents)('parses $name', ({ format, input, expected }) => {
      expect(parseAll(input, { format })).toEqual(expected);
    });
  });

  describe('message framing', () => {
    function parse(input) {
      return parseAll(input, { format: 'N-Quads' });
    }

    it('parses one message without delimiter', () => {
      expect(parse(`${V}${T(1, 1)}`)).toEqual([[R(1, 1)]]);
    });

    it('parses two messages', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}`)).toEqual([[R(1, 1)], [R(2, 2)]]);
    });

    it('parses three or more messages with several quads each', () => {
      const input = `${V}${T(1, 1)}${T(1, 2)}MESSAGE\n${T(2, 1)}MESSAGE\n${T(3, 1)}${T(3, 2)}${T(3, 3)}MESSAGE\n${T(4, 1)}`;
      expect(parse(input).map(message => message.length)).toEqual([2, 1, 3, 1]);
    });

    it('parses an empty first message', () => {
      expect(parse(`${V}MESSAGE\n${T(1, 1)}`)).toEqual([[], [R(1, 1)]]);
    });

    it('parses an empty message between messages', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\nMESSAGE\n${T(2, 2)}`)).toEqual([[R(1, 1)], [], [R(2, 2)]]);
    });

    it('does not create an extra message for a trailing delimiter', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\n`)).toEqual([[R(1, 1)]]);
      expect(parse(`${V}${T(1, 1)}MESSAGE`)).toEqual([[R(1, 1)]]);
    });

    it('parses consecutive trailing delimiters as empty messages (the last one is ignored)', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\nMESSAGE\nMESSAGE # last delimiter ignored\n`)).toEqual([[R(1, 1)], [], []]);
    });

    it('parses a lone delimiter as one empty message', () => {
      expect(parse(`${V}MESSAGE\n`)).toEqual([[]]);
      expect(parse(`${V}MESSAGE\nMESSAGE\n`)).toEqual([[], []]);
    });

    it('parses an announced log without statements as no messages', () => {
      expect(parse(V)).toEqual([]);
      expect(parse(`${V}# only a comment\n`)).toEqual([]);
    });

    it('parses an empty document as no messages', () => {
      expect(parse('')).toEqual([]);
    });

    it('preserves the order of quads within a message', () => {
      const quads = [3, 1, 2, 5, 4];
      expect(parse(`${V}${quads.map(n => T(n, n)).join('')}`)).toEqual([quads.map(n => R(n, n))]);
    });

    it('does not merge messages: equal quads in different messages stay separate', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\n${T(1, 1)}`)).toEqual([[R(1, 1)], [R(1, 1)]]);
    });

    it('accepts @message with different whitespace', () => {
      const input = `@version "1.2-messages" .\n${T(1, 1)}@message.\n${T(2, 2)}@message   \t .\n${T(3, 3)}@message # c\n.\n${T(4, 4)}`;
      expect(parseMessages(input, { format: 'Turtle' })).toHaveLength(4);
    });

    it('accepts both delimiter spellings in Turtle and TriG', () => {
      for (const format of ['Turtle', 'TriG']) {
        expect(parseAll(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}@message .\n${T(3, 3)}`, { format })).toEqual([[R(1, 1)], [R(2, 2)], [R(3, 3)]]);
        expect(parseAll(`@version "1.2-messages" .\n${T(1, 1)}@message .\n${T(2, 2)}`, { format })).toEqual([[R(1, 1)], [R(2, 2)]]);
      }
    });

    it('treats @message as unsupported in line formats', () => {
      expect(() => parseMessages(`${V}${T(1, 1)}@message .\n${T(2, 2)}`, { format: 'N-Triples' })).toThrow();
    });

    it('accepts all three messages version labels', () => {
      for (const label of ['1.2-messages', '1.2-basic-messages', '1.1-messages'])
        expect(parse(`VERSION "${label}"\n${T(1, 1)}MESSAGE\n${T(2, 2)}`)).toHaveLength(2);
    });

    it('accepts a version label in a single-quoted string and in old-style syntax', () => {
      expect(parseAll(`@version '1.2-messages' .\n${T(1, 1)}MESSAGE\n${T(2, 2)}`, { format: 'Turtle' })).toHaveLength(2);
    });

    it('lets a repeated version announcement through (for concatenated logs)', () => {
      expect(parse(`${V}${T(1, 1)}MESSAGE\n${V}${T(2, 2)}`)).toHaveLength(2);
    });

    it('keeps messages mode after a later plain version', () => {
      expect(parse(`${V}${T(1, 1)}VERSION "1.2"\nMESSAGE\n${T(2, 2)}`)).toHaveLength(2);
    });
  });

  describe('Turtle and TriG syntax', () => {
    it('parses a graph block per message', () => {
      const input = `${V}<http://example.org/g1> { ${T(1, 1)} }\nMESSAGE\n<http://example.org/g1> { ${T(2, 2)} }\n`;
      expect(parseAll(input, { format: 'TriG' })).toEqual([[R(1, 1, 1)], [R(2, 2, 1)]]);
    });

    it('parses the GRAPH keyword and blank node graph labels', () => {
      const input = `${V}GRAPH <http://example.org/g1> { ${T(1, 1)} }\nMESSAGE\n_:g { ${T(2, 2)} }\n[] { ${T(3, 3)} }\n`;
      expect(parseAll(input, { format: 'TriG' })).toEqual([[R(1, 1, 1)], ['<http://example.org/s2> <http://example.org/p> <http://example.org/o2> _:b0', '<http://example.org/s3> <http://example.org/p> <http://example.org/o3> _:b1']]);
    });

    it('parses lists, blank node property lists and multiline literals', () => {
      const input = `${V}@prefix ex: <http://example.org/> .\nex:s ex:p ( 1 2 ) , [ ex:q """a\nb""" ] .\nMESSAGE\nex:s ex:p ( ) .\n`;
      const messages = new MessageParser({ format: 'Turtle' }).parse(input);
      expect(messages.map(message => message.length)).toEqual([7, 1]);
      expect(render(messages)[0]).toContain('_:b2 <http://example.org/q> "a\\nb"');
    });

    it('parses reified triples and annotations in RDF 1.2 syntax', () => {
      const input = `${V}@prefix ex: <http://example.org/> .\nex:s ex:p ex:o {| ex:q ex:r |} .\nMESSAGE\n<< ex:s ex:p ex:o >> ex:q ex:r .\n`;
      const messages = new MessageParser({ format: 'TriG' }).parse(input);
      expect(messages).toHaveLength(2);
      expect(messages[0].length).toBeGreaterThan(1);
    });

    it('does not parse graph blocks in Turtle', () => {
      expect(() => parseMessages(`${V}<http://example.org/g> { ${T(1, 1)} }`, { format: 'Turtle' })).toThrow(/Expected entity but got \{/);
    });
  });

  describe('prefixes and base IRI', () => {
    it('keeps prefixes in effect across messages', () => {
      const input = `${V}PREFIX ex: <http://example.org/>\nex:s1 ex:p ex:o1 .\nMESSAGE\nex:s2 ex:p ex:o2 .\n@message .\nex:s3 ex:p ex:o3 .`;
      expect(parseAll(input, { format: 'Turtle' }).flat()).toEqual([R(1, 1), R(2, 2), R(3, 3)]);
    });

    it('lets a repeated PREFIX override the previous one for the rest of the document', () => {
      const input = `${V}PREFIX ex: <http://example.org/one/>\nex:s ex:p ex:o .\nMESSAGE\nPREFIX ex: <http://example.org/two/>\nex:s ex:p ex:o .\nMESSAGE\nex:s ex:p ex:o .`;
      expect(parseAll(input, { format: 'Turtle' })).toEqual([
        ['<http://example.org/one/s> <http://example.org/one/p> <http://example.org/one/o>'],
        ['<http://example.org/two/s> <http://example.org/two/p> <http://example.org/two/o>'],
        ['<http://example.org/two/s> <http://example.org/two/p> <http://example.org/two/o>'],
      ]);
    });

    it('lets a PREFIX directive come after the delimiter and before the first statement', () => {
      expect(parseAll(`${V}MESSAGE\n@prefix ex: <http://example.org/> .\nex:s1 ex:p ex:o1 .`, { format: 'Turtle' })).toEqual([[], [R(1, 1)]]);
    });

    it('keeps the BASE in effect across messages and lets a repeated BASE override it', () => {
      const input = `${V}BASE <http://example.org/one/>\n<s> <p> <o> .\nMESSAGE\n<s> <p> <o> .\nMESSAGE\nBASE <http://example.org/two/>\n<s> <p> <o> .`;
      expect(parseAll(input, { format: 'Turtle' }).map(m => m[0].split(' ')[0])).toEqual([
        '<http://example.org/one/s>', '<http://example.org/one/s>', '<http://example.org/two/s>']);
    });

    it('uses the baseIRI option', () => {
      expect(parseAll(`${V}<s> <p> <o> .\nMESSAGE\n<s2> <p> <o> .`, { format: 'Turtle', baseIRI: 'http://example.org/base/' }).flat())
        .toEqual(['<http://example.org/base/s> <http://example.org/base/p> <http://example.org/base/o>', '<http://example.org/base/s2> <http://example.org/base/p> <http://example.org/base/o>']);
    });

    it('reports the final prefixes', async () => {
      const { prefixes } = await callbackResult(`${V}PREFIX ex: <http://example.org/>\nex:s ex:p ex:o .\nMESSAGE\nPREFIX f: <http://f/>\nex:s ex:p ex:o .`, { format: 'Turtle' });
      expect(prefixes).toEqual({ ex: 'http://example.org/', f: 'http://f/' });
    });
  });

  describe('blank node scoping', () => {
    function input(format, graph) {
      return `${V}_:a <http://example.org/p> <http://example.org/o1>${graph} .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o2>${graph} .\n`;
    }

    function subjects(messages) {
      return messages.map(message => message[0].subject);
    }

    it.each([['Turtle', ''], ['TriG', ''], ['N-Triples', ''], ['N-Quads', ''], ['N-Quads', ' <http://example.org/g>']])(
      'does not share a blank node label between messages in %s%s', (format, graph) => {
        const [a, b] = subjects(new MessageParser({ format }).parse(input(format, graph)));
        expect(a.termType).toBe('BlankNode');
        expect(b.termType).toBe('BlankNode');
        expect(a.equals(b)).toBe(false);
      });

    it('keeps a blank node label within one message', () => {
      const [message] = new MessageParser({ format: 'N-Quads' }).parse(`${V}_:a <http://example.org/p> _:a .\n_:a <http://example.org/q> _:b .\n`);
      expect(message[0].subject.equals(message[0].object)).toBe(true);
      expect(message[0].subject.equals(message[1].subject)).toBe(true);
      expect(message[1].subject.equals(message[1].object)).toBe(false);
    });

    it('keeps blank node labels distinct across messages that are separated by empty messages', () => {
      const messages = new MessageParser({ format: 'TriG' }).parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\nMESSAGE\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .\n`);
      expect(messages).toHaveLength(4);
      expect(messages[0][0].subject.equals(messages[3][0].subject)).toBe(false);
    });

    it('scopes blank nodes in triple terms and graph labels', () => {
      const messages = new MessageParser({ format: 'TriG' }).parse(`${V}_:g { << _:a <http://example.org/p> _:a >> <http://example.org/q> _:a . }\nMESSAGE\n_:g { << _:a <http://example.org/p> _:a >> <http://example.org/q> _:a . }`);
      const [first, second] = messages.map(message => message.find(quad => quad.object.termType === 'Quad'));
      expect(first.graph.equals(second.graph)).toBe(false);
      expect(first.object.subject.equals(second.object.subject)).toBe(false);
      expect(first.object.subject.equals(first.object.object)).toBe(true);
    });

    it('scopes the blank nodes that a custom data factory creates', () => {
      const messages = new MessageParser({ format: 'TriG', factory: CustomFactory }).parse(`${V}_:a <http://example.org/p> _:a .\nMESSAGE\n_:a <http://example.org/p> _:a .\n`);
      const [a, b] = messages.map(message => message[0].subject);
      expect(a.equals(b)).toBe(false);
      expect(a.equals(messages[0][0].object)).toBe(true);
      expect(a.constructor).toBe(CustomFactory.blankNode('x').constructor);
    });

    it('scopes blank nodes with a custom data factory in line formats', () => {
      const messages = new MessageParser({ format: 'N-Quads', factory: CustomFactory }).parse(`${V}_:a <http://example.org/p> _:b <http://example.org/g> .\nMESSAGE\n_:a <http://example.org/p> _:b <http://example.org/g> .\n`);
      expect(messages[0][0].subject.equals(messages[1][0].subject)).toBe(false);
      expect(messages[0][0].object.equals(messages[1][0].object)).toBe(false);
      expect(messages[0][0].graph.equals(messages[1][0].graph)).toBe(true);
    });

    it('builds quads with the custom data factory', () => {
      const [[quad]] = new MessageParser({ format: 'TriG', factory: CustomFactory }).parse(`${V}<http://example.org/s> <http://example.org/p> "x"@en .`);
      expect(quad.constructor.name).toBe('CustomQuad');
      expect(quad.object.constructor.name).toBe('CustomLiteral');
    });

    it('uses blankNodePrefix for the scoped blank nodes, also after the first message', () => {
      const messages = new MessageParser({ format: 'TriG', blankNodePrefix: 'custom' }).parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .`);
      const values = messages.map(message => message[0].subject.value);
      expect(new Set(values).size).toBe(3);
      values.forEach(value => expect(value).toMatch(/^custom\d+$/));
    });

    it('also accepts a blankNodePrefix that starts with an underscore and colon, or is empty', () => {
      const values = ['_:custom', ''].map(blankNodePrefix => new MessageParser({ format: 'TriG', blankNodePrefix })
        .parse(`${V}_:a <http://example.org/p> <http://example.org/o> .\nMESSAGE\n_:a <http://example.org/p> <http://example.org/o> .`)
        .map(message => message[0].subject.value));
      expect(values[0][0]).toMatch(/^custom\d+$/);
      expect(values[1][0]).toMatch(/^\d+$/);
      values.forEach(([a, b]) => expect(a).not.toBe(b));
    });

    it('does not rename blank nodes of documents that are not message logs', () => {
      const [[quad]] = new MessageParser({ format: 'TriG' }).parse('_:a <http://example.org/p> <http://example.org/o> .');
      expect(quad.subject.value).toMatch(/^b\d+_a$/);
    });
  });

  describe('options', () => {
    it('defaults to TriG', () => {
      expect(render(new MessageParser().parse(`${V}<http://example.org/g> { ${T(1, 1)} }`))).toEqual([[R(1, 1, undefined).replace(/$/, ' <http://example.org/g>')]]);
    });

    it.each(['turtle', 'TURTLE', 'text/turtle', 'text/turtle; charset=utf-8', 'trig', 'application/trig', 'N-Triples', 'ntriples', 'application/n-triples',
      'N-Quads', 'nquads', 'application/n-quads', 'application/x-trig'])('accepts the format %s', format => {
        expect(() => new MessageParser({ format })).not.toThrow();
      });

    it.each(['N3', 'text/n3', 'JSON-LD', 'rdf/xml', 'nonsense'])('rejects the unsupported format %s', format => {
      expect(() => new MessageParser({ format })).toThrow(/Unsupported RDF Messages format/);
      expect(() => parseMessages('', { format })).toThrow(TypeError);
    });

    it('rejects unsupported versions in the version option', () => {
      expect(() => new MessageParser({ version: '0.9-messages' })).toThrow(/unsupported version/);
      expect(() => new MessageParser({ version: '1.2-basic-messages-messages' })).toThrow(/unsupported version/);
    });

    it('treats the version option as announcement, as in a media type parameter', () => {
      expect(parseAll(`${T(1, 1)}MESSAGE\n${T(2, 2)}`, { format: 'N-Triples', version: '1.2-messages' })).toEqual([[R(1, 1)], [R(2, 2)]]);
      expect(parseAll(`${T(1, 1)}MESSAGE\n${T(2, 2)}`, { format: 'Turtle', version: '1.1-messages' })).toEqual([[R(1, 1)], [R(2, 2)]]);
    });

    it('accepts a plain version option, which does not announce messages', () => {
      expect(parseAll(T(1, 1), { format: 'Turtle', version: '1.2' })).toEqual([[R(1, 1)]]);
      expect(() => parseMessages(`${T(1, 1)}MESSAGE\n`, { format: 'Turtle', version: '1.2' })).toThrow(/did not announce/);
    });

    it('treats the messages option as announcement', () => {
      expect(parseAll(`${T(1, 1)}MESSAGE\n${T(2, 2)}`, { format: 'TriG', messages: true })).toEqual([[R(1, 1)], [R(2, 2)]]);
      expect(parseAll(`${T(1, 1)}MESSAGE\n${T(2, 2)}`, { format: 'N-Quads', messages: true })).toEqual([[R(1, 1)], [R(2, 2)]]);
    });
  });

  describe('callbacks', () => {
    const input = `${V}PREFIX ex: <http://example.org/>\nex:s1 ex:p ex:o1 .\nMESSAGE\nMESSAGE\nex:s2 ex:p ex:o2 .\n`;

    it('calls the callback with every message and a final call with null', () => {
      const calls = [];
      const result = new MessageParser({ format: 'Turtle' }).parse(input, (error, message, prefixes) => calls.push([error, message && message.length, prefixes && Object.keys(prefixes)]));
      expect(result).toBeUndefined();
      expect(calls).toEqual([[null, 1, undefined], [null, 0, undefined], [null, 1, undefined], [null, null, ['ex']]]);
    });

    it('delivers messages to onMessage without an onQuad listener', () => {
      const messages = [];
      new MessageParser({ format: 'Turtle' }).parse(input, { onMessage: (error, message) => message && messages.push(message) });
      expect(messages.map(message => message.length)).toEqual([1, 0, 1]);
    });

    it('delivers the index of each message, and quads with the index of their message', () => {
      const indexes = [], quads = [];
      new MessageParser({ format: 'Turtle' }).parse(input, {
        onMessage: (error, message, prefixes, index) => message && indexes.push(index),
        onQuad: (error, quad, index) => quad && quads.push([quad.subject.value.slice(-2), index]),
      });
      expect(indexes).toEqual([0, 1, 2]);
      expect(quads).toEqual([['s1', 0], ['s2', 2]]);
    });

    it('delivers only quads to onQuad, and reports no messages without onMessage', () => {
      const quads = [];
      new MessageParser({ format: 'Turtle' }).parse(input, { onQuad: (error, quad) => quad && quads.push(quad) });
      expect(quads).toHaveLength(2);
    });

    it('calls onPrefix and onVersion', () => {
      const prefixes = [], versions = [];
      new MessageParser({ format: 'Turtle' }).parse(input, {
        onPrefix: (prefix, term) => prefixes.push([prefix, term.value]),
        onVersion: version => versions.push(version),
      });
      expect(prefixes).toEqual([['ex', 'http://example.org/']]);
      expect(versions).toEqual(['1.2-messages']);
    });

    it('reports errors through the callbacks', () => {
      const errors = [];
      const callbacks = { onMessage: error => error && errors.push(error), onQuad: error => error && errors.push(error) };
      new MessageParser({ format: 'Turtle' }).parse(`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p>`, callbacks);
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toMatch(/Expected entity but got eof on line 4/);
    });

    it('delivers the messages that are complete before an error', () => {
      const messages = [];
      let failed = null;
      new MessageParser({ format: 'N-Quads' }).parse(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}MESSAGE\n<broken\n`, (error, message) => {
        failed = failed || error;
        message && messages.push(message);
      });
      expect(messages).toHaveLength(2);
      expect(failed).toBeTruthy();
    });

    it('reports an error at most once and stops after it', () => {
      const calls = [];
      new MessageParser({ format: 'N-Quads' }).parse(`${V}<broken\nMESSAGE\n${T(1, 1)}`, (error, message) => calls.push([!!error, !!message]));
      expect(calls).toEqual([[true, false]]);
    });
  });

  describe('streams as input', () => {
    it('parses a readable stream of strings and buffers', async () => {
      const chunks = [Buffer.from(`${V}<http://example.org/s> <http://example.org/p> "h\u00e9`), Buffer.from('llo\u2603" .\nMESSAGE\n'), `${T(2, 2)}`];
      const { messages } = await callbackResult(Readable.from(chunks, { objectMode: true }), { format: 'N-Quads' });
      expect(render(messages)).toEqual([['<http://example.org/s> <http://example.org/p> "h\u00e9llo\u2603"'], [R(2, 2)]]);
    });

    it('splits multi-byte characters across buffers', async () => {
      const bytes = Buffer.from(`${V}<http://example.org/s> <http://example.org/p> "\u2603\u{1F600}" .\n`);
      const { messages } = await callbackResult(Readable.from([...bytes].map(byte => Buffer.from([byte])), { objectMode: true }), { format: 'N-Quads' });
      expect(messages[0][0].object.value).toBe('\u2603\u{1F600}');
    });

    it('reports stream errors', async () => {
      const stream = new Readable({ read() {} });
      const result = callbackResult(stream, { format: 'N-Quads' });
      stream.destroy(new Error('stream failed'));
      expect((await result).error.message).toBe('stream failed');
    });
  });

  describe('parser instances', () => {
    it('can parse several documents, without leaking announcements between them', () => {
      const parser = new MessageParser({ format: 'N-Quads' });
      expect(parser.parse(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}`)).toHaveLength(2);
      // The second document does not announce messages, so a delimiter is an error
      expect(() => parser.parse(`${T(1, 1)}MESSAGE\n${T(2, 2)}`)).toThrow(/did not announce/);
      expect(parser.parse(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}`)).toHaveLength(2);
    });

    it('does not share blank node scopes between documents', () => {
      const parser = new MessageParser({ format: 'N-Quads' });
      const document = `${V}_:a <http://example.org/p> <http://example.org/o> .\n`;
      expect(parser.parse(document)[0][0].subject.equals(parser.parse(document)[0][0].subject)).toBe(false);
    });
  });

  describe('errors', () => {
    function fails(input, format, pattern) {
      expect(() => parseMessages(input, { format })).toThrow(pattern);
    }

    it('rejects a delimiter in a document that is not announced as message log', () => {
      for (const format of ['Turtle', 'TriG', 'N-Triples', 'N-Quads'])
        fails(`${T(1, 1)}MESSAGE\n`, format, /Unexpected "MESSAGE" on line 2: the document did not announce/);
    });

    it('rejects a delimiter without line information when it is the first one', () => {
      fails('MESSAGE', 'N-Quads', /did not announce/);
    });

    it('rejects @message without a dot', () => {
      fails(`${V}${T(1, 1)}@message <http://example.org/invalid>`, 'Turtle', /Expected declaration to end with a dot/);
      fails(`${V}${T(1, 1)}@message\n`, 'TriG', /Unexpected end of file|Expected declaration/);
    });

    it('rejects a delimiter inside a graph block', () => {
      fails(`${V}<http://example.org/g> {\n${T(1, 1)}MESSAGE\n${T(2, 2)}}`, 'TriG', /Expected entity but got MESSAGE on line 4/);
      fails(`${V}<http://example.org/g> {\n${T(1, 1)}@message .\n}`, 'TriG', /@message/);
      fails(`${V}<http://example.org/g> { ${T(1, 1)} MESSAGE }`, 'TriG', /Expected entity but got MESSAGE/);
    });

    it('rejects a delimiter inside a statement', () => {
      fails(`${V}<http://example.org/s> MESSAGE <http://example.org/p> <http://example.org/o> .`, 'Turtle', /Expected/);
      fails(`${V}<http://example.org/s> <http://example.org/p> MESSAGE <http://example.org/o> .`, 'Turtle', /Expected entity but got/);
      fails(`${V}<http://example.org/s> <http://example.org/p> <http://example.org/o> MESSAGE .`, 'Turtle', /Expected/);
      fails(`${V}<http://example.org/s> <http://example.org/p> ( <http://example.org/o> @message . ) .`, 'Turtle', /./);
      fails(`${V}<http://example.org/s> <http://example.org/p> [ <http://example.org/q> MESSAGE ] .`, 'Turtle', /Expected/);
      fails(`${V}<http://example.org/s> <http://example.org/p> << <http://example.org/s> MESSAGE >> .`, 'Turtle', /./);
    });

    it('accepts SPARQL-style delimiters in any case in Turtle and TriG, like PREFIX, BASE and VERSION', () => {
      for (const format of ['Turtle', 'TriG'])
        expect(render(parseMessages(`${V}${T(1, 1)}message\n${T(2, 2)}Message\n`, { format }))).toEqual([[R(1, 1)], [R(2, 2)]]);
    });

    it('rejects a single-quoted or lowercase version announcement in line formats', () => {
      for (const format of ['N-Triples', 'N-Quads']) {
        fails(`VERSION '1.2-messages'\n${T(1, 1)}`, format, /Unexpected "'1.2-messages'" on line 1/);
        fails(`version "1.2-messages"\n${T(1, 1)}`, format, /Unexpected "version" on line 1/);
      }
    });

    it('rejects a delimiter with trailing content in line formats', () => {
      fails(`${V}MESSAGE <http://example.org/s> <http://example.org/p> <http://example.org/o> .`, 'N-Triples', /Unexpected "MESSAGE"/);
      fails(`${V}${T(1, 1).trim()} MESSAGE\n`, 'N-Triples', /Unexpected/);
      fails(`${V}MESSAGE .\n`, 'N-Quads', /Unexpected "MESSAGE"/);
    });

    it('rejects a misspelled or lowercase delimiter', () => {
      fails(`${V}${T(1, 1)}MESSAG\n`, 'Turtle', /Unexpected/);
      fails(`${V}${T(1, 1)}@Message .\n`, 'Turtle', /Expected entity but got @Message/);
      fails(`${V}${T(1, 1)}MESSAGES\n`, 'N-Quads', /Unexpected/);
    });

    it('rejects an unsupported version, with or without the messages suffix', () => {
      for (const format of ['Turtle', 'TriG', 'N-Triples', 'N-Quads']) {
        fails(`VERSION "2.0-messages"\n${T(1, 1)}`, format, /unsupported version: "2.0-messages"/);
        fails(`VERSION "0.1"\n${T(1, 1)}`, format, /unsupported version: "0.1"/);
        fails('VERSION "messages"\n', format, /unsupported version/);
      }
    });

    it('rejects announcing messages after the first statement', () => {
      fails(`${T(1, 1)}${V}${T(2, 2)}`, 'N-Quads', /must be announced before the first statement/);
      fails(`${T(1, 1)}@version "1.2-messages" .\n${T(2, 2)}`, 'Turtle', /must be announced before the first statement/);
    });

    it('rejects malformed RDF in any message', () => {
      fails(`${V}${T(1, 1)}MESSAGE\n<http://example.org/s> <http://example.org/p> .\n`, 'Turtle', /Expected entity but got \./);
      fails(`${V}${T(1, 1)}MESSAGE\n${T(2, 2)}<broken`, 'N-Quads', /./);
      fails(`${V}${T(1, 1)}MESSAGE\n"literal" <http://example.org/p> <http://example.org/o> .\n`, 'N-Triples', /./);
    });

    it('rejects a graph label in N-Triples messages', () => {
      fails(`${V}${T(1, 1, 1)}`, 'N-Triples', /./);
    });

    it('rejects an unclosed graph at the end of a message log', () => {
      fails(`${V}<http://example.org/g> { ${T(1, 1)}`, 'TriG', /Unclosed graph|Unexpected end/);
    });

    it('includes the line number of errors', () => {
      expect(() => parseMessages(`${V}${T(1, 1)}MESSAGE\n\n<broken`, { format: 'N-Quads' })).toThrow(/line 5/);
    });
  });

  describe('versions of the same data', () => {
    it('parses ordinary N-Triples and Turtle as one message', () => {
      expect(parseAll(`${T(1, 1)}${T(2, 2)}`, { format: 'N-Triples' })).toEqual([[R(1, 1), R(2, 2)]]);
      expect(render([parseMessages('@prefix ex: <http://example.org/> .\nex:s1 ex:p ex:o1 .', { format: 'Turtle' })[0]])).toEqual([[R(1, 1)]]);
    });
  });

  it('exports iri helper for tests', () => {
    expect(iri('x').value).toBe('http://example.org/x');
  });
});
