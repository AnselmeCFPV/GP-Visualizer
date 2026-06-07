import type { CorridorMidline, TrackCorridor } from '@prenois/circuit';
import { isGpsInTrackCorridor, projectGpsToCorridorMidline } from '@prenois/circuit';
import { geoToLocal, localToGeo } from '@prenois/geo';
import type { FilteredGpsPoint } from '../filter/gpsTrace';
import {
  fitRacingSpline,
  sampleSpline,
  totalSquaredError,
  type SplineDataPoint,
} from './fitRacingSpline';

export interface ProbableRacingLinePoint {
  lat: number;
  lon: number;
  arcM: number;
  passCount: number;
}

export interface ProbableRacingLine {
  points: ProbableRacingLinePoint[];
  totalInputPoints: number;
  meanPassCount: number;
  /** Somme des écarts² point → spline (m²) */
  totalSquaredErrorM2: number;
}

export interface BuildProbableLineOptions {
  /** Distance max à la midline pour accepter un point (m) — défaut 18 */
  maxMidlineDistM?: number;
  /** Nombre de points de contrôle spline — défaut 88 */
  knotCount?: number;
  /** Régularisation (plus bas = colle aux points, virages plus larges) — défaut 0.5 */
  smoothness?: number;
  /** Itérations réassignation arc — défaut 5 */
  iterations?: number;
  /** Points échantillonnés sur la spline — défaut 220 */
  sampleCount?: number;
}

const DEFAULT_MAX_MIDLINE_DIST = 18;
const DEFAULT_SAMPLE_COUNT = 220;

function wrapArcDelta(totalLength: number, a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > totalLength / 2) d = totalLength - d;
  return d;
}

/**
 * Trajectoire probable = spline fermée qui minimise Σ écarts² aux points GPS
 * (réassignation itérative de l'arc, pas d'ordre en base de données).
 */
export function buildProbableRacingLine(
  corridor: TrackCorridor,
  midline: CorridorMidline,
  traces: FilteredGpsPoint[][],
  options: BuildProbableLineOptions = {},
): ProbableRacingLine {
  const maxMidlineDistM = options.maxMidlineDistM ?? DEFAULT_MAX_MIDLINE_DIST;
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;

  const data: SplineDataPoint[] = [];

  for (const trace of traces) {
    for (const p of trace) {
      if (!isGpsInTrackCorridor(corridor, p.lat, p.lon)) continue;

      const proj = projectGpsToCorridorMidline(midline, p.lat, p.lon);
      if (proj.distanceM > maxMidlineDistM) continue;

      const local = geoToLocal({ lat: p.lat, lon: p.lon, elevation: 0 }, midline.origin);
      data.push({ s: proj.arcM, x: local.x, z: local.z });
    }
  }

  const totalInputPoints = data.length;
  if (totalInputPoints < 8) {
    return { points: [], totalInputPoints, meanPassCount: 0, totalSquaredErrorM2: 0 };
  }

  const initialX = midline.local.map((p) => p.x);
  const initialZ = midline.local.map((p) => p.z);

  const spline = fitRacingSpline(data, midline.totalLength, initialX, initialZ, {
    knotCount: options.knotCount,
    smoothness: options.smoothness,
    iterations: options.iterations,
  });

  const sampled = sampleSpline(spline, sampleCount);
  const binWindowM = midline.totalLength / sampleCount * 1.5;

  const points: ProbableRacingLinePoint[] = [];

  for (const sp of sampled) {
    const geo = localToGeo({ x: sp.x, y: 0, z: sp.z }, midline.origin);
    if (!isGpsInTrackCorridor(corridor, geo.lat, geo.lon)) continue;

    let passCount = 0;
    for (const d of data) {
      if (wrapArcDelta(midline.totalLength, d.s, sp.arcM) <= binWindowM) passCount++;
    }

    points.push({
      lat: geo.lat,
      lon: geo.lon,
      arcM: sp.arcM,
      passCount,
    });
  }

  const errorSum = totalSquaredError(spline, data);

  const withVotes = points.filter((p) => p.passCount > 0);
  const meanPassCount =
    withVotes.length > 0
      ? withVotes.reduce((sum, p) => sum + p.passCount, 0) / withVotes.length
      : 0;

  return {
    points,
    totalInputPoints,
    meanPassCount,
    totalSquaredErrorM2: errorSum,
  };
}
