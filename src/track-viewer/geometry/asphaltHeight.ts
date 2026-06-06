import type { LocalPoint } from '../types';
import { lerp } from '../utils/geo';

/** Échantillonne l'altitude de la surface asphalte (interpolation bilinéaire sur le ruban) */
export function createAsphaltHeightSampler(
  asphaltInner: LocalPoint[],
  asphaltOuter: LocalPoint[],
): (x: number, z: number) => number {
  const n = asphaltInner.length;

  return (x: number, z: number): number => {
    let bestDist = Infinity;
    let bestY = asphaltInner[0].y;

    for (let i = 0; i < n; i++) {
      const iIn = asphaltInner[i];
      const oIn = asphaltOuter[i];
      const iOut = asphaltInner[(i + 1) % n];
      const oOut = asphaltOuter[(i + 1) % n];

      const y = nearestOnQuad(x, z, iIn, oIn, iOut, oOut, bestDist);
      if (y.dist < bestDist) {
        bestDist = y.dist;
        bestY = y.height;
      }
    }

    return bestY;
  };
}

function nearestOnQuad(
  px: number,
  pz: number,
  i0: LocalPoint,
  o0: LocalPoint,
  i1: LocalPoint,
  o1: LocalPoint,
  bestDist: number,
): { dist: number; height: number } {
  const samples = [
    projectToSegment(px, pz, i0, i1, 0, 1),
    projectToSegment(px, pz, o0, o1, 0, 1),
    projectToSegment(px, pz, i0, o0, 0, 0),
    projectToSegment(px, pz, i1, o1, 1, 1),
  ];

  let dist = bestDist;
  let height = i0.y;

  for (const s of samples) {
    if (s.dist < dist) {
      dist = s.dist;
      const yInner = lerp(i0.y, i1.y, s.tAlong);
      const yOuter = lerp(o0.y, o1.y, s.tAlong);
      height = lerp(yInner, yOuter, s.tAcross);
    }
  }

  return { dist, height };
}

function projectToSegment(
  px: number,
  pz: number,
  a: LocalPoint,
  b: LocalPoint,
  acrossA: number,
  acrossB: number,
): { dist: number; tAlong: number; tAcross: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq));
  const cx = a.x + dx * t;
  const cz = a.z + dz * t;
  const dist = Math.hypot(px - cx, pz - cz);
  const tAcross = lerp(acrossA, acrossB, t);
  return { dist, tAlong: t, tAcross };
}
