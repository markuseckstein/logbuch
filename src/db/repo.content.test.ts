import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addPhotoToEntry, addTrack, appendTrackPoints, createEntry, createTrip, deleteEntry, deleteTrack,
  getDayReport, getPhoto, listDayReports, listEntries, listTracks, MaxPhotosError,
  removePhotoFromEntry, setBoatPhoto, setEntryPosition, updateEntry, upsertDayReport,
} from './repo';
import { dispose, firstBoat, freshDb, tripInput } from './test-helpers';

let db: LogbookDB;
let tripId: string;
let boatId: string;
beforeEach(async () => {
  db = freshDb();
  tripId = (await createTrip(db, tripInput('T'))).id;
  boatId = await firstBoat(db, tripId);
});
afterEach(async () => { await dispose(db); });

const photo = (s = 'x') => ({ blob: new Blob([s], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 4, height: 3 });

describe('entries', () => {
  it('creates a note entry with empty photoIds', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1000, tzOffsetMin: 120, position: { lat: 1, lon: 2 } });
    expect(e).toMatchObject({ tripId, type: 'note', photoIds: [], time: 1000, tzOffsetMin: 120, position: { lat: 1, lon: 2 } });
    expect(e.createdAt).toBe(e.updatedAt);
  });

  it('lists chronologically and only for the given trip', async () => {
    const other = await createTrip(db, tripInput('O'));
    const c = await createEntry(db, tripId, { boatId, time: 300, tzOffsetMin: 0 });
    const a = await createEntry(db, tripId, { boatId, time: 100, tzOffsetMin: 0 });
    const b = await createEntry(db, tripId, { boatId, time: 200, tzOffsetMin: 0 });
    await createEntry(db, other.id, { boatId: await firstBoat(db, other.id), time: 150, tzOffsetMin: 0 });
    expect((await listEntries(db, tripId)).map((e) => e.id)).toEqual([a.id, b.id, c.id]);
  });

  it('updateEntry patches fields and sets updatedAt', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    await new Promise((r) => setTimeout(r, 5));
    const u = await updateEntry(db, e.id, { text: 'Hallo', type: 'harbour', windBft: 4 });
    expect(u).toMatchObject({ text: 'Hallo', type: 'harbour', windBft: 4, createdAt: e.createdAt });
    expect(u.updatedAt).toBeGreaterThan(e.updatedAt);
    expect((await listEntries(db, tripId))[0]).toEqual(u);
  });

  it('updateEntry throws for unknown id', async () => {
    await expect(updateEntry(db, 'nope', { text: 'x' })).rejects.toThrow();
  });

  it('setEntryPosition sets and clears the position', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    const withPos = await setEntryPosition(db, e.id, { lat: 54, lon: 10, accuracyM: 5 });
    expect(withPos.position).toEqual({ lat: 54, lon: 10, accuracyM: 5 });
    const cleared = await setEntryPosition(db, e.id, undefined);
    expect(cleared.position).toBeUndefined();
  });

  it('deleteEntry removes the entry and its photos only', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    const keep = await createEntry(db, tripId, { boatId, time: 2, tzOffsetMin: 0 });
    const p = await addPhotoToEntry(db, e.id, photo());
    const kp = await addPhotoToEntry(db, keep.id, photo());
    await deleteEntry(db, e.id);
    expect((await listEntries(db, tripId)).map((x) => x.id)).toEqual([keep.id]);
    expect(await getPhoto(db, p.id)).toBeUndefined();
    expect(await getPhoto(db, kp.id)).toBeDefined();
  });
});

