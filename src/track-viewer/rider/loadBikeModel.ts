import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import type { RiderColor } from '../types';
import type { BikeWheelOffsets } from './bikeGrounding';

const BIKE_MODEL_DIR = '/3Dmodels/[OBJ] Generic_Bike_v01_w_Biker/';
const BIKE_OBJ = 'Generic_Bike_v01_w_Biker.obj';
const BIKE_MTL = 'Generic_Bike_v01_w_Biker.mtl';
const textureLoader = new THREE.TextureLoader();
const liveryTextureCache = new Map<string, THREE.Texture>();

export const RIDER_LIVERY_COLORS: RiderColor[] = [
  'blue-dark',
  'blue-sky',
  'red',
  'yellow',
  'purple',
  'pink',
  'magenta',
  'green',
  'orange',
  'cyan',
  'black',
  'white',
];

/** Doit correspondre à TrackPath.WHEELBASE_M */
export const WHEELBASE_M = 1.32;

const MODEL_YAW_DEG = 180;
const MODEL_PITCH_BACK_DEG = 2;

export interface BikeRig {
  group: THREE.Group;
  wheelOffsets: BikeWheelOffsets;
}

function tuneMaterials(root: THREE.Object3D, renderer: THREE.WebGLRenderer): void {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      const maps = [mat.map, mat.alphaMap].filter(Boolean) as THREE.Texture[];
      for (const map of maps) {
        map.anisotropy = maxAnisotropy;
        map.colorSpace = THREE.SRGBColorSpace;
      }
      mat.side = THREE.DoubleSide;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.color.multiplyScalar(1.08);
        mat.roughness = Math.min(mat.roughness * 0.72, 0.48);
        mat.metalness = Math.min(mat.metalness, 0.1);
        mat.emissive.set(0.025, 0.025, 0.03);
        mat.emissiveIntensity = 0.35;
      }
    }
  });
}

function wheelContactPoint(box: THREE.Box3, target: THREE.Vector3): THREE.Vector3 {
  return target.set(
    (box.min.x + box.max.x) * 0.5,
    box.min.y,
    (box.min.z + box.max.z) * 0.5,
  );
}

function getWheelContacts(
  obj: THREE.Object3D,
): { rear: THREE.Vector3; front: THREE.Vector3 } | null {
  const rearBox = new THREE.Box3();
  const frontBox = new THREE.Box3();
  let hasRear = false;
  let hasFront = false;

  obj.traverse((child) => {
    if (child.name === 'Wheel_R') {
      rearBox.setFromObject(child);
      hasRear = true;
    }
    if (child.name === 'Wheel_F') {
      frontBox.setFromObject(child);
      hasFront = true;
    }
  });

  if (!hasRear || !hasFront) return null;

  return {
    rear: wheelContactPoint(rearBox, new THREE.Vector3()),
    front: wheelContactPoint(frontBox, new THREE.Vector3()),
  };
}

function measureWheelMinY(root: THREE.Object3D): number {
  let minY = Infinity;
  root.traverse((child) => {
    if (child.name !== 'Wheel_R' && child.name !== 'Wheel_F') return;
    const box = new THREE.Box3().setFromObject(child);
    minY = Math.min(minY, box.min.y);
  });
  return minY;
}

function extractWheelOffsets(rig: THREE.Group): BikeWheelOffsets {
  rig.updateMatrixWorld(true);
  const rearWorld = new THREE.Vector3();
  const frontWorld = new THREE.Vector3();
  let foundRear = false;
  let foundFront = false;

  rig.traverse((child) => {
    if (child.name === 'Wheel_R') {
      wheelContactPoint(new THREE.Box3().setFromObject(child), rearWorld);
      foundRear = true;
    }
    if (child.name === 'Wheel_F') {
      wheelContactPoint(new THREE.Box3().setFromObject(child), frontWorld);
      foundFront = true;
    }
  });

  if (foundRear && foundFront) {
    rig.worldToLocal(rearWorld);
    rig.worldToLocal(frontWorld);
    return { rear: rearWorld, front: frontWorld };
  }

  return {
    rear: new THREE.Vector3(0, 0, -WHEELBASE_M * 0.5),
    front: new THREE.Vector3(0, 0, WHEELBASE_M * 0.5),
  };
}

