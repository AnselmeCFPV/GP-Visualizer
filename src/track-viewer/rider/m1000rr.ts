/**
 * Modèle physique simplifié — BMW M 1000 RR (piste, pneus slick, pilote ~78 kg).
 * Sources : fiche technique BMW Motorrad, essais Bennetts BikeSocial (Dorna WSBK).
 */

const G = 9.81;
const KMH_TO_MS = 1 / 3.6;

/** Masse totale moto (194 kg DIN) + pilote équipé */
export const M1000RR_MASS_KG = 194 + 78;

/** 218 ch crank → ~155 kW à la roue (boîte + transmission) */
export const M1000RR_POWER_W = 155_000;

/** Vitesse max homologuée */
export const M1000RR_TOP_SPEED_KMH = 314;
export const M1000RR_TOP_SPEED_MS = M1000RR_TOP_SPEED_KMH * KMH_TO_MS;

/** Inclinaison max réaliste piste (56–58° habituel, 60° pro) */
export const M1000RR_MAX_LEAN_DEG = 58;
export const M1000RR_MAX_LEAN_RAD = (M1000RR_MAX_LEAN_DEG * Math.PI) / 180;

/** Freinage WSBK / ABS Pro — ~1,1 g longitudinaux */
export const M1000RR_BRAKE_ACCEL = 10.8;

/** Adhérence latérale max (slick, moto inclinée) : a_lat = g·tan(φ) */
export function m1000rrMaxLateralAccel(speedKmh = 0): number {
  const base = G * Math.tan(M1000RR_MAX_LEAN_RAD);
  const downforce = m1000rrDownforceKg(speedKmh);
  return base * (1 + downforce / M1000RR_MASS_KG);
}

/** M Winglets 3.0 — downforce totale approx. (kg) vs vitesse */
export function m1000rrDownforceKg(speedKmh: number): number {
  if (speedKmh <= 0) return 0;
  if (speedKmh <= 150) return 5.7 * (speedKmh / 150);
  if (speedKmh <= 300) return 5.7 + ((22.6 - 5.7) * (speedKmh - 150)) / 150;
  return 22.6;
}

/** Vitesse max en virage : v = √(a_lat / κ) */
export function m1000rrCornerSpeedMs(curvature: number, speedKmhForGrip = 200): number {
  const k = Math.abs(curvature);
  if (k < 1e-7) return M1000RR_TOP_SPEED_MS;
  const aLat = m1000rrMaxLateralAccel(speedKmhForGrip);
  return Math.sqrt(aLat / k);
}

/** Accélération motrice (limite puissance + motricité arrière slick) */
export function m1000rrDriveAccel(speedMs: number): number {
  if (speedMs >= M1000RR_TOP_SPEED_MS * 0.995) return 0;
  const v = Math.max(speedMs, 6);
  const aPower = M1000RR_POWER_W / (M1000RR_MASS_KG * v);
  const tractionCap = speedMs < 25 ? 13.2 : 11.8;
  return Math.min(aPower, tractionCap);
}

/** Résistance aérodynamique calibrée sur Vmax 314 km/h @ 155 kW */
export function m1000rrDragAccel(speedMs: number): number {
  const rho = 1.225;
  const vTop = M1000RR_TOP_SPEED_MS;
  const cda = (2 * M1000RR_POWER_W) / (rho * vTop ** 3);
  return (0.5 * rho * cda * speedMs * speedMs) / M1000RR_MASS_KG;
}

/** Distance de freinage v₁ → v₂ */
export function m1000rrBrakingDistance(speedFromMs: number, speedToMs: number): number {
  if (speedFromMs <= speedToMs) return 0;
  return (speedFromMs ** 2 - speedToMs ** 2) / (2 * M1000RR_BRAKE_ACCEL);
}

/**
 * Inclinaison réelle en virage stabilisé : φ = arctan(a_centripète / g)
 * a_centripète = v² · κ
 */
export function m1000rrLeanDeg(speedMs: number, signedCurvature: number): number {
  const k = Math.abs(signedCurvature);
  if (k < 1e-7 || speedMs < 0.5) return 0;
  const aLat = speedMs * speedMs * k;
  const leanMag = Math.min(
    M1000RR_MAX_LEAN_DEG,
    (Math.atan(aLat / G) * 180) / Math.PI,
  );
  return leanMag * Math.sign(signedCurvature || 0);
}
