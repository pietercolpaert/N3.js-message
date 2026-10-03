import * as RDF from '@rdfjs/types';
import { Readable, Writable } from 'node:stream';
import { DataFactory } from 'n3';
import {
  MessageParser, parseMessages, MessageStreamParser,
  MessageWriter, writeMessages, MessageStreamWriter,
  type MessageParserOptions, type MessageWriterOptions,
} from '../../index.js';

// Plain functions to assert types
function assertType<T>(_value: T): void {}

// --- Parser options
const options: MessageParserOptions = {
  format: 'text/trig;charset=utf-8',
  baseIRI: 'http://example.org/',
  blankNodePrefix: 'b_',
  version: '1.2-messages',
  messages: true,
};
new MessageParser();
new MessageParser({ format: 'Turtle' });
new MessageParser({ format: 'N-Quads' });
new MessageParser({ format: 'ntriples' });
new MessageParser(options);
new MessageParser({ factory: DataFactory });

// --- Return values
const parser = new MessageParser();
const messages = parser.parse('<a> <b> <c> .');
assertType<RDF.Quad[][]>(messages);
const quad: RDF.Quad = messages[0][0];
assertType<RDF.Term>(quad.subject);
assertType<RDF.Quad[][]>(parseMessages('', { format: 'TriG' }));

// @ts-expect-error: a parsed result is an array of messages, not of quads
const wrong: RDF.Quad[] = parser.parse('');
// @ts-expect-error: parse() of a string returns messages, not void
assertType<void>(messages);
// @ts-expect-error: messages are not directly quads
messages[0].subject;
// @ts-expect-error: input must be a string or stream
parser.parse(42);
// @ts-expect-error: unknown option
new MessageParser({ unknown: true });
// @ts-expect-error: format must be a string
new MessageParser({ format: 1 });
// @ts-expect-error: string input without callback has no streaming overload returning void
const nothing: void = parser.parse('');

// --- Callbacks
const stream = Readable.from(['<a> <b> <c> .']);
const r1: void = parser.parse(stream, (error, message, prefixes) => {
  assertType<Error | null>(error);
  assertType<RDF.Quad[] | null>(message);
  if (prefixes)
    assertType<RDF.NamedNode>(prefixes.ex);
});
parser.parse('<a> <b> <c> .', (error, message) => {
  if (message)
    assertType<RDF.Quad>(message[0]);
});
const r2: void = parser.parse(stream, {
  onMessage: (error, message) => {},
  onQuad: (error, q, index) => {
    if (q)
      assertType<RDF.Quad>(q);
    assertType<number | undefined>(index);
  },
  onPrefix: (prefix, term) => {
    assertType<string>(prefix);
    assertType<RDF.NamedNode>(term);
  },
  onVersion: version => assertType<string>(version),
});
// @ts-expect-error: callbacks object has no such handler
parser.parse(stream, { onNothing: () => {} });
// @ts-expect-error: onPrefix receives (string, term)
parser.parse(stream, { onPrefix: (prefix: number) => {} });

// --- Stream parser
const streamParser = new MessageStreamParser({ format: 'TriG' });
streamParser.on('prefix', (prefix, term) => {
  assertType<string>(prefix);
  assertType<RDF.NamedNode>(term);
});
streamParser.on('version', version => assertType<string>(version));
streamParser.on('data', message => assertType<RDF.Quad[]>(message));
streamParser.on('error', error => assertType<Error>(error));
(async () => {
  for await (const message of Readable.from(['x']).pipe(streamParser)) {
    assertType<RDF.Quad[]>(message);
    assertType<RDF.Quad>(message[0]);
  }
  for await (const message of streamParser) {
    // @ts-expect-error: a message is an array, not a quad
    message.subject;
  }
})();

// --- Writer
const q = DataFactory.quad(
  DataFactory.namedNode('http://a'), DataFactory.namedNode('http://b'), DataFactory.literal('c'),
);
const writerOptions: MessageWriterOptions = {
  format: 'N-Quads', prefixes: { ex: 'http://example.org/', ex2: DataFactory.namedNode('http://example.org/2') },
  baseIRI: 'http://example.org/', writeBase: true, version: '1.2-messages', end: false,
};
const writer = new MessageWriter();
new MessageWriter(writerOptions);
new MessageWriter(new Writable(), writerOptions);
new MessageWriter(null, { format: 'Turtle' });
const pAdd: Promise<void> = writer.addMessage([q]);
writer.addMessage([q], error => assertType<Error | null>(error));
const pPrefix: Promise<void> = writer.addPrefix('ex', 'http://example.org/');
writer.addPrefix('ex', DataFactory.namedNode('http://example.org/'), () => {});
const pEnd: Promise<string> = writer.end();
writer.end((error, result) => {
  assertType<string | undefined>(result);
});
// @ts-expect-error: a message must be an array of quads
writer.addMessage('<a> <b> <c> .');
// @ts-expect-error: a message must be an array of quads, not a single quad
writer.addMessage(q);
// @ts-expect-error: array of non-quads
writer.addMessage([1, 2]);
// @ts-expect-error: iri must be a string or NamedNode
writer.addPrefix('ex', 5);
// @ts-expect-error: end() result is a string, not a number
const bad: Promise<number> = writer.end();
assertType<string>(writeMessages([[q], [q]], { format: 'TriG' }));
assertType<string>(writeMessages(messages));
// @ts-expect-error: messages must be arrays of quads
writeMessages([q]);
// @ts-expect-error: result is a string
const notString: number = writeMessages([]);

const streamWriter = new MessageStreamWriter({ format: 'Turtle', prefixes: { ex: 'http://example.org/' } });
streamWriter.write([q]);
streamWriter.pipe(new Writable());
// @ts-expect-error: unknown option
new MessageStreamWriter({ foo: 1 });

// --- RDF/JS typing with a custom data factory
interface MyQuad extends RDF.BaseQuad {
  custom: true;
  termType: 'Quad';
  value: '';
  subject: RDF.Quad_Subject;
  predicate: RDF.Quad_Predicate;
  object: RDF.Quad_Object;
  graph: RDF.Quad_Graph;
  equals(other: RDF.Term | null | undefined): boolean;
}
declare const myFactory: RDF.DataFactory<MyQuad>;
const customParser = new MessageParser({ factory: myFactory });
const custom = customParser.parse('');
assertType<MyQuad[][]>(custom);
assertType<true>(custom[0][0].custom);
// @ts-expect-error: default parser yields plain RDF.Quad, without `custom`
new MessageParser().parse('')[0][0].custom;
assertType<MyQuad[][]>(parseMessages('', { factory: myFactory }));
new MessageStreamParser({ factory: myFactory }).on('data', message => assertType<MyQuad[]>(message));
customParser.parse('', (error, message) => {
  if (message)
    assertType<MyQuad>(message[0]);
});
writeMessages(custom);
