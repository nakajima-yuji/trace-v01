// TRACE v0.2 — walk the forest, find traces, keep an observation log.
import * as THREE from 'three';
import { loadWorld } from './world.js';
import { createGrass } from './grass.js';
import { Water } from './water.js';
import { Footprints } from './footprints.js';
import { Props } from './props.js';
import { Audio3D } from './audio.js';
import { Player } from './player.js';
import { AnimalView } from './animalView.js';
import { AnimalTruth } from './truth.js';
import { Findings, FIND_INFO } from './findings.js';
import { TrampleField, traceForFootfall, judgeScan, SCAN, SURFACE } from './rules.js';
import { mulberry32 } from './rng.js';
import { runSelfTest } from './selftest.js';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const SEED = params.has('seed') ? Number(params.get('seed')) : (Math.random() * 1e9) | 0;
const rng = mulberry32(SEED);
if (params.has('seed')) Math.random = mulberry32(SEED ^ 0x9e3779b9); // Yuka wander jitter

const $ = id => document.getElementById(id);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the forest is almost static (shrubs sway a little): refresh shadows every 3rd frame
renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
let frameNo = 0;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa7b9a9);
scene.fog = new THREE.Fog(0xa7b9a9, 14, 55);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 140);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdcebe0, 0x2f3a2a, 1.55));
// low afternoon sun from the south-west: the meadow is lit, the mud trail sits in shade
const sunDir = new THREE.Vector3(-0.5, 0.48, 0.45).normalize();
const sun = new THREE.DirectionalLight(0xffe2b8, 2.3);
sun.position.copy(sunDir).multiplyScalar(35);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ---------- world & systems ----------
$('loading').textContent = 'Blender で作った森を読み込み中…';
const world = await loadWorld(scene);
const audio = new Audio3D();
const trample = new TrampleField(world.size, 160, 90);
const grass = createGrass(world, trample, rng);
scene.add(grass.mesh);
const water = new Water(scene, world.puddles, sunDir);
const prints = new Footprints(scene, world.props.Footprint, 900);
const stats = { prints: 0, mudPrints: 0, ripples: 0, snaps: 0, rustles: 0, sips: 0, events: 0, feeds: 0, rubs: 0, browses: 0 };
const props = new Props(world, (kind, x, y, z, who) => {
  if (who === 'animal') stats[kind === 'crack' ? 'snaps' : 'rustles']++;
  audio.play(kind, x, y, z);
});
const findings = new Findings(scene, world, { prints, trample, water, props, audio });

// places the animal uses face their find (the nut tree, the birch …)
const KIND_FIND = { rest: 'Bed', feed: 'Nuts', rub: 'Rub', browse: 'Browse', sip: 'Droppings' };
const pond = world.puddles.find(p => p.name === 'Pond');
const pois = world.pois.map(p => {
  // drink facing the water; elsewhere face the find (the nut tree, the birch, the browsed shrub)
  const f = p.kind === 'sip' ? pond : findings.spots[KIND_FIND[p.kind]];
  return { ...p, face: f && p.kind !== 'rest' ? Math.atan2(f.x - p.x, f.z - p.z) : null };
});
function spawnAnimal() {
  const far = pois.filter(p => Math.hypot(p.x - world.spawn.x, p.z - world.spawn.z) > 15);
  const p = far[Math.floor(rng() * far.length)] ?? { x: 0, z: 0 };
  return { x: p.x, z: p.z };
}
const truth = new AnimalTruth({
  rng, obstacles: world.obstacles, puddles: world.puddles, heightAt: world.heightAt, spawn: spawnAnimal(),
  trails: world.trails, pois, limit: world.size / 2 - 0.7, bounds: world.size / 2 - 1.5,
});
const animalView = new AnimalView(scene, world.animal, DEBUG);
const player = new Player(camera, document.body, world);

for (const p of world.puddles) if (p.name === 'Pond') audio.ambient('pond', p.x, p.y + 0.3, p.z);
if (world.meadow) audio.ambient('birds', world.meadow.x + 4, 6, world.meadow.z - 2);

