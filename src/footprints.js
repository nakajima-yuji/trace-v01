// Hoof prints (Blender "Footprint" mesh) as one InstancedMesh with per-instance fade.
import * as THREE from 'three';
import { printAlpha } from './rules.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Footprints {
  constructor(scene, srcMesh, max = 700) {
    this.max = max; this.records = []; this.next = 0; this.total = 0;
    const geom = srcMesh.geometry.clone();
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geom.setAttribute('aAlpha', this.alpha);
    // wet, glossy hollows catch the low sun → readable from standing height
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(geom, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'Footprints';
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._qy = new THREE.Quaternion();
  }
  add(point, normal, heading, rule) {
    const i = this.next; this.next = (this.next + 1) % this.max; this.total++;
    this._q.setFromUnitVectors(UP, normal);
    this._qy.setFromAxisAngle(UP, heading);
    this._q.multiply(this._qy);
    // The Blender hollow dips 12 mm below its rim; lift it so the whole print sits above the
    // ground (otherwise the ground's depth hides the dark interior) and flatten the relief.
    const s = 2.0; // exaggerated (~20 cm) so prints read from standing height
    const sy = 0.35 * rule.depth;
    const pos = point.clone().addScaledVector(normal, 0.012 * sy + 0.003);
    this._m.compose(pos, this._q, new THREE.Vector3(s, sy, s));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.records[i] = { age: 0, life: rule.life, base: rule.opacity, x: point.x, z: point.z };
    this.mesh.count = Math.min(this.max, Math.max(this.mesh.count, i + 1));
  }
  update(dt) {
    const a = this.alpha.array;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i]; if (!r) continue;
      r.age += dt;
      a[i] = r.base * printAlpha(r.age, r.life);
    }
    this.alpha.needsUpdate = true;
  }
  visibleCount() { return this.records.filter((r, i) => r && this.alpha.array[i] > 0.02).length; }
}
