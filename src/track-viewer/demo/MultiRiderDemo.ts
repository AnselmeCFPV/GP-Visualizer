import { buildTrackPath, sampleTrackPath } from '../rider/TrackPath';
import type { LocalPoint } from '../types';
import { m1000rrLeanDeg } from '../rider/m1000rr';

export interface DemoRiderState {
  distance: number;
  speedKmh: number;
  leanDeg: number;
}

export interface MultiRiderDemoOptions {
  riderIds: string[];
  speedKmh?: number;
  /** Écart entre pilotes sur la piste (m) */
  spacingM?: number;
}

/** Générateur interne — plusieurs pilotes espacés sur la centerline */
export class MultiRiderDemo {
  private readonly path;
  private leaderDistance = 0;
  private speedMs = 180 / 3.6;
  private active = false;
  private riderIds: string[] = [];
  private spacingM = 8;

  constructor(centerline: LocalPoint[]) {
    this.path = buildTrackPath(centerline);
  }

  start(options: MultiRiderDemoOptions): void {
    this.riderIds = [...options.riderIds];
    this.spacingM = options.spacingM ?? 8;
    this.speedMs = (options.speedKmh ?? 180) / 3.6;
    this.leaderDistance = 0;
    this.active = this.riderIds.length > 0;
  }

  stop(): void {
    this.active = false;
    this.riderIds = [];
  }

  isActive(): boolean {
    return this.active;
  }

  tickFrame(dt: number): Map<string, DemoRiderState> | null {
    if (!this.active) return null;

    this.leaderDistance += this.speedMs * dt;
    const result = new Map<string, DemoRiderState>();

    for (let i = 0; i < this.riderIds.length; i++) {
      const id = this.riderIds[i]!;
      const distance = this.leaderDistance - i * this.spacingM;
      const sample = sampleTrackPath(this.path, distance);

      result.set(id, {
        distance,
        speedKmh: this.speedMs * 3.6,
        leanDeg: m1000rrLeanDeg(this.speedMs, sample.signedCurvature),
      });
    }

    return result;
  }
}
