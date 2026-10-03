// **MessageStreamWriter** is a Node.js stream that serializes RDF Messages.
//
// It consumes messages (arrays of quads) and produces text.
import { Transform } from 'stream';
import MessageWriter from './MessageWriter.js';

export default class MessageStreamWriter extends Transform {
  constructor(options) {
    super({ writableObjectMode: true, encoding: 'utf8' });
    // Writing into this stream never blocks, and output is pushed synchronously
    const output = { write: (chunk, encoding, done) => (this.push(chunk), done && done()) };
    this._writer = new MessageWriter(output, Object.assign({}, options, { end: false }));
  }

  _transform(message, encoding, done) {
    this._writer.addMessage(message, done);
  }

  _flush(done) {
    this._writer.end(done);
  }
}
