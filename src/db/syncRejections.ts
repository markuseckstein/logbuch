import type { Table } from 'dexie';
import { analyzeSyncExchange, parseSyncJson, type ChangeRef, type MutationType } from '../domain/syncRejections';
import type { LogbookDB } from './db';
import { canWriteTrip } from './repo';

/**
 * Vom Dexie-Cloud-Server abgelehnte Änderungen retten. Das Addon ignoriert `rejections` der Sync-Antwort und
 * übernimmt den Serverstand (neue Einträge verschwinden lokal). Wir lesen jede Sync-Antwort mit
 * (`wrapSyncFetch`), sichern die betroffenen Datensätze vor dem Zurückrollen (`recordSyncExchange`) und
 * schreiben sie erneut, sobald das Logbuch wieder beschreibbar ist (`resubmitRescued`). Die Kopien liegen in
 * `settings` (nicht synchronisiert). Die UI zeigt sie an (Hinweis, erneut senden, verwerfen).
 */

/** App-Tabellen, deren Datensätze gerettet werden (Zugriffstabellen wie members/realms nicht). */
const RESCUE_TABLES = new Set(['trips', 'boats', 'crewMembers', 'entries', 'photos', 'dayReports', 'tracks', 'trackChunks']);
const STORE_KEY = 'syncRescue';
/** Automatische Wiederholungen; danach nur noch per „Erneut senden“. */
export const MAX_AUTO_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;

export interface RescuedChange {
  table: string;
  key: string;
  type: Exclude<MutationType, 'delete'>;
  props: string[];
  /** Grund laut Server (Original-Meldung). */
  reason: string;
  /** Zeitpunkt der letzten Ablehnung (epoch ms). */
  at: number;
  /** Wie oft der Server die Änderung abgelehnt hat. */
  attempts: number;
  /** pending = wartet auf erneutes Senden; resent = erneut geschrieben, Bestätigung des Servers steht aus. */
  state: 'pending' | 'resent';
  /** Lokale Kopie des Datensatzes zum Zeitpunkt der Ablehnung. */
  row?: Record<string, unknown>;
}

const idOf = (c: ChangeRef): string => `${c.table}\u0000${c.key}`;

export async function listRescued(db: LogbookDB): Promise<RescuedChange[]> {
  const row = await db.settings.get(STORE_KEY);
  return Array.isArray(row?.value) ? (row.value as RescuedChange[]) : [];
}

async function save(db: LogbookDB, items: RescuedChange[]): Promise<void> {
  if (items.length === 0) await db.settings.delete(STORE_KEY);
  else await db.settings.put({ key: STORE_KEY, value: items });
}

function tableOf(db: LogbookDB, name: string): Table<Record<string, unknown>, string> {
  return db.table(name);
}

/**
 * Wertet einen Sync-Austausch aus: abgelehnte Datensätze sichern (lokaler Stand, bevor das Addon den
 * Serverstand anwendet), erneut gesendete und nun übernommene Datensätze als bestätigt entfernen.
 */
export async function recordSyncExchange(
  db: LogbookDB, requestBody: string | undefined, responseBody: string | undefined, now = Date.now(),
): Promise<{ rejected: number; confirmed: number }> {
  const { rejected, accepted } = analyzeSyncExchange(parseSyncJson(requestBody), parseSyncJson(responseBody));
  const relevant = rejected.filter((c) => RESCUE_TABLES.has(c.table) && c.type !== 'delete');
  const acceptedIds = new Set(accepted.map(idOf));
  if (relevant.length === 0 && acceptedIds.size === 0) return { rejected: 0, confirmed: 0 };
  const snapshots = await Promise.all(relevant.map((c) => tableOf(db, c.table).get(c.key)));
  return db.transaction('rw', db.settings, async () => {
    const items = new Map((await listRescued(db)).map((i) => [idOf(i), i]));
    let confirmed = 0;
    for (const [id, item] of items) {
      if (item.state === 'resent' && acceptedIds.has(id)) {
        items.delete(id);
        confirmed++;
      }
    }
    relevant.forEach((c, i) => {
      const prev = items.get(idOf(c));
      const row = snapshots[i] ?? prev?.row;
      items.set(idOf(c), {
        table: c.table, key: c.key, type: prev?.type ?? (c.type as RescuedChange['type']),
        props: [...new Set([...(prev?.props ?? []), ...c.props])], reason: c.reason, at: now,
        attempts: (prev?.attempts ?? 0) + 1, state: 'pending', ...(row ? { row } : {}),
      });
    });
    await save(db, [...items.values()]);
    return { rejected: relevant.length, confirmed };
  });
}

