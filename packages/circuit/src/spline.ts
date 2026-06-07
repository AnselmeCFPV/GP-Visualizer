import type { LocalPoint } from '@prenois/geo';
import { distance2D, lerpPoint } from '@prenois/geo';

function distance3D(a: LocalPoint, b: LocalPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

function ensureClosed(points: LocalPoint[]): LocalPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (distance2D(first, last) < 0.01) return points;
  return [...points, { ...first }];
}

export function chaikinClosed(points: LocalPoint[], iterations = 2): LocalPoint[] {
  let current = points;
  for (let iter = 0; iter < iterations; iter++) {
    const n = current.length;
    const next: LocalPoint[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = current[i];
      const p1 = current[(i + 1) % n];
      next.push({
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
        z: 0.75 * p0.z + 0.25 * p1.z,
      });
      next.push({
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
        z: 0.25 * p0.z + 0.75 * p1.z,
      });
    }
    current = next;
  }
  return current;
}

function catmullRomPoint(
  p0: LocalPoint,
  p1: LocalPoint,
  p2: LocalPoint,
  p3: LocalPoint,
  t: number,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
): LocalPoint {
  const u = t1 + (t2 - t1) * t;
  const lerp1 = (ta: number, tb: number, a: LocalPoint, b: LocalPoint, tc: number): LocalPoint => {
    const w = (tc - ta) / (tb - ta);
    return lerpPoint(a, b, w);
  };
  const A1 = lerp1(t0, t1, p0, p1, u);
  const A2 = lerp1(t1, t2, p1, p2, u);
  const A3 = lerp1(t2, t3, p2, p3, u);
  const B1 = lerp1(t0, t2, A1, A2, u);
  const B2 = lerp1(t1, t3, A2, A3, u);
  return lerp1(t1, t2, B1, B2, u);
}

export function catmullRomCentripetalClosed(
  controlPoints: LocalPoint[],
  samplesPerSegment = 16,
  alpha = 0.5,
): LocalPoint[] {
  const pts = controlPoints;
  const n = pts.length;
  const result: LocalPoint[] = [];

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(distance3D(p0, p1), 0.001), alpha);
    const t2 = t1 + Math.pow(Math.max(distance3D(p1, p2), 0.001), alpha);
    const t3 = t2 + Math.pow(Math.max(distance3D(p2, p3), 0.001), alpha);

    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      result.push(catmullRomPoint(p0, p1, p2, p3, t, t0, t1, t2, t3));
    }
  }

  return result;
}

export function resampleByArcLength(points: LocalPoint[], targetCount: number): LocalPoint[] {
  const closed = ensureClosed(points);
  const segments: number[] = [];
  let total = 0;

  for (let i = 0; i < closed.length - 1; i++) {
    const d = distance2D(closed[i], closed[i + 1]);
    segments.push(d);
    total += d;
  }

  if (total === 0) return points;

  const result: LocalPoint[] = [];
  const step = total / targetCount;
  let acc = 0;
  let segIdx = 0;
  let segT = 0;

  for (let i = 0; i < targetCount; i++) {
    const target = i * step;

    while (acc + segments[segIdx] * (1 - segT) < target && segIdx < segments.length - 1) {
      acc += segments[segIdx] * (1 - segT);
      segIdx++;
      segT = 0;
    }

    const segLen = segments[segIdx];
    const localTarget = target - acc;
    const t = segLen > 0 ? segT + localTarget / segLen : 0;
    const p0 = closed[segIdx];
    const p1 = closed[segIdx + 1];
    result.push(lerpPoint(p0, p1, Math.min(t, 1)));
  }

  return result;
}

export function resampleByArcLengthStep(points: LocalPoint[], stepMeters: number): LocalPoint[] {
  const closed = ensureClosed(points);
  const segments: number[] = [];
  let total = 0;

  for (let i = 0; i < closed.length - 1; i++) {
    const d = distance2D(closed[i], closed[i + 1]);
    segments.push(d);
    total += d;
  }

  if (total === 0) return points;

  const targetCount = Math.max(Math.ceil(total / stepMeters), 64);
  return resampleByArcLength(points, targetCount);
}

export interface SmoothBorderOptions {
  chaikinIterations?: number;
  samplesPerSegment?: number;
  arcStepMeters?: number;
}

export function smoothClosedBorder(
  points: LocalPoint[],
  options: SmoothBorderOptions = {},
): LocalPoint[] {
  const {
    chaikinIterations = 2,
    samplesPerSegment = 24,
    arcStepMeters = 1.2,
  } = options;

  const rounded = chaikinClosed(points, chaikinIterations);
  const splined = catmullRomCentripetalClosed(rounded, samplesPerSegment);
  return resampleByArcLengthStep(splined, arcStepMeters);
}

function signedAreaXZ(points: LocalPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].z - points[j].x * points[i].z;
  }
  return area * 0.5;
}

export function offsetClosedCurve(
  points: LocalPoint[],
  distance: number,
  inward: boolean,
): LocalPoint[] {
  const n = points.length;
  const ccw = signedAreaXZ(points) > 0;
  const sign = inward ? (ccw ? 1 : -1) : ccw ? -1 : 1;

  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = (-tz / len) * sign;
    const nz = (tx / len) * sign;

    return {
      x: p.x + nx * distance,
      y: p.y,
      z: p.z + nz * distance,
    };
  });
}
