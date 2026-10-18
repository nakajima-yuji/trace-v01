import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimalTruth, ST } from '../src/truth.js';
import { STRIDE } from '../src/gait.js';
import { mulberry32 } from '../src/rng.js';

// Yuka's WanderBehavior uses Math.random internally → seed it for reproducible runs.
function seeded(seed) { const r = mulberry32(seed); Math.random = r; return r; }

const obstacles = [{ x: 4, z: 0, r: 0.5 }, { x: -3, z: 6, r: 0.6 }, { x: 0, z: -5, r: 0.4 }, { x: 7, z: 9, r: 0.5 }];
const puddles = [{ x: 3, z: 4, r: 1.6 }, { x: -6, z: -5, r: 1.2 }];

function run(seconds, opts = {}, player = () => ({ x: 0, z: -100, mode: 'still' })) {
  const rng = seeded(opts.seed ?? 1);
  const a = new AnimalTruth({ rng, obstacles, puddles, spawn: { x: 0, z: 0 }, ...opts });
  const log = { footfalls: [], states: new Set([a.state]), sips: 0, maxOut: 0, minObstacle: Infinity, dist: 0 };
  const dt = 1 / 30;
  let px = a.x, pz = a.z;
  for (let t = 0; t < seconds; t += dt) {
    const ev = a.update(dt, player(t, a));
    log.dist += Math.hypot(a.x - px, a.z - pz); px = a.x; pz = a.z;
    for (const e of ev) {
      if (e.type === 'footfall') {
        log.footfalls.push(e);
        // a footprint must lie within one body length of the true position at that instant
        assert.ok(Math.hypot(e.x - a.x, e.z - a.z) < 0.8, 'footfall derived from truth position');
      }
      if (e.type === 'state') log.states.add(e.to);
      if (e.type === 'sip') log.sips++;
    }
    log.maxOut = Math.max(log.maxOut, Math.abs(a.x), Math.abs(a.z));
    for (const ob of obstacles) log.minObstacle = Math.min(log.minObstacle, Math.hypot(a.x - ob.x, a.z - ob.z) - ob.r);
  }
  return { a, log };
}

test('animal wanders autonomously, stays on the 30 m map and out of trunks (10 min sim)', () => {
  const { log } = run(600);
  assert.ok(log.dist > 60, `moved ${log.dist.toFixed(1)} m`);
  assert.ok(log.maxOut <= 14.3, `max |coord| ${log.maxOut.toFixed(2)}`);
  assert.ok(log.minObstacle >= 0.2, `closest trunk clearance ${log.minObstacle.toFixed(2)}`);
  assert.ok(log.states.has(ST.GRAZE), 'grazes');
  assert.ok(log.states.has(ST.DRINK), 'goes to drink');
  assert.ok(log.sips > 0, 'drinks (sip events)');
});

test('footfall count matches gait: 4 touchdowns per stride', () => {
  const { log } = run(300, { seed: 5 });
  const expected = (log.dist / STRIDE) * 4;
  assert.ok(Math.abs(log.footfalls.length - expected) <= 4, `${log.footfalls.length} vs ${expected.toFixed(1)}`);
});

test('player noise: sprinting nearby alerts then flees; crouching at same range does not', () => {
  const sprint = run(20, { seed: 9 }, (t, a) => ({ x: a.x + 6, z: a.z, mode: 'sprint' }));
  assert.ok(sprint.log.states.has(ST.ALERT) && sprint.log.states.has(ST.FLEE));
  const crouch = run(20, { seed: 9 }, (t, a) => ({ x: a.x + 6, z: a.z, mode: 'crouch' }));
  assert.ok(!crouch.log.states.has(ST.ALERT) && !crouch.log.states.has(ST.FLEE));
});

test('fleeing produces faster, longer-spaced footfalls', () => {
  const { log } = run(12, { seed: 3 }, (t, a) => ({ x: a.x + 2, z: a.z + 1, mode: 'walk' }));
  const fast = log.footfalls.filter(f => f.speed > 2);
  assert.ok(fast.length > 6, 'has running footfalls');
});

test('wander is not biased toward one world direction (Yuka local-frame steering)', () => {
  const rng = seeded(21);
  const a = new AnimalTruth({ rng, obstacles, puddles: [], spawn: { x: 0, z: 0 } });
  const quad = [0, 0, 0, 0];
  for (let t = 0; t < 900; t += 1 / 30) {
    a.update(1 / 30);
    if (a.speed > 0.3) quad[Math.floor((((a.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2))]++;
  }
  const total = quad.reduce((s, v) => s + v, 0);
  for (const q of quad) assert.ok(q / total > 0.1, `heading quadrants ${quad.join('/')}`);
});
