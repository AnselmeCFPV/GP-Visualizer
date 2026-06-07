import type { GeoOrigin, LocalPoint, TrackBorders } from '@prenois/geo';
import { distance2D, geoToLocal, localToGeo } from '@prenois/geo';

export interface TrackCorridor {
  origin: GeoOrigin;
  outerLocal: LocalPoint[];
  innerLocal: LocalPoint[];
}

/** Midline KML (moyenne int./ext.) — ordre le long du circuit, sans projection synthétique. */
export interface CorridorMidline {
  origin: GeoOrigin;
  local: LocalPoint[];
  lat: number[];
  lon: number[];
  arcM: number[];
  totalLength: number;
  averageWidthM: number;
  minWidthM: number;
}

/** Couloir routier aligné sur les bordures KML (même géométrie que l'affichage Leaflet). */
export function buildTrackCorridor(borders: TrackBorders): TrackCorridor {
  const origin: GeoOrigin = {
    lon: borders.outer[0]!.lon,
    lat: borders.outer[0]!.lat,
    elevation: borders.outer[0]!.elevation,
  };
  return {
    origin,
    outerLocal: borders.outer.map((p) => geoToLocal(p, origin)),
    innerLocal: borders.inner.map((p) => geoToLocal(p, origin)),
  };
}

function normalizeClosedLoop(points: LocalPoint[]): LocalPoint[] {
  if (points.length < 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return distance2D(first, last) < 0.01 ? points.slice(0, -1) : points;
}

function resampleClosedLoop(points: LocalPoint[], count: number): LocalPoint[] {
  const loop = normalizeClosedLoop(points);
  const closed = [...loop, loop[0]!];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const d = distance2D(closed[i]!, closed[i + 1]!);
    segLens.push(d);
    total += d;
  }
  if (total === 0) return points.slice(0, count);

  const result: LocalPoint[] = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    let acc = 0;
    for (let i = 0; i < segLens.length; i++) {
      if (acc + segLens[i]! >= target || i === segLens.length - 1) {
        const t = segLens[i]! > 0 ? (target - acc) / segLens[i]! : 0;
        result.push({
          x: closed[i]!.x + (closed[i + 1]!.x - closed[i]!.x) * t,
          y: closed[i]!.y + (closed[i + 1]!.y - closed[i]!.y) * t,
          z: closed[i]!.z + (closed[i + 1]!.z - closed[i]!.z) * t,
        });
        break;
      }
      acc += segLens[i]!;
    }
  }
  return result;
}

function rotateClosedLoop(points: LocalPoint[], shift: number): LocalPoint[] {
  const n = points.length;
  return points.map((_, i) => points[(i + shift) % n]!);
}

function loopAlignmentCost(reference: LocalPoint[], candidate: LocalPoint[], shift: number): number {
  const n = reference.length;
  const stride = Math.max(1, Math.floor(n / 240));
  let cost = 0;
  let samples = 0;

  for (let i = 0; i < n; i += stride) {
    const a = reference[i]!;
    const b = candidate[(i + shift) % n]!;
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    cost += dx * dx + dz * dz;
    samples++;
  }

  return cost / Math.max(1, samples);
}

function alignLoopToReference(reference: LocalPoint[], candidate: LocalPoint[]): LocalPoint[] {
  const reversed = [...candidate].reverse();
  let bestCandidate = candidate;
  let bestShift = 0;
  let bestCost = Infinity;

  for (const loop of [candidate, reversed]) {
    for (let shift = 0; shift < loop.length; shift++) {
      const cost = loopAlignmentCost(reference, loop, shift);
      if (cost < bestCost) {
        bestCost = cost;
        bestShift = shift;
        bestCandidate = loop;
      }
    }
  }

  return rotateClosedLoop(bestCandidate, bestShift);
}

function buildArcLength(local: LocalPoint[]): { arcM: number[]; totalLength: number } {
  const n = local.length;
  const arcM = [0];
  for (let i = 1; i < n; i++) {
    arcM.push(arcM[i - 1]! + distance2D(local[i - 1]!, local[i]!));
  }
  const closing = distance2D(local[n - 1]!, local[0]!);
  return { arcM, totalLength: arcM[n - 1]! + closing };
}

