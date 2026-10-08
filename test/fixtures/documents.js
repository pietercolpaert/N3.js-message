// Documents that exercise the message framing, with their expected messages
// (blank nodes are rendered by order of first occurrence, see `render` in test/util.js).
const V = 'VERSION "1.2-messages"\n';
const P = '<http://example.org/p>';
function s(n) {
  return `<http://example.org/s${n}>`;
}

function o(n) {
  return `<http://example.org/o${n}>`;
}

export default [
  {
    name: 'Turtle with two messages',
    format: 'Turtle',
    input: `${V}PREFIX ex: <http://example.org/>\nex:s1 ex:p ex:o1 .\nMESSAGE\nex:s2 ex:p ex:o2 .\n`,
    expected: [[`${s(1)} ${P} ${o(1)}`], [`${s(2)} ${P} ${o(2)}`]],
  },
  {
    name: 'Turtle with old-style directives and CRLF',
    format: 'Turtle',
    input: '@version "1.1-messages" .\r\n@prefix ex: <http://example.org/> .\r\nex:s1 ex:p ex:o1 .\r\n@message .\r\nex:s2 ex:p ex:o2 .\r\n',
    expected: [[`${s(1)} ${P} ${o(1)}`], [`${s(2)} ${P} ${o(2)}`]],
  },
  {
    name: 'delimiter lookalikes in literals, IRIs, comments and names',
    format: 'TriG',
    input: `${V}@prefix ex: <http://example.org/> .\n@prefix MESSAGE: <http://example.org/m/> .\n` +
      'ex:s1 ex:p "MESSAGE" , "\\"\\nMESSAGE\\n" , \'@message .\' .\n' +
      '<http://example.org/MESSAGE> ex:p """\nMESSAGE\n""" , \'\'\'\n@message .\n\'\'\' . # MESSAGE\n' +
      'MESSAGE:x ex:p ex:MESSAGE , MESSAGE:MESSAGE , ex:a.MESSAGE .\n' +
      'ex:s1 ex:p "x"@message .\nMESSAGE # real\nex:s2 ex:p ex:o2 .\n',
    expected: [
      [`${s(1)} ${P} "MESSAGE"`, `${s(1)} ${P} "\\"\\nMESSAGE\\n"`, `${s(1)} ${P} "@message ."`,
        '<http://example.org/MESSAGE> <http://example.org/p> "\\nMESSAGE\\n"',
        '<http://example.org/MESSAGE> <http://example.org/p> "\\n@message .\\n"',
        '<http://example.org/m/x> <http://example.org/p> <http://example.org/MESSAGE>',
        '<http://example.org/m/x> <http://example.org/p> <http://example.org/m/MESSAGE>',
        '<http://example.org/m/x> <http://example.org/p> <http://example.org/a.MESSAGE>',
        `${s(1)} ${P} "x"@message`],
      [`${s(2)} ${P} ${o(2)}`],
    ],
  },
  {
    name: 'graph blocks, empty messages and consecutive delimiters',
    format: 'TriG',
    input: `${V}@prefix ex: <http://example.org/> .\nMESSAGE\nex:g { ex:s1 ex:p ex:o1 . }\nex:s0 ex:p ex:o0 .\n` +
      'MESSAGE\nMESSAGE\n@message .\nex:g {\n  ex:s2 ex:p ex:o2 .\n}\nMESSAGE\nex:g { ex:s3 ex:p ex:o3 }MESSAGE\nMESSAGE',
    expected: [
      [],
      [`${s(1)} ${P} ${o(1)} <http://example.org/g>`, `${s(0)} ${P} ${o(0)}`],
      [],
      [],
      [`${s(2)} ${P} ${o(2)} <http://example.org/g>`],
      [`${s(3)} ${P} ${o(3)} <http://example.org/g>`],
      [],
    ],
  },
  {
    name: 'blank nodes are scoped to their message',
    format: 'TriG',
    input: `${V}_:a ${P} ${o(1)} .\n_:a ${P} _:b .\nMESSAGE\nMESSAGE\n_:a ${P} ${o(2)} .\n[ ${P} _:a ] ${P} ${o(3)} .\n`,
    expected: [
      [`_:b0 ${P} ${o(1)}`, `_:b0 ${P} _:b1`],
      [],
      [`_:b2 ${P} ${o(2)}`, `_:b3 ${P} _:b2`, `_:b3 ${P} ${o(3)}`],
    ],
  },
  {
    name: 'Unicode, escapes and a version announcement with comments',
    format: 'Turtle',
    input: `# a comment before the version\n  VERSION   "1.2-basic-messages"  # trailing\n${s(1)} ${P} "héllo wörld ☃ \u{1F600}" , "tab\\tquote\\"\\u00e9" .\nMESSAGE\t# comment\n${s(2)} ${P} "日本語"@ja .\n`,
    expected: [
      [`${s(1)} ${P} "héllo wörld ☃ \u{1F600}"`, `${s(1)} ${P} "tab\\tquote\\"é"`],
      [`${s(2)} ${P} "日本語"@ja`],
    ],
  },
  {
    name: 'N-Triples with comments and blank lines',
    format: 'N-Triples',
    input: `${V}\n# comment\n${s(1)} ${P} "MESSAGE" .\n\n  MESSAGE  # delimiter\n_:x ${P} ${o(2)} .\r\nMESSAGE\r\n_:x ${P} "VERSION \\"x\\"" .\n`,
    expected: [[`${s(1)} ${P} "MESSAGE"`], [`_:b0 ${P} ${o(2)}`], [`_:b1 ${P} "VERSION \\"x\\""`]],
  },
  {
    name: 'N-Quads with graphs',
    format: 'N-Quads',
    input: `VERSION "1.2-messages"\n${s(1)} ${P} ${o(1)} <http://example.org/g> .\nMESSAGE\nMESSAGE\n${s(2)} ${P} ${o(2)} <http://example.org/g> .\nMESSAGE`,
    expected: [[`${s(1)} ${P} ${o(1)} <http://example.org/g>`], [], [`${s(2)} ${P} ${o(2)} <http://example.org/g>`]],
  },
  {
    name: 'a plain RDF document without announcement is a single message',
    format: 'Turtle',
    input: `${s(1)} ${P} ${o(1)} .\n${s(2)} ${P} ${o(2)} .\n`,
    expected: [[`${s(1)} ${P} ${o(1)}`, `${s(2)} ${P} ${o(2)}`]],
  },
  {
    name: 'an announced log without statements has no messages',
    format: 'TriG',
    input: V,
    expected: [],
  },
];
