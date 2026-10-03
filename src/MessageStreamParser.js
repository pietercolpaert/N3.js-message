// **MessageStreamParser** is a Node.js stream that turns text into RDF Messages.
//
// It consumes strings or buffers, and produces one array of quads per message,
// as soon as that message is complete.
import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import MessageParserCore from './MessageParserCore.js';

export default class MessageStreamParser extends Transform {
  constructor(options) {
    super({ decodeStrings: false, readableObjectMode: true });
    this._decoder = new StringDecoder('utf8');
    this._error = null;
    this._core = new MessageParserCore(options, {
      message: quads => this.push(quads),
      end: () => {},
      error: error => { this._error = this._error || error; },
      prefix: (prefix, term) => this.emit('prefix', prefix, term),
      version: label => this.emit('version', label),
    });
  }

  _transform(chunk, encoding, done) {
    this._core.write(typeof chunk === 'string' ? chunk : this._decoder.write(chunk));
    done(this._error);
  }

  _flush(done) {
    this._core.write(this._decoder.end());
    this._core.end();
    done(this._error);
  }
}
