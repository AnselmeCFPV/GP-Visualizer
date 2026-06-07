import * as THREE from 'three';
import { MOUSE } from 'three';
import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  CameraMode,
  CameraViewAnchor,
  CameraViewDefinition,
  CameraViewSpec,
  LocalPoint,
} from '../types';
import type { RiderFrame } from './RiderPose';
import type { MotionBlurState } from './SpeedMotionBlur';
import { resolveFixedViewPosition } from './CameraViewRegistry';

const FP_HEAD = new THREE.Vector3(0, 1.18, 0.22);
const REAR_BIKE_MOUNT = new THREE.Vector3(0, 1.05, 1.05);
const FP_PITCH = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  THREE.MathUtils.degToRad(-6),
);

const DEFAULT_ORBIT_RADIUS = 14;
const MIN_ORBIT_RADIUS = 4;
const MAX_ORBIT_RADIUS = 70;
const ORBIT_SENSITIVITY = 0.004;
const MIN_ORBIT_ELEVATION = 0.08;
const MAX_ORBIT_ELEVATION = 1.35;
const ZOOM_SENS = 0.0012;
const SPECTATOR_PAN_SENS = 0.04;
const SPECTATOR_DOLLY_SENS = 0.35;

const DEFAULT_MOUSE_BUTTONS = {
  LEFT: MOUSE.ROTATE,
  MIDDLE: MOUSE.DOLLY,
  RIGHT: MOUSE.PAN,
};

const _offset = new THREE.Vector3();
const _bikeUp = new THREE.Vector3();
const _headWorld = new THREE.Vector3();
const _shakeOffset = new THREE.Vector3();
const _shakeEuler = new THREE.Euler();
const _shakeQuat = new THREE.Quaternion();
const _panRight = new THREE.Vector3();
const _panUp = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _rearTarget = new THREE.Vector3();

