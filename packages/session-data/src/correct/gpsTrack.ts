import { localToGeo } from '@prenois/geo';
import type { TrackReference } from '@prenois/circuit';
import { lateralBoundsAt, positionOnTrack } from '@prenois/circuit';
import type { FilteredGpsPoint } from '../filter/gpsTrace';
import {
  buildSatelliteReference,
  referenceLateralAt,
  type SatelliteReference,
} from './satelliteReference';
import {
  buildTraceCurve,
  smoothAlongArc,
  type GpsPointWithSat,
  type TraceCurve,
} from './traceCurve';

export interface GpsCorrectionOptions {
  kerbMarginM?: number;
  /** Lissage de la trace le long de l'arc avant recalage (m) — défaut 22 */
  traceSmoothSigmaM?: number;
  /**
   * Poids de la trace propre vs référence satellite (0 = 100 % référence, 1 = 100 % trace lissée).
   * Dépend de la qualité satellites de la trace.
   */
  minTraceWeight?: number;
}

export interface CorrectedGpsTracePoint extends FilteredGpsPoint {
  rawLat: number;
  rawLon: number;
  distanceM: number;
  lateralOffsetM: number;
  wasClamped: boolean;
}

export interface GpsCorrectionStats {
  inputPoints: number;
  outputPoints: number;
  clampedPoints: number;
  avgLateralShiftM: number;
  maxLateralShiftM: number;
  meanNbSat: number;
  traceWeight: number;
}

const DEFAULT_KERB_MARGIN = 0.45;
const DEFAULT_TRACE_SIGMA = 22;
const DEFAULT_MIN_TRACE_WEIGHT = 0.15;

function clampLateral(
  track: TrackReference,
  arcM: number,
  lateral: number,
  kerbMargin: number,
): { value: number; clamped: boolean } {
  const bounds = lateralBoundsAt(track, arcM);
  const inner = bounds.innerM + kerbMargin;
  const outer = bounds.outerM - kerbMargin;
  if (lateral < inner) return { value: inner, clamped: true };
  if (lateral > outer) return { value: outer, clamped: true };
  return { value: lateral, clamped: false };
}

function traceWeightFromSat(meanNbSat: number, refMeanNbSat: number, minWeight: number): number {
  if (refMeanNbSat <= 0) return minWeight;
  const ratio = Math.min(1, meanNbSat / refMeanNbSat);
  return minWeight + (1 - minWeight) * ratio;
}

/**
 * Recale une trace entière sur la référence satellite + bordures.
 * La continuité est assurée par lissage gaussien le long de l'arc, pas point par point.
 */
export function recalibrateTraceCurve(
  curve: TraceCurve,
  reference: SatelliteReference,
  track: TrackReference,
  options: GpsCorrectionOptions = {},
): { points: CorrectedGpsTracePoint[]; stats: GpsCorrectionStats } {
  const kerbMargin = options.kerbMarginM ?? DEFAULT_KERB_MARGIN;
  const sigmaM = options.traceSmoothSigmaM ?? DEFAULT_TRACE_SIGMA;
  const minTraceWeight = options.minTraceWeight ?? DEFAULT_MIN_TRACE_WEIGHT;

  const traceWeight = traceWeightFromSat(
    curve.meanNbSat,
    reference.meanNbSat,
    minTraceWeight,
  );

  const smoothOwn = smoothAlongArc(curve.arcM, curve.lateralM, sigmaM);

  const corrected: CorrectedGpsTracePoint[] = [];
  let clampedPoints = 0;
  let lateralShiftSum = 0;
  let maxLateralShift = 0;

  for (let i = 0; i < curve.points.length; i++) {
    const raw = curve.points[i]!;
    const arc = curve.arcM[i]!;
    const refLat = referenceLateralAt(reference, arc);
    const blended = refLat * (1 - traceWeight) + smoothOwn[i]! * traceWeight;
    const { value: lateral, clamped } = clampLateral(track, arc, blended, kerbMargin);
    if (clamped) clampedPoints++;

    const local = positionOnTrack(track, arc, lateral);
    const geo = localToGeo(local, track.origin);

    const shiftM = Math.hypot(
      (raw.lat - geo.lat) * 111_320,
      (raw.lon - geo.lon) * 111_320 * Math.cos((geo.lat * Math.PI) / 180),
    );
    lateralShiftSum += shiftM;
    maxLateralShift = Math.max(maxLateralShift, shiftM);

    corrected.push({
      lat: geo.lat,
      lon: geo.lon,
      speedKmh: raw.speedKmh,
      timestampMs: raw.timestampMs,
      nbSat: raw.nbSat,
      rawLat: raw.lat,
      rawLon: raw.lon,
      distanceM: arc,
      lateralOffsetM: lateral,
      wasClamped: clamped,
    });
  }

  return {
    points: corrected,
    stats: {
      inputPoints: curve.points.length,
      outputPoints: corrected.length,
      clampedPoints,
      avgLateralShiftM: curve.points.length > 0 ? lateralShiftSum / curve.points.length : 0,
      maxLateralShiftM: maxLateralShift,
      meanNbSat: curve.meanNbSat,
      traceWeight,
    },
  };
}

export interface SessionRecalibrationResult {
  reference: SatelliteReference;
  traces: Map<string, { points: CorrectedGpsTracePoint[]; stats: GpsCorrectionStats }>;
}

/** Pipeline session : référence satellite + recalage continu de toutes les traces. */
export function recalibrateSession(
  traces: { fileName: string; points: GpsPointWithSat[] }[],
  track: TrackReference,
  options: GpsCorrectionOptions = {},
): SessionRecalibrationResult {
  const curves = traces.map((t) => buildTraceCurve(track, t.fileName, t.points));
  const reference = buildSatelliteReference(curves, track);

  const results = new Map<string, { points: CorrectedGpsTracePoint[]; stats: GpsCorrectionStats }>();
  for (const curve of curves) {
    results.set(curve.fileName, recalibrateTraceCurve(curve, reference, track, options));
  }

  return { reference, traces: results };
}
