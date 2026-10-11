export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_NM = 3440.065;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Großkreisdistanz (Haversine) in Seemeilen. */
export function distanceNm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Summe der Teilstrecken in sm. */
export function routeDistanceNm(points: readonly LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev && cur) sum += distanceNm(prev, cur);
  }
  return sum;
}

/** Initialer Kurs von a nach b in Grad, 0 <= x < 360. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const norm = ((deg % 360) + 360) % 360;
  return norm >= 359.9999999 ? 0 : norm;
}
