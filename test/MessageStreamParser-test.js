import documents from './fixtures/documents.js';
import { render, streamResult, splitEvery, randomChunks, mulberry32 } from './util.js';
import { MessageStreamParser, parseMessages } from '../src/index.js';
import { Readable, Writable, pipeline } from 'stream';
import vm from 'vm';
import v8 from 'v8';

const V = 'VERSION "1.2-messages"\n';

describe('MessageStreamParser', () => {
  describe('basic behaviour', () => {
    it('is an object-mode stream of messages', async () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      expect(parser.readableObjectMode).toBe(true);
      const messages = await streamResult([`${V}<a:s> <a:p> <a:o> .\nMESSAGE\nMESSAGE\n<a:s> <a:p> <a:o2> .`], { format: 'N-Quads' });
      expect(messages.map(message => message.length)).toEqual([1, 0, 1]);
    });

    it('accepts buffers and strings', async () => {
      const messages = await streamResult([Buffer.from(`${V}<a:s> <a:p> <a:o> .\nMES`), 'SAGE\n', Buffer.from('<a:s> <a:p> <a:o2> .')], { format: 'N-Quads' });
      expect(messages).toHaveLength(2);
    });

    it('ends without messages for empty input', async () => {
      expect(await streamResult([], { format: 'TriG' })).toEqual([]);
      expect(await streamResult([''], { format: 'TriG' })).toEqual([]);
    });

    it('emits prefix and version events', async () => {
      const parser = new MessageStreamParser({ format: 'Turtle' });
      const events = [];
      parser.on('prefix', (prefix, term) => events.push(['prefix', prefix, term.value]));
      parser.on('version', label => events.push(['version', label]));
      parser.resume();
      parser.end(`${V}@prefix ex: <http://example.org/> .\nex:s ex:p ex:o .`);
      await new Promise(resolve => parser.on('end', resolve));
      expect(events).toEqual([['version', '1.2-messages'], ['prefix', 'ex', 'http://example.org/']]);
    });

    it('can be used as async iterable', async () => {
      const parser = Readable.from([`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p> <a:o2> .`]).pipe(new MessageStreamParser({ format: 'N-Quads' }));
      const messages = [];
      for await (const message of parser)
        messages.push(message);
      expect(messages).toHaveLength(2);
    });

    it('defaults to TriG without options', async () => {
      const parser = new MessageStreamParser();
      const messages = [];
      parser.on('data', message => messages.push(message));
      parser.end(`${V}<a:g> { <a:s> <a:p> <a:o> }`);
      await new Promise(resolve => parser.on('end', resolve));
      expect(messages[0][0].graph.value).toBe('a:g');
    });

    it('rejects unsupported options when it is constructed', () => {
      expect(() => new MessageStreamParser({ format: 'nope' })).toThrow(TypeError);
    });
  });

  describe('incremental emission', () => {
    it('emits a message as soon as its delimiter has arrived, before the input ends', () => {
      const parser = new MessageStreamParser({ format: 'TriG' });
      const messages = [];
      parser.on('data', message => messages.push(message));
      parser.write(`${V}<a:s> <a:p> <a:o> .\n`);
      expect(messages).toHaveLength(0);
      parser.write('MESSAGE\n');
      expect(messages).toHaveLength(1);
      parser.write('<a:s> <a:p> <a:o2> .\n@message');
      expect(messages).toHaveLength(1);
      parser.write(' .\n');
      expect(messages).toHaveLength(2);
      parser.write('MESSAGE');
      expect(messages).toHaveLength(2);
      parser.write('\n');
      expect(messages).toHaveLength(3);
    });

    it('emits N-Quads messages when their delimiter line is complete', () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      const messages = [];
      parser.on('data', message => messages.push(message));
      parser.write(`${V}<a:s> <a:p> <a:o> .\nMESSAGE`);
      expect(messages).toHaveLength(0);
      parser.write('\n');
      expect(messages).toHaveLength(1);
    });

    it('emits the last message at the end of the input', async () => {
      const parser = new MessageStreamParser({ format: 'TriG' });
      const messages = [];
      parser.on('data', message => messages.push(message));
      parser.write(`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p> <a:o2> .\n`);
      expect(messages).toHaveLength(1);
      parser.end();
      await new Promise(resolve => parser.on('end', resolve));
      expect(messages).toHaveLength(2);
    });
  });

  describe('chunk boundaries', () => {
    describe.each(documents)('$name', ({ format, input, expected }) => {
      it('equals the synchronous result for every two-chunk split', () => {
        const sync = render(parseMessages(input, { format }));
        expect(sync).toEqual(expected);
        for (let i = 0; i <= input.length; i++)
          expect(render(parseChunksSync([input.slice(0, i), input.slice(i)], format))).toEqual(sync);
      });

      it('equals the synchronous result when streaming one character at a time', async () => {
        expect(render(await streamResult([...input], { format }))).toEqual(expected);
      });

      it('equals the synchronous result when streaming one byte at a time', async () => {
        const bytes = [...Buffer.from(input)].map(byte => Buffer.from([byte]));
        expect(render(await streamResult(bytes, { format }))).toEqual(expected);
      });

      it('equals the synchronous result for seeded random chunk sizes', async () => {
        const random = mulberry32(2024);
        for (let i = 0; i < 25; i++)
          expect(render(await streamResult(randomChunks(input, random, 1 + (i % 17)), { format }))).toEqual(expected);
      });
    });

    it('handles chunk boundaries inside every part of the delimiters', async () => {
      const input = `${V}<a:s> <a:p> <a:o> .\r\nMESSAGE\r\n<a:s> <a:p> <a:o> .\r\n@message\r\n.\r\nMESSAGE # c`;
      for (const format of ['Turtle', 'TriG']) {
        const expected = render(parseMessages(input, { format }));
        expect(expected).toHaveLength(3);
        for (const size of [1, 2, 3, 5, 7])
          expect(render(await streamResult(splitEvery(input, size), { format }))).toEqual(expected);
      }
    });

    it('handles chunk boundaries after a carriage return of CRLF', async () => {
      const input = `${V}<a:s> <a:p> <a:o> .\r\nMESSAGE\r\n<a:s> <a:p> <a:o2> .\r\n`;
      for (const format of ['N-Quads', 'Turtle']) {
        const at = input.indexOf('\r\n') + 1;
        expect(await streamResult([input.slice(0, at), input.slice(at)], { format })).toHaveLength(2);
      }
    });

    it('handles chunk boundaries around braces, escapes and long literals', async () => {
      const input = `${V}<http://example.org/g>{<a:s> <a:p> "a\\"MESSAGE\\"b"}\nMESSAGE\n<a:s> <a:p> """x"MESSAGE\n""" .\nMESSAGE`;
      const expected = render(parseMessages(input, { format: 'TriG' }));
      expect(expected).toHaveLength(2);
      for (let i = 0; i <= input.length; i++)
        expect(render(await streamResult([input.slice(0, i), input.slice(i)], { format: 'TriG' }))).toEqual(expected);
    });
  });

  describe('backpressure and stream semantics', () => {
    function messageLog(count) {
      return `${V}${Array.from({ length: count }, (_, i) => `<a:s${i}> <a:p> <a:o> .\nMESSAGE\n`).join('')}`;
    }

    it('works in a pipeline with a slow consumer', async () => {
      const received = [];
      const slow = new Writable({
        objectMode: true,
        highWaterMark: 1,
        write(message, encoding, done) {
          received.push(message);
          setImmediate(done);
        },
      });
      await new Promise((resolve, reject) => pipeline(
        Readable.from(splitEvery(messageLog(200), 50)), new MessageStreamParser({ format: 'N-Quads' }), slow,
        error => error ? reject(error) : resolve()));
      expect(received).toHaveLength(200);
    });

    it('does not request more input than needed while its output is not consumed', () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      let accepted = 0;
      // Without a consumer, the writable side signals backpressure after a bounded number of chunks
      for (let i = 0; i < 100000; i++) {
        accepted++;
        if (!parser.write(`${i === 0 ? V : ''}<a:s> <a:p> <a:o> .\nMESSAGE\n`))
          break;
      }
      expect(accepted).toBeLessThan(100000);
      expect(accepted).toBeGreaterThan(1);
    });

    it('resumes after the consumer reads', async () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      let ok = true;
      let written = 0;
      while (ok && written < 100000)
        ok = parser.write(`${written++ === 0 ? V : ''}<a:s> <a:p> <a:o> .\nMESSAGE\n`);
      expect(ok).toBe(false);
      const drained = new Promise(resolve => parser.once('drain', resolve));
      parser.resume();
      await drained;
      parser.end();
    });

    it('reports a parse error as stream error and destroys the stream', async () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      parser.on('data', () => {});
      const error = new Promise(resolve => parser.on('error', resolve));
      parser.write(`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<broken\n`);
      expect((await error).message).toMatch(/line 4/);
      expect(parser.destroyed).toBe(true);
    });

    it('reports a parse error at the end of the input', async () => {
      const parser = new MessageStreamParser({ format: 'TriG' });
      parser.on('data', () => {});
      const error = new Promise(resolve => parser.on('error', resolve));
      parser.end(`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p>`);
      expect((await error).message).toMatch(/Expected entity but got eof/);
    });

    it('emits the messages that precede an error before the error', async () => {
      const received = [];
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      parser.on('data', message => received.push(message));
      const error = new Promise(resolve => parser.on('error', resolve));
      parser.write(`${V}<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p> <a:o2> .\nMESSAGE\n<broken`);
      parser.end();
      await error;
      expect(received).toHaveLength(2);
    });

    it('rejects a delimiter in an unannounced log with a stream error', async () => {
      const parser = new MessageStreamParser({ format: 'Turtle' });
      parser.on('data', () => {});
      const error = new Promise(resolve => parser.on('error', resolve));
      parser.end('<a:s> <a:p> <a:o> .\nMESSAGE\n');
      expect((await error).message).toMatch(/did not announce/);
    });
  });

  describe('memory', () => {
    // Forces a full garbage collection without requiring the --expose-gc flag
    function collect() {
      v8.setFlagsFromString('--expose-gc');
      vm.runInNewContext('gc')();
    }

    it('does not retain messages that were already emitted', async () => {
      const parser = new MessageStreamParser({ format: 'Turtle' });
      let reference = null;
      let count = 0;
      parser.on('data', message => {
        // Keep only a weak reference to the very first message
        if (count++ === 0)
          reference = new WeakRef(message);
      });
      parser.write(`${V}@prefix ex: <http://example.org/> .\n`);
      const batch = Array.from({ length: 500 }, (_, i) => `_:b ex:p ex:o${i}, "a literal that makes the message bigger" .\nMESSAGE\n`).join('');
      for (let i = 0; i < 100; i++) {
        parser.write(batch);
        // Let the event loop run, so that nothing is kept alive by the current job
        await new Promise(resolve => setImmediate(resolve));
      }
      collect();
      await new Promise(resolve => setImmediate(resolve));
      collect();
      expect(count).toBe(50000);
      expect(reference.deref()).toBeUndefined();
      parser.end();
    });

    it('keeps the heap flat while streaming many messages', async () => {
      const parser = new MessageStreamParser({ format: 'N-Quads' });
      parser.on('data', () => {});
      const line = '<http://example.org/subject> <http://example.org/predicate> "some object value" .\nMESSAGE\n';
      const batch = line.repeat(2000);
      parser.write(V);
      async function feed(rounds) {
        for (let i = 0; i < rounds; i++) {
          parser.write(batch);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      await feed(10);
      collect();
      const before = process.memoryUsage().heapUsed;
      await feed(100);
      collect();
      const growth = process.memoryUsage().heapUsed - before;
      // 100 batches of 2000 messages (200k messages, ~17 MB of input) must not accumulate
      expect(growth).toBeLessThan(5 * 1024 * 1024);
      parser.end();
    });
  });
});

// Parses chunks through the stream parser without waiting for stream events
function parseChunksSync(chunks, format) {
  const parser = new MessageStreamParser({ format });
  const messages = [];
  parser.on('data', message => messages.push(message));
  chunks.forEach(chunk => parser.write(chunk));
  parser.end();
  return messages;
}
