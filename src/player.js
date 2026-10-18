// First-person walker: pointer-lock look, WASD, sprint/crouch, BVH ground follow, trunk collision.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = { stand: 1.62, crouch: 0.95 };
const SPEED = { walk: 2.3, sprint: 4.6, crouch: 1.1 };

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera; this.world = world;
    this.controls = new PointerLockControls(camera, dom);
    this.keys = new Set();
    this.crouch = false; this.sprint = false; this.mode = 'still';
    this.pos = new THREE.Vector3(0, 0, 12.5);
    this.vel = new THREE.Vector3();
    this.eye = EYE.stand; this.stepAcc = 0; this.bob = 0;
    camera.position.set(this.pos.x, world.heightAt(this.pos.x, this.pos.z) + this.eye, this.pos.z);
    addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  get locked() { return this.controls.isLocked; }

  /** Returns footstep positions produced this frame (for branch snaps / splashes). */
  update(dt) {
    const k = this.keys, steps = [];
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const moving = (f || r) && this.locked;
    this.mode = !moving ? 'still' : this.crouch ? 'crouch' : this.sprint ? 'sprint' : 'walk';
    const speed = this.crouch ? SPEED.crouch : this.sprint ? SPEED.sprint : SPEED.walk;

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
    this.pos.x = Math.max(-14.6, Math.min(14.6, this.pos.x));
    this.pos.z = Math.max(-14.6, Math.min(14.6, this.pos.z));

    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    this.stepAcc += moved;
    const stride = this.sprint ? 1.1 : 0.7;
    if (this.stepAcc > stride) { this.stepAcc = 0; steps.push({ x: this.pos.x, z: this.pos.z }); }

    this.eye += ((this.crouch ? EYE.crouch : EYE.stand) - this.eye) * Math.min(1, dt * 8);
    this.bob += moved * 7;
    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const targetY = ground + this.eye + Math.sin(this.bob) * 0.025 * Math.min(1, this.vel.length());
    this.camera.position.x = this.pos.x; this.camera.position.z = this.pos.z;
    this.camera.position.y += (targetY - this.camera.position.y) * Math.min(1, dt * 14);
    return steps;
  }
  info() { return { x: this.pos.x, z: this.pos.z, mode: this.mode }; }
}
