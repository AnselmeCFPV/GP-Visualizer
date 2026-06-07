import * as THREE from 'three';
import type { RiderFrame } from './RiderPose';
import type { BikeWheelOffsets } from './bikeGrounding';

const _rearWheelWorld = new THREE.Vector3();
const _rearLocal = new THREE.Vector3();
const _splitVertex = new THREE.Vector3();
const _splitInverse = new THREE.Matrix4();
const _rigLocalBox = new THREE.Box3();

interface SplitBikerMeshes {
  body: THREE.Mesh;
  hands: THREE.Mesh;
}

import type { WheelSpinMetadata } from './loadBikeModel';

interface WheelSpin {
  pivot: THREE.Group;
  axis: 'x' | 'y' | 'z';
  radiusM: number;
  angle: number;
}

const WHEEL_SPIN_SIGN = -1;

function setWheelSpinAngle(wheel: WheelSpin): void {
  wheel.pivot.rotation[wheel.axis] = wheel.angle;
}

function isBikerMesh(mesh: THREE.Mesh): boolean {
  const name = mesh.name.toLowerCase();
  return name.includes('biker') || name.includes('rider') || name.includes('pilot');
}

function readPosition(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
): { x: number; y: number; z: number } {
  return {
    x: position.getX(index),
    y: position.getY(index),
    z: position.getZ(index),
  };
}

function triangleStats(
  mesh: THREE.Mesh,
  rig: THREE.Group,
  i0: number,
  i1: number,
  i2: number,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): { avgY: number; avgZ: number; minY: number; maxY: number } {
  rig.updateMatrixWorld(true);
  _splitInverse.copy(rig.matrixWorld).invert();

  let sumY = 0;
  let sumZ = 0;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const idx of [i0, i1, i2]) {
    const p = readPosition(position, idx);
    _splitVertex
      .set(p.x, p.y, p.z)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(_splitInverse);
    sumY += _splitVertex.y;
    sumZ += _splitVertex.z;
    minY = Math.min(minY, _splitVertex.y);
    maxY = Math.max(maxY, _splitVertex.y);
  }

  return { avgY: sumY / 3, avgZ: sumZ / 3, minY, maxY };
}

function isHandTriangle(
  avgY: number,
  avgZ: number,
  minY: number,
  maxY: number,
  box: THREE.Box3,
): boolean {
  const height = Math.max(box.max.y - box.min.y, 1e-4);
  const depth = Math.max(box.max.z - box.min.z, 1e-4);

  const yLow = box.min.y + height * 0.48;
  const yHigh = box.min.y + height * 0.6;
  const zForward = box.min.z + depth * 0.55;

  if (minY > yHigh || maxY > yHigh) return false;
  return avgY >= yLow && avgY <= yHigh && avgZ <= zForward;
}

function computeRigLocalBBox(mesh: THREE.Mesh, rig: THREE.Group): THREE.Box3 {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  _rigLocalBox.makeEmpty();
  if (!position) return _rigLocalBox;

  rig.updateMatrixWorld(true);
  _splitInverse.copy(rig.matrixWorld).invert();

  for (let i = 0; i < position.count; i += 1) {
    const p = readPosition(position, i);
    _splitVertex
      .set(p.x, p.y, p.z)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(_splitInverse);
    _rigLocalBox.expandByPoint(_splitVertex);
  }

  return _rigLocalBox.clone();
}

function splitBikerMeshForFirstPerson(
  mesh: THREE.Mesh,
  rig: THREE.Group,
): SplitBikerMeshes | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return null;

  const bounds = computeRigLocalBBox(mesh, rig);
  const index = geometry.getIndex();
  const uv = geometry.getAttribute('uv');
  const triangleCount = index ? index.count / 3 : position.count / 3;

  const bodyPositions: number[] = [];
  const handsPositions: number[] = [];
  const bodyUvs: number[] = [];
  const handsUvs: number[] = [];
  const bodyIndices: number[] = [];
  const handsIndices: number[] = [];

  const pushTriangle = (
    i0: number,
    i1: number,
    i2: number,
    targetPositions: number[],
    targetUvs: number[],
    targetIndices: number[],
  ): void => {
    const base = targetPositions.length / 3;
    for (const idx of [i0, i1, i2]) {
      targetPositions.push(position.getX(idx), position.getY(idx), position.getZ(idx));
      if (uv) {
        targetUvs.push(uv.getX(idx), uv.getY(idx));
      }
    }
    targetIndices.push(base, base + 1, base + 2);
  };

  for (let tri = 0; tri < triangleCount; tri += 1) {
    const i0 = index ? index.getX(tri * 3) : tri * 3;
    const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    const stats = triangleStats(mesh, rig, i0, i1, i2, position);

    if (isHandTriangle(stats.avgY, stats.avgZ, stats.minY, stats.maxY, bounds)) {
      pushTriangle(i0, i1, i2, handsPositions, handsUvs, handsIndices);
    } else {
      pushTriangle(i0, i1, i2, bodyPositions, bodyUvs, bodyIndices);
    }
  }

  if (handsPositions.length === 0 || bodyPositions.length === 0) {
    return null;
  }

  const makePart = (
    name: string,
    positions: number[],
    uvs: number[],
    indices: number[],
  ): THREE.Mesh => {
    const partGeometry = new THREE.BufferGeometry();
    partGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    if (uv && uvs.length > 0) {
      partGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }
    partGeometry.setIndex(indices);
    partGeometry.computeVertexNormals();

    const part = new THREE.Mesh(partGeometry, mesh.material);
    part.name = name;
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.position.copy(mesh.position);
    part.quaternion.copy(mesh.quaternion);
    part.scale.copy(mesh.scale);
    return part;
  };

  return {
    body: makePart(`${mesh.name}_body`, bodyPositions, bodyUvs, bodyIndices),
    hands: makePart(`${mesh.name}_hands`, handsPositions, handsUvs, handsIndices),
  };
}

