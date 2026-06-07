import * as THREE from 'three';

const DEFAULT_ENGINE_URL = '/sounds/engine.mp3';
const MIN_PITCH = 0.55;
const MAX_PITCH = 1.85;
const REF_SPEED_KMH = 280;

export class EngineSound {
  private readonly listener: THREE.AudioListener;
  private readonly positional: THREE.PositionalAudio;
  private loaded = false;
  private started = false;
  private contextResumed = false;

  constructor(camera: THREE.Camera, attachTo: THREE.Object3D) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.positional = new THREE.PositionalAudio(this.listener);
    this.positional.setRefDistance(4);
    this.positional.setRolloffFactor(1.2);
    this.positional.setDistanceModel('inverse');
    this.positional.setVolume(0.85);
    attachTo.add(this.positional);
  }

  async load(url = DEFAULT_ENGINE_URL): Promise<void> {
    const audioLoader = new THREE.AudioLoader();
    const buffer = await audioLoader.loadAsync(url);
    this.positional.setBuffer(buffer);
    this.positional.setLoop(true);
    this.loaded = true;
  }

  /** Requis après un geste utilisateur (politique autoplay navigateur) */
  async resumeContext(): Promise<void> {
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.contextResumed = true;
    if (this.loaded && !this.started) {
      this.positional.play();
      this.started = true;
    }
  }

  setSpeed(speedKmh: number): void {
    if (!this.loaded) return;
    const t = THREE.MathUtils.clamp(speedKmh / REF_SPEED_KMH, 0, 1);
    const rate = THREE.MathUtils.lerp(MIN_PITCH, MAX_PITCH, t);
    if (this.positional.source) {
      this.positional.setPlaybackRate(rate);
    }
  }

  setMuted(muted: boolean): void {
    this.positional.setVolume(muted ? 0 : 0.85);
  }

  dispose(): void {
    if (this.positional.isPlaying) {
      this.positional.stop();
    }
    this.positional.disconnect();
    this.listener.parent?.remove(this.listener);
  }

  isContextResumed(): boolean {
    return this.contextResumed;
  }
}
