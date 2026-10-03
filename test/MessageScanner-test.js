import { randomChunks, splitEvery, mulberry32 } from './util.js';
import { TurtleScanner, LineScanner } from '../src/MessageScanner.js';

const D = '@version "S" .';

function scan(input, Scanner = TurtleScanner) {
  const scanner = new Scanner('S');
  return scanner.push(input) + scanner.end();
}

function scanChunks(chunks, Scanner = TurtleScanner) {
  const scanner = new Scanner('S');
  return chunks.map(chunk => scanner.push(chunk)).join('') + scanner.end();
}

describe('TurtleScanner', () => {
  describe('rewrites real delimiters', () => {
    it('rewrites MESSAGE between statements', () => {
      expect(scan('<a> <b> <c> .\nMESSAGE\n<d> <e> <f> .')).toBe(`<a> <b> <c> .\n${D}\n<d> <e> <f> .`);
    });

    it('rewrites @message with its dot', () => {
      expect(scan('<a> <b> <c> .\n@message .\n<d> <e> <f> .')).toBe(`<a> <b> <c> .\n${D}\n<d> <e> <f> .`);
    });

    it('rewrites @message directly followed by the dot', () => {
      expect(scan('@message.\n')).toBe('@version "S".\n');
    });

    it('rewrites MESSAGE at the very start and at the very end of the input', () => {
      expect(scan('MESSAGE')).toBe(D);
    });

    it('rewrites MESSAGE followed by a comment or an IRI', () => {
      expect(scan('MESSAGE# c\nMESSAGE<a> <b> <c> .')).toBe(`${D}# c\n${D}<a> <b> <c> .`);
    });

    it('separates the rewritten delimiter from a preceding dot', () => {
      expect(scan('<a> <b> <c>.MESSAGE\n')).toBe(`<a> <b> <c>. ${D}\n`);
    });

    it('rewrites a delimiter after a closing brace', () => {
      expect(scan('<g> { <a> <b> <c> }MESSAGE\n')).toBe(`<g> { <a> <b> <c> } ${D}\n`);
    });

    it('ignores a byte order mark before the first delimiter', () => {
      expect(scan('\uFEFFMESSAGE\n')).toBe(`\uFEFF${D}\n`);
    });

    it('treats a byte order mark inside the text as part of a word', () => {
      expect(scan('<a> <b> c\uFEFFMESSAGE')).toBe('<a> <b> c\uFEFFMESSAGE');
    });

    it('records the line of each delimiter', () => {
      const scanner = new TurtleScanner('S');
      scanner.push('<a> <b> <c> .\r\nMESSAGE\r\n\r\n');
      scanner.push('@message .\n\rMESSAGE');
      scanner.end();
      expect(scanner.delimiterLines).toEqual([2, 4, 6]);
    });

    it('counts CRLF across chunks as one line break', () => {
      const scanner = new TurtleScanner('S');
      scanner.push('\r');
      scanner.push('\nMESSAGE\n');
      expect(scanner.delimiterLines).toEqual([2]);
    });
  });

  describe('does not rewrite lookalikes', () => {
    it.each([
      ['a short string', '<a> <b> "MESSAGE" .'],
      ['a single-quoted string', '<a> <b> \'MESSAGE\' .'],
      ['a string with escaped quotes', '<a> <b> "\\"\nMESSAGE" .'.replace('\n', ' ')],
      ['a long string', '<a> <b> """\nMESSAGE\n""" .'],
      ['a long string with quotes and escapes', '<a> <b> """a ""\\"" "\nMESSAGE\n\\\\""" .'],
      ['a single-quoted long string', '<a> <b> \'\'\'\n@message .\n\'\'\' .'],
      ['an IRI', '<http://example.org/MESSAGE> <b> <c> .'],
      ['a comment', '<a> <b> <c> . # MESSAGE\n'],
      ['a prefixed name', 'ex:MESSAGE ex:p MESSAGE:x .'],
      ['a prefixed name with a dot', 'ex:a.MESSAGE ex:p ex:o .'],
      ['a prefixed name with an escape', 'ex:a\\#MESSAGE ex:p ex:o .'],
      ['a language tag', '<a> <b> "x"@message .'],
      ['a longer word', 'MESSAGES <b> <c> .'],
      ['a lowercase word', 'message <b> <c> .'],
      ['a number-like word', '<a> <b> 1.MESSAGE .'],
      ['a word followed by a colon', 'MESSAGE: <b> <c> .'],
      ['a partial keyword', 'MESS <b> <c> .'],
      ['a different directive', '@prefix ex: <http://example.org/> .'],
      ['a datatype', '<a> <b> "x"^^MESSAGE:x .'],
      ['a reified triple', '<< <a> <b> <c> >> <d> <e> .'],
      ['an empty string', '<a> <b> "" . <c> <d> \'\' .'],
    ])('keeps MESSAGE-like text in %s', (name, input) => {
      expect(scan(input)).toBe(input);
    });

    it('keeps a delimiter inside a graph block, so that N3.js rejects it', () => {
      expect(scan('<g> {\n<a> <b> <c> .\nMESSAGE\n}')).toBe('<g> {\n<a> <b> <c> .\nMESSAGE\n}');
      expect(scan('<g> { @message . }')).toBe('<g> { @message . }');
    });

    it('rewrites a delimiter again after the graph block closed', () => {
      expect(scan('<g> { <a> <b> <c> . } MESSAGE\n}\nMESSAGE')).toBe(`<g> { <a> <b> <c> . } ${D}\n}\n${D}`);
    });

    it('does not let a stray closing brace disable delimiters', () => {
      expect(scan('} MESSAGE')).toBe(`} ${D}`);
    });

    it('rewrites a delimiter after an empty string and after a reified triple', () => {
      expect(scan('<a> <b> "".\nMESSAGE')).toBe(`<a> <b> "".\n${D}`);
      expect(scan('<< <a> <b> <c> >> <d> <e> .\nMESSAGE')).toBe(`<< <a> <b> <c> >> <d> <e> .\n${D}`);
    });
  });

  describe('SPARQL-style version directives', () => {
    it('rewrites them to old-style directives, so that a following @prefix is not read as language tag', () => {
      expect(scan('VERSION "1.2-messages"\n@prefix ex: <http://example.org/> .')).toBe('@version "1.2-messages" .\n@prefix ex: <http://example.org/> .');
    });

    it('is case-insensitive and supports single quotes', () => {
      expect(scan('version \'1.2\' PREFIX')).toBe('@version \'1.2\' . PREFIX');
    });

    it('leaves old-style directives and other words alone', () => {
      expect(scan('@version "1.2" .\nVERSIONS <a> <b> <c> .\nVER <a> <b> <c> .')).toBe('@version "1.2" .\nVERSIONS <a> <b> <c> .\nVER <a> <b> <c> .');
    });

    it('does not rewrite VERSION inside prefixed names', () => {
      expect(scan('ex:VERSION "x"')).toBe('ex:VERSION "x"');
    });

    it('rewrites a version directive inside a graph block, as it is not a delimiter', () => {
      expect(scan('<g> { VERSION "1.2" }')).toBe('<g> { @version "1.2" . }');
    });

    it('terminates only the first string after the directive', () => {
      expect(scan('VERSION "1.2" <a> <b> "c" .')).toBe('@version "1.2" . <a> <b> "c" .');
    });
  });

  describe('chunking', () => {
    const input = '@prefix ex: <http://example.org/> .\nVERSION "1.2-messages"\nex:a ex:b "MESSAGE\\"" .\r\nMESSAGE\r\n' +
      '<g> { ex:a ex:b """\nMESSAGE\n""\\"" }\n@message .\nMESSAGE # c\n<< <a> <b> <c> >> ex:b \'\' .\nex:c.MESSAGE ex:p ex:o .\nMESSAGE';

    it('does not depend on chunk boundaries', () => {
      const expected = scan(input);
      expect(expected).toContain(D);
      for (let i = 0; i <= input.length; i++)
        expect(scanChunks([input.slice(0, i), input.slice(i)])).toBe(expected);
      expect(scanChunks(splitEvery(input, 1))).toBe(expected);
    });

    it('does not depend on random chunk boundaries', () => {
      const expected = scan(input);
      const random = mulberry32(42);
      for (let i = 0; i < 200; i++)
        expect(scanChunks(randomChunks(input, random, 12))).toBe(expected);
    });

    it('holds back only a possible delimiter', () => {
      const scanner = new TurtleScanner('S');
      expect(scanner.push('<a> ')).toBe('<a> ');
      expect(scanner.push('MESS')).toBe('');
      expect(scanner.push('AGE')).toBe('');
      expect(scanner.push('\n')).toBe(`${D}\n`);
      expect(scanner.push('MESSAGX')).toBe('MESSAGX');
    });

    it('releases a held-back partial keyword at the end of the input', () => {
      const scanner = new TurtleScanner('S');
      scanner.push('MESSAG');
      expect(scanner.end()).toBe('MESSAG');
    });

    it('releases a complete keyword at the end of the input as delimiter', () => {
      const scanner = new TurtleScanner('S');
      scanner.push('@message');
      expect(scanner.end()).toBe('@version "S"');
      expect(scanner.end()).toBe('');
    });
  });
});

