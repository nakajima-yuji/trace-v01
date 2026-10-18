// Pure trace rules: how a truth event becomes a visible/audible trace. No three.js here.

export const SURFACE = { MUD: 'mud', GRASS: 'grass', FLOOR: 'floor', WATER: 'water', ROCK: 'rock' };

/** What a single hoof touchdown leaves behind on a given surface. */
export function traceForFootfall(surface, speed) {
  const run = Math.min(1, Math.max(0, (speed - 0.8) / 2.2)); // 0 walk … 1 full flee
  switch (surface) {
    case SURFACE.MUD:
      return { print: true, opacity: 1.0, depth: 1.0 + 0.4 * run, life: 900, sound: 'squelch', ripple: 0, trample: 0 };
    case SURFACE.WATER:
      return { print: false, ripple: 0.6 + 0.8 * run, sound: 'splash', trample: 0 };
    case SURFACE.GRASS:
      return { print: true, opacity: 0.22, depth: 0.5, life: 120, sound: run > 0.3 ? 'rustle' : null, ripple: 0, trample: 0.95 };
    case SURFACE.ROCK:
      return { print: false, ripple: 0, sound: run > 0.3 ? 'tap' : null, trample: 0 };
    default:
      return { print: true, opacity: 0.45, depth: 0.7, life: 240, sound: null, ripple: 0, trample: 0.4 };
  }
}

/** Footprint visibility over time (slow fade, last 30% fades out). */
export function printAlpha(age, life) {
  if (age >= life) return 0;
  const t = age / life;
  return t < 0.7 ? 1 - 0.3 * (t / 0.7) : 0.7 * (1 - (t - 0.7) / 0.3);
}

export const SCAN = { HIT: 1.6, NEAR: 4.0, MAX_SCANS: 3 };

export function judgeScan(mx, mz, tx, tz) {
  const dist = Math.hypot(mx - tx, mz - tz);
  return { dist, grade: dist <= SCAN.HIT ? 'hit' : dist <= SCAN.NEAR ? 'near' : 'far' };
}

/** How far the animal can hear the player, by player movement mode. */
export function hearingRadius(mode) {
  return { still: 2.5, crouch: 4, walk: 8, sprint: 15 }[mode] ?? 8;
}

/**
 * Grass deformation field over the 30 m map. Truth stamps bend amount + push direction;
 * grass springs back linearly over `recover` seconds, so bend strength encodes trace age.
 */
export class TrampleField {
  constructor(size = 30, res = 128, recover = 50) {
    this.size = size; this.res = res; this.recover = recover;
    this.amount = new Float32Array(res * res);
    this.dx = new Float32Array(res * res);
    this.dz = new Float32Array(res * res);
  }
  cell(x, z) {
    return [((x / this.size) + 0.5) * this.res, ((z / this.size) + 0.5) * this.res];
  }
  stamp(x, z, radius, strength, dirX, dirZ) {
    const [cx, cz] = this.cell(x, z);
    const rc = (radius / this.size) * this.res;
    const r = this.res;
    for (let j = Math.max(0, Math.floor(cz - rc)); j <= Math.min(r - 1, Math.ceil(cz + rc)); j++) {
      for (let i = Math.max(0, Math.floor(cx - rc)); i <= Math.min(r - 1, Math.ceil(cx + rc)); i++) {
        const ddx = i + 0.5 - cx, ddz = j + 0.5 - cz;
        const d = Math.hypot(ddx, ddz) / rc;
        if (d > 1) continue;
        const k = j * r + i;
        const s = strength * (1 - d * d);
        if (s <= this.amount[k]) continue;
        // push: along motion, plus outward from the stamp centre
        let px = dirX + (ddx / (rc + 1e-6)) * 0.6, pz = dirZ + (ddz / (rc + 1e-6)) * 0.6;
        const l = Math.hypot(px, pz) || 1;
        this.amount[k] = s; this.dx[k] = px / l; this.dz[k] = pz / l;
      }
    }
  }
  decay(dt) {
    const step = dt / this.recover;
    const a = this.amount;
    for (let k = 0; k < a.length; k++) if (a[k] > 0) a[k] = Math.max(0, a[k] - step);
  }
  sample(x, z) {
    const [cx, cz] = this.cell(x, z);
    const i = Math.floor(cx), j = Math.floor(cz);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return 0;
    return this.amount[j * this.res + i];
  }
  writeRGBA(buf) {
    for (let k = 0; k < this.amount.length; k++) {
      buf[k * 4] = this.amount[k] * 255;
      buf[k * 4 + 1] = (this.dx[k] * 0.5 + 0.5) * 255;
      buf[k * 4 + 2] = (this.dz[k] * 0.5 + 0.5) * 255;
      buf[k * 4 + 3] = 255;
    }
  }
}

/**
 * Two-buffer discrete wave equation (Hugo Elias / the same scheme as three.js
 * webgl_gpgpu_water's heightmap pass and m-ender/webgl-ripples), run on the CPU per puddle.
 */
export class RippleField {
  constructor(res = 96, damping = 0.982) {
    this.res = res; this.damping = damping;
    this.cur = new Float32Array(res * res);
    this.prev = new Float32Array(res * res);
  }
  /** u, v in [0,1] across the puddle's square. */
  disturb(u, v, amp, radiusCells = 2.5) {
    const r = this.res, cx = u * r, cz = v * r;
    for (let j = Math.floor(cz - radiusCells); j <= Math.ceil(cz + radiusCells); j++) {
      for (let i = Math.floor(cx - radiusCells); i <= Math.ceil(cx + radiusCells); i++) {
        if (i < 1 || j < 1 || i >= r - 1 || j >= r - 1) continue;
        const d = Math.hypot(i - cx, j - cz) / radiusCells;
        if (d <= 1) this.cur[j * r + i] -= amp * (0.5 + 0.5 * Math.cos(Math.PI * d));
      }
    }
  }
  step() {
    const r = this.res, c = this.cur, p = this.prev;
    for (let j = 1; j < r - 1; j++) {
      for (let i = 1; i < r - 1; i++) {
        const k = j * r + i;
        p[k] = ((c[k - 1] + c[k + 1] + c[k - r] + c[k + r]) * 0.5 - p[k]) * this.damping;
      }
    }
    this.prev = c; this.cur = p;
  }
  energy() {
    let e = 0; for (const h of this.cur) e += h * h; return e;
  }
  writeRGBA(buf, scale = 6) {
    const r = this.res, h = this.cur;
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < r; i++) {
        const k = j * r + i;
        const nx = (h[j * r + Math.max(0, i - 1)] - h[j * r + Math.min(r - 1, i + 1)]) * scale;
        const nz = (h[Math.max(0, j - 1) * r + i] - h[Math.min(r - 1, j + 1) * r + i]) * scale;
        buf[k * 4] = Math.max(0, Math.min(255, (nx * 0.5 + 0.5) * 255));
        buf[k * 4 + 1] = Math.max(0, Math.min(255, (nz * 0.5 + 0.5) * 255));
        buf[k * 4 + 2] = Math.max(0, Math.min(255, (h[k] * 0.5 + 0.5) * 255));
        buf[k * 4 + 3] = 255;
      }
    }
  }
}
