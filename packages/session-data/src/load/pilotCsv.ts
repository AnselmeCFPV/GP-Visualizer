/** Ligne d'en-tête des enregistrements pilote (après RC-00). */
export const PILOT_CSV_HEADER =
  'Index;Date;Hour;Nb Sat.;GPS;KmH;Kt;GPS Position;X ACC;Y ACC;Z ACC;X GYR;Y GYR;Z GYR;X Angle;Y Angle';

export interface PilotCsvRow {
  index: number;
  date: string;
  hour: string;
  nbSat: number;
  gpsStatus: number;
  speedKmh: number;
  speedKt: number;
  lat: number;
  lon: number;
  /** X ACC → angleX */
  angleX: number;
  /** Y ACC → angleY */
  angleY: number;
  /** Z ACC → gyroX */
  gyroX: number;
  /** X GYR → gyroY */
  gyroY: number;
  /** Y GYR → gyroZ */
  gyroZ: number;
  /** Z GYR → accelerationXY */
  accelerationXY: number;
  /** X Angle → accelerationXYZ (court) */
  accelerationXYZShort: number;
  /** Y Angle → accelerationXYZ (long) */
  accelerationXYZLong: number;
  timestampMs: number;
}

export interface ParsedPilotCsv {
  fileName: string;
  rows: PilotCsvRow[];
  totalLines: number;
  dataStartLine: number;
}

function parseNumber(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseGpsPosition(raw: string): { lat: number; lon: number } | null {
  const cleaned = raw.trim().replace(':', ' ');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const lat = parseNumber(parts[0]);
  const lon = parseNumber(parts[1]);
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return { lat, lon };
}

function parseTimestampMs(date: string, hour: string): number {
  const [day, month, year] = date.split('/').map(Number);
  const [h, min, sec] = hour.split(':').map(Number);
  if (!year || !month || !day) return 0;
  return Date.UTC(year, month - 1, day, h || 0, min || 0, sec || 0);
}

function isDataHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('Index;Date;Hour') &&
    trimmed.includes('GPS Position') &&
    trimmed.includes('KmH')
  );
}

function parseDataRow(line: string): PilotCsvRow | null {
  const parts = line.split(';');
  if (parts.length < 16) return null;

  const position = parseGpsPosition(parts[7] ?? '');
  if (!position) return null;

  const date = parts[1]?.trim() ?? '';
  const hour = parts[2]?.trim() ?? '';

  return {
    index: parseNumber(parts[0] ?? '0'),
    date,
    hour,
    nbSat: parseNumber(parts[3] ?? '0'),
    gpsStatus: parseNumber(parts[4] ?? '0'),
    speedKmh: parseNumber(parts[5] ?? '0'),
    speedKt: parseNumber(parts[6] ?? '0'),
    lat: position.lat,
    lon: position.lon,
    angleX: parseNumber(parts[8] ?? '0'),
    angleY: parseNumber(parts[9] ?? '0'),
    gyroX: parseNumber(parts[10] ?? '0'),
    gyroY: parseNumber(parts[11] ?? '0'),
    gyroZ: parseNumber(parts[12] ?? '0'),
    accelerationXY: parseNumber(parts[13] ?? '0'),
    accelerationXYZShort: parseNumber(parts[14] ?? '0'),
    accelerationXYZLong: parseNumber(parts[15] ?? '0'),
    timestampMs: parseTimestampMs(date, hour),
  };
}

/** Parse un fichier CSV pilote (texte brut). */
export function parsePilotCsv(text: string, fileName = 'unknown.csv'): ParsedPilotCsv {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let dataStartLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (isDataHeaderLine(lines[i] ?? '')) {
      dataStartLine = i + 1;
      break;
    }
  }

  const rows: PilotCsvRow[] = [];
  if (dataStartLine < 0) {
    return { fileName, rows, totalLines: lines.length, dataStartLine: -1 };
  }

  for (let i = dataStartLine; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const row = parseDataRow(line);
    if (row) rows.push(row);
  }

  return { fileName, rows, totalLines: lines.length, dataStartLine };
}

/** Charge et parse un CSV pilote depuis une URL (fetch). */
export async function loadPilotCsv(url: string, fileName?: string): Promise<ParsedPilotCsv> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossible de charger ${url} (${response.status})`);
  }
  const name = fileName ?? url.split('/').pop() ?? 'unknown.csv';
  return parsePilotCsv(await response.text(), name);
}
