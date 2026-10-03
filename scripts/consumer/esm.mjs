// Consumer check, ESM entry point: run by scripts/test-package.js in a clean project.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import * as lib from 'n3.js-messages';
import {
  parseMessages, MessageParser, MessageStreamParser, MessageWriter, MessageStreamWriter, writeMessages,
} from 'n3.js-messages';

const require = createRequire(import.meta.url);
const NAMES = ['MessageParser', 'MessageStreamParser', 'MessageStreamWriter', 'MessageWriter', 'parseMessages', 'writeMessages'];
const DOC = `VERSION "1.2-messages"
PREFIX ex: <http://example.org/>
ex:a ex:p [ ex:q 1 ] .
MESSAGE
ex:b ex:p [ ex:q 2 ] .
`;

assert.deepEqual(Object.keys(lib).sort(), NAMES, 'ESM exports');
// CommonJS entry point exposes the same names
const cjs = require('n3.js-messages');

assert.deepEqual(Object.keys(cjs).sort(), NAMES, 'CJS exports');

// Parse
const messages = parseMessages(DOC, { format: 'TriG' });
assert.equal(messages.length, 2, 'message count');
assert.equal(new MessageParser({ format: 'text/trig' }).parse(DOC).length, 2);
function blank(message) {
  return message.find(q => q.object.termType === 'BlankNode').object;
}
assert.notEqual(blank(messages[0]).value, blank(messages[1]).value, 'blank nodes differ between messages');

// Stream parse, one character per chunk
const streamed = [];
const prefixes = [];
const versions = [];
const parser = new MessageStreamParser({ format: 'TriG' });
parser.on('prefix', prefix => prefixes.push(prefix));
parser.on('version', version => versions.push(version));
Readable.from([...DOC]).pipe(parser);
for await (const message of parser)
  streamed.push(message);
assert.equal(streamed.length, 2, 'streamed message count');
assert.deepEqual(prefixes, ['ex']);
assert.deepEqual(versions, ['1.2-messages']);
assert.notEqual(blank(streamed[0]).value, blank(streamed[1]).value);

// Write and parse back
for (const format of ['TriG', 'Turtle']) {
  const text = writeMessages(messages, { format, prefixes: { ex: 'http://example.org/' } });
  const back = parseMessages(text, { format });
  assert.equal(back.length, 2, `${format} round trip`);
  assert.equal(back[0].length, messages[0].length);
}
const writer = new MessageWriter({ format: 'N-Quads' });
await writer.addMessage(messages[0]);
await writer.addMessage(messages[1]);
const text = await writer.end();
assert.equal(typeof text, 'string');
assert.equal(parseMessages(text, { format: 'N-Quads' }).length, 2, 'MessageWriter round trip');

// Stream writer
const out = [];
const streamWriter = new MessageStreamWriter({ format: 'TriG' });
streamWriter.on('data', chunk => out.push(chunk));
await new Promise((resolve, reject) => {
  streamWriter.on('end', resolve).on('error', reject);
  Readable.from(messages).pipe(streamWriter);
});
assert.equal(parseMessages(out.join(''), { format: 'TriG' }).length, 2, 'MessageStreamWriter round trip');
console.log('ESM consumer OK');
