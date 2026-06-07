import type { GeoOrigin, GeoPoint, LocalPoint, TrackBorders } from '@prenois/geo';
import { distance2D, geoToLocal, localToGeo } from '@prenois/geo';
import { offsetClosedCurve, smoothClosedBorder } from './spline';

export interface TrackReferenceOptions {
  trackWidth?: number;
}

export interface TrackReference {
  origin: GeoOrigin;
  centerline: LocalPoint[];
  inner: LocalPoint[];
  outer: LocalPoint[];
  cumulative: number[];
  totalLength: number;
  /** Limite intérieure (négatif) / extérieure (positif) par station */
  lateralInnerM: number[];
  lateralOuterM: number[];
}

function buildCumulative(points: LocalPoint[]): { cumulative: number[]; totalLength: number } {
  const n = points.length;
  const cumulative = [0];
  for (let i = 1; i < n; i++) {
    cumulative.push(cumulative[i - 1]! + distance2D(points[i - 1]!, points[i]!));
  }
  const closing = distance2D(points[n - 1]!, points[0]!);
  return { cumulative, totalLength: cumulative[n - 1]! + closing };
}

/** Référentiel piste aligné sur le lissage 3D (centerline + bordures KML). */
export function buildTrackReference(
  borders: TrackBorders,
  options: TrackReferenceOptions = {},
): TrackReference {
  const trackWidth = options.trackWidth ?? 10;
  const origin: GeoOrigin = {
    lon: borders.outer[0]!.lon,
    lat: borders.outer[0]!.lat,
    elevation: borders.outer[0]!.elevation,
  };

  const outerLocal = borders.outer.map((p) => geoToLocal(p, origin));
  const innerLocal = borders.inner.map((p) => geoToLocal(p, origin));

  const outer = smoothClosedBorder(outerLocal, {
    chaikinIterations: 2,
    samplesPerSegment: 24,
    arcStepMeters: 1.2,
  });
  const inner = smoothClosedBorder(innerLocal, {
    chaikinIterations: 2,
    samplesPerSegment: 24,
    arcStepMeters: 1.2,
  });
  const centerline = offsetClosedCurve(outer, trackWidth * 0.5, true);

  const n = centerline.length;
  const innerResampled = inner.length === n ? inner : resampleLoopToCount(inner, n);
  const outerResampled = outer.length === n ? outer : resampleLoopToCount(outer, n);

  const { cumulative, totalLength } = buildCumulative(centerline);
  const lateralInnerM: number[] = [];
  const lateralOuterM: number[] = [];

  for (let i = 0; i < n; i++) {
    const c = centerline[i]!;
    const { nx, nz } = tangentNormalAt(centerline, i);
    const innerLat = signedLateral(c, innerResampled[i]!, nx, nz);
    const outerLat = signedLateral(c, outerResampled[i]!, nx, nz);
    lateralInnerM.push(Math.min(innerLat, outerLat));
    lateralOuterM.push(Math.max(innerLat, outerLat));
  }

  return {
    origin,
    centerline,
    inner: innerResampled,
    outer: outerResampled,
    cumulative,
    totalLength,
    lateralInnerM,
    lateralOuterM,
  };
}

