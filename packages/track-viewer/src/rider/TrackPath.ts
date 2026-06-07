import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { distance2D } from '../utils/geo';

export interface PathSample {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  signedCurvature: number;
}

export interface TrackPathData {
  points: LocalPoint[];
  cumulative: number[];
  totalLength: number;
  signedCurvatures: number[];
  profileScale: number;
}

const TANGENT_DELTA_M = 5;

export interface BikeGroundPose {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  signedCurvature: number;
}

function smoothCircular(values: number[], radius: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let d = -radius; d <= radius; d++) {
      sum += values[(i + d + n) % n];
      count++;
    }
    return sum / count;
  });
}

export function buildTrackPath(centerline: LocalPoint[]): TrackPathData {
  const n = centerline.length;
  const cumulative = [0];
  const rawSigned: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n];
    const curr = centerline[i];
    const next = centerline[(i + 1) % n];

    if (i > 0) {
      cumulative.push(cumulative[i - 1] + distance2D(centerline[i - 1], curr));
    }

    const v1 = new THREE.Vector3(curr.x - prev.x, 0, curr.z - prev.z);
    const v2 = new THREE.Vector3(next.x - curr.x, 0, next.z - curr.z);
    const l1 = v1.length() || 1;
    const l2 = v2.length() || 1;
    v1.multiplyScalar(1 / l1);
    v2.multiplyScalar(1 / l2);

    const dot = Math.max(-1, Math.min(1, v1.dot(v2)));
    const angle = Math.acos(dot);
    const segLen = (l1 + l2) * 0.5;
    const curvature = angle / Math.max(segLen, 1);

    const crossY = v1.x * v2.z - v1.z * v2.x;
    const sign = Math.sign(crossY) || 0;
    rawSigned.push(curvature * sign);
  }

  const signedCurvatures = smoothCircular(smoothCircular(rawSigned, 12), 8);
  const totalLength = cumulative[n - 1] + distance2D(centerline[n - 1], centerline[0]);
  const profileScale = 1;

  return { points: centerline, cumulative, totalLength, signedCurvatures, profileScale };
}

function interpolateXZ(
  path: TrackPathData,
  s: number,
): { x: number; z: number; idx: number; t: number } {
  const { points, cumulative, totalLength } = path;
  const n = points.length;
  s = ((s % totalLength) + totalLength) % totalLength;

  let idx = 0;
  while (idx < n - 1 && cumulative[idx + 1] <= s) idx++;

  const p0 = points[idx];
  const p1 = points[(idx + 1) % n];
  const segStart = cumulative[idx];
  const segEnd = idx < n - 1 ? cumulative[idx + 1] : totalLength;
  const segLen = segEnd - segStart || 1;
  const t = (s - segStart) / segLen;

  return {
    x: p0.x + (p1.x - p0.x) * t,
    z: p0.z + (p1.z - p0.z) * t,
    idx,
    t,
  };
}

/** Altitude alignée sur la centerline (même source que la piste) */
function sampleCenterlineY(path: TrackPathData, s: number): number {
  const { points, totalLength } = path;
  const n = points.length;
  s = ((s % totalLength) + totalLength) % totalLength;
  const xz = interpolateXZ(path, s);
  const p0 = points[xz.idx];
  const p1 = points[(xz.idx + 1) % n];
  return p0.y + (p1.y - p0.y) * xz.t;
}

function samplePosition3D(path: TrackPathData, s: number): THREE.Vector3 {
  const xz = interpolateXZ(path, s);
  const y = sampleCenterlineY(path, s);
  return new THREE.Vector3(xz.x, y, xz.z);
}

/** Pose au sol : position sur l'arc (Y au centre — pas max(roues) qui tremble sur bosses) */
export function sampleBikeGroundPose(
  path: TrackPathData,
  distance: number,
  leanDeg = 0,
): BikeGroundPose {
  void leanDeg;
  return interpolateAt(path, distance);
}

function interpolateAt(
  path: TrackPathData,
  s: number,
): { position: THREE.Vector3; tangent: THREE.Vector3; signedCurvature: number } {
  const { signedCurvatures } = path;
  const n = path.points.length;
  s = ((s % path.totalLength) + path.totalLength) % path.totalLength;

  const position = samplePosition3D(path, s);

  const behind = samplePosition3D(path, s - TANGENT_DELTA_M);
  const ahead = samplePosition3D(path, s + TANGENT_DELTA_M);
  const tangent = ahead.sub(behind);
  if (tangent.lengthSq() < 1e-8) {
    tangent.set(0, 0, -1);
  } else {
    tangent.normalize();
  }

  const xz = interpolateXZ(path, s);
  const c0 = signedCurvatures[xz.idx];
  const c1 = signedCurvatures[(xz.idx + 1) % n];
  const signedCurvature = c0 * (1 - xz.t) + c1 * xz.t;

  return { position, tangent, signedCurvature };
}

export function sampleTrackPath(path: TrackPathData, distance: number): PathSample {
  return interpolateAt(path, distance);
}

/** Moyenne de courbure signée sur une fenêtre d'arc (mètres) */
export function sampleCurvatureWindow(
  path: TrackPathData,
  distance: number,
  behind: number,
  ahead: number,
): number {
  const steps = 8;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = distance - behind + (behind + ahead) * t;
    sum += interpolateAt(path, s).signedCurvature;
  }
  return sum / (steps + 1);
}

/** Courbure absolue max sur une fenêtre (anticipation freinage) */
export function sampleMaxCurvatureAhead(
  path: TrackPathData,
  distance: number,
  ahead: number,
  stepM = 4,
): { curvature: number; signedCurvature: number } {
  const steps = Math.max(4, Math.ceil(ahead / stepM));
  let maxK = 0;
  let signedAtMax = 0;

  for (let i = 0; i <= steps; i++) {
    const s = distance + (ahead * i) / steps;
    const sample = interpolateAt(path, s);
    const k = Math.abs(sample.signedCurvature);
    if (k > maxK) {
      maxK = k;
      signedAtMax = sample.signedCurvature;
    }
  }

  return { curvature: maxK, signedCurvature: signedAtMax };
}