export interface MidlineFrame {
  point: LocalPoint;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

/** Point + repère tangent/normal sur la midline à une distance d'arc donnée. */
export function midlineFrameAtArc(midline: CorridorMidline, arcM: number): MidlineFrame {
  const n = midline.local.length;
  const s = ((arcM % midline.totalLength) + midline.totalLength) % midline.totalLength;
  let idx = 0;
  while (idx < n - 1 && (midline.arcM[idx + 1] ?? midline.totalLength) <= s) idx++;

  const p0 = midline.local[idx]!;
  const p1 = midline.local[(idx + 1) % n]!;
  const segStart = midline.arcM[idx] ?? 0;
  const segEnd = idx < n - 1 ? midline.arcM[idx + 1]! : midline.totalLength;
  const t = segEnd > segStart ? (s - segStart) / (segEnd - segStart) : 0;

  const point: LocalPoint = {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };

  const prev = midline.local[(idx - 1 + n) % n]!;
  const next = midline.local[(idx + 1) % n]!;
  let tx = next.x - prev.x;
  let tz = next.z - prev.z;
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;

  return { point, tx, tz, nx: -tz, nz: tx };
}

function intersectLineSegment2D(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  const sx = bx - ax;
  const sz = bz - az;
  const det = dx * sz - dz * sx;
  if (Math.abs(det) < 1e-12) return null;

  const ex = ax - ox;
  const ez = az - oz;
  const t = (ex * sz - ez * sx) / det;
  const u = (dx * ez - dz * ex) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

function signedLateralAtFrame(
  frame: MidlineFrame,
  x: number,
  z: number,
): number {
  return (x - frame.point.x) * frame.nx + (z - frame.point.z) * frame.nz;
}

/**
 * Point sur la bordure int./ext. à une station d'arc : intersection de la normale
 * à la midline avec le polygone KML (pas de recherche au voisinage).
 */
export function corridorBorderAtArc(
  corridor: TrackCorridor,
  midline: CorridorMidline,
  arcM: number,
  edge: 'outer' | 'inner',
): LocalPoint {
  const frame = midlineFrameAtArc(midline, arcM);
  const poly = edge === 'outer' ? corridor.outerLocal : corridor.innerLocal;
  const alongGateM = Math.max(8, zoneLengthHintM(corridor) * 0.75);

  let bestLat = edge === 'outer' ? -Infinity : Infinity;
  let bestPoint: LocalPoint | null = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const lateralT = intersectLineSegment2D(
      frame.point.x,
      frame.point.z,
      frame.nx,
      frame.nz,
      a.x,
      a.z,
      b.x,
      b.z,
    );
    if (lateralT === null) continue;

    const px = frame.point.x + frame.nx * lateralT;
    const pz = frame.point.z + frame.nz * lateralT;
    const along =
      (px - frame.point.x) * frame.tx + (pz - frame.point.z) * frame.tz;
    if (Math.abs(along) > alongGateM) continue;

    if (edge === 'outer' && lateralT > bestLat) {
      bestLat = lateralT;
      bestPoint = { x: px, y: frame.point.y, z: pz };
    } else if (edge === 'inner' && lateralT < bestLat) {
      bestLat = lateralT;
      bestPoint = { x: px, y: frame.point.y, z: pz };
    }
  }

  if (bestPoint) return bestPoint;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    for (const p of [a, b]) {
      const along =
        (p.x - frame.point.x) * frame.tx + (p.z - frame.point.z) * frame.tz;
      if (Math.abs(along) > alongGateM) continue;
      const lat = signedLateralAtFrame(frame, p.x, p.z);
      if (edge === 'outer' && lat > bestLat) {
        bestLat = lat;
        bestPoint = { x: p.x, y: p.y, z: p.z };
      } else if (edge === 'inner' && lat < bestLat) {
        bestLat = lat;
        bestPoint = { x: p.x, y: p.y, z: p.z };
      }
    }
  }

  return (
    bestPoint ?? {
      x: frame.point.x + frame.nx * (edge === 'outer' ? 5 : -5),
      y: frame.point.y,
      z: frame.point.z + frame.nz * (edge === 'outer' ? 5 : -5),
    }
  );
}

function zoneLengthHintM(corridor: TrackCorridor): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of corridor.outerLocal) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return Math.max(12, Math.hypot(maxX - minX, maxZ - minZ) * 0.02);
}

