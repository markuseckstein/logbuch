import { localDate } from './days';
import type { CloudFields, CrewMember, DayReport, ID, LogEntry, Trip, Versioned } from './types';

/** Minimal version info; legacy records (e.g. old crew members) may lack it and count as oldest. */
export interface VersionLike {
  updatedAt?: number;
  updatedBy?: string;
}

/** True if `a` is strictly newer than `b`: (updatedAt, updatedBy) compared lexicographically. */
export function isNewer(a: VersionLike, b: VersionLike): boolean {
  const at = a.updatedAt ?? 0;
  const bt = b.updatedAt ?? 0;
  if (at !== bt) return at > bt;
  return (a.updatedBy ?? '') > (b.updatedBy ?? '');
}

export interface MergeStats {
  added: number;
  updated: number;
  deleted: number;
}

export interface MergeResult<T> {
  /** Incoming records that must be written (new or newer than the local version). */
  toPut: T[];
  stats: MergeStats;
}

/** Per-record last-writer-wins merge; tombstones take part like any other version. */
export function mergeRecords<T extends Versioned>(
  local: readonly T[], incoming: readonly T[], keyOf: (r: T) => string = (r) => (r as unknown as { id: ID }).id,
): MergeResult<T> {
  const byKey = new Map(local.map((r) => [keyOf(r), r]));
  const toPut: T[] = [];
  const stats: MergeStats = { added: 0, updated: 0, deleted: 0 };
  for (const rec of incoming) {
    const mine = byKey.get(keyOf(rec));
    if (!mine) {
      toPut.push(rec);
      if (rec.deletedAt === undefined) stats.added += 1;
    } else if (isNewer(rec, mine)) {
      toPut.push(rec);
      if (rec.deletedAt !== undefined) {
        if (mine.deletedAt === undefined) stats.deleted += 1;
      } else {
        stats.updated += 1;
      }
    }
  }
  return { toPut, stats };
}

/** Crew without tombstones. */
export function activeCrew(crew: readonly CrewMember[]): CrewMember[] {
  return crew.filter((c) => c.deletedAt === undefined);
}

/** Record without the user-specific Dexie Cloud fields. */
export function withoutCloudFields<T extends CloudFields>(rec: T): Omit<T, 'realmId' | 'owner'> {
  const copy: T = { ...rec };
  delete copy.realmId;
  delete copy.owner;
  return copy;
}

/**
 * Merges two versions of the same trip: trip fields (incl. flotilla) from the newer version (LWW),
 * earliest createdAt. Cloud fields (realmId/owner) stay those of the local copy. Commutative and idempotent.
 */
export function mergeTrip(local: Trip, incoming: Trip): Trip {
  const a = withoutCloudFields(local);
  const b = withoutCloudFields(incoming);
  const sameVersion = !isNewer(b, a) && !isNewer(a, b);
  const winner = isNewer(b, a) || (sameVersion && JSON.stringify(b) > JSON.stringify(a)) ? b : a;
  const out: Trip = { ...winner, createdAt: Math.min(local.createdAt, incoming.createdAt) };
  if (local.realmId !== undefined) out.realmId = local.realmId;
  if (local.owner !== undefined) out.owner = local.owner;
  return out;
}

export interface RemapInput {
  entries: readonly LogEntry[];
  dayReports: readonly DayReport[];
  /** All known photos (metadata is enough). */
  photos: readonly { id: ID; hash?: string }[];
}

export interface RemapResult {
  entries: LogEntry[];
  dayReports: DayReport[];
  /** duplicate id -> canonical id */
  remap: Record<ID, ID>;
}

/**
 * Photo dedup after a merge: photos with the same hash referenced on the same calendar day
 * collapse onto the smallest id (deterministic on every device). Unchanged records are
 * returned by reference; changed ones keep their version (no bump).
 */
export function remapPhotoIds({ entries, dayReports, photos }: RemapInput): RemapResult {
  const hashOf = new Map<ID, string>();
  for (const p of photos) if (p.hash) hashOf.set(p.id, p.hash);

  const dayOf = (e: LogEntry) => localDate(e.time, e.tzOffsetMin);
  const canonical = new Map<string, ID>(); // `${date}|${hash}` -> smallest id
  const note = (date: string, ids: readonly ID[]) => {
    for (const id of ids) {
      const hash = hashOf.get(id);
      if (!hash) continue;
      const k = `${date}|${hash}`;
      const cur = canonical.get(k);
      if (cur === undefined || id < cur) canonical.set(k, id);
    }
  };
  for (const e of entries) note(dayOf(e), e.photoIds);
  for (const r of dayReports) note(r.date, r.photoIds);

  const remap: Record<ID, ID> = {};
  const rewrite = (date: string, ids: readonly ID[]): ID[] | undefined => {
    let changed = false;
    const out: ID[] = [];
    for (const id of ids) {
      const hash = hashOf.get(id);
      const target = hash ? canonical.get(`${date}|${hash}`) ?? id : id;
      if (target !== id) {
        remap[id] = target;
        changed = true;
      }
      if (out.includes(target)) changed = true;
      else out.push(target);
    }
    return changed ? out : undefined;
  };

  return {
    entries: entries.map((e) => {
      const ids = rewrite(dayOf(e), e.photoIds);
      return ids ? { ...e, photoIds: ids } : e;
    }),
    dayReports: dayReports.map((r) => {
      const ids = rewrite(r.date, r.photoIds);
      return ids ? { ...r, photoIds: ids } : r;
    }),
    remap,
  };
}