export class CameraController {
  private mode: CameraMode = 'free';
  private orbitRadius = DEFAULT_ORBIT_RADIUS;
  private orbitAzimuth = Math.PI * 0.3;
  private orbitElevation = 0.4;
  private pointerDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private fpShakePhase = 0;
  /** Position monde fixe du spectateur (mode follow) — ne suit pas le pilote */
  private readonly spectatorPos = new THREE.Vector3();
  private readonly lastRiderPos = new THREE.Vector3();
  private spectatorDragging = false;
  private spectatorDragButton = -1;
  private motionBlurState: MotionBlurState = { active: false, speedKmh: 0 };
  private customView: CameraViewSpec | null = null;
  private viewAzimuthRad = 0;
  private fixedViewPosition: LocalPoint | null = null;
  private rearBikePosition = new THREE.Vector3();
  private rearBikeTarget = new THREE.Vector3();
  private rearBikeHasPose = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly trackCenter: THREE.Vector3,
    private readonly domElement: HTMLElement,
  ) {
    this.bindPointerHandlers();
  }

  getMode(): CameraMode {
    return this.mode;
  }

  setCameraView(def: CameraViewDefinition, frame: RiderFrame | null = null): void {
    if (def.spec.type === 'builtin') {
      this.customView = null;
      this.fixedViewPosition = null;
      this.setMode(def.spec.mode, frame);
      return;
    }

    this.customView = def.spec;
    this.mode = 'free';
    this.controls.enabled = false;
    this.motionBlurState = { active: false, speedKmh: 0 };

    if (def.spec.type === 'orbit') {
      this.viewAzimuthRad = THREE.MathUtils.degToRad(def.spec.azimuthDeg);
      this.camera.fov = 50;
      this.camera.near = 0.3;
    } else {
      this.fixedViewPosition = resolveFixedViewPosition(
        def.spec.position,
        {
          x: this.trackCenter.x,
          y: this.trackCenter.y,
          z: this.trackCenter.z,
        },
      );
      this.camera.fov = 55;
      this.camera.near = 0.5;
    }
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode, frame: RiderFrame | null = null): void {
    this.customView = null;
    this.fixedViewPosition = null;
    this.mode = mode;
    if (mode === 'rear-bike') {
      this.rearBikeHasPose = false;
    }
    if (mode === 'orbit' && frame) {
      this.initOrbitFromCamera(frame.bikePosition);
    }
    if (mode === 'follow') {
      this.spectatorPos.copy(this.camera.position);
      if (frame) {
        this.lastRiderPos.copy(frame.bikePosition);
      }
    }
    if (mode !== 'firstPerson' && mode !== 'rear-bike') {
      this.motionBlurState = { active: false, speedKmh: 0 };
    }
    this.applyModeSettings();
  }

  cycleMode(frame: RiderFrame | null = null): CameraMode {
    const order: CameraMode[] = ['free', 'orbit', 'follow', 'firstPerson', 'rear-bike'];
    const idx = (order.indexOf(this.mode) + 1) % order.length;
    this.setMode(order[idx]!, frame);
    return this.mode;
  }

  resetFree(): void {
    const c = this.trackCenter;
    this.camera.position.set(c.x + 180, c.y + 120, c.z + 180);
    this.controls.target.set(c.x, c.y + 5, c.z);
    this.lookHorizonAt(this.controls.target);
    this.controls.update();
  }

  getMotionBlurState(): MotionBlurState {
    return this.motionBlurState;
  }

  apply(frame: RiderFrame | null, dt: number): void {
    if (this.customView) {
      this.applyCustomView(frame, dt);
      return;
    }

    if (!frame) {
      if (this.mode === 'free') {
        this.controls.update();
        this.lookHorizonAt(this.controls.target);
      } else if (this.mode === 'follow') {
        this.applySpectatorLook();
      }
      return;
    }

    this.lastRiderPos.copy(frame.bikePosition);

    switch (this.mode) {
      case 'free':
        this.applyFree();
        break;
      case 'orbit':
        this.applyOrbit(frame);
        break;
      case 'follow':
        this.applySpectator(frame);
        break;
      case 'firstPerson':
        this.applyFirstPerson(frame, dt);
        break;
      case 'rear-bike':
        this.applyRearBike(frame, dt);
        break;
    }
  }

  private applyModeSettings(): void {
    this.controls.enabled = this.mode === 'free';
    this.controls.mouseButtons = DEFAULT_MOUSE_BUTTONS;

    switch (this.mode) {
      case 'free':
        this.controls.enableRotate = true;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.enableDamping = true;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 800;
        this.camera.fov = 55;
        this.camera.near = 0.5;
        this.resetFree();
        break;
      case 'orbit':
        this.camera.fov = 50;
        this.camera.near = 0.3;
        break;
      case 'follow':
        this.camera.fov = 55;
        this.camera.near = 0.5;
        break;
      case 'firstPerson':
        this.camera.fov = 82;
        this.camera.near = 0.08;
        break;
      case 'rear-bike':
        this.camera.fov = 72;
        this.camera.near = 0.08;
        break;
    }
    this.camera.updateProjectionMatrix();
  }

  private applyFree(): void {
    this.controls.enabled = true;
    this.controls.update();
    this.lookHorizonAt(this.controls.target);
  }

  private applyOrbit(frame: RiderFrame): void {
    this.controls.enabled = false;
    const rider = frame.bikePosition;

    const cosEl = Math.cos(this.orbitElevation);
    const sinEl = Math.sin(this.orbitElevation);
    _offset.set(
      Math.sin(this.orbitAzimuth) * cosEl * this.orbitRadius,
      sinEl * this.orbitRadius,
      Math.cos(this.orbitAzimuth) * cosEl * this.orbitRadius,
    );

    this.camera.position.copy(rider).add(_offset);
    this.lookHorizonAt(rider);
  }

  /**
   * Spectateur : caméra fixe dans le monde, regard toujours vers le pilote.
   * Pan = déplacer la position, molette = avancer/reculer le long du regard.
   */
  private applySpectator(frame: RiderFrame): void {
    this.controls.enabled = false;
    this.camera.position.copy(this.spectatorPos);
    this.lookHorizonAt(frame.bikePosition);
  }

  private applySpectatorLook(): void {
    this.controls.enabled = false;
    this.camera.position.copy(this.spectatorPos);
    this.lookHorizonAt(this.lastRiderPos);
  }

  private applyFirstPerson(frame: RiderFrame, dt: number): void {
    this.controls.enabled = false;

    const speedT = THREE.MathUtils.clamp(frame.speedKmh / 200, 0, 1);
    const speedCurve = speedT * speedT;

    this.fpShakePhase += dt * speedCurve * (4 + frame.speedKmh * 0.05);

    const ampPos = speedCurve * 0.011;
    const ampRot = speedCurve * 0.007;

    _shakeOffset.set(
      Math.sin(this.fpShakePhase * 2.1) * ampPos,
      Math.sin(this.fpShakePhase * 2.7) * ampPos * 0.7,
      Math.sin(this.fpShakePhase * 1.8) * ampPos * 0.5,
    );
    _shakeEuler.set(
      Math.sin(this.fpShakePhase * 3.2) * ampRot,
      Math.sin(this.fpShakePhase * 2.5) * ampRot * 0.6,
      Math.sin(this.fpShakePhase * 1.6) * ampRot * 0.8,
    );
    _shakeQuat.setFromEuler(_shakeEuler);

    _headWorld.copy(FP_HEAD).applyQuaternion(frame.bikeQuaternion);
    this.camera.position.copy(frame.bikePosition).add(_headWorld).add(_shakeOffset);

    this.camera.quaternion
      .copy(frame.bikeQuaternion)
      .multiply(FP_PITCH)
      .multiply(_shakeQuat);

    _bikeUp.set(0, 1, 0).applyQuaternion(frame.bikeQuaternion);
    this.camera.up.copy(_bikeUp);
    this.camera.updateMatrixWorld();

    this.motionBlurState = { active: true, speedKmh: frame.speedKmh };
  }

  private applyRearBike(frame: RiderFrame, dt: number): void {
    this.controls.enabled = false;

    _headWorld.copy(REAR_BIKE_MOUNT).applyQuaternion(frame.bikeQuaternion);
    _offset.copy(frame.bikePosition).add(_headWorld);

    _rearTarget
      .copy(frame.bikePosition)
      .addScaledVector(frame.tangent, -28)
      .addScaledVector(_bikeUp.set(0, 1, 0).applyQuaternion(frame.bikeQuaternion), 0.75);

    if (!this.rearBikeHasPose) {
      this.rearBikePosition.copy(_offset);
      this.rearBikeTarget.copy(_rearTarget);
      this.rearBikeHasPose = true;
    } else {
      const posAlpha = 1 - Math.exp(-dt * 18);
      const targetAlpha = 1 - Math.exp(-dt * 10);
      this.rearBikePosition.lerp(_offset, posAlpha);
      this.rearBikeTarget.lerp(_rearTarget, targetAlpha);
    }

    this.camera.position.copy(this.rearBikePosition);
    this.camera.up.copy(_bikeUp);
    this.camera.lookAt(this.rearBikeTarget);
    this.camera.updateMatrixWorld();

    this.motionBlurState = { active: false, speedKmh: 0 };
  }

  private lookHorizonAt(target: THREE.Vector3): void {
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target);
  }

  private resolveAnchor(anchor: CameraViewAnchor, frame: RiderFrame | null): THREE.Vector3 {
    if (anchor === 'rider') {
      if (frame) return frame.bikePosition;
      return this.lastRiderPos;
    }
    return this.trackCenter;
  }

  private applyCustomView(frame: RiderFrame | null, dt: number): void {
    const spec = this.customView;
    if (!spec) return;

    this.controls.enabled = false;

    if (spec.type === 'orbit') {
      if (spec.spinSpeedDegPerSec) {
        this.viewAzimuthRad += THREE.MathUtils.degToRad(spec.spinSpeedDegPerSec) * dt;
      }
      const anchor = this.resolveAnchor(spec.anchor, frame);
      const elev = THREE.MathUtils.degToRad(spec.elevationDeg);
      const cosEl = Math.cos(elev);
      const sinEl = Math.sin(elev);
      _offset.set(
        Math.sin(this.viewAzimuthRad) * cosEl * spec.radius,
        sinEl * spec.radius,
        Math.cos(this.viewAzimuthRad) * cosEl * spec.radius,
      );
      this.camera.position.copy(anchor).add(_offset);
      this.lookHorizonAt(anchor);
      return;
    }

    if (spec.type === 'fixed' && this.fixedViewPosition) {
      const pos = this.fixedViewPosition;
      this.camera.position.set(pos.x, pos.y, pos.z);
      this.lookHorizonAt(this.resolveAnchor(spec.lookAt, frame));
    }
  }

  private panSpectator(dx: number, dy: number): void {
    _panRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    _panUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.spectatorPos
      .addScaledVector(_panRight, -dx * SPECTATOR_PAN_SENS)
      .addScaledVector(_panUp, dy * SPECTATOR_PAN_SENS);
  }

  private dollySpectator(deltaY: number): void {
    this.camera.getWorldDirection(_forward);
    this.spectatorPos.addScaledVector(_forward, -deltaY * SPECTATOR_DOLLY_SENS * ZOOM_SENS * 80);
  }

  private initOrbitFromCamera(rider: THREE.Vector3): void {
    _offset.copy(this.camera.position).sub(rider);
    if (_offset.lengthSq() < 1) return;
    this.orbitRadius = THREE.MathUtils.clamp(_offset.length(), MIN_ORBIT_RADIUS, MAX_ORBIT_RADIUS);
    this.orbitElevation = Math.asin(
      THREE.MathUtils.clamp(_offset.y / this.orbitRadius, -1, 1),
    );
    this.orbitAzimuth = Math.atan2(_offset.x, _offset.z);
  }

  private bindPointerHandlers(): void {
    const onDown = (e: PointerEvent): void => {
      if (this.mode === 'orbit' && e.button === 0) {
        this.pointerDragging = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        return;
      }
      if (this.mode === 'follow' && (e.button === 0 || e.button === 2)) {
        e.preventDefault();
        this.spectatorDragging = true;
        this.spectatorDragButton = e.button;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }
    };

    const onMove = (e: PointerEvent): void => {
      if (this.pointerDragging) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;

        this.orbitAzimuth -= dx * ORBIT_SENSITIVITY;
        this.orbitElevation = THREE.MathUtils.clamp(
          this.orbitElevation + dy * ORBIT_SENSITIVITY,
          MIN_ORBIT_ELEVATION,
          MAX_ORBIT_ELEVATION,
        );
        return;
      }

      if (this.spectatorDragging) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.panSpectator(dx, dy);
      }
    };

    const onUp = (e: PointerEvent): void => {
      this.pointerDragging = false;
      if (e.button === this.spectatorDragButton) {
        this.spectatorDragging = false;
        this.spectatorDragButton = -1;
      }
    };

    const onWheel = (e: WheelEvent): void => {
      if (this.mode === 'orbit') {
        e.preventDefault();
        this.orbitRadius = THREE.MathUtils.clamp(
          this.orbitRadius * (1 + e.deltaY * ZOOM_SENS),
          MIN_ORBIT_RADIUS,
          MAX_ORBIT_RADIUS,
        );
        return;
      }
      if (this.mode === 'follow') {
        e.preventDefault();
        this.dollySpectator(e.deltaY);
      }
    };

    this.domElement.addEventListener('pointerdown', onDown);
    this.domElement.addEventListener('pointermove', onMove);
    this.domElement.addEventListener('pointerup', onUp);
    this.domElement.addEventListener('pointerleave', () => {
      this.pointerDragging = false;
      this.spectatorDragging = false;
      this.spectatorDragButton = -1;
    });
    this.domElement.addEventListener('contextmenu', (e) => {
      if (this.mode === 'follow') e.preventDefault();
    });
    this.domElement.addEventListener('wheel', onWheel, { passive: false });
  }

  isFirstPerson(): boolean {
    return !this.customView && this.mode === 'firstPerson';
  }
}
