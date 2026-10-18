// Can the animal be located from traces alone? A naive "tracker" sees only footfall events
// (position, time) — never the truth — and guesses: last print + extrapolated drift.
import { AnimalTruth } from '../src/truth.js';
import { mulberry32 } from '../src/rng.js';
// real map layout (three.js coords of the Blender mud/puddle patches)
const obstacles = [{ x: 4, z: 0, r: 0.5 }, { x: -3, z: 6, r: 0.6 }, { x: 0, z: -5, r: 0.4 }];
const puddles = [{ x: 3, z: 4, r: 1.6 }, { x: -6, z: -5, r: 1.2 }, { x: 8, z: -7, r: 1.0 }];
const muds = [[3, 4, 2.9], [-6, -5, 2.4], [8, -7, 2.1], [-4, 7.5, 2.0], [10, 9, 1.6]];
const loud = e => muds.some(([x, z, r]) => Math.hypot(e.x - x, e.z - z) < r);
const rows = [];
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  Math.random = mulberry32(seed * 77);
  const a = new AnimalTruth({ rng: mulberry32(seed), obstacles, puddles });
  const prints = [], loudPrints = []; let hitsFresh = 0, hitsNaive = 0, hitsLoud = 0, samples = 0, stillTime = 0;
  for (let t = 0; t < 600; t += 1 / 30) {
    for (const e of a.update(1 / 30)) if (e.type === 'footfall') { prints.push(e); if (loud(e)) loudPrints.push(e); }
    if (a.speed < 0.1) stillTime += 1 / 30;
    if (t > 30 && Math.abs((t % 5)) < 1 / 30 && prints.length > 8) {
      samples++;
      const last = prints[prints.length - 1], prev = prints[prints.length - 9];
      const age = t - last.t;
      // naive: guess the last print
      if (Math.hypot(last.x - a.x, last.z - a.z) <= 1.6) hitsNaive++;
      // tracker: extrapolate along the print trail, but assume it stopped if prints are old (> 2 s)
      const v = (last.t - prev.t) > 0 ? [(last.x - prev.x) / (last.t - prev.t), (last.z - prev.z) / (last.t - prev.t)] : [0, 0];
      const k = age > 2 ? 0.6 : age;
      const gx = last.x + v[0] * k, gz = last.z + v[1] * k;
      if (Math.hypot(gx - a.x, gz - a.z) <= 1.6) hitsFresh++;
      // realistic: only mud prints / ripples are reliably seen from a distance
      const L = loudPrints[loudPrints.length - 1];
      if (L && Math.hypot(L.x - a.x, L.z - a.z) <= 1.6) hitsLoud++;
    }
  }
  rows.push({ seed, samples, naive: (hitsNaive / samples * 100).toFixed(0) + '%', tracker: (hitsFresh / samples * 100).toFixed(0) + '%', mudOnly: (hitsLoud / samples * 100).toFixed(0) + '%', still: (stillTime / 600 * 100).toFixed(0) + '%' });
}
console.table(rows);
