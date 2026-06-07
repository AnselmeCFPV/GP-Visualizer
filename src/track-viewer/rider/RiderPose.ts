import * as THREE from 'three';
import { geoToLocal, type GeoOrigin } from '../utils/geo';
import {
  buildTrackPath,
  sampleBikeGroundPose,
  type TrackPathData,
} from './TrackPath';
import type { RiderUpdate } from '../types';

const BIKE_GROUND_OFFSET = -0.1;

export interface RiderFrame {
  bikePosition: THREE.Vector3;
  bikeQuaternion: THREE.Quaternion;
  tangent: THREE.Vector3;
  speedKmh: number;
  leanDeg: number;
}

export interface InterpolatedRiderState {
  distance: number;
  speedKmh: number;
  leanDeg: number;
  lateralOffsetM: number;
}

export interface RiderPoseUpdateOptions {
  /** Lissage visuel — désactivé en mode API (interpolation déjà gérée en amont) */
  smoothing?: boolean;
}

const _pivot = new THREE.Vector3();
const _lookFrom = new THREE.Vector3();
const _lookTo = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _lookMat = new THREE.Matrix4();
const _baseQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();
const _rollAxis = new THREE.Vector3(0, 0, 1);
const _targetQuat = new THREE.Quaternion();

export class RiderPose {
  private readonly path: TrackPathData;
  private bikeQuaternion = new THREE.Quaternion();
  private distanceSmoothed: number | null = null;
  private positionSmoothed: THREE.Vector3 | null = null;
  private leanSmoothed = 0;

  constructor(centerline: { x: number; y: number; z: number }[]) {
    this.path = buildTrackPath(centerline);
    this.bikeQuaternion.identity();
  }

  getPath(): TrackPathData {
    return this.path;
  }

  projectUpdate(update: RiderUpdate, origin: GeoOrigin): number {
    const local = geoToLocal(
      { lon: update.lon, lat: update.lat, elevation: update.elevation ?? 0 },
      origin,
    );
    return this.projectLocal(local.x, local.z);
  }

  projectLocal(x: number, z: number): number {
    const { points, cumulative, totalLength } = this.path;
    const n = points.length;
    let bestDist = Infinity;
    let bestDistance = 0;

    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq));
      const cx = a.x + dx * t;
      const cz = a.z + dz * t;
      const dist = Math.hypot(x - cx, z - cz);

      if (dist < bestDist) {
        bestDist = dist;
        const segStart = cumulative[i];
        const segEnd = i < n - 1 ? cumulative[i + 1] : totalLength;
        bestDistance = segStart + (segEnd - segStart) * t;
      }
    }

    return bestDistance;
  }

  updateFromDistance(
    distance: number,
    speedKmh: number,
    leanDeg: number,
    dt: number,
    lateralOffsetM = 0,
    options: RiderPoseUpdateOptions = {},
  ): RiderFrame {
    const smooth = options.smoothing ?? true;
    const trackDistance = smooth ? this.resolveDistance(distance, dt) : distance;
    const trackLean = smooth ? this.resolveLean(leanDeg, dt) : leanDeg;

    const ground = sampleBikeGroundPose(this.path, trackDistance, trackLean);

    _pivot.copy(ground.position);
    _pivot.y += BIKE_GROUND_OFFSET;

    if (Math.abs(lateralOffsetM) > 1e-4) {
      const nx = -ground.tangent.z;
      const nz = ground.tangent.x;
      _pivot.x += nx * lateralOffsetM;
      _pivot.z += nz * lateralOffsetM;
    }

    if (!smooth) {
      if (this.positionSmoothed === null) {
        this.positionSmoothed = _pivot.clone();
      } else {
        this.positionSmoothed.copy(_pivot);
      }
      this.setQuaternion(ground.tangent, trackLean);
    } else if (this.positionSmoothed === null) {
      this.positionSmoothed = _pivot.clone();
      this.updateQuaternion(ground.tangent, trackLean, dt);
    } else {
      const posAlpha = 1 - Math.exp(-dt * 10);
      this.positionSmoothed.x += (_pivot.x - this.positionSmoothed.x) * posAlpha;
      this.positionSmoothed.z += (_pivot.z - this.positionSmoothed.z) * posAlpha;
      this.positionSmoothed.y += (_pivot.y - this.positionSmoothed.y) * posAlpha;
      this.updateQuaternion(ground.tangent, trackLean, dt);
    }

    return {
      bikePosition: this.positionSmoothed.clone(),
      bikeQuaternion: this.bikeQuaternion.clone(),
      tangent: ground.tangent.clone(),
      speedKmh,
      leanDeg: trackLean,
    };
  }

  private resolveDistance(distance: number, dt: number): number {
    if (this.distanceSmoothed === null) {
      this.distanceSmoothed = distance;
      return distance;
    }
    const distAlpha = 1 - Math.exp(-dt * 14);
    this.distanceSmoothed += (distance - this.distanceSmoothed) * distAlpha;
    return this.distanceSmoothed;
  }

  private resolveLean(leanDeg: number, dt: number): number {
    this.leanSmoothed += (leanDeg - this.leanSmoothed) * (1 - Math.exp(-dt * 9));
    return this.leanSmoothed;
  }

  resetQuaternion(): void {
    this.bikeQuaternion.identity();
    this.distanceSmoothed = null;
    this.positionSmoothed = null;
    this.leanSmoothed = 0;
  }

  private setQuaternion(tangent: THREE.Vector3, leanDeg: number): void {
    this.bikeQuaternion.copy(this.buildTargetQuaternion(tangent, leanDeg));
  }

  private updateQuaternion(tangent: THREE.Vector3, leanDeg: number, dt: number): void {
    _targetQuat.copy(this.buildTargetQuaternion(tangent, leanDeg));
    this.bikeQuaternion.slerp(_targetQuat, 1 - Math.exp(-dt * 12));
  }

  private buildTargetQuaternion(tangent: THREE.Vector3, leanDeg: number): THREE.Quaternion {
    _lookFrom.set(0, 0, 0);
    _lookTo.copy(tangent);
    if (_lookTo.lengthSq() < 1e-8) {
      _lookTo.set(0, 0, -1);
    } else {
      _lookTo.normalize();
    }

    _lookMat.lookAt(_lookFrom, _lookTo, _worldUp);
    _baseQuat.setFromRotationMatrix(_lookMat);

    const rollRad = (-leanDeg * Math.PI) / 180;
    _rollQuat.setFromAxisAngle(_rollAxis, rollRad);
    return _targetQuat.copy(_baseQuat).multiply(_rollQuat);
  }
}
