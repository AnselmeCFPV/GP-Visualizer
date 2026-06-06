import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { distance2D } from '../utils/geo';
import { offsetClosedCurve } from '../utils/spline';

interface StandPlacement {
  x: number;
  y: number;
  z: number;
  angle: number;
  width: number;
  tiers: number;
}

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

function pickStandLocations(
  outer: LocalPoint[],
  asphaltInner: LocalPoint[],
  count: number,
): StandPlacement[] {
  const n = outer.length;
  const step = Math.floor(n / count);
  const locations: StandPlacement[] = [];

  // Extérieur du circuit : au-delà du gravier
  const standLine = offsetClosedCurve(outer, 58, false);

  for (let i = 0; i < count; i++) {
    const idx = (i * step + Math.floor(step / 2)) % n;
    const p = standLine[idx];
    const trackRef = outer[idx];

    if (pointInPolygon({ x: p.x, z: p.z }, asphaltInner)) continue;
    if (pointInPolygon({ x: p.x, z: p.z }, outer)) continue;

    const prev = standLine[(idx - 10 + n) % n];
    const next = standLine[(idx + 10) % n];
    const segLen = distance2D(prev, next);
    const isStraight = segLen > 80;

    const dx = trackRef.x - p.x;
    const dz = trackRef.z - p.z;
    const angle = Math.atan2(dx, dz);

    locations.push({
      x: p.x,
      y: p.y,
      z: p.z,
      angle,
      width: isStraight ? 70 : 45,
      tiers: isStraight ? 8 : 6,
    });
  }

  return locations;
}

function buildStand(
  loc: StandPlacement,
  structureMat: THREE.MeshStandardMaterial,
  seatMat: THREE.MeshStandardMaterial,
  roofMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const stand = new THREE.Group();

  for (let tier = 0; tier < loc.tiers; tier++) {
    const width = loc.width - tier * 1.5;
    const depth = 9;
    const height = 2.8;
    const geom = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geom, tier % 2 === 0 ? structureMat : seatMat);
    mesh.position.set(0, loc.y + tier * height + height / 2, tier * 2.2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    stand.add(mesh);
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(loc.width + 2, 0.5, 12 + loc.tiers * 2),
    roofMat,
  );
  roof.position.set(0, loc.y + loc.tiers * 2.8 + 1.5, loc.tiers * 1.1);
  roof.castShadow = true;
  stand.add(roof);

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(loc.width, 1.2, 0.2),
    structureMat,
  );
  rail.position.set(0, loc.y + loc.tiers * 2.8 + 2.8, loc.tiers * 2.2 + 4.5);
  stand.add(rail);

  stand.position.set(loc.x, 0, loc.z);
  stand.rotation.y = loc.angle;
  return stand;
}

export function createGrandstands(
  outerBorder: LocalPoint[],
  asphaltInner: LocalPoint[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grandstands';

  const structureMat = new THREE.MeshStandardMaterial({
    color: 0x7a8088,
    roughness: 0.75,
    metalness: 0.08,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x2a4a8a,
    roughness: 0.65,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.55,
    metalness: 0.2,
  });

  const placements = pickStandLocations(outerBorder, asphaltInner, 12);

  for (const loc of placements) {
    group.add(buildStand(loc, structureMat, seatMat, roofMat));
  }

  return group;
}
