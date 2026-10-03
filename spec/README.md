# RDF Messages compliance suite

`npm run test:spec` runs the **official RDF Messages test suite** of the W3C RDF Stream Processing
Community Group against `n3.js-messages`, and reports every case as passed, failed or skipped.
The run fails (exit code 1) on any failed case.

## What "the official suite" is

The test suite is published as a *prose document*, [RDF Messages Interoperability Tests](https://w3c-cg.github.io/rsp/spec/messages-tests)
(source: `spec/messages-tests.bs` in <https://github.com/w3c-cg/rsp>). It is not a machine-readable manifest
(there is no `manifest.ttl` and no EARL harness upstream). Every test is a section with fenced input and
expected-output blocks. `spec/cases.js` turns these sections into structured cases, and `spec/runner.js` executes them:

| Upstream group | Handling |
| --- | --- |
| Parsing Tests for Turtle, TriG, N-Triples, and N-Quads | Run through `parseMessages` **and** `MessageStreamParser` (one character per chunk), in every syntax in which the input is valid (Turtle and TriG; plus N-Triples and N-Quads for inputs without prefixes, braces and `@` directives; N-Quads only for the case about graph names). Expected `Message N:` listings are compared per message by RDF isomorphism. Expectations that the suite only states in prose (blank node scoping) are mapped to an explicit semantic check in `spec/runner.js`; a case with prose expectations and no registered check **fails**, so new upstream cases cannot be silently ignored. |
| Serialization Tests | The messages are written with `writeMessages` and `MessageStreamWriter`, parsed again (sync and streamed) and compared to the expected messages, in each applicable syntax. |
| Error Tests | The input must be rejected by the sync parser and the stream parser, in each applicable syntax. |
| Message Stream Discovery Tests | **Skipped**: they test protocol adapters (SSE, WebSocket, Kafka, MQTT, Jelly gRPC), not RDF syntax parsers or serializers. |
| Parsing Tests for NDJSON-LD | **Skipped**: NDJSON-LD is a different serialization, out of scope for this package. |

Skipped cases are reported with their reason, and appear as `earl:inapplicable` in the EARL report.

## Reproducibility

The suite is **vendored**, so ordinary runs never touch the network: `spec/fixtures/messages-tests.bs`
(and the specification source `messages.bs` for reference) are unmodified copies from the upstream commit recorded in
`spec/fixtures/UPSTREAM.json`, together with their SHA-256 hashes. The runner verifies the hash before running.
The upstream license (W3C 3-clause BSD License for test suites) is retained in `spec/fixtures/LICENSE-UPSTREAM.md`.

## Updating the suite

```sh
node scripts/update-spec.js <commit sha of https://github.com/w3c-cg/rsp>
npm run test:spec
```

Review the diff of `spec/fixtures/`, and extend `spec/cases.js` / `spec/runner.js` for new kinds of cases.

## EARL report

```sh
npm run test:spec:earl     # writes spec/earl-report.ttl
```

The EARL report (Turtle) contains one assertion per upstream case: `earl:passed`, `earl:failed` or
`earl:inapplicable` (skipped). Test IRIs are `https://w3c-cg.github.io/rsp/spec/messages-tests#<section id>`.
This target is informational; the conformance gate is `npm run test:spec`.
