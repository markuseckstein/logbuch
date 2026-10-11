import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeCrew } from '../domain/merge';
import type { LogbookDB } from './db';
import {
  MaxPhotosError, ReadOnlyTripError, addPhotosToDayReport, addPhotosToEntry, addTrack, appendTrackPoints,
  createEntry, createTrip, deleteEntry, deleteTrack, deleteTrip, getAuthor, getDayReport, getDeviceId, getSettings,
  getTrip, linkCrewEmail, listCrew, listDayReports, listEntries, listFlotillaTrips, listTracks, loadTripData,
  removePhotoFromDayReport, saveCrew, setAuthor, setEntryPosition, setFlotilla, setTripOwnership, updateEntry,
  resetDeviceIdCache, updateTrip, upsertDayReport,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const photo = (n = 0) => ({ blob: new Blob([String(n)]), mime: 'image/jpeg', width: 1, height: 1, hash: `h${n}` });
const newTrip = (name = 'T', crew = [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Ben' }]) =>
  createTrip(db, { name, boat: { name: 'B' }, crew });

describe('device id and settings', () => {
  it('getDeviceId is generated once and stable', async () => {
    const a = await getDeviceId(db);
    expect(a.length).toBeGreaterThan(8);
    expect(await getDeviceId(db)).toBe(a);
    expect((await getSettings(db)).deviceId).toBe(a);
  });
  it('concurrent first calls agree', async () => {
    const ids = await Promise.all([getDeviceId(db), getDeviceId(db), getDeviceId(db)]);
    expect(new Set(ids).size).toBe(1);
  });
});

describe('ownership and read-only trips', () => {
  it('created trips are writable and stamped with the device id', async () => {
    const trip = await newTrip();
    const device = await getDeviceId(db);
    expect(trip.updatedBy).toBe(device);
    expect((await getSettings(db)).writableTripIds).toEqual([trip.id]);
  });
  it('setTripOwnership toggles writability', async () => {
    const trip = await newTrip();
    await setTripOwnership(db, trip.id, 'foreign');
    expect((await getSettings(db)).writableTripIds).toEqual([]);
    await setTripOwnership(db, trip.id, 'own');
    await setTripOwnership(db, trip.id, 'own');
    expect((await getSettings(db)).writableTripIds).toEqual([trip.id]);
  });
  it('all write functions throw ReadOnlyTripError for foreign trips', async () => {
    const trip = await newTrip();
    const entry = await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 });
    const track = await addTrack(db, trip.id, { name: 'k', source: 'live', points: [] });
    await upsertDayReport(db, trip.id, '2026-07-01', { text: 'x' });
    await setTripOwnership(db, trip.id, 'foreign');
    const ro = ReadOnlyTripError;
    await expect(createEntry(db, trip.id, { time: 2, tzOffsetMin: 0 })).rejects.toBeInstanceOf(ro);
    await expect(updateEntry(db, entry.id, { text: 'x' })).rejects.toBeInstanceOf(ro);
    await expect(setEntryPosition(db, entry.id, undefined)).rejects.toBeInstanceOf(ro);
    await expect(deleteEntry(db, entry.id)).rejects.toBeInstanceOf(ro);
    await expect(addPhotosToEntry(db, entry.id, [photo()])).rejects.toBeInstanceOf(ro);
    await expect(upsertDayReport(db, trip.id, '2026-07-01', { text: 'y' })).rejects.toBeInstanceOf(ro);
    await expect(addPhotosToDayReport(db, trip.id, '2026-07-01', [photo()])).rejects.toBeInstanceOf(ro);
    await expect(addTrack(db, trip.id, { name: 'k', source: 'gpx', points: [] })).rejects.toBeInstanceOf(ro);
    await expect(appendTrackPoints(db, track.id, [{ lat: 1, lon: 1 }])).rejects.toBeInstanceOf(ro);
    await expect(deleteTrack(db, track.id)).rejects.toBeInstanceOf(ro);
    await expect(updateTrip(db, trip.id, { name: 'n' })).rejects.toBeInstanceOf(ro);
    await expect(setFlotilla(db, trip.id, { id: 'f', name: 'F' })).rejects.toBeInstanceOf(ro);
    await expect(saveCrew(db, trip.id, [])).rejects.toBeInstanceOf(ro);
    await expect(linkCrewEmail(db, 'c1', 'a@b.de')).rejects.toBeInstanceOf(ro);
    expect((await listEntries(db, trip.id))[0]!.text).toBeUndefined();
  });
  it('deleteTrip stays a hard, local delete (also for foreign trips) and forgets ownership/author', async () => {
    const trip = await newTrip();
    await setAuthor(db, trip.id, 'c1');
    await setTripOwnership(db, trip.id, 'foreign');
    await deleteTrip(db, trip.id);
    expect(await getTrip(db, trip.id)).toBeUndefined();
    expect(await getAuthor(db, trip.id)).toBeUndefined();
  });
});

describe('version stamps and patches', () => {
  it('updateEntry bumps updatedAt/updatedBy and patches only given fields', async () => {
    const trip = await newTrip();
    const e = await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0, position: { lat: 1, lon: 2 } });
    const u = await updateEntry(db, e.id, { text: 'hallo' });
    expect(u.text).toBe('hallo');
    expect(u.position).toEqual({ lat: 1, lon: 2 });
    expect(u.updatedAt).toBeGreaterThan(e.updatedAt);
    expect(u.updatedBy).toBe(await getDeviceId(db));
  });
  it('setEntryPosition(undefined) removes the position', async () => {
    const trip = await newTrip();
    const e = await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0, position: { lat: 1, lon: 2 } });
    expect((await setEntryPosition(db, e.id, undefined)).position).toBeUndefined();
  });
  it('updateTrip and setFlotilla stamp the trip', async () => {
    const trip = await newTrip();
    const u = await updateTrip(db, trip.id, { area: 'Ostsee' });
    expect(u.area).toBe('Ostsee');
    expect(u.updatedAt).toBeGreaterThan(trip.updatedAt);
    const f = await setFlotilla(db, trip.id, { id: 'f1', name: 'Regatta' });
    expect(f.flotilla).toEqual({ id: 'f1', name: 'Regatta' });
    expect((await setFlotilla(db, trip.id, undefined)).flotilla).toBeUndefined();
  });
  it('appendTrackPoints fills chunks of this device and leaves the track record alone', async () => {
    const trip = await newTrip();
    const k = await addTrack(db, trip.id, { name: 'k', source: 'live', points: [] });
    await appendTrackPoints(db, k.id, [{ lat: 1, lon: 1 }]);
    await appendTrackPoints(db, k.id, [{ lat: 2, lon: 2 }]);
    const [again] = await listTracks(db, trip.id);
    expect(again!.points.map((p) => p.lat)).toEqual([1, 2]);
    expect(again!.updatedAt).toBe(k.updatedAt);
    const { trackChunks } = await loadTripData(db, trip.id);
    expect(trackChunks).toHaveLength(1);
    expect(trackChunks[0]!.updatedBy).toBe(await getDeviceId(db));
  });
  it('a full chunk starts the next one (seq + 1)', async () => {
    const trip = await newTrip();
    const many = Array.from({ length: 450 }, (_, i) => ({ lat: i, lon: 0 }));
    const k = await addTrack(db, trip.id, { name: 'k', source: 'gpx', points: many.slice(0, 390) });
    await appendTrackPoints(db, k.id, many.slice(390));
    const { trackChunks } = await loadTripData(db, trip.id);
    expect(trackChunks.map((c) => [c.seq, c.points.length])).toEqual([[0, 200], [1, 200], [2, 50]]);
    expect((await listTracks(db, trip.id))[0]!.points.map((p) => p.lat)).toEqual(many.map((p) => p.lat));
  });
});

