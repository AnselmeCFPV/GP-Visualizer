import * as THREE from 'three';
import { loadTrackKml } from './kmlParser';
import { enrichWithLapmetaProfile } from './utils/lapmetaElevation';
import { buildTrackScene } from './buildTrackScene';
import type {
  DemoSimulatorOptions,
  GeoPoint,
  LocalPoint,
  PlaybackState,
  RiderColor,
  RiderDefinition,
  RiderTelemetry,
  RiderUpdate,
  TrackBorders,
  TrackRiderSampleOptions,
  TrackWorldHandle,
  TrackWorldOptions,
} from './types';
import { Rider } from './rider/Rider';
import { MultiRiderDemo } from './demo/MultiRiderDemo';
import { loadBikeModel, type BikeRig } from './rider/loadBikeModel';
import { EngineSound } from './audio/EngineSound';
import {
  configureRendererShadows,
  createSceneEnvironment,
  updateSunShadowTarget,
  type SceneEnvironment,
} from './scene/environment';
import { loadSurfaceTextures } from './utils/textures';
import type { TrackViewport } from './TrackViewport';
import { buildTrackPath, sampleTrackPath, type TrackPathData } from './rider/TrackPath';
import { localToGeo } from './utils/geo';
import { m1000rrLeanDeg } from './rider/m1000rr';

const DEFAULT_KML = '/track_data/track_data.kml';
export const DEFAULT_RIDER_ID = 'rider-1';

const DEMO_RIDER_COLORS: RiderColor[] = [
  'red',
  'blue-dark',
  'yellow',
  'magenta',
];

export class TrackWorld implements TrackWorldHandle {
  readonly scene: THREE.Scene;
  private readonly environment: SceneEnvironment;
  private readonly riders = new Map<string, Rider>();
  private readonly viewports = new Set<TrackViewport>();
  private demo: MultiRiderDemo | null = null;
  private readonly clock = new THREE.Clock();

  private center: LocalPoint = { x: 0, y: 0, z: 0 };
  private centerline: LocalPoint[] = [];
  private trackPath: TrackPathData | null = null;
  private updateIntervalMs = 100;
  private animationId = 0;
  private bikeTemplate: BikeRig | null = null;
  private engineSound: EngineSound | null = null;
  private audioCamera: THREE.PerspectiveCamera | null = null;
  private primaryRiderId = DEFAULT_RIDER_ID;
  private beforeUpdate: ((now: number, dt: number) => void) | null = null;

  private constructor(options: TrackWorldOptions) {
    this.scene = new THREE.Scene();
    this.environment = createSceneEnvironment(this.scene);
    if (options.backgroundColor !== undefined) {
      this.scene.background = new THREE.Color(options.backgroundColor);
    }
  }

  static async create(options: TrackWorldOptions = {}): Promise<TrackWorld> {
    const world = new TrackWorld(options);
    await world.init(options);
    return world;
  }

  private async init(options: TrackWorldOptions): Promise<void> {
    let borders =
      options.borders ??
      (await loadTrackKml(options.kmlUrl ?? DEFAULT_KML));

    if (options.fetchElevation !== false && !options.borders) {
      borders = {
        ...borders,
        outer: await enrichWithLapmetaProfile(borders.outer),
      };
    }

    const textures = await loadSurfaceTextures({
      asphaltUrl: options.asphaltTextureUrl,
      grassUrl: options.grassTextureUrl,
    });

    const trackWidth = options.trackWidth ?? 10;
    const kerbWidth = options.kerbWidth ?? 1.75;
    const trackData = buildTrackScene(borders, {
      trackWidth,
      kerbWidth,
      grassRadius: options.grassRadius ?? 120,
      textures,
    });

    this.center = trackData.center;
    this.centerline = trackData.centerline;
    this.trackPath = buildTrackPath(this.centerline);
    this.demo = new MultiRiderDemo(this.centerline);
    this.updateIntervalMs = options.riderUpdateIntervalMs ?? 100;
    this.scene.add(trackData.group);

    updateSunShadowTarget(this.environment, trackData.shadowVolume);

    const loadRenderer = new THREE.WebGLRenderer({ antialias: true });
    configureRendererShadows(loadRenderer);
    this.bikeTemplate = await loadBikeModel(loadRenderer);
    loadRenderer.dispose();

    this.audioCamera = new THREE.PerspectiveCamera();
    this.engineSound = new EngineSound(this.audioCamera, new THREE.Group());
    try {
      await this.engineSound.load(options.engineSoundUrl);
    } catch {
      console.warn('[track-viewer] Fichier moteur introuvable — déposez public/sounds/engine.mp3');
    }

    if (options.startDemoSimulator) {
      this.startDemoSimulator({
        riderCount: options.demoRiderCount ?? 4,
        speedKmh: options.demoSpeedKmh,
        spacingM: options.demoSpacingM,
      });
    }

    this.startLoop();
  }

  /** Hook appelé au début de chaque frame render (avant interpolation pilotes) */
  onBeforeUpdate(handler: (now: number, dt: number) => void): void {
    this.beforeUpdate = handler;
  }

