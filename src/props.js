// Secondary traces: shrubs that shake when brushed, branches that snap when stepped on.
import * as THREE from 'three';

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export class Props {
  constructor(world, onSound) {
    this.onSound = onSound;
    this.shrubs = world.shrubs.map(o => {
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
      return { o, x: o.position.x, z: o.position.z, r: Math.max(s.x, s.z) / 2, rx: 0, rz: 0, vx: 0, vz: 0, base: o.rotation.clone(), cool: 0 };
    });
    this.branches = world.branches.map(o => {
      const L = o.userData.length ?? 1;
      const a = new THREE.Vector3(-L / 2, 0, 0).applyMatrix4(o.matrixWorld);
      const b = new THREE.Vector3(L / 2, 0, 0).applyMatrix4(o.matrixWorld);
      return { o, ax: a.x, az: a.z, bx: b.x, bz: b.z, snapped: false };
    });
    this.freshWood = new THREE.MeshLambertMaterial({ color: 0xc9a679 });
    this.snaps = 0; this.brushes = 0;
  }

  /** A foot (animal or player) came down at (x, z). Returns the snapped branch, if any. */
  step(x, z, who) {
    for (const br of this.branches) {
      if (br.snapped) continue;
      if (distToSegment(x, z, br.ax, br.az, br.bx, br.bz) < 0.1) {
        br.snapped = true; br.by = who; this.snaps++;
        // a fresh break: the branch sags, kinks and shows pale inner wood
        br.o.rotateY((Math.random() < 0.5 ? -1 : 1) * 0.3); br.o.rotateZ(0.08); br.o.position.y -= 0.02;
        br.o.material = this.freshWood;
        this.onSound('crack', (br.ax + br.bx) / 2, br.o.position.y, (br.az + br.bz) / 2, who);
        return br;
      }
    }
    return null;
  }

  /** A moving body of radius `r` at (x, z) with velocity (vx, vz) pushes through shrubs. */
  brush(x, z, r, vx, vz, dt, who) {
    const sp = Math.hypot(vx, vz);
    if (sp < 0.1) return;
    for (const s of this.shrubs) {
      if (Math.hypot(x - s.x, z - s.z) > s.r + r) continue;
      s.vx += vz * 2.2 * dt * 6; s.vz -= vx * 2.2 * dt * 6;
      if (s.cool <= 0) { this.brushes++; this.onSound('rustle', s.x, s.o.position.y + 0.4, s.z, who); s.cool = 0.8; }
    }
  }

  update(dt) {
    for (const s of this.shrubs) {
      // damped spring back to rest — the shake lingers ~2 s after contact
      s.vx += (-28 * s.rx - 2.8 * s.vx) * dt; s.vz += (-28 * s.rz - 2.8 * s.vz) * dt;
      s.rx += s.vx * dt; s.rz += s.vz * dt; s.cool -= dt;
      s.o.rotation.set(s.base.x + s.rx, s.base.y, s.base.z + s.rz);
    }
  }
}
