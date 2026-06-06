import * as THREE from 'three';

const MAX_POINTS = 140;
const TRAIL_WIDTH = 0.275;
const TRAIL_LIFT_M = 0.095;
const FADE_SECONDS = 5.5;
/** Point le plus récent : 80 % transparent → opacité 20 % */
const BASE_OPACITY = 0.2;

interface TrailPoint {
  x: number;
  y: number;
  z: number;
  age: number;
}

const TRAIL_VERTEX_SHADER = /* glsl */`
  attribute vec3 color;
  varying float vAlpha;
  void main() {
    vAlpha = color.r;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAGMENT_SHADER = /* glsl */`
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha);
  }
`;

export class RiderTrail {
  readonly mesh: THREE.Mesh;
  private readonly points: TrailPoint[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor() {
    const vertexCount = MAX_POINTS * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    const indices: number[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    this.geometry.setIndex(indices);

    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
        vertexShader: TRAIL_VERTEX_SHADER,
        fragmentShader: TRAIL_FRAGMENT_SHADER,
      }),
    );
    this.mesh.name = 'rider-trail';
    this.mesh.renderOrder = 12;
    this.mesh.frustumCulled = false;
  }

  reset(): void {
    this.points.length = 0;
    this.geometry.setDrawRange(0, 0);
  }

  update(position: THREE.Vector3, tangent: THREE.Vector3, dt: number): void {
    for (const p of this.points) {
      p.age += dt;
    }
    while (this.points.length > 0 && this.points[0]!.age > FADE_SECONDS) {
      this.points.shift();
    }

    const last = this.points[this.points.length - 1];
    const minStep = 0.35;
    if (
      !last ||
      Math.hypot(position.x - last.x, position.z - last.z) >= minStep
    ) {
      this.points.push({
        x: position.x,
        y: position.y + TRAIL_LIFT_M,
        z: position.z,
        age: 0,
      });
    }

    while (this.points.length > MAX_POINTS) {
      this.points.shift();
    }

    if (this.points.length < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    const half = TRAIL_WIDTH * 0.5;

    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i]!;
      const fade = 1 - p.age / FADE_SECONDS;
      const alpha = BASE_OPACITY * fade * fade;
      const vi = i * 2;

      this.positions[vi * 3] = p.x - side.x * half;
      this.positions[vi * 3 + 1] = p.y;
      this.positions[vi * 3 + 2] = p.z - side.z * half;
      this.positions[(vi + 1) * 3] = p.x + side.x * half;
      this.positions[(vi + 1) * 3 + 1] = p.y;
      this.positions[(vi + 1) * 3 + 2] = p.z + side.z * half;

      for (let c = 0; c < 2; c++) {
        const ci = (vi + c) * 3;
        this.colors[ci] = alpha;
        this.colors[ci + 1] = alpha;
        this.colors[ci + 2] = alpha;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    const segCount = this.points.length - 1;
    this.geometry.setDrawRange(0, segCount * 6);
  }
}
