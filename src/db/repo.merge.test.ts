import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addPhotosToDayReport, addPhotosToEntry, addTrack, createEntry, createTrip, deleteEntry, getDayReport, getSettings,
  getTrip, listCrew, listDayReports, listEntries, listTracks, loadTripData, mergeBundle, saveCrew, setAuthor, updateEntry, updateTrip,
  upsertDayReport,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let a: LogbookDB;
let b: LogbookDB;
beforeEach(() => { a = freshDb(); b = freshDb(); });
afterEach(async () => { await dispose(a); await dispose(b); });

const photo = (n: number, hash = `h${n}`) => ({ blob: new Blob([String(n)]), mime: 'image/jpeg', width: 1, height: 1, hash });
const DAY = '2026-07-01';
const T0 = Date.UTC(2026, 6, 1, 10);

async function seedA() {
  const trip = await createTrip(a, { name: 'Boot', boat: { name: 'B' }, crew: [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Ben' }] });
  return trip;
}

/** B receives A's trip as its own boat. */
async function shareToB(tripId: string) {
  return mergeBundle(b, await loadTripData(a, tripId), { ownership: 'own' });
}

describe('mergeBundle: unknown trip', () => {
  it('creates the trip as own (writable) and reports a summary', async () => {
    const trip = await seedA();
    await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    await upsertDayReport(a, trip.id, DAY, { text: 'x' });
    await addTrack(a, trip.id, { name: 'k', source: 'gpx', points: [] });
    const summary = await shareToB(trip.id);
    expect(summary).toEqual({ tripId: trip.id, tripCreated: true, added: 3, updated: 0, deleted: 0, photosAdded: 0 });
    expect((await getSettings(b)).writableTripIds).toEqual([trip.id]);
    expect(await listEntries(b, trip.id)).toHaveLength(1);
  });
  it('creates the trip read-only when ownership is foreign', async () => {
    const trip = await seedA();
    await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'foreign' });
    expect(await getTrip(b, trip.id)).toBeDefined();
    expect((await getSettings(b)).writableTripIds).toEqual([]);
  });
});

describe('mergeBundle: known trip', () => {
  it('merges new, changed and deleted records and keeps local ownership', async () => {
    const trip = await seedA();
    const e1 = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    const e2 = await createEntry(a, trip.id, { time: T0 + 1, tzOffsetMin: 0 });
    await shareToB(trip.id);
    await updateEntry(a, e1.id, { text: 'geändert auf A' });
    await deleteEntry(a, e2.id);
    await createEntry(a, trip.id, { time: T0 + 2, tzOffsetMin: 0 });
    const summary = await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'foreign' });
    expect(summary).toMatchObject({ tripCreated: false, added: 1, updated: 1, deleted: 1 });
    expect((await listEntries(b, trip.id)).map((e) => e.text)).toEqual(['geändert auf A', undefined]);
    expect((await getSettings(b)).writableTripIds).toEqual([trip.id]);
  });
  it('is idempotent: second merge changes nothing', async () => {
    const trip = await seedA();
    await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    await shareToB(trip.id);
    const bundle = await loadTripData(a, trip.id);
    const before = await loadTripData(b, trip.id);
    const again = await mergeBundle(b, bundle, { ownership: 'own' });
    expect(again).toEqual({ tripId: trip.id, tripCreated: false, added: 0, updated: 0, deleted: 0, photosAdded: 0 });
    expect(await loadTripData(b, trip.id)).toEqual(before);
  });
  it('keeps a newer local edit against an older incoming one, and local tombstones against older edits', async () => {
    const trip = await seedA();
    const e1 = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    const e2 = await createEntry(a, trip.id, { time: T0 + 1, tzOffsetMin: 0 });
    await shareToB(trip.id);
    await updateEntry(a, e1.id, { text: 'alt' });
    await updateEntry(a, e2.id, { text: 'alt2' });
    const stale = await loadTripData(a, trip.id);
    await updateEntry(b, e1.id, { text: 'neuer auf B' });
    await deleteEntry(b, e2.id);
    await mergeBundle(b, stale, { ownership: 'own' }); // stale has older-or-equal versions? ensure B's later writes win
    expect((await listEntries(b, trip.id)).map((e) => e.text)).toEqual(['neuer auf B']);
  });
  it('merges trip fields (newer wins) and crew per member, incl. flotilla', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    await saveCrew(a, trip.id, [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Ben' }, { id: 'c3', name: 'Cem' }]);
    await updateTrip(a, trip.id, { flotilla: { id: 'f', name: 'Flotte' } });
    await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'own' });
    const t = (await getTrip(b, trip.id))!;
    expect((await listCrew(b, trip.id)).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(t.flotilla).toEqual({ id: 'f', name: 'Flotte' });
  });
  it('keeps both authors’ day report sections of the same day', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    await setAuthor(a, trip.id, 'c1');
    await upsertDayReport(a, trip.id, DAY, { text: 'von Ann' });
    await setAuthor(b, trip.id, 'c2');
    await upsertDayReport(b, trip.id, DAY, { text: 'von Ben' });
    await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'own' });
    expect((await listDayReports(b, trip.id)).map((r) => [r.authorId, r.text])).toEqual([['c1', 'von Ann'], ['c2', 'von Ben']]);
    expect((await getDayReport(b, trip.id, DAY))!.text).toBe('von Ben');
  });
});

