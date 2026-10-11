import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from './db';
import {
  MAX_PHOTOS_PER_DAY_REPORT, MAX_PHOTOS_PER_ENTRY, MaxPhotosError, addPhotosToDayReport, addPhotosToEntry,
  createEntry, createTrip, dayPhotoHashes, deleteTrip, getDayReport, getPhoto, listEntries, loadTripData,
  removePhotoFromDayReport, mergeBundle, upsertDayReport,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
let tripId: string;
beforeEach(async () => {
  db = freshDb();
  tripId = (await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] })).id;
});
afterEach(async () => { await dispose(db); });

const ph = (hash: string) => ({ blob: new Blob([hash]), mime: 'image/jpeg', width: 2, height: 2, hash });
const DAY = Date.UTC(2026, 7, 10, 12, 0); // tz +120 -> 2026-08-10
const date = '2026-08-10';

describe('limits', () => {
  it('allows 5 photos per entry and 15 per day report', () => {
    expect(MAX_PHOTOS_PER_ENTRY).toBe(5);
    expect(MAX_PHOTOS_PER_DAY_REPORT).toBe(15);
  });
});

describe('addPhotosToEntry', () => {
  it('stores several photos with hash and links them in order', async () => {
    const e = await createEntry(db, tripId, { time: DAY, tzOffsetMin: 120 });
    const added = await addPhotosToEntry(db, e.id, [ph('a'), ph('b')]);
    expect(added.map((p) => p.hash)).toEqual(['a', 'b']);
    expect((await listEntries(db, tripId))[0]?.photoIds).toEqual(added.map((p) => p.id));
    expect((await getPhoto(db, added[0]!.id))?.hash).toBe('a');
  });
  it('is atomic: exceeding the limit stores nothing', async () => {
    const e = await createEntry(db, tripId, { time: DAY, tzOffsetMin: 120 });
    await addPhotosToEntry(db, e.id, [ph('a'), ph('b'), ph('c')]);
    await expect(addPhotosToEntry(db, e.id, [ph('d'), ph('e'), ph('f')])).rejects.toBeInstanceOf(MaxPhotosError);
    expect(await db.photos.count()).toBe(3);
  });
});

describe('day report photos', () => {
  it('creates the report with empty text if missing', async () => {
    const added = await addPhotosToDayReport(db, tripId, date, [ph('a')]);
    const r = await getDayReport(db, tripId, date);
    expect(r).toMatchObject({ text: '', photoIds: [added[0]!.id] });
  });
  it('keeps text and photos when the report text is saved', async () => {
    const added = await addPhotosToDayReport(db, tripId, date, [ph('a')]);
    await upsertDayReport(db, tripId, date, { text: 'Hallo' });
    expect(await getDayReport(db, tripId, date)).toMatchObject({ text: 'Hallo', photoIds: [added[0]!.id] });
  });
  it('rejects more than 15 photos atomically', async () => {
    await addPhotosToDayReport(db, tripId, date, Array.from({ length: 14 }, (_, i) => ph(`h${i}`)));
    await expect(addPhotosToDayReport(db, tripId, date, [ph('x'), ph('y')])).rejects.toBeInstanceOf(MaxPhotosError);
    expect(await db.photos.count()).toBe(14);
  });
  it('removes a photo from report and DB', async () => {
    const [a, b] = await addPhotosToDayReport(db, tripId, date, [ph('a'), ph('b')]);
    await removePhotoFromDayReport(db, tripId, date, a!.id);
    expect(await getPhoto(db, a!.id)).toBeUndefined();
    expect((await getDayReport(db, tripId, date))?.photoIds).toEqual([b!.id]);
  });
  it('deleteTrip removes report photos', async () => {
    await addPhotosToDayReport(db, tripId, date, [ph('a')]);
    await deleteTrip(db, tripId);
    expect(await db.photos.count()).toBe(0);
  });
  it('survives a bundle roundtrip', async () => {
    await addPhotosToDayReport(db, tripId, date, [ph('a')]);
    const bundle = await loadTripData(db, tripId);
    await mergeBundle(db, bundle, { ownership: 'own' });
    expect((await getDayReport(db, tripId, date))?.photoIds).toHaveLength(1);
    expect(await db.photos.count()).toBe(1);
  });
});

describe('dayPhotoHashes', () => {
  it('collects hashes of entries of that day (by local date) and the report', async () => {
    const e = await createEntry(db, tripId, { time: DAY, tzOffsetMin: 120 });
    // 2026-08-10T23:30Z with +120 is already 2026-08-11 locally
    const late = await createEntry(db, tripId, { time: Date.UTC(2026, 7, 10, 23, 30), tzOffsetMin: 120 });
    await addPhotosToEntry(db, e.id, [ph('a')]);
    await addPhotosToEntry(db, late.id, [ph('late')]);
    await addPhotosToDayReport(db, tripId, date, [ph('r')]);
    expect(await dayPhotoHashes(db, tripId, date)).toEqual(new Set(['a', 'r']));
    expect(await dayPhotoHashes(db, tripId, '2026-08-11')).toEqual(new Set(['late']));
  });
  it('ignores photos without hash', async () => {
    const e = await createEntry(db, tripId, { time: DAY, tzOffsetMin: 120 });
    await addPhotosToEntry(db, e.id, [{ blob: new Blob(['x']), mime: 'image/jpeg', width: 1, height: 1 }]);
    expect((await dayPhotoHashes(db, tripId, date)).size).toBe(0);
  });
});
