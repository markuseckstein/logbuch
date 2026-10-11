import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addPhotoToEntry, addTrack, appendTrackPoints, createEntry, createTrip, loadTripData, mergeBundle,
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

describe('loadTripData', () => {
  it('roundtrips a trip bundle (crew, track chunks) into another DB keeping ids', async () => {
    const { trip } = await seed();
    const bundle = await loadTripData(db, trip.id);
    expect(bundle.entries.map((e) => e.time)).toEqual([100, 200]);
    expect(bundle.photos).toHaveLength(1);
    expect(bundle.crew.map((c) => c.name)).toEqual(['Anna']);
    expect(bundle.trackChunks.flatMap((c) => c.points)).toEqual([{ lat: 1, lon: 2, time: 5 }]);
    await mergeBundle(target, bundle, { ownership: 'own' });
    const again = await loadTripData(target, trip.id);
    expect(again.trip).toEqual(bundle.trip);
    expect(again.crew).toEqual(bundle.crew);
    expect(again.entries).toEqual(bundle.entries);
    expect(again.dayReports).toEqual(bundle.dayReports);
    expect(again.tracks).toEqual(bundle.tracks);
    expect(again.trackChunks).toEqual(bundle.trackChunks);
    expect(again.photos.map((p) => p.id)).toEqual(bundle.photos.map((p) => p.id));
  });

  it('track chunks appended on two devices both survive the merge', async () => {
    const { trip } = await seed();
    const [track] = (await loadTripData(db, trip.id)).tracks;
    await mergeBundle(target, await loadTripData(db, trip.id), { ownership: 'own' });
    await appendTrackPoints(db, track!.id, [{ lat: 2, lon: 2, time: 10 }]);
    await appendTrackPoints(target, track!.id, [{ lat: 3, lon: 3, time: 20 }]);
    await mergeBundle(db, await loadTripData(target, trip.id), { ownership: 'own' });
    await mergeBundle(target, await loadTripData(db, trip.id), { ownership: 'own' });
    const pts = (b: Awaited<ReturnType<typeof loadTripData>>) => b.trackChunks.flatMap((c) => c.points).map((p) => p.lat).sort();
    expect(pts(await loadTripData(db, trip.id))).toEqual([1, 2, 3]);
    expect(pts(await loadTripData(target, trip.id))).toEqual([1, 2, 3]);
  });

  it('loadTripData throws for unknown trip', async () => {
    await expect(loadTripData(db, 'nope')).rejects.toThrow();
  });
});