function tripIdOf(item: RescuedChange): string | undefined {
  if (item.table === 'trips') return item.key;
  const t = item.row?.['tripId'];
  return typeof t === 'string' ? t : undefined;
}

function due(item: RescuedChange, now: number): boolean {
  return item.attempts < MAX_AUTO_ATTEMPTS && now >= item.at + BASE_DELAY_MS * 2 ** (item.attempts - 1);
}

/**
 * Schreibt gerettete Datensätze erneut (neue Mutation → nächster Sync), sobald ihr Logbuch beschreibbar ist
 * (Mitgliedschaft vom Server bestätigt, Rechte wirksam). Automatisch mit Backoff; `force` = „Erneut senden“.
 * Liefert die Zahl der erneut geschriebenen Datensätze.
 */
export async function resubmitRescued(db: LogbookDB, opts: { now?: number; force?: boolean } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const candidates = (await listRescued(db)).filter((i) => i.state === 'pending' && i.row && (opts.force || due(i, now)));
  let count = 0;
  for (const item of candidates) {
    const tripId = tripIdOf(item);
    if (!tripId || !(await canWriteTrip(db, tripId))) continue;
    const table = tableOf(db, item.table);
    // always the trip's current realm (never write without realmId; the trip may have moved meanwhile)
    const realmId = item.table === 'trips' ? item.row!['realmId'] : (await db.trips.get(tripId))?.realmId;
    await db.transaction('rw', table, db.settings, async () => {
      const row = typeof realmId === 'string' ? { ...item.row!, realmId } : item.row!;
      const current = await table.get(item.key);
      if (current && item.type === 'update') {
        const patch = Object.fromEntries(item.props.filter((p) => p in row).map((p) => [p, row[p]]));
        if (Object.keys(patch).length > 0) await table.update(item.key, patch);
      } else {
        await table.put(row);
      }
      const items = await listRescued(db);
      await save(db, items.map((i) => (idOf(i) === idOf(item) ? { ...i, state: 'resent' as const } : i)));
    });
    count++;
  }
  return count;
}

/** Gerettete Kopien verwerfen (alle oder die angegebenen). */
export async function discardRescued(db: LogbookDB, which?: readonly ChangeRef[]): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    if (!which) return save(db, []);
    const drop = new Set(which.map(idOf));
    return save(db, (await listRescued(db)).filter((i) => !drop.has(idOf(i))));
  });
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Hängt sich in `fetch` ein und reicht Request- und Antwort-Body jedes erfolgreichen `POST <db>/sync` an
 * `onExchange` weiter – bevor das Addon die Antwort verarbeitet (und abgelehnte Datensätze zurückrollt).
 * Fehler des Beobachters stören den Sync nie.
 */
export function wrapSyncFetch(
  fetchFn: FetchFn, databaseUrl: string,
  onExchange: (requestBody: string | undefined, responseBody: string) => Promise<unknown>,
): FetchFn {
  const syncUrl = `${databaseUrl.replace(/\/+$/, '')}/sync`;
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (urlOf(input) !== syncUrl || !res.ok) return res;
    try {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      await onExchange(body, await res.clone().text());
    } catch {
      // Beobachtung ist best effort
    }
    return res;
  };
}