describe('LineScanner', () => {
  function shouldRewrite(input, expected) {
    expect(scan(input, LineScanner)).toBe(expected);
  }

  it('rewrites MESSAGE lines to comments', () => {
    shouldRewrite('<a> <b> <c> .\nMESSAGE\n<d> <e> <f> .\n', '<a> <b> <c> .\n#SM2\n<d> <e> <f> .\n');
  });

  it('rewrites indented MESSAGE lines with trailing comments, and keeps line breaks', () => {
    shouldRewrite('  MESSAGE # c\r\n\tMESSAGE\r<a> <b> <c> .', '#SM1\r\n#SM2\r<a> <b> <c> .');
  });

  it('rewrites VERSION lines to comments that carry the label', () => {
    shouldRewrite('VERSION "1.2-messages"\nversion \'1.1\' # c\n', '#SV1.2-messages\n#SV1.1\n');
  });

  it('does not rewrite statements, comments and invalid directives', () => {
    const input = '<a> <b> "MESSAGE" .\n# MESSAGE\nMESSAGE <a> <b> <c> .\nMESSAGES\nVERSION 1.2\nVERSION "a" "b"\nMESSAGE .\n  \n\n';
    shouldRewrite(input, input);
  });

  it('does not rewrite lookalikes in the middle of a line', () => {
    shouldRewrite('<a> <b> "x\u2028MESSAGE\u2028" .\n', '<a> <b> "x\u2028MESSAGE\u2028" .\n');
  });

  it('buffers incomplete lines until their line break', () => {
    const scanner = new LineScanner('S');
    expect(scanner.push('<a> <b> <c> .\nMES')).toBe('<a> <b> <c> .\n');
    expect(scanner.push('SAGE')).toBe('');
    expect(scanner.push('\nMESSAGE')).toBe('#SM2\n');
    expect(scanner.end()).toBe('#SM3');
    expect(scanner.end()).toBe('');
  });

  it('does not depend on chunk boundaries', () => {
    const input = 'VERSION "1.2-messages"\n<a> <b> <c> .\r\nMESSAGE\r\nMESSAGE # x\n\n<a> <b> "MESSAGE" . # MESSAGE\nMESSAGE';
    const expected = scan(input, LineScanner);
    for (let i = 0; i <= input.length; i++)
      expect(scanChunks([input.slice(0, i), input.slice(i)], LineScanner)).toBe(expected);
    expect(scanChunks(splitEvery(input, 1), LineScanner)).toBe(expected);
  });
});
