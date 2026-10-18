// Puddle surfaces driven by a per-puddle wave-equation heightfield (RippleField).
import * as THREE from 'three';
import { RippleField } from './rules.js';

const vert = /* glsl */`
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const frag = /* glsl */`
  uniform sampler2D uRip; uniform vec2 uCenter; uniform float uSize; uniform vec3 uSun;
  uniform vec3 uDeep; uniform vec3 uSky;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec2 uv = (vWorld.xz - uCenter) / uSize + 0.5;
    vec4 t = texture2D(uRip, uv);
    vec2 n2 = t.rg * 2.0 - 1.0;
    vec3 N = normalize(vec3(n2.x, 1.0, n2.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = 0.06 + 0.9 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, uSun), 0.0), 90.0) * 1.6;
    float slope = clamp(length(n2) * 3.0, 0.0, 1.0);
    vec3 col = mix(uDeep, uSky, fres) + spec + vec3(0.34, 0.38, 0.40) * slope * 0.8;
    gl_FragColor = vec4(col, 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class Water {
  constructor(scene, puddles, sunDir) {
    this.items = puddles.map(p => {
      const res = 96, size = p.r * 2.2;
      const field = new RippleField(res, 0.985);
      const tex = new THREE.DataTexture(new Uint8Array(res * res * 4).fill(128), res, res, THREE.RGBAFormat);
      tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, transparent: true, fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          uRip: { value: null }, uCenter: { value: new THREE.Vector2(p.x, p.z) }, uSize: { value: size },
          uSun: { value: sunDir.clone().normalize() },
          uDeep: { value: new THREE.Color(0x0b1410) }, uSky: { value: new THREE.Color(0x9fb4ad) },
        }]),
      });
      mat.uniforms.uRip.value = tex;
      p.mesh.material = mat;          // reuse the Blender puddle disk as the water surface
      p.mesh.renderOrder = 1;
      return { p, field, tex, size, acc: 0, quiet: 0 };
    });
  }
  /** Which puddle (if any) covers (x, z). */
  find(x, z) {
    return this.items.find(it => Math.hypot(x - it.p.x, z - it.p.z) < it.p.r * 1.05);
  }
  disturb(x, z, amp) {
    const it = this.find(x, z);
    if (!it) return false;
    it.field.disturb((x - it.p.x) / it.size + 0.5, (z - it.p.z) / it.size + 0.5, amp * 0.22, 2.2);
    it.quiet = 0;
    return true;
  }
  update(dt) {
    for (const it of this.items) {
      it.acc += dt;
      let stepped = false;
      while (it.acc > 1 / 40) { it.field.step(); it.acc -= 1 / 40; stepped = true; }
      it.quiet += dt;
      if (stepped && it.quiet < 30) { it.field.writeRGBA(it.tex.image.data); it.tex.needsUpdate = true; }
    }
  }
  energy() { return this.items.reduce((s, it) => s + it.field.energy(), 0); }
}
