export type {
  CorrectedGpsPoint,
  GpsSample,
  ImuSample,
  RiderRecording,
  SessionDataset,
} from './types';

export {
  PILOT_CSV_HEADER,
  loadPilotCsv,
  parsePilotCsv,
} from './load/pilotCsv';
export type { ParsedPilotCsv, PilotCsvRow } from './load/pilotCsv';

export {
  applySessionRecalibration,
  filterGpsTrace,
  loadAndFilterPilotCsv,
} from './filter/gpsTrace';
export type {
  FilteredGpsPoint,
  FilteredPilotTrace,
  GpsTraceFilterOptions,
  SessionFilterResult,
} from './filter/gpsTrace';

export { filterSequentialOnTrackPoints } from './filter/onTrackPoints';
export type {
  OnTrackPointFilterOptions,
  OnTrackPointFilterStats,
} from './filter/onTrackPoints';

export { buildZoneSplineLine } from './analyze/trackZones';
export type {
  BuildZoneSplineOptions,
  TrackZoneMean,
  TrackZoneSurface,
  ZoneSplineLine,
} from './analyze/trackZones';

export {
  buildSatelliteReference,
  referenceLateralAt,
} from './correct/satelliteReference';
export type { BuildReferenceOptions, SatelliteReference } from './correct/satelliteReference';

export {
  buildTraceCurve,
  projectTraceToTrack,
  smoothAlongArc,
} from './correct/traceCurve';
export type { GpsPointWithSat, TraceCurve } from './correct/traceCurve';

export {
  recalibrateSession,
  recalibrateTraceCurve,
} from './correct/gpsTrack';
export type {
  CorrectedGpsTracePoint,
  GpsCorrectionOptions,
  GpsCorrectionStats,
  SessionRecalibrationResult,
} from './correct/gpsTrack';

export class SessionStore {
  private dataset: import('./types').SessionDataset | null = null;

  getDataset(): import('./types').SessionDataset | null {
    return this.dataset;
  }

  async loadFromDirectory(_directoryUrl: string): Promise<void> {
    throw new Error('SessionStore.loadFromDirectory — non implémenté');
  }
}
