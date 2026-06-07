export interface GeoPoint {
  lon: number;
  lat: number;
  elevation: number;
}

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackBorders {
  inner: GeoPoint[];
  outer: GeoPoint[];
}

export function distance2D(a: LocalPoint, b: LocalPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

export interface GeoOrigin {
  lon: number;
  lat: number;
  elevation: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Projection locale : X = Est, Y = altitude, Z = -Nord (repère Three.js) */
export function geoToLocal(point: GeoPoint, origin: GeoOrigin): LocalPoint {
  const dLon = ((point.lon - origin.lon) * Math.PI) / 180;
  const dLat = ((point.lat - origin.lat) * Math.PI) / 180;
  const latRad = (origin.lat * Math.PI) / 180;

  const x = dLon * Math.cos(latRad) * EARTH_RADIUS_M;
  const z = -dLat * EARTH_RADIUS_M;
  const y = point.elevation - origin.elevation;

  return { x, y, z };
}

/** Projection inverse : X = Est, Y = altitude, Z = -Nord (repère Three.js) */
export function localToGeo(point: LocalPoint, origin: GeoOrigin): GeoPoint {
  const latRad = (origin.lat * Math.PI) / 180;
  const lon = origin.lon + (point.x / (Math.cos(latRad) * EARTH_RADIUS_M)) * (180 / Math.PI);
  const lat = origin.lat - (point.z / EARTH_RADIUS_M) * (180 / Math.PI);
  const elevation = point.y + origin.elevation;
  return { lon, lat, elevation };
}

export function lerpPoint(a: LocalPoint, b: LocalPoint, t: number): LocalPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function haversineMeters(
  a: Pick<GeoPoint, 'lat' | 'lon'>,
  b: Pick<GeoPoint, 'lat' | 'lon'>,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