// ---------- truth events → traces (the only path from the animal to the world) ----------
function applyEvents(events) {
  for (const e of events) {
    stats.events++;
    if (e.type === 'footfall') {
      const s = world.surfaceAt(e.x, e.z);
      const rule = { ...traceForFootfall(s.surface, e.speed), surface: s.surface };
      if (rule.print) {
        prints.add(s.point, s.normal, e.heading, rule); stats.prints++;
        if (s.surface === SURFACE.MUD) stats.mudPrints++;
      }
      if (rule.trample) trample.stamp(e.x, e.z, 0.2, rule.trample, Math.sin(e.heading), Math.cos(e.heading));
      if (rule.ripple && water.disturb(e.x, e.z, rule.ripple)) stats.ripples++;
      if (rule.sound) audio.play(rule.sound, e.x, s.point.y + 0.05, e.z);
      else if (s.surface === SURFACE.FLOOR) audio.play('step', e.x, s.point.y + 0.05, e.z);
      props.step(e.x, e.z, 'animal');
    } else if (e.type === 'sip') {
      if (water.disturb(e.x, e.z, 0.3)) { stats.sips++; audio.play('sip', e.x, world.heightAt(e.x, e.z) + 0.1, e.z); }
    } else if (e.type === 'feed' || e.type === 'rub' || e.type === 'browse') {
      stats[e.type + 's']++; findings.onEvent(e);
    } else if (e.type === 'state' && DEBUG) {
      log(`state: ${e.from} → ${e.to}`);
    }
  }
}
/** Continuous contact: brushing grass/shrubs while moving, hooves or the lying body pressing grass. */
function applyContact(dt) {
  const v = truth.vehicle.velocity, h = truth.heading;
  if (truth.speed > 0.1) {
    trample.stamp(truth.x, truth.z, 0.42, 0.8, Math.sin(h), Math.cos(h));
    props.brush(truth.x, truth.z, 0.35, v.x, v.z, dt, 'animal');
  } else if (truth.state === 'rest') {
    for (const off of [-0.3, 0, 0.3]) trample.stamp(truth.x + Math.sin(h) * off, truth.z + Math.cos(h) * off, 0.38, 0.95, Math.sin(h), Math.cos(h));
  } else {
    for (const f of truth.standingFeet()) trample.stamp(f.x, f.z, 0.2, 0.9, Math.sin(h), Math.cos(h));
  }
  findings.track(truth);
  pinBed();
}
/** An old, much-used bed: an oval of grass that never fully stands back up (no quiver unless it's used). */
function pinBed() {
  const b = findings.spots.Bed; if (!b) return;
  for (const [dx, dz] of [[0, 0], [0.4, 0.2], [-0.4, -0.2]]) trample.stamp(b.x + dx, b.z + dz, 0.55, 0.62, 0, 0, false);
}
function simulate(dt, playerInfo) {
  applyEvents(truth.update(dt, playerInfo));
  applyContact(dt);
}

// ---------- game modes ----------
// explore: no clock, no end; scanning is optional and only gives a glimpse.
// challenge: the v0.1 rules (3 scans, the round ends on a hit or when scans run out).
const game = { mode: 'explore', state: 'intro', scans: SCAN.MAX_SCANS, t: 0, result: null, scanLog: [], scanCooldown: 0, allFoundShown: false };

const markers = new THREE.Group(); scene.add(markers);
const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2);
function placeMarker(p, grade) {
  const color = grade === 'hit' ? 0x7dffb0 : grade === 'near' ? 0xffd166 : 0xff6b6b;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.copy(p).y += 0.05; ring.userData.t = 0; markers.add(ring);
}

