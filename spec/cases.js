// Extracts the test cases from the Bikeshed source of the RDF Messages test suite.
// The suite is a prose document, not a machine-readable manifest, so this file
// turns its headings and fenced blocks into structured cases.
import { Parser } from 'n3';

const HEADING = /^(#{2,3}) (.*?) #+ \{#([^}]+)\}\s*$/;

// ### `readSections` splits the document into groups (`##`) and tests (`###`)
export function readSections(source) {
  const sections = [];
  let group = null, current = null, label = null, fence = null;
  for (const line of source.split('\n')) {
    const heading = fence ? null : HEADING.exec(line);
    if (fence && line.startsWith('```')) {
      current.blocks.push({ label: fence.label, lang: fence.lang, text: fence.lines.join('\n') });
      fence = null;
    }
    else if (fence)
      fence.lines.push(line);
    else if (heading) {
      current = { id: heading[3], title: heading[2], level: heading[1].length, group: heading[1] === '##' ? heading[2] : group, blocks: [] };
      if (heading[1] === '##')
        group = heading[2];
      sections.push(current);
    }
    else if (line.startsWith('```') && current)
      fence = { label, lang: line.slice(3).trim(), lines: [] };
    else if (line.trim() !== '')
      label = line.trim();
  }
  return sections;
}

// ### `parseExpectedMessages` reads `Message N:` listings of N-Quads.
// It returns null if the expectation is prose that cannot be checked mechanically.
export function parseExpectedMessages(text) {
  const messages = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^Message \d+:$/.test(line))
      messages.push(current = []);
    else if (line.trim() !== '' && current !== null && /^\s+</.test(line))
      current.push(line.trim());
    else if (line.trim() !== '' && !(line.trim() === 'empty' && current !== null))
      return null;
  }
  return messages.map(lines => new Parser({ format: 'N-Quads' }).parse(lines.join('\n')));
}

// ### `discoverCases` turns the document into test cases of a certain kind
export function discoverCases(source) {
  const cases = [];
  const sections = readSections(source);
  // Group headings are not tests themselves
  for (const section of sections.filter(({ level, group }) => level === 3 || !/Discovery|NDJSON-LD/.test(group))) {
    const group = section.group || '';
    const blocks = section.blocks;
    if (/Discovery/.test(group))
      cases.push({ id: section.id, title: section.title, kind: 'skip',
        reason: 'protocol adapter test: it does not apply to RDF syntax parsers and serializers' });
    else if (/NDJSON-LD/.test(group))
      cases.push({ id: section.id, title: section.title, kind: 'skip',
        reason: 'NDJSON-LD is a different serialization, out of scope for this package' });
    else if (/^Parsing Tests for Turtle/.test(group) && blocks.length > 0)
      cases.push({ id: section.id, title: section.title, kind: 'parse',
        input: blocks.find(b => /^Input:/.test(b.label)).text,
        expected: blocks.find(b => /^Expected/.test(b.label)).text });
    else if (/^Error Tests/.test(group) && blocks.length > 0)
      cases.push({ id: section.id, title: section.title, kind: 'error',
        input: blocks.find(b => /^Input:/.test(b.label)).text });
    else if (/^Serialization Tests/.test(group) && blocks.length > 0)
      // Pairs of round-trip input and expected result
      for (let i = 0; i + 1 < blocks.length; i += 2)
        cases.push({ id: `serialization-round-trip-${i / 2 + 1}`, title: blocks[i].label.replace(/:$/, ''),
          kind: 'serialize', input: blocks[i].text, expected: blocks[i + 1].text });
  }
  return cases;
}
