// **MessageParser** parses RDF Message Logs (Turtle, TriG, N-Triples and N-Quads).
import { StringDecoder } from 'string_decoder';
import MessageParserCore from './MessageParserCore.js';

export default class MessageParser {
  constructor(options) {
    this._options = options || {};
    // Fail early on unsupported options
    this._createCore({});
  }

  _createCore(sink) {
    return new MessageParserCore(this._options, sink);
  }

  // ### `parse` parses a string or a readable stream of RDF Messages.
  //
  // Without callbacks, a string is parsed synchronously into an array of
  // messages (arrays of quads), and parse errors are thrown.
  // With a callback `(error, message, prefixes)`, or an object with the
  // callbacks `onMessage(error, message, prefixes)`, `onQuad(error, quad, messageIndex)`,
  // `onPrefix(prefix, term)` and `onVersion(label)`, messages are reported as soon
  // as they are complete. The final call has `null` as message.
  parse(input, callbacks) {
    if (typeof callbacks === 'function')
      callbacks = { onMessage: callbacks };
    const messages = callbacks ? null : [];
    let error = null;
    callbacks = callbacks || {};
    const sink = {
      message: (quads, index) => callbacks.onMessage ? callbacks.onMessage(null, quads, undefined, index) : messages && messages.push(quads),
      end: prefixes => callbacks.onMessage && callbacks.onMessage(null, null, prefixes),
      error: e => {
        error = e;
        callbacks.onMessage && callbacks.onMessage(e);
        callbacks.onQuad && callbacks.onQuad(e);
      },
    };
    if (callbacks.onQuad)
      sink.quad = (quad, index) => callbacks.onQuad(null, quad, index);
    if (callbacks.onPrefix)
      sink.prefix = callbacks.onPrefix;
    if (callbacks.onVersion)
      sink.version = callbacks.onVersion;
    const core = this._createCore(sink);

    // Parse a string at once
    if (typeof input === 'string') {
      core.write(input);
      core.end();
      if (error && messages)
        throw error;
      return messages || undefined;
    }

    // Parse a stream chunk by chunk
    const decoder = new StringDecoder('utf8');
    input.on('data', chunk => core.write(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
    input.on('end', () => {
      core.write(decoder.end());
      core.end();
    });
    input.on('error', e => sink.error(e));
    return undefined;
  }
}

// ### `parseMessages` synchronously parses a string into an array of messages
export function parseMessages(input, options) {
  return new MessageParser(options).parse(input);
}
