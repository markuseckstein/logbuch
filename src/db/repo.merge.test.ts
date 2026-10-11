import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addBoat, addCrewMember, addPhotosToDayReport, addPhotosToEntry, addTrack, createEntry, createTrip, deleteEntry,
  getDayReport, getTrip, listBoats, listCrew, listDayReports, listEntries, listTracks, loadTripData, mergeBundle, setAuthor,
  updateBoat, updateEntry, updateTrip, upsertDayReport,
} from './repo';
import { dispose, firstBoat, freshDb, tripInput } from './test-helpers';

let a: LogbookDB;
let b: LogbookDB;
beforeEach(() => { a = freshDb(); b = freshDb(); });
afterEach(async () => { await dispose(a); await dispose(b); });

const photo = (n: number, hash = `h${n}`) => ({ blob: new Blob([String(n)]), mime: 'image/jpeg', width: 1, height: 1, hash });
const DAY = '2026-07-01';
const T0 = Date.UTC(2026, 6, 1, 10);

let boatId: string;

async function seedA() {
  const trip = await createTrip(a, tripInput('Boot', ['B']));
  boatId = await firstBoat(a, trip.id);
  const crew = (id: string, name: string) => ({ id, tripId: trip.id, name, createdAt: 1, updatedAt: 1, updatedBy: 'x' });
  await a.crewMembers.bulkAdd([crew('c1', 'Ann'), crew('c2', 'Ben')]);
  return trip;
}

/** B receives A's trip as its own boat. */
async function shareToB(tripId: string) {
  return mergeBundle(b, await loadTripData(a, tripId));
}

describe('mergeBundle: unknown trip', () => {
  it('creates the trip and reports a summary', async () => {
    const trip = await seedA();
    await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    await upsertDayReport(a, trip.id, DAY, { text: 'x' });
    await addTrack(a, trip.id, { boatId, name: 'k', source: 'gpx', points: [] });
    const summary = await shareToB(trip.id);
    expect(summary).toEqual({ tripId: trip.id, tripCreated: true, added: 3, updated: 0, deleted: 0, photosAdded: 0 });
    expect(await listEntries(b, trip.id)).toHaveLength(1);
    expect((await listBoats(b, trip.id)).map((x) => x.id)).toEqual([boatId]);
  });
});

describe('mergeBundle: known trip', () => {
  it('merges new, changed and deleted records', async () => {
    const trip = await seedA();
    const e1 = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    const e2 = await createEntry(a, trip.id, { boatId, time: T0 + 1, tzOffsetMin: 0 });
    await shareToB(trip.id);
    await updateEntry(a, e1.id, { text: 'geändert auf A' });
    await deleteEntry(a, e2.id);
    await createEntry(a, trip.id, { boatId, time: T0 + 2, tzOffsetMin: 0 });
    const summary = await mergeBundle(b, await loadTripData(a, trip.id));
    expect(summary).toMatchObject({ tripCreated: false, added: 1, updated: 1, deleted: 1 });
    expect((await listEntries(b, trip.id)).map((e) => e.text)).toEqual(['geändert auf A', undefined]);
  });
  it('is idempotent: second merge changes nothing', async () => {
    const trip = await seedA();
    await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    await shareToB(trip.id);
    const bundle = await loadTripData(a, trip.id);
    const before = await loadTripData(b, trip.id);
    const again = await mergeBundle(b, bundle);
    expect(again).toEqual({ tripId: trip.id, tripCreated: false, added: 0, updated: 0, deleted: 0, photosAdded: 0 });
    expect(await loadTripData(b, trip.id)).toEqual(before);
  });
  it('keeps a newer local edit against an older incoming one, and local tombstones against older edits', async () => {
    const trip = await seedA();
    const e1 = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    const e2 = await createEntry(a, trip.id, { boatId, time: T0 + 1, tzOffsetMin: 0 });
    await shareToB(trip.id);
    await updateEntry(a, e1.id, { text: 'alt' });
    await updateEntry(a, e2.id, { text: 'alt2' });
    const stale = await loadTripData(a, trip.id);
    await updateEntry(b, e1.id, { text: 'neuer auf B' });
    await deleteEntry(b, e2.id);
    await mergeBundle(b, stale); // stale has older-or-equal versions? ensure B's later writes win
    expect((await listEntries(b, trip.id)).map((e) => e.text)).toEqual(['neuer auf B']);
  });
  it('merges trip fields (newer wins), boats and crew per record', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    const cem = await addCrewMember(a, trip.id, { name: 'Cem', email: 'cem@x.de' });
    const moewe = await addBoat(a, trip.id, { name: 'Möwe' });
    await updateBoat(b, boatId, { model: 'Bavaria 37' });
    await updateTrip(a, trip.id, { area: 'Ostsee' });
    await mergeBundle(b, await loadTripData(a, trip.id));
    expect((await getTrip(b, trip.id))!.area).toBe('Ostsee');
    expect((await listCrew(b, trip.id)).map((c) => c.id)).toEqual(['c1', 'c2', cem.id]);
    expect((await listBoats(b, trip.id)).map((x) => [x.name, x.model])).toEqual([['B', 'Bavaria 37'], ['Möwe', undefined]]);
    expect(moewe.colorIndex).toBe(2);
  });
  it('keeps both authors’ day report sections of the same day', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    await setAuthor(a, trip.id, 'c1');
    await upsertDayReport(a, trip.id, DAY, { text: 'von Ann' });
    await setAuthor(b, trip.id, 'c2');
    await upsertDayReport(b, trip.id, DAY, { text: 'von Ben' });
    await mergeBundle(b, await loadTripData(a, trip.id));
    expect((await listDayReports(b, trip.id)).map((r) => [r.authorId, r.text])).toEqual([['c1', 'von Ann'], ['c2', 'von Ben']]);
    expect((await getDayReport(b, trip.id, DAY))!.text).toBe('von Ben');
  });
});

