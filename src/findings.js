// v0.2 exploration layer: six hand-placed finds (Blender Find_*), observation of the live traces
// the animal leaves, and the observation log. Freshness always comes from the truth: when the
// animal last used a place, how old a print is, how far bent grass has recovered.
import * as THREE from 'three';

export const FIND_INFO = {
  Browse: {
    title: '食まれた枝先', visit: 'browse',
    note: '低木の枝先が斜めに噛み切られ、白い断面が見える。葉だけを選んで食べている。',
    hint: '小道の泥に、同じ蹄の跡が北へ続いている。',
  },
  Fur: {
    title: '倒木に絡んだ毛', visit: 'fur',
    note: '倒木の上に淡い茶色の毛が引っかかっている。ここを跨いで通ったらしい。',
    hint: '倒木の向こうは、ぬかるんだ獣道。いつも同じ道を使っているのかもしれない。',
  },
  Bed: {
    title: '寝床', visit: 'rest',
    note: '大きな樫の下で、草が楕円形に押し倒され、毛が混じっている。草むらを見渡せる場所だ。',
    hint: '寝床から出た踏み分けは、草むらを抜けて東の水辺へ向かっている。',
  },
  Nuts: {
    title: '食べかけの木の実', visit: 'feed',
    note: '殻が割られ、中身だけ食べられている。縁に細かな歯形が残る。',
    hint: '割れ口の白い殻と、黒ずんだ殻が混じっている。何度も来ている。',
  },
  Rub: {
    title: '樹皮の擦り跡', visit: 'rub',
    note: '白い樺の幹の低いところが擦られ、赤茶色の内皮が出ている。体をこすりつけた跡。',
    hint: '擦り跡の高さは膝から腰ほど。思ったより小柄な動物だ。',
  },
  Droppings: {
    title: '糞', visit: 'sip',
    note: '小さな粒状の糞がまとまっている。水場のそば。',
    hint: '泥の岸を見てみよう。水を飲みに来たなら、蹄の跡が残っているはず。',
  },
};
const VISIT_TO_FIND = Object.fromEntries(Object.entries(FIND_INFO).map(([k, v]) => [v.visit, k]));
const SURFACE_JA = { mud: '泥', grass: '草地', floor: '落ち葉の地面', water: '水', rock: '岩' };
const COMPASS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

/** three.js heading (rotation.y) → compass word. North = −Z (Blender +Y). */
export function compassOf(heading) {
  const dx = Math.sin(heading), dz = Math.cos(heading);
  const b = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(b / 45) % 8];
}
export function freshness(age) {
  if (age == null) return '最近使われた様子はない';
  if (age < 90) return 'つい今しがた使われたようだ';
  if (age < 300) return '数分前まで使われていたらしい';
  return 'しばらく前の跡だ';
}

