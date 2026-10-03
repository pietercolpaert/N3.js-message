// **formats** describes the RDF syntaxes that support RDF Messages.

const FORMATS = {
  turtle: { name: 'Turtle', lineMode: false },
  trig: { name: 'TriG', lineMode: false },
  ntriples: { name: 'N-Triples', lineMode: true },
  nquads: { name: 'N-Quads', lineMode: true },
};

// The version labels of RDF 1.2 syntaxes, as accepted by N3.js
const BASE_VERSIONS = ['1.2', '1.2-basic', '1.1'];

// ### `resolveFormat` maps a format name or media type to a supported syntax
export function resolveFormat(format = 'TriG') {
  const key = String(format).toLowerCase().split(';')[0].trim()
    .replace(/^(?:text|application)\//, '')
    .replace(/^x-/, '')
    .replace(/[-_ ]/g, '');
  const resolved = FORMATS[key];
  if (!resolved)
    throw new TypeError(`Unsupported RDF Messages format: "${format}". ` +
                        'Supported formats are Turtle, TriG, N-Triples and N-Quads.');
  return resolved;
}

// ### `isMessagesVersion` checks whether a version label announces RDF Messages
export function isMessagesVersion(version) {
  return typeof version === 'string' && version.endsWith('-messages');
}

// ### `baseVersion` strips the `-messages` suffix of a version label
export function baseVersion(version) {
  return isMessagesVersion(version) ? version.slice(0, -'-messages'.length) : version;
}

// ### `isSupportedVersion` checks whether a (base) version label is supported
export function isSupportedVersion(version, supported = BASE_VERSIONS) {
  return supported.includes(version);
}
