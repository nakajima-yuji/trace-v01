// First-person walker: pointer-lock look, WASD (+ optional Shift sprint), BVH ground follow, trunk collision.
// Looking down at your feet brings the view closer (lower eye, narrower FOV) — no crouch key needed.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = { stand: 1.62, close: 1.15 };
const FOV = { normal: 72, close: 50 };
const SPEED = { walk: 2.0, sprint: 4.6 };

export class Player {
  constructor(camera, dom, world, { spawn = world.spawn ?? { x: 0, z: 12.5 } } = {}) {
    this.camera = camera; this.world = world;
    this.controls = new PointerLockControls(camera, dom);
    this.keys = new Set();
    this.sprint = false; this.mode = 'still'; this.fallback = false; this.close = 0;
    this.onTap = null; // fallback mode: a click without dragging = observe
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.limit = (world.size ?? 30) / 2 - 0.4;
    this.vel = new THREE.Vector3();
    this.eye = EYE.stand; this.stepAcc = 0; this.bob = 0;
    camera.position.set(this.pos.x, world.heightAt(this.pos.x, this.pos.z) + this.eye, this.pos.z);
    addEventListener('keydown', e => {
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  get locked() { return this.controls.isLocked || this.fallback === true; }

  /**
   * When the browser refuses pointer lock (embedded/in-app browsers, some iframes),
   * look around by dragging with the left mouse button instead; the keyboard works as usual.
   */
  enableFallback(dom) {
    this.fallback = true;
    if (this._dragBound) return;
    this._dragBound = true;
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    let drag = false, lx = 0, ly = 0, moved = 0;
    dom.addEventListener('mousedown', ev => { if (ev.button === 0) { drag = true; lx = ev.clientX; ly = ev.clientY; moved = 0; } });
    addEventListener('mouseup', ev => {
      if (drag && ev.button === 0 && moved < 6 && this.fallback === true) this.onTap?.();
      drag = false;
    });
    addEventListener('mousemove', ev => {
      if (!drag || this.fallback !== true) return;
      e.setFromQuaternion(this.camera.quaternion);
      moved += Math.abs(ev.clientX - lx) + Math.abs(ev.clientY - ly);
      e.y -= (ev.clientX - lx) * 0.004; e.x -= (ev.clientY - ly) * 0.004;
      e.x = Math.max(-1.5, Math.min(1.5, e.x));
      this.camera.quaternion.setFromEuler(e);
      lx = ev.clientX; ly = ev.clientY;
    });
  }

  /** Returns footstep positions produced this frame (for branch snaps / splashes). */
  update(dt) {
    const k = this.keys, steps = [];
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const moving = (f || r) && this.locked;
    this.mode = !moving ? 'still' : this.sprint ? 'sprint' : 'walk';
    const speed = this.sprint ? SPEED.sprint : SPEED.walk;

    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    this.vel.lerp(want, Math.min(1, dt * 10));
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);

    for (const ob of this.world.obstacles) {
      const dx = this.pos.x - ob.x, dz = this.pos.z - ob.z, d = Math.hypot(dx, dz), min = ob.r + 0.3;
      if (d < min && d > 1e-6) { this.pos.x = ob.x + dx / d * min; this.pos.z = ob.z + dz / d * min; }
    }
    this.pos.x = Math.max(-this.limit, Math.min(this.limit, this.pos.x));
    this.pos.z = Math.max(-this.limit, Math.min(this.limit, this.pos.z));

    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.stepAcc += moved;
    const stride = this.sprint ? 1.1 : 0.7;
    if (this.stepAcc > stride) { this.stepAcc = 0; steps.push({ x: this.pos.x, z: this.pos.z }); }

    // looking steeply down at the ground → lean in for a closer look
    const lookY = this.camera.getWorldDirection(new THREE.Vector3()).y;
    const closeTarget = Math.min(1, Math.max(0, (-lookY - 0.55) / 0.3));
    this.close += (closeTarget - this.close) * Math.min(1, dt * 5);
    this.eye += ((EYE.stand + (EYE.close - EYE.stand) * this.close) - this.eye) * Math.min(1, dt * 8);
    const fov = FOV.normal + (FOV.close - FOV.normal) * this.close;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.bob += moved * 7;
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const targetY = ground + this.eye + Math.sin(this.bob) * 0.025 * Math.min(1, this.vel.length());
    this.camera.position.x = this.pos.x; this.camera.position.z = this.pos.z;
    this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, dt * 14);
    return steps;
  }
  info() { return { x: this.pos.x, z: this.pos.z, mode: this.mode }; }
}
