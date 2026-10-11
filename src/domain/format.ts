import type { LatLon } from './geo';

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
const comma = (n: number, decimals: number): string => n.toFixed(decimals).replace('.', ',');

function formatCoord(value: number, degLen: number, decimals: number, pos: string, neg: string): string {
  const abs = Math.abs(value);
  const factor = 10 ** decimals;
  let deg = Math.floor(abs);
  let min = Math.round((abs - deg) * 60 * factor) / factor;
  if (min >= 60) {
    deg += 1;
    min = 0;
  }
  const minStr = comma(min, decimals);
  const [int, frac] = minStr.split(',');
  const minOut = pad(Number(int)) + (frac !== undefined ? `,${frac}` : '');
  return `${pad(deg, degLen)}°${minOut}′${value < 0 ? neg : pos}`;
}

export function formatLat(lat: number, decimals = 1): string {
  return formatCoord(lat, 2, decimals, 'N', 'S');
}

export function formatLon(lon: number, decimals = 1): string {
  return formatCoord(lon, 3, decimals, 'E', 'W');
}

export function formatPosition(pos: LatLon, decimals = 1): string {
  return `${formatLat(pos.lat, decimals)} ${formatLon(pos.lon, decimals)}`;
}

export function formatNm(n: number): string {
  return `${comma(n, 1)} sm`;
}

export function formatDuration(min: number): string {
  const total = Math.round(min);
  return `${Math.floor(total / 60)} h ${pad(total % 60)} min`;
}

/** Verschiebt die Zeit so, dass die UTC-Getter die lokale Zeit liefern. */
const shifted = (time: number, tzOffsetMin: number): Date => new Date(time + tzOffsetMin * 60000);

export function formatTime(time: number, tzOffsetMin: number): string {
  const d = shifted(time, tzOffsetMin);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function formatDateLong(dateStr: string): string {
  const [y = 1970, m = 1, d = 1] = dateStr.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${pad(d)}.${pad(m)}.${y}`;
}

export function toIsoWithOffset(time: number, tzOffsetMin: number): string {
  const d = shifted(time, tzOffsetMin);
  const sign = tzOffsetMin < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