  attachViewport(viewport: TrackViewport): void {
    this.viewports.add(viewport);
  }

  detachViewport(viewport: TrackViewport): void {
    this.viewports.delete(viewport);
  }

  registerRider(definition: RiderDefinition): void {
    if (this.riders.has(definition.id)) {
      throw new Error(`[track-viewer] Pilote déjà enregistré : "${definition.id}"`);
    }

    const origin = this.getGeoOrigin();
    const rider = new Rider(
      definition.id,
      this.centerline,
      origin,
      this.updateIntervalMs,
      { label: definition.label, country: definition.country, color: definition.color },
    );

    if (this.bikeTemplate) {
      rider.mountModel(this.bikeTemplate, this.scene);
    }

    this.riders.set(definition.id, rider);

    if (this.riders.size === 1) {
      this.primaryRiderId = definition.id;
    }
  }

  unregisterRider(riderId: string): void {
    const rider = this.riders.get(riderId);
    if (!rider) return;

    rider.dispose();
    this.riders.delete(riderId);

    if (this.primaryRiderId === riderId) {
      this.primaryRiderId = this.riders.keys().next().value ?? DEFAULT_RIDER_ID;
    }
  }

  listRiders(): RiderDefinition[] {
    return [...this.riders.values()].map((r) => ({
      id: r.id,
      label: r.label,
      country: r.country,
    }));
  }

  setPrimaryRider(riderId: string): void {
    if (!this.riders.has(riderId)) {
      throw new Error(`[track-viewer] Pilote inconnu : "${riderId}"`);
    }
    this.primaryRiderId = riderId;
  }

  getPrimaryRiderId(): string {
    return this.primaryRiderId;
  }

  setRiderUpdateIntervalMs(ms: number): void {
    this.updateIntervalMs = ms;
    for (const rider of this.riders.values()) {
      rider.setUpdateIntervalMs(ms);
    }
  }

  pushRiderUpdate(riderId: string, update: RiderUpdate): void {
    this.ensureRider(riderId);
    this.demo?.stop();
    this.riders.get(riderId)!.pushUpdate(update);
  }

  /** Mise à jour légère (sans conversion GPS) — idéal pour la sim interne haute fréquence */
  sampleRiderKinematics(
    distanceM: number,
    options: TrackRiderSampleOptions,
  ): RiderUpdate {
    if (!this.trackPath) {
      throw new Error('[track-viewer] Circuit non initialisé');
    }

    const sample = sampleTrackPath(this.trackPath, distanceM);
    const lateralOffset = options.lateralOffsetM ?? 0;

    return {
      lon: 0,
      lat: 0,
      speedKmh: options.speedKmh,
      leanDeg:
        options.leanDeg ??
        m1000rrLeanDeg(options.speedKmh / 3.6, sample.signedCurvature),
      distanceM,
      lateralOffsetM: lateralOffset,
      timestamp: options.timestamp,
    };
  }

  sampleRiderUpdate(distanceM: number, options: TrackRiderSampleOptions): RiderUpdate {
    if (!this.trackPath) {
      throw new Error('[track-viewer] Circuit non initialisé');
    }

    const sample = sampleTrackPath(this.trackPath, distanceM);
    const position = sample.position.clone();
    const lateralOffset = options.lateralOffsetM ?? 0;
    if (Math.abs(lateralOffset) > 1e-4) {
      position.x += -sample.tangent.z * lateralOffset;
      position.z += sample.tangent.x * lateralOffset;
    }

    const origin = this.getGeoOrigin();
    const geo = localToGeo(
      { x: position.x, y: position.y, z: position.z },
      origin,
    );
    const headingDeg =
      (THREE.MathUtils.radToDeg(Math.atan2(sample.tangent.x, -sample.tangent.z)) + 360) % 360;

    return {
      lon: geo.lon,
      lat: geo.lat,
      elevation: geo.elevation,
      speedKmh: options.speedKmh,
      leanDeg: options.leanDeg ?? m1000rrLeanDeg(options.speedKmh / 3.6, sample.signedCurvature),
      headingDeg,
      distanceM,
      lateralOffsetM: lateralOffset,
      timestamp: options.timestamp,
    };
  }

  getTrackLength(): number {
    return this.trackPath?.totalLength ?? 0;
  }

  startPlayback(riderId: string, trace: RiderUpdate[]): void {
    this.ensureRider(riderId);
    this.demo?.stop();
    this.riders.get(riderId)!.startPlayback(trace);
  }

  pausePlayback(riderId?: string): void {
    const id = riderId ?? this.primaryRiderId;
    this.riders.get(id)?.pausePlayback();
  }

  resumePlayback(riderId?: string): void {
    const id = riderId ?? this.primaryRiderId;
    this.riders.get(id)?.resumePlayback();
  }

  stopPlayback(riderId?: string): void {
    if (riderId) {
      this.riders.get(riderId)?.stopPlayback();
      return;
    }
    for (const rider of this.riders.values()) {
      rider.stopPlayback();
    }
  }