function resampleLoopToCount(points: LocalPoint[], count: number): LocalPoint[] {
  const closed = [...points, points[0]!];
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

function tangentNormalAt(points: LocalPoint[], index: number): { tx: number; tz: number; nx: number; nz: number } {
  const n = points.length;
  const prev = points[(index - 1 + n) % n]!;
  const next = points[(index + 1) % n]!;
  let tx = next.x - prev.x;
  let tz = next.z - prev.z;
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;
  return { tx, tz, nx: -tz, nz: tx };
}

function signedLateral(
  center: LocalPoint,
  point: LocalPoint,
  nx: number,
  nz: number,
): number {
  return (point.x - center.x) * nx + (point.z - center.z) * nz;
}

export interface TrackProjection {
  distanceM: number;
  lateralOffsetM: number;
  local: LocalPoint;
  geo: Pick<GeoPoint, 'lat' | 'lon'>;
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

/** Aligne une distance d'arc candidate autour d'un indice de référence (boucle). */
export function unwrapArcNear(ref: TrackReference, referenceM: number, candidateM: number): number {
  const total = ref.totalLength;
  let c = candidateM;
  while (c < referenceM - total * 0.5) c += total;
  while (c > referenceM + total * 0.5) c -= total;
  return c;
}

export interface ProjectGpsOptions {
  searchWindowM?: number;
  /** Pénalise les projections en arrière le long de la piste */
  forwardBias?: number;
}

/** Projette un point GPS sur la centerline (fenêtre asymétrique, biais avant). */
export function projectGpsToTrack(
  ref: TrackReference,
  lat: number,
  lon: number,
  hintDistanceM = 0,
  searchWindowM = 120,
  options: ProjectGpsOptions = {},
): TrackProjection {
  const local = geoToLocal({ lon, lat, elevation: 0 }, ref.origin);
  const n = ref.centerline.length;
  const forwardBias = options.forwardBias ?? 0.04;

  let startIdx = 0;
  if (hintDistanceM > 0 && ref.totalLength > 0) {
    const frac = (hintDistanceM % ref.totalLength) / ref.totalLength;
    startIdx = Math.floor(frac * n);
  }

  const windowSteps = Math.max(12, Math.ceil((searchWindowM / ref.totalLength) * n));
  const backSteps = Math.floor(windowSteps * 0.2);
  const forwardSteps = windowSteps - backSteps;

  let bestScore = Infinity;
  let bestDistanceM = 0;
  let bestIdx = 0;
  let bestSegT = 0;
  let bestPoint: LocalPoint = ref.centerline[0]!;

  for (let di = -backSteps; di <= forwardSteps; di++) {
    const i = (startIdx + di + n) % n;
    const p0 = ref.centerline[i]!;
    const p1 = ref.centerline[(i + 1) % n]!;
    const hit = closestOnSegment(local.x, local.z, p0.x, p0.z, p1.x, p1.z);

    const segStart = ref.cumulative[i] ?? 0;
    const segEnd = i < n - 1 ? ref.cumulative[i + 1]! : ref.totalLength;
    const arcM = segStart + (segEnd - segStart) * hit.t;
    const unwrapped = hintDistanceM > 0 ? unwrapArcNear(ref, hintDistanceM, arcM) : arcM;
    const backwardM = Math.max(0, hintDistanceM - unwrapped);
    const score = hit.distSq + backwardM * backwardM * forwardBias;

    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
      bestSegT = hit.t;
      bestPoint = {
        x: hit.cx,
        y: p0.y + (p1.y - p0.y) * hit.t,
        z: hit.cz,
      };
      bestDistanceM = unwrapped;
    }
  }

  const normal = blendNormalAt(ref.centerline, bestIdx, bestSegT);
  const lateralOffsetM =
    (local.x - bestPoint.x) * normal.nx + (local.z - bestPoint.z) * normal.nz;

  const geo = localToGeo(bestPoint, ref.origin);

  return {
    distanceM: bestDistanceM,
    lateralOffsetM,
    local: bestPoint,
    geo: { lat: geo.lat, lon: geo.lon },
  };
}

function blendNormalAt(
  points: LocalPoint[],
  index: number,
  t: number,
): { nx: number; nz: number } {
  const n0 = tangentNormalAt(points, index);
  const n1 = tangentNormalAt(points, (index + 1) % points.length);
  let nx = n0.nx * (1 - t) + n1.nx * t;
  let nz = n0.nz * (1 - t) + n1.nz * t;
  const len = Math.hypot(nx, nz) || 1;
  return { nx: nx / len, nz: nz / len };
}

/** Vérifie si un point GPS est dans le couloir intérieur / extérieur de la piste. */
export function isGpsPointOnTrack(
  ref: TrackReference,
  lat: number,
  lon: number,
  marginM = 0.35,
): boolean {
  const proj = projectGpsToTrack(ref, lat, lon, 0, ref.totalLength, { forwardBias: 0 });
  const bounds = lateralBoundsAt(ref, proj.distanceM);
  return (
    proj.lateralOffsetM >= bounds.innerM + marginM &&
    proj.lateralOffsetM <= bounds.outerM - marginM
  );
}

/** Bord latéral à une station (arc-length). */
export function lateralBoundsAt(
  ref: TrackReference,
  distanceM: number,
): { innerM: number; outerM: number } {
  const n = ref.centerline.length;
  const s = ((distanceM % ref.totalLength) + ref.totalLength) % ref.totalLength;
  let idx = 0;
  while (idx < n - 1 && (ref.cumulative[idx + 1] ?? ref.totalLength) <= s) idx++;
  const segStart = ref.cumulative[idx] ?? 0;
  const segEnd = idx < n - 1 ? ref.cumulative[idx + 1]! : ref.totalLength;
  const t = segEnd > segStart ? (s - segStart) / (segEnd - segStart) : 0;
  const innerM =
    ref.lateralInnerM[idx]! * (1 - t) + ref.lateralInnerM[(idx + 1) % n]! * t;
  const outerM =
    ref.lateralOuterM[idx]! * (1 - t) + ref.lateralOuterM[(idx + 1) % n]! * t;
  return { innerM, outerM };
}

/** Reconstruit une position locale sur la piste (centerline + offset latéral). */
export function positionOnTrack(
  ref: TrackReference,
  distanceM: number,
  lateralOffsetM: number,
): LocalPoint {
  const n = ref.centerline.length;
  const s = ((distanceM % ref.totalLength) + ref.totalLength) % ref.totalLength;
  let idx = 0;
  while (idx < n - 1 && (ref.cumulative[idx + 1] ?? ref.totalLength) <= s) idx++;

  const p0 = ref.centerline[idx]!;
  const p1 = ref.centerline[(idx + 1) % n]!;
  const segStart = ref.cumulative[idx] ?? 0;
  const segEnd = idx < n - 1 ? ref.cumulative[idx + 1]! : ref.totalLength;
  const t = segEnd > segStart ? (s - segStart) / (segEnd - segStart) : 0;

  const center: LocalPoint = {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };
  const { nx, nz } = blendNormalAt(ref.centerline, idx, t);

  return {
    x: center.x + nx * lateralOffsetM,
    y: center.y,
    z: center.z + nz * lateralOffsetM,
  };
}
