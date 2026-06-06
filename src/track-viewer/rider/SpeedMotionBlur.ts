import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const MOTION_BLUR_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    intensity: { value: 0 },
    focus: { value: new THREE.Vector2(0.5, 0.48) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float intensity;
    uniform vec2 focus;
    varying vec2 vUv;

    void main() {
      vec4 sharp = texture2D(tDiffuse, vUv);
      if (intensity < 0.001) {
        gl_FragColor = sharp;
        return;
      }

      vec2 dir = vUv - focus;
      float dist = length(dir);
      float edgeMask = smoothstep(0.1, 0.58, dist);
      if (edgeMask < 0.001) {
        gl_FragColor = sharp;
        return;
      }

      vec2 axis = dist > 0.0001 ? dir / dist : vec2(0.0, 1.0);
      float spread = intensity * edgeMask * (0.05 + dist * 0.5);

      vec4 blurred = vec4(0.0);
      const int SAMPLES = 14;
      for (int i = 0; i < SAMPLES; i++) {
        float t = (float(i) / float(SAMPLES - 1) - 0.5) * 2.0;
        vec2 uv = vUv - axis * t * spread;
        blurred += texture2D(tDiffuse, uv);
      }
      blurred /= float(SAMPLES);
      gl_FragColor = mix(sharp, blurred, edgeMask);
    }
  `,
};

export interface MotionBlurState {
  active: boolean;
  speedKmh: number;
}

export class SpeedMotionBlur {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly blurPass: ShaderPass;
  private readonly outputPass: OutputPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.blurPass = new ShaderPass(MOTION_BLUR_SHADER);
    this.blurPass.renderToScreen = false;
    this.composer.addPass(this.blurPass);

    this.outputPass = new OutputPass();
    this.outputPass.renderToScreen = true;
    this.composer.addPass(this.outputPass);
  }

  needsComposer(state: MotionBlurState): boolean {
    if (!state.active) return false;
    const t = Math.max(0, Math.min(1, (state.speedKmh - 28) / 175));
    return t > 0.01;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  render(state: MotionBlurState): void {
    const t = state.active
      ? Math.max(0, Math.min(1, (state.speedKmh - 28) / 175))
      : 0;
    this.blurPass.uniforms.intensity.value = t * 0.38;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
