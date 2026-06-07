/** Spline périodique minimisant Σ ||P(sᵢ) − pᵢ||² + λ Σ (Δ²c)² */

export interface SplineDataPoint {
  s: number;
  x: number;
  z: number;
}

export interface FittedRacingSpline {
  controlX: number[];
  controlZ: number[];
  knotCount: number;
  totalLength: number;
}

export interface FitRacingSplineOptions {
  knotCount?: number;
  /** Régularisation courbure — plus bas = suit mieux les points (virages) */
  smoothness?: number;
  iterations?: number;
}

const DEFAULT_KNOTS = 88;
const DEFAULT_SMOOTHNESS = 0.5;
const DEFAULT_ITERATIONS = 5;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Base B-spline cubique uniforme périodique — 4 poids pour les indices de contrôle. */
function cubicBasisWeights(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const w0 = (-t3 + 3 * t2 - 3 * t + 1) / 6;
  const w1 = (3 * t3 - 6 * t2 + 4) / 6;
  const w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  const w3 = t3 / 6;
  return [w0, w1, w2, w3];
}

function controlIndices(span: number, n: number): [number, number, number, number] {
  return [mod(span - 1, n), mod(span, n), mod(span + 1, n), mod(span + 2, n)];
}

export function evaluateSpline(
  spline: FittedRacingSpline,
  arcM: number,
): { x: number; z: number } {
  const { controlX, controlZ, knotCount: n, totalLength: L } = spline;
  if (n === 0 || L <= 0) return { x: 0, z: 0 };

  const u = ((arcM % L) + L) % L / L * n;
  const span = Math.floor(u) % n;
  const t = u - Math.floor(u);
  const [w0, w1, w2, w3] = cubicBasisWeights(t);
  const [i0, i1, i2, i3] = controlIndices(span, n);

  return {
    x: w0 * controlX[i0]! + w1 * controlX[i1]! + w2 * controlX[i2]! + w3 * controlX[i3]!,
    z: w0 * controlZ[i0]! + w1 * controlZ[i1]! + w2 * controlZ[i2]! + w3 * controlZ[i3]!,
  };
}

function basisAtArc(arcM: number, L: number, n: number): { idx: number[]; w: number[] } {
  const u = ((arcM % L) + L) % L / L * n;
  const span = Math.floor(u) % n;
  const t = u - Math.floor(u);
  const weights = cubicBasisWeights(t);
  const idx = controlIndices(span, n);
  return { idx: [...idx], w: [...weights] };
}

function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row]![col]!) > Math.abs(M[pivot]![col]!)) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const div = M[col]![col]! || 1e-12;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row]![col]! / div;
      for (let j = col; j <= n; j++) {
        M[row]![j] = M[row]![j]! - factor * M[col]![j]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row]![n]!;
    for (let j = row + 1; j < n; j++) sum -= M[row]![j]! * x[j]!;
    x[row] = sum / (M[row]![row]! || 1e-12);
  }
  return x;
}

function fitCoordinate(
  data: SplineDataPoint[],
  initial: number[],
  L: number,
  n: number,
  lambda: number,
): number[] {
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);

  for (const pt of data) {
    const { idx, w } = basisAtArc(pt.s, L, n);
    for (let a = 0; a < 4; a++) {
      atb[idx[a]!]! += w[a]! * pt.x;
      for (let b = 0; b < 4; b++) {
        ata[idx[a]!]![idx[b]!]! += w[a]! * w[b]!;
      }
    }
  }

  for (let k = 0; k < n; k++) {
    const km = mod(k - 1, n);
    const kp = mod(k + 1, n);
    const row = [0, 1, -2, 1];
    const cols = [km, k, kp];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        ata[cols[a]!]![cols[b]!]! += lambda * row[a]! * row[b]!;
      }
    }
  }

  const result = solveSymmetric(ata, atb);
  if (result.every((v) => Number.isFinite(v))) return result;
  return [...initial];
}

