import type { GeoPoint, TrackBorders } from '@prenois/geo';

/** Centroïde GPS de la bordure extérieure du circuit. */
export function computeCircuitCenter(borders: TrackBorders): Pick<GeoPoint, 'lat' | 'lon'> {
  const outer = borders.outer;
  const lat = outer.reduce((sum, p) => sum + p.lat, 0) / outer.length;
  const lon = outer.reduce((sum, p) => sum + p.lon, 0) / outer.length;
  return { lat, lon };
}
