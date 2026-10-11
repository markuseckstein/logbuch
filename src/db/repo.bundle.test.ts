import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addPhotoToEntry, addTrack, createEntry, createTrip, listEntries, loadTripData, replaceTripData,
  upsertDayReport, updateEntry,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
let target: LogbookDB;
beforeEach(() => { db = freshDb(); target = freshDb(); });
afterEach(async () => { await dispose(db); await dispose(target); });

async function seed() {
  const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [{ id: 'c1', name: 'Anna' }] });
  const e2 = await createEntry(db, trip.id, { time: 200, tzOffsetMin: 60 });
  const e1 = await createEntry(db, trip.id, { time: 100, tzOffsetMin: 60, position: { lat: 1, lon: 2 } });
  await updateEntry(db, e1.id, { text: 'eins' });
  await addPhotoToEntry(db, e1.id, { blob: new Blob(['abc']), mime: 'image/jpeg', width: 2, height: 2 });
  await upsertDayReport(db, trip.id, '2026-07-01', { text: 'Bericht' });
  await addTrack(db, trip.id, { name: 'g', source: 'gpx', points: [{ lat: 1, lon: 2, time: 5 }] });
  return { trip, e2 };
}

describe('loadTripData / replaceTripData', () => {
  it('roundtrips a trip bundle into another DB keeping ids', async () => {
    const { trip } = await seed();
    const bundle = await loadTripData(db, trip.id);
    expect(bundle.entries.map((e) => e.time)).toEqual([100, 200]);
    expect(bundle.photos).toHaveLength(1);
    await replaceTripData(target, bundle);
    const again = await loadTripData(target, trip.id);
    expect(again.trip).toEqual(bundle.trip);
    expect(again.entries).toEqual(bundle.entries);
    expect(again.dayReports).toEqual(bundle.dayReports);
    expect(again.tracks).toEqual(bundle.tracks);
    expect(again.photos.map((p) => p.id)).toEqual(bundle.photos.map((p) => p.id));
  });

  it('replaces existing data of the same trip and leaves other trips alone', async () => {
    const { trip } = await seed();
    const bundle = await loadTripData(db, trip.id);
    const other = await createTrip(db, { name: 'O', boat: { name: 'B' }, crew: [] });
    await createEntry(db, other.id, { time: 1, tzOffsetMin: 0 });
    await createEntry(db, trip.id, { time: 999, tzOffsetMin: 0 }); // stale, not in bundle
    await replaceTripData(db, bundle);
    expect((await listEntries(db, trip.id)).map((e) => e.time)).toEqual([100, 200]);
    expect(await listEntries(db, other.id)).toHaveLength(1);
    expect(await db.photos.count()).toBe(1);
  });

  it('loadTripData throws for unknown trip', async () => {
    await expect(loadTripData(db, 'nope')).rejects.toThrow();
  });
});
