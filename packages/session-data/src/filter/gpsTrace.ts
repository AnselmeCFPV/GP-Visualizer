import type { TrackReference } from '@prenois/circuit';
import { haversineMeters } from '@prenois/geo';
import {
  recalibrateSession,
  type CorrectedGpsTracePoint,
  type GpsCorrectionStats,
  type SessionRecalibrationResult,
} from '../correct/gpsTrack';
import type { GpsPointWithSat } from '../correct/traceCurve';
import { loadPilotCsv, type PilotCsvRow } from '../load/pilotCsv';

export interface GpsTraceFilterOptions {
  circuitCenter: { lat: number; lon: number };
  /** Vitesse minimale (km/h) — défaut 30 */
  minSpeedKmh?: number;
  /** Distance max au centre du circuit (m) — défaut 3000 */
  maxDistanceM?: number;
}

export interface FilteredGpsPoint {
  lat: number;
  lon: number;
  speedKmh: number;
  timestampMs: number;
  nbSat: number;
}

export interface FilteredPilotTrace {
  fileName: string;
  /** Points corrigés sur la piste (ou filtrés seuls si pas de track). */
  points: CorrectedGpsTracePoint[] | FilteredGpsPoint[];
  /** Points GPS bruts après filtre vitesse / distance. */
  rawPoints: FilteredGpsPoint[];
  stats: {
    inputRows: number;
    keptRows: number;
    rejectedSpeed: number;
    rejectedDistance: number;
    rejectedInvalidGps: number;
  };
  correction?: GpsCorrectionStats;
}

const DEFAULT_MIN_SPEED_KMH = 30;
const DEFAULT_MAX_DISTANCE_M = 3000;

/** Filtre les points GPS : vitesse > seuil et proximité du circuit. */
export function filterGpsTrace(
  rows: PilotCsvRow[],
  options: GpsTraceFilterOptions,
): FilteredPilotTrace {
  const minSpeed = options.minSpeedKmh ?? DEFAULT_MIN_SPEED_KMH;
  const maxDist = options.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  const center = options.circuitCenter;

  const points: FilteredGpsPoint[] = [];
  let rejectedSpeed = 0;
  let rejectedDistance = 0;
  let rejectedInvalidGps = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) {
      rejectedInvalidGps++;
      continue;
    }

    if (row.speedKmh <= minSpeed) {
      rejectedSpeed++;
      continue;
    }

    const dist = haversineMeters(
      { lat: row.lat, lon: row.lon },
      center,
    );
    if (dist > maxDist) {
      rejectedDistance++;
      continue;
    }

    points.push({
      lat: row.lat,
      lon: row.lon,
      speedKmh: row.speedKmh,
      timestampMs: row.timestampMs,
      nbSat: row.nbSat,
    });
  }

  return {
    fileName: '',
    points,
    rawPoints: points,
    stats: {
      inputRows: rows.length,
      keptRows: points.length,
      rejectedSpeed,
      rejectedDistance,
      rejectedInvalidGps,
    },
  };
}

export interface SessionFilterResult {
  traces: FilteredPilotTrace[];
}

/** Filtre plusieurs CSV sans correction (étape 1). */
export async function loadAndFilterPilotCsv(
  url: string,
  options: GpsTraceFilterOptions,
  fileName?: string,
): Promise<FilteredPilotTrace> {
  const parsed = await loadPilotCsv(url, fileName);
  const filtered = filterGpsTrace(parsed.rows, options);
  filtered.fileName = parsed.fileName;
  return filtered;
}

/** Recale toutes les traces d'une session sur la référence satellite. */
export function applySessionRecalibration(
  traces: FilteredPilotTrace[],
  track: TrackReference,
): { traces: FilteredPilotTrace[]; session: SessionRecalibrationResult } {
  const session = recalibrateSession(
    traces.map((t) => ({
      fileName: t.fileName,
      points: t.rawPoints as GpsPointWithSat[],
    })),
    track,
  );

  const updated = traces.map((t) => {
    const result = session.traces.get(t.fileName);
    if (!result) return t;
    return {
      ...t,
      points: result.points,
      correction: result.stats,
    };
  });

  return { traces: updated, session };
}