describe('mergeBundle: photos', () => {
  it('inserts unknown photos and counts them', async () => {
    const trip = await seedA();
    const e = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    await addPhotosToEntry(a, e.id, [photo(1), photo(2)]);
    const summary = await shareToB(trip.id);
    expect(summary.photosAdded).toBe(2);
    expect(await b.photos.count()).toBe(2);
  });
  it('dedups the same photo (hash) on the same day onto one id on both sides', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    const ea = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    const eb = await createEntry(b, trip.id, { boatId, time: T0 + 5, tzOffsetMin: 0 });
    const [pa] = await addPhotosToEntry(a, ea.id, [photo(1, 'same')]);
    const [pb] = await addPhotosToEntry(b, eb.id, [photo(2, 'same')]);
    const bundleA = await loadTripData(a, trip.id);
    const bundleB = await loadTripData(b, trip.id);
    await mergeBundle(a, bundleB);
    await mergeBundle(b, bundleA);
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
    const ea = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    const eb = await createEntry(b, trip.id, { boatId, time: T0 + 2 * 86400000, tzOffsetMin: 0 });
    await addPhotosToEntry(a, ea.id, [photo(1, 'same')]);
    await addPhotosToEntry(b, eb.id, [photo(2, 'same')]);
    await mergeBundle(b, await loadTripData(a, trip.id));
    expect(await b.photos.count()).toBe(2);
  });
  it('photos missing from the bundle (export without photos) keep their reference', async () => {
    const trip = await seedA();
    const e = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
    const [p] = await addPhotosToEntry(a, e.id, [photo(1)]);
    const full = await loadTripData(a, trip.id);
    const { photos, ...rest } = full;
    await mergeBundle(b, { ...rest, photos: [], missingPhotos: photos.map(({ blob, ...meta }) => { void blob; return meta; }) });
    expect((await listEntries(b, trip.id))[0]!.photoIds).toEqual([p!.id]);
    expect(await b.photos.count()).toBe(0);
    // later full import fills the photo in
    const summary = await mergeBundle(b, full);
    expect(summary.photosAdded).toBe(1);
    expect(await b.photos.get(p!.id)).toBeDefined();
  });
  it('day photo adds on both sides stay within sections and survive merge', async () => {
    const trip = await seedA();
    await shareToB(trip.id);
    await setAuthor(a, trip.id, 'c1');
    await addPhotosToDayReport(a, trip.id, DAY, [photo(1)]);
    await mergeBundle(b, await loadTripData(a, trip.id));
    expect((await listDayReports(b, trip.id))[0]!.photoIds).toHaveLength(1);
    expect(await listTracks(b, trip.id)).toEqual([]);
  });
});
