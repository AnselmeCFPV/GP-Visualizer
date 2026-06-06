import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { geoToLocal, type GeoOrigin } from '../utils/geo';
import { buildTrackPath, type TrackPathData } from '../rider/TrackPath';

/** Ligne d'arrivée — 47°21'53.41"N 4°53'59.39"E */
export const FINISH_LINE_GEO = {
  lat: 47 + 21 / 60 + 53.41 / 3600,
  lon: 4 + 53 / 60 + 59.39 / 3600,
  elevation: 0,
};

/** Épaisseur de la bande dans le sens de la piste (m) */
const FINISH_BAND_DEPTH_M = 0.9;
/** Côté d'un carreau du damier (m) */
const FINISH_CHECKER_SIZE_M = 0.45;

function createBwCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c0c0c';
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(1, 1, 1, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function projectToPath(path: TrackPathData, point: LocalPoint): { distance: number; t: number } {
  const { points, cumulative, totalLength } = path;
  const n = points.length;
  let bestDist = Infinity;
  let bestDistance = 0;
  let bestT = 0;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lenSq));
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const dist = Math.hypot(point.x - cx, point.z - cz);

    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
      const segStart = cumulative[i];
      const segEnd = i < n - 1 ? cumulative[i + 1] : totalLength;
      bestDistance = segStart + (segEnd - segStart) * t;
    }
  }

  return { distance: bestDistance, t: bestT };
}

export function createFinishLineMesh(
  centerline: LocalPoint[],
  origin: GeoOrigin,
  trackWidth: number,
): THREE.Mesh | null {
  const path = buildTrackPath(centerline);
  const geoLocal = geoToLocal(FINISH_LINE_GEO, origin);
  const projection = projectToPath(path, geoLocal);

  const halfBase = 0.01;
  const behind = samplePathPoint(path, projection.distance - halfBase);
  const ahead = samplePathPoint(path, projection.distance + halfBase);
  const tangent = new THREE.Vector3(ahead.x - behind.x, 0, ahead.z - behind.z);
  if (tangent.lengthSq() < 1e-8) return null;
  tangent.normalize();

  const across = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const center = samplePathPoint(path, projection.distance);

  const halfAcross = trackWidth * 0.5;
  const halfAlong = FINISH_BAND_DEPTH_M * 0.5;

  const p0 = {
    x: center.x - across.x * halfAcross - tangent.x * halfAlong,
    y: center.y,
    z: center.z - across.z * halfAcross - tangent.z * halfAlong,
  };
  const p1 = {
    x: center.x + across.x * halfAcross - tangent.x * halfAlong,
    y: center.y,
    z: center.z + across.z * halfAcross - tangent.z * halfAlong,
  };
  const p2 = {
    x: center.x + across.x * halfAcross + tangent.x * halfAlong,
    y: center.y,
    z: center.z + across.z * halfAcross + tangent.z * halfAlong,
  };
  const p3 = {
    x: center.x - across.x * halfAcross + tangent.x * halfAlong,
    y: center.y,
    z: center.z - across.z * halfAcross + tangent.z * halfAlong,
  };

  const lift = 0.045;
  const positions = new Float32Array([
    p0.x, p0.y + lift, p0.z,
    p1.x, p1.y + lift, p1.z,
    p2.x, p2.y + lift, p2.z,
    p3.x, p3.y + lift, p3.z,
  ]);

  const uAcross = trackWidth / FINISH_CHECKER_SIZE_M;
  const uAlong = FINISH_BAND_DEPTH_M / FINISH_CHECKER_SIZE_M;
  const uvs = new Float32Array([
    0, 0,
    uAcross, 0,
    uAcross, uAlong,
    0, uAlong,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const texture = createBwCheckerTexture();
  texture.repeat.set(1, 1);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.5,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  mesh.name = 'finish-line';
  mesh.receiveShadow = true;
  return mesh;
}

function samplePathPoint(path: TrackPathData, distance: number): LocalPoint {
  const { points, cumulative, totalLength } = path;
  const n = points.length;
  distance = ((distance % totalLength) + totalLength) % totalLength;

  let idx = 0;
  while (idx < n - 1 && cumulative[idx + 1] <= distance) idx++;

  const p0 = points[idx];
  const p1 = points[(idx + 1) % n];
  const segStart = cumulative[idx];
  const segEnd = idx < n - 1 ? cumulative[idx + 1] : totalLength;
  const t = (distance - segStart) / (segEnd - segStart || 1);

  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };
}
