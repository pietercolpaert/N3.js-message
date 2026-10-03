// Runs the RDF Messages test suite (vendored in spec/fixtures, see spec/README.md)
// against n3.js-messages, and reports passed, failed and skipped cases.
//
//     node spec/runner.js            human-readable report, exit code 1 on failures
//     node spec/runner.js --earl     EARL report in Turtle on stdout, human report on stderr
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { isomorphic } from 'rdf-isomorphic';
import { parseMessages, writeMessages, MessageStreamParser, MessageStreamWriter } from '../src/index.js';
import { discoverCases, parseExpectedMessages } from './cases.js';

const SPEC = 'https://w3c-cg.github.io/rsp/spec/messages-tests';
const LINE_FORMATS = ['N-Triples', 'N-Quads'];

// ### The syntaxes in which a case is run
function formatsFor(testCase) {
  if (/N-Quads/.test(testCase.title))
    return ['N-Quads'];
  if (/\{/.test(testCase.input))
    return ['TriG'];
  const lineCompatible = !/@|^\s*(PREFIX|BASE)\b/im.test(testCase.input);
  return testCase.kind === 'error' ?
    ['Turtle', 'TriG', ...LINE_FORMATS] :
    ['Turtle', 'TriG', ...lineCompatible ? LINE_FORMATS : []];
}

// ### Parse a document with the synchronous parser
function parseSync(input, format) {
  return parseMessages(input, { format });
}

// ### Parse a document through the stream parser, one character at a time
function parseStreamed(input, format) {
  return new Promise((resolve, reject) => {
    const parser = new MessageStreamParser({ format });
    const messages = [];
    parser.on('data', message => messages.push(message));
    parser.on('error', reject);
    parser.on('end', () => resolve(messages));
    for (const character of input)
      parser.write(character);
    parser.end();
  });
}

function assertSameMessages(actual, expected, label) {
  if (actual.length !== expected.length)
    throw new Error(`${label}: expected ${expected.length} messages, got ${actual.length}`);
  expected.forEach((message, index) => {
    if (!isomorphic(actual[index], message))
      throw new Error(`${label}: message ${index + 1} differs from the expected quads`);
  });
}

// ### Checks for expectations that the suite only describes in prose
const SEMANTIC_CHECKS = {
  'blank-node-labels-are-scoped-per-message'(messages) {
    if (messages.length !== 2 || messages.some(message => message.length !== 1))
      throw new Error('expected two messages with one quad each');
    const [a, b] = messages.map(message => message[0].subject);
    if (a.termType !== 'BlankNode' || b.termType !== 'BlankNode')
      throw new Error('expected blank node subjects');
    if (a.equals(b))
      throw new Error('the two blank nodes must not be the same RDF term');
  },
};

async function runParseCase(testCase) {
  const expected = parseExpectedMessages(testCase.expected);
  const check = SEMANTIC_CHECKS[testCase.id];
  if (!expected && !check)
    throw new Error('the expected result is prose and no semantic check is registered for this case');
  for (const format of formatsFor(testCase)) {
    for (const [mode, parse] of [['sync', parseSync], ['stream', parseStreamed]]) {
      const messages = await parse(testCase.input, format);
      if (expected)
        assertSameMessages(messages, expected, `${format} (${mode})`);
      else
        try {
          check(messages);
        }
        catch (error) {
          throw new Error(`${format} (${mode}): ${error.message}`);
        }
    }
  }
}

async function runErrorCase(testCase) {
  for (const format of formatsFor(testCase)) {
    for (const [mode, parse] of [['sync', parseSync], ['stream', parseStreamed]]) {
      let error = null;
      try {
        await parse(testCase.input, format);
      }
      catch (e) {
        error = e;
      }
      if (!error)
        throw new Error(`${format} (${mode}): expected a parse error`);
    }
  }
}

async function runSerializeCase(testCase) {
  const input = parseExpectedMessages(testCase.input);
  const expected = parseExpectedMessages(testCase.expected);
  const hasGraphs = input.some(message => message.some(quad => quad.graph.termType !== 'DefaultGraph'));
  const formats = hasGraphs ? ['TriG', 'N-Quads'] : ['Turtle', 'TriG', ...LINE_FORMATS];
  for (const format of formats) {
    const text = writeMessages(input, { format });
    assertSameMessages(parseSync(text, format), expected, `${format} (writeMessages)`);
    assertSameMessages(await parseStreamed(text, format), expected, `${format} (streamed)`);
    const streamed = await new Promise((resolve, reject) => {
      const writer = new MessageStreamWriter({ format });
      let output = '';
      writer.on('data', chunk => (output += chunk));
      writer.on('error', reject);
      writer.on('end', () => resolve(output));
      input.forEach(message => writer.write(message));
      writer.end();
    });
    assertSameMessages(parseSync(streamed, format), expected, `${format} (MessageStreamWriter)`);
  }
}

const RUNNERS = { parse: runParseCase, error: runErrorCase, serialize: runSerializeCase };

// ### Check that the vendored suite is the pinned upstream revision
function verifyFixture() {
  const upstream = JSON.parse(readFileSync(new URL('./fixtures/UPSTREAM.json', import.meta.url), 'utf8'));
  const hash = createHash('sha256').update(readFileSync(new URL('./fixtures/messages-tests.bs', import.meta.url))).digest('hex');
  if (hash !== upstream.files['spec/messages-tests.bs'])
    throw new Error(`spec/fixtures/messages-tests.bs does not match the pinned upstream revision ${upstream.commit}`);
  return upstream;
}

// ### Writes an EARL report for the results
function earlReport(results, upstream) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const outcomes = { passed: 'earl:passed', failed: 'earl:failed', skipped: 'earl:inapplicable' };
  const subject = `<${pkg.homepage.replace(/#.*/, '')}>`;
  const lines = [
    '@prefix earl: <http://www.w3.org/ns/earl#> .',
    '@prefix dc: <http://purl.org/dc/terms/> .',
    '@prefix doap: <http://usefulinc.com/ns/doap#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
    '',
    `${subject} a earl:Software, earl:TestSubject, doap:Project ;`,
    `  doap:name "${pkg.name}" ; doap:release [ doap:revision "${pkg.version}" ] ;`,
    `  dc:description "RDF Messages test suite revision ${upstream.commit} of ${upstream.repository}" .`,
  ];
  for (const result of results) {
    lines.push('', '[] a earl:Assertion ;',
      `  earl:subject ${subject} ;`,
      `  earl:test <${SPEC}#${result.id}> ;`,
      `  earl:result [ a earl:TestResult ; earl:outcome ${outcomes[result.status]} ;`,
      `    dc:date "${new Date().toISOString()}"^^xsd:dateTime ] ;`,
      '  earl:mode earl:automatic .');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const upstream = verifyFixture();
  const results = [];
  for (const testCase of discoverCases(readFileSync(new URL('./fixtures/messages-tests.bs', import.meta.url), 'utf8'))) {
    let status = 'passed', detail = '';
    if (testCase.kind === 'skip')
      status = 'skipped', detail = testCase.reason;
    else
      try {
        await RUNNERS[testCase.kind](testCase);
      }
      catch (error) {
        status = 'failed', detail = error.message;
      }
    results.push({ id: testCase.id, title: testCase.title, status, detail });
  }

  const report = [`RDF Messages test suite ${upstream.repository} @ ${upstream.commit.slice(0, 10)}`, ''];
  for (const { status, title, detail } of results)
    report.push(`${status.toUpperCase().padEnd(7)} ${title}${detail ? `\n        ${detail}` : ''}`);
  function count(status) {
    return results.filter(result => result.status === status).length;
  }
  report.push('', `passed: ${count('passed')}, failed: ${count('failed')}, skipped: ${count('skipped')}, total: ${results.length}`);
  const earl = process.argv.includes('--earl');
  (earl ? console.error : console.log)(report.join('\n'));
  if (earl)
    process.stdout.write(earlReport(results, upstream));
  process.exitCode = count('failed') > 0 || count('passed') === 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
