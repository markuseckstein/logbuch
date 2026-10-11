import { describe, expect, it } from 'vitest';
import { activeCrew, dayReportKey, isNewer, mergeRecords, mergeTrip, remapPhotoIds } from './merge';
import type { DayReport, LogEntry, Trip } from './types';

const v = (updatedAt: number, updatedBy = 'A', deletedAt?: number) => ({
  updatedAt, updatedBy, ...(deletedAt !== undefined ? { deletedAt } : {}),
});

function entry(id: string, version = v(1), extra: Partial<LogEntry> = {}): LogEntry {
  return { id, tripId: 't', time: 0, tzOffsetMin: 0, type: 'note', photoIds: [], createdAt: 1, ...version, ...extra };
}

function report(date: string, authorId: string, version = v(1), extra: Partial<DayReport> = {}): DayReport {
  return { tripId: 't', date, authorId, text: '', photoIds: [], ...version, ...extra };
}

function trip(version = v(1), extra: Partial<Trip> = {}): Trip {
  return { id: 't', name: 'T', boat: { name: 'B' }, crew: [], createdAt: 1, ...version, ...extra };
}

describe('isNewer', () => {
  it('compares updatedAt first', () => {
    expect(isNewer(v(2, 'A'), v(1, 'Z'))).toBe(true);
    expect(isNewer(v(1, 'Z'), v(2, 'A'))).toBe(false);
  });
  it('breaks ties with updatedBy lexicographically', () => {
    expect(isNewer(v(5, 'B'), v(5, 'A'))).toBe(true);
    expect(isNewer(v(5, 'A'), v(5, 'B'))).toBe(false);
  });
  it('is false for identical versions', () => {
    expect(isNewer(v(5, 'A'), v(5, 'A'))).toBe(false);
  });
  it('treats missing version fields (legacy crew) as oldest', () => {
    expect(isNewer({ updatedAt: 1, updatedBy: 'A' }, {})).toBe(true);
    expect(isNewer({}, { updatedAt: 1 })).toBe(false);
  });
});

describe('mergeRecords', () => {
  it('adds unknown records and counts them', () => {
    const r = mergeRecords([entry('a')], [entry('a'), entry('b')]);
    expect(r.toPut.map((e) => e.id)).toEqual(['b']);
    expect(r.stats).toEqual({ added: 1, updated: 0, deleted: 0 });
  });
  it('newer incoming version wins', () => {
    const r = mergeRecords([entry('a', v(1), { text: 'old' })], [entry('a', v(2), { text: 'new' })]);
    expect(r.toPut).toEqual([entry('a', v(2), { text: 'new' })]);
    expect(r.stats).toEqual({ added: 0, updated: 1, deleted: 0 });
  });
  it('older or equal incoming is ignored', () => {
    const local = [entry('a', v(2), { text: 'mine' })];
    expect(mergeRecords(local, [entry('a', v(1), { text: 'x' })]).toPut).toEqual([]);
    expect(mergeRecords(local, [entry('a', v(2), { text: 'x' })]).toPut).toEqual([]);
  });
  it('a newer tombstone wins and counts as deleted', () => {
    const r = mergeRecords([entry('a', v(1))], [entry('a', v(2), { deletedAt: 2 })]);
    expect(r.toPut).toHaveLength(1);
    expect(r.toPut[0]!.deletedAt).toBe(2);
    expect(r.stats).toEqual({ added: 0, updated: 0, deleted: 1 });
  });
  it('an older tombstone does not delete a newer edit', () => {
    const r = mergeRecords([entry('a', v(5), { text: 'edited' })], [entry('a', v(3), { deletedAt: 3 })]);
    expect(r.toPut).toEqual([]);
  });
  it('a newer edit revives a local tombstone', () => {
    const r = mergeRecords([entry('a', v(2), { deletedAt: 2 })], [entry('a', v(3))]);
    expect(r.toPut).toHaveLength(1);
    expect(r.stats).toEqual({ added: 0, updated: 1, deleted: 0 });
  });
  it('unknown incoming tombstone is stored but not counted as added', () => {
    const r = mergeRecords([], [entry('a', v(2), { deletedAt: 2 })]);
    expect(r.toPut).toHaveLength(1);
    expect(r.stats).toEqual({ added: 0, updated: 0, deleted: 0 });
  });
  it('tie on updatedAt is decided by updatedBy', () => {
    const local = [entry('a', v(5, 'A'), { text: 'a' })];
    expect(mergeRecords(local, [entry('a', v(5, 'B'), { text: 'b' })]).toPut).toHaveLength(1);
    const local2 = [entry('a', v(5, 'B'), { text: 'b' })];
    expect(mergeRecords(local2, [entry('a', v(5, 'A'), { text: 'a' })]).toPut).toEqual([]);
  });
  it('supports custom keys (day reports per author)', () => {
    const local = [report('2026-07-01', 'ann', v(1), { text: 'ann' })];
    const incoming = [report('2026-07-01', 'ben', v(1), { text: 'ben' })];
    const r = mergeRecords(local, incoming, dayReportKey);
    expect(r.toPut.map((x) => x.authorId)).toEqual(['ben']);
    expect(r.stats.added).toBe(1);
  });
});

