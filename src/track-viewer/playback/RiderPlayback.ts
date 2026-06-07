import * as THREE from 'three';
import type { PlaybackState, RiderUpdate } from '../types';
import type { InterpolatedRiderState } from '../rider/RiderPose';
import { RiderPose } from '../rider/RiderPose';
import type { GeoOrigin } from '../utils/geo';

export interface RiderPlaybackOptions {
  updateIntervalMs?: number;
}

export class RiderPlayback {
  private updateIntervalMs: number;
  private readonly origin: GeoOrigin;
  private readonly pose: RiderPose;

  private mode: PlaybackState['mode'] = 'idle';
  private paused = false;
  private hasData = false;

  private current: InterpolatedRiderState = {
    distance: 0,
    speedKmh: 0,
    leanDeg: 0,
  };
  private segmentStart: InterpolatedRiderState = { ...this.current };
  private target: InterpolatedRiderState = { ...this.current };
  private segmentStartMs = 0;
  private segmentDurationMs = 100;
  private lastUpdateTimestamp: number | null = null;

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
    const now = performance.now();
    const next = this.stateFromUpdate(update);

    if (!this.hasData) {
      this.current = { ...next };
      this.segmentStart = { ...next };
      this.target = { ...next };
      this.segmentStartMs = now;
    } else {
      next.distance = this.unwrapDistance(this.target.distance, next.distance);
      this.segmentStart = { ...this.current };
      this.target = next;
      this.segmentStartMs = now;
    }

    const incomingTimestamp = update.timestamp ?? null;
    if (incomingTimestamp !== null && this.lastUpdateTimestamp !== null) {
      const delta = incomingTimestamp - this.lastUpdateTimestamp;
      this.segmentDurationMs = THREE.MathUtils.clamp(delta, 30, 500);
    } else {
      this.segmentDurationMs = this.updateIntervalMs;
    }
    this.lastUpdateTimestamp = incomingTimestamp;
    this.hasData = true;
  }

  startTrace(trace: RiderUpdate[]): void {
    if (trace.length === 0) return;
    this.trace = [...trace];
    this.traceIndex = 0;
    this.mode = 'playback';
    this.paused = false;
    this.replayStartMs = performance.now();
    this.applyTarget(trace[0]);
    this.current = { ...this.target };
    this.segmentStart = { ...this.target };
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
    this.lastUpdateTimestamp = null;
  }

  /** Interpolation temporelle entre vos mises à jour (distance / vitesse / inclinaison) */
  tick(dt: number): InterpolatedRiderState {
    if (this.mode === 'playback' && !this.paused && this.trace.length > 0) {
      this.advanceTraceReplay();
      const rate = 1 - Math.exp(-dt * 12);
      this.current.distance += (this.target.distance - this.current.distance) * rate;
      this.current.speedKmh += (this.target.speedKmh - this.current.speedKmh) * rate;
      this.current.leanDeg += (this.target.leanDeg - this.current.leanDeg) * rate;
      return { ...this.current };
    }

    const elapsed = performance.now() - this.segmentStartMs;
    const t = THREE.MathUtils.clamp(elapsed / Math.max(this.segmentDurationMs, 1), 0, 1);
    this.current.distance = THREE.MathUtils.lerp(
      this.segmentStart.distance,
      this.target.distance,
      t,
    );
    this.current.speedKmh = THREE.MathUtils.lerp(
      this.segmentStart.speedKmh,
      this.target.speedKmh,
      t,
    );
    this.current.leanDeg = THREE.MathUtils.lerp(
      this.segmentStart.leanDeg,
      this.target.leanDeg,
      t,
    );

    return { ...this.current };
  }

  getState(): PlaybackState {
    const pos = this.pose.updateFromDistance(
      this.current.distance,
      this.current.speedKmh,
      this.current.leanDeg,
      0,
    );

    return {
      mode: this.mode,
      paused: this.paused,
      speedKmh: this.current.speedKmh,
      leanDeg: this.current.leanDeg,
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
    next.distance = this.unwrapDistance(this.target.distance, next.distance);
    this.target = next;
  }

  private stateFromUpdate(update: RiderUpdate): InterpolatedRiderState {
    return {
      distance: this.pose.projectUpdate(update, this.origin),
      speedKmh: update.speedKmh,
      leanDeg: update.leanDeg,
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
