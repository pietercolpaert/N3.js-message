// Consumer check, CommonJS entry point: run by scripts/test-package.js in a clean project.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const lib = require('n3.js-messages');
const { parseMessages, MessageStreamParser, MessageWriter, writeMessages } = lib;

const NAMES = ['MessageParser', 'MessageStreamParser', 'MessageStreamWriter', 'MessageWriter', 'parseMessages', 'writeMessages'];
const DOC = `VERSION "1.2-messages"
PREFIX ex: <http://example.org/>
ex:a ex:p [ ex:q 1 ] .
MESSAGE
ex:b ex:p [ ex:q 2 ] .
`;
const blank = message => message.find(q => q.object.termType === 'BlankNode').object;

// Peer dependency: the package and the consumer must share one n3 install
function n3Dirs(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'n3' && fs.existsSync(path.join(full, 'package.json')))
      found.push(full);
    else if (entry.name !== '.bin')
      n3Dirs(full, found);
  }
  return found;
}

async function main() {
  assert.deepEqual(Object.keys(lib).sort(), NAMES, 'CJS exports');
  const messages = parseMessages(DOC, { format: 'TriG' });
  assert.equal(messages.length, 2, 'message count');
  assert.notEqual(blank(messages[0]).value, blank(messages[1]).value, 'blank nodes differ between messages');

  const streamed = [];
  const parser = new MessageStreamParser({ format: 'TriG' });
  Readable.from([...DOC]).pipe(parser);
  for await (const message of parser)
    streamed.push(message);
  assert.equal(streamed.length, 2, 'streamed message count');
  assert.notEqual(blank(streamed[0]).value, blank(streamed[1]).value);

  const text = writeMessages(messages, { format: 'TriG' });
  assert.equal(parseMessages(text, { format: 'TriG' }).length, 2, 'writeMessages round trip');
  const writer = new MessageWriter({ format: 'N-Quads' });
  messages.forEach(message => writer.addMessage(message));
  assert.equal(parseMessages(await writer.end(), { format: 'N-Quads' }).length, 2, 'MessageWriter round trip');

  // One n3 install, shared by the consumer and by n3.js-messages
  const root = process.cwd();
  const dirs = n3Dirs(path.join(root, 'node_modules'));
  assert.equal(dirs.length, 1, `exactly one n3 install, found: ${dirs.join(', ')}`);
  const resolved = fs.realpathSync(require.resolve('n3'));
  const fromLib = require('node:module').createRequire(require.resolve('n3.js-messages')).resolve('n3');
  assert.equal(fs.realpathSync(fromLib), resolved, 'n3.js-messages resolves the same n3 as the consumer');
  console.log(`CJS consumer OK (n3 ${require('n3/package.json').version})`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