export class RiderVisual {
  readonly group = new THREE.Group();
  private rig: THREE.Group | null = null;
  private wheelOffsets: BikeWheelOffsets | null = null;
  private fpBodyParts: THREE.Object3D[] = [];
  private firstPersonMode = false;
  private wheels: WheelSpin[] = [];

  setModel(rig: THREE.Group, wheelOffsets?: BikeWheelOffsets): void {
    if (this.rig) {
      this.group.remove(this.rig);
    }
    this.rig = rig;
    this.group.add(rig);
    if (wheelOffsets) {
      this.wheelOffsets = wheelOffsets;
    }
    this.setupWheels(rig);
    this.setupFirstPersonMeshes(rig);
    this.applyFirstPersonVisibility();
  }

  private setupWheels(rig: THREE.Group): void {
    this.wheels = [];

    rig.traverse((child) => {
      if (!(child instanceof THREE.Group) || !child.name.endsWith('_spin')) return;
      const meta = child.userData.wheelSpin as WheelSpinMetadata | undefined;
      if (!meta) return;

      this.wheels.push({
        pivot: child,
        axis: meta.axis,
        radiusM: meta.radiusM,
        angle: 0,
      });
    });
  }

  private setupFirstPersonMeshes(rig: THREE.Group): void {
    this.fpBodyParts = [];
    const toReplace: THREE.Mesh[] = [];

    rig.traverse((child) => {
      if (child instanceof THREE.Mesh && isBikerMesh(child)) {
        toReplace.push(child);
      }
    });

    for (const mesh of toReplace) {
      const split = splitBikerMeshForFirstPerson(mesh, rig);
      const parent = mesh.parent;
      if (!split || !parent) {
        this.fpBodyParts.push(mesh);
        continue;
      }

      parent.add(split.body);
      parent.add(split.hands);
      parent.remove(mesh);
      mesh.geometry.dispose();
      this.fpBodyParts.push(split.body);
    }
  }

  getWheelOffsets(): BikeWheelOffsets | null {
    return this.wheelOffsets;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setFirstPersonMode(enabled: boolean): void {
    this.firstPersonMode = enabled;
    this.applyFirstPersonVisibility();
  }

  private applyFirstPersonVisibility(): void {
    for (const part of this.fpBodyParts) {
      part.visible = !this.firstPersonMode;
    }
  }

  apply(frame: RiderFrame, dt = 0): void {
    this.group.position.copy(frame.bikePosition);
    this.group.quaternion.copy(frame.bikeQuaternion);
    this.spinWheels(frame.speedKmh, dt);
  }

  private spinWheels(speedKmh: number, dt: number): void {
    if (dt <= 0 || this.wheels.length === 0) return;

    const speedMs = Math.max(speedKmh, 0) / 3.6;
    const twoPi = Math.PI * 2;

    for (const wheel of this.wheels) {
      const deltaAngle = ((speedMs * dt) / wheel.radiusM) * WHEEL_SPIN_SIGN;
      wheel.angle = (wheel.angle + deltaAngle) % twoPi;
      setWheelSpinAngle(wheel);
    }
  }

  /** Contact arrière sur l'asphalte (XZ de la roue, Y = sol du pivot moto) */
  getRearWheelTrailPosition(frame: RiderFrame): THREE.Vector3 {
    const rear = this.wheelOffsets?.rear;
    if (!rear) {
      return _rearWheelWorld.set(
        frame.bikePosition.x,
        frame.bikePosition.y,
        frame.bikePosition.z,
      );
    }
    _rearLocal.set(rear.x, 0, rear.z);
    return _rearWheelWorld
      .copy(_rearLocal)
      .applyQuaternion(frame.bikeQuaternion)
      .add(frame.bikePosition)
      .setY(frame.bikePosition.y);
  }
}
