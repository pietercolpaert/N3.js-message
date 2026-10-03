// A minimal RDF/JS data factory that is independent of N3.js' data factory.
class Term {
  constructor(termType, value) {
    this.termType = termType;
    this.value = value;
  }

  equals(other) {
    return !!other && other.termType === this.termType && other.value === this.value;
  }
}

class CustomLiteral extends Term {
  constructor(value, language, datatype) {
    super('Literal', value);
    this.language = language;
    this.datatype = datatype;
  }

  equals(other) {
    return super.equals(other) && other.language === this.language && this.datatype.equals(other.datatype);
  }
}

class CustomQuad extends Term {
  constructor(subject, predicate, object, graph) {
    super('Quad', '');
    Object.assign(this, { subject, predicate, object, graph });
  }

  equals(other) {
    return !!other && ['subject', 'predicate', 'object', 'graph'].every(part => this[part].equals(other[part]));
  }
}

export const created = { blankNodes: 0 };

export default {
  namedNode: value => new Term('NamedNode', value),
  blankNode: value => new Term('BlankNode', value || `custom${created.blankNodes++}`),
  variable: value => new Term('Variable', value),
  defaultGraph: () => new Term('DefaultGraph', ''),
  literal: (value, languageOrDatatype) => typeof languageOrDatatype === 'string' ?
    new CustomLiteral(value, languageOrDatatype, new Term('NamedNode', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString')) :
    new CustomLiteral(value, '', languageOrDatatype || new Term('NamedNode', 'http://www.w3.org/2001/XMLSchema#string')),
  quad: (subject, predicate, object, graph) => new CustomQuad(subject, predicate, object, graph || new Term('DefaultGraph', '')),
};
