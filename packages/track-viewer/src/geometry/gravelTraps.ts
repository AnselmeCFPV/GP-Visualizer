import * as THREE from 'three';
import type { LocalPoint } from '../types';
import type { TrackGeometry } from './trackSurface';
import { offsetClosedCurve } from '../utils/spline';
import { createGravelTexture } from '../utils/textures';
import { buildStripGeometry } from './strip';

const RUNOFF_OUTER = 30;
const RUNOFF_INNER = 18;

export interface RunoffZones {
  group: THREE.Group;
  outerFar: LocalPoint[];
  innerFar: LocalPoint[];
}

/** Ruban parallèle propre : offset uniforme, points indexés 1:1 */
function buildCleanStrip(
  edge: LocalPoint[],
  width: number,
  outward: boolean,
): { near: LocalPoint[]; far: LocalPoint[]; geometry: THREE.BufferGeometry } {
  const far = offsetClosedCurve(edge, width, !outward);

  const geometry = buildStripGeometry(
    outward ? edge : far,
    outward ? far : edge,
    (arc, _t, w) => [arc / 6, w],
  );

  return { near: edge, far, geometry };
}

function gravelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: createGravelTexture(),
    roughness: 0.96,
    metalness: 0,
  });
}

export function createRunoffGravel(track: TrackGeometry): RunoffZones {
  const group = new THREE.Group();
  group.name = 'runoff-gravel';

  const outer = buildCleanStrip(track.kerbOuterEdge, RUNOFF_OUTER, true);
  const inner = buildCleanStrip(track.kerbInnerEdge, RUNOFF_INNER, false);

  const outerMesh = new THREE.Mesh(outer.geometry, gravelMaterial());
  outerMesh.receiveShadow = true;
  outerMesh.name = 'runoff-outer';

  const innerMesh = new THREE.Mesh(inner.geometry, gravelMaterial());
  innerMesh.receiveShadow = true;
  innerMesh.name = 'runoff-inner';

  group.add(outerMesh, innerMesh);

  return {
    group,
    outerFar: outer.far,
    innerFar: inner.far,
  };
}
