import { tripIdOfRealm } from './access';

/** Link zum Beitreten (QR-Code, Teilen): `<Origin><Base>?join=<tripId>`. */
export function buildJoinUrl(origin: string, baseUrl: string, tripId: string): string {
  const base = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return `${origin.replace(/\/+$/, '')}${base}?join=${encodeURIComponent(tripId)}`;
}

/** `join`-Parameter aus `location.search`. */
export function parseJoinParam(search: string): string | undefined {
  return new URLSearchParams(search).get('join') || undefined;
}

/** Ziel-Törn nach dem Annehmen: der Törn aus dem Link, sonst der erste Törn mit Einladung. */
export function pickJoinTarget(invites: readonly { realmId: string }[], preferredTripId: string | undefined): string | undefined {
  const ids = invites.map((i) => tripIdOfRealm(i.realmId)).filter((t): t is string => t !== undefined);
  if (preferredTripId !== undefined && ids.includes(preferredTripId)) return preferredTripId;
  return ids[0];
}
