import type { ID } from './types';

/** Schlüssel eines Tagesbericht-Abschnitts: gleiche Sektion (Trip, Tag, Autor) ⇒ gleiche id auf jedem Gerät. */
export function dayReportId(tripId: ID, date: string, authorId: ID): ID {
  return `${tripId}|${date}|${authorId || '-'}`;
}

let counter = 0;

/**
 * Global eindeutige id, die lexikografisch nach Zeit sortiert. Dexies Array-Operation `add()` sortiert
 * `photoIds`; mit diesen ids bleibt die Reihenfolge chronologisch.
 */
export function timeOrderedId(time: number): ID {
  counter = (counter + 1) % 1296;
  const t = Math.max(0, Math.floor(time)).toString(36).padStart(10, '0');
  return `${t}${counter.toString(36).padStart(2, '0')}-${crypto.randomUUID()}`;
}
