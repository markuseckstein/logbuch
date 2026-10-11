import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  createTrip, deleteTrip, getSettings, getTrip, listTrips, setActiveTrip, setTheme, updateTrip,
  createEntry, addPhotoToEntry, upsertDayReport, addTrack, listEntries, listDayReports, listTracks,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const input = { name: 'Kroatien', boat: { name: 'Lilly' }, crew: [] };

describe('trips', () => {
  it('creates a trip with id and timestamps', async () => {
    const t = await createTrip(db, input);
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
    expect(await getTrip(db, t.id)).toEqual(t);
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

  it('deleteTrip cascades to entries, photos, day reports and tracks', async () => {
    const t = await createTrip(db, input);
    const other = await createTrip(db, input);
    for (const id of [t.id, other.id]) {
      const e = await createEntry(db, id, { time: 1, tzOffsetMin: 0 });
      await addPhotoToEntry(db, e.id, { blob: new Blob(['x']), mime: 'image/jpeg', width: 1, height: 1 });
      await upsertDayReport(db, id, '2026-01-01', { text: 'x' });
      await addTrack(db, id, { name: 't', source: 'gpx', points: [] });
    }
    await deleteTrip(db, t.id);
    expect(await getTrip(db, t.id)).toBeUndefined();
    expect(await listEntries(db, t.id)).toEqual([]);
    expect(await db.photos.where('tripId').equals(t.id).count()).toBe(0);
    expect(await listDayReports(db, t.id)).toEqual([]);
    expect(await listTracks(db, t.id)).toEqual([]);
    expect(await listEntries(db, other.id)).toHaveLength(1);
    expect(await db.photos.where('tripId').equals(other.id).count()).toBe(1);
  });

  it('deleting the active trip clears activeTripId', async () => {
    const t = await createTrip(db, input);
    await setActiveTrip(db, t.id);
    await deleteTrip(db, t.id);
    expect((await getSettings(db)).activeTripId).toBeUndefined();
  });
});

describe('settings', () => {
  it('defaults to theme system without active trip', async () => {
    expect(await getSettings(db)).toMatchObject({ theme: 'system', writableTripIds: [], authorByTrip: {} });
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
});
