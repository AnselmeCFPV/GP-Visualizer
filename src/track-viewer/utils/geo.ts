import type { GeoPoint, LocalPoint } from '../types';

const EARTH_RADIUS = 6_371_000;

export interface GeoOrigin {
  lon: number;
  lat: number;
  elevation: number;
}

/** Projection locale : X = Est, Y = altitude, Z = -Nord (repère Three.js) */
export function geoToLocal(point: GeoPoint, origin: GeoOrigin): LocalPoint {
  const dLon = ((point.lon - origin.lon) * Math.PI) / 180;
  const dLat = ((point.lat - origin.lat) * Math.PI) / 180;
  const latRad = (origin.lat * Math.PI) / 180;

  const x = dLon * Math.cos(latRad) * EARTH_RADIUS;
  const z = -dLat * EARTH_RADIUS;
  const y = point.elevation - origin.elevation;

  return { x, y, z };
}

export function computeOrigin(points: GeoPoint[]): GeoOrigin {
  const lon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const elevation = points.reduce((s, p) => s + p.elevation, 0) / points.length;
  return { lon, lat, elevation };
}

export function distance2D(a: LocalPoint, b: LocalPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export function distance3D(a: LocalPoint, b: LocalPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: LocalPoint, b: LocalPoint, t: number): LocalPoint {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}
