// Marks the Babel output in `lib/` as CommonJS, although the package itself is an ES module.
import { writeFileSync } from 'fs';

writeFileSync(new URL('../lib/package.json', import.meta.url), '{ "type": "commonjs" }\n');
