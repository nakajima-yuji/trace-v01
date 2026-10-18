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
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb3a6);
scene.fog = new THREE.Fog(0x9fb3a6, 10, 42);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdcebe0, 0x2f3a2a, 1.6));
const sunDir = new THREE.Vector3(-0.55, 0.42, -0.35).normalize();
const sun = new THREE.DirectionalLight(0xffe2b8, 2.3);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 70 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// ---------- world & systems ----------
$('loading').textContent = 'Blender アセットを読み込み中…';
const world = await loadWorld(scene);
const audio = new Audio3D();
const trample = new TrampleField(30, 128, 90);
const grass = createGrass(world, trample, rng);
scene.add(grass.mesh);
const water = new Water(scene, world.puddles, sunDir);
const prints = new Footprints(scene, world.props.Footprint);
const stats = { prints: 0, mudPrints: 0, ripples: 0, snaps: 0, rustles: 0, sips: 0, events: 0 };
const props = new Props(world, (kind, x, y, z, who) => {
  if (who === 'animal') stats[kind === 'crack' ? 'snaps' : 'rustles']++;
  audio.play(kind, x, y, z);
});

function spawnPoint() {
  for (let i = 0; i < 200; i++) {
    const x = (rng() - 0.5) * 24, z = (rng() - 0.5) * 24;
    if (Math.hypot(x - 0, z - 12.5) < 13) continue;
    if (world.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 0.8)) continue;
    return { x, z };
  }
  return { x: 0, z: -8 };
}
const truth = new AnimalTruth({ rng, obstacles: world.obstacles, puddles: world.puddles, heightAt: world.heightAt, spawn: spawnPoint() });
const animalView = new AnimalView(scene, world.animal, DEBUG);
const player = new Player(camera, document.body, world);

// ---------- truth events → traces (the only path from the animal to the world) ----------
function applyEvents(events) {
  for (const e of events) {
    stats.events++;
    if (e.type === 'footfall') {
      const s = world.surfaceAt(e.x, e.z);
      const rule = traceForFootfall(s.surface, e.speed);
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
    } else if (e.type === 'state' && DEBUG) {
      log(`state: ${e.from} → ${e.to}`);
    }
  }
}

/** Continuous contact: body brushing grass/shrubs while moving, hooves pinning grass while standing. */
function applyContact(dt) {
  const v = truth.vehicle.velocity;
  if (truth.speed > 0.1) {
    trample.stamp(truth.x, truth.z, 0.42, 0.8, Math.sin(truth.heading), Math.cos(truth.heading));
    props.brush(truth.x, truth.z, 0.35, v.x, v.z, dt, 'animal');
  } else {
    for (const f of truth.standingFeet()) trample.stamp(f.x, f.z, 0.2, 0.9, Math.sin(truth.heading), Math.cos(truth.heading));
  }
}

function simulate(dt, playerInfo) {
  applyEvents(truth.update(dt, playerInfo));
  applyContact(dt);
}

// ---------- scan / judgement ----------
const game = { state: 'intro', scans: SCAN.MAX_SCANS, t: 0, result: null, scanLog: [] };
const markers = new THREE.Group(); scene.add(markers);
const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48).rotateX(-Math.PI / 2);
const stakeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6).translate(0, 0.45, 0);

function placeMarker(p, grade) {
  const color = grade === 'hit' ? 0x7dffb0 : grade === 'near' ? 0xffd166 : 0xff6b6b;
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.copy(p).y += 0.05; ring.userData.t = 0; markers.add(ring);
  const stake = new THREE.Mesh(stakeGeo, new THREE.MeshLambertMaterial({ color })); stake.position.copy(p); markers.add(stake);
}