/** Midline entre bordures KML, stations régulières le long de l'arc (~1 m). */
export function buildCorridorMidline(
  borders: TrackBorders,
  stationStepM = 1,
): CorridorMidline {
  const corridor = buildTrackCorridor(borders);
  let roughLen = 0;
  const outer = corridor.outerLocal;
  for (let i = 0; i < outer.length; i++) {
    roughLen += distance2D(outer[i]!, outer[(i + 1) % outer.length]!);
  }
  const n = Math.max(48, Math.ceil(roughLen / Math.max(0.5, stationStepM)));
  const outerRs = resampleClosedLoop(corridor.outerLocal, n);
  const innerRs = alignLoopToReference(outerRs, resampleClosedLoop(corridor.innerLocal, n));
  const widths = outerRs.map((outer, i) => distance2D(outer, innerRs[i]!));
  const averageWidthM = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const minWidthM = Math.min(...widths);

  const local: LocalPoint[] = outerRs.map((outer, i) => {
    const inner = innerRs[i]!;
    return {
      x: (outer.x + inner.x) / 2,
      y: (outer.y + inner.y) / 2,
      z: (outer.z + inner.z) / 2,
    };
  });

  const { arcM, totalLength } = buildArcLength(local);
  const lat: number[] = [];
  const lon: number[] = [];
  for (const p of local) {
    const geo = localToGeo(p, corridor.origin);
    lat.push(geo.lat);
    lon.push(geo.lon);
  }

  return { origin: corridor.origin, local, lat, lon, arcM, totalLength, averageWidthM, minWidthM };
}

function closestOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { cx: number; cz: number; t: number; distSq: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-12) {
    t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  return { cx, cz, t, distSq: ex * ex + ez * ez };
}

export interface MidlineProjection {
  arcM: number;
  distanceM: number;
}

/** Aligne une distance d'arc candidate autour d'une référence (boucle fermée). */
export function unwrapMidlineArcNear(
  midline: CorridorMidline,
  referenceM: number,
  candidateM: number,
): number {
  const total = midline.totalLength;
  let c = candidateM;
  while (c < referenceM - total * 0.5) c += total;
  while (c > referenceM + total * 0.5) c -= total;
  return c;
}

export interface MidlineHintOptions {
  searchWindowM?: number;
  /** Pénalise les projections en arrière le long de la piste. */
  forwardBias?: number;
}

/**
 * Projette un GPS sur la midline dans une fenêtre autour d'un arc de référence
 * (évite les sauts vers une autre partie du circuit sur les lignes droites).
 */
export function projectGpsToCorridorMidlineHinted(
  midline: CorridorMidline,
  lat: number,
  lon: number,
  hintArcM: number,
  options: MidlineHintOptions = {},
): MidlineProjection {
  const local = geoToLocal({ lon, lat, elevation: 0 }, midline.origin);
  const n = midline.local.length;
  const searchWindowM = options.searchWindowM ?? 80;
  const forwardBias = options.forwardBias ?? 0.06;

  let startIdx = 0;
  if (hintArcM > 0 && midline.totalLength > 0) {
    const frac = (hintArcM % midline.totalLength) / midline.totalLength;
    startIdx = Math.floor(frac * n);
  }

  const windowSteps = Math.max(12, Math.ceil((searchWindowM / midline.totalLength) * n));
  const backSteps = Math.floor(windowSteps * 0.2);
  const forwardSteps = windowSteps - backSteps;

  let bestScore = Infinity;
  let bestArcM = 0;
  let bestDistSq = 0;

  for (let di = -backSteps; di <= forwardSteps; di++) {
    const i = (startIdx + di + n) % n;
    const p0 = midline.local[i]!;
    const p1 = midline.local[(i + 1) % n]!;
    const hit = closestOnSegment(local.x, local.z, p0.x, p0.z, p1.x, p1.z);

    const segStart = midline.arcM[i]!;
    const segEnd = i < n - 1 ? midline.arcM[i + 1]! : midline.totalLength;
    const arcM = segStart + (segEnd - segStart) * hit.t;
    const unwrapped = hintArcM > 0 ? unwrapMidlineArcNear(midline, hintArcM, arcM) : arcM;
    const backwardM = Math.max(0, hintArcM - unwrapped);
    const score = hit.distSq + backwardM * backwardM * forwardBias;

    if (score < bestScore) {
      bestScore = score;
      bestArcM = unwrapped;
      bestDistSq = hit.distSq;
    }
  }

  return { arcM: bestArcM, distanceM: Math.sqrt(bestDistSq) };
}

