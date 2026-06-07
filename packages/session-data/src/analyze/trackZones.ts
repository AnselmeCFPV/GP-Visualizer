import type { CorridorMidline, MidlineFrame, TrackCorridor } from '@prenois/circuit';
import {
  isGpsInTrackCorridor,
  midlineFrameAtArc,
  projectGpsToCorridorMidline,
} from '@prenois/circuit';
import { geoToLocal, localToGeo, type LocalPoint } from '@prenois/geo';
import type { FilteredGpsPoint } from '../filter/gpsTrace';

export interface TrackZoneMean {
  zoneIndex: number;
  arcStartM: number;
  arcCenterM: number;
  lat: number;
  lon: number;
  pointCount: number;
}

export interface TrackZoneSurface {
  zoneIndex: number;
  arcStartM: number;
  arcEndM: number;
  pointCount: number;
  latlngs: { lat: number; lon: number }[];
}

export interface ZoneSplineLine {
  zones: TrackZoneMean[];
  /** Tracé spline fermé, reconstruit le long de l'arc piste. */
  pathPoints: { lat: number; lon: number }[];
  zoneSurfaces: TrackZoneSurface[];
  zoneLengthM: number;
  totalZones: number;
  zonesWithData: number;
  totalPointsInZones: number;
}

export interface BuildZoneSplineOptions {
  zoneLengthM?: number;
  /**
   * Intensité du lissage bilatéral latéral (0–100).
   * 0 = brut, 100 = lissage fort (virages préservés par courbure + similarité latérale).
   */
  smoothStrength?: number;
  curvatureRef?: number;
}

const DEFAULT_ZONE_LENGTH = 2;
const DEFAULT_SMOOTH_STRENGTH = 50;
const DEFAULT_CURVATURE_REF = 0.032;

function smoothParamsFromStrength(
  strength: number,
  zoneLengthM: number,
  curvatureRef: number,
): SmartSmoothOptions | null {
  const clamped = Math.max(0, Math.min(100, strength));
  if (clamped <= 0) return null;
  const t = clamped / 100;
  return {
    arcZones: 2 + t * 12,
    latM: 1.5 + t * 5.5,
    curvatureRef,
    zoneLengthM,
    medianRadiusZones: Math.max(1, Math.round(1 + t * 4)),
    medianPasses: t >= 0.65 ? 2 : 1,
  };
}

function signedLateral(local: LocalPoint, frame: MidlineFrame): number {
  return (local.x - frame.point.x) * frame.nx + (local.z - frame.point.z) * frame.nz;
}

function pointFromLateral(frame: MidlineFrame, lateralM: number): LocalPoint {
  return {
    x: frame.point.x + frame.nx * lateralM,
    y: frame.point.y,
    z: frame.point.z + frame.nz * lateralM,
  };
}

function zoneArcBounds(
  zoneIndex: number,
  zoneLengthM: number,
  totalLength: number,
): { arcStartM: number; arcEndM: number } {
  const arcStartM = zoneIndex * zoneLengthM;
  const arcEndM = Math.min((zoneIndex + 1) * zoneLengthM, totalLength);
  return { arcStartM, arcEndM };
}

function rectangleCorner(
  frame: MidlineFrame,
  alongM: number,
  lateralM: number,
): LocalPoint {
  return {
    x: frame.point.x + frame.tx * alongM + frame.nx * lateralM,
    y: frame.point.y,
    z: frame.point.z + frame.tz * alongM + frame.nz * lateralM,
  };
}

