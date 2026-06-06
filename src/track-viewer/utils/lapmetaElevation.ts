import type { GeoPoint, LocalPoint } from '../types';
import { distance2D } from './geo';
import {
  LAPMETA_741_CONTROL_POINTS,
  LAPMETA_741_LENGTH,
  PRENOIS_START,
  PROFILE_START_ELEVATION,
} from '../data/prenois-lapmeta-741';

function catmullRomScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Construit une courbe d'élévation lissée (Catmull-Rom, boucle fermée) */
function buildSmoothElevationCurve(samplesPerSegment = 24): Float32Array {
  const ctrl = LAPMETA_741_CONTROL_POINTS;
  const n = ctrl.length;
  const out: number[] = [];

  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i1 = i;
    const i2 = (i + 1) % n;
    const i3 = (i + 2) % n;

    const d0 = ctrl[i0][0] + (i === 0 ? -LAPMETA_741_LENGTH : 0);
    const e0 = ctrl[i0][1];
    const d1 = ctrl[i1][0];
    const e1 = ctrl[i1][1];
    const d2 = ctrl[i2][0] + (i2 === 0 ? LAPMETA_741_LENGTH : 0);
    const e2 = ctrl[i2][1];
    const d3 = ctrl[i3][0] + (i3 <= 1 ? LAPMETA_741_LENGTH : 0);
    const e3 = ctrl[i3][1];

    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      const dist = catmullRomScalar(d0, d1, d2, d3, t);
      const elev = catmullRomScalar(e0, e1, e2, e3, t);
      out.push(dist, elev);
    }
  }

  const pairs: { d: number; e: number }[] = [];
  for (let i = 0; i < out.length; i += 2) {
    let d = out[i];
    if (d < 0) d += LAPMETA_741_LENGTH;
    if (d > LAPMETA_741_LENGTH) d -= LAPMETA_741_LENGTH;
    pairs.push({ d, e: out[i + 1] });
  }

  pairs.sort((a, b) => a.d - b.d);

  const deduped: { d: number; e: number }[] = [];
  for (const p of pairs) {
    if (deduped.length === 0 || Math.abs(p.d - deduped[deduped.length - 1].d) > 0.5) {
      deduped.push(p);
    }
  }

  const result = new Float32Array(deduped.length * 2);
  for (let i = 0; i < deduped.length; i++) {
    result[i * 2] = deduped[i].d;
    result[i * 2 + 1] = deduped[i].e;
  }
  return result;
}

let smoothCurve: Float32Array | null = null;

function getSmoothCurve(): Float32Array {
  if (!smoothCurve) smoothCurve = buildSmoothElevationCurve(28);
  return smoothCurve;
}

/** Altitude absolue du graphique LapMeta à une distance donnée (m) */
export function elevationAtDistance(distanceMeters: number): number {
  const curve = getSmoothCurve();
  const count = curve.length / 2;
  let d = ((distanceMeters % LAPMETA_741_LENGTH) + LAPMETA_741_LENGTH) % LAPMETA_741_LENGTH;

  for (let i = 1; i < count; i++) {
    const d0 = curve[(i - 1) * 2];
    const e0 = curve[(i - 1) * 2 + 1];
    const d1 = curve[i * 2];
    const e1 = curve[i * 2 + 1];

    if (d <= d1 || i === count - 1) {
      const span = d1 - d0 || 1;
      const t = Math.max(0, Math.min(1, (d - d0) / span));
      const smooth = t * t * (3 - 2 * t);
      return e0 + (e1 - e0) * smooth;
    }
  }
  return curve[1];
}

/** Altitude locale (départ = 0 m) */
export function localElevationAtDistance(distanceMeters: number): number {
  return elevationAtDistance(distanceMeters) - PROFILE_START_ELEVATION;
}

/** Altitude locale lissée sur une fenêtre (évite les à-coups caméra sur le dénivelé) */
export function smoothLocalElevationAtDistance(
  distanceMeters: number,
  windowM = 22,
): number {
  const offsets = [-windowM, -windowM * 0.45, -windowM * 0.15, 0, windowM * 0.15, windowM * 0.45, windowM];
  const weights = [0.07, 0.12, 0.18, 0.26, 0.18, 0.12, 0.07];
  let sum = 0;
  for (let i = 0; i < offsets.length; i++) {
    sum += localElevationAtDistance(distanceMeters + offsets[i]) * weights[i];
  }
  return sum;
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findClosestIndexGeo(points: GeoPoint[], target: GeoPoint): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i].lon - target.lon) ** 2 + (points[i].lat - target.lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function rotateClosed<T>(items: T[], startIndex: number): T[] {
  if (startIndex <= 0) return items;
  return [...items.slice(startIndex), ...items.slice(0, startIndex)];
}

/**
 * Aligne le tracé sur le point de départ et applique le profil LapMeta 741.
 */
export async function enrichWithLapmetaProfile(outerGeo: GeoPoint[]): Promise<GeoPoint[]> {
  const startIdx = findClosestIndexGeo(outerGeo, {
    lon: PRENOIS_START.lon,
    lat: PRENOIS_START.lat,
    elevation: 0,
  });
  const rotated = rotateClosed(outerGeo, startIdx);

  const n = rotated.length;
  const arc = [0];
  let total = 0;

  for (let i = 1; i < n; i++) {
    total += haversineMeters(rotated[i - 1], rotated[i]);
    arc.push(total);
  }
  total += haversineMeters(rotated[n - 1], rotated[0]);
  const scale = LAPMETA_741_LENGTH / total;

  return rotated.map((p, i) => ({
    ...p,
    elevation: elevationAtDistance(arc[i] * scale),
  }));
}

/** Ré-applique le profil lissé sur une boucle locale (Y relatif au départ) */
export function applyLapmetaProfileLocal(points: LocalPoint[]): LocalPoint[] {
  const n = points.length;
  const arc = [0];
  let total = 0;

  for (let i = 1; i < n; i++) {
    total += distance2D(points[i - 1], points[i]);
    arc.push(total);
  }
  total += distance2D(points[n - 1], points[0]);
  const scale = LAPMETA_741_LENGTH / total;

  return points.map((p, i) => ({
    ...p,
    y: localElevationAtDistance(arc[i] * scale),
  }));
}
