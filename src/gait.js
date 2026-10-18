// Trot gait derived from the Blender "Walk" action (see blender/trace_v01.blend).
// Upper-leg swing A = 0.42 rad, leg length L = 0.72 m  →  stride = 2 · 2L·sin(A) per cycle.
export const STRIDE = 1.1744;

// Leg touches down when frac(phase + offset) wraps to 0. Offsets/foot positions mirror the rig
// (three.js space: +Z forward, +X left). z = hipZ + L·sin(A) at touchdown.
export const LEGS = [
  { id: 'FL', offset: 0.0, x: 0.10, z: 0.6235 },
  { id: 'BR', offset: 0.0, x: -0.10, z: -0.0365 },
  { id: 'FR', offset: 0.5, x: -0.10, z: 0.6235 },
  { id: 'BL', offset: 0.5, x: 0.10, z: -0.0365 },
];

/** Legs whose touchdown happened while the phase advanced from p0 to p1 (p1 >= p0). */
export function footfallsBetween(p0, p1) {
  const out = [];
  if (p1 <= p0) return out;
  for (const leg of LEGS) {
    const n = Math.floor(p1 + leg.offset) - Math.floor(p0 + leg.offset);
    for (let i = 0; i < n; i++) out.push(leg);
  }
  return out;
}

/** Body-local offset → world XZ for an animal at (x, z) facing `heading` (rotation.y). */
export function localToWorld(lx, lz, x, z, heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
}

export function footWorld(leg, x, z, heading) {
  return localToWorld(leg.x, leg.z, x, z, heading);
}