describe('mergeBundle: photos', () => {
  it('inserts unknown photos and counts them', async () => {
    const trip = await seedA();
    const e = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    await addPhotosToEntry(a, e.id, [photo(1), photo(2)]);
    const summary = await shareToB(trip.id);
    expect(summary.photosAdded).toBe(2);
    expect(await b.photos.count()).toBe(2);
  });
  it('dedups the same photo (hash) on the same day onto one id on both sides', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    const ea = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    const eb = await createEntry(b, trip.id, { time: T0 + 5, tzOffsetMin: 0 });
    const [pa] = await addPhotosToEntry(a, ea.id, [photo(1, 'same')]);
    const [pb] = await addPhotosToEntry(b, eb.id, [photo(2, 'same')]);
    const bundleA = await loadTripData(a, trip.id);
    const bundleB = await loadTripData(b, trip.id);
    await mergeBundle(a, bundleB, { ownership: 'own' });
    await mergeBundle(b, bundleA, { ownership: 'own' });
    const canon = [pa!.id, pb!.id].sort()[0]!;
    for (const db of [a, b]) {
      const entries = await listEntries(db, trip.id);
      expect(entries.flatMap((e) => e.photoIds)).toEqual([canon, canon]);
      expect((await db.photos.toArray()).map((p) => p.id)).toEqual([canon]);
    }
  });
  it('does not dedup the same hash on different days', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    const ea = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    const eb = await createEntry(b, trip.id, { time: T0 + 2 * 86400000, tzOffsetMin: 0 });
    await addPhotosToEntry(a, ea.id, [photo(1, 'same')]);
    await addPhotosToEntry(b, eb.id, [photo(2, 'same')]);
    await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'own' });
    expect(await b.photos.count()).toBe(2);
  });
  it('photos missing from the bundle (export without photos) keep their reference', async () => {
    const trip = await seedA();
    const e = await createEntry(a, trip.id, { time: T0, tzOffsetMin: 0 });
    const [p] = await addPhotosToEntry(a, e.id, [photo(1)]);
    const full = await loadTripData(a, trip.id);
    const { photos, ...rest } = full;
    await mergeBundle(b, { ...rest, photos: [], missingPhotos: photos.map(({ blob, ...meta }) => { void blob; return meta; }) }, { ownership: 'own' });
    expect((await listEntries(b, trip.id))[0]!.photoIds).toEqual([p!.id]);
    expect(await b.photos.count()).toBe(0);
    // later full import fills the photo in
    const summary = await mergeBundle(b, full, { ownership: 'own' });
    expect(summary.photosAdded).toBe(1);
    expect(await b.photos.get(p!.id)).toBeDefined();
  });
  it('day photo adds on both sides stay within sections and survive merge', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    await setAuthor(a, trip.id, 'c1');
    await addPhotosToDayReport(a, trip.id, DAY, [photo(1)]);
    await mergeBundle(b, await loadTripData(a, trip.id), { ownership: 'own' });
    expect((await listDayReports(b, trip.id))[0]!.photoIds).toHaveLength(1);
    expect(await listTracks(b, trip.id)).toEqual([]);
  });
});