/** Rectangle axis-aligned dans le repère tangent/normal, centré sur la midline. */
function buildZoneRectangle(
  midline: CorridorMidline,
  arcStartM: number,
  arcEndM: number,
  widthM: number,
): LocalPoint[] {
  const lengthM = arcEndM - arcStartM;
  const arcCenterM = (arcStartM + arcEndM) * 0.5;
  const frame = midlineFrameAtArc(midline, arcCenterM);
  const halfLen = lengthM * 0.5;
  const halfWidth = widthM * 0.5;

  return [
    rectangleCorner(frame, halfLen, halfWidth),
    rectangleCorner(frame, halfLen, -halfWidth),
    rectangleCorner(frame, -halfLen, -halfWidth),
    rectangleCorner(frame, -halfLen, halfWidth),
  ];
}

function buildZoneSurfaces(
  midline: CorridorMidline,
  totalZones: number,
  zoneLengthM: number,
  counts: number[],
): TrackZoneSurface[] {
  const surfaces: TrackZoneSurface[] = [];
  const rectangleWidthM = Math.max(2, midline.minWidthM * 0.92);

  for (let z = 0; z < totalZones; z++) {
    const { arcStartM, arcEndM } = zoneArcBounds(z, zoneLengthM, midline.totalLength);
    const corners = buildZoneRectangle(midline, arcStartM, arcEndM, rectangleWidthM);

    surfaces.push({
      zoneIndex: z,
      arcStartM,
      arcEndM,
      pointCount: counts[z]!,
      latlngs: corners.map((p) => {
        const geo = localToGeo(p, midline.origin);
        return { lat: geo.lat, lon: geo.lon };
      }),
    });
  }

  return surfaces;
}

function midlineCurvature(midline: CorridorMidline, arcM: number, spanM: number): number {
  const fL = midlineFrameAtArc(midline, arcM - spanM);
  const fR = midlineFrameAtArc(midline, arcM + spanM);
  const dot = Math.max(-1, Math.min(1, fL.nx * fR.nx + fL.nz * fR.nz));
  return Math.acos(dot) / (2 * spanM);
}