function apply<T extends { updatedAt: number; updatedBy: string }>(
  local: T[], incoming: T[], keyOf: (t: T) => string,
): T[] {
  const map = new Map(local.map((r) => [keyOf(r), r]));
  for (const r of mergeRecords(local, incoming, keyOf).toPut) map.set(keyOf(r), r);
  return [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

describe('mergeRecords properties', () => {
  const a = [entry('1', v(1, 'A')), entry('2', v(4, 'A', 4), { deletedAt: 4 }), entry('3', v(3, 'A'), { text: 'a3' })];
  const b = [entry('2', v(2, 'B'), { text: 'b2' }), entry('3', v(3, 'B'), { text: 'b3' }), entry('4', v(1, 'B'))];
  const key = (e: LogEntry) => e.id;

  it('is idempotent: merging twice changes nothing', () => {
    const once = apply(a, b, key);
    expect(mergeRecords(once, b, key).toPut).toEqual([]);
    expect(apply(once, b, key)).toEqual(once);
  });
  it('is commutative: A<-B equals B<-A', () => {
    expect(apply(a, b, key)).toEqual(apply(b, a, key));
  });
  it('the deterministic outcome keeps the tombstone and the tie winner', () => {
    const merged = apply(a, b, key);
    expect(merged.find((e) => e.id === '2')!.deletedAt).toBe(4);
    expect(merged.find((e) => e.id === '3')!.text).toBe('b3');
  });
});

describe('mergeTrip', () => {
  it('takes trip fields of the newer version (LWW)', () => {
    const merged = mergeTrip(trip(v(1), { name: 'old' }), trip(v(2, 'B'), { name: 'new', area: 'Ostsee' }));
    expect(merged.name).toBe('new');
    expect(merged.area).toBe('Ostsee');
    expect(merged.updatedAt).toBe(2);
    expect(mergeTrip(trip(v(2), { name: 'mine' }), trip(v(1), { name: 'x' })).name).toBe('mine');
  });
  it('merges flotilla via LWW, including leaving it', () => {
    const joined = mergeTrip(trip(v(1)), trip(v(2), { flotilla: { id: 'f', name: 'F' } }));
    expect(joined.flotilla).toEqual({ id: 'f', name: 'F' });
    const left = mergeTrip(joined, trip(v(3)));
    expect(left.flotilla).toBeUndefined();
  });
  it('merges crew per member with LWW, keeping members of both sides', () => {
    const local = trip(v(5, 'A'), { crew: [
      { id: 'c1', name: 'Ann', updatedAt: 1, updatedBy: 'A' },
      { id: 'c2', name: 'Ben old', updatedAt: 1, updatedBy: 'A' },
    ] });
    const incoming = trip(v(2, 'B'), { crew: [
      { id: 'c2', name: 'Ben new', updatedAt: 3, updatedBy: 'B' },
      { id: 'c3', name: 'Cem', updatedAt: 2, updatedBy: 'B' },
    ] });
    const merged = mergeTrip(local, incoming);
    expect(merged.name).toBe(local.name);
    expect(merged.crew.map((c) => [c.id, c.name])).toEqual([['c1', 'Ann'], ['c2', 'Ben new'], ['c3', 'Cem']]);
  });
  it('a newer crew tombstone hides the member, an older one does not', () => {
    const local = trip(v(1), { crew: [{ id: 'c1', name: 'Ann', updatedAt: 2, updatedBy: 'A' }] });
    const del = trip(v(1), { crew: [{ id: 'c1', name: 'Ann', updatedAt: 3, updatedBy: 'B', deletedAt: 3 }] });
    expect(activeCrew(mergeTrip(local, del))).toEqual([]);
    const oldDel = trip(v(1), { crew: [{ id: 'c1', name: 'Ann', updatedAt: 1, updatedBy: 'B', deletedAt: 1 }] });
    expect(activeCrew(mergeTrip(local, oldDel)).map((c) => c.id)).toEqual(['c1']);
  });
  it('keeps the earliest createdAt', () => {
    expect(mergeTrip(trip(v(1), { createdAt: 9 }), trip(v(2), { createdAt: 4 })).createdAt).toBe(4);
  });
  it('is idempotent and commutative', () => {
    const a = trip(v(5, 'A'), { name: 'a', crew: [{ id: 'c1', name: 'Ann', updatedAt: 1, updatedBy: 'A' }] });
    const b = trip(v(6, 'B'), { name: 'b', crew: [
      { id: 'c1', name: 'Anna', updatedAt: 2, updatedBy: 'B' }, { id: 'c2', name: 'Ben' },
    ] });
    expect(mergeTrip(a, b)).toEqual(mergeTrip(b, a));
    expect(mergeTrip(mergeTrip(a, b), b)).toEqual(mergeTrip(a, b));
    expect(mergeTrip(mergeTrip(a, b), a)).toEqual(mergeTrip(a, b));
  });
});

describe('activeCrew', () => {
  it('filters tombstones', () => {
    const t = trip(v(1), { crew: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', deletedAt: 1 }] });
    expect(activeCrew(t).map((c) => c.id)).toEqual(['a']);
  });
});

describe('remapPhotoIds', () => {
  const t0 = Date.UTC(2026, 6, 1, 10); // 2026-07-01
  const photos = [
    { id: 'p-a', hash: 'H' }, { id: 'p-b', hash: 'H' }, { id: 'p-c', hash: 'X' }, { id: 'p-n' },
  ];

  it('rewrites duplicates (same hash, same day) to the smallest id', () => {
    const entries = [entry('e1', v(1), { time: t0, photoIds: ['p-b', 'p-c'] })];
    const reports = [report('2026-07-01', 'ann', v(1), { photoIds: ['p-a'] })];
    const r = remapPhotoIds({ entries, dayReports: reports, photos });
    expect(r.remap).toEqual({ 'p-b': 'p-a' });
    expect(r.entries[0]!.photoIds).toEqual(['p-a', 'p-c']);
    expect(r.dayReports[0]!.photoIds).toEqual(['p-a']);
  });
  it('does not touch the same hash on different days', () => {
    const entries = [
      entry('e1', v(1), { time: t0, photoIds: ['p-a'] }),
      entry('e2', v(1), { time: t0 + 2 * 86400000, photoIds: ['p-b'] }),
    ];
    const r = remapPhotoIds({ entries, dayReports: [], photos });
    expect(r.remap).toEqual({});
    expect(r.entries).toEqual(entries);
  });
  it('uses the local day (tzOffsetMin) of entries', () => {
    const late = Date.UTC(2026, 6, 1, 23, 30); // 01:30 on 07-02 at +120
    const entries = [entry('e1', v(1), { time: late, tzOffsetMin: 120, photoIds: ['p-b'] })];
    const reports = [report('2026-07-02', 'ann', v(1), { photoIds: ['p-a'] })];
    expect(remapPhotoIds({ entries, dayReports: reports, photos }).remap).toEqual({ 'p-b': 'p-a' });
  });
  it('removes duplicate ids inside one record and keeps unchanged records by reference', () => {
    const e1 = entry('e1', v(1), { time: t0, photoIds: ['p-a', 'p-b'] });
    const e2 = entry('e2', v(1), { time: t0, photoIds: ['p-c'] });
    const r = remapPhotoIds({ entries: [e1, e2], dayReports: [], photos });
    expect(r.entries[0]!.photoIds).toEqual(['p-a']);
    expect(r.entries[1]).toBe(e2);
  });
  it('ignores photos without hash and unknown photo ids', () => {
    const entries = [entry('e1', v(1), { time: t0, photoIds: ['p-n', 'p-zzz'] })];
    expect(remapPhotoIds({ entries, dayReports: [], photos }).remap).toEqual({});
  });
  it('is independent of input order (deterministic) and idempotent', () => {
    const e1 = entry('e1', v(1), { time: t0, photoIds: ['p-b'] });
    const e2 = entry('e2', v(1), { time: t0, photoIds: ['p-a'] });
    const x = remapPhotoIds({ entries: [e1, e2], dayReports: [], photos });
    const y = remapPhotoIds({ entries: [e2, e1], dayReports: [], photos: [...photos].reverse() });
    expect(x.remap).toEqual(y.remap);
    expect(remapPhotoIds({ entries: x.entries, dayReports: [], photos }).remap).toEqual({});
  });
});
