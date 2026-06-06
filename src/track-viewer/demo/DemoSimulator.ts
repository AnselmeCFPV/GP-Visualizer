import { buildTrackPath, sampleTrackPath } from '../rider/TrackPath';
import type { LocalPoint } from '../types';
import { m1000rrLeanDeg } from '../rider/m1000rr';

export interface DemoState {
  distance: number;
  speedKmh: number;
  leanDeg: number;
}

/** Générateur interne de test — avance sur la centerline */
export class DemoSimulator {
  private readonly path;
  private distance = 0;
  private speedMs = 180 / 3.6;
  private active = false;

  constructor(centerline: LocalPoint[]) {
    this.path = buildTrackPath(centerline);
  }

  start(speedKmh = 180): void {
    this.active = true;
    this.distance = 0;
    this.speedMs = speedKmh / 3.6;
  }

  stop(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  setSpeedKmh(speedKmh: number): void {
    this.speedMs = speedKmh / 3.6;
  }

  tickFrame(dt: number): DemoState | null {
    if (!this.active) return null;

    this.distance += this.speedMs * dt;
    const sample = sampleTrackPath(this.path, this.distance);

    return {
      distance: this.distance,
      speedKmh: this.speedMs * 3.6,
      leanDeg: m1000rrLeanDeg(this.speedMs, sample.signedCurvature),
    };
  }
}
