export const COMPASS_16 = [
  'N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

export type Compass16 = (typeof COMPASS_16)[number];

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export function degToCompass16(deg: number): Compass16 {
  return COMPASS_16[Math.floor((mod(deg, 360) + 11.25) / 22.5) % 16] ?? 'N';
}

export function compass16ToDeg(index: number): number {
  return mod(index, 16) * 22.5;
}

export interface BeaufortLevel {
  bft: number;
  name: string;
  minKn: number;
  maxKn: number | null; // null = nach oben offen
}

export const BEAUFORT: readonly BeaufortLevel[] = [
  { bft: 0, name: 'Windstille', minKn: 0, maxKn: 0 },
  { bft: 1, name: 'leiser Zug', minKn: 1, maxKn: 3 },
  { bft: 2, name: 'leichte Brise', minKn: 4, maxKn: 6 },
  { bft: 3, name: 'schwache Brise', minKn: 7, maxKn: 10 },
  { bft: 4, name: 'mäßige Brise', minKn: 11, maxKn: 16 },
  { bft: 5, name: 'frische Brise', minKn: 17, maxKn: 21 },
  { bft: 6, name: 'starker Wind', minKn: 22, maxKn: 27 },
  { bft: 7, name: 'steifer Wind', minKn: 28, maxKn: 33 },
  { bft: 8, name: 'stürmischer Wind', minKn: 34, maxKn: 40 },
  { bft: 9, name: 'Sturm', minKn: 41, maxKn: 47 },
  { bft: 10, name: 'schwerer Sturm', minKn: 48, maxKn: 55 },
  { bft: 11, name: 'orkanartiger Sturm', minKn: 56, maxKn: 63 },
  { bft: 12, name: 'Orkan', minKn: 64, maxKn: null },
];

export function formatWind(dirDeg?: number, bft?: number): string {
  const parts: string[] = [];
  if (dirDeg !== undefined) parts.push(degToCompass16(dirDeg));
  if (bft !== undefined) parts.push(`${bft} Bft`);
  return parts.join(' ');
}
