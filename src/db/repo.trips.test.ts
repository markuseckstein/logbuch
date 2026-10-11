import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  BoatInUseError, DuplicateEmailError, LastBoatError, addBoat, addCrewMember, addPhotoToEntry, addTrack, createEntry,
  createTrip, deleteTrip, getAuthor, getSettings, getTrip, listBoats, listCrew, listDayReports, listEntries, listTracks,
  listTrips, removeBoat, removeCrewMember, removeTripCover, setActiveTrip, setAuthor, setBoatSelection, setLastBoat,
  setTheme, setTripCover, setTripCoverFocus, updateBoat, updateCrewMember, updateTrip, upsertDayReport,
} from './repo';
import { boatIds, dispose, firstBoat, freshDb, tripInput } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const input = tripInput('Kroatien', ['Lilly']);
const photo = (s = 'x') => ({ blob: new Blob([s]), mime: 'image/jpeg', width: 1, height: 1 });

describe('trips', () => {
  it('creates a trip with id and timestamps, without boat fields on the trip', async () => {
    const t = await createTrip(db, input);
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
    expect(await getTrip(db, t.id)).toEqual(t);
    expect(t).not.toHaveProperty('boat');
  });

  it('needs at least one boat', async () => {
    await expect(createTrip(db, { name: 'X', boats: [] })).rejects.toThrow();
  });

  it('creates the boats in order with distinct color/shape indexes', async () => {
    const t = await createTrip(db, tripInput('F', ['A', 'B', 'C']));
    const boats = await listBoats(db, t.id);
    expect(boats.map((b) => [b.name, b.colorIndex, b.tripId])).toEqual([['A', 1, t.id], ['B', 2, t.id], ['C', 3, t.id]]);
  });

  it('the founder becomes a crew member (skipper), the author on this device, suggested on the first boat', async () => {
    const t = await createTrip(db, { ...tripInput('F', ['A', 'B']), founder: { name: 'Anna' } });
    const [crew] = await listCrew(db, t.id);
    expect(crew).toMatchObject({ name: 'Anna', role: 'skipper', suggestedBoatId: (await boatIds(db, t.id))[0] });
    expect(await getAuthor(db, t.id)).toBe(crew!.id);
  });

  it('getTrip returns undefined for unknown id', async () => {
    expect(await getTrip(db, 'nope')).toBeUndefined();
  });

  it('updates a trip and bumps updatedAt', async () => {
    const t = await createTrip(db, input);
    await new Promise((r) => setTimeout(r, 5));
    const u = await updateTrip(db, t.id, { area: 'Adria' });
    expect(u.area).toBe('Adria');
    expect(u.name).toBe('Kroatien');
    expect(u.updatedAt).toBeGreaterThan(t.updatedAt);
    expect((await getTrip(db, t.id))?.area).toBe('Adria');
  });

  it('lists trips, newest first', async () => {
    const a = await createTrip(db, { ...input, name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createTrip(db, { ...input, name: 'B' });
    expect((await listTrips(db)).map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('deleteTrip cascades to boats, entries, photos, day reports and tracks', async () => {
    const t = await createTrip(db, input);
    const other = await createTrip(db, input);
    for (const id of [t.id, other.id]) {
      const boatId = await firstBoat(db, id);
      const e = await createEntry(db, id, { boatId, time: 1, tzOffsetMin: 0 });
      await addPhotoToEntry(db, e.id, photo());
      await upsertDayReport(db, id, '2026-01-01', { text: 'x' });
      await addTrack(db, id, { boatId, name: 't', source: 'gpx', points: [] });
    }
    await deleteTrip(db, t.id);
    expect(await getTrip(db, t.id)).toBeUndefined();
    expect(await listBoats(db, t.id)).toEqual([]);
    expect(await listEntries(db, t.id)).toEqual([]);
    expect(await db.photos.where('tripId').equals(t.id).count()).toBe(0);
    expect(await listDayReports(db, t.id)).toEqual([]);
    expect(await listTracks(db, t.id)).toEqual([]);
    expect(await listEntries(db, other.id)).toHaveLength(1);
    expect(await db.photos.where('tripId').equals(other.id).count()).toBe(1);
  });

  it('deleting the active trip clears activeTripId and the local per-trip settings', async () => {
    const t = await createTrip(db, input);
    await setActiveTrip(db, t.id);
    await setBoatSelection(db, t.id, 'all');
    await setLastBoat(db, t.id, await firstBoat(db, t.id));
    await deleteTrip(db, t.id);
    const s = await getSettings(db);
    expect(s.activeTripId).toBeUndefined();
    expect(s.boatSelectionByTrip).toEqual({});
    expect(s.lastBoatByTrip).toEqual({});
  });
});

describe('boats', () => {
  it('addBoat takes the next free color index; updateBoat patches fields', async () => {
    const t = await createTrip(db, tripInput('F', ['A']));
    const b = await addBoat(db, t.id, { name: ' Möwe ', model: 'Hanse 345' });
    expect(b).toMatchObject({ name: 'Möwe', model: 'Hanse 345', colorIndex: 2, tripId: t.id });
    const u = await updateBoat(db, b.id, { name: 'Möwe II', model: undefined, lengthM: 10.4 });
    expect(u).toMatchObject({ name: 'Möwe II', lengthM: 10.4 });
    const stored = (await listBoats(db, t.id))[1]!;
    expect(stored.model).toBeUndefined();
    expect(stored.updatedAt).toBeGreaterThanOrEqual(b.updatedAt);
  });

  it('removeBoat tombstones an unused boat and clears crew suggestions for it', async () => {
    const t = await createTrip(db, tripInput('F', ['A', 'B']));
    const [, b] = await boatIds(db, t.id);
    const c = await addCrewMember(db, t.id, { name: 'Ben', email: 'ben@x.de', suggestedBoatId: b });
    await removeBoat(db, b!);
    expect((await listBoats(db, t.id)).find((x) => x.id === b)?.deletedAt).toBeDefined();
    expect((await listCrew(db, t.id)).find((x) => x.id === c.id)?.suggestedBoatId).toBeUndefined();
  });

  it('a boat with entries or tracks, or the last boat, cannot be removed', async () => {
    const t = await createTrip(db, tripInput('F', ['A', 'B']));
    const [a, b] = await boatIds(db, t.id);
    await createEntry(db, t.id, { boatId: a!, time: 1, tzOffsetMin: 0 });
    await expect(removeBoat(db, a!)).rejects.toBeInstanceOf(BoatInUseError);
    await addTrack(db, t.id, { boatId: b!, name: 'k', source: 'gpx', points: [] });
    await expect(removeBoat(db, b!)).rejects.toBeInstanceOf(BoatInUseError);
    const single = await createTrip(db, tripInput('S', ['X']));
    await expect(removeBoat(db, await firstBoat(db, single.id))).rejects.toBeInstanceOf(LastBoatError);
  });

  it('entries need a boat of the same trip', async () => {
    const t = await createTrip(db, input);
    const other = await createTrip(db, input);
    await expect(createEntry(db, t.id, { boatId: await firstBoat(db, other.id), time: 1, tzOffsetMin: 0 })).rejects.toThrow();
    await expect(createEntry(db, t.id, { boatId: 'nope', time: 1, tzOffsetMin: 0 })).rejects.toThrow();
  });
});

describe('crew', () => {
  it('adds people with normalized e-mail and boat suggestion; duplicates are refused', async () => {
    const t = await createTrip(db, tripInput('F', ['A']));
    const boatId = await firstBoat(db, t.id);
    const c = await addCrewMember(db, t.id, { name: 'Ben', email: ' Ben@X.de ', suggestedBoatId: boatId });
    expect(c).toMatchObject({ name: 'Ben', email: 'ben@x.de', suggestedBoatId: boatId });
    await expect(addCrewMember(db, t.id, { name: 'B2', email: 'ben@x.de' })).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('updates the boat suggestion; removing is a tombstone; re-inviting revives the same person', async () => {
    const t = await createTrip(db, tripInput('F', ['A', 'B']));
    const [, b] = await boatIds(db, t.id);
    const c = await addCrewMember(db, t.id, { name: 'Ben', email: 'ben@x.de' });
    await updateCrewMember(db, c.id, { suggestedBoatId: b });
    expect((await listCrew(db, t.id))[0]!.suggestedBoatId).toBe(b);
    await removeCrewMember(db, c.id);
    expect((await listCrew(db, t.id))[0]!.deletedAt).toBeDefined();
    const again = await addCrewMember(db, t.id, { name: 'Benjamin', email: 'ben@x.de' });
    expect(again.id).toBe(c.id);
    expect((await listCrew(db, t.id))[0]).toMatchObject({ name: 'Benjamin' });
    expect((await listCrew(db, t.id))[0]!.deletedAt).toBeUndefined();
  });

  it('getAuthor ignores a local choice that points to a removed person', async () => {
    const t = await createTrip(db, tripInput('F', ['A']));
    const c = await addCrewMember(db, t.id, { name: 'Ben' });
    await setAuthor(db, t.id, c.id);
    expect(await getAuthor(db, t.id)).toBe(c.id);
    await removeCrewMember(db, c.id);
    expect(await getAuthor(db, t.id)).toBeUndefined();
  });
});

describe('cover picture', () => {
  it('set, focus, replace and remove; the photo row lives in the trip', async () => {
    const t = await createTrip(db, input);
    const p1 = await setTripCover(db, t.id, photo('a'));
    expect((await getTrip(db, t.id))?.coverPhotoId).toBe(p1.id);
    expect((await db.photos.get(p1.id))?.tripId).toBe(t.id);
    await setTripCoverFocus(db, t.id, { x: 120, y: 30 });
    expect((await getTrip(db, t.id))?.coverFocus).toEqual({ x: 100, y: 30 });
    const p2 = await setTripCover(db, t.id, photo('b'));
    const after = await getTrip(db, t.id);
    expect(after?.coverPhotoId).toBe(p2.id);
    expect(after?.coverFocus).toBeUndefined();
    expect(await db.photos.get(p1.id)).toBeUndefined();
    await removeTripCover(db, t.id);
    expect((await getTrip(db, t.id))?.coverPhotoId).toBeUndefined();
    expect(await db.photos.get(p2.id)).toBeUndefined();
  });
});

describe('settings', () => {
  it('defaults to theme system without active trip and empty per-trip maps', async () => {
    expect(await getSettings(db)).toMatchObject({
      theme: 'system', authorByTrip: {}, boatSelectionByTrip: {}, lastBoatByTrip: {},
    });
    expect((await getSettings(db)).activeTripId).toBeUndefined();
  });

  it('stores active trip and theme independently', async () => {
    await setActiveTrip(db, 'abc');
    await setTheme(db, 'dark');
    expect(await getSettings(db)).toMatchObject({ activeTripId: 'abc', theme: 'dark' });
    await setActiveTrip(db, undefined);
    expect(await getSettings(db)).toMatchObject({ theme: 'dark' });
    expect((await getSettings(db)).activeTripId).toBeUndefined();
  });

  it('boat switch and last boat per trip (local only)', async () => {
    await setBoatSelection(db, 't1', 'all');
    await setBoatSelection(db, 't2', 'b2');
    await setLastBoat(db, 't1', 'b1');
    expect(await getSettings(db)).toMatchObject({
      boatSelectionByTrip: { t1: 'all', t2: 'b2' }, lastBoatByTrip: { t1: 'b1' },
    });
    await setBoatSelection(db, 't1', undefined);
    expect((await getSettings(db)).boatSelectionByTrip).toEqual({ t2: 'b2' });
  });

  it('creating an entry remembers its boat as last boat of the trip', async () => {
    const t = await createTrip(db, tripInput('F', ['A', 'B']));
    const [, b] = await boatIds(db, t.id);
    await createEntry(db, t.id, { boatId: b!, time: 1, tzOffsetMin: 0 });
    expect((await getSettings(db)).lastBoatByTrip[t.id]).toBe(b);
  });
});
