// Instanced grass bent on the GPU. The vertex shader reads the TrampleField texture
// (R = bend amount, GB = push direction, A = agitation) written from the animal's truth:
// bent grass marks its path, and freshly brushed grass still quivers for a few seconds.
import * as THREE from 'three';

export function createGrass(world, trample, rng) {
  const MAP = world.size;
  const half = MAP / 2 - 0.2;
  const src = world.props.GrassClump;
  const geom = src.geometry.clone();
  const tex = new THREE.DataTexture(new Uint8Array(trample.res * trample.res * 4), trample.res, trample.res, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const uniforms = { uTrample: { value: tex }, uTime: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, color: new THREE.Color(1.0, 1.0, 0.95) });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uTrample; uniform float uTime; varying float vBend;`)
      .replace('#include <project_vertex>', `
        vec4 ip = instanceMatrix * vec4(transformed, 1.0);
        vec4 io = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 tr = texture2D(uTrample, io.xz / ${MAP.toFixed(1)} + 0.5);
        float bend = tr.r;
        vec2 dir = tr.gb * 2.0 - 1.0;
        float agit = tr.a;
        float hh = max(ip.y - io.y, 0.0);
        float hn = clamp(hh / 0.5, 0.0, 1.0);
        float wind = (sin(uTime * 1.6 + io.x * 0.7 + io.z * 0.5) * 0.6 + sin(uTime * 2.9 + io.x * 1.9 - io.z * 1.3) * 0.25) * 0.09 * (1.0 - bend);
        // spring recovery: just-brushed blades oscillate around their bent pose (decays in ~3 s)
        float quiver = agit * sin(uTime * 11.0 + io.x * 5.0 + io.z * 3.0) * 0.35;
        ip.xz += (dir * (bend * 1.4 + quiver) + vec2(wind, wind * 0.6)) * hh * (0.4 + hn);
        ip.y = io.y + hh * (1.0 - 0.88 * bend);
        vBend = bend * (0.35 + 0.65 * hn);
        vec4 mvPosition = modelViewMatrix * ip;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vBend;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // flattened blades show their paler underside → the path reads as a lighter streak
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.52, 0.26), clamp(vBend * 1.2, 0.0, 0.85));`);
  };

  // jittered grid → keep points on bare Terrain (not mud/water/rock/trunks), density-weighted
  const pts = [];
  const step = 0.24;
  const tmp = new THREE.Object3D();
  for (let z = -half; z < half; z += step) {
    for (let x = -half; x < half; x += step) {
      const px = x + (rng() - 0.5) * step, pz = z + (rng() - 0.5) * step;
      const d = world.grassDensity(px, pz);
      if (d <= 0 || rng() > d * 0.95 + 0.02) continue;
      if (world.obstacles.some(o => (px - o.x) ** 2 + (pz - o.z) ** 2 < (o.r + 0.1) ** 2)) continue;
      const s = world.surfaceAt(px, pz);
      if (s.object !== world.terrain) continue;
      pts.push([px, s.point.y - 0.02, pz, d, world.isMeadow(px, pz)]);
    }
  }
  const mesh = new THREE.InstancedMesh(geom, mat, pts.length);
  pts.forEach(([x, y, z, d, meadow], i) => {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, rng() * Math.PI * 2, 0);
    const sc = (0.75 + rng() * 0.5) * (0.6 + 0.5 * d) * (meadow ? 1.25 : 1); // the meadow stands taller
    tmp.scale.set(sc, sc * (0.85 + rng() * 0.4) * (meadow ? 1.3 : 1), sc);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
  });
  mesh.frustumCulled = false;
  mesh.name = 'Grass';

  const buf = tex.image.data;
  return {
    mesh, count: pts.length, texture: tex,
    update(dt, t) {
      uniforms.uTime.value = t;
      trample.decay(dt);
      trample.writeRGBA(buf);
      tex.needsUpdate = true;
    },
  };
}
