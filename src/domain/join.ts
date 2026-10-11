import { tripIdOfRealm } from './access';

/**
 * Link zum Beitreten bzw. Wieder-Anmelden (QR-Code, Teilen): `<Origin><Base>?join=<tripId>[&email=<E-Mail>]`.
 * Mit `email` ist der Link persönlich: der Anmelde-Dialog ist vorausgefüllt.
 */
export function buildJoinUrl(origin: string, baseUrl: string, tripId: string, email?: string): string {
  const base = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  const mail = email ? `&email=${encodeURIComponent(email)}` : '';
  return `${origin.replace(/\/+$/, '')}${base}?join=${encodeURIComponent(tripId)}${mail}`;
}

/** `email`-Parameter aus `location.search`. */
export function parseJoinEmailParam(search: string): string | undefined {
  return new URLSearchParams(search).get('email') || undefined;
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

export interface JoinInput {
  loggedIn: boolean;
  /** Sync-Phase „in-sync“ erreicht. */
  synced: boolean;
  /** Nach dem Sync zusätzlich die Wartezeit abgelaufen (Einladungen/Törns treffen verzögert ein). */
  settled: boolean;
  /** Annehmen läuft gerade. */
  accepting: boolean;
  openInvites: number;
  /** Törns, in denen die Person Mitglied ist (geteilte Realms), lokal angekommen. */
  tripIds: readonly string[];
  /** Törn aus dem Link bzw. nach dem Annehmen; fehlt bei „Ich bin eingeladen / wieder anmelden“. */
  wantedTripId: string | undefined;
}

export type JoinDecision =
  | { kind: 'signed-out' }
  | { kind: 'accepting' }
  | { kind: 'waiting' }
  | { kind: 'activate'; tripId: string; notice?: 'not-member' }
  | { kind: 'no-invite' };

/**
 * Was passiert nach der Anmeldung? Offene Einladungen werden angenommen; eine bestehende Mitgliedschaft zählt als
 * Erfolg (Wieder-Anmelden mit leerem Speicher). „Keine Einladung“ erst, wenn nach dem Sync weder Einladung noch Törn da ist.
 */
export function decideJoinState(i: JoinInput): JoinDecision {
  if (!i.loggedIn) return { kind: 'signed-out' };
  if (i.accepting || i.openInvites > 0) return { kind: 'accepting' };
  const [first] = i.tripIds;
  if (i.wantedTripId !== undefined && i.tripIds.includes(i.wantedTripId)) return { kind: 'activate', tripId: i.wantedTripId };
  if (first !== undefined) {
    if (i.wantedTripId === undefined) return { kind: 'activate', tripId: first };
    // gewünschter Törn fehlt: erst nach Abschluss des Abgleichs auf einen vorhandenen ausweichen
    return i.synced && i.settled ? { kind: 'activate', tripId: first, notice: 'not-member' } : { kind: 'waiting' };
  }
  return i.synced && i.settled ? { kind: 'no-invite' } : { kind: 'waiting' };
}