describe('tombstones', () => {
  it('deleteEntry keeps a tombstone that lists hide but loadTripData exports', async () => {
    const trip = await newTrip();
    const e = await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 });
    await deleteEntry(db, e.id);
    expect(await listEntries(db, trip.id)).toEqual([]);
    const bundle = await loadTripData(db, trip.id);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]!.deletedAt).toBeGreaterThan(0);
    expect(bundle.entries[0]!.updatedAt).toBeGreaterThan(e.updatedAt);
  });
  it('deleteTrack is a tombstone', async () => {
    const trip = await newTrip();
    const k = await addTrack(db, trip.id, { name: 'k', source: 'gpx', points: [] });
    await deleteTrack(db, k.id);
    expect(await listTracks(db, trip.id)).toEqual([]);
    expect((await loadTripData(db, trip.id)).tracks[0]!.deletedAt).toBeDefined();
  });
  it('crew members are records of their trip; createTrip stores them', async () => {
    const trip = await newTrip();
    const crew = await listCrew(db, trip.id);
    expect(crew.map((c) => [c.id, c.tripId, c.name])).toEqual([['c1', trip.id, 'Ann'], ['c2', trip.id, 'Ben']]);
    expect(crew[0]!.updatedBy).toBe(await getDeviceId(db));
  });
  it('removing crew via saveCrew tombstones the member; re-adding revives it', async () => {
    const trip = await newTrip();
    const u = await saveCrew(db, trip.id, [{ id: 'c1', name: 'Ann' }]);
    expect(activeCrew(u).map((c) => c.id)).toEqual(['c1']);
    const gone = u.find((c) => c.id === 'c2')!;
    expect(gone.deletedAt).toBeGreaterThan(0);
    expect(gone.updatedBy).toBe(await getDeviceId(db));
    const back = await saveCrew(db, trip.id, [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Ben' }]);
    expect(activeCrew(back).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
  it('unchanged crew members keep their version when other members change', async () => {
    const trip = await newTrip();
    const a = await saveCrew(db, trip.id, [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Ben' }, { id: 'c3', name: 'Cem' }]);
    const b = await saveCrew(db, trip.id, [{ id: 'c1', name: 'Ann' }, { id: 'c2', name: 'Benno' }, { id: 'c3', name: 'Cem' }]);
    const ver = (list: typeof a, id: string) => list.find((c) => c.id === id)!.updatedAt;
    expect(ver(b, 'c1')).toBe(ver(a, 'c1'));
    expect(ver(b, 'c2')).toBeGreaterThan(ver(a, 'c2'));
  });
  it('linkCrewEmail stores a normalized e-mail on exactly one member', async () => {
    const trip = await newTrip();
    await linkCrewEmail(db, 'c1', ' Ann@Example.DE ');
    await linkCrewEmail(db, 'c2', 'ann@example.de');
    const crew = await listCrew(db, trip.id);
    expect(crew.map((c) => c.email)).toEqual([undefined, 'ann@example.de']);
  });
});

describe('authors and day reports per author', () => {
  it('setAuthor/getAuthor per trip', async () => {
    const trip = await newTrip();
    expect(await getAuthor(db, trip.id)).toBeUndefined();
    await setAuthor(db, trip.id, 'c2');
    expect(await getAuthor(db, trip.id)).toBe('c2');
    expect((await getSettings(db)).authorByTrip).toEqual({ [trip.id]: 'c2' });
  });
  it('new entries carry the current author', async () => {
    const trip = await newTrip();
    expect((await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 })).authorId).toBeUndefined();
    await setAuthor(db, trip.id, 'c1');
    expect((await createEntry(db, trip.id, { time: 2, tzOffsetMin: 0 })).authorId).toBe('c1');
  });
  it('two authors write independent sections of the same day', async () => {
    const trip = await newTrip();
    await setAuthor(db, trip.id, 'c1');
    await upsertDayReport(db, trip.id, '2026-07-01', { text: 'Anns Sicht' });
    await setAuthor(db, trip.id, 'c2');
    await upsertDayReport(db, trip.id, '2026-07-01', { text: 'Bens Sicht' });
    const reports = await listDayReports(db, trip.id);
    expect(reports.map((r) => [r.authorId, r.text])).toEqual([['c1', 'Anns Sicht'], ['c2', 'Bens Sicht']]);
    expect((await getDayReport(db, trip.id, '2026-07-01'))!.text).toBe('Bens Sicht');
    expect((await getDayReport(db, trip.id, '2026-07-01', 'c1'))!.text).toBe('Anns Sicht');
  });
  it('without author the section uses authorId ""; explicit authorId overrides', async () => {
    const trip = await newTrip();
    expect((await upsertDayReport(db, trip.id, '2026-07-01', { text: 'x' })).authorId).toBe('');
    expect((await upsertDayReport(db, trip.id, '2026-07-01', { text: 'y' }, 'c2')).authorId).toBe('c2');
  });
  it('upsert keeps photos and revives a deleted section', async () => {
    const trip = await newTrip();
    await addPhotosToDayReport(db, trip.id, '2026-07-01', [photo(1)]);
    const r = await upsertDayReport(db, trip.id, '2026-07-01', { text: 'neu' });
    expect(r.photoIds).toHaveLength(1);
  });
  it('the 15 photo limit counts over all sections of a day', async () => {
    const trip = await newTrip();
    await setAuthor(db, trip.id, 'c1');
    await addPhotosToDayReport(db, trip.id, '2026-07-01', Array.from({ length: 10 }, (_, i) => photo(i)));
    await setAuthor(db, trip.id, 'c2');
    await expect(addPhotosToDayReport(db, trip.id, '2026-07-01', Array.from({ length: 6 }, (_, i) => photo(20 + i))))
      .rejects.toBeInstanceOf(MaxPhotosError);
    await addPhotosToDayReport(db, trip.id, '2026-07-01', Array.from({ length: 5 }, (_, i) => photo(20 + i)));
    expect((await listDayReports(db, trip.id))).toHaveLength(2);
  });
  it('removePhotoFromDayReport acts on the own section', async () => {
    const trip = await newTrip();
    const [p] = await addPhotosToDayReport(db, trip.id, '2026-07-01', [photo(1)]);
    await removePhotoFromDayReport(db, trip.id, '2026-07-01', p!.id);
    expect((await getDayReport(db, trip.id, '2026-07-01'))!.photoIds).toEqual([]);
    expect(await db.photos.get(p!.id)).toBeUndefined();
  });
});

describe('flotilla queries', () => {
  it('listFlotillaTrips returns trips of that flotilla only', async () => {
    const a = await newTrip('A', []);
    const b = await newTrip('B', []);
    await newTrip('C', []);
    await setFlotilla(db, a.id, { id: 'f1', name: 'F' });
    await setFlotilla(db, b.id, { id: 'f1', name: 'F' });
    expect((await listFlotillaTrips(db, 'f1')).map((t) => t.name).sort()).toEqual(['A', 'B']);
    expect(await listFlotillaTrips(db, 'none')).toEqual([]);
  });
});

describe('device id after a cloud logout (all tables cleared)', () => {
  it('is restored from the localStorage copy, not regenerated', async () => {
    const before = await getDeviceId(db);
    await db.settings.clear();
    resetDeviceIdCache(db);
    expect((await getSettings(db)).deviceId).toBe(before);
    expect(await getDeviceId(db)).toBe(before);
    expect((await db.settings.get('deviceId'))?.value).toBe(before);
  });
});
