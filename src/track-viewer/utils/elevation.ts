import type { GeoPoint } from '../types';

const BATCH_SIZE = 80;

/** Récupère l'altitude WGS84 (m) pour des points GPS via Open-Meteo */
export async function fetchElevations(points: GeoPoint[]): Promise<number[]> {
  const elevations: number[] = new Array(points.length);

  for (let i = 0; i < points.length; i += BATCH_SIZE) {
    const batch = points.slice(i, i + BATCH_SIZE);
    const lat = batch.map((p) => p.lat.toFixed(6)).join(',');
    const lon = batch.map((p) => p.lon.toFixed(6)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Élévation: HTTP ${res.status}`);
    const data = (await res.json()) as { elevation: number[] };

    for (let j = 0; j < batch.length; j++) {
      elevations[i + j] = data.elevation[j] ?? 0;
    }
  }

  return elevations;
}

export async function enrichGeoElevation(points: GeoPoint[]): Promise<GeoPoint[]> {
  try {
    const elevations = await fetchElevations(points);
    return points.map((p, i) => ({ ...p, elevation: elevations[i] }));
  } catch (err) {
    console.warn('Élévation API indisponible, altitudes à 0 :', err);
    return points;
  }
}
