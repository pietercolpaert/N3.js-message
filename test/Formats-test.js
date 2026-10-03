import { resolveFormat, isMessagesVersion, baseVersion, isSupportedVersion } from '../src/formats.js';
import { discoverCases, readSections, parseExpectedMessages } from '../spec/cases.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('formats', () => {
  it('resolves names and media types', () => {
    expect(resolveFormat()).toEqual({ name: 'TriG', lineMode: false });
    expect(resolveFormat('text/turtle; charset=utf-8').name).toBe('Turtle');
    expect(resolveFormat('N-Quads').lineMode).toBe(true);
    expect(resolveFormat('application/n-triples').name).toBe('N-Triples');
  });

  it('recognizes messages version labels', () => {
    expect(isMessagesVersion('1.2-messages')).toBe(true);
    expect(isMessagesVersion('1.2')).toBe(false);
    expect(isMessagesVersion(undefined)).toBe(false);
    expect(baseVersion('1.2-basic-messages')).toBe('1.2-basic');
    expect(baseVersion('1.2')).toBe('1.2');
    expect(isSupportedVersion('1.2')).toBe(true);
    expect(isSupportedVersion('3.0')).toBe(false);
  });
});

describe('the vendored RDF Messages test suite', () => {
  it('is discovered completely', () => {
    const cases = discoverCases(readFileSync(join(__dirname, '../spec/fixtures/messages-tests.bs'), 'utf8'));
    expect(cases.filter(testCase => testCase.kind === 'parse').length).toBe(11);
    expect(cases.filter(testCase => testCase.kind === 'error').length).toBe(3);
    expect(cases.filter(testCase => testCase.kind === 'serialize').length).toBe(2);
    expect(cases.filter(testCase => testCase.kind === 'skip').length).toBe(12);
    expect(new Set(cases.map(testCase => testCase.id)).size).toBe(cases.length);
  });

  it('reads sections with fenced blocks', () => {
    const sections = readSections('## Group ## {#group}\n\n### Test ### {#test}\n\nInput:\n\n```turtle\nabc\n```\n');
    expect(sections).toEqual([
      { id: 'group', title: 'Group', level: 2, group: 'Group', blocks: [] },
      { id: 'test', title: 'Test', level: 3, group: 'Group', blocks: [{ label: 'Input:', lang: 'turtle', text: 'abc' }] },
    ]);
  });

  it('reads expected messages, and returns null for prose', () => {
    expect(parseExpectedMessages('Message 1:\n  <a:s> <a:p> <a:o> .\n\nMessage 2:\n  empty\n').map(message => message.length)).toEqual([1, 0]);
    expect(parseExpectedMessages('Message 1 contains one quad.')).toBeNull();
  });
});