function scanAt(x, z, point) {
  if (game.state !== 'play' || game.scans <= 0) return null;
  game.scans--;
  const j = judgeScan(x, z, truth.x, truth.z);
  game.scanLog.push({ x, z, ...j, t: game.t });
  audio.ping();
  placeMarker(point ?? new THREE.Vector3(x, world.heightAt(x, z), z), j.grade);
  if (j.grade === 'hit') finish(true, j);
  else if (game.scans === 0) finish(false, j);
  else toast(j.grade === 'near' ? `近い… 気配がある（${SCAN.NEAR}m 以内）。残り ${game.scans}` : `外れ。気配はない。残り ${game.scans}`);
  updateHud();
  return j;
}

const centerRay = new THREE.Raycaster(); centerRay.far = 30; centerRay.firstHitOnly = true;
function scanFromCrosshair() {
  centerRay.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = world.pick(centerRay);
  if (!hit) { toast('地面を狙ってスキャンしてください（30m 以内）'); return; }
  scanAt(hit.point.x, hit.point.z, hit.point);
}

function finish(win, j) {
  game.state = 'over'; game.result = { win, dist: j.dist };
  animalView.reveal();
  player.controls.unlock();
  const mm = Math.floor(game.t / 60), ss = String(Math.floor(game.t % 60)).padStart(2, '0');
  $('result-title').textContent = win ? '捕捉成功' : '逃げられた';
  $('result-body').innerHTML = `
    <p>${win ? '痕跡だけで透明動物の位置を言い当てました。' : '3 回のスキャンを使い切りました。透明動物の実位置を表示しています。'}</p>
    <table>
      <tr><td>経過時間</td><td>${mm}:${ss}</td></tr>
      <tr><td>最終スキャンの誤差</td><td>${j.dist.toFixed(2)} m</td></tr>
      <tr><td>使ったスキャン</td><td>${SCAN.MAX_SCANS - game.scans} / ${SCAN.MAX_SCANS}</td></tr>
      <tr><td>残された足跡（うち泥）</td><td>${stats.prints}（${stats.mudPrints}）</td></tr>
      <tr><td>波紋 / 水を飲んだ回数</td><td>${stats.ripples} / ${stats.sips}</td></tr>
      <tr><td>折れた枝 / 揺れた低木</td><td>${stats.snaps} / ${stats.rustles}</td></tr>
    </table>
    <p class="dim">シード ${SEED}・R で再挑戦（同じシードは ?seed=${SEED}）</p>`;
  setTimeout(() => $('result').classList.add('show'), 1600);
}

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').classList.add('show'); toastTimer = 3.5; }
function log(msg) { const el = $('debug-log'); if (el) el.textContent = (msg + '\n' + el.textContent).slice(0, 900); }
function updateHud() {
  $('scans').textContent = '◆'.repeat(game.scans) + '◇'.repeat(SCAN.MAX_SCANS - game.scans);
  const mm = Math.floor(game.t / 60), ss = String(Math.floor(game.t % 60)).padStart(2, '0');
  $('clock').textContent = `${mm}:${ss}`;
  $('mode').textContent = { still: '静止', crouch: 'しゃがみ歩き（静か）', walk: '歩き', sprint: '走り（うるさい）' }[player.mode] + (player.crouch && player.mode === 'still' ? '・しゃがみ' : '');
}

// optional sound-direction captions (accessibility), toggled with V
const soundViz = { on: params.has('captions'), items: [] };
const CAPTION = { crack: '枝が折れる音', squelch: '泥を踏む音', splash: '水を踏む音', rustle: '葉擦れ', step: '足音', tap: '石を蹴る音', sip: '水を舐める音' };
audio.listeners.push((kind, x, y, z) => {
  const d = Math.hypot(x - camera.position.x, z - camera.position.z);
  const audible = { crack: 30, splash: 18, squelch: 12, rustle: 14, step: 6, tap: 9, sip: 5 }[kind] ?? 10;
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
    const ang = Math.atan2(it.x - camera.position.x, it.z - camera.position.z) - yaw; // 0 = straight ahead
    const a = 1 - it.t / 1.6;
    g.strokeStyle = `rgba(230,240,255,${a})`; g.lineWidth = 5;
    const screenAng = -Math.PI / 2 - ang;
    g.beginPath(); g.arc(cx, cy, R, screenAng - 0.18, screenAng + 0.18); g.stroke();
    g.fillStyle = `rgba(230,240,255,${a})`; g.font = '13px sans-serif'; g.textAlign = 'center';
    g.fillText(CAPTION[it.kind] ?? it.kind, cx + Math.cos(screenAng) * (R - 22), cy + Math.sin(screenAng) * (R - 22));
  }
}

