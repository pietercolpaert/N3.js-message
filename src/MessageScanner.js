// **MessageScanner** finds RDF Message delimiters in a text stream.
//
// N3.js has no extension point for new directives, and its lexer rejects
// `MESSAGE` and `@message`. The scanners in this file therefore sit in front of
// the N3.js lexer: they track just enough lexical context (IRIs, strings,
// long strings, comments, words, braces) to recognize *real* delimiters, and
// rewrite them into text that N3.js can lex and that is easy to recognize
// again in N3.js' public parser callbacks:
//
// - Turtle and TriG: a delimiter becomes `@version "<sentinel>" .`.
//   N3.js only accepts version directives at statement boundaries, so the
//   N3.js parser itself rejects delimiters in other grammar positions, and
//   reports the delimiter through its public `onVersion` callback, exactly in
//   order with the emitted quads. The dot matters: the N3.js lexer reads an
//   `@` after a literal as a language tag, so a literal that ends a SPARQL-style
//   `VERSION "label"` directive would swallow a following `@prefix`.
//   For the same reason, SPARQL-style `VERSION "label"` directives in the input
//   are rewritten to `@version "label" .`.
// - N-Triples and N-Quads: N3.js has no version directive in line mode.
//   The grammar is line-based, so a delimiter or version line becomes the
//   comment `#<sentinel>M<line>` / `#<sentinel>V<label>`, which is reported through
//   the public `onComment` callback, again in order with the quads.
//
// Delimiters that are not recognized (inside strings, IRIs, comments, prefixed
// names or graph blocks) are passed through unchanged. The scanners never
// throw: whatever they do not rewrite is rejected by N3.js as a syntax error.

const TOP = 0, IRI = 1, LT = 2, COMMENT = 3, STRING = 4, QUOTE1 = 5, QUOTE2 = 6, LONG = 7, CANDIDATE = 8;

const MESSAGE = 'MESSAGE', AT_MESSAGE = '@message', VERSION = 'VERSION';

