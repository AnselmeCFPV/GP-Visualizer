/**
 * Profil d'élévation — LapMeta variation 741, Dijon-Prenois GP.
 * Axe Y : altitude absolue du graphique (0–33 m, max = 33 m).
 * Axe X : distance depuis la ligne de départ (0–3 700 m).
 * Source : courbe « elevation profile » LapMeta (relevé sur graphique).
 */
export const LAPMETA_741_LENGTH = 3700;

/** Altitude au point de départ / arrivée sur le graphique LapMeta */
export const PROFILE_START_ELEVATION = 28;

/**
 * Points de contrôle [distance (m), altitude (m)].
 * Transitions lissées par spline Catmull-Rom entre ces points.
 */
export const LAPMETA_741_CONTROL_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 28],
  [200, 31],
  [350, 33],
  [500, 27],
  [650, 20],
  [800, 15],
  [920, 17],
  [1050, 14],
  [1180, 19],
  [1300, 23],
  [1420, 20],
  [1550, 10],
  [1680, 4],
  [1750, 2],
  [1900, 8],
  [2050, 16],
  [2200, 22],
  [2350, 25],
  [2500, 25],
  [2620, 22],
  [2750, 16],
  [2880, 9],
  [3000, 3],
  [3100, 0],
  [3200, 5],
  [3350, 14],
  [3500, 22],
  [3620, 26],
  [3700, 28],
];

/** Point de départ : 47°21'47.82"N 4°53'51.04"E */
export const PRENOIS_START = {
  lat: 47 + 21 / 60 + 47.82 / 3600,
  lon: 4 + 53 / 60 + 51.04 / 3600,
};
