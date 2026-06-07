export interface GeoPoint {
  lon: number;
  lat: number;
  elevation: number;
}

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackBorders {
  inner: GeoPoint[];
  outer: GeoPoint[];
}

/** Options du monde partagé (scène, pilotes, télémétrie) */
export interface TrackWorldOptions {
  kmlUrl?: string;
  fetchElevation?: boolean;
  borders?: TrackBorders;
  smoothSamples?: number;
  trackWidth?: number;
  kerbWidth?: number;
  asphaltTextureUrl?: string;
  grassTextureUrl?: string;
  grassRadius?: number;
  engineSoundUrl?: string;
  backgroundColor?: number;
  /** Intervalle de lissage d'affichage (ms) — défaut 100 */
  riderUpdateIntervalMs?: number;
  /** Démarre le simulateur multi-pilotes au chargement */
  startDemoSimulator?: boolean;
  demoRiderCount?: number;
  demoSpeedKmh?: number;
  /** Écart entre pilotes en démo (m) — défaut 8 */
  demoSpacingM?: number;
}

/** Options d'une fenêtre de rendu (canvas + caméra) */
export interface TrackViewportOptions {
  world: import('./TrackWorld').TrackWorld;
  container: HTMLElement;
  /** Vue caméra initiale — défaut `free` */
  cameraViewId?: string;
  /** Pilote suivi par les vues `rider` / orbit / follow / FP */
  followRiderId?: string;
}

/** @deprecated Utiliser TrackWorldOptions + TrackViewportOptions */
export interface TrackViewerOptions extends TrackWorldOptions {
  container: HTMLElement;
}

export type RiderColor =
  | 'blue-dark'
  | 'blue-sky'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'pink'
  | 'magenta'
  | 'green'
  | 'orange'
  | 'cyan'
  | 'black'
  | 'white';

export interface RiderDefinition {
  id: string;
  label?: string;
  /** Livrée PNG prédéfinie, ou teinte hex de fallback */
  color?: RiderColor | number;
}

export interface DemoSimulatorOptions {
  riderCount?: number;
  speedKmh?: number;
  spacingM?: number;
}

export interface TrackRiderSampleOptions {
  speedKmh: number;
  leanDeg?: number;
  lateralOffsetM?: number;
  timestamp?: number;
}

/** Modes caméra interactifs */
export type CameraMode = 'free' | 'orbit' | 'follow' | 'firstPerson' | 'rear-bike';

export type CameraViewAnchor = 'rider' | 'trackCenter';

export interface CameraOrbitViewSpec {
  type: 'orbit';
  anchor: CameraViewAnchor;
  radius: number;
  azimuthDeg: number;
  elevationDeg: number;
  spinSpeedDegPerSec?: number;
}

export interface CameraFixedViewSpec {
  type: 'fixed';
  position: LocalPoint;
  lookAt: CameraViewAnchor;
}

export interface CameraBuiltinViewSpec {
  type: 'builtin';
  mode: CameraMode;
}

export type CameraViewSpec =
  | CameraOrbitViewSpec
  | CameraFixedViewSpec
  | CameraBuiltinViewSpec;

export interface CameraViewDefinition {
  id: string;
  label: string;
  spec: CameraViewSpec;
}

export type PlaybackMode = 'idle' | 'playback';

export interface RiderTelemetry {
  riderId: string;
  label: string;
  speedKmh: number;
  leanDeg: number;
  position?: LocalPoint;
  playbackMode?: PlaybackMode;
}

export interface RiderUpdate {
  lon: number;
  lat: number;
  elevation?: number;
  speedKmh: number;
  leanDeg: number;
  headingDeg?: number;
  timestamp?: number;
}

/** @deprecated Utiliser RiderUpdate */
export type GpsPlaybackPoint = RiderUpdate;

export interface PlaybackState {
  mode: PlaybackMode;
  paused: boolean;
  speedKmh: number;
  leanDeg: number;
  position: LocalPoint;
  traceProgress: number;
}

/** Monde partagé — scène, pilotes, télémétrie */
export interface TrackWorldHandle {
  dispose(): void;
  getCenter(): LocalPoint;

  registerRider(definition: RiderDefinition): void;
  unregisterRider(riderId: string): void;
  listRiders(): RiderDefinition[];
  setPrimaryRider(riderId: string): void;
  getPrimaryRiderId(): string;

  setRiderUpdateIntervalMs(ms: number): void;
  pushRiderUpdate(riderId: string, update: RiderUpdate): void;
  sampleRiderUpdate(distanceM: number, options: TrackRiderSampleOptions): RiderUpdate;
  getTrackLength(): number;

  startPlayback(riderId: string, trace: RiderUpdate[]): void;
  pausePlayback(riderId?: string): void;
  resumePlayback(riderId?: string): void;
  stopPlayback(riderId?: string): void;

  startDemoSimulator(options?: DemoSimulatorOptions): void;
  stopDemoSimulator(): void;

  getRiderTelemetry(riderId?: string): RiderTelemetry | null;
  getAllRiderTelemetry(): RiderTelemetry[];
  getPlaybackState(riderId?: string): PlaybackState;
  resumeAudio(): Promise<void>;
}

/** Fenêtre de rendu — canvas + caméra indépendante */
export interface TrackViewportHandle {
  dispose(): void;
  resetCamera(): void;
  setFollowRider(riderId: string): void;
  getFollowRider(): string;

  setCameraMode(mode: CameraMode): void;
  cycleCameraMode(): CameraMode;
  getCameraMode(): CameraMode;

  listCameraViews(): CameraViewDefinition[];
  setCameraView(viewId: string): void;
  getActiveCameraView(): string;
  registerCameraView(definition: CameraViewDefinition): void;
  unregisterCameraView(viewId: string): void;
}

/** Raccourci mono-fenêtre — délègue à TrackWorld + TrackViewport */
export interface TrackViewerHandle extends TrackWorldHandle, TrackViewportHandle {}
