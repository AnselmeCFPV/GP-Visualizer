import * as THREE from 'three';
export interface BikeWheelOffsets {
  rear: THREE.Vector3;
  front: THREE.Vector3;
}

const _rearOff = new THREE.Vector3();
const _frontOff = new THREE.Vector3();

/**
 * Ajuste la hauteur du pivot pour que les deux roues reposent sur l'asphalte
 * (échantillon bilinéaire), en tenant compte de l'orientation (inclinaison incluse).
 */
export function solveBikeGroundHeight(
  pivot: THREE.Vector3,
  quaternion: THREE.Quaternion,
  wheelOffsets: BikeWheelOffsets,
  sampleHeight: (x: number, z: number) => number,
): number {
  _rearOff.copy(wheelOffsets.rear).applyQuaternion(quaternion);
  _frontOff.copy(wheelOffsets.front).applyQuaternion(quaternion);

  const rearX = pivot.x + _rearOff.x;
  const rearZ = pivot.z + _rearOff.z;
  const frontX = pivot.x + _frontOff.x;
  const frontZ = pivot.z + _frontOff.z;

  const rearTarget = sampleHeight(rearX, rearZ);
  const frontTarget = sampleHeight(frontX, frontZ);

  const pivotYRear = rearTarget - _rearOff.y;
  const pivotYFront = frontTarget - _frontOff.y;

  return Math.max(pivotYRear, pivotYFront);
}