describe('photos', () => {
  it('adds a photo and links it to the entry', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    const p = await addPhotoToEntry(db, e.id, photo());
    expect(p).toMatchObject({ tripId, mime: 'image/jpeg', width: 4, height: 3 });
    expect((await listEntries(db, tripId))[0]?.photoIds).toEqual([p.id]);
    const stored = await getPhoto(db, p.id);
    expect(stored?.id).toBe(p.id);
    // Blob roundtrip: fake-indexeddb in jsdom may not return a real Blob, so only
    // the presence of the stored value is asserted, not the byte content.
    expect(stored?.blob).toBeDefined();
  });

  it('rejects a sixth photo with MaxPhotosError', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    for (let i = 0; i < 5; i++) await addPhotoToEntry(db, e.id, photo());
    await expect(addPhotoToEntry(db, e.id, photo())).rejects.toBeInstanceOf(MaxPhotosError);
    expect(await db.photos.count()).toBe(5);
    expect((await listEntries(db, tripId))[0]?.photoIds).toHaveLength(5);
  });

  it('removePhotoFromEntry deletes photo and unlinks it, allowing a new one', async () => {
    const e = await createEntry(db, tripId, { boatId, time: 1, tzOffsetMin: 0 });
    const ps = [];
    for (let i = 0; i < 5; i++) ps.push(await addPhotoToEntry(db, e.id, photo()));
    await removePhotoFromEntry(db, e.id, ps[1]!.id);
    expect(await getPhoto(db, ps[1]!.id)).toBeUndefined();
    expect((await listEntries(db, tripId))[0]?.photoIds).toEqual([ps[0]!.id, ps[2]!.id, ps[3]!.id, ps[4]!.id]);
    await expect(addPhotoToEntry(db, e.id, photo())).resolves.toBeDefined();
  });

  it('setBoatPhoto sets photoId of the boat and replaces the previous photo', async () => {
    const first = await setBoatPhoto(db, boatId, photo('a'));
    expect((await db.boats.get(boatId))?.photoId).toBe(first.id);
    const second = await setBoatPhoto(db, boatId, photo('b'));
    expect((await db.boats.get(boatId))?.photoId).toBe(second.id);
    expect(await getPhoto(db, first.id)).toBeUndefined();
    expect(await getPhoto(db, second.id)).toBeDefined();
  });
});

describe('day reports', () => {
  it('upserts by trip and date', async () => {
    await upsertDayReport(db, tripId, '2026-07-01', { title: 'Tag 1', text: 'a' });
    await upsertDayReport(db, tripId, '2026-07-01', { text: 'b' });
    await upsertDayReport(db, tripId, '2026-06-30', { text: 'z' });
    expect(await getDayReport(db, tripId, '2026-07-01')).toMatchObject({ text: 'b' });
    expect((await getDayReport(db, tripId, '2026-07-01'))?.title).toBeUndefined();
    expect((await listDayReports(db, tripId)).map((r) => r.date)).toEqual(['2026-06-30', '2026-07-01']);
  });

  it('getDayReport returns undefined if missing', async () => {
    expect(await getDayReport(db, tripId, '2026-01-01')).toBeUndefined();
  });
});

describe('tracks', () => {
  it('adds, lists and deletes tracks', async () => {
    const t = await addTrack(db, tripId, { boatId, name: 'GPX', source: 'gpx', points: [{ lat: 1, lon: 2 }] });
    expect(await listTracks(db, tripId)).toEqual([t]);
    await deleteTrack(db, t.id);
    expect(await listTracks(db, tripId)).toEqual([]);
  });

  it('appendTrackPoints extends a live track in order', async () => {
    const t = await addTrack(db, tripId, { boatId, name: 'Live', source: 'live', points: [] });
    await appendTrackPoints(db, t.id, [{ lat: 1, lon: 1 }]);
    await appendTrackPoints(db, t.id, [{ lat: 2, lon: 2 }, { lat: 3, lon: 3 }]);
    expect((await listTracks(db, tripId))[0]?.points.map((p) => p.lat)).toEqual([1, 2, 3]);
  });

  it('appendTrackPoints throws for unknown track', async () => {
    await expect(appendTrackPoints(db, 'nope', [])).rejects.toThrow();
  });
});