function scanAt(x, z, point) {
  if (game.state !== 'play') return null;
  if (game.mode === 'challenge' && game.scans <= 0) return null;
  if (game.mode === 'explore' && game.scanCooldown > 0) { toast(`スキャンはまだ使えない（${Math.ceil(game.scanCooldown)} 秒）`); return null; }
  const j = judgeScan(x, z, truth.x, truth.z);
  game.scanLog.push({ x, z, ...j, t: game.t });
  audio.ping();
  placeMarker(point ?? new THREE.Vector3(x, world.heightAt(x, z), z), j.grade);
  if (game.mode === 'explore') {
    game.scanCooldown = 20;
    if (j.grade === 'hit') {
      animalView.glimpse(4);
      addEntry({ kind: 'sight', title: '姿を見た', x: truth.x, z: truth.z, t: game.t, area: findings.areaOf(truth.x, truth.z),
        note: 'ガラスのような体が一瞬だけ揺らいで見え、また消えた。', fresh: '' });
      toast('一瞬、ガラスのような輪郭が見えた…');
    } else toast(j.grade === 'near' ? '近い。すぐそばに気配がある。' : '気配はない。');
    return j;
  }
  game.scans--;
  if (j.grade === 'hit') finish(true, j);
  else if (game.scans === 0) finish(false, j);
  else toast(j.grade === 'near' ? `近い… 気配がある（${SCAN.NEAR}m 以内）。残り ${game.scans}` : `外れ。気配はない。残り ${game.scans}`);
  return j;
}
const centerRay = new THREE.Raycaster(); centerRay.far = 30; centerRay.firstHitOnly = true;
function scanFromCrosshair() {
  centerRay.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = world.pick(centerRay);
  if (!hit) { toast('地面を狙ってください（30m 以内）'); return; }
  scanAt(hit.point.x, hit.point.z, hit.point);
}
function finish(win, j) {
  game.state = 'over'; game.result = { win, dist: j.dist };
  animalView.reveal(); player.controls.unlock();
  $('result-title').textContent = win ? '捕捉成功' : '逃げられた';
  $('result-body').innerHTML = `
    <p>${win ? '痕跡から透明動物の位置を言い当てました。' : 'スキャンを使い切りました。透明動物の実位置を表示しています。'}</p>
    <table>
      <tr><td>経過時間</td><td>${clockText()}</td></tr>
      <tr><td>最終スキャンの誤差</td><td>${j.dist.toFixed(2)} m</td></tr>
      <tr><td>観察ノートの記録</td><td>${findings.entries.length} 件（手掛かり ${findings.found.size}/6）</td></tr>
    </table>
    <p class="dim">R で再挑戦</p>`;
  setTimeout(() => $('result').classList.add('show'), 1600);
}

