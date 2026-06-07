export { computeCircuitCenter } from './center';
export {
  buildCorridorMidline,
  buildTrackCorridor,
  clampGpsToTrackCenter,
  clampGpsToTrackCorridor,
  corridorBorderAtArc,
  isGpsInTrackCorridor,
  midlineFrameAtArc,
  projectGpsToCorridorMidline,
  projectGpsToCorridorMidlineHinted,
  snapFarGpsToTrackCenter,
  unwrapMidlineArcNear,
} from './trackCorridor';
export type {
  ClampToCenterOptions,
  ClampedGpsPoint,
  SnapToCenterOptions,
  SnappedGpsPoint,
  CorridorMidline,
  MidlineFrame,
  MidlineHintOptions,
  MidlineProjection,
  TrackCorridor,
} from './trackCorridor';
export {
  buildTrackReference,
  isGpsPointOnTrack,
  lateralBoundsAt,
  positionOnTrack,
  projectGpsToTrack,
  unwrapArcNear,
} from './trackReference';
export type {
  ProjectGpsOptions,
  TrackProjection,
  TrackReference,
  TrackReferenceOptions,
} from './trackReference';
export { catmullRomCentripetalClosed } from './spline';
export { loadPrenoisCircuit, PRENOIS_DEFAULT_KML } from './loadPrenoisCircuit';
export type { LoadPrenoisCircuitOptions } from './loadPrenoisCircuit';
export { parseTrackKml, loadTrackKml } from './kmlParser';
export { enrichWithLapmetaProfile, applyLapmetaProfileLocal } from './lapmetaElevation';
export { fetchElevations } from './elevation';
export {
  LAPMETA_741_LENGTH,
  LAPMETA_741_CONTROL_POINTS,
  PRENOIS_START,
  PROFILE_START_ELEVATION,
} from './data/prenois-lapmeta-741';
