import * as THREE from 'three';
import { buildTrackPath, sampleTrackPath } from '../rider/TrackPath';
import type { LocalPoint } from '../types';
import { m1000rrLeanDeg } from '../rider/m1000rr';

export interface DemoRiderState {
  distance: number;
  speedKmh: number;
  leanDeg: number;
  /** Décalage perpendiculaire à la piste (+ = extérieur virage) */
  lateralOffsetM: number;
}

export interface MultiRiderDemoOptions {
  riderIds: string[];
  speedKmh?: number;
  /** Écart moyen entre pilotes au départ (m) */
  spacingM?: number;
}

const TRACK_HALF_WIDTH_M = 4.2;
const MAX_LATERAL_M = TRACK_HALF_WIDTH_M * 0.88;

interface RiderSimProfile {
  id: string;
  distance: number;
  speedMs: number;
  lateral: number;
  weavePhase: number;
  weaveFreqA: number;
  weaveFreqB: number;
  weaveAmp: number;
  lineBias: number;
  lineTarget: number;
  speedBiasMs: number;
  speedWobblePhase: number;
  nextManeuverAt: number;
  maneuverSeed: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Générateur interne — pilotes avec trajectoires et vitesses variées */
export class MultiRiderDemo {
  private readonly path;
  private baseSpeedMs = 180 / 3.6;
  private active = false;
  private spacingM = 8;
  private profiles: RiderSimProfile[] = [];
  private elapsed = 0;

  constructor(centerline: LocalPoint[]) {
    this.path = buildTrackPath(centerline);
  }

  start(options: MultiRiderDemoOptions): void {
    this.baseSpeedMs = (options.speedKmh ?? 180) / 3.6;
    this.spacingM = options.spacingM ?? 8;
    this.elapsed = 0;
    this.profiles = options.riderIds.map((id, i) => this.createProfile(id, i));
    this.active = this.profiles.length > 0;
  }

  stop(): void {
    this.active = false;
    this.profiles = [];
  }

  isActive(): boolean {
    return this.active;
  }

  tickFrame(dt: number): Map<string, DemoRiderState> | null {
    if (!this.active) return null;

    this.elapsed += dt;
    const result = new Map<string, DemoRiderState>();
    const leaderDist = this.profiles[0]?.distance ?? 0;

    for (let i = 0; i < this.profiles.length; i++) {
      const p = this.profiles[i]!;
      const sample = sampleTrackPath(this.path, p.distance);

      if (this.elapsed >= p.nextManeuverAt) {
        p.lineTarget = rand(-2.8, 2.8);
        p.nextManeuverAt = this.elapsed + rand(2.5, 6.5);
        p.maneuverSeed = Math.random();
      }

      const weave =
        Math.sin(this.elapsed * p.weaveFreqA + p.weavePhase) * p.weaveAmp * 0.55 +
        Math.sin(this.elapsed * p.weaveFreqB + p.weavePhase * 1.7) * p.weaveAmp * 0.35 +
        Math.sin(this.elapsed * 2.3 + p.maneuverSeed * 12) * 0.25;

      const lateralTarget = THREE.MathUtils.clamp(
        p.lineBias + p.lineTarget * 0.45 + weave,
        -MAX_LATERAL_M,
        MAX_LATERAL_M,
      );
      p.lateral += (lateralTarget - p.lateral) * (1 - Math.exp(-dt * 1.8));

      let targetSpeed =
        this.baseSpeedMs +
        p.speedBiasMs +
        Math.sin(this.elapsed * 0.9 + p.speedWobblePhase) * 1.4 +
        Math.sin(this.elapsed * 2.1 + p.weavePhase) * 0.6;

      if (i > 0) {
        const gap = leaderDist - p.distance;
        if (gap > this.spacingM * 2.2) targetSpeed += 1.8;
        if (gap < this.spacingM * 0.55) targetSpeed -= 2.2;
      }

      p.speedMs += (targetSpeed - p.speedMs) * (1 - Math.exp(-dt * 0.85));
      p.speedMs = THREE.MathUtils.clamp(p.speedMs, this.baseSpeedMs * 0.82, this.baseSpeedMs * 1.08);
      p.distance += p.speedMs * dt;

      const leanBase = m1000rrLeanDeg(p.speedMs, sample.signedCurvature);
      const leanJitter =
        sample.signedCurvature * p.lateral * 4.5 +
        Math.sin(this.elapsed * 3.5 + p.weavePhase) * 1.2;

      result.set(p.id, {
        distance: p.distance,
        speedKmh: p.speedMs * 3.6,
        leanDeg: THREE.MathUtils.clamp(leanBase + leanJitter, -58, 58),
        lateralOffsetM: p.lateral,
      });
    }

    return result;
  }

  private createProfile(id: string, index: number): RiderSimProfile {
    return {
      id,
      distance: -index * this.spacingM,
      speedMs: this.baseSpeedMs + rand(-1.2, 1.2),
      lateral: rand(-1.5, 1.5),
      weavePhase: rand(0, Math.PI * 2),
      weaveFreqA: rand(0.35, 0.95),
      weaveFreqB: rand(0.6, 1.6),
      weaveAmp: rand(0.9, 2.6),
      lineBias: rand(-2.2, 2.2),
      lineTarget: rand(-1.5, 1.5),
      speedBiasMs: rand(-1.1, 1.4),
      speedWobblePhase: rand(0, Math.PI * 2),
      nextManeuverAt: rand(1, 4),
      maneuverSeed: Math.random(),
    };
  }
}
