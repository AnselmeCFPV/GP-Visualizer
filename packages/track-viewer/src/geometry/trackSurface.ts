import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { offsetClosedCurve } from '../utils/spline';
import { buildStripGeometry } from './strip';

export interface TrackGeometry {
  asphaltOuter: LocalPoint[];
  asphaltInner: LocalPoint[];
  kerbOuterEdge: LocalPoint[];
  kerbInnerEdge: LocalPoint[];
}

export function buildTrackGeometry(
  outerBorder: LocalPoint[],
  trackWidth: number,
  kerbWidth: number,
): TrackGeometry {
  const asphaltOuter = outerBorder;
  const asphaltInner = offsetClosedCurve(outerBorder, trackWidth, true);
  const kerbOuterEdge = offsetClosedCurve(outerBorder, kerbWidth, false);
  const kerbInnerEdge = offsetClosedCurve(asphaltInner, kerbWidth, true);

  return { asphaltOuter, asphaltInner, kerbOuterEdge, kerbInnerEdge };
}

export function createAsphaltMesh(track: TrackGeometry, asphaltMap: THREE.Texture): THREE.Mesh {
  const geometry = buildStripGeometry(
    track.asphaltInner,
    track.asphaltOuter,
    (_arc, total, w) => [w, total > 0 ? _arc / total : 0],
  );
  const material = new THREE.MeshStandardMaterial({
    map: asphaltMap,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'asphalt';
  return mesh;
}

export function createKerbMeshes(track: TrackGeometry, kerbWidth: number): THREE.Mesh[] {
  // Texture 2×1 : une bande = 0,5 UV → carré si arc / (2×kerbWidth)
  const kerbUv = (arc: number, _t: number, w: number): [number, number] => [
    arc / (kerbWidth * 2),
    w,
  ];

  const outerKerbGeom = buildStripGeometry(
    track.asphaltOuter,
    track.kerbOuterEdge,
    kerbUv,
  );
  const innerKerbGeom = buildStripGeometry(
    track.kerbInnerEdge,
    track.asphaltInner,
    kerbUv,
  );

  const kerbMaterial = new THREE.MeshStandardMaterial({
    map: createCheckerTexture(),
    roughness: 0.55,
    metalness: 0,
  });

  const outerKerb = new THREE.Mesh(outerKerbGeom, kerbMaterial);
  outerKerb.castShadow = true;
  outerKerb.receiveShadow = true;
  outerKerb.name = 'kerb-outer';

  const innerKerb = new THREE.Mesh(innerKerbGeom, kerbMaterial.clone());
  innerKerb.castShadow = true;
  innerKerb.receiveShadow = true;
  innerKerb.name = 'kerb-inner';

  return [outerKerb, innerKerb];
}

export interface TrackExclusion {
  kerbOuter: LocalPoint[];
  kerbInner: LocalPoint[];
  margin: number;
}

export function buildTrackExclusion(track: TrackGeometry, margin = 2): TrackExclusion {
  return {
    kerbOuter: offsetClosedCurve(track.kerbOuterEdge, margin, false),
    kerbInner: offsetClosedCurve(track.kerbInnerEdge, margin, true),
    margin,
  };
}

/** Bandes rouge/blanc le long du tracé (1 couleur sur toute la largeur du damier) */
function createCheckerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#e02020';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(1, 0, 1, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
