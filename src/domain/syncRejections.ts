/**
 * Vom Sync-Server abgelehnte Änderungen erkennen (Dexie Cloud). Der Server antwortet auf `POST /sync` mit
 * `rejections: [{ name, message, txid }]`; die Mutationen im Request tragen dieselbe `txid`. Das Addon wertet
 * `rejections` nicht aus und rollt die Datensätze lokal still zurück – daher diese Zuordnung (rein, ohne I/O).
 */

export type MutationType = 'insert' | 'upsert' | 'update' | 'delete';

export interface RejectedChange {
  table: string;
  key: string;
  /** Erste abgelehnte Operation auf dem Schlüssel (insert/upsert vor update). */
  type: MutationType;
  /** Geänderte Felder (bei update), sonst leer. */
  props: string[];
  reason: string;
}

export interface ChangeRef {
  table: string;
  key: string;
}

export interface SyncExchangeResult {
  rejected: RejectedChange[];
  /** Vom Server übernommene Schlüssel (alle Transaktionen ohne Ablehnung). */
  accepted: ChangeRef[];
}

interface Mut {
  type: MutationType;
  keys: string[];
  props: string[];
  txid: string | undefined;
}

const TYPES: readonly string[] = ['insert', 'upsert', 'update', 'delete'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const txidOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function readChanges(request: unknown): { table: string; mut: Mut }[] {
  if (!isRecord(request) || !Array.isArray(request['changes'])) return [];
  const out: { table: string; mut: Mut }[] = [];
  for (const set of request['changes']) {
    if (!isRecord(set) || typeof set['table'] !== 'string' || !Array.isArray(set['muts'])) continue;
    for (const m of set['muts']) {
      if (!isRecord(m) || typeof m['type'] !== 'string' || !TYPES.includes(m['type']) || !Array.isArray(m['keys'])) continue;
      const specs = Array.isArray(m['changeSpecs']) ? m['changeSpecs'] : [];
      const props = [...new Set(specs.flatMap((s) => (isRecord(s) ? Object.keys(s) : [])))];
      const keys = m['keys'].filter((k): k is string => typeof k === 'string');
      out.push({ table: set['table'], mut: { type: m['type'] as MutationType, keys, props, txid: txidOf(m['txid']) } });
    }
  }
  return out;
}

function readRejections(response: unknown): { txid: string | undefined; reason: string }[] {
  if (!isRecord(response) || !Array.isArray(response['rejections'])) return [];
  return response['rejections'].filter(isRecord).map((r) => ({
    txid: txidOf(r['txid']),
    reason: typeof r['message'] === 'string' ? r['message'] : typeof r['name'] === 'string' ? r['name'] : 'rejected',
  }));
}

/** Ordnet die Ablehnungen einer Sync-Antwort den Datensätzen des zugehörigen Requests zu. */
export function analyzeSyncExchange(request: unknown, response: unknown): SyncExchangeResult {
  const changes = readChanges(request);
  const rejections = readRejections(response);
  const reasonOf = (txid: string | undefined): string | undefined =>
    rejections.find((r) => r.txid === undefined || r.txid === txid)?.reason;

  const rejected = new Map<string, RejectedChange>();
  const accepted = new Map<string, ChangeRef>();
  for (const { table, mut } of changes) {
    const reason = reasonOf(mut.txid);
    for (const key of mut.keys) {
      const id = `${table}\u0000${key}`;
      if (reason === undefined) {
        accepted.set(id, { table, key });
        continue;
      }
      const prev = rejected.get(id);
      if (prev) prev.props = [...new Set([...prev.props, ...mut.props])];
      else rejected.set(id, { table, key, type: mut.type, props: [...mut.props], reason });
    }
  }
  for (const id of rejected.keys()) accepted.delete(id);
  return { rejected: [...rejected.values()], accepted: [...accepted.values()] };
}

/** Sync-Body (TSON = JSON mit `$t`-markierten Werten) lesen; undefined bei Fehlern. */
export function parseSyncJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Kurzer deutscher Grund für die UI. */
export function describeRejection(reason: string): string {
  if (/not authorized|PermissionsDenied/i.test(reason)) return 'Schreibrechte noch nicht wirksam';
  if (/duplicate key|unique constraint/i.test(reason)) return 'Datensatz existiert bereits in der Cloud';
  return 'vom Server abgelehnt';
}