function buildBikeRig(obj: THREE.Object3D): BikeRig {
  const rig = new THREE.Group();
  rig.name = 'bike-rig';

  const align = new THREE.Group();
  align.name = 'bike-align';
  align.rotation.y = THREE.MathUtils.degToRad(MODEL_YAW_DEG);

  const pitchFix = new THREE.Group();
  pitchFix.name = 'bike-pitch-fix';
  pitchFix.rotation.x = THREE.MathUtils.degToRad(MODEL_PITCH_BACK_DEG);

  const contacts = getWheelContacts(obj);
  let wheelSpan = 0;

  if (contacts) {
    const pivot = contacts.rear.clone().add(contacts.front).multiplyScalar(0.5);
    const rearOff = contacts.rear.clone().sub(pivot);
    const frontOff = contacts.front.clone().sub(pivot);
    wheelSpan = Math.max(
      Math.hypot(frontOff.x - rearOff.x, frontOff.z - rearOff.z),
      0.001,
    );
    obj.position.sub(pivot);
  } else {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center);
    obj.position.y -= box.min.y;
  }

  pitchFix.add(obj);
  align.add(pitchFix);
  rig.add(align);

  rig.updateMatrixWorld(true);

  if (contacts && wheelSpan > 0) {
    rig.scale.setScalar(WHEELBASE_M / wheelSpan);
  } else {
    const box = new THREE.Box3().setFromObject(rig);
    const size = box.getSize(new THREE.Vector3());
    const horizontalLength = Math.max(size.x, size.z, 0.001);
    rig.scale.setScalar(2.15 / horizontalLength);
  }

  rig.updateMatrixWorld(true);

  const wheelMinY = measureWheelMinY(rig);
  if (Number.isFinite(wheelMinY) && Math.abs(wheelMinY) > 1e-4) {
    obj.position.y -= wheelMinY / rig.scale.y;
  }

  rig.updateMatrixWorld(true);
  const wheelOffsets = extractWheelOffsets(rig);

  return { group: rig, wheelOffsets };
}

function loadObjOnly(renderer: THREE.WebGLRenderer, baseUrl: string): Promise<BikeRig> {
  return new Promise((resolve, reject) => {
    const objLoader = new OBJLoader();
    objLoader.setPath(baseUrl);
    objLoader.load(
      BIKE_OBJ,
      (obj) => {
        tuneMaterials(obj, renderer);
        resolve(buildBikeRig(obj));
      },
      undefined,
      reject,
    );
  });
}

function loadVariantTexture(fileName: string, sourceMap?: THREE.Texture | null): THREE.Texture {
  const cached = liveryTextureCache.get(fileName);
  if (cached) return cached;

  const texture = textureLoader.load(`${BIKE_MODEL_DIR}${fileName}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = sourceMap?.flipY ?? true;
  texture.offset.copy(sourceMap?.offset ?? new THREE.Vector2(0, 0));
  texture.repeat.copy(sourceMap?.repeat ?? new THREE.Vector2(1, 1));
  texture.center.copy(sourceMap?.center ?? new THREE.Vector2(0, 0));
  texture.rotation = sourceMap?.rotation ?? 0;
  texture.wrapS = sourceMap?.wrapS ?? THREE.ClampToEdgeWrapping;
  texture.wrapT = sourceMap?.wrapT ?? THREE.ClampToEdgeWrapping;
  liveryTextureCache.set(fileName, texture);
  return texture;
}

function hasColor(mat: THREE.Material): mat is THREE.Material & { color: THREE.Color } {
  return 'color' in mat && mat.color instanceof THREE.Color;
}

function hasMap(mat: THREE.Material): mat is THREE.Material & { map: THREE.Texture | null } {
  return 'map' in mat;
}

function applyNamedLivery(mat: THREE.Material, color: RiderColor): void {
  if (!hasMap(mat)) return;

  if (mat.name === 'Generic_Bike_v01') {
    mat.map = loadVariantTexture(`Generic_Bike_v01_${color}.png`, mat.map);
    if (hasColor(mat)) mat.color.setScalar(1);
    mat.needsUpdate = true;
  }

  if (mat.name === 'Biker') {
    mat.map = loadVariantTexture(`Biker_D_${color}.png`, mat.map);
    if (hasColor(mat)) mat.color.setScalar(1);
    mat.needsUpdate = true;
  }
}

export function cloneBikeRig(template: BikeRig, livery?: RiderColor | number): BikeRig {
  const group = template.group.clone(true);
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    const sourceMats = Array.isArray(child.material) ? child.material : [child.material];
    const clonedMats = sourceMats.map((material) => material.clone());

    for (const mat of clonedMats) {
      if (livery === undefined) continue;

      if (typeof livery === 'number') {
        if (hasColor(mat)) mat.color.lerp(new THREE.Color(livery), 0.35);
      } else {
        applyNamedLivery(mat, livery);
      }
    }

    child.material = Array.isArray(child.material) ? clonedMats : clonedMats[0]!;
  });

  return { group, wheelOffsets: template.wheelOffsets };
}

export function loadBikeModel(renderer: THREE.WebGLRenderer): Promise<BikeRig> {
  const baseUrl = BIKE_MODEL_DIR;

  return new Promise((resolve, reject) => {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(baseUrl);
    mtlLoader.setResourcePath(baseUrl);

    mtlLoader.load(
      BIKE_MTL,
      (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath(baseUrl);
        objLoader.load(
          BIKE_OBJ,
          (obj) => {
            tuneMaterials(obj, renderer);
            resolve(buildBikeRig(obj));
          },
          undefined,
          reject,
        );
      },
      undefined,
      () => {
        loadObjOnly(renderer, baseUrl).then(resolve).catch(reject);
      },
    );
  });
}