// ---------- observation & notebook ----------
function addEntry(e) { findings.entries.push(e); renderNotebook(); }
function observe() {
  const e = findings.observe(camera, game.t);
  if (!e) { toast('特に変わったところはない'); return null; }
  if (e.duplicate) { toast(`もう記録してある：${e.title}`); return e; }
  renderNotebook();
  toast(e.kind === 'find' ? (e.first ? `手掛かりを見つけた：${e.title}` : `再観察：${e.title} — ${e.fresh}`) : `ノートに記録：${e.title}`);
  if (findings.found.size === 6 && !game.allFoundShown) {
    game.allFoundShown = true;
    setTimeout(() => toast('6つの手掛かりがそろった。でも森の痕跡は、いまも増え続けている。'), 3800);
  }
  return e;
}
function clockText(t = game.t) { return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; }
function renderNotebook() {
  const dots = Object.keys(FIND_INFO).map(k => findings.found.has(k) ? '●' : '○').join('');
  $('nb-count').textContent = `手掛かり ${dots}　記録 ${findings.entries.length} 件`;
  const list = [...findings.entries].reverse().map(e => `
    <li class="${e.kind}">
      <div class="nb-head"><b>${e.title}</b><span>${e.area}・${clockText(e.t)}</span></div>
      <p>${e.note}</p>
      ${e.fresh ? `<p class="nb-fresh">${e.fresh}</p>` : ''}
      ${e.hint ? `<p class="nb-hint">${e.hint}</p>` : ''}
    </li>`).join('');
  $('nb-list').innerHTML = list || '<li class="empty">まだ何も記録していない。足元をよく見て、気になったら F。</li>';
}
function toggleNotebook(force) {
  const el = $('notebook');
  const show = force ?? !el.classList.contains('show');
  el.classList.toggle('show', show);
  if (show) renderNotebook();
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').classList.add('show'); toastTimer = 3.5; }
function log(msg) { const el = $('debug-log'); if (el) el.textContent = (msg + '\n' + el.textContent).slice(0, 900); }
function updateHud() {
  const challenge = game.mode === 'challenge';
  $('hud').style.display = challenge ? '' : 'none';
  if (challenge) {
    $('scans').textContent = '◆'.repeat(game.scans) + '◇'.repeat(SCAN.MAX_SCANS - game.scans);
    $('clock').textContent = clockText();
  }
  const cand = game.state === 'play' && player.locked ? findings.candidate(camera) : null;
  $('prompt').classList.toggle('show', !!cand);
}

// optional sound-direction captions (accessibility), toggled with V
const soundViz = { on: params.has('captions'), items: [] };
const CAPTION = { crack: '枝が折れる音', squelch: '泥を踏む音', splash: '水を踏む音', rustle: '葉擦れ', step: '足音', tap: '石を蹴る音', sip: '水を舐める音', rub: '幹をこする音', crunch: '殻を噛む音', twig: '小枝を噛み切る音' };
audio.listeners.push((kind, x, y, z) => {
  const d = Math.hypot(x - camera.position.x, z - camera.position.z);
  const audible = { crack: 30, splash: 18, squelch: 12, rustle: 14, step: 6, tap: 9, sip: 5, rub: 14, crunch: 10, twig: 12 }[kind] ?? 10;
  if (d < audible) soundViz.items.push({ kind, x, z, t: 0 });
});
function drawSoundViz() {
  const c = $('soundviz'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  soundViz.items = soundViz.items.filter(it => it.t < 1.6);
  if (!soundViz.on) return;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  const yaw = Math.atan2(fwd.x, fwd.z);
  const cx = c.width / 2, cy = c.height / 2, R = c.width * 0.42;
  for (const it of soundViz.items) {
    const ang = Math.atan2(it.x - camera.position.x, it.z - camera.position.z) - yaw;
    const a = 1 - it.t / 1.6, sa = -Math.PI / 2 - ang;
    g.strokeStyle = `rgba(230,240,255,${a})`; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, R, sa - 0.18, sa + 0.18); g.stroke();
    g.fillStyle = `rgba(230,240,255,${a})`; g.font = '13px sans-serif'; g.textAlign = 'center';
    g.fillText(CAPTION[it.kind] ?? it.kind, cx + Math.cos(sa) * (R - 22), cy + Math.sin(sa) * (R - 22));
  }
}

// ---------- input ----------
function start(mode) {
  game.mode = mode; audio.start();
  // pointer lock can be refused (in-app/embedded browsers): fall back to drag-to-look
  document.addEventListener('pointerlockerror', () => {
    player.enableFallback(renderer.domElement); enterPlay();
    toast('この環境ではマウスを固定できません：左ドラッグで見回し、WASD で歩けます。');
  }, { once: true });
  player.controls.lock();
}
function enterPlay() {
  $('start').classList.remove('show'); $('pause').classList.remove('show'); toggleNotebook(false);
  if (game.state === 'intro') {
    game.state = 'play';
    toast(game.mode === 'explore' ? '森を歩いてみよう。気になる痕跡を見つけたら F で観察、Tab でノート。' : '痕跡を探せ。E / 右クリックで推理スキャン（3 回）');
  }
}
$('start-explore').addEventListener('click', e => { e.stopPropagation(); start('explore'); });
$('start-challenge').addEventListener('click', e => { e.stopPropagation(); start('challenge'); });
$('resume').addEventListener('click', () => { if (player.fallback === 'paused') { player.fallback = true; $('pause').classList.remove('show'); } else player.controls.lock(); });
player.controls.addEventListener('lock', enterPlay);
player.controls.addEventListener('unlock', () => {
  if (game.state === 'play' && !$('notebook').classList.contains('show')) $('pause').classList.add('show');
});
addEventListener('mousedown', e => { if (e.button === 2 && player.locked && game.mode === 'challenge') scanFromCrosshair(); });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.code === 'Tab') { e.preventDefault(); if (game.state !== 'intro') toggleNotebook(); return; }
  if (e.code === 'KeyR' && game.state === 'over') { location.reload(); return; }
  if (e.code === 'Escape' && player.fallback === true && game.state === 'play') { player.fallback = 'paused'; $('pause').classList.add('show'); return; }
  if (!player.locked) return;
  if (e.code === 'KeyF') observe();
  if (e.code === 'KeyE') scanFromCrosshair();
  if (e.code === 'KeyV') { soundViz.on = !soundViz.on; toast(soundViz.on ? '音の方向表示 ON' : '音の方向表示 OFF'); }
});

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (game.state === 'play' || game.state === 'over') {
    if (game.state === 'play' && player.locked) {
      game.t += dt; game.scanCooldown = Math.max(0, game.scanCooldown - dt);
      for (const s of player.update(dt)) {
        props.step(s.x, s.z, 'player');
        if (water.disturb(s.x, s.z, player.sprint ? 1.0 : 0.45)) audio.play('splash', s.x, camera.position.y - 1.5, s.z);
      }
      props.brush(player.pos.x, player.pos.z, 0.3, player.vel.x, player.vel.z, dt, 'player');
    }
    if (!TRACE.paused) simulate(dt, player.info());
  }
  grass.update(dt, t); water.update(dt); prints.update(dt); props.update(dt); findings.update(dt);
  animalView.update(dt, truth, truth.y);
  for (const m of markers.children) {
    m.userData.t += dt; const k = Math.min(1, m.userData.t / 1.4);
    m.scale.setScalar(0.3 + k * 1.3); m.material.opacity = 1 - k;
  }
  audio.setListener(camera);
  if ((toastTimer -= dt) <= 0) $('toast').classList.remove('show');
  for (const it of soundViz.items) it.t += dt;
  drawSoundViz(); updateHud();
  if (DEBUG) $('debug').textContent = `truth x=${truth.x.toFixed(2)} z=${truth.z.toFixed(2)} state=${truth.state} speed=${truth.speed.toFixed(2)}\ngoal=${truth.goal?.kind ?? '-'} route=${(truth.route ?? []).join('>')}\nfps ${fps} grass ${grass.count} prints ${prints.total}`;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (++frameNo % 3 === 0) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- test / automation hooks ----------
