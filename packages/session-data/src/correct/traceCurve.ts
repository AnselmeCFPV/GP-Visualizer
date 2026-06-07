import type { TrackReference } from '@prenois/circuit';
import { projectGpsToTrack, unwrapArcNear } from '@prenois/circuit';
import type { FilteredGpsPoint } from '../filter/gpsTrace';

export interface GpsPointWithSat extends FilteredGpsPoint {
  nbSat: number;
}

/** Représentation continue d'une trace sur la piste (arc-length + offset latéral). */
export interface TraceCurve {
  fileName: string;
  meanNbSat: number;
  points: GpsPointWithSat[];
  arcM: number[];
  lateralM: number[];
  nbSat: number[];
}

function dtSeconds(prevMs: number, currMs: number): number {
  const dt = (currMs - prevMs) / 1000;
  return Math.max(0.02, Math.min(dt, 0.5));
}

/** Projette toute la trace en (s, latéral) avec continuité le long de la piste. */
export function projectTraceToTrack(
  track: TrackReference,
  points: GpsPointWithSat[],
): { arcM: number[]; lateralM: number[]; nbSat: number[] } {
  const arcM: number[] = [];
  const lateralM: number[] = [];
  const nbSat: number[] = [];
  let prevArc = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const proj = projectGpsToTrack(track, p.lat, p.lon, prevArc, 80, { forwardBias: 0.06 });
    let arc = i === 0 ? proj.distanceM : unwrapArcNear(track, prevArc, proj.distanceM);

    if (i > 0) {
      const dt = dtSeconds(points[i - 1]!.timestampMs, p.timestampMs);
      const maxAdvance = Math.max(10, (p.speedKmh / 3.6) * dt * 1.4 + 3);
      if (arc < prevArc - 5) arc = prevArc - 5;
      if (arc > prevArc + maxAdvance) arc = prevArc + maxAdvance;
    }

    arcM.push(arc);
    lateralM.push(proj.lateralOffsetM);
    nbSat.push(p.nbSat);
    prevArc = arc;
  }

  return { arcM, lateralM, nbSat };
}

/**
 * Lissage gaussien le long de l'arc — traite la courbe entière, pas point par point.
 */
export function smoothAlongArc(
  arcM: number[],
  values: number[],
  sigmaM: number,
): number[] {
  if (values.length === 0) return [];
  const sigma2 = sigmaM * sigmaM * 2;

  return values.map((_, i) => {
    const si = arcM[i]!;
    let sum = 0;
    let wSum = 0;
    for (let j = 0; j < values.length; j++) {
      const ds = si - arcM[j]!;
      const w = Math.exp(-(ds * ds) / sigma2);
      sum += values[j]! * w;
      wSum += w;
    }
    return wSum > 0 ? sum / wSum : values[i]!;
  });
}

export function buildTraceCurve(
  track: TrackReference,
  fileName: string,
  points: GpsPointWithSat[],
): TraceCurve {
  const { arcM, lateralM, nbSat } = projectTraceToTrack(track, points);
  const meanNbSat =
    nbSat.length > 0 ? nbSat.reduce((a, b) => a + b, 0) / nbSat.length : 0;
  return { fileName, meanNbSat, points, arcM, lateralM, nbSat };
}
