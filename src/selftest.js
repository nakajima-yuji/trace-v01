// In-browser end-to-end checks (?selftest=1). Drives the truth with scripted moves and
// verifies that every trace channel responds through the real rendering systems.
import { SURFACE } from './rules.js';
import { localToWorld } from './gait.js';

export async function runSelfTest(T) {
  const { truth, world, stats, trample, water, props } = T;
  const results = [];
  const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
  const far = { x: 0, z: -100, mode: 'still' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  T.begin(); T.paused = true;

  const clearOf = (x, z, m = 0.6) => !world.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + m);
  function walk(ax, az, bx, bz, speed = 0.75, timeout = 40) {
    truth.place(ax, az, Math.atan2(bx - ax, bz - az));
    truth.scriptMoveTo(bx, bz, speed);
    for (let t = 0; t < timeout; t += 0.5) {
      T.fastForward(0.5, 1 / 30, far);
      if (Math.hypot(truth.x - bx, truth.z - bz) < 0.4) return true;
    }
    return false;
  }

  // 1. mud → deep footprints
  {
    const m = world.muds[3]; m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, r = (bb.max.x - bb.min.x) / 2 * 0.7;
    const before = stats.mudPrints;
    walk(cx - r, cz, cx + r, cz);
    ok('泥を歩くと深い足跡が残る', stats.mudPrints - before >= 3, `泥の足跡 +${stats.mudPrints - before}`);
  }
  // 2. puddle → ripples
  {
    const p = world.puddles[0];
    const before = stats.ripples;
    walk(p.x - p.r - 0.8, p.z, p.x + p.r + 0.8, p.z);
    const e = water.energy();
    ok('水たまりを通ると波紋が生まれる', stats.ripples - before >= 2 && e > 0.01, `波紋 +${stats.ripples - before}, energy ${e.toFixed(3)}`);
  }
  // 3. grass → bent path that recovers over time
  {
    let seg = null;
    for (let z = -12; z < 12 && !seg; z += 0.7) for (let x = -12; x < 8 && !seg; x += 0.7) {
      const pts = [0, 1, 2, 3, 4].map(k => [x + k, z]);
      if (pts.every(([px, pz]) => world.surfaceAt(px, pz).surface === SURFACE.GRASS && clearOf(px, pz, 1.0))) seg = [x, z];
    }
    if (!seg) ok('草地を歩くと草が倒れる', false, '草地の区間が見つからない');
    else {
      walk(seg[0], seg[1], seg[0] + 4, seg[1]);
      const band = () => Math.max(...[-0.3, -0.15, 0, 0.15, 0.3].map(dz => trample.sample(seg[0] + 2, seg[1] + dz)));
      const mid = band();
      T.fastForward(25, 1 / 15, { ...far });
      const later = band();
      ok('草地を歩くと草が倒れる', mid > 0.3, `直後の倒れ量 ${mid.toFixed(2)}`);
      ok('倒れた草は時間で起き上がる（鮮度の手掛かり）', later < mid && later > 0, `25秒後 ${later.toFixed(2)}`);
      // 5. standing animal pins grass under its hooves
      truth.place(seg[0] + 2, seg[1] + 0.0, 0); truth.scriptStop();
      T.fastForward(60, 1 / 15, far);
      const feet = truth.standingFeet().map(f => trample.sample(f.x, f.z));
      ok('立ち止まった動物の蹄の下の草は戻らない', Math.min(...feet) > 0.5, `蹄の下 ${feet.map(v => v.toFixed(2)).join('/')}`);
    }
  }
  // 4. branch → snap when a hoof lands on it
  {
    const br = props.branches.find(b => !b.snapped && clearOf((b.ax + b.bx) / 2, (b.az + b.bz) / 2, 1.2));
    const h = Math.atan2(br.bx - br.ax, br.bz - br.az);
    // body path shifted so the left hooves (+0.10 local x) tread on the branch line
    const a = localToWorld(-0.10, -1.2, br.ax, br.az, h), b = localToWorld(-0.10, 1.2, br.bx, br.bz, h);
    const before = stats.snaps;
    walk(a.x, a.z, b.x, b.z, 0.6);
    ok('枝を踏むと折れる（音源）', stats.snaps > before, `折れた枝 +${stats.snaps - before}`);
  }
  // 6. live behaviour + frame rate
  truth.release(); T.paused = false;
  await wait(1500);
  {
    // rAF is throttled when the tab is hidden, so time synchronous frames instead
    const { renderer, scene, camera } = T, gl = renderer.getContext(), px = new Uint8Array(4);
    camera.position.set(0, T.world.heightAt(0, 12.5) + 1.62, 12.5); camera.lookAt(0, 0.5, 0);
    for (let i = 0; i < 5; i++) renderer.render(scene, camera);
    const t0 = performance.now(), N = 40;
    for (let i = 0; i < N; i++) { T.fastForward(1 / 60, 1 / 60, far); renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    const ms = (performance.now() - t0) / N;
    ok('1フレームの処理時間（シミュレーション＋描画）', ms < 33, `${ms.toFixed(1)} ms ≈ ${(1000 / ms).toFixed(0)} fps @ ${renderer.domElement.width}x${renderer.domElement.height}`);
  }
  // 7. scan judgement against the truth
  {
    const fx = Math.max(-14, Math.min(14, truth.x + 6));
    const miss = T.scanAt(fx, truth.z);
    ok('外れたスキャンは失敗判定', miss && miss.grade !== 'hit', miss ? `${miss.grade} ${miss.dist.toFixed(2)}m` : 'none');
    const hit = T.scanAt(truth.x + 0.6, truth.z - 0.4);
    ok('実位置近くのスキャンは成功判定', hit && hit.grade === 'hit' && T.game.result?.win, hit ? `${hit.grade} ${hit.dist.toFixed(2)}m` : 'none');
  }
  const pass = results.filter(r => r.pass).length;
  const el = document.getElementById('selftest');
  el.innerHTML = `<b>SELFTEST ${pass}/${results.length}</b><br>` + results.map(r => `${r.pass ? '✔' : '✘'} ${r.name} — ${r.detail}`).join('<br>');
  el.style.display = 'block';
  return { pass, total: results.length, results };
}
