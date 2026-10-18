// Loads the Blender-made GLBs and builds BVH-accelerated ground queries (three-mesh-bvh).
// v0.2 adds marker empties from Blender: Trail_* (game-trail graph), POI_* (places the animal
// uses), Zone_* (the three exploration areas), Spawn, plus the six Find_* objects.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { SURFACE } from './rules.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DOWN = new THREE.Vector3(0, -1, 0);

function segDist(px, pz, a, b) {
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / l2));
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

export async function loadWorld(scene, files = {}) {
  const base = files.base ?? './assets/';
  const loader = new GLTFLoader();
  const [forest, props, animal] = await Promise.all(
    [files.forest ?? 'v02/forest_v02.glb', files.props ?? 'props.glb', files.animal ?? 'v02/animal_v02.glb']
      .map(f => loader.loadAsync(base + f)));

  const root = forest.scene;
  scene.add(root);
  root.updateMatrixWorld(true);

  const w = {
    root, animal, terrain: null, muds: [], puddleMeshes: [], rocks: [], shrubs: [], branches: [], trees: [],
    obstacles: [], puddles: [], props: {}, finds: {}, trails: [], pois: [], zones: [], spawn: { x: 0, z: 12.5 },
  };
  root.traverse(o => {
    const n = o.name;
    // finds carry a "find" extra; a multi-material find's child primitives (Find_X_1 …) don't
    if (n.startsWith('Find_')) { if (o.userData.find) w.finds[o.userData.find] = o; return; }
    if (n.startsWith('Trail_')) w.trails.push({ id: o.userData.node, x: o.position.x, z: o.position.z, links: o.userData.links.split(','), mud: !!o.userData.mud });
    else if (n.startsWith('POI_')) w.pois.push({ kind: o.userData.poi === 'drink' ? 'sip' : o.userData.poi, x: o.position.x, z: o.position.z, node: o.userData.node });
    else if (n.startsWith('Zone_') && o.userData.zone) w.zones.push({ id: o.userData.zone, label: o.userData.label, r: o.userData.radius, x: o.position.x, z: o.position.z });
    else if (n.startsWith('Zone_Meadow')) w.meadow = { x: o.position.x, z: o.position.z, r: o.userData.radius };
    else if (n === 'Spawn') w.spawn = { x: o.position.x, z: o.position.z };
    if (!o.isMesh || o.parent?.name?.startsWith('Find_')) return;
    if (n.startsWith('Terrain')) w.terrain = o;
    else if (n.startsWith('Mud_')) w.muds.push(o);
    else if (n.startsWith('Puddle_') || n === 'Pond') w.puddleMeshes.push(o);
    else if (n.startsWith('Rock_')) w.rocks.push(o);
    else if (n.startsWith('Shrub_')) w.shrubs.push(o);
    else if (n.startsWith('Branch_')) w.branches.push(o);
    // multi-material trees import as a Group of primitives; the group carries the name
    else if (o.parent?.name?.startsWith('Tree_')) { if (!w.trees.includes(o.parent)) w.trees.push(o.parent); }
    else if (n.startsWith('Tree_')) w.trees.push(o);
  });
  const tb = new THREE.Box3().setFromObject(w.terrain);
  w.size = tb.max.x - tb.min.x;

  for (const o of [w.terrain, ...w.muds, ...w.rocks]) o.receiveShadow = true;
  for (const t of w.trees) t.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  for (const s of w.shrubs) { s.castShadow = true; s.receiveShadow = true; }
  for (const b of w.branches) b.castShadow = true;
  for (const f of Object.values(w.finds)) f.traverse(m => { if (m.isMesh) m.receiveShadow = true; });

  w.groundMeshes = [w.terrain, ...w.muds, ...w.rocks];
  w.surfaceMeshes = [...w.groundMeshes, ...w.puddleMeshes];
  for (const m of w.surfaceMeshes) m.geometry.computeBoundsTree();

  for (const t of w.trees) {
    w.obstacles.push({ x: t.position.x, z: t.position.z, r: (t.userData.trunk_radius ?? 0.2) + 0.15, kind: 'tree', name: t.name });
  }
  // static trees → one merged mesh per material (draw calls ×2 for shadows add up fast);
  // trees that react to the animal (the rubbed birch) stay separate objects
  {
    const byMat = new Map(), merged = [];
    for (const t of w.trees) {
      if (t.name.startsWith('Tree_Birch1')) continue;
      t.updateMatrixWorld(true);
      t.traverse(m => {
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
        (byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)).push(g);
      });
      merged.push(t);
    }
    for (const [mat, geoms] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(geoms), mat);
      mesh.name = 'TreesMerged'; mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    }
    for (const t of merged) t.removeFromParent();
  }
  for (const r of w.rocks) {
    const b = new THREE.Box3().setFromObject(r), s = b.getSize(new THREE.Vector3());
    w.obstacles.push({ x: r.position.x, z: r.position.z, r: Math.max(s.x, s.z) * 0.45, kind: 'rock' });
  }
  for (const p of w.puddleMeshes) {
    const b = new THREE.Box3().setFromObject(p), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    w.puddles.push({ x: c.x, z: c.z, r: Math.max(s.x, s.z) / 2, y: b.max.y, mesh: p, name: p.name });
  }
  props.scene.traverse(o => { if (o.isMesh) w.props[o.name] = o; });

  // trail segments (for grass clearing and "on the trail" checks)
  const byId = Object.fromEntries(w.trails.map(t => [t.id, t]));
  w.segments = [];
  for (const t of w.trails) for (const l of t.links) if (t.id < l && byId[l]) w.segments.push([t, byId[l]]);
  w.trailDist = (x, z) => w.segments.length ? Math.min(...w.segments.map(([a, b]) => segDist(x, z, a, b))) : Infinity;

  // small finds sit in a little bare patch so they can be seen; the bed is meadow grass pressed flat
  const findSpots = Object.entries(w.finds).filter(([k]) => k !== 'Bed').map(([, f]) => f.getWorldPosition(new THREE.Vector3()));
  /** Meadow = tall dense grass, trails = bare, forest floor = sparse tufts. */
  w.grassDensity = (x, z) => {
    if (w.trailDist(x, z) < 0.75) return 0;
    for (const p of w.puddles) if (Math.hypot(x - p.x, z - p.z) < p.r + 0.6) return 0;
    for (const f of findSpots) if (Math.hypot(x - f.x, z - f.z) < 0.85) return 0; // keep finds visible
    const n = 0.5 + 0.32 * Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17 - 0.4) + 0.18 * Math.sin(x * 0.53 - z * 0.41 + 2.0);
    const patches = Math.min(1, Math.max(0, (n - 0.45) / 0.35)) * 0.55;
    if (!w.meadow) return patches;
    const dm = Math.hypot(x - w.meadow.x, z - w.meadow.z);
    const meadow = Math.min(1, Math.max(0, (w.meadow.r + 1 - dm) / 2.5));
    return Math.max(patches, meadow);
  };
  w.isMeadow = (x, z) => w.meadow && Math.hypot(x - w.meadow.x, z - w.meadow.z) < w.meadow.r;

  /** Which exploration area a point is in. */
  w.zoneAt = (x, z) => {
    let best = null, bd = Infinity;
    for (const zn of w.zones) { const d = Math.hypot(x - zn.x, z - zn.z); if (d < zn.r && d < bd) { bd = d; best = zn; } }
    return best;
  };

  const ray = new THREE.Raycaster(); ray.firstHitOnly = true; ray.far = 20;
  const origin = new THREE.Vector3();
  w.heightAt = (x, z) => {
    origin.set(x, 10, z); ray.set(origin, DOWN);
    const h = ray.intersectObjects(w.groundMeshes, false)[0];
    return h ? h.point.y : 0;
  };
  w.surfaceAt = (x, z) => {
    origin.set(x, 10, z); ray.set(origin, DOWN);
    const h = ray.intersectObjects(w.surfaceMeshes, false)[0];
    if (!h) return { surface: SURFACE.FLOOR, point: new THREE.Vector3(x, 0, z), normal: new THREE.Vector3(0, 1, 0) };
    const n = h.object.name;
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    let surface = SURFACE.FLOOR;
    if (n.startsWith('Mud_')) surface = SURFACE.MUD;
    else if (n.startsWith('Puddle_') || n === 'Pond') surface = SURFACE.WATER;
    else if (n.startsWith('Rock_')) surface = SURFACE.ROCK;
    else if (w.grassDensity(x, z) > 0.35) surface = SURFACE.GRASS;
    return { surface, point: h.point.clone(), normal, object: h.object };
  };
  w.pick = (raycaster) => raycaster.intersectObjects(w.surfaceMeshes, false).sort((a, b) => a.distance - b.distance)[0] ?? null;
  return w;
}
