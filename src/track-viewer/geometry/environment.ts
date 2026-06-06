import * as THREE from 'three';
import type { LocalPoint } from '../types';
import type { TrackExclusion, TrackGeometry } from './trackSurface';
import { distance2D } from '../utils/geo';
import type { SurfaceTextures } from '../utils/textures';

const GRASS_BELOW_TRACK = 0.85;

function pointInPolygon(point: { x: number; z: number }, polygon: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersect =
      zi > point.z !== zj > point.z &&
      point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToPolygonEdge(point: { x: number; z: number }, polygon: LocalPoint[]): number {
  let min = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / len2)) : 0;
    const px = a.x + t * dx;
    const pz = a.z + t * dz;
    min = Math.min(min, Math.hypot(point.x - px, point.z - pz));
  }
  return min;
}

/** Altitude de référence du circuit au plus proche (interpolation sur la bordure) */
function nearestTrackHeight(x: number, z: number, outerBorder: LocalPoint[]): number {
  let bestY = outerBorder[0].y;
  let bestDist = Infinity;

  const n = outerBorder.length;
  for (let i = 0; i < n; i++) {
    const a = outerBorder[i];
    const b = outerBorder[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const px = a.x + t * dx;
    const pz = a.z + t * dz;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestY = a.y + t * (b.y - a.y);
    }
  }
  return bestY;
}

function sampleGrassHeight(
  x: number,
  z: number,
  outerBorder: LocalPoint[],
  track: TrackGeometry,
): number {
  const trackY = nearestTrackHeight(x, z, outerBorder);
  const edgeDist = distToPolygonEdge({ x, z }, outerBorder);

  if (edgeDist < 120) {
    return trackY - GRASS_BELOW_TRACK;
  }

  const farY = nearestTrackHeight(x, z, outerBorder) - 1.2;
  const insideOuter = pointInPolygon({ x, z }, outerBorder);
  const insideInner = pointInPolygon({ x, z }, track.asphaltInner);

  if (insideOuter && !insideInner) {
    return trackY - GRASS_BELOW_TRACK * 0.9;
  }

  return farY;
}

type TerrainZone = 'meadow' | 'grass' | 'forest';

function classifyTerrain(
  x: number,
  z: number,
  outerBorder: LocalPoint[],
  asphaltInner: LocalPoint[],
): TerrainZone {
  const insideOuter = pointInPolygon({ x, z }, outerBorder);
  const insideInner = pointInPolygon({ x, z }, asphaltInner);
  const edgeDist = distToPolygonEdge({ x, z }, outerBorder);

  if (insideInner) return 'meadow';
  if (insideOuter) return 'meadow';
  if (edgeDist < 90) return 'grass';
  return 'forest';
}

export function createTerrainMeshes(
  outerBorder: LocalPoint[],
  track: TrackGeometry,
  radius: number,
  textures: SurfaceTextures,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';

  const cx = outerBorder.reduce((s, p) => s + p.x, 0) / outerBorder.length;
  const cz = outerBorder.reduce((s, p) => s + p.z, 0) / outerBorder.length;
  const maxR =
    Math.max(...outerBorder.map((p) => distance2D(p, { x: cx, y: 0, z: cz }))) + radius;

  const segments = 160;
  const geometry = new THREE.PlaneGeometry(maxR * 2, maxR * 2, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);

  const meadow = new THREE.Color('#5d9a52');
  const grass = new THREE.Color('#4a7c44');
  const forest = new THREE.Color('#1e3a24');

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + cx;
    const z = positions.getZ(i) + cz;
    positions.setY(i, sampleGrassHeight(x, z, outerBorder, track));

    const zone = classifyTerrain(x, z, outerBorder, track.asphaltInner);
    const c = zone === 'meadow' ? meadow : zone === 'grass' ? grass : forest;
    const noise = 0.92 + Math.random() * 0.08;
    colors[i * 3] = c.r * noise;
    colors[i * 3 + 1] = c.g * noise;
    colors[i * 3 + 2] = c.b * noise;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: textures.grass,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  mesh.name = 'terrain-base';
  group.add(mesh);

  return group;
}

function isOnTrack(x: number, z: number, zone: TrackExclusion): boolean {
  return pointInPolygon({ x, z }, zone.kerbOuter) && !pointInPolygon({ x, z }, zone.kerbInner);
}

