import type { PlaybackState, RiderUpdate } from '../types';
import type { InterpolatedRiderState } from '../rider/RiderPose';
import { RiderPose } from '../rider/RiderPose';
import type { GeoOrigin } from '../utils/geo';

export interface RiderPlaybackOptions {
  updateIntervalMs?: number;
}

/** Resynchronisation douce (1/s) — plus haut = rattrapage plus vif */
const SYNC_RATE = 10;
/** Au-delà de cet écart (m), snap immédiat sur l'autorité */
const HARD_SYNC_DISTANCE_M = 12;

export class RiderPlayback {
  private updateIntervalMs: number;
  private readonly origin: GeoOrigin;
  private readonly pose: RiderPose;

  private mode: PlaybackState['mode'] = 'idle';
  private paused = false;
  private hasData = false;

  /** État affiché — avance en continu, jamais reset brutalement */
  private display: InterpolatedRiderState = {
    distance: 0,
    speedKmh: 0,
    leanDeg: 0,
    lateralOffsetM: 0,
  };

  /** Dernière update reçue (autorité) */
  private authority: InterpolatedRiderState = { ...this.display };
  private authorityTimeMs = 0;

  private trace: RiderUpdate[] = [];
  private traceIndex = 0;
  private replayStartMs = 0;

  constructor(
    centerline: { x: number; y: number; z: number }[],
    origin: GeoOrigin,
    options: RiderPlaybackOptions = {},
  ) {
    this.pose = new RiderPose(centerline);
    this.origin = origin;
    this.updateIntervalMs = options.updateIntervalMs ?? 100;
  }

  getPose(): RiderPose {
    return this.pose;
  }

  getOrigin(): GeoOrigin {
    return this.origin;
  }

  setUpdateIntervalMs(ms: number): void {
    this.updateIntervalMs = ms;
  }

  pushUpdate(update: RiderUpdate): void {
    this.mode = 'playback';
    const time = update.timestamp ?? performance.now();
    const next = this.stateFromUpdate(update);

    if (!this.hasData) {
      this.authority = { ...next };
      this.display = { ...next };
      this.authorityTimeMs = time;
      this.hasData = true;
      return;
    }

    next.distance = this.unwrapDistance(this.authority.distance, next.distance);
    this.authority = next;
    this.authorityTimeMs = time;
  }

  startTrace(trace: RiderUpdate[]): void {
    if (trace.length === 0) return;
    this.trace = [...trace];
    this.traceIndex = 0;
    this.mode = 'playback';
    this.paused = false;
    this.replayStartMs = performance.now();
    this.applyTarget(trace[0]);
    this.display = { ...this.authority };
    this.hasData = true;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  stop(): void {
    this.mode = 'idle';
    this.paused = false;
    this.trace = [];
    this.traceIndex = 0;
    this.hasData = false;
    this.authorityTimeMs = 0;
  }

  /**
   * Dead reckoning : extrapolation continue depuis la dernière update,
   * correction douce vers la position prédite (pas de snap / segment reset).
   */
  tick(dt: number, nowMs = performance.now()): InterpolatedRiderState {
    if (this.mode === 'playback' && !this.paused && this.trace.length > 0) {
      this.advanceTraceReplay();
      const rate = 1 - Math.exp(-dt * 12);
      this.display.distance += (this.authority.distance - this.display.distance) * rate;
      this.display.speedKmh += (this.authority.speedKmh - this.display.speedKmh) * rate;
      this.display.leanDeg += (this.authority.leanDeg - this.display.leanDeg) * rate;
      this.display.lateralOffsetM +=
        (this.authority.lateralOffsetM - this.display.lateralOffsetM) * rate;
      return { ...this.display };
    }

    if (!this.hasData || dt <= 0) {
      return { ...this.display };
    }

    const sync = 1 - Math.exp(-dt * SYNC_RATE);
    const elapsedS = Math.max(0, (nowMs - this.authorityTimeMs) / 1000);

    this.display.speedKmh += (this.authority.speedKmh - this.display.speedKmh) * sync;
    this.display.leanDeg += (this.authority.leanDeg - this.display.leanDeg) * sync;
    this.display.lateralOffsetM +=
      (this.authority.lateralOffsetM - this.display.lateralOffsetM) * sync;

    const authoritySpeedMs = Math.max(this.authority.speedKmh, 0) / 3.6;
    const predictedDistance =
      this.authority.distance + authoritySpeedMs * elapsedS;

    const error = predictedDistance - this.display.distance;
    if (Math.abs(error) > HARD_SYNC_DISTANCE_M) {
      this.display.distance = predictedDistance;
    } else {
      this.display.distance += error * sync;
    }

    return { ...this.display };
  }

  getState(): PlaybackState {
    const pos = this.pose.updateFromDistance(
      this.display.distance,
      this.display.speedKmh,
      this.display.leanDeg,
      0,
      this.display.lateralOffsetM,
      { smoothing: false },
    );

    return {
      mode: this.mode,
      paused: this.paused,
      speedKmh: this.display.speedKmh,
      leanDeg: this.display.leanDeg,
      position: {
        x: pos.bikePosition.x,
        y: pos.bikePosition.y,
        z: pos.bikePosition.z,
      },
      traceProgress:
        this.trace.length > 0 ? this.traceIndex / this.trace.length : 0,
    };
  }

  hasReceivedData(): boolean {
    return this.hasData;
  }

  private applyTarget(update: RiderUpdate): void {
    const next = this.stateFromUpdate(update);
    next.distance = this.unwrapDistance(this.authority.distance, next.distance);
    this.authority = next;
  }

  private stateFromUpdate(update: RiderUpdate): InterpolatedRiderState {
    const distance =
      update.distanceM !== undefined
        ? update.distanceM
        : this.pose.projectUpdate(update, this.origin);

    return {
      distance,
      speedKmh: update.speedKmh,
      leanDeg: update.leanDeg,
      lateralOffsetM: update.lateralOffsetM ?? 0,
    };
  }

  private unwrapDistance(reference: number, next: number): number {
    const totalLength = this.pose.getPath().totalLength;
    let result = next;
    while (result < reference - totalLength * 0.5) result += totalLength;
    while (result > reference + totalLength * 0.5) result -= totalLength;
    return result;
  }

  private advanceTraceReplay(): void {
    const elapsed = performance.now() - this.replayStartMs;

    while (this.traceIndex < this.trace.length - 1) {
      const next = this.trace[this.traceIndex + 1];
      const t1 = next.timestamp ?? (this.traceIndex + 1) * this.updateIntervalMs;
      if (elapsed < t1) break;
      this.traceIndex++;
      this.applyTarget(next);
    }

    if (this.traceIndex >= this.trace.length - 1) {
      this.applyTarget(this.trace[this.trace.length - 1]);
    }
  }
}
