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
  private target: InterpolatedRiderState = { ...this.current };

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
    this.applyTarget(update);
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
  }

  /** Interpolation légère entre vos mises à jour (distance / vitesse / inclinaison) */
  tick(dt: number): InterpolatedRiderState {
    if (this.mode === 'playback' && !this.paused && this.trace.length > 0) {
      this.advanceTraceReplay();
    }

    const rate = 1 - Math.exp(-dt * 12);
    this.current.distance += (this.target.distance - this.current.distance) * rate;
    this.current.speedKmh += (this.target.speedKmh - this.current.speedKmh) * rate;
    this.current.leanDeg += (this.target.leanDeg - this.current.leanDeg) * rate;

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
    this.target.distance = this.pose.projectUpdate(update, this.origin);
    this.target.speedKmh = update.speedKmh;
    this.target.leanDeg = update.leanDeg;
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
