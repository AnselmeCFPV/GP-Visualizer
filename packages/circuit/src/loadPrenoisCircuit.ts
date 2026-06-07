import type { TrackBorders } from '@prenois/geo';
import { loadTrackKml } from './kmlParser';
import { enrichWithLapmetaProfile } from './lapmetaElevation';

export const PRENOIS_DEFAULT_KML = '/track_data/track_data.kml';

export interface LoadPrenoisCircuitOptions {
  kmlUrl?: string;
  /** Applique le profil LapMeta 741 sur la bordure extérieure — défaut true */
  enrichElevation?: boolean;
}

/** Charge le circuit Dijon-Prenois (KML + profil d'élévation LapMeta). */
export async function loadPrenoisCircuit(
  options: LoadPrenoisCircuitOptions = {},
): Promise<TrackBorders> {
  const { kmlUrl = PRENOIS_DEFAULT_KML, enrichElevation = true } = options;
  const borders = await loadTrackKml(kmlUrl);

  if (!enrichElevation) {
    return borders;
  }

  return {
    ...borders,
    outer: await enrichWithLapmetaProfile(borders.outer),
  };
}
