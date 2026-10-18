// Builds a self-contained static copy of TRACE into ./site for GitHub Pages (or any static host).
// node_modules isn't published, so only the vendor files the game imports are copied into
// site/vendor/, and the copied index.html's importmap is rewritten to point there.
// Source files (index.html, src/, assets/) are only read, never modified.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'site');
const nm = join(root, 'node_modules');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const dir of ['src', 'assets']) await cp(join(root, dir), join(out, dir), { recursive: true });

// Copy a vendor module and, recursively, every relative module it imports.
const copied = new Set();
async function vendor(file) {
  if (copied.has(file)) return;
  copied.add(file);
  const dest = join(out, 'vendor', relative(nm, file));
  await mkdir(dirname(dest), { recursive: true });
  const code = await readFile(file, 'utf8');
  await writeFile(dest, code);
  for (const m of code.matchAll(/^\s*(?:import|export)\s[^'";]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    await vendor(join(dirname(file), m[1]));
  }
}

// three/addons/* used by src/ (scan imports so new addons are picked up automatically)
const srcFiles = ['main.js', 'world.js', 'player.js', 'grass.js', 'water.js', 'footprints.js', 'props.js',
  'audio.js', 'animalView.js', 'truth.js', 'gait.js', 'rules.js', 'rng.js', 'selftest.js'];
const addons = new Set();
for (const f of srcFiles) {
  const code = await readFile(join(root, 'src', f), 'utf8');
  for (const m of code.matchAll(/from\s*['"]three\/addons\/([^'"]+)['"]/g)) addons.add(m[1]);
}
await vendor(join(nm, 'three/build/three.module.js'));
for (const a of addons) await vendor(join(nm, 'three/examples/jsm', a));
await vendor(join(nm, 'three-mesh-bvh/build/index.module.js'));
await vendor(join(nm, 'yuka/build/yuka.module.js'));

// licenses travel with the vendored code
for (const p of ['three', 'three-mesh-bvh', 'yuka']) {
  await cp(join(nm, p, 'LICENSE'), join(out, 'vendor', p, 'LICENSE'));
}

const html = (await readFile(join(root, 'index.html'), 'utf8')).replaceAll('./node_modules/', './vendor/');
await writeFile(join(out, 'index.html'), html);
await writeFile(join(out, '.nojekyll'), '');

console.log(`site/ built: ${copied.size} vendor modules, addons: ${[...addons].join(', ')}`);