function isOnRunoff(
  x: number,
  z: number,
  kerbOuter: LocalPoint[],
  kerbInner: LocalPoint[],
  outerFar: LocalPoint[],
  innerFar: LocalPoint[],
): boolean {
  const pt = { x, z };
  const onOuter = pointInPolygon(pt, outerFar) && !pointInPolygon(pt, kerbOuter);
  const onInner = pointInPolygon(pt, kerbInner) && !pointInPolygon(pt, innerFar);
  return onOuter || onInner;
}

function createTreeMeshPair(count: number): {
  trunks: THREE.InstancedMesh;
  foliage: THREE.InstancedMesh;
} {
  const trunkGeom = new THREE.CylinderGeometry(0.35, 0.55, 4, 6);
  trunkGeom.translate(0, 2, 0);
  const foliageGeom = new THREE.DodecahedronGeometry(2.8, 0);
  foliageGeom.translate(0, 6.5, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.95 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2a5a28, roughness: 0.9 });

  const trunks = new THREE.InstancedMesh(trunkGeom, trunkMat, count);
  const foliage = new THREE.InstancedMesh(foliageGeom, foliageMat, count);
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;

  return { trunks, foliage };
}

export function createTreeInstances(
  exclusion: TrackExclusion,
  outerBorder: LocalPoint[],
  asphaltInner: LocalPoint[],
  runoff?: { outerFar: LocalPoint[]; innerFar: LocalPoint[] },
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';

  const forestCount = 900;
  const meadowCount = 120;
  const { trunks: fTrunks, foliage: fFoliage } = createTreeMeshPair(forestCount);
  const { trunks: mTrunks, foliage: mFoliage } = createTreeMeshPair(meadowCount);

  const xs = outerBorder.map((p) => p.x);
  const zs = outerBorder.map((p) => p.z);
  const minX = Math.min(...xs) - 60;
  const maxX = Math.max(...xs) + 60;
  const minZ = Math.min(...zs) - 60;
  const maxZ = Math.max(...zs) + 60;

  const dummy = new THREE.Object3D();
  let fPlaced = 0;
  let mPlaced = 0;
  let attempts = 0;

  while ((fPlaced < forestCount || mPlaced < meadowCount) && attempts < 25000) {
    attempts++;
    const x = minX + Math.random() * (maxX - minX);
    const z = minZ + Math.random() * (maxZ - minZ);

    if (isOnTrack(x, z, exclusion)) continue;
    if (
      runoff &&
      isOnRunoff(
        x,
        z,
        exclusion.kerbOuter,
        exclusion.kerbInner,
        runoff.outerFar,
        runoff.innerFar,
      )
    ) {
      continue;
    }

    const insideInner = pointInPolygon({ x, z }, asphaltInner);
    const insideOuter = pointInPolygon({ x, z }, outerBorder);
    const edgeDist = distToPolygonEdge({ x, z }, outerBorder);
    const isMeadow = insideOuter && !insideInner;

    if (isMeadow) {
      if (mPlaced >= meadowCount || Math.random() > 0.35) continue;
      dummy.scale.setScalar(0.5 + Math.random() * 0.5);
    } else {
      if (fPlaced >= forestCount) continue;
      if (edgeDist < 55) continue;
      dummy.scale.setScalar(0.8 + Math.random() * 1.2);
    }

    const y = nearestTrackHeight(x, z, outerBorder) - GRASS_BELOW_TRACK;
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.updateMatrix();

    if (isMeadow) {
      mTrunks.setMatrixAt(mPlaced, dummy.matrix);
      mFoliage.setMatrixAt(mPlaced, dummy.matrix);
      mPlaced++;
    } else {
      fTrunks.setMatrixAt(fPlaced, dummy.matrix);
      fFoliage.setMatrixAt(fPlaced, dummy.matrix);
      fPlaced++;
    }
  }

  fTrunks.count = fPlaced;
  fFoliage.count = fPlaced;
  mTrunks.count = mPlaced;
  mFoliage.count = mPlaced;
  fTrunks.instanceMatrix.needsUpdate = true;
  fFoliage.instanceMatrix.needsUpdate = true;
  mTrunks.instanceMatrix.needsUpdate = true;
  mFoliage.instanceMatrix.needsUpdate = true;

  group.add(fTrunks, fFoliage, mTrunks, mFoliage);
  return group;
}
