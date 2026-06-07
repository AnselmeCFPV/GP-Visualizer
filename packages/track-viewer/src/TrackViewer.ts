import type {
  CameraMode,
  CameraViewDefinition,
  DemoSimulatorOptions,
  PlaybackState,
  RiderDefinition,
  RiderTelemetry,
  RiderUpdate,
  TrackRiderSampleOptions,
  TrackViewerHandle,
  TrackViewerOptions,
} from './types';
import { TrackWorld } from './TrackWorld';
import { TrackViewport } from './TrackViewport';

/** Raccourci mono-fenêtre — pour multi-vues, utiliser TrackWorld + TrackViewport */
export class TrackViewer implements TrackViewerHandle {
  private constructor(
    private readonly world: TrackWorld,
    private readonly viewport: TrackViewport,
  ) {}

  static async create(options: TrackViewerOptions): Promise<TrackViewer> {
    const { container, ...worldOptions } = options;
    const world = await TrackWorld.create(worldOptions);
    const viewport = TrackViewport.create({ world, container });
    return new TrackViewer(world, viewport);
  }

  dispose(): void {
    this.world.dispose();
  }

  getCenter() {
    return this.world.getCenter();
  }

  registerRider(definition: RiderDefinition): void {
    this.world.registerRider(definition);
  }

  unregisterRider(riderId: string): void {
    this.world.unregisterRider(riderId);
  }

  listRiders() {
    return this.world.listRiders();
  }

  setPrimaryRider(riderId: string): void {
    this.world.setPrimaryRider(riderId);
  }

  getPrimaryRiderId(): string {
    return this.world.getPrimaryRiderId();
  }

  setRiderUpdateIntervalMs(ms: number): void {
    this.world.setRiderUpdateIntervalMs(ms);
  }

  pushRiderUpdate(riderId: string, update: RiderUpdate): void {
    this.world.pushRiderUpdate(riderId, update);
  }

  sampleRiderUpdate(distanceM: number, options: TrackRiderSampleOptions): RiderUpdate {
    return this.world.sampleRiderUpdate(distanceM, options);
  }

  getTrackLength(): number {
    return this.world.getTrackLength();
  }

  startPlayback(riderId: string, trace: RiderUpdate[]): void {
    this.world.startPlayback(riderId, trace);
  }

  pausePlayback(riderId?: string): void {
    this.world.pausePlayback(riderId);
  }

  resumePlayback(riderId?: string): void {
    this.world.resumePlayback(riderId);
  }

  stopPlayback(riderId?: string): void {
    this.world.stopPlayback(riderId);
  }

  startDemoSimulator(options?: DemoSimulatorOptions | number): void {
    if (typeof options === 'number') {
      this.world.startDemoSimulator({ speedKmh: options });
    } else {
      this.world.startDemoSimulator(options);
    }
  }

  stopDemoSimulator(): void {
    this.world.stopDemoSimulator();
  }

  getRiderTelemetry(riderId?: string): RiderTelemetry | null {
    return this.world.getRiderTelemetry(riderId);
  }

  getAllRiderTelemetry(): RiderTelemetry[] {
    return this.world.getAllRiderTelemetry();
  }

  getPlaybackState(riderId?: string): PlaybackState {
    return this.world.getPlaybackState(riderId);
  }

  async resumeAudio(): Promise<void> {
    await this.world.resumeAudio();
  }

  resetCamera(): void {
    this.viewport.resetCamera();
  }

  setFollowRider(riderId: string): void {
    this.viewport.setFollowRider(riderId);
  }

  getFollowRider(): string {
    return this.viewport.getFollowRider();
  }

  setCameraMode(mode: CameraMode): void {
    this.viewport.setCameraMode(mode);
  }

  cycleCameraMode(): CameraMode {
    return this.viewport.cycleCameraMode();
  }

  getCameraMode(): CameraMode {
    return this.viewport.getCameraMode();
  }

  listCameraViews(): CameraViewDefinition[] {
    return this.viewport.listCameraViews();
  }

  setCameraView(viewId: string): void {
    this.viewport.setCameraView(viewId);
  }

  getActiveCameraView(): string {
    return this.viewport.getActiveCameraView();
  }

  registerCameraView(definition: CameraViewDefinition): void {
    this.viewport.registerCameraView(definition);
  }

  unregisterCameraView(viewId: string): void {
    this.viewport.unregisterCameraView(viewId);
  }
}

export { applyElevationFromGps } from './TrackWorld';
