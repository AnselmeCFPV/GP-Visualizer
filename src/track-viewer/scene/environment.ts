import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { LocalPoint } from '../types';

export interface SceneEnvironment {
  sky: Sky;
  sunLight: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  fillLight: THREE.AmbientLight;
  sunDirection: THREE.Vector3;
}

const SUN_ELEVATION_DEG = 42;
const SUN_AZIMUTH_DEG = 168;
const SHADOW_TREE_MARGIN = 90;
const SHADOW_MAP_SIZE = 4096;

export interface ShadowVolume {
  center: LocalPoint;
  extent: number;
}

function sunDirectionFromAngles(elevationDeg: number, azimuthDeg: number, target: THREE.Vector3): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  return target.setFromSphericalCoords(1, phi, theta);
}

export function computeShadowVolume(outer: LocalPoint[]): ShadowVolume {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumY = 0;

  for (const p of outer) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    sumY += p.y;
  }

  const halfX = (maxX - minX) * 0.5;
  const halfZ = (maxZ - minZ) * 0.5;

  return {
    center: {
      x: (minX + maxX) * 0.5,
      y: sumY / outer.length,
      z: (minZ + maxZ) * 0.5,
    },
    extent: Math.max(halfX, halfZ) + SHADOW_TREE_MARGIN,
  };
}

function applyShadowFrustum(light: THREE.DirectionalLight, extent: number): void {
  const cam = light.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = 2;
  cam.far = Math.max(450, extent * 2.2);
  cam.updateProjectionMatrix();
}

export function createSceneEnvironment(scene: THREE.Scene): SceneEnvironment {
  scene.background = null;

  const sky = new Sky();
  sky.scale.setScalar(450_000);
  sky.name = 'sky';
  scene.add(sky);

  const sunDirection = sunDirectionFromAngles(SUN_ELEVATION_DEG, SUN_AZIMUTH_DEG, new THREE.Vector3());

  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 5;
  skyUniforms.rayleigh.value = 1;
  skyUniforms.mieCoefficient.value = 0.002;
  skyUniforms.mieDirectionalG.value = 0.6;
  skyUniforms.sunPosition.value.copy(sunDirection);

  const fillLight = new THREE.AmbientLight(0xe8eef5, 0.32);
  scene.add(fillLight);

  const hemisphere = new THREE.HemisphereLight(0xe0eeff, 0x6a9a55, 0.38);
  scene.add(hemisphere);

  const sunLight = new THREE.DirectionalLight(0xfff8ef, 1.2);
  sunLight.position.copy(sunDirection).multiplyScalar(400);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  applyShadowFrustum(sunLight, 320);
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.006;
  scene.add(sunLight);
  scene.add(sunLight.target);

  scene.fog = new THREE.Fog(0xd8e6f2, 400, 1400);

  return { sky, sunLight, hemisphere, fillLight, sunDirection };
}

export function configureRendererShadows(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/** Carte d'ombre fixe couvrant tout le circuit + arbres */
export function updateSunShadowTarget(env: SceneEnvironment, volume: ShadowVolume): void {
  env.sunLight.target.position.set(volume.center.x, volume.center.y, volume.center.z);
  env.sunLight.target.updateMatrixWorld();
  applyShadowFrustum(env.sunLight, volume.extent);
}

export function fogForCameraMode(scene: THREE.Scene, mode: 'orbit' | 'rider'): void {
  if (mode === 'rider') {
    scene.fog = new THREE.Fog(0xd8e6f2, 150, 650);
  } else {
    scene.fog = new THREE.Fog(0xd8e6f2, 400, 1400);
  }
}