/** Infère la position le long du circuit (arc midline) depuis lat/lon — recherche globale. */
export function projectGpsToCorridorMidline(
  midline: CorridorMidline,
  lat: number,
  lon: number,
): MidlineProjection {
  const local = geoToLocal({ lon, lat, elevation: 0 }, midline.origin);
  const n = midline.local.length;

  let bestDistSq = Infinity;
  let bestArcM = 0;

  for (let i = 0; i < n; i++) {
    const p0 = midline.local[i]!;
    const p1 = midline.local[(i + 1) % n]!;
    const hit = closestOnSegment(local.x, local.z, p0.x, p0.z, p1.x, p1.z);
    const segStart = midline.arcM[i]!;
    const segEnd = i < n - 1 ? midline.arcM[i + 1]! : midline.totalLength;
    const arc = segStart + (segEnd - segStart) * hit.t;

    if (hit.distSq < bestDistSq) {
      bestDistSq = hit.distSq;
      bestArcM = arc;
    }
  }

  return { arcM: bestArcM, distanceM: Math.sqrt(bestDistSq) };
}

/** Ray casting 2D (plan XZ local). */
function pointInPolygonXZ(x: number, z: number, polygon: LocalPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.x;
    const zi = polygon[i]!.z;
    const xj = polygon[j]!.x;
    const zj = polygon[j]!.z;
    const crosses =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * Point sur la route = dans le polygone extérieur ET hors du polygone intérieur
 * (anneau entre les deux bordures KML).
 */
export function isGpsInTrackCorridor(
  corridor: TrackCorridor,
  lat: number,
  lon: number,
): boolean {
  const local = geoToLocal({ lon, lat, elevation: 0 }, corridor.origin);
  const inOuter = pointInPolygonXZ(local.x, local.z, corridor.outerLocal);
  if (!inOuter) return false;
  const inInner = pointInPolygonXZ(local.x, local.z, corridor.innerLocal);
  return !inInner;
}

function closestPointOnPolyline(
  x: number,
  z: number,
  polygon: LocalPoint[],
): { point: LocalPoint; distSq: number } {
  let bestDistSq = Infinity;
  let bestPoint = polygon[0]!;

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const hit = closestOnSegment(x, z, a.x, a.z, b.x, b.z);
    if (hit.distSq < bestDistSq) {
      bestDistSq = hit.distSq;
      bestPoint = { x: hit.cx, y: a.y + (b.y - a.y) * hit.t, z: hit.cz };
    }
  }

  return { point: bestPoint, distSq: bestDistSq };
}

export interface ClampedGpsPoint {
  lat: number;
  lon: number;
  clamped: boolean;
}

/** Ramène un point hors couloir sur la bordure int./ext. la plus proche. */
export function clampGpsToTrackCorridor(
  corridor: TrackCorridor,
  lat: number,
  lon: number,
): ClampedGpsPoint {
  if (isGpsInTrackCorridor(corridor, lat, lon)) {
    return { lat, lon, clamped: false };
  }

  const local = geoToLocal({ lon, lat, elevation: 0 }, corridor.origin);
  const outerHit = closestPointOnPolyline(local.x, local.z, corridor.outerLocal);
  const innerHit = closestPointOnPolyline(local.x, local.z, corridor.innerLocal);
  const best = outerHit.distSq <= innerHit.distSq ? outerHit.point : innerHit.point;
  const geo = localToGeo(best, corridor.origin);
  return { lat: geo.lat, lon: geo.lon, clamped: true };
}