const TRACE = window.TRACE = {
  THREE, scene, camera, renderer, world, truth, trample, water, prints, props, stats, game, player, grass, animalView, findings,
  paused: false, seed: SEED,
  get fps() { return fps; },
  simulate, applyEvents, scanAt, finish, observe, renderNotebook, toggleNotebook,
  begin(mode = 'explore') { game.mode = mode; game.state = 'play'; $('start').classList.remove('show'); },
  fastForward(seconds, dt = 1 / 30, playerInfo = player.info()) {
    for (let s = 0; s < seconds; s += dt) {
      simulate(dt, playerInfo); grass.update(dt, s); water.update(dt); prints.update(dt); props.update(dt); findings.update(dt);
      animalView.update(dt, truth, truth.y);
      game.t += dt; game.scanCooldown = Math.max(0, game.scanCooldown - dt);
    }
  },
  lookAt(x, y, z, fromX, fromY, fromZ) {
    camera.position.set(fromX, fromY, fromZ); camera.lookAt(x, y, z); player.pos.set(fromX, 0, fromZ);
  },
};

$('loading').remove();
$('start').classList.add('show');
renderNotebook(); updateHud();
requestAnimationFrame(frame);
if (params.has('selftest')) runSelfTest(TRACE).then(r => { window.TRACE_TEST = r; });
