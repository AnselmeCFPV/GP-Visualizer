import type { GeoPoint } from '@prenois/geo';

/** Échantillon GPS enregistré (pas du temps réel). */
export interface GpsSample {
  timestampMs: number;
  lon: number;
  lat: number;
  elevation?: number;
  speedKmh?: number;
}

/** Échantillon IMU enregistré. */
export interface ImuSample {
  timestampMs: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
}

/** Données brutes d'un pilote pour une session. */
export interface RiderRecording {
  riderId: string;
  label?: string;
  gps: GpsSample[];
  imu: ImuSample[];
}

/** Session complète : tous les pilotes + métadonnées. */
export interface SessionDataset {
  sessionId: string;
  riders: RiderRecording[];
}

/** Point GPS corrigé et interpolé, prêt pour la visu ou l'analyse. */
export interface CorrectedGpsPoint extends GeoPoint {
  timestampMs: number;
  speedKmh?: number;
  leanDeg?: number;
}
