import type { Boat, BoatSelection, CoverFocus, ID } from './types';

/** Anzahl unterscheidbarer Boot-Darstellungen (Farbe + Symbolform). */
export const BOAT_STYLES = 4;

/** Boote ohne Tombstones, in Anlage-Reihenfolge. */
export function activeBoats(boats: readonly Boat[]): Boat[] {
  return boats
    .filter((b) => b.deletedAt === undefined)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Farbe/Form für ein neues Boot: die am wenigsten genutzte (bei Gleichstand die kleinste) von 1..4. */
export function nextColorIndex(boats: readonly Boat[]): number {
  const used = new Map<number, number>();
  for (const b of activeBoats(boats)) used.set(b.colorIndex, (used.get(b.colorIndex) ?? 0) + 1);
  let best = 1;
  for (let i = 1; i <= BOAT_STYLES; i++) if ((used.get(i) ?? 0) < (used.get(best) ?? 0)) best = i;
  return best;
}

/** Farbe/Form 1..4 eines Boots (Datenfehler werden in den Bereich gefaltet). */
export function boatStyle(boat: Pick<Boat, 'colorIndex'>): number {
  const i = Math.round(boat.colorIndex);
  return Number.isFinite(i) && i >= 1 ? ((i - 1) % BOAT_STYLES) + 1 : 1;
}

const valid = (boats: readonly Boat[], id: ID | undefined): id is ID => !!id && boats.some((b) => b.id === id);

/**
 * Stellung des Boot-Schalters: gespeicherte Wahl dieses Geräts (Boot oder „Alle“), sonst das vorgeschlagene
 * Boot der eigenen Person, sonst das erste. Mit nur einem Boot immer dieses (Schalter ist ausgeblendet).
 */
export function resolveBoatSelection(input: {
  boats: readonly Boat[];
  stored?: BoatSelection | undefined;
  suggested?: ID | undefined;
}): BoatSelection | undefined {
  const { boats, stored, suggested } = input;
  const first = boats[0];
  if (!first) return undefined;
  if (boats.length === 1) return first.id;
  if (stored === 'all') return 'all';
  if (valid(boats, stored)) return stored;
  if (valid(boats, suggested)) return suggested;
  return first.id;
}

/** Ids der Boote, die Timeline/Statistik/Tage gerade zeigen. */
export function shownBoatIds(boats: readonly Boat[], selection: BoatSelection | undefined): ID[] {
  if (selection === undefined || selection === 'all' || !valid(boats, selection)) return boats.map((b) => b.id);
  return [selection];
}

/**
 * Vorauswahl „Für welches Boot?“ bei einem neuen Eintrag: das gewählte Boot; bei „Alle“ das zuletzt auf
 * diesem Gerät gewählte, sonst der Vorschlag der eigenen Person; mit nur einem Boot dieses. Sonst keine
 * Vorauswahl (Pflichtauswahl).
 */
export function defaultEntryBoat(input: {
  boats: readonly Boat[];
  selection: BoatSelection | undefined;
  last?: ID | undefined;
  suggested?: ID | undefined;
}): ID | undefined {
  const { boats, selection, last, suggested } = input;
  if (selection !== 'all' && valid(boats, selection)) return selection;
  if (valid(boats, last)) return last;
  if (valid(boats, suggested)) return suggested;
  return boats.length === 1 ? boats[0]!.id : undefined;
}

/** Hat das Boot (lebende) Einträge oder Tracks? Dann kann es nicht entfernt werden. */
export function boatInUse(
  boatId: ID,
  entries: readonly { boatId: ID; deletedAt?: number }[],
  tracks: readonly { boatId: ID; deletedAt?: number }[],
): boolean {
  const live = (r: { boatId: ID; deletedAt?: number }): boolean => r.boatId === boatId && r.deletedAt === undefined;
  return entries.some(live) || tracks.some(live);
}

/** Anzeigename aus einer E-Mail-Adresse: „anna.berg@…“ → „Anna Berg“. */
export function nameFromEmail(email: string): string {
  const local = email.trim().split('@')[0] ?? '';
  const words = local.split(/[._\-+]+/).filter(Boolean);
  if (words.length === 0) return email.trim();
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n * 10) / 10)) : 50);

/** Fokuspunkt des Covers auf 0..100 % begrenzen (ungültig → Mitte). */
export function clampFocus(f: CoverFocus): CoverFocus {
  return { x: clamp(f.x), y: clamp(f.y) };
}

/** CSS object-position für das Cover (ohne Fokus: Mitte). */
export function coverPosition(f: CoverFocus | undefined): string {
  const c = clampFocus(f ?? { x: 50, y: 50 });
  return `${c.x}% ${c.y}%`;
}