function isWhitespace(code) {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

// Compares a character to a position of a keyword; `VERSION` is case-insensitive
function matches(keyword, index, code) {
  return keyword === VERSION ? String.fromCharCode(code).toUpperCase() === keyword[index] :
    code === keyword.charCodeAt(index);
}

// Characters that may follow `MESSAGE`: whitespace, a comment, or an IRI
function endsMessageKeyword(code) {
  return isWhitespace(code) || code === 35 || code === 60;
}

// Characters that may follow `@message`: whitespace, a comment, or the dot
function endsAtMessageKeyword(code) {
  return isWhitespace(code) || code === 35 || code === 46;
}

// ## Turtle and TriG
export class TurtleScanner {
  constructor(sentinel) {
    this._sentinel = sentinel;
    this._state = TOP;
    // Whether the next character can start a new token
    this._tokenStart = true;
    // Whether we are inside a bare word (prefixed name, number, keyword)
    this._inWord = false;
    this._wordEscape = false;
    this._quote = 0;
    this._escaped = false;
    this._quoteRun = 0;
    this._depth = 0;
    this._candidate = '';
    this._target = '';
    this._candidateLine = 1;
    this._beforeCandidate = 32;
    this._versionPending = false;
    this._line = 1;
    this._afterCR = false;
    this._started = false;
    this._lastOut = 32;
    // The line of every rewritten delimiter that was not yet consumed
    this.delimiterLines = [];
  }

  // ### `push` scans a chunk of text and returns the text to hand to N3.js
  push(text) {
    let out = '';
    let segmentStart = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // Keep track of the line number (CRLF counts once, also across chunks)
      if (code === 10) {
        if (!this._afterCR)
          this._line++;
        this._afterCR = false;
      }
      else if (code === 13) {
        this._line++;
        this._afterCR = true;
      }
      else
        this._afterCR = false;

      // A state change may require the same character to be handled again
      let again;
      do {
        again = false;
        switch (this._state) {
        case TOP:
          if (this._scanTop(code)) {
            // A possible delimiter starts here: hold it back until it is resolved
            out += text.substring(segmentStart, i);
            segmentStart = i + 1;
            this._candidate = text[i];
            this._candidateLine = this._line;
            this._beforeCandidate = i > 0 ? text.charCodeAt(i - 1) : this._lastOut;
            this._target = code === 77 ? MESSAGE : code === 64 ? AT_MESSAGE : VERSION;
            this._state = CANDIDATE;
          }
          break;
        case CANDIDATE: {
          const index = this._candidate.length, target = this._target;
          if (index < target.length && matches(target, index, code)) {
            this._candidate += text[i];
            segmentStart = i + 1;
          }
          else {
            const complete = index === target.length &&
              (target === AT_MESSAGE ? endsAtMessageKeyword(code) : endsMessageKeyword(code));
            out += this._resolveCandidate(complete);
            segmentStart = i;
            again = true;
          }
          break;
        }
        case IRI:
          if (code === 62)
            this._endToken(true);
          break;
        case LT:
          // `<<` starts a reified triple, everything else an IRI
          if (code === 60)
            this._endToken(true);
          else {
            this._state = IRI;
            again = true;
          }
          break;
        case COMMENT:
          if (code === 10 || code === 13)
            this._endToken(true);
          break;
        case STRING:
          if (this._escaped)
            this._escaped = false;
          else if (code === 92)
            this._escaped = true;
          else if (code === this._quote) {
            this._endToken(false);
            if (this._versionPending) {
              // Terminate a SPARQL-style version directive, which we turned into an `@version` directive
              this._versionPending = false;
              out += `${text.substring(segmentStart, i + 1)} .`;
              segmentStart = i + 1;
            }
          }
          break;
        case QUOTE1:
          // A second quote either starts a long string or ends an empty string
          if (code === this._quote)
            this._state = QUOTE2;
          else {
            this._state = STRING;
            again = true;
          }
          break;
        case QUOTE2:
          if (code === this._quote) {
            this._state = LONG;
            this._escaped = false;
            this._quoteRun = 0;
          }
          else {
            this._endToken(false);
            again = true;
          }
          break;
        default: // LONG
          if (this._escaped) {
            this._escaped = false;
            this._quoteRun = 0;
          }
          else if (code === 92) {
            this._escaped = true;
            this._quoteRun = 0;
          }
          else if (code === this._quote) {
            if (++this._quoteRun === 3)
              this._endToken(false);
          }
          else
            this._quoteRun = 0;
        }
      } while (again);
    }
    out += text.substring(segmentStart);
    return this._remember(out);
  }

  // ### `end` resolves any held-back text at the end of the input
  end() {
    let out = '';
    if (this._state === CANDIDATE)
      out = this._resolveCandidate(this._candidate.length === this._target.length);
    return this._remember(out);
  }

  // ### `_scanTop` handles a character between tokens or inside a word.
  // It returns true if the character may start a message delimiter.
  _scanTop(code) {
    // An escape inside a word makes the next character part of the word
    if (this._wordEscape) {
      this._wordEscape = false;
      return false;
    }
    switch (code) {
    case 32: case 9: case 10: case 13:
      this._structural();
      break;
    case 0xFEFF:
      // A byte order mark at the very start is not part of any token
      if (this._started)
        this._word();
      break;
    case 35: // #
      this._state = COMMENT;
      this._inWord = false;
      break;
    case 60: // <
      this._state = LT;
      this._inWord = false;
      break;
    case 34: case 39: // " '
      this._state = QUOTE1;
      this._quote = code;
      this._inWord = false;
      break;
    case 123: // {
      this._depth++;
      this._structural();
      break;
    case 125: // }
      this._depth = Math.max(0, this._depth - 1);
      this._structural();
      break;
    case 40: case 41: case 91: case 93: case 44: case 59: // ( ) [ ] , ;
      this._structural();
      break;
    case 46: // . ends a statement, unless it is part of a word
      if (!this._inWord)
        this._structural();
      break;
    case 92: // \
      this._word();
      this._wordEscape = true;
      break;
    case 77: case 64: case 86: case 118: // M @ V v
      if (this._tokenStart) {
        this._started = true;
        return true;
      }
      this._word();
      break;
    default:
      this._word();
    }
    this._started = true;
    return false;
  }

  _structural() {
    this._inWord = false;
    this._tokenStart = true;
  }

  _word() {
    this._inWord = true;
    this._tokenStart = false;
  }

  // ### `_endToken` returns to the top level after an IRI, string or comment
  _endToken(tokenStart) {
    this._state = TOP;
    this._inWord = false;
    this._tokenStart = tokenStart;
  }

  // ### `_resolveCandidate` decides whether a held-back candidate is a delimiter
  // and returns the text to emit for it
  _resolveCandidate(complete) {
    const candidate = this._candidate;
    this._state = TOP;
    this._candidate = '';
    // A delimiter in a graph block is not rewritten, so that N3.js rejects it
    if (!complete || (this._depth > 0 && this._target !== VERSION)) {
      this._word();
      return candidate;
    }
    this._structural();
    const previous = this._beforeCandidate;
    const space = isWhitespace(previous) || previous === 0xFEFF ? '' : ' ';
    if (this._target === VERSION) {
      this._versionPending = true;
      return `${space}@version`;
    }
    this.delimiterLines.push(this._candidateLine);
    return `${space}@version "${this._sentinel}"${candidate === MESSAGE ? ' .' : ''}`;
  }

  _remember(out) {
    if (out.length > 0)
      this._lastOut = out.charCodeAt(out.length - 1);
    return out;
  }
}

