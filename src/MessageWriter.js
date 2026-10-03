// **MessageWriter** writes RDF Message Logs (Turtle, TriG, N-Triples and N-Quads).
//
// Every message is written by a fresh N3.js writer, so no serialization state
// (current graph, subject, predicate) leaks from one message into the next.
// Every message is followed by a delimiter (`MESSAGE` in line formats, `@message .` in Turtle and TriG), so that consumers receive
// a message as soon as it is written, and so that trailing empty messages survive
// a round trip (a delimiter before the end of the input does not create a message).
import { Writer } from 'n3';
import { resolveFormat, isMessagesVersion, baseVersion, isSupportedVersion } from './formats.js';

export default class MessageWriter {
  // `outputStream` is optional: without it, `end` returns the output as a string
  constructor(outputStream, options) {
    if (outputStream && typeof outputStream.write !== 'function')
      options = outputStream, outputStream = null;
    options = options || {};
    this._format = resolveFormat(options.format);
    this._options = options;
    this._version = options.version === undefined ? '1.2-messages' : options.version;
    if (!isMessagesVersion(this._version) || !isSupportedVersion(baseVersion(this._version)))
      throw new TypeError(`Unsupported RDF Messages version: "${this._version}"`);

    this._output = '';
    this._stream = outputStream;
    this._endStream = !outputStream || options.end !== false;
    this._pending = 0;
    this._waiting = [];
    this._error = null;
    this._muted = false;
    this._started = false;
    this._ended = false;
    this._declared = Object.assign({}, options.prefixes);
    this._newPrefixes = {};
    // The N3.js writers write to this sink, which they never end
    this._sink = { write: (chunk, encoding, done) => this._write(chunk, done) };
  }

  // ### `addMessage` writes the quads of one message, followed by a delimiter.
  // The callback (or returned promise) completes once the output is flushed.
  addMessage(quads, done) {
    return this._complete(done, () => {
      this._start();
      this._writeMessage(quads || []);
    });
  }

  // ### `addPrefix` declares a prefix, which is written before the next message
  // and stays in effect for all messages after it
  addPrefix(prefix, iri, done) {
    return this._complete(done, () => {
      if (!this._format.lineMode && this._declared[prefix] !== (iri.value || iri))
        this._newPrefixes[prefix] = iri.value || iri;
    });
  }

  // ### `end` ends the log and, unless disabled, the output stream.
  // The callback receives the output as a string if no output stream was given.
  end(done) {
    // Ending twice is harmless
    if (this._ended)
      return typeof done === 'function' ? done(null) : Promise.resolve();
    this._start();
    if (typeof done === 'function')
      return this._finish(done);
    return new Promise((resolve, reject) => this._finish((error, result) => error ? reject(error) : resolve(result)));
  }

  // ## Private methods

  // Runs an action and reports completion with a callback or a promise
  _complete(done, action) {
    if (this._ended)
      this._error = this._error || new Error('Cannot write after end');
    else
      try {
        action();
      }
      catch (error) {
        this._error = this._error || error;
      }
    if (typeof done === 'function')
      return this._whenFlushed(done);
    return new Promise((resolve, reject) => this._whenFlushed(error => error ? reject(error) : resolve()));
  }

  // Ends the output once all queued writes were accepted
  _finish(callback) {
    this._ended = true;
    this._whenFlushed(error => this._endOutput(error, callback));
  }

  _endOutput(error, callback) {
    if (error || !this._endStream)
      return callback(error);
    if (!this._stream)
      return callback(null, this._output);
    try {
      this._stream.end(endError => callback(endError));
    }
    catch (endError) {
      callback(endError);
    }
  }

  // Calls back once all queued writes were accepted by the output
  _whenFlushed(done) {
    if (this._pending === 0)
      this._settle(done);
    else
      this._waiting.push(done);
  }

  _settle(done) {
    const error = this._error;
    this._error = null;
    done(error || null);
  }

  _write(chunk, done) {
    if (this._muted || !this._stream) {
      if (!this._muted)
        this._output += chunk;
      return done && done();
    }
    this._pending++;
    try {
      this._stream.write(chunk, 'utf8', error => this._written(error, done));
    }
    catch (error) {
      this._written(error, done);
    }
  }

  // Registers that the output accepted a write, and wakes up those waiting for the output
  _written(error, done) {
    this._pending--;
    this._error = this._error || error || null;
    done && done(error);
    if (this._pending === 0)
      this._waiting.splice(0).forEach(callback => this._settle(callback));
  }

  // Announces the RDF Messages version, which makes parsers expect delimiters
  _start() {
    if (!this._started) {
      this._started = true;
      this._write(this._format.lineMode ? `VERSION "${this._version}"\n` : `@version "${this._version}" .\n`);
    }
  }

  _writeMessage(quads) {
    const first = !this._messageWritten;
    const options = { format: this._format.name, end: false };
    if (this._options.baseIRI) {
      options.baseIRI = this._options.baseIRI;
      // The base is declared by us, once, as it stays in effect (and older N3.js writers lack `writeBase`)
      if (first && this._options.writeBase && !this._format.lineMode)
        this._write(`@base <${this._options.baseIRI}>.\n`);
    }
    // Prefixes and base are declared once, as they stay in effect
    options.prefixes = this._declared;
    this._muted = !first;
    const writer = new Writer(this._sink, options);
    this._muted = false;
    this._messageWritten = true;
    for (const prefix of Object.keys(this._newPrefixes)) {
      writer.addPrefix(prefix, this._newPrefixes[prefix]);
      this._declared[prefix] = this._newPrefixes[prefix];
    }
    this._newPrefixes = {};
    const record = error => error && (this._error = this._error || error);
    for (const quad of quads)
      writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph, record);
    writer.end(record);
    this._write(this._format.lineMode ? 'MESSAGE\n' : '@message .\n');
  }
}

// ### `writeMessages` synchronously serializes an array of messages to a string
export function writeMessages(messages, options) {
  const writer = new MessageWriter(options);
  const errors = [];
  let output;
  function collect(error) {
    if (error)
      errors.push(error);
  }
  for (const message of messages)
    writer.addMessage(message, collect);
  writer.end((error, result) => (collect(error), output = result));
  if (errors.length > 0)
    throw errors[0];
  return output;
}
