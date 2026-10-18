import test from 'node:test';
import assert from 'node:assert/strict';
import { footfallsBetween, footWorld, LEGS, localToWorld } from '../src/gait.js';
import { traceForFootfall, SURFACE, judgeScan, printAlpha, TrampleField, RippleField } from '../src/rules.js';

test('gait: diagonal pairs touch down half a cycle apart', () => {
  assert.deepEqual(footfallsBetween(0.9, 1.05).map(l => l.id).sort(), ['BR', 'FL']);
  assert.deepEqual(footfallsBetween(0.4, 0.55).map(l => l.id).sort(), ['BL', 'FR']);
  assert.equal(footfallsBetween(0.1, 0.3).length, 0);
  assert.equal(footfallsBetween(0, 3).length, 12);
});

test('gait: local→world respects heading (+Z forward, +X left)', () => {
  const f = localToWorld(0, 1, 0, 0, Math.PI / 2); // facing +X
  assert.ok(Math.abs(f.x - 1) < 1e-9 && Math.abs(f.z) < 1e-9);
  const fl = footWorld(LEGS[0], 0, 0, 0), fr = footWorld(LEGS[2], 0, 0, 0);
  assert.ok(fl.x > 0 && fr.x < 0 && fl.z > 0.5);
});

test('surface rules: mud prints deep and long-lived, water gives ripples not prints, grass bends', () => {
  const mud = traceForFootfall(SURFACE.MUD, 0.7), water = traceForFootfall(SURFACE.WATER, 0.7), grass = traceForFootfall(SURFACE.GRASS, 0.7);
  assert.ok(mud.print && mud.life > grass.life && mud.opacity > grass.opacity);
  assert.ok(!water.print && water.ripple > 0);
  assert.ok(grass.trample > 0.5);
  assert.ok(traceForFootfall(SURFACE.WATER, 3).ripple > water.ripple, 'running splashes harder');
});

test('print alpha fades monotonically to zero', () => {
  let last = 2;
  for (let a = 0; a <= 100; a += 5) { const v = printAlpha(a, 100); assert.ok(v <= last); last = v; }
  assert.equal(printAlpha(100, 100), 0);
});

test('scan judgement thresholds', () => {
  assert.equal(judgeScan(0, 0, 1, 1).grade, 'hit');
  assert.equal(judgeScan(0, 0, 3, 0).grade, 'near');
  assert.equal(judgeScan(0, 0, 10, 0).grade, 'far');
});

test('trample field: stamp bends, decays back over the recovery time', () => {
  const t = new TrampleField(30, 128, 50);
  t.stamp(2, 3, 0.5, 1, 0, 1);
  assert.ok(t.sample(2, 3) > 0.9);
  assert.equal(t.sample(-5, -5), 0);
  t.decay(25); assert.ok(Math.abs(t.sample(2, 3) - 0.5) < 0.1, 'half recovered after half the time');
  t.decay(30); assert.equal(t.sample(2, 3), 0);
});

test('ripple field: disturbance propagates outward and damps', () => {
  const r = new RippleField(64, 0.98);
  r.disturb(0.5, 0.5, 1);
  const e0 = r.energy();
  const ring = () => Math.abs(r.cur[32 * 64 + 44]);
  let seen = 0;
  for (let i = 0; i < 40; i++) { r.step(); seen = Math.max(seen, ring()); }
  assert.ok(seen > 1e-3, 'wave reached 12 cells away');
  for (let i = 0; i < 600; i++) r.step();
  assert.ok(r.energy() < e0 * 0.05, 'energy damped');
});

test('trample field: fresh contact quivers briefly (spring recovery), then only the bend remains', () => {
  const t = new TrampleField(40, 160, 90);
  t.stamp(0, 0, 0.4, 0.8, 1, 0);
  assert.ok(t.sampleAgitation(0, 0) > 0.7);
  t.decay(6);
  assert.ok(t.sampleAgitation(0, 0) < 0.02, 'quiver gone after 6 s');
  assert.ok(t.sample(0, 0) > 0.55, 'bend still there');
});
