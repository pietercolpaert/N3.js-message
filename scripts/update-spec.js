// Updates the vendored RDF Messages test suite to a given upstream commit.
//
//     node scripts/update-spec.js <commit-sha>
//
// Afterwards, run `npm run test:spec`: new upstream cases that this package
// cannot map to an automatic check fail the run, so that they get attention.
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';

const commit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commit || '')) {
  console.error('Usage: node scripts/update-spec.js <40-character commit sha of https://github.com/w3c-cg/rsp>');
  process.exit(1);
}

const upstream = { repository: 'https://github.com/w3c-cg/rsp', commit, files: {} };
for (const file of ['spec/messages-tests.bs', 'spec/messages.bs']) {
  const response = await fetch(`https://raw.githubusercontent.com/w3c-cg/rsp/${commit}/${file}`);
  if (!response.ok)
    throw new Error(`Could not download ${file}: ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  writeFileSync(new URL(`../spec/fixtures/${file.replace('spec/', '')}`, import.meta.url), content);
  upstream.files[file] = createHash('sha256').update(content).digest('hex');
}
const commitInfo = await (await fetch(`https://api.github.com/repos/w3c-cg/rsp/commits/${commit}`)).json();
upstream.commitDate = commitInfo.commit ? commitInfo.commit.committer.date : null;
upstream.publishedAs = 'https://w3c-cg.github.io/rsp/spec/messages-tests';
upstream.license = 'W3C 3-clause BSD License (test suites); see LICENSE-UPSTREAM.md';
writeFileSync(new URL('../spec/fixtures/UPSTREAM.json', import.meta.url), `${JSON.stringify(upstream, null, 2)}\n`);
console.log(`Updated the test suite to ${commit}`);
