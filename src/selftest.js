// In-browser end-to-end checks (?selftest=1) for v0.2. Drives the truth with scripted moves and
// activities, and verifies traces, finds and the observation log through the real systems.
import { SURFACE } from './rules.js';
import { ST } from './truth.js';

export async function runSelfTest(T) {
  const { truth, world, stats, trample, water, findings } = T;
  const results = [];
  const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
  const far = { x: 0, z: -100, mode: 'still' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  T.begin('explore'); T.paused = true;
  const node = id => world.trails.find(t => t.id === id);

  function walk(ax, az, bx, bz, speed = 0.75, timeout = 40) {
    truth.place(ax, az, Math.atan2(bx - ax, bz - az));
    truth.scriptMoveTo(bx, bz, speed);
    for (let t = 0; t < timeout; t += 0.5) {
      T.fastForward(0.5, 1 / 30, far);
      if (Math.hypot(truth.x - bx, truth.z - bz) < 0.4) return true;
    }
    return false;
  }
  /** Put the camera ~1.4 m from a point, at crouch height, looking at it. */
  function lookFrom(p, yOff = 0.1, dist = 1.4, ang = 0.6) {
    const x = p.x + Math.sin(ang) * dist, z = p.z + Math.cos(ang) * dist;
    T.lookAt(p.x, p.y + yOff, p.z, x, world.heightAt(x, z) + 1.0, z);
  }

  // 0. simplified controls: one hint at a time, click to observe, look down to lean in
  {
    T.player.enableFallback(T.renderer.domElement); // the pane refuses pointer lock: drag-to-look path
    const hintText = () => document.getElementById('hint').classList.contains('show') ? document.getElementById('hint').textContent : '';
    T.updateHints(0.1);
    const h1 = hintText();
    T.hints.walked = 5; T.updateHints(0.1);
    const bed = findings.spots.Bed;
    lookFrom(bed, 0.05); T.hints.check = 0; T.updateHints(0.1);
    const h2 = document.getElementById('prompt').classList.contains('show') || T.findings.candidate(T.camera) ? 'クリックで観察（照準の横）' : hintText();
    const c = T.renderer.domElement, r = c.getBoundingClientRect(), at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true };
    c.dispatchEvent(new MouseEvent('mousedown', { ...at, button: 0 }));
    window.dispatchEvent(new MouseEvent('mouseup', { ...at, button: 0 }));
    const clicked = findings.found.has('Bed');
    T.updateHints(0.1); T.updateHints(0.1);
    const h3 = hintText();
    ok('操作のヒントは必要なときに 1 つずつ', h1.includes('WASD') && h2.includes('クリック') && h3.includes('Tab'), `「${h1}」→「${h2}」→「${h3}」`);
    ok('クリックで観察してノートに記録できる', clicked, clicked ? '寝床を記録' : '記録されない');
    const p = T.player, fov0 = T.camera.fov;
    T.camera.lookAt(T.camera.position.x, T.camera.position.y - 5, T.camera.position.z - 0.5);
    for (let i = 0; i < 20; i++) p.update(0.1);
    const fov1 = T.camera.fov;
    T.camera.lookAt(T.camera.position.x, T.camera.position.y, T.camera.position.z - 5);
    for (let i = 0; i < 20; i++) p.update(0.1);
    ok('足元を見下ろすと近寄って見える（しゃがみキー不要）', fov1 < 58 && T.camera.fov > 70, `視野 ${fov0.toFixed(0)}° → 見下ろし ${fov1.toFixed(0)}° → 前方 ${T.camera.fov.toFixed(0)}°`);
    T.toggleNotebook(false);
  }
  ok('3 つの探索エリア', world.zones.length === 3, world.zones.map(z => z.label).join(' / '));
  ok('発見対象が 6 つある', Object.keys(world.finds).length === 6, Object.keys(world.finds).join(', '));
  ok('獣道のグラフ', world.trails.length >= 12 && world.pois.length === 5, `ノード ${world.trails.length}・場所 ${world.pois.length}`);

  // 1. the mud trail keeps clear hoof prints
  {
    const a = node('N2'), b = node('N3'), before = stats.mudPrints;
    walk(a.x, a.z, b.x, b.z);
    ok('泥の小道を歩くと蹄跡が残る', stats.mudPrints - before >= 4, `泥の足跡 +${stats.mudPrints - before}`);
  }
  // 2. the pond
  {
    const p = world.puddles.find(q => q.name === 'Pond'), poi = world.pois.find(q => q.kind === 'sip'), before = stats.ripples;
    walk(poi.x + (poi.x - p.x) * 0.4, poi.z + (poi.z - p.z) * 0.4, p.x + (poi.x - p.x) * 0.55, p.z + (poi.z - p.z) * 0.55);
    ok('池のほとりで水に入ると波紋が生まれる', stats.ripples - before >= 2 && water.energy() > 0.01, `波紋 +${stats.ripples - before}`);
  }
  // 3. the meadow: bent and still-quivering grass
  {
    const m = world.meadow;
    walk(m.x - 3, m.z + 0.5, m.x + 1, m.z - 0.5);
    const band = f => Math.max(...[-0.3, 0, 0.3].map(dz => f(m.x - 1, m.z + dz)));
    const bend = band((x, z) => trample.sample(x, z)), quiver = band((x, z) => trample.sampleAgitation(x, z));
    ok('草むらを通ると草が倒れる', bend > 0.3, `倒れ量 ${bend.toFixed(2)}`);
    ok('通った直後の草はまだ揺れている（新しさの手掛かり）', quiver > 0.05, `揺れ ${quiver.toFixed(2)}`);
  }
  // 4. places the animal uses: resting in the bed, feeding at the nut tree
  for (const [kind, key] of [[ST.REST, 'Bed'], [ST.FEED, 'Nuts']]) {
    const poi = world.pois.find(q => q.kind === kind);
    truth.scripted = false; truth.goal = { ...poi, face: null }; truth.place(poi.x, poi.z); truth.fsm.changeTo(kind);
    const shellsBefore = findings.shells.length;
    T.fastForward(12, 1 / 15, far);
    const age = T.game.t - (findings.lastVisit[key] ?? -1e9);
    if (kind === ST.REST) ok('寝床で休むと、寝床の草が押さえられる', trample.sample(poi.x, poi.z) > 0.5, `草 ${trample.sample(poi.x, poi.z).toFixed(2)}`);
    else ok('木の実を食べると新しい殻が落ちる', findings.shells.length > shellsBefore, `新しい殻 +${findings.shells.length - shellsBefore}`);
    ok(`「${key}」の新しさが真値の行動から決まる`, age < 2, `最終利用から ${age.toFixed(1)} 秒`);
  }
  truth.scriptStop();
  // 5. every find can be observed and logged
  {
    let logged = 0; const miss = [];
    for (const [k, p] of Object.entries(findings.spots)) {
      lookFrom(p, k === 'Rub' ? 0.7 : 0.05);
      const e = T.observe();
      if (e && e.kind === 'find' && e.key === k) logged++; else miss.push(k);
    }
    ok('6 つの発見対象をすべて観察・記録できる', logged === 6, miss.length ? `未検出: ${miss.join(',')}` : `記録 ${findings.found.size}/6`);
    const bed = findings.entries.find(e => e.key === 'Bed');
    ok('寝床の記録に新しさが書かれる', bed && bed.fresh.includes('今しがた'), bed?.fresh);
  }
  // 6. a live trace can be logged too
  {
    const a = node('N3'), b = node('N4');
    walk(a.x, a.z, b.x, b.z);
    const rec = T.prints.records.filter(Boolean).filter(r => r.surface === SURFACE.MUD).sort((x, y) => x.age - y.age)[0];
    const y = world.heightAt(rec.x, rec.z);
    T.lookAt(rec.x, y, rec.z, rec.x + 0.8, y + 1.0, rec.z + 0.8);
    const e = T.observe();
    ok('目の前の蹄跡を記録できる', e && e.kind === 'print', e ? e.note : 'none');
  }
  // 7. explore-mode scan: optional, never ends the game
  {
    truth.release(); T.game.scanCooldown = 0;
    const miss = T.scanAt(Math.max(-19, truth.x + 7), truth.z);
    T.game.scanCooldown = 0;
    const hit = T.scanAt(truth.x + 0.4, truth.z);
    const blocked = T.scanAt(truth.x, truth.z);
    ok('自由探索のスキャンはゲームを終わらせない', T.game.state === 'play' && miss && hit?.grade === 'hit' && blocked === null,
      `外れ ${miss?.grade} → 当たり ${hit?.grade} → 直後は ${blocked === null ? 'クールダウン' : '使えてしまう'}`);
  }
  // 8. frame time
  T.paused = false;
  await wait(1200);
  {
    const { renderer, scene, camera } = T, gl = renderer.getContext(), px = new Uint8Array(4);
    const s = world.spawn;
    camera.position.set(s.x, world.heightAt(s.x, s.z) + 1.62, s.z); camera.lookAt(s.x, 1, s.z - 10);
    for (let i = 0; i < 5; i++) renderer.render(scene, camera);
    // pipelined like the real loop (sync once at the end; rAF is throttled while the pane is hidden)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now(), N = 45;
    for (let i = 0; i < N; i++) {
      T.fastForward(1 / 60, 1 / 60, far);
      if (i % 3 === 0) renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / N;
    ok('1 フレームの処理時間（シミュレーション＋描画）', ms < 33, `${ms.toFixed(1)} ms ≈ ${(1000 / ms).toFixed(0)} fps @ ${renderer.domElement.width}x${renderer.domElement.height}・草 ${T.grass.count}`);
  }
  const pass = results.filter(r => r.pass).length;
  const el = document.getElementById('selftest');
  el.innerHTML = `<b>SELFTEST ${pass}/${results.length}</b><br>` + results.map(r => `${r.pass ? '✔' : '✘'} ${r.name} — ${r.detail}`).join('<br>');
  el.style.display = 'block';
  return { pass, total: results.length, results };
}
