import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { distance2D } from '../utils/geo';

export function buildStripGeometry(
  innerEdge: LocalPoint[],
  outerEdge: LocalPoint[],
  uvAlong: (arcMeters: number, arcTotal: number, widthT: number) => [number, number],
): THREE.BufferGeometry {
  const count = innerEdge.length;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const indices: number[] = [];

  let arcLength = 0;
  const arcLengths = [0];
  for (let i = 1; i < count; i++) {
    arcLength += distance2D(outerEdge[i - 1], outerEdge[i]);
    arcLengths.push(arcLength);
  }

  for (let i = 0; i < count; i++) {
    const inner = innerEdge[i];
    const outer = outerEdge[i];
    const iInner = i * 2;
    const iOuter = i * 2 + 1;

    positions[iInner * 3] = inner.x;
    positions[iInner * 3 + 1] = inner.y;
    positions[iInner * 3 + 2] = inner.z;
    positions[iOuter * 3] = outer.x;
    positions[iOuter * 3 + 1] = outer.y;
    positions[iOuter * 3 + 2] = outer.z;

    const [uIn, vIn] = uvAlong(arcLengths[i], arcLength, 0);
    const [uOut, vOut] = uvAlong(arcLengths[i], arcLength, 1);
    uvs[iInner * 2] = uIn;
    uvs[iInner * 2 + 1] = vIn;
    uvs[iOuter * 2] = uOut;
    uvs[iOuter * 2 + 1] = vOut;

    const nextI = ((i + 1) % count) * 2;
    indices.push(iInner, iOuter, nextI);
    indices.push(iOuter, nextI + 1, nextI);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Construit des rubans pour des plages d'indices (virages, graviers partiels…) */
export function buildStripSegments(
  innerEdge: LocalPoint[],
  outerEdge: LocalPoint[],
  segments: { start: number; end: number }[],
  uvAlong: (arcMeters: number, arcTotal: number, widthT: number) => [number, number],
): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  for (const seg of segments) {
    const count = seg.end - seg.start + 1;
    if (count < 2) continue;

    const inner = innerEdge.slice(seg.start, seg.end + 1);
    const outer = outerEdge.slice(seg.start, seg.end + 1);
    geometries.push(buildStripGeometry(inner, outer, uvAlong));
  }

  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }
  return mergeGeometries(geometries);
}

function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let offset = 0;

  for (const g of geoms) {
    const p = g.attributes.position.array as Float32Array;
    const u = g.attributes.uv.array as Float32Array;
    const indices = g.index!.array as Uint16Array | Uint32Array;

    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (let i = 0; i < indices.length; i++) idx.push(indices[i] + offset);

    offset += p.length / 3;
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  merged.setIndex(idx);
  merged.computeVertexNormals();
  return merged;
}
