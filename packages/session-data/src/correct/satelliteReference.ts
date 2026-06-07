import type { TrackReference } from '@prenois/circuit';
import { lateralBoundsAt } from '@prenois/circuit';
import type { TraceCurve } from './traceCurve';
import { smoothAlongArc } from './traceCurve';

export interface SatelliteReference {
  /** Positions d'arc le long de la piste (m) */
  arcGridM: number[];
  /** Offset latéral moyen pondéré (traces haute qualité satellites) */
  lateralGridM: number[];
  /** Traces utilisées pour la référence */
  sourceFiles: string[];
  meanNbSat: number;
}

export interface BuildReferenceOptions {
  /** Fraction supérieure par nb satellites — défaut 0.5 (top 50 %) */
  topFraction?: number;
  /** Pas de grille le long de la piste (m) — défaut 4 */
  gridStepM?: number;
  /** Fenêtre de collecte autour de chaque station (m) — défaut 10 */
  binWindowM?: number;
  kerbMarginM?: number;
}

const DEFAULT_TOP_FRACTION = 0.5;
const DEFAULT_GRID_STEP = 4;
const DEFAULT_BIN_WINDOW = 10;
const DEFAULT_KERB_MARGIN = 0.45;

function interpolateGrid(arcGridM: number[], lateralGridM: number[], arcM: number): number {
  const n = arcGridM.length;
  if (n === 0) return 0;
  const total = arcGridM[n - 1]! + (arcGridM[0] ?? 0);
  let s = ((arcM % total) + total) % total;

  let idx = 0;
  while (idx < n - 1 && arcGridM[idx + 1]! <= s) idx++;

  const s0 = arcGridM[idx]!;
  const s1 = idx < n - 1 ? arcGridM[idx + 1]! : total;
  const l0 = lateralGridM[idx]!;
  const l1 = lateralGridM[(idx + 1) % n]!;
  const segLen = s1 > s0 ? s1 - s0 : total - s0 + (arcGridM[0] ?? 0);
  const t = segLen > 0 ? (s - s0) / segLen : 0;
  return l0 + (l1 - l0) * Math.max(0, Math.min(1, t));
}

/**
 * Construit la trajectoire de référence = moyenne pondérée (nb satellites)
 * des meilleures traces, clampée entre bordures int./ext.
 */
export function buildSatelliteReference(
  curves: TraceCurve[],
  track: TrackReference,
  options: BuildReferenceOptions = {},
): SatelliteReference {
  const topFraction = options.topFraction ?? DEFAULT_TOP_FRACTION;
  const gridStepM = options.gridStepM ?? DEFAULT_GRID_STEP;
  const binWindowM = options.binWindowM ?? DEFAULT_BIN_WINDOW;
  const kerbMargin = options.kerbMarginM ?? DEFAULT_KERB_MARGIN;

  const sorted = [...curves].sort((a, b) => b.meanNbSat - a.meanNbSat);
  const topCount = Math.max(1, Math.ceil(sorted.length * topFraction));
  const topCurves = sorted.slice(0, topCount);

  const binCount = Math.max(32, Math.ceil(track.totalLength / gridStepM));
  const arcGridM: number[] = [];
  const lateralGridM: number[] = new Array(binCount).fill(0);
  const weightSum = new Array(binCount).fill(0);

  for (let b = 0; b < binCount; b++) {
    arcGridM.push((b / binCount) * track.totalLength);
  }

  for (const curve of topCurves) {
    const smoothLat = smoothAlongArc(curve.arcM, curve.lateralM, 18);

    for (let i = 0; i < curve.arcM.length; i++) {
      const s = curve.arcM[i]!;
      const lat = smoothLat[i]!;
      const w = Math.max(1, curve.nbSat[i]!);

      for (let b = 0; b < binCount; b++) {
        const center = arcGridM[b]!;
        let ds = Math.abs(s - center);
        if (ds > track.totalLength / 2) ds = track.totalLength - ds;
        if (ds > binWindowM) continue;

        const proximity = Math.exp(-(ds * ds) / (binWindowM * binWindowM));
        lateralGridM[b]! += lat * w * proximity;
        weightSum[b]! += w * proximity;
      }
    }
  }

  for (let b = 0; b < binCount; b++) {
    if (weightSum[b]! > 0) {
      lateralGridM[b] = lateralGridM[b]! / weightSum[b]!;
    }
    const bounds = lateralBoundsAt(track, arcGridM[b]!);
    lateralGridM[b] = Math.max(
      bounds.innerM + kerbMargin,
      Math.min(bounds.outerM - kerbMargin, lateralGridM[b]!),
    );
  }

  const refSmooth = smoothAlongArc(arcGridM, lateralGridM, gridStepM * 2);
  for (let b = 0; b < binCount; b++) {
    const bounds = lateralBoundsAt(track, arcGridM[b]!);
    lateralGridM[b] = Math.max(
      bounds.innerM + kerbMargin,
      Math.min(bounds.outerM - kerbMargin, refSmooth[b]!),
    );
  }

  const meanNbSat =
    topCurves.reduce((s, c) => s + c.meanNbSat, 0) / topCurves.length;

  return {
    arcGridM,
    lateralGridM,
    sourceFiles: topCurves.map((c) => c.fileName),
    meanNbSat,
  };
}

export function referenceLateralAt(ref: SatelliteReference, arcM: number): number {
  return interpolateGrid(ref.arcGridM, ref.lateralGridM, arcM);
}
