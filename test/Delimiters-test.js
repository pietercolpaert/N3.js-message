// N3.js recognizes the delimiters through its `directives` option.
// These tests check that MESSAGE-like text elsewhere in a document is not a delimiter,
// and that recognition does not depend on chunk boundaries.
import { render, parseChunks, splitEvery } from './util.js';
import { parseMessages } from '../src/index.js';

const V = 'VERSION "1.2-messages"\n';
const PREFIXES = '@prefix ex: <http://example.org/> .\n@prefix MESSAGE: <http://example.org/m#> .\n';

function count(input, format = 'TriG') {
  return parseMessages(`${V}${PREFIXES}${input}`, { format }).length;
}

describe('delimiters in Turtle and TriG', () => {
  it.each([
    ['a short string', '<a:s> <a:p> "MESSAGE" .'],
    ['a single-quoted string', '<a:s> <a:p> \'MESSAGE\' .'],
    ['a string with escaped quotes', '<a:s> <a:p> "\\" MESSAGE" .'],
    ['a long string', '<a:s> <a:p> """\nMESSAGE\n""" .'],
    ['a long string with quotes and escapes', '<a:s> <a:p> """a ""\\"" "\nMESSAGE\n\\\\""" .'],
    ['a single-quoted long string', '<a:s> <a:p> \'\'\'\n@message .\n\'\'\' .'],
    ['an IRI', '<http://example.org/MESSAGE> <a:p> <a:o> .'],
    ['a comment', '<a:s> <a:p> <a:o> . # MESSAGE\n'],
    ['a prefixed name', 'ex:MESSAGE ex:p MESSAGE:x .'],
    ['a prefixed name with a dot', 'ex:a.MESSAGE ex:p ex:o .'],
    ['a prefixed name with an escape', 'ex:a\\#MESSAGE ex:p ex:o .'],
    ['a language tag', '<a:s> <a:p> "x"@message .'],
    ['a datatype', '<a:s> <a:p> "x"^^MESSAGE:x .'],
    ['a reified triple', '<< <a:s> <a:p> <a:o> >> <a:p> <a:o> .'],
    ['an empty string', '<a:s> <a:p> "" . <a:s> <a:p> \'\' .'],
  ])('ignores MESSAGE-like text in %s', (name, input) => {
    expect(count(`${input}\n<a:s> <a:p> <a:o> .`)).toBe(1);
  });

  it.each([
    ['a longer word', 'MESSAGES <a:p> <a:o> .'],
    ['a partial keyword', 'MESS <a:p> <a:o> .'],
    ['a number-like word', '<a:s> <a:p> 1.MESSAGE .'],
  ])('rejects %s', (name, input) => {
    expect(() => count(input)).toThrow();
  });

  it('recognizes a delimiter after an empty string, a reified triple and a graph block', () => {
    expect(count('<a:s> <a:p> "".\nMESSAGE\n<< <a:s> <a:p> <a:o> >> <a:p> <a:o> .\nMESSAGE\n' +
                 '<a:g> { <a:s> <a:p> <a:o> }MESSAGE\n<a:s> <a:p> <a:o> .')).toBe(4);
  });

  it('recognizes a delimiter followed by a comment or an IRI', () => {
    expect(count('MESSAGE# c\nMESSAGE<a:s> <a:p> <a:o> .')).toBe(3);
  });

  it('reads @prefix after a SPARQL-style version announcement', () => {
    expect(parseMessages(`${V}@prefix ex: <http://example.org/> .\nex:s ex:p ex:o .\nMESSAGE\nex:s ex:p ex:o .`, { format: 'Turtle' }))
      .toHaveLength(2);
  });

  it('accepts a single-quoted, lowercase version announcement', () => {
    expect(parseMessages('version \'1.2-messages\'\n<a:s> <a:p> <a:o> .\nMESSAGE\n<a:s> <a:p> <a:o> .', { format: 'Turtle' }))
      .toHaveLength(2);
  });

  it('does not depend on chunk boundaries', () => {
    const input = `@prefix ex: <http://example.org/> .\n${V}ex:a ex:b "MESSAGE\\"" .\r\nMESSAGE\r\n` +
      '<a:g> { ex:a ex:b """\nMESSAGE\n""\\"""" }\n@message .\nMESSAGE # c\n<< <a:s> <a:p> <a:o> >> ex:b \'\' .\n' +
      'ex:c.MESSAGE ex:p ex:o .\n@message.\nex:c ex:p ex:o .\nMESSAGE';
    const expected = render(parseMessages(input, { format: 'TriG' }));
    expect(expected).toHaveLength(5);
    for (let i = 0; i <= input.length; i++)
      expect(render(parseChunks([input.slice(0, i), input.slice(i)], { format: 'TriG' }))).toEqual(expected);
    expect(render(parseChunks(splitEvery(input, 1), { format: 'TriG' }))).toEqual(expected);
  });
});

describe('delimiters in N-Triples and N-Quads', () => {
  it('ignores MESSAGE-like text in strings and comments', () => {
    const input = `${V}<a:s> <a:p> "MESSAGE" .\n# MESSAGE\n<a:s> <a:p> "x\u2028MESSAGE\u2028" . # MESSAGE\n`;
    expect(parseMessages(input, { format: 'N-Triples' })).toHaveLength(1);
  });

  it('recognizes indented delimiters with trailing comments, with any line break', () => {
    const input = `${V}  MESSAGE # c\r\n\tMESSAGE\r<a:s> <a:p> <a:o> .\nMESSAGE`;
    expect(parseMessages(input, { format: 'N-Quads' })).toHaveLength(3);
  });

  it.each([
    ['a longer word', 'MESSAGES\n'],
    ['a version without string', 'VERSION 1.2\n'],
    ['a version with two strings', 'VERSION "a" "b"\n'],
  ])('rejects %s', (name, input) => {
    expect(() => parseMessages(`${V}${input}`, { format: 'N-Quads' })).toThrow();
  });

  it('does not depend on chunk boundaries', () => {
    const input = `${V}<a:s> <a:p> <a:o> .\r\nMESSAGE\r\nMESSAGE # x\n\n<a:s> <a:p> "MESSAGE" . # MESSAGE\nMESSAGE`;
    const expected = render(parseMessages(input, { format: 'N-Quads' }));
    expect(expected).toHaveLength(3);
    for (let i = 0; i <= input.length; i++)
      expect(render(parseChunks([input.slice(0, i), input.slice(i)], { format: 'N-Quads' }))).toEqual(expected);
    expect(render(parseChunks(splitEvery(input, 1), { format: 'N-Quads' }))).toEqual(expected);
  });
});