function pseudoRandomSigned(lat: number, lon: number, salt = 0): number {
  const s = Math.sin((lat + salt) * 12.9898 + (lon + salt) * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export interface ClampToCenterOptions {
  /** Écart latéral max autour du centre (m). */
  lateralSpreadM?: number;
}

function lateralBoundsAtArc(
  corridor: TrackCorridor,
  midline: CorridorMidline,
  arcM: number,
  frame: MidlineFrame,
): { latMin: number; latMax: number } {
  const outer = corridorBorderAtArc(corridor, midline, arcM, 'outer');
  const inner = corridorBorderAtArc(corridor, midline, arcM, 'inner');
  const latOuter = signedLateralAtFrame(frame, outer.x, outer.z);
  const latInner = signedLateralAtFrame(frame, inner.x, inner.z);
  const margin = 0.96;
  return {
    latMin: Math.min(latInner, latOuter) * margin,
    latMax: Math.max(latInner, latOuter) * margin,
  };
}

function localFromLateral(frame: MidlineFrame, lateralM: number): LocalPoint {
  return {
    x: frame.point.x + frame.nx * lateralM,
    y: frame.point.y,
    z: frame.point.z + frame.nz * lateralM,
  };
}

function centerJitterLateral(
  lat: number,
  lon: number,
  spread: number,
  latMin: number,
  latMax: number,
): number {
  const raw =
    pseudoRandomSigned(lat, lon) * spread * 0.55 +
    pseudoRandomSigned(lat, lon, 1.7) * spread * 0.45;
  return Math.max(latMin, Math.min(latMax, raw));
}

/**
 * Projette chaque point sur la bande de piste (midline + offset latéral borné).
 * Hors bande → centre + jitter pseudo-aléatoire (stable par lat/lon).
 */
export function clampGpsToTrackCenter(
  corridor: TrackCorridor,
  midline: CorridorMidline,
  lat: number,
  lon: number,
  options: ClampToCenterOptions = {},
): ClampedGpsPoint {
  const proj = projectGpsToCorridorMidline(midline, lat, lon);
  const frame = midlineFrameAtArc(midline, proj.arcM);
  const local = geoToLocal({ lon, lat, elevation: 0 }, midline.origin);
  const lateralGps = signedLateralAtFrame(frame, local.x, local.z);
  const { latMin, latMax } = lateralBoundsAtArc(corridor, midline, proj.arcM, frame);

  const onStrip = lateralGps >= latMin && lateralGps <= latMax;
  const inPolygon = isGpsInTrackCorridor(corridor, lat, lon);
  const farFromMidline = proj.distanceM > midline.averageWidthM * 0.55;

  const halfWidth = midline.averageWidthM * 0.5;
  const spread = options.lateralSpreadM ?? halfWidth * 0.65;

  let finalLateral: number;
  let clamped = false;

  if (onStrip && inPolygon && !farFromMidline) {
    finalLateral = lateralGps;
  } else {
    finalLateral = centerJitterLateral(lat, lon, spread, latMin, latMax);
    clamped = true;
  }

  finalLateral = Math.max(latMin, Math.min(latMax, finalLateral));
  if (Math.abs(finalLateral - lateralGps) > 0.2) {
    clamped = true;
  }

  let geo = localToGeo(localFromLateral(frame, finalLateral), midline.origin);

  if (!isGpsInTrackCorridor(corridor, geo.lat, geo.lon)) {
    finalLateral = centerJitterLateral(lat, lon, spread * 0.5, latMin, latMax);
    geo = localToGeo(localFromLateral(frame, finalLateral), midline.origin);
    clamped = true;
  }

  return { lat: geo.lat, lon: geo.lon, clamped };
}

export interface SnapToCenterOptions {
  /** Au-delà de cette distance (m) à la midline, le point est ramené au centre. */
  maxDistFromCenterM: number;
  /** Léger jitter latéral autour du centre (m). */
  jitterSpreadM?: number;
}

export interface SnappedGpsPoint {
  lat: number;
  lon: number;
  snapped: boolean;
  distToCenterM: number;
}

/**
 * Garde la position GPS si proche du centre de piste.
 * Sinon, replace sur la midline (+ petit jitter stable par lat/lon).
 */
export function snapFarGpsToTrackCenter(
  midline: CorridorMidline,
  lat: number,
  lon: number,
  options: SnapToCenterOptions,
): SnappedGpsPoint {
  const proj = projectGpsToCorridorMidline(midline, lat, lon);

  if (proj.distanceM <= options.maxDistFromCenterM) {
    return { lat, lon, snapped: false, distToCenterM: proj.distanceM };
  }

  const frame = midlineFrameAtArc(midline, proj.arcM);
  const jitterSpread = options.jitterSpreadM ?? midline.averageWidthM * 0.12;
  const lateral =
    pseudoRandomSigned(lat, lon) * jitterSpread * 0.6 +
    pseudoRandomSigned(lat, lon, 2.3) * jitterSpread * 0.4;

  const geo = localToGeo(localFromLateral(frame, lateral), midline.origin);
  const distAfter = projectGpsToCorridorMidline(midline, geo.lat, geo.lon).distanceM;

  return { lat: geo.lat, lon: geo.lon, snapped: true, distToCenterM: distAfter };
}
