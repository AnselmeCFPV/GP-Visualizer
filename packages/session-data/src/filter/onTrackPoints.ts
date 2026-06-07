import type { TrackCorridor } from '@prenois/circuit';
import { isGpsInTrackCorridor } from '@prenois/circuit';
import { haversineMeters } from '@prenois/geo';
import type { FilteredGpsPoint } from './gpsTrace';

export interface OnTrackPointFilterOptions {
  /** Écart max entre deux points consécutifs gardés (m) — défaut 28 */
  maxStepM?: number;
}

export interface OnTrackPointFilterStats {
  inputPoints: number;
  onTrackPoints: number;
  sequentialPoints: number;
  rejectedOutsideTrack: number;
  rejectedGap: number;
}

function maxStepFromSpeed(speedKmh: number, dtSec: number, fallbackM: number): number {
  const travelM = (speedKmh / 3.6) * Math.max(dtSec, 0.02);
  return Math.max(fallbackM, travelM * 2.8 + 6);
}

/**
 * Garde uniquement les points dans le couloir KML (entre bordures int./ext.)
 * qui se suivent sans saut trop important.
 */
export function filterSequentialOnTrackPoints(
  corridor: TrackCorridor,
  points: FilteredGpsPoint[],
  options: OnTrackPointFilterOptions = {},
): { points: FilteredGpsPoint[]; stats: OnTrackPointFilterStats } {
  const maxStepM = options.maxStepM ?? 28;

  const onTrack: FilteredGpsPoint[] = [];
  let rejectedOutsideTrack = 0;

  for (const point of points) {
    if (isGpsInTrackCorridor(corridor, point.lat, point.lon)) {
      onTrack.push(point);
    } else {
      rejectedOutsideTrack++;
    }
  }

  const sequential: FilteredGpsPoint[] = [];
  let rejectedGap = 0;
  let lastKept: FilteredGpsPoint | null = null;

  for (const point of onTrack) {
    if (!lastKept) {
      sequential.push(point);
      lastKept = point;
      continue;
    }

    const dtSec = (point.timestampMs - lastKept.timestampMs) / 1000;
    if (dtSec <= 0) continue;

    const gapM = haversineMeters(
      { lat: lastKept.lat, lon: lastKept.lon },
      { lat: point.lat, lon: point.lon },
    );
    const allowed = maxStepFromSpeed(point.speedKmh, dtSec, maxStepM);

    if (gapM <= allowed) {
      sequential.push(point);
      lastKept = point;
    } else {
      rejectedGap++;
    }
  }

  return {
    points: sequential,
    stats: {
      inputPoints: points.length,
      onTrackPoints: onTrack.length,
      sequentialPoints: sequential.length,
      rejectedOutsideTrack,
      rejectedGap,
    },
  };
}
