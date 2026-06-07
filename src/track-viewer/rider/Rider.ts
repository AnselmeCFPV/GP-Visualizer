import * as THREE from 'three';
import type { Scene } from 'three';
import type { LocalPoint, PlaybackState, RiderColor, RiderUpdate } from '../types';
import { RiderPose, type RiderFrame } from './RiderPose';
import { RiderVisual } from './RiderVisual';
import { RiderTrail } from './RiderTrail';
import { RiderPlayback } from '../playback/RiderPlayback';
import type { GeoOrigin } from '../utils/geo';
import type { DemoRiderState } from '../demo/MultiRiderDemo';
import { cloneBikeRig, type BikeRig } from './loadBikeModel';

const TRAIL_REAR_OFFSET_M = 0.7;
const _trailOrigin = new THREE.Vector3();

export interface RiderOptions {
  label?: string;
  country?: string;
  /** Livrée PNG prédéfinie, ou teinte hex de fallback */
  color?: RiderColor | number;
}

export class Rider {
  readonly id: string;
  readonly label: string;
  readonly country?: string;
  readonly visual = new RiderVisual();
  readonly trail = new RiderTrail();
  readonly playback: RiderPlayback;

  private readonly pose: RiderPose;
  private readonly color?: RiderColor | number;
  private modelReady = false;
  private lastFrame: RiderFrame | null = null;
  private firstPersonMode = false;

  constructor(
    id: string,
    centerline: LocalPoint[],
    origin: GeoOrigin,
    updateIntervalMs: number,
    options: RiderOptions = {},
  ) {
    this.id = id;
    this.label = options.label ?? id;
    this.country = options.country?.toUpperCase();
    this.color = options.color;
    this.pose = new RiderPose(centerline);
    this.playback = new RiderPlayback(centerline, origin, { updateIntervalMs });
  }

  mountModel(template: BikeRig, scene: Scene): void {
    const rig = cloneBikeRig(template, this.color);
    this.visual.setModel(rig.group, rig.wheelOffsets);
    scene.add(this.visual.group);
    scene.add(this.trail.mesh);
    this.modelReady = true;
    this.visual.setVisible(false);
  }

  setUpdateIntervalMs(ms: number): void {
    this.playback.setUpdateIntervalMs(ms);
  }

  pushUpdate(update: RiderUpdate): void {
    this.playback.pushUpdate(update);
  }

  startPlayback(trace: RiderUpdate[]): void {
    this.playback.startTrace(trace);
    this.trail.reset();
    this.visual.setVisible(true);
  }

  pausePlayback(): void {
    this.playback.pause();
  }

  resumePlayback(): void {
    this.playback.resume();
  }

  stopPlayback(): void {
    this.playback.stop();
    this.trail.reset();
    this.visual.setVisible(false);
    this.lastFrame = null;
  }

  updateFromDemo(state: DemoRiderState, dt: number): RiderFrame | null {
    const frame = this.pose.updateFromDistance(
      state.distance,
      state.speedKmh,
      state.leanDeg,
      dt,
      state.lateralOffsetM,
    );
    return this.applyFrame(frame, dt);
  }

  update(dt: number): RiderFrame | null {
    if (!this.playback.hasReceivedData()) {
      return this.lastFrame;
    }

    const state = this.playback.tick(dt, performance.now());
    const frame = this.pose.updateFromDistance(
      state.distance,
      state.speedKmh,
      state.leanDeg,
      dt,
      state.lateralOffsetM,
      { smoothing: false },
    );
    return this.applyFrame(frame, dt);
  }

  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled;
    this.visual.setFirstPersonMode(enabled);
  }

  isFirstPersonMode(): boolean {
    return this.firstPersonMode;
  }

  getLastFrame(): RiderFrame | null {
    return this.lastFrame;
  }

  getPlaybackState(): PlaybackState {
    return this.playback.getState();
  }

  getSpeedKmh(): number {
    return this.lastFrame?.speedKmh ?? 0;
  }

  private applyFrame(frame: RiderFrame, dt: number): RiderFrame | null {
    this.lastFrame = frame;

    if (this.modelReady) {
      this.visual.setVisible(true);
      this.visual.apply(frame, dt);
      _trailOrigin
        .copy(frame.bikePosition)
        .addScaledVector(frame.tangent, -TRAIL_REAR_OFFSET_M);
      this.trail.update(_trailOrigin, frame.tangent, dt);
    }

    return frame;
  }

  hide(): void {
    this.visual.setVisible(false);
    this.lastFrame = null;
  }

  dispose(): void {
    this.visual.group.removeFromParent();
    this.trail.mesh.removeFromParent();
  }
}
