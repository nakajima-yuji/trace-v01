import test from 'node:test';
import assert from 'node:assert/strict';
import { AnimalTruth, ST } from '../src/truth.js';
import { mulberry32 } from '../src/rng.js';

// v0.2 trail graph (Blender x,y → three.js x, -y), same data as the Trail_/POI_ empties in forest_v02.glb
const N = { N0: [0, -17], N1: [-3, -12], N2: [-8, -8], N3: [-12, -3], N4: [-11, 3], N5: [-7, 8], N6: [-1, 11], N7: [5, 13],
  N8: [10, 9], N9: [15.5, 3.5], N9b: [14, -5], N10: [8.2, -3.2], N11: [6, -9], N12: [3, -13], N13: [1, -3], N14: [1, 5] };
const E = [['N0', 'N1'], ['N1', 'N2'], ['N2', 'N3'], ['N3', 'N4'], ['N4', 'N5'], ['N5', 'N6'], ['N6', 'N7'], ['N7', 'N8'], ['N8', 'N9'],
  ['N9', 'N9b'], ['N9b', 'N10'], ['N10', 'N11'], ['N11', 'N12'], ['N12', 'N1'], ['N1', 'N13'], ['N13', 'N14'], ['N14', 'N6'], ['N13', 'N10']];
const trails = Object.entries(N).map(([id, [x, y]]) => ({
  id, x, z: -y, links: E.filter(e => e.includes(id)).map(e => e[0] === id ? e[1] : e[0]) }));
const P = { rest: [[6.2, 14.2], 'N7'], feed: [[-3.4, 13.2], 'N6'], sip: [[9.0, -2.4], 'N10'], rub: [[15.4, 4.9], 'N9'], browse: [[-12.5, -1.6], 'N3'] };
const pois = Object.entries(P).map(([kind, [[x, y], node]]) => ({ kind, x, z: -y, node }));
const segDist = (px, pz, a, b) => {
  const vx = b.x - a.x, vz = b.z - a.z, t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
};
const byId = Object.fromEntries(trails.map(t => [t.id, t]));
const trailDist = (x, z) => Math.min(...E.map(([a, b]) => segDist(x, z, byId[a], byId[b])));

function sim(seconds, seed = 1) {
  Math.random = mulberry32(seed * 31);
  const a = new AnimalTruth({ rng: mulberry32(seed), trails, pois, puddles: [], limit: 19, bounds: 18.5, spawn: { x: 0, z: 0 } });
  const log = { states: new Set(), events: {}, travelOn: 0, travelAll: 0, routes: 0 };
  for (let t = 0; t < seconds; t += 1 / 30) {
    for (const e of a.update(1 / 30)) {
      log.events[e.type] = (log.events[e.type] ?? 0) + 1;
      if (e.type === 'state') { log.states.add(e.to); if (e.to === ST.TRAVEL) log.routes++; }
    }
    if (a.state === ST.TRAVEL && a.speed > 0.2) { log.travelAll++; if (trailDist(a.x, a.z) < 1.2) log.travelOn++; }
  }
  return { a, log };
}

test('v0.2: the animal travels between its places along the game trails (Yuka A* + FollowPath)', () => {
  const { log } = sim(900);
  assert.ok(log.routes >= 5, `routes ${log.routes}`);
  const onTrail = log.travelOn / log.travelAll;
  assert.ok(onTrail > 0.8, `on-trail while travelling ${(onTrail * 100).toFixed(0)}%`);
});

test('v0.2: it uses at least four kinds of places and leaves activity events behind', () => {
  const kinds = new Set(); const ev = {};
  for (const seed of [1, 2, 3]) {
    const { log } = sim(900, seed);
    for (const k of [ST.REST, ST.FEED, ST.RUB, ST.BROWSE, ST.SIP]) if (log.states.has(k)) kinds.add(k);
    for (const [k, v] of Object.entries(log.events)) ev[k] = (ev[k] ?? 0) + v;
  }
  assert.ok(kinds.size >= 4, [...kinds].join(','));
  assert.ok(ev.feed > 0 && ev.sip > 0, JSON.stringify(ev));
});

test('v0.2: A* route follows graph edges', () => {
  const { a } = sim(1);
  a.place(0, 17); a.goal = pois.find(p => p.kind === 'rest'); a.planRoute(a.goal);
  for (let i = 1; i < a.route.length; i++) {
    const [x, y] = [a.route[i - 1], a.route[i]];
    assert.ok(E.some(e => e.includes(x) && e.includes(y)), `${x}-${y} is an edge`);
  }
  assert.equal(a.route[0], 'N0'); assert.equal(a.route.at(-1), 'N7');
});