// ---------- input ----------
$('start').addEventListener('click', () => { audio.start(); player.controls.lock(); });
player.controls.addEventListener('lock', () => {
  $('start').classList.remove('show');
  if (game.state === 'intro') { game.state = 'play'; toast('痕跡を探せ。右クリック / E で推理スキャン'); }
});
player.controls.addEventListener('unlock', () => { if (game.state === 'play') $('start').classList.add('show'); });
addEventListener('mousedown', e => { if (e.button === 2 && player.locked) scanFromCrosshair(); });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.code === 'KeyE' && player.locked) scanFromCrosshair();
  if (e.code === 'KeyV') { soundViz.on = !soundViz.on; toast(soundViz.on ? '音の方向表示 ON' : '音の方向表示 OFF'); }
  if (e.code === 'KeyR' && game.state === 'over') location.reload();
});

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fps = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (game.state === 'play' || game.state === 'over') {
    if (game.state === 'play' && player.locked) {
      game.t += dt;
      for (const s of player.update(dt)) {
        props.step(s.x, s.z, 'player');
        if (water.disturb(s.x, s.z, player.sprint ? 1.0 : 0.45)) audio.play('splash', s.x, camera.position.y - 1.5, s.z);
      }
      props.brush(player.pos.x, player.pos.z, 0.3, player.vel.x, player.vel.z, dt, 'player');
    }
    if (!TRACE.paused) simulate(dt, player.info());
  }
  grass.update(dt, t);
  water.update(dt);
  prints.update(dt);
  props.update(dt);
  animalView.update(dt, truth, truth.y);
  for (const m of markers.children) if (m.geometry === ringGeo) {
    m.userData.t += dt; const k = Math.min(1, m.userData.t / 1.4);
    m.scale.setScalar(0.3 + k * 1.3); m.material.opacity = 1 - k * 0.85;
  }
  audio.setListener(camera);
  if ((toastTimer -= dt) <= 0) $('toast').classList.remove('show');
  for (const it of soundViz.items) it.t += dt;
  drawSoundViz();
  updateHud();
  if (DEBUG) $('debug').textContent = `truth x=${truth.x.toFixed(2)} z=${truth.z.toFixed(2)} state=${truth.state} speed=${truth.speed.toFixed(2)}\nfps ${fps} grass ${grass.count} prints ${prints.total}`;
  fpsAcc += dt; fpsN++; if (fpsAcc > 1) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- test / automation hooks ----------
const TRACE = window.TRACE = {
  THREE, scene, camera, renderer, world, truth, trample, water, prints, props, stats, game, player, grass, animalView,
  paused: false, seed: SEED,
  get fps() { return fps; },
  simulate, applyEvents, scanAt, finish,
  /** Start play without pointer lock (automation). */
  begin() { game.state = 'play'; $('start').classList.remove('show'); },
  /** Advance the simulation headlessly by `seconds` (visual systems included). */
  fastForward(seconds, dt = 1 / 30, playerInfo = player.info()) {
    for (let s = 0; s < seconds; s += dt) {
      simulate(dt, playerInfo); grass.update(dt, s); water.update(dt); prints.update(dt); props.update(dt);
      animalView.update(dt, truth, truth.y);
    }
  },
  lookAt(x, y, z, fromX, fromY, fromZ) {
    camera.position.set(fromX, fromY, fromZ); camera.lookAt(x, y, z);
    player.pos.set(fromX, 0, fromZ);
  },
};

$('loading').remove();
$('start').classList.add('show');
updateHud();
requestAnimationFrame(frame);
if (params.has('selftest')) runSelfTest(TRACE).then(r => { window.TRACE_TEST = r; });
