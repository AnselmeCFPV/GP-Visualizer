import type { GeoPoint, TrackBorders } from '@prenois/geo';

function parseCoordinateTriplet(raw: string): GeoPoint {
  const parts = raw.trim().split(',');
  return {
    lon: parseFloat(parts[0]),
    lat: parseFloat(parts[1]),
    elevation: parts[2] ? parseFloat(parts[2]) : 0,
  };
}

function extractPolygonCoords(kml: string, placemarkName: string): GeoPoint[] {
  const placemarkRegex = new RegExp(
    `<Placemark[^>]*>[\\s\\S]*?<name>${placemarkName}</name>[\\s\\S]*?<coordinates>\\s*([\\s\\S]*?)\\s*</coordinates>`,
    'i',
  );
  const match = kml.match(placemarkRegex);
  if (!match) {
    throw new Error(`Placemark "${placemarkName}" introuvable dans le KML`);
  }

  return match[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseCoordinateTriplet);
}

export function parseTrackKml(kml: string): TrackBorders {
  const inner = extractPolygonCoords(kml, 'Prenois_bordure_interne');
  const outer = extractPolygonCoords(kml, 'Prenois_bordure_externe');

  if (inner.length < 3 || outer.length < 3) {
    throw new Error('Bordures du circuit invalides (moins de 3 points)');
  }

  return { inner, outer };
}

export async function loadTrackKml(url: string): Promise<TrackBorders> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossible de charger le KML (${response.status})`);
  }
  return parseTrackKml(await response.text());
}
