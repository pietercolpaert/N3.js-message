import { Readable } from 'node:stream';
import type * as RDF from '@rdfjs/types';
import { parseMessages, MessageParser, MessageStreamParser, MessageWriter, writeMessages } from 'n3.js-messages';

const messages: RDF.Quad[][] = parseMessages('<a> <b> <c> .', { format: 'Turtle' });
const parser = new MessageParser({ format: 'TriG', blankNodePrefix: 'b' });
parser.parse(Readable.from(['']), { onMessage: (error, message) => { void error; void message; } });
const text: string = writeMessages(messages);
const writer = new MessageWriter({ format: 'N-Quads' });
const done: Promise<string> = writer.end();
const stream = new MessageStreamParser();
stream.on('prefix', (prefix: string, term: RDF.NamedNode) => { void prefix; void term; });
void [text, done];
// @ts-expect-error: a message is an array of quads
writeMessages([42]);
