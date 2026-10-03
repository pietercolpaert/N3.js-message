// Type definitions for n3.js-messages
import * as RDF from '@rdfjs/types';
import { Transform } from 'stream';

export type MessageFormat =
  | 'Turtle' | 'TriG' | 'N-Triples' | 'N-Quads'
  | (string & {});

/** One RDF message: the quads between two message delimiters. */
export type Message<Q extends RDF.BaseQuad = RDF.Quad> = Q[];

/**
 * The part of an RDF/JS DataFactory that is used for parsing; any `RDF.DataFactory<Q>` fits.
 * The quads that the factory creates determine the quads that are parsed.
 */
export interface MessageQuadFactory<Q extends RDF.BaseQuad = RDF.Quad>
  extends Pick<RDF.DataFactory<RDF.Quad, any>, 'namedNode' | 'blankNode' | 'literal' | 'variable' | 'defaultGraph'> {
  quad(subject: Q['subject'], predicate: Q['predicate'], object: Q['object'], graph?: Q['graph']): Q;
}

export interface MessageParserOptions<Q extends RDF.BaseQuad = RDF.Quad> {
  /** Syntax name or media type, case-insensitive. Defaults to `TriG`. */
  format?: MessageFormat;
  baseIRI?: string;
  /** Data factory used to create terms and quads. */
  factory?: MessageQuadFactory<Q>;
  /** Prefix for generated blank node labels, e.g. `b0_`. */
  blankNodePrefix?: string;
  /** RDF version label, e.g. `1.2-messages`; a `-messages` suffix forces message mode. */
  version?: string;
  /** Force message mode even without a `-messages` version declaration. */
  messages?: boolean;
}

export type MessageCallback<Q extends RDF.BaseQuad = RDF.Quad> = (
  error: Error | null,
  message: Q[] | null,
  prefixes?: { [prefix: string]: RDF.NamedNode },
  index?: number,
) => void;

export interface MessageParseCallbacks<Q extends RDF.BaseQuad = RDF.Quad> {
  onMessage?: MessageCallback<Q>;
  onQuad?: (error: Error | null, quad?: Q, messageIndex?: number) => void;
  onPrefix?: (prefix: string, term: RDF.NamedNode) => void;
  onVersion?: (version: string) => void;
}

export class MessageParser<Q extends RDF.BaseQuad = RDF.Quad> {
  constructor(options?: MessageParserOptions<Q>);
  /** Synchronously parses a string; throws on syntax errors. */
  parse(input: string): Q[][];
  /** Parses a string or stream, reporting messages through a callback. */
  parse(input: string | NodeJS.ReadableStream, callback: MessageCallback<Q>): void;
  /** Parses a string or stream, reporting through object callbacks. */
  parse(input: string | NodeJS.ReadableStream, callbacks: MessageParseCallbacks<Q>): void;
  /** Parses a stream without callbacks (reports nothing). */
  parse(input: NodeJS.ReadableStream): void;
}

export function parseMessages<Q extends RDF.BaseQuad = RDF.Quad>(
  input: string,
  options?: MessageParserOptions<Q>,
): Q[][];

export class MessageStreamParser<Q extends RDF.BaseQuad = RDF.Quad> extends Transform
  implements AsyncIterable<Q[]> {
  constructor(options?: MessageParserOptions<Q>);
  on(event: 'prefix', listener: (prefix: string, term: RDF.NamedNode) => void): this;
  on(event: 'version', listener: (version: string) => void): this;
  on(event: 'data', listener: (message: Q[]) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: 'prefix', listener: (prefix: string, term: RDF.NamedNode) => void): this;
  once(event: 'version', listener: (version: string) => void): this;
  once(event: 'data', listener: (message: Q[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  [Symbol.asyncIterator](): NodeJS.AsyncIterator<Q[]>;
}

export interface MessageWriterOptions {
  /** Syntax name or media type, case-insensitive. Defaults to `TriG`. */
  format?: MessageFormat;
  /** Prefixes that are declared up front. */
  prefixes?: { [prefix: string]: RDF.NamedNode | string };
  baseIRI?: string;
  writeBase?: boolean;
  lists?: { [listHead: string]: RDF.Term[] };
  /** RDF version label announced in the output. Defaults to `1.2-messages`. */
  version?: string;
  /** Whether to end the output stream on `end()`. Defaults to `true`. */
  end?: boolean;
}

export interface MessageOutputStream {
  write(chunk: string, encoding?: string, callback?: (error?: Error | null) => void): unknown;
  end(callback?: (error?: Error | null) => void): unknown;
}

export class MessageWriter {
  constructor(options?: MessageWriterOptions);
  constructor(outputStream?: MessageOutputStream | NodeJS.WritableStream | null, options?: MessageWriterOptions);
  addMessage(quads: RDF.BaseQuad[], done: (error: Error | null) => void): void;
  addMessage(quads: RDF.BaseQuad[]): Promise<void>;
  addPrefix(prefix: string, iri: RDF.NamedNode | string, done: (error: Error | null) => void): void;
  addPrefix(prefix: string, iri: RDF.NamedNode | string): Promise<void>;
  /** Without an output stream, the result is the written string. */
  end(done: (error: Error | null, result?: string) => void): void;
  end(): Promise<string>;
}

export function writeMessages(messages: Iterable<RDF.BaseQuad[]>, options?: MessageWriterOptions): string;

export class MessageStreamWriter extends Transform {
  constructor(options?: Omit<MessageWriterOptions, 'end'>);
}