function bilateralSmoothPeriodic(
  values: number[],
  sigmaArcZones: number,
  sigmaLatM: number,
): number[] {
  const n = values.length;
  if (n === 0) return values;
  const sigmaArc2 = sigmaArcZones * sigmaArcZones * 2;
  const sigmaLat2 = sigmaLatM * sigmaLatM * 2;

  return values.map((valI, i) => {
    let sum = 0;
    let wSum = 0;
    for (let j = 0; j < n; j++) {
      let dArc = Math.abs(i - j);
      dArc = Math.min(dArc, n - dArc);
      const wArc = Math.exp(-(dArc * dArc) / sigmaArc2);
      const dLat = valI - values[j]!;
      const wLat = Math.exp(-(dLat * dLat) / sigmaLat2);
      const w = wArc * wLat;
      sum += values[j]! * w;
      wSum += w;
    }
    return wSum > 0 ? sum / wSum : valI;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function medianFilterPeriodic(values: number[], radius: number): number[] {
  const n = values.length;
  if (n === 0 || radius <= 0) return values;

  return values.map((_, i) => {
    const window: number[] = [];
    for (let d = -radius; d <= radius; d++) {
      window.push(values[(i + d + n) % n]!);
    }
    return median(window);
  });
}

function shortScaleZigzagFilter(values: number[], radius: number, passes: number): number[] {
  let filtered = values;
  for (let pass = 0; pass < passes; pass++) {
    filtered = medianFilterPeriodic(filtered, radius);
  }
  return filtered;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function robustWeightedLateral(values: number[], weightScaleM: number): number {
  if (values.length === 0) return 0;
  if (values.length < 3) return mean(values);

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)]!;
  const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)]!;
  const iqr = q3 - q1;
  const medianValue = median(sorted);
  const fallbackSpread = median(sorted.map((v) => Math.abs(v - medianValue)));
  const spread = Math.max(iqr, fallbackSpread * 2, 0.5);
  const lower = q1 - spread * 1.75;
  const upper = q3 + spread * 1.75;
  const filtered = values.filter((v) => v >= lower && v <= upper);
  const samples = filtered.length > 0 ? filtered : values;

  let weightedSum = 0;
  let weightSum = 0;
  for (const value of samples) {
    const normalizedDistance = Math.min(1, Math.abs(value) / weightScaleM);
    const weight = 1 + 3 * normalizedDistance ** 1.5;
    weightedSum += value * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : medianValue;
}

function circularForwardDistance(from: number, to: number, n: number): number {
  return (to - from + n) % n;
}

function fillMissingLaterals(raw: Array<number | null>): number[] {
  const n = raw.length;
  const known = raw
    .map((value, index) => (value === null ? null : index))
    .filter((index): index is number => index !== null);

  if (known.length === 0) return new Array<number>(n).fill(0);
  if (known.length === 1) return new Array<number>(n).fill(raw[known[0]!]!);

  return raw.map((value, index) => {
    if (value !== null) return value;

    let prev = known[0]!;
    let next = known[0]!;
    let prevDist = Infinity;
    let nextDist = Infinity;

    for (const k of known) {
      const backward = circularForwardDistance(k, index, n);
      const forward = circularForwardDistance(index, k, n);
      if (backward < prevDist) {
        prevDist = backward;
        prev = k;
      }
      if (forward < nextDist) {
        nextDist = forward;
        next = k;
      }
    }

    const total = prevDist + nextDist;
    if (total <= 0) return raw[prev]!;
    const t = prevDist / total;
    return raw[prev]! + (raw[next]! - raw[prev]!) * t;
  });
}

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function buildSplinePathControls(
  midline: CorridorMidline,
  arcCentersM: number[],
  laterals: number[],
  zoneLengthM: number,
): LocalPoint[] {
  const n = laterals.length;
  if (n === 0) return [];
  if (n < 4) {
    return laterals.map((lat, i) =>
      pointFromLateral(midlineFrameAtArc(midline, arcCentersM[i]!), lat),
    );
  }

  const samplesPerZone = Math.max(4, Math.ceil(zoneLengthM / 0.5));
  const controls: LocalPoint[] = [];

  for (let i = 0; i < n; i++) {
    const prev = laterals[(i - 1 + n) % n]!;
    const current = laterals[i]!;
    const next = laterals[(i + 1) % n]!;
    const nextNext = laterals[(i + 2) % n]!;
    const arc0 = arcCentersM[i]!;
    const arc1 = i < n - 1 ? arcCentersM[i + 1]! : arcCentersM[0]! + midline.totalLength;
    const arcDelta = arc1 - arc0;

    for (let s = 0; s < samplesPerZone; s++) {
      const t = s / samplesPerZone;
      const arcM = arc0 + arcDelta * t;
      const lateral = catmullRomScalar(prev, current, next, nextNext, t);
      controls.push(pointFromLateral(midlineFrameAtArc(midline, arcM), lateral));
    }
  }

  return controls;
}

interface SmartSmoothOptions {
  arcZones: number;
  latM: number;
  curvatureRef: number;
  zoneLengthM: number;
  medianRadiusZones: number;
  medianPasses: number;
}

function smartSmoothLaterals(
  midline: CorridorMidline,
  arcCentersM: number[],
  rawLaterals: number[],
  options: SmartSmoothOptions,
): number[] {
  const despiked = shortScaleZigzagFilter(
    rawLaterals,
    options.medianRadiusZones,
    options.medianPasses,
  );
  const filtered = bilateralSmoothPeriodic(despiked, options.arcZones, options.latM);
  const spanM = options.zoneLengthM * 3;

  return despiked.map((base, i) => {
    const k = midlineCurvature(midline, arcCentersM[i]!, spanM);
    const cornerT = Math.min(1, k / options.curvatureRef);
    const smoothWeight = (1 - cornerT) * (1 - cornerT);
    return smoothWeight * filtered[i]! + (1 - smoothWeight) * base;
  });
}

/**
 * Découpe la piste en rectangles (N m × largeur couloir), centrés sur la midline.
 * Moyenne par zone + tracé spline tangent le long de l'arc piste.
 */
export function buildZoneSplineLine(
  corridor: TrackCorridor,
  midline: CorridorMidline,
  traces: FilteredGpsPoint[][],
  options: BuildZoneSplineOptions = {},
): ZoneSplineLine {
  const zoneLengthM = options.zoneLengthM ?? DEFAULT_ZONE_LENGTH;
  const smoothStrength = options.smoothStrength ?? DEFAULT_SMOOTH_STRENGTH;
  const curvatureRef = options.curvatureRef ?? DEFAULT_CURVATURE_REF;
  const smoothOptions = smoothParamsFromStrength(smoothStrength, zoneLengthM, curvatureRef);

  const fullZones = Math.floor(midline.totalLength / zoneLengthM);
  const remainder = midline.totalLength - fullZones * zoneLengthM;
  const totalZones = Math.max(1, remainder > 1e-3 ? fullZones + 1 : Math.max(1, fullZones));
  const arcCentersM = Array.from({ length: totalZones }, (_, z) => {
    const { arcStartM, arcEndM } = zoneArcBounds(z, zoneLengthM, midline.totalLength);
    return (arcStartM + arcEndM) * 0.5;
  });

  const counts = new Array<number>(totalZones).fill(0);
  const lateralSamples = Array.from({ length: totalZones }, () => [] as number[]);

  for (const trace of traces) {
    for (const p of trace) {
      if (!isGpsInTrackCorridor(corridor, p.lat, p.lon)) continue;

      const proj = projectGpsToCorridorMidline(midline, p.lat, p.lon);
      let zoneIndex = Math.floor(proj.arcM / zoneLengthM);
      if (zoneIndex >= totalZones) zoneIndex = totalZones - 1;

      const local = geoToLocal({ lat: p.lat, lon: p.lon, elevation: 0 }, midline.origin);
      lateralSamples[zoneIndex]!.push(signedLateral(local, midlineFrameAtArc(midline, proj.arcM)));
      counts[zoneIndex]!++;
    }
  }

  const weightScaleM = Math.max(1.5, midline.averageWidthM * 0.35);
  const rawLaterals = lateralSamples.map((samples) =>
    samples.length > 0 ? robustWeightedLateral(samples, weightScaleM) : null,
  );
  const filledLaterals = fillMissingLaterals(rawLaterals);
  const pathLaterals = smoothOptions
    ? smartSmoothLaterals(midline, arcCentersM, filledLaterals, smoothOptions)
    : filledLaterals;

  const zones: TrackZoneMean[] = [];

  for (let z = 0; z < totalZones; z++) {
    const { arcStartM, arcEndM } = zoneArcBounds(z, zoneLengthM, midline.totalLength);
    const arcCenterM = (arcStartM + arcEndM) * 0.5;

    if (counts[z]! > 0) {
      const local = pointFromLateral(midlineFrameAtArc(midline, arcCenterM), pathLaterals[z]!);
      const geo = localToGeo(local, midline.origin);
      zones.push({
        zoneIndex: z,
        arcStartM,
        arcCenterM,
        lat: geo.lat,
        lon: geo.lon,
        pointCount: counts[z]!,
      });
    }
  }

  const pathControls = buildSplinePathControls(midline, arcCentersM, pathLaterals, zoneLengthM);
  const pathPoints = pathControls.map((p) => {
    const geo = localToGeo(p, midline.origin);
    return { lat: geo.lat, lon: geo.lon };
  });

  const zoneSurfaces = buildZoneSurfaces(midline, totalZones, zoneLengthM, counts);
  const totalPointsInZones = counts.reduce((sum, c) => sum + c, 0);

  return {
    zones,
    pathPoints,
    zoneSurfaces,
    zoneLengthM,
    totalZones,
    zonesWithData: zones.length,
    totalPointsInZones,
  };
}
