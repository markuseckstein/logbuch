import type { LatLon } from './geo';

/**
 * Daheim-Link: Zuschauer ohne Anmeldung (Familie zu Hause). Pro Törn ein Dexie-Cloud-Demo-Konto
 * `daheim-<token>@demo.local` (Login ohne Code), Mitglied im Törn-Realm mit Rolle `viewer` ohne Rechte.
 * Wer den Link kennt, kennt das Konto – der Token ist deshalb 128 Bit Zufall und steht nur im URL-Hash.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const TOKEN_BYTES = 16;
/** 128 Bit in Base32 (RFC 4648, Kleinbuchstaben, ohne Padding). */
export const HOME_VIEW_TOKEN_LENGTH = 26;
const TOKEN_RE = /^[a-z2-7]{26}$/;
const EMAIL_RE = /^daheim-([a-z2-7]{26})@demo\.local$/;
const HASH_KEY = 'daheim';

/** Anzeigename des Zuschauer-Mitglieds im Realm. */
export const VIEWER_NAME = 'Daheim';
/** Rolle aus roles.json (ohne Rechte). */
export const VIEWER_ROLE = 'viewer';

/** Neuer Token; `fill` füllt das Array mit kryptographischem Zufall (z. B. `crypto.getRandomValues`). */
export function createHomeViewToken(fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array): string {
  const bytes = fill(new Uint8Array(TOKEN_BYTES));
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function isHomeViewToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

/** Konto des Zuschauers zu einem Token. */
export function viewerEmail(token: string): string {
  if (!isHomeViewToken(token)) throw new Error('Invalid home view token');
  return `daheim-${token}@demo.local`;
}

/** Token aus einer Zuschauer-Adresse; undefined für alle anderen Adressen. */
export function viewerToken(email: string | undefined): string | undefined {
  return email ? EMAIL_RE.exec(email.trim().toLowerCase())?.[1] : undefined;
}

/** Ist das ein Zuschauer-Konto (Daheim-Link)? */
export function isViewerEmail(email: string | undefined): boolean {
  return viewerToken(email) !== undefined;
}

/** `<Origin><Base>#daheim=<token>` – im Hash, damit der Token in keinem Server-Log landet. */
export function buildHomeViewUrl(origin: string, baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/^\.?\/*/, '');
  return `${origin.replace(/\/+$/, '')}/${trimmed}#${HASH_KEY}=${token}`;
}

/** Token aus `location.hash` (`#daheim=<token>`, auch neben anderen Parametern). */
export function parseHomeViewHash(hash: string): string | undefined {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get(HASH_KEY)?.trim().toLowerCase();
  return raw && isHomeViewToken(raw) ? raw : undefined;
}

interface Changed {
  updatedAt: number;
  deletedAt?: number | undefined;
}

export interface LastUpdateSources {
  entries: readonly Changed[];
  dayReports: readonly Changed[];
  tracks: readonly (Changed & { points: readonly { time?: number | undefined }[] })[];
}

/** Jüngste Änderung (Einträge, Tagesberichte, Tracks inkl. Punktzeiten) für „Zuletzt aktualisiert vor …“. */
export function lastUpdatedAt({ entries, dayReports, tracks }: LastUpdateSources): number | undefined {
  let last: number | undefined;
  const see = (t: number | undefined): void => {
    if (t !== undefined && (last === undefined || t > last)) last = t;
  };
  for (const r of [...entries, ...dayReports]) if (r.deletedAt === undefined) see(r.updatedAt);
  for (const t of tracks) {
    if (t.deletedAt !== undefined) continue;
    see(t.updatedAt);
    for (const p of t.points) see(p.time);
  }
  return last;
}

const MIN = 60_000;

/** „gerade eben“, „vor 5 Minuten“, „vor 1 Stunde“, „vor 3 Tagen“. */
export function formatAgo(time: number, now: number): string {
  const min = Math.floor((now - time) / MIN);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} ${min === 1 ? 'Minute' : 'Minuten'}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
  const d = Math.floor(h / 24);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

/**
 * Letzte bekannte Position eines Boots (Karte: hervorgehoben): jüngste Eintrags- bzw. Track-Position mit Zeit,
 * sonst der letzte Track-Punkt ohne Zeit.
 */
export function latestPosition(
  entries: readonly { time: number; position?: LatLon | undefined }[],
  tracks: readonly { points: readonly (LatLon & { time?: number | undefined })[] }[],
): LatLon | undefined {
  let best: { time: number; pos: LatLon } | undefined;
  const see = (time: number, pos: LatLon): void => {
    if (!best || time > best.time) best = { time, pos: { lat: pos.lat, lon: pos.lon } };
  };
  for (const e of entries) if (e.position) see(e.time, e.position);
  let untimed: LatLon | undefined;
  for (const t of tracks) {
    for (const p of t.points) {
      if (p.time !== undefined) see(p.time, p);
      else untimed = { lat: p.lat, lon: p.lon };
    }
  }
  return best?.pos ?? untimed;
}
