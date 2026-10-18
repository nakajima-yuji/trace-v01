// Loads the Blender-made GLBs and builds BVH-accelerated ground queries (three-mesh-bvh).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { SURFACE } from './rules.js';
import { grassDensity } from './grass.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DOWN = new THREE.Vector3(0, -1, 0);

export async function loadWorld(scene, base = './assets/') {
  const loader = new GLTFLoader();
  const [forest, props, animal] = await Promise.all(
    ['forest.glb', 'props.glb', 'animal.glb'].map(f => loader.loadAsync(base + f)));

  const root = forest.scene;
  scene.add(root);
  root.updateMatrixWorld(true);

  const w = {
    root, animal, terrain: null, muds: [], puddleMeshes: [], rocks: [], shrubs: [], branches: [], trees: [],
    obstacles: [], puddles: [], props: {},
  };
  root.traverse(o => {
    if (!o.isMesh) return;
    const n = o.name;
    if (n === 'Terrain') w.terrain = o;
    else if (n.startsWith('Mud_')) w.muds.push(o);
    else if (n.startsWith('Puddle_')) w.puddleMeshes.push(o);
    else if (n.startsWith('Rock_')) w.rocks.push(o);
    else if (n.startsWith('Shrub_')) w.shrubs.push(o);
    else if (n.startsWith('Branch_')) w.branches.push(o);
    // multi-material trees import as a Group of primitives; the group carries the name
    else if (o.parent?.name?.startsWith('Tree_')) { if (!w.trees.includes(o.parent)) w.trees.push(o.parent); }
    else if (n.startsWith('Tree_')) w.trees.push(o);
  });
  for (const o of [w.terrain, ...w.muds, ...w.rocks]) { o.receiveShadow = true; }
  for (const t of w.trees) t.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  for (const s of w.shrubs) { s.castShadow = true; s.receiveShadow = true; }
  for (const b of w.branches) b.castShadow = true;

  // readability pass: lighter, wetter mud so dark hoof prints stand out
  for (const m of w.muds) {
    m.material = m.material.clone();
    m.material.color.setRGB(0.36, 0.25, 0.155); m.material.roughness = 0.42;
  }

  // BVH on every mesh we raycast against
  w.groundMeshes = [w.terrain, ...w.muds, ...w.rocks];
  w.surfaceMeshes = [...w.groundMeshes, ...w.puddleMeshes];
  for (const m of w.surfaceMeshes) m.geometry.computeBoundsTree();

  // solid obstacles for animal + player: trunks (radius from Blender extras) and rocks
  for (const t of w.trees) {
    const r = (t.userData.trunk_radius ?? 0.2);
    w.obstacles.push({ x: t.position.x, z: t.position.z, r: r + 0.15, kind: 'tree' });
  }
  for (const r of w.rocks) {
    const b = new THREE.Box3().setFromObject(r), s = b.getSize(new THREE.Vector3());
    w.obstacles.push({ x: r.position.x, z: r.position.z, r: Math.max(s.x, s.z) * 0.45, kind: 'rock' });
  }
  for (const p of w.puddleMeshes) {
    const b = new THREE.Box3().setFromObject(p), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    w.puddles.push({ x: c.x, z: c.z, r: Math.max(s.x, s.z) / 2 / 1.05, y: b.max.y, mesh: p });
  }

  props.scene.traverse(o => { if (o.isMesh) w.props[o.name] = o; });

  const ray = new THREE.Raycaster(); ray.firstHitOnly = true; ray.far = 20;
  const origin = new THREE.Vector3();

  /** Ground height (terrain, mud, rocks — not water) via BVH raycast. */
  w.heightAt = (x, z) => {
    origin.set(x, 10, z); ray.set(origin, DOWN);
    const h = ray.intersectObjects(w.groundMeshes, false)[0];
    return h ? h.point.y : 0;
  };

  /** What is underfoot at (x, z): first surface from above, including water. */
  w.surfaceAt = (x, z) => {
    origin.set(x, 10, z); ray.set(origin, DOWN);
    const hits = ray.intersectObjects(w.surfaceMeshes, false);
    let h = hits[0];
    for (const c of hits) if (c.distance < h.distance) h = c;
    if (!h) return { surface: SURFACE.FLOOR, point: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(0, 1, 0) };
    const n = h.object.name;
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    let surface = SURFACE.FLOOR;
    if (n.startsWith('Mud_')) surface = SURFACE.MUD;
    else if (n.startsWith('Puddle_')) surface = SURFACE.WATER;
    else if (n.startsWith('Rock_')) surface = SURFACE.ROCK;
    else if (grassDensity(x, z) > 0.35) surface = SURFACE.GRASS;
    return { surface, point: h.point.clone(), normal, object: h.object };
  };

  /** Camera-ray pick against the ground (scan targeting). */
  w.pick = (raycaster) => {
    const hits = raycaster.intersectObjects(w.surfaceMeshes, false);
    hits.sort((a, b) => a.distance - b.distance);
    return hits[0] ?? null;
  };
  return w;
}
