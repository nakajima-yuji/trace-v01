// The Blender-rigged animal, posed every frame from the truth. Hidden during play;
// shown as refracting glass when caught (or in ?debug=1).
import * as THREE from 'three';

export class AnimalView {
  constructor(scene, gltf, debug = false) {
    this.root = new THREE.Group(); this.root.name = 'AnimalView';
    this.root.add(gltf.scene);
    scene.add(this.root);
    this.glass = new THREE.MeshPhysicalMaterial({
      color: 0xd8f0ff, transmission: 1, thickness: 0.35, roughness: 0.06, ior: 1.33,
      transparent: true, opacity: 0, emissive: 0x6fb6ff, emissiveIntensity: 0,
    });
    this.debugMat = new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true });
    gltf.scene.traverse(o => { if (o.isMesh) { o.material = debug ? this.debugMat : this.glass; o.frustumCulled = false; } });
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = n => gltf.animations.find(a => a.name === n);
    this.walk = this.mixer.clipAction(clip('Walk')); this.graze = this.mixer.clipAction(clip('Graze'));
    this.walk.play(); this.graze.play();
    this.walk.timeScale = 0; this.graze.timeScale = 0;
    this.walkDur = clip('Walk').duration; this.grazeDur = clip('Graze').duration;
    this.root.visible = debug; this.revealT = -1;
  }
  update(dt, truth, y) {
    this.root.position.set(truth.x, y, truth.z);
    this.root.rotation.y = truth.heading;
    const s = truth.speed, w = Math.min(1, Math.max(0, (s - 0.05) / 0.3));
    this.walk.time = ((truth.phase % 1) + 1) % 1 * this.walkDur;
    const lowered = truth.state === 'graze' || truth.drinking;
    this.graze.timeScale = lowered ? 1 : 0;
    if (!lowered) this.graze.time = 0;
    this.walk.setEffectiveWeight(w); this.graze.setEffectiveWeight(1 - w);
    this.mixer.update(dt);
    if (this.revealT >= 0) {
      this.revealT += dt;
      const k = Math.min(1, this.revealT / 1.5);
      this.glass.opacity = k; this.glass.emissiveIntensity = 0.6 * (1 - k) + 0.08;
    }
  }
  reveal() { this.root.visible = true; this.revealT = 0; }
}