  startDemoSimulator(options: DemoSimulatorOptions = {}): void {
    const count = options.riderCount ?? 4;
    const spacingM = options.spacingM ?? 8;
    const speedKmh = options.speedKmh ?? 180;

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `rider-${i + 1}`;
      ids.push(id);
      if (!this.riders.has(id)) {
        this.registerRider({
          id,
          label: `Pilote ${i + 1}`,
          country: 'FR',
          color: DEMO_RIDER_COLORS[i % DEMO_RIDER_COLORS.length],
        });
      }
    }

    for (const rider of this.riders.values()) {
      rider.stopPlayback();
    }

    this.demo?.stop();
    this.demo?.start({ riderIds: ids, spacingM, speedKmh });

    for (const rider of this.riders.values()) {
      rider.visual.setVisible(true);
    }
  }

  stopDemoSimulator(): void {
    this.demo?.stop();
    for (const rider of this.riders.values()) {
      rider.hide();
    }
  }

  getRiderFrame(riderId: string): ReturnType<Rider['getLastFrame']> {
    return this.riders.get(riderId)?.getLastFrame() ?? null;
  }

  getRider(riderId: string): Rider | undefined {
    return this.riders.get(riderId);
  }

  getRiderTelemetry(riderId?: string): RiderTelemetry | null {
    const id = riderId ?? this.primaryRiderId;
    const rider = this.riders.get(id);
    if (!rider) return null;

    const state = rider.getPlaybackState();
    const frame = rider.getLastFrame();
    return {
      riderId: id,
      label: rider.label,
      country: rider.country,
      speedKmh: frame?.speedKmh ?? state.speedKmh,
      leanDeg: frame?.leanDeg ?? state.leanDeg,
      position: state.position,
      playbackMode: state.mode,
    };
  }

  getAllRiderTelemetry(): RiderTelemetry[] {
    return [...this.riders.keys()]
      .map((id) => this.getRiderTelemetry(id))
      .filter((t): t is RiderTelemetry => t !== null);
  }

  getPlaybackState(riderId?: string): PlaybackState {
    const id = riderId ?? this.primaryRiderId;
    return (
      this.riders.get(id)?.getPlaybackState() ?? {
        mode: 'idle',
        paused: false,
        speedKmh: 0,
        leanDeg: 0,
        position: { x: 0, y: 0, z: 0 },
        traceProgress: 0,
      }
    );
  }

  getCenter(): LocalPoint {
    return { ...this.center };
  }

  getGeoOrigin() {
    const track = this.scene.getObjectByName('prenois-track');
    return (
      track?.userData.geoOrigin ?? {
        lon: 0,
        lat: 0,
        elevation: 0,
      }
    );
  }

  async resumeAudio(): Promise<void> {
    await this.engineSound?.resumeContext();
  }

  refreshFirstPersonModes(): void {
    const fpRiders = new Set<string>();
    for (const viewport of this.viewports) {
      if (viewport.isFirstPersonActive()) {
        fpRiders.add(viewport.getFollowRider());
      }
    }
    for (const rider of this.riders.values()) {
      rider.setFirstPersonMode(fpRiders.has(rider.id));
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    for (const vp of [...this.viewports]) {
      vp.dispose();
    }
    this.viewports.clear();
    for (const rider of this.riders.values()) {
      rider.dispose();
    }
    this.riders.clear();
    this.engineSound?.dispose();
  }

  private ensureRider(riderId: string): void {
    if (!this.riders.has(riderId)) {
      this.registerRider({ id: riderId, label: riderId });
    }
  }

  private startLoop(): void {
    const tick = (): void => {
      this.animationId = requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.update(dt);

      for (const viewport of this.viewports) {
        viewport.render(dt);
      }
    };
    tick();
  }

  private update(dt: number): void {
    const now = performance.now();
    this.beforeUpdate?.(now, dt);

    const demoStates = this.demo?.isActive() ? this.demo.tickFrame(dt) : null;

    if (demoStates) {
      for (const [id, state] of demoStates) {
        this.riders.get(id)?.updateFromDemo(state, dt);
      }
    } else {
      for (const rider of this.riders.values()) {
        rider.update(dt);
      }
    }

    const leader = this.riders.get(this.primaryRiderId);
    const leaderFrame = leader?.getLastFrame();
    if (leaderFrame && leader) {
      this.engineSound?.setSpeed(leaderFrame.speedKmh);
      if (this.audioCamera) {
        this.audioCamera.position.copy(leaderFrame.bikePosition);
      }
    }
  }
}

export function applyElevationFromGps(
  borders: TrackBorders,
  gpsTrace: GeoPoint[],
): TrackBorders {
  const enriched = (border: GeoPoint[]) =>
    border.map((p) => ({
      ...p,
      elevation: nearestElevation(p, gpsTrace),
    }));

  return {
    inner: enriched(borders.inner),
    outer: enriched(borders.outer),
  };
}

function nearestElevation(point: GeoPoint, trace: GeoPoint[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (const t of trace) {
    const d = (t.lon - point.lon) ** 2 + (t.lat - point.lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = t.elevation;
    }
  }
  return best;
}
