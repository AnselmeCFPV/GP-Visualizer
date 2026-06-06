import * as THREE from 'three';
import type { RiderFrame } from './RiderPose';
import type { BikeWheelOffsets } from './bikeGrounding';

const _rearWheelWorld = new THREE.Vector3();
const _rearLocal = new THREE.Vector3();

export class RiderVisual {
  readonly group = new THREE.Group();
  private rig: THREE.Group | null = null;
  private wheelOffsets: BikeWheelOffsets | null = null;
  private bodyMeshes: THREE.Object3D[] = [];

  setModel(rig: THREE.Group, wheelOffsets?: BikeWheelOffsets): void {
    if (this.rig) {
      this.group.remove(this.rig);
    }
    this.rig = rig;
    this.group.add(rig);
    if (wheelOffsets) {
      this.wheelOffsets = wheelOffsets;
    }
    this.collectBodyMeshes(rig);
  }

  private collectBodyMeshes(rig: THREE.Group): void {
    this.bodyMeshes = [];
    rig.traverse((child) => {
      const name = child.name.toLowerCase();
      if (name.includes('biker') || name.includes('rider') || name.includes('pilot')) {
        this.bodyMeshes.push(child);
      }
    });
  }

  getWheelOffsets(): BikeWheelOffsets | null {
    return this.wheelOffsets;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setFirstPersonMode(enabled: boolean): void {
    for (const mesh of this.bodyMeshes) {
      mesh.visible = !enabled;
    }
  }

  apply(frame: RiderFrame): void {
    this.group.position.copy(frame.bikePosition);
    this.group.quaternion.copy(frame.bikeQuaternion);
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