function fitCoordinateZ(
  data: SplineDataPoint[],
  initial: number[],
  L: number,
  n: number,
  lambda: number,
): number[] {
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);

  for (const pt of data) {
    const { idx, w } = basisAtArc(pt.s, L, n);
    for (let a = 0; a < 4; a++) {
      atb[idx[a]!]! += w[a]! * pt.z;
      for (let b = 0; b < 4; b++) {
        ata[idx[a]!]![idx[b]!]! += w[a]! * w[b]!;
      }
    }
  }

  for (let k = 0; k < n; k++) {
    const km = mod(k - 1, n);
    const kp = mod(k + 1, n);
    const row = [0, 1, -2, 1];
    const cols = [km, k, kp];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        ata[cols[a]!]![cols[b]!]! += lambda * row[a]! * row[b]!;
      }
    }
  }

  const result = solveSymmetric(ata, atb);
  if (result.every((v) => Number.isFinite(v))) return result;
  return [...initial];
}

function sampleArcs(L: number, count: number): number[] {
  const arcs: number[] = [];
  for (let i = 0; i < count; i++) {
    arcs.push((i / count) * L);
  }
  return arcs;
}

function closestArc(
  spline: FittedRacingSpline,
  px: number,
  pz: number,
  hintS: number,
  searchWindowM: number,
): number {
  const { totalLength: L } = spline;
  const samples = 48;
  let bestS = hintS;
  let bestDistSq = Infinity;

  for (let i = -samples; i <= samples; i++) {
    const s = hintS + (i / samples) * searchWindowM;
    const wrapped = ((s % L) + L) % L;
    const p = evaluateSpline(spline, wrapped);
    const dx = px - p.x;
    const dz = pz - p.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestS = wrapped;
    }
  }

  return bestS;
}

/**
 * Ajuste une spline fermée : minimise la somme des écarts quadratiques
 * aux points, avec pénalité de courbure (Δ² contrôles).
 */
export function fitRacingSpline(
  data: SplineDataPoint[],
  totalLength: number,
  initialControlX: number[],
  initialControlZ: number[],
  options: FitRacingSplineOptions = {},
): FittedRacingSpline {
  const n = options.knotCount ?? DEFAULT_KNOTS;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const lambda = (options.smoothness ?? DEFAULT_SMOOTHNESS) * (data.length / n);

  let controlX = initialControlX.length === n
    ? [...initialControlX]
    : resampleControls(initialControlX, n);
  let controlZ = initialControlZ.length === n
    ? [...initialControlZ]
    : resampleControls(initialControlZ, n);

  let assigned = data.map((d) => ({ ...d }));

  for (let iter = 0; iter < iterations; iter++) {
    controlX = fitCoordinate(assigned, controlX, totalLength, n, lambda);
    controlZ = fitCoordinateZ(assigned, controlZ, totalLength, n, lambda);

    const spline: FittedRacingSpline = {
      controlX,
      controlZ,
      knotCount: n,
      totalLength,
    };

    if (iter < iterations - 1) {
      assigned = data.map((d) => ({
        ...d,
        s: closestArc(spline, d.x, d.z, d.s, 35),
      }));
    }
  }

  return { controlX, controlZ, knotCount: n, totalLength };
}

function resampleControls(values: number[], count: number): number[] {
  if (values.length === 0) return new Array(count).fill(0);
  if (values.length === count) return [...values];
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * values.length;
    const i0 = Math.floor(t) % values.length;
    const i1 = (i0 + 1) % values.length;
    const f = t - Math.floor(t);
    result.push(values[i0]! * (1 - f) + values[i1]! * f);
  }
  return result;
}

export function sampleSpline(
  spline: FittedRacingSpline,
  sampleCount: number,
): { arcM: number; x: number; z: number }[] {
  const arcs = sampleArcs(spline.totalLength, sampleCount);
  return arcs.map((arcM) => {
    const p = evaluateSpline(spline, arcM);
    return { arcM, x: p.x, z: p.z };
  });
}

export function totalSquaredError(
  spline: FittedRacingSpline,
  data: SplineDataPoint[],
): number {
  let sum = 0;
  for (const d of data) {
    const p = evaluateSpline(spline, d.s);
    const dx = d.x - p.x;
    const dz = d.z - p.z;
    sum += dx * dx + dz * dz;
  }
  return sum;
}