// ## N-Triples and N-Quads
// Lines of the form `MESSAGE` or `VERSION "label"` are the only directives.
// They cannot be confused with strings or IRIs, as those never span lines.
export class LineScanner {
  constructor(sentinel) {
    this._sentinel = sentinel;
    this._buffer = '';
    this._line = 1;
    this._messageLine = new RegExp(`^[ \\t]*${MESSAGE}[ \\t]*(?:#.*)?$`);
    this._versionLine = /^[ \t]*VERSION[ \t]*(?:"([^"\\]*)"|'([^'\\]*)')[ \t]*(?:#.*)?$/i;
  }

  // ### `push` scans a chunk of text and returns the complete lines, rewritten
  push(text) {
    const data = this._buffer + text;
    // A final carriage return waits for a possible line feed, so that CRLF counts as one line break
    const limit = data.endsWith('\r') ? data.length - 1 : data.length;
    const lastBreak = Math.max(data.lastIndexOf('\n', limit - 1), data.lastIndexOf('\r', limit - 1));
    if (lastBreak < 0) {
      this._buffer = data;
      return '';
    }
    this._buffer = data.substring(lastBreak + 1);
    return this._rewrite(data.substring(0, lastBreak + 1));
  }

  // ### `end` returns the last line, which has no line break
  end() {
    const rest = this._buffer;
    this._buffer = '';
    return rest.length > 0 ? this._rewrite(rest) : '';
  }

  _rewrite(block) {
    let out = '';
    let copyFrom = 0, lineStart = 0;
    const breaks = /\r\n|\n|\r/g;
    let match;
    do {
      match = breaks.exec(block);
      const lineEnd = match ? match.index : block.length;
      const replacement = this._rewriteLine(block, lineStart, lineEnd);
      if (replacement !== null) {
        out += block.substring(copyFrom, lineStart) + replacement;
        copyFrom = lineEnd;
      }
      lineStart = match ? breaks.lastIndex : block.length + 1;
      if (match)
        this._line++;
    } while (lineStart <= block.length);
    return out + block.substring(copyFrom);
  }

  // Only lines that start with `MESSAGE` or `VERSION` need a closer look
  _rewriteLine(block, start, end) {
    let first = start;
    while (first < end && (block[first] === ' ' || block[first] === '\t'))
      first++;
    const code = block.charCodeAt(first);
    if (first === end || (code !== 77 && code !== 86 && code !== 118))
      return null;
    const line = block.substring(first, end);
    if (this._messageLine.test(line))
      return `#${this._sentinel}M${this._line}`;
    const version = this._versionLine.exec(line);
    if (version)
      return `#${this._sentinel}V${version[1] === undefined ? version[2] : version[1]}`;
    return null;
  }
}