/** Small falling particles (leaves from a brushed shrub, bark flakes from a rubbed trunk). */
class Flutter {
  constructor(scene, color, max = 160) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.04),
      new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }), max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.p = []; this.max = max; this._o = new THREE.Object3D();
  }
  emit(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      this.p.push({ x: x + (Math.random() - 0.5) * 0.5, y: y + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 0.4, vz: (Math.random() - 0.5) * 0.4, s: Math.random() * 6, life: 0, ground: null });
    }
  }
  update(dt, heightAt) {
    const o = this._o;
    this.p = this.p.filter(q => (q.life += dt) < 25);
    this.p.forEach((q, i) => {
      if (q.ground == null) q.ground = heightAt(q.x, q.z) + 0.01;
      if (q.y > q.ground) {
        q.y -= dt * 0.45; q.x += (q.vx + Math.sin(q.life * 5 + q.s) * 0.25) * dt; q.z += (q.vz + Math.cos(q.life * 4 + q.s) * 0.25) * dt;
        o.rotation.set(q.life * 4 + q.s, q.life * 3, 0);
      } else { q.y = q.ground; o.rotation.set(-Math.PI / 2, 0, q.s); } // lies on the ground — a trace that stays
      o.position.set(q.x, q.y, q.z); o.updateMatrix(); this.mesh.setMatrixAt(i, o.matrix);
    });
    this.mesh.count = this.p.length; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Findings {
  constructor(scene, world, { prints, trample, water, props, audio }) {
    Object.assign(this, { world, prints, trample, water, props, audio });
    this.lastVisit = {};      // find key → truth time of last use
    this.entries = [];        // observation log, newest last
    this.found = new Set();   // find keys observed at least once
    this.spots = {};
    for (const [k, o] of Object.entries(world.finds)) this.spots[k] = o.getWorldPosition(new THREE.Vector3());
    this.leaves = new Flutter(scene, 0x7a9a3a);
    this.flakes = new Flutter(scene, 0x9a5a34);
    // fresh nut shells dropped while it feeds (pale break edges)
    this.shellMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xd9b98a, side: THREE.DoubleSide }), 40);
    this.shellMesh.count = 0; this.shellMesh.frustumCulled = false; scene.add(this.shellMesh);
    this.shells = [];
    this.shake = {};          // find/tree object → spring state
    this.birch = world.trees.find(t => t.name.startsWith('Tree_Birch1'));
  }

  /** Called every frame with the truth (visits are read from its state — the only source). */
  track(truth) {
    const k = VISIT_TO_FIND[truth.state];
    if (k) this.lastVisit[k] = truth.time;
    const fur = this.spots.Fur;
    if (fur && truth.speed > 0.2 && Math.hypot(truth.x - fur.x, truth.z - fur.z) < 0.9) this.lastVisit.Fur = truth.time;
  }

  /** Truth activity events → environmental reactions. */
  onEvent(e) {
    const w = this.world;
    if (e.type === 'feed') {
      const i = this.shells.length % 40;
      const x = e.x + (Math.random() - 0.5) * 0.4, z = e.z + (Math.random() - 0.5) * 0.4, y = w.heightAt(x, z) + 0.005;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 6, 0)), new THREE.Vector3(1, 1, 1));
      this.shellMesh.setMatrixAt(i, m); this.shellMesh.instanceMatrix.needsUpdate = true;
      this.shells[i] = { x, z, t: e.t }; this.shellMesh.count = Math.min(40, this.shells.length);
      this.audio.play('crunch', e.x, y + 0.4, e.z);
    } else if (e.type === 'browse') {
      const o = w.finds.Browse; if (o) this.kick(o, 0.12);
      this.leaves.emit(e.x, w.heightAt(e.x, e.z) + 0.7, e.z, 4);
      this.audio.play('twig', e.x, w.heightAt(e.x, e.z) + 0.6, e.z);
    } else if (e.type === 'rub') {
      if (this.birch) this.kick(this.birch, 0.025);
      const r = this.spots.Rub; if (r) this.flakes.emit(r.x, r.y + 0.7, r.z, 2);
      this.audio.play('rub', e.x, w.heightAt(e.x, e.z) + 0.7, e.z);
    }
  }
  kick(o, amount) {
    const s = this.shake[o.uuid] ??= { o, base: o.rotation.clone(), r: 0, v: 0 };
    s.v += amount * 10;
  }
  update(dt) {
    for (const s of Object.values(this.shake)) {
      s.v += (-40 * s.r - 4 * s.v) * dt; s.r += s.v * dt;
      s.o.rotation.set(s.base.x + s.r, s.base.y, s.base.z + s.r * 0.6);
    }
    this.leaves.update(dt, this.world.heightAt); this.flakes.update(dt, this.world.heightAt);
  }

  /** The find the player is looking at from close by (shows the small "F 観察" prompt). */
  candidate(camera) {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    let best = null, bd = Infinity;
    for (const [k, p] of Object.entries(this.spots)) {
      const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
      if (d > 3.2) continue;
      const to = p.clone().add(new THREE.Vector3(0, k === 'Rub' ? 0.7 : 0.1, 0)).sub(camera.position).normalize();
      if (to.dot(fwd) > 0.95 && d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /** What a click would observe right now: a find, or the live trace under the crosshair (or null). */
  target(camera, now) {
    const k = this.candidate(camera);
    if (k) return { find: k };
    const ray = new THREE.Raycaster(); ray.far = 4.5; ray.firstHitOnly = true;
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = this.world.pick(ray);
    if (!hit) return null;
    const r = this.readGround(hit.point.x, hit.point.z, now);
    return r ? { trace: r } : null;
  }
  /** Click: log a find, or whatever live trace is on the ground under the crosshair. */
  observe(camera, now) {
    const t = this.target(camera, now);
    if (!t) return null;
    return t.find ? this.logFind(t.find, now) : this.logTrace(t.trace, now);
  }

  logFind(k, now) {
    const info = FIND_INFO[k], p = this.spots[k];
    const age = this.lastVisit[k] != null ? now - this.lastVisit[k] : null;
    const first = !this.found.has(k);
    this.found.add(k);
    const entry = {
      kind: 'find', key: k, title: info.title, t: now, area: this.areaOf(p.x, p.z),
      note: `${info.note}${first ? '' : '（再観察）'}`, fresh: freshness(age), hint: info.hint, first,
    };
    const old = this.entries.findIndex(e => e.key === k);
    if (old >= 0) this.entries.splice(old, 1);
    this.entries.push(entry);
    return entry;
  }

  /** What the ground at (x, z) says right now — read only from trace state derived from the truth. */
  readGround(x, z, now) {
    const pr = this.prints.records.filter(Boolean).filter(r => Math.hypot(r.x - x, r.z - z) < 0.45 && r.age < r.life)
      .sort((a, b) => a.age - b.age)[0];
    if (pr) {
      const age = pr.age;
      const when = age < 60 ? '縁がまだ崩れていない。ついさっきのものだ' : age < 300 ? '縁が少し乾いている。数分前のものらしい' : '縁が崩れかけている。古い跡だ';
      return { kind: 'print', title: '蹄の足跡', x, z, note: `${SURFACE_JA[pr.surface] ?? '地面'}に二つに割れた蹄の跡。つま先は${compassOf(pr.heading)}を向いている。${when}。` };
    }
    const quiver = this.trample.sampleAgitation(x, z), bend = this.trample.sample(x, z);
    if (quiver > 0.12) return { kind: 'grass', title: '揺れている草', x, z, note: '草がまだ小刻みに揺れている。ほんの数秒前、何かがここを通った！' };
    if (bend > 0.18) {
      const ago = Math.max(5, Math.round((0.85 - bend) * 90 / 10) * 10);
      return { kind: 'grass', title: '倒れた草', x, z, note: `草が一方向に押し倒されている。起き上がり具合からみて、${ago < 30 ? '30秒以内' : `およそ${ago}秒前`}に通ったようだ。` };
    }
    const sh = this.shells.filter(Boolean).find(s => Math.hypot(s.x - x, s.z - z) < 0.6);
    if (sh) return { kind: 'shell', title: '新しい殻', x, z, note: `割れ口が白い、新しい殻。${now - sh.t < 120 ? 'ついさっき食べたばかりだ' : '少し前に食べたものだ'}。` };
    const br = this.props.branches.find(b => b.snapped && Math.hypot((b.ax + b.bx) / 2 - x, (b.az + b.bz) / 2 - z) < 0.7);
    if (br) return { kind: 'branch', title: '踏み折られた枝', x, z, note: `枝が踏み折られ、白い断面がのぞいている。${br.by === 'player' ? '……自分で踏んだ枝だ。' : ''}` };
    const wi = this.water.find(x, z);
    if (wi && wi.quiet < 4) return { kind: 'ripple', title: '水面の波紋', x, z, note: '水面に同心円の波紋が広がっている。いま何かが水に触れた。' };
    const leaf = this.leaves.p.find(q => q.y <= q.ground + 0.001 && Math.hypot(q.x - x, q.z - z) < 0.5);
    if (leaf) return { kind: 'leaf', title: '落ちたばかりの葉', x, z, note: '青い葉が数枚落ちている。枯れ葉ではない。枝が揺すられたのだ。' };
    return null;
  }

  logTrace(r, now) {
    if (!r) return null;
    const dup = this.entries.find(e => e.kind === r.kind && Math.hypot(e.x - r.x, e.z - r.z) < 2 && now - e.t < 45);
    if (dup) return { ...dup, duplicate: true };
    const entry = { ...r, t: now, area: this.areaOf(r.x, r.z), fresh: '' };
    this.entries.push(entry);
    return entry;
  }
  areaOf(x, z) { return this.world.zoneAt(x, z)?.label ?? '森の中'; }
}
