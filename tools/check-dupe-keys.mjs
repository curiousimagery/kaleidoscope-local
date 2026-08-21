// tools/check-dupe-keys.mjs
//
// ONE CHECK, FOR ONE BUG CLASS THAT IS INVISIBLE IN REVIEW.
//
// A JS object literal silently takes the LAST duplicate key. Not a syntax error, no warning,
// nothing at runtime. B686 found two in `native-camera.js`:
//
//     getDeviceId: () => deviceId,   // B684 added this
//     getDeviceId: () => null,       // ...20 lines below, pre-existing, and it WINS
//
// The first disabled every camera UI gate — so B685's structurally correct fix had ZERO effect and
// looked like a failed fix. The second dropped a `resetControls()` call. Both were found by a
// device session and a live show, which is the expensive way.
//
// ⚠️ WHY THIS IS A SCRIPT AND NOT A LINTER. CLAUDE.md rules out build steps and dependencies
// without asking, and a lint config is a thing that grows rules and becomes an argument. This has
// no config, no rule set, and no new dependency: `acorn` is already present via Vite's own rollup.
// It answers exactly one question and cannot grow into a style opinion.
//
// ⚠️ AND WHY IT LIVES IN `npm run check` RATHER THAN IN A DOC. Daniel, B696: *"how and when would
// you know to run the script in a future session... i'd like a little housekeeping to make sure
// that several arcs later the script doesn't get lost when its most needed."* A reference in a
// markdown file depends on someone reading the right file at the right moment. `npm run check`
// already existed as the "is this code sane" gate, so this rides a habit that is already there.

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import * as acorn from 'acorn';

const files = globSync('{src,packages/conduit/src,tools}/**/*.{js,mjs}');
let bad = 0;

for (const file of files) {
  let ast;
  try {
    ast = acorn.parse(readFileSync(file, 'utf8'), {
      ecmaVersion: 'latest', sourceType: 'module', locations: true,
    });
  } catch (e) {
    console.error(`  parse failed  ${file}: ${e.message}`);
    bad++;
    continue;
  }
  // Walk every ObjectExpression and look for a repeated non-computed key. Getters and setters are
  // exempt: `get x` beside `set x` is a legal pair, not a shadow.
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ObjectExpression') {
      const seen = new Map();
      for (const prop of node.properties) {
        if (prop.type !== 'Property' || prop.computed) continue;
        if (prop.kind === 'get' || prop.kind === 'set') continue;
        const name = prop.key.name ?? prop.key.value;
        if (name == null) continue;
        if (seen.has(name)) {
          console.error(`  DUPLICATE KEY  ${file}:${prop.loc.start.line}  '${name}' shadows the one at line ${seen.get(name)} — the LAST one wins`);
          bad++;
        }
        seen.set(name, prop.loc.start.line);
      }
    }
    for (const k in node) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  })(ast);
}

if (bad) {
  console.error(`\nduplicate-key check FAILED: ${bad} problem(s) across ${files.length} files`);
  process.exit(1);
}
console.log(`duplicate-key check passed (${files.length} files)`);
