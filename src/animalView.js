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
    // v0.2 clips (absent in the v0.1 GLB): lying in the bed, rubbing a trunk
    this.rest = clip('Rest') && this.mixer.clipAction(clip('Rest'));
    this.rub = clip('Rub') && this.mixer.clipAction(clip('Rub'));
    for (const a of [this.rest, this.rub]) if (a) { a.play(); a.setEffectiveWeight(0); }
    this.walkDur = clip('Walk').duration; this.grazeDur = clip('Graze').duration;
    this.root.visible = debug; this.revealT = -1; this.glimpseT = -1; this.debug = debug;
  }
  update(dt, truth, y) {
    this.root.position.set(truth.x, y, truth.z);
    this.root.rotation.y = truth.heading;
    const s = truth.speed, w = Math.min(1, Math.max(0, (s - 0.05) / 0.3));
    this.walk.time = ((truth.phase % 1) + 1) % 1 * this.walkDur;
    const st = truth.state;
    const lowered = st === 'graze' || st === 'feed' || st === 'browse' || truth.drinking;
    this.graze.timeScale = lowered ? 1 : 0;
    if (!lowered) this.graze.time = 0;
    const resting = this.rest && st === 'rest' ? 1 : 0, rubbing = this.rub && st === 'rub' ? 1 : 0;
    const idle = (1 - w) * (1 - resting) * (1 - rubbing);
    this.walk.setEffectiveWeight(w); this.graze.setEffectiveWeight(idle);
    this.rest?.setEffectiveWeight(resting); this.rub?.setEffectiveWeight(rubbing);
    this.mixer.update(dt);
    if (this.glimpseT >= 0) {
      this.glimpseT += dt;
      const t = this.glimpseT / this.glimpseDur;
      this.glass.opacity = Math.max(0, Math.sin(Math.min(1, t) * Math.PI)) * 0.9;
      this.glass.emissiveIntensity = 0.25 * this.glass.opacity;
      if (t >= 1) { this.glimpseT = -1; this.root.visible = this.debug; }
    }
    if (this.revealT >= 0) {
      this.revealT += dt;
      const k = Math.min(1, this.revealT / 1.5);
      this.glass.opacity = k; this.glass.emissiveIntensity = 0.6 * (1 - k) + 0.08;
    }
  }
  reveal() { this.root.visible = true; this.revealT = 0; this.glimpseT = -1; }
  /** Free-explore scan hit: the glass body shimmers into view for a few seconds, then fades. */
  glimpse(seconds = 4) {
    this.root.visible = true; this.revealT = -1; this.glimpseT = 0; this.glimpseDur = seconds;
  }
}
