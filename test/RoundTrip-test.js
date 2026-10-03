// Differential and round-trip tests, which compare RDF graphs by isomorphism
// because blank node identifiers may legitimately differ.
import documents from './fixtures/documents.js';
import { streamResult } from './util.js';
import { parseMessages, writeMessages, MessageStreamParser, MessageStreamWriter } from '../src/index.js';
import { Parser } from 'n3';
import { isomorphic } from 'rdf-isomorphic';

function expectIsomorphicMessages(actual, expected) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((message, index) => expect(isomorphic(actual[index], message)).toBe(true));
}

describe('differential tests against N3.js', () => {
  const ordinary = [
    ['Turtle', '@prefix ex: <http://example.org/> .\nex:s ex:p "MESSAGE", """multi\nline""", 1.5, true, [ ex:q ( 1 2 ) ] ;\n  ex:r ex:o .\n_:b ex:p _:b .\n'],
    ['TriG', '@prefix ex: <http://example.org/> .\nex:s ex:p ex:o .\nex:g { ex:s ex:p "x"@en . _:a ex:q _:a }\n[] { ex:s ex:p ex:o2 }\n'],
    ['N-Triples', '<http://example.org/s> <http://example.org/p> "a\\nb" .\n_:x <http://example.org/p> _:x .\n'],
    ['N-Quads', '<http://example.org/s> <http://example.org/p> "a" <http://example.org/g> .\n_:x <http://example.org/p> _:x _:g .\n'],
  ];

  it.each(ordinary)('equals N3.js for a single-message %s document, once the framing is stripped', (format, document) => {
    const direct = new Parser({ format }).parse(document);
    const announce = /N-/.test(format) ? 'VERSION "1.2-messages"\n' : '@version "1.2-messages" .\n';
    expectIsomorphicMessages(parseMessages(announce + document, { format }), [direct]);
    expectIsomorphicMessages(parseMessages(document, { format }), [direct]);
  });

  it.each(ordinary)('equals N3.js when a %s document is streamed through message mode in tiny chunks', async (format, document) => {
    const direct = new Parser({ format }).parse(document);
    const announce = /N-/.test(format) ? 'VERSION "1.2-messages"\n' : '@version "1.2-messages" .\n';
    expectIsomorphicMessages(await streamResult([...(announce + document)], { format }), [direct]);
  });

  it('equals N3.js for each message of a log, when the messages are parsed separately', () => {
    const parts = ['<http://example.org/s> <http://example.org/p> "one" .\n_:a <http://example.org/p> _:a .\n', '<http://example.org/s> <http://example.org/p> "two" .\n', ''];
    const log = `VERSION "1.2-messages"\n${parts.join('MESSAGE\n')}`;
    const expected = parts.slice(0, 2).map(part => new Parser({ format: 'N-Quads' }).parse(part));
    expectIsomorphicMessages(parseMessages(log, { format: 'N-Quads' }), expected);
  });
});

describe('round trips', () => {
  const formats = {
    'Turtle': ['Turtle', 'TriG'],
    'TriG': ['TriG', 'N-Quads'],
    'N-Triples': ['N-Triples', 'N-Quads', 'Turtle', 'TriG'],
    'N-Quads': ['N-Quads', 'TriG'],
  };

  describe.each(documents)('$name', ({ format, input }) => {
    it.each(formats[format])('messages -> MessageWriter (%s) -> MessageParser is isomorphic per message', target => {
      const messages = parseMessages(input, { format });
      const written = writeMessages(messages, { format: target, prefixes: { ex: 'http://example.org/' } });
      expectIsomorphicMessages(parseMessages(written, { format: target }), messages);
    });

    it('messages -> MessageStreamWriter -> MessageStreamParser is isomorphic per message', async () => {
      const messages = parseMessages(input, { format });
      const target = formats[format][1];
      const writer = new MessageStreamWriter({ format: target });
      let text = '';
      writer.on('data', chunk => (text += chunk));
      messages.forEach(message => writer.write(message));
      writer.end();
      await new Promise(resolve => writer.on('end', resolve));
      const parser = new MessageStreamParser({ format: target });
      const parsed = [];
      parser.on('data', message => parsed.push(message));
      parser.end(text);
      await new Promise(resolve => parser.on('end', resolve));
      expectIsomorphicMessages(parsed, messages);
    });
  });
});
