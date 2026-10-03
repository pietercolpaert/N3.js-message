// **MessageParserCore** is the push-based engine behind all message parsers.
// It feeds scanned text to the public N3.js parser and groups the resulting
// quads into messages.
import { EventEmitter } from 'events';
import { Parser, DataFactory } from 'n3';
import { TurtleScanner, LineScanner } from './MessageScanner.js';
import { resolveFormat, isMessagesVersion, baseVersion, isSupportedVersion } from './formats.js';

// Unrecognizable by construction: a document cannot contain it by accident
function createSentinel() {
  return `rdf-messages-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export default class MessageParserCore {
  // `sink` receives `message(quads, index)`, `end(prefixes)`, `error(error)`
  // and optionally `quad(quad, messageIndex)`, `prefix(prefix, term)`, `version(label)`
  constructor(options, sink) {
    options = options || {};
    const format = resolveFormat(options.format);
    this._sink = sink;
    this._factory = options.factory || DataFactory;
    this._blankNodePrefix = typeof options.blankNodePrefix === 'string' ?
      options.blankNodePrefix.replace(/^_:/, '') : undefined;
    this._blankNodeCounter = 0;
    this._supportedVersions = Parser.SUPPORTED_VERSIONS;
    this._messages = options.messages === true || isMessagesVersion(options.version);
    this._index = 0;
    this._current = null;
    this._scope = null;
    this._seenQuad = false;
    this._failed = false;
    this._finished = false;

    const n3Options = {
      format: format.name,
      factory: this._factory,
      // Version labels are validated here, because N3.js does not know `-messages` labels
      parseUnsupportedVersions: true,
    };
    if (options.baseIRI)
      n3Options.baseIRI = options.baseIRI;
    if (options.version) {
      this._checkVersion(options.version, true);
      n3Options.version = baseVersion(options.version);
    }

    const sentinel = createSentinel();
    this._sentinel = sentinel;
    this._scanner = format.lineMode ? new LineScanner(sentinel) : new TurtleScanner(sentinel);
    this._input = new EventEmitter();
    const callbacks = {
      onQuad: (error, quad, prefixes) => this._onQuad(error, quad, prefixes),
      onPrefix: (prefix, term) => this._failed || sink.prefix && sink.prefix(prefix, term),
      onVersion: label => this._onVersion(label),
    };
    if (format.lineMode)
      callbacks.onComment = comment => this._onComment(comment);
    new Parser(n3Options).parse(this._input, callbacks);
  }

  // ### `write` accepts the next chunk of text
  write(text) {
    if (!this._failed && !this._finished && text.length > 0)
      this._feed(this._scanner.push(text));
  }

  // ### `end` signals the end of the input
  end() {
    if (!this._failed && !this._finished) {
      this._feed(this._scanner.end());
      this._input.emit('end');
    }
  }

  _feed(text) {
    if (text.length > 0)
      this._input.emit('data', text);
  }

  _onQuad(error, quad, prefixes) {
    if (this._failed || this._finished)
      return;
    if (error)
      this._fail(error);
    else if (quad)
      this._addQuad(quad);
    else {
      this._finished = true;
      if (this._current !== null)
        this._emitMessage();
      this._sink.end(prefixes);
    }
  }

  _addQuad(quad) {
    this._seenQuad = true;
    // Blank node labels are scoped to their message
    if (this._messages)
      quad = this._scopeQuad(quad);
    if (this._current === null)
      this._current = [];
    this._current.push(quad);
    if (this._sink.quad)
      this._sink.quad(quad, this._index);
  }

  _onVersion(label) {
    if (this._failed)
      return;
    if (label === this._sentinel)
      this._delimiter(this._scanner.delimiterLines.shift());
    else
      this._announce(label);
  }

  // Line mode reports delimiters and versions as comments
  _onComment(comment) {
    if (this._failed || !comment.startsWith(this._sentinel))
      return;
    const rest = comment.substring(this._sentinel.length);
    if (rest[0] === 'M')
      this._delimiter(Number(rest.substring(1)));
    else
      this._announce(rest.substring(1));
  }

  _announce(label) {
    const error = this._checkVersion(label);
    if (error)
      return this._fail(error);
    if (isMessagesVersion(label) && !this._messages) {
      if (this._seenQuad)
        return this._fail(new Error(`Version "${label}" must be announced before the first statement.`));
      this._messages = true;
    }
    if (this._sink.version)
      this._sink.version(label);
  }

  // Validates a version label, and returns an error for unsupported ones
  _checkVersion(label, throwing) {
    if (isSupportedVersion(baseVersion(label), this._supportedVersions))
      return null;
    const error = new Error(`Detected unsupported version: "${label}"`);
    if (throwing)
      throw error;
    return error;
  }

  _delimiter(line) {
    if (!this._messages) {
      return this._fail(new Error(`Unexpected "MESSAGE" on line ${line}: the document did not announce ` +
                                  'a version with the "-messages" suffix.'));
    }
    this._emitMessage();
  }

  // Finalizes the current message, which is empty if no quad was seen
  _emitMessage() {
    const quads = this._current || [];
    this._current = null;
    this._scope = null;
    this._sink.message(quads, this._index++);
  }

  _fail(error) {
    this._failed = true;
    this._current = null;
    this._sink.error(error);
  }

  // ## Blank node scoping

  _scopeQuad(quad) {
    const subject = this._scopeTerm(quad.subject);
    const predicate = this._scopeTerm(quad.predicate);
    const object = this._scopeTerm(quad.object);
    const graph = this._scopeTerm(quad.graph);
    return subject === quad.subject && predicate === quad.predicate &&
           object === quad.object && graph === quad.graph ?
      quad : this._factory.quad(subject, predicate, object, graph);
  }

  _scopeTerm(term) {
    if (term.termType === 'BlankNode') {
      const scope = this._scope || (this._scope = new Map());
      let scoped = scope.get(term.value);
      if (!scoped) {
        scoped = this._blankNodePrefix === undefined ? this._factory.blankNode() :
          this._factory.blankNode(`${this._blankNodePrefix}${this._blankNodeCounter++}`);
        scope.set(term.value, scoped);
      }
      return scoped;
    }
    return term.termType === 'Quad' ? this._scopeQuad(term) : term;
  }
}
