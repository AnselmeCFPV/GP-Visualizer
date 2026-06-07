import * as THREE from 'three';
import type { LocalPoint } from '../types';
import { distance2D } from '../utils/geo';
import { offsetClosedCurve } from '../utils/spline';

interface StraightSection {
  start: number;
  end: number;
  length: number;
}

function findMainStraight(border: LocalPoint[]): StraightSection {
  const n = border.length;
  let best: StraightSection = { start: 0, end: 0, length: 0 };
  let runStart = 0;
  let runLen = 0;

  for (let i = 1; i <= n; i++) {
    const prev = border[(i - 1) % n];
    const curr = border[i % n];
    const segLen = distance2D(prev, curr);

    const prev2 = border[(i - 2 + n) % n];
    const v1x = prev.x - prev2.x;
    const v1z = prev.z - prev2.z;
    const v2x = curr.x - prev.x;
    const v2z = curr.z - prev.z;
    const l1 = Math.hypot(v1x, v1z) || 1;
    const l2 = Math.hypot(v2x, v2z) || 1;
    const dot = (v1x / l1) * (v2x / l2) + (v1z / l1) * (v2z / l2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle < 0.04) {
      if (runLen === 0) runStart = i - 1;
      runLen += segLen;
    } else if (runLen > best.length) {
      best = { start: runStart, end: i - 1, length: runLen };
      runLen = 0;
    } else {
      runLen = 0;
    }
  }

  if (runLen > best.length) {
    best = { start: runStart, end: n - 1, length: runLen };
  }
  return best;
}

function sectionMidpoint(border: LocalPoint[], section: StraightSection): LocalPoint {
  const pts = border.slice(section.start, section.end + 1);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  };
}

function sectionAngle(border: LocalPoint[], section: StraightSection): number {
  const a = border[section.start];
  const b = border[Math.min(section.end, section.start + 10)];
  return Math.atan2(b.x - a.x, b.z - a.z);
}

export function createPitComplex(outerBorder: LocalPoint[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pit-complex';

  const straight = findMainStraight(outerBorder);
  const mid = sectionMidpoint(outerBorder, straight);
  const angle = sectionAngle(outerBorder, straight);
  const inward = offsetClosedCurve(outerBorder, 1, true);
  const midIn = sectionMidpoint(inward, straight);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5e64, roughness: 0.75, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.15 });

  // Ligne des stands le long de la ligne droite
  const pitLength = Math.min(straight.length * 0.7, 120);
  const pit = new THREE.Group();

  const mainBuilding = new THREE.Mesh(new THREE.BoxGeometry(pitLength, 7, 14), wallMat);
  mainBuilding.position.set(0, 3.5, 0);
  mainBuilding.castShadow = true;
  mainBuilding.receiveShadow = true;
  pit.add(mainBuilding);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(pitLength + 4, 0.6, 18), roofMat);
  roof.position.set(0, 7.3, 0);
  pit.add(roof);

  for (let i = 0; i < 6; i++) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 0.3), new THREE.MeshStandardMaterial({ color: 0x88a0b8, roughness: 0.3, metalness: 0.2 }));
    bay.position.set(-pitLength / 2 + 12 + i * 16, 3, 7.2);
    pit.add(bay);
  }

  pit.position.set(midIn.x, midIn.y, midIn.z);
  pit.rotation.y = angle;
  group.add(pit);

  // Petite zone technique près de l'entrée paddock
  const tech = new THREE.Mesh(new THREE.BoxGeometry(18, 5, 10), wallMat);
  tech.position.set(
    mid.x - Math.sin(angle) * 50,
    mid.y + 2.5,
    mid.z - Math.cos(angle) * 50,
  );
  tech.rotation.y = angle;
  tech.castShadow = true;
  group.add(tech);

  return group;
}
