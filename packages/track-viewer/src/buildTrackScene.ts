import * as THREE from 'three';
import type { LocalPoint, TrackBorders } from './types';
import { geoToLocal } from './utils/geo';
import { smoothClosedBorder, offsetClosedCurve } from './utils/spline';
import {
  buildTrackExclusion,
  buildTrackGeometry,
  createAsphaltMesh,
  createKerbMeshes,
} from './geometry/trackSurface';
import { createFinishLineMesh } from './geometry/finishLine';
import { createTerrainMeshes, createTreeInstances } from './geometry/environment';
import { createRunoffGravel } from './geometry/gravelTraps';
import { createGrandstands } from './geometry/grandstands';
import { createPitComplex } from './geometry/facilities';
import { computeShadowVolume, type ShadowVolume } from './scene/environment';
import type { SurfaceTextures } from './utils/textures';
import type { GeoOrigin } from './utils/geo';

export interface TrackSceneData {
  group: THREE.Group;
  center: LocalPoint;
  centerline: LocalPoint[];
  geoOrigin: GeoOrigin;
  shadowVolume: ShadowVolume;
}

interface BuildOptions {
  trackWidth: number;
  kerbWidth: number;
  grassRadius: number;
  textures: SurfaceTextures;
  localElevationProfile?: (points: LocalPoint[]) => LocalPoint[];
}

function computeCenter(outer: LocalPoint[]): LocalPoint {
  return {
    x: outer.reduce((s, p) => s + p.x, 0) / outer.length,
    y: outer.reduce((s, p) => s + p.y, 0) / outer.length,
    z: outer.reduce((s, p) => s + p.z, 0) / outer.length,
  };
}

export function buildTrackScene(borders: TrackBorders, opts: BuildOptions): TrackSceneData {
  const outerGeo = borders.outer;
  const origin = {
    lon: outerGeo[0].lon,
    lat: outerGeo[0].lat,
    elevation: outerGeo[0].elevation,
  };
  const outerLocal = outerGeo.map((p) => geoToLocal(p, origin));

  const outerSmoothed = smoothClosedBorder(outerLocal, {
    chaikinIterations: 2,
    samplesPerSegment: 24,
    arcStepMeters: 1.2,
  });
  const outerSmooth = opts.localElevationProfile?.(outerSmoothed) ?? outerSmoothed;

  const track = buildTrackGeometry(outerSmooth, opts.trackWidth, opts.kerbWidth);
  const exclusionZone = buildTrackExclusion(track);
  const centerline = offsetClosedCurve(outerSmooth, opts.trackWidth * 0.5, true);

  const center = computeCenter(outerSmooth);
  const shadowVolume = computeShadowVolume(outerSmooth);

  const group = new THREE.Group();
  group.name = 'track-mesh';
  group.userData.center = center;
  group.userData.shadowVolume = shadowVolume;
  group.userData.centerline = centerline;
  group.userData.geoOrigin = origin;

  group.add(createTerrainMeshes(outerSmooth, track, opts.grassRadius, opts.textures));

  const runoff = createRunoffGravel(track);
  runoff.group.renderOrder = 2;
  group.add(runoff.group);

  const asphalt = createAsphaltMesh(track, opts.textures.asphalt);
  asphalt.renderOrder = 3;
  group.add(asphalt);

  const kerbs = createKerbMeshes(track, opts.kerbWidth);
  for (const kerb of kerbs) {
    kerb.renderOrder = 4;
    group.add(kerb);
  }

  const finishLine = createFinishLineMesh(centerline, origin, opts.trackWidth);
  if (finishLine) {
    finishLine.renderOrder = 5;
    group.add(finishLine);
  }

  group.add(
    createTreeInstances(exclusionZone, outerSmooth, track.asphaltInner, {
      outerFar: runoff.outerFar,
      innerFar: runoff.innerFar,
    }),
  );
  group.add(createPitComplex(outerSmooth));
  group.add(createGrandstands(outerSmooth, track.asphaltInner));

  return { group, center, centerline, geoOrigin: origin, shadowVolume };
}
