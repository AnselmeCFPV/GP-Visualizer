import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  CameraMode,
  CameraViewDefinition,
  TrackViewportHandle,
  TrackViewportOptions,
} from './types';
import { CameraController } from './rider/CameraController';
import { CameraViewRegistry } from './rider/CameraViewRegistry';
import { SpeedMotionBlur } from './rider/SpeedMotionBlur';
import { fogForCameraMode } from './scene/environment';
import { configureRendererShadows } from './scene/environment';
import type { TrackWorld } from './TrackWorld';
import { DEFAULT_RIDER_ID } from './TrackWorld';

export class TrackViewport implements TrackViewportHandle {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly cameraController: CameraController;
  private readonly cameraViews = new CameraViewRegistry();
  private readonly motionBlur: SpeedMotionBlur;
  private readonly resizeObserver: ResizeObserver;

  private cameraMode: CameraMode = 'free';
  private activeCameraViewId = 'free';
  private followRiderId: string;

  constructor(
    private readonly world: TrackWorld,
    private readonly container: HTMLElement,
    options: Omit<TrackViewportOptions, 'world' | 'container'> = {},
  ) {
    this.followRiderId = options.followRiderId ?? DEFAULT_RIDER_ID;

    const aspect = container.clientWidth / container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 3000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    configureRendererShadows(this.renderer);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 800;

    const center = world.getCenter();
    const centerVec = new THREE.Vector3(center.x, center.y, center.z);
    this.cameraController = new CameraController(
      this.camera,
      this.controls,
      centerVec,
      this.renderer.domElement,
    );

    this.motionBlur = new SpeedMotionBlur(this.renderer, world.scene, this.camera);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    world.attachViewport(this);

    const initialView = options.cameraViewId ?? 'free';
    this.setCameraView(initialView);
  }

  static create(options: TrackViewportOptions): TrackViewport {
    const { world, container, ...rest } = options;
    return new TrackViewport(world, container, rest);
  }

  render(dt: number): void {
    const frame = this.world.getRiderFrame(this.followRiderId);
    this.cameraController.apply(frame, dt);

    const blurState = this.cameraController.getMotionBlurState();
    if (this.motionBlur.needsComposer(blurState)) {
      this.motionBlur.render(blurState);
    } else {
      this.renderer.render(this.world.scene, this.camera);
    }
  }

  setFollowRider(riderId: string): void {
    if (!this.world.getRider(riderId)) {
      throw new Error(`[track-viewer] Pilote inconnu : "${riderId}"`);
    }
    this.followRiderId = riderId;
  }

  getFollowRider(): string {
    return this.followRiderId;
  }

  setCameraMode(mode: CameraMode): void {
    this.setCameraView(mode);
  }

  cycleCameraMode(): CameraMode {
    const order: CameraMode[] = ['free', 'orbit', 'follow', 'firstPerson'];
    const idx = (order.indexOf(this.cameraMode) + 1) % order.length;
    const next = order[idx]!;
    this.setCameraView(next);
    return next;
  }

  getCameraMode(): CameraMode {
    const def = this.cameraViews.get(this.activeCameraViewId);
    if (def?.spec.type === 'builtin') {
      return def.spec.mode;
    }
    return this.cameraMode;
  }

  listCameraViews(): CameraViewDefinition[] {
    return this.cameraViews.list();
  }

  setCameraView(viewId: string): void {
    const def = this.cameraViews.get(viewId);
    if (!def) {
      throw new Error(`[track-viewer] Vue caméra inconnue : "${viewId}"`);
    }

    const frame = this.world.getRiderFrame(this.followRiderId);
    this.activeCameraViewId = viewId;
    this.cameraController.setCameraView(def, frame);

    if (def.spec.type === 'builtin') {
      this.cameraMode = def.spec.mode;
      const isFp = def.spec.mode === 'firstPerson';
      this.world.setRiderFirstPerson(this.followRiderId, isFp);
      fogForCameraMode(
        this.world.scene,
        def.spec.mode !== 'free' ? 'rider' : 'orbit',
      );
      if (def.spec.mode === 'free') {
        this.resetCamera();
      }
    } else {
      this.cameraMode = 'orbit';
      this.world.setRiderFirstPerson(this.followRiderId, false);
      fogForCameraMode(this.world.scene, 'rider');
    }
  }

  getActiveCameraView(): string {
    return this.activeCameraViewId;
  }

  registerCameraView(definition: CameraViewDefinition): void {
    this.cameraViews.register(definition);
  }

  unregisterCameraView(viewId: string): void {
    this.cameraViews.unregister(viewId);
    if (this.activeCameraViewId === viewId) {
      this.setCameraView('free');
    }
  }

  resetCamera(): void {
    this.cameraController.resetFree();
  }

  dispose(): void {
    this.world.detachViewport(this);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.motionBlur.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.motionBlur.setSize(w, h);
  }
}
