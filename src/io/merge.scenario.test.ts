import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from '../db/db';
import {
  addPhotosToEntry, addPhotosToDayReport, createEntry, createTrip, deleteEntry, listDayReports, listEntries,
  loadTripData, mergeBundle, setAuthor, updateEntry, upsertDayReport,
} from '../db/repo';
import { dispose, firstBoat, freshDb, tripInput } from '../db/test-helpers';
import { exportZip } from './exportZip';
import { importZip } from './importZip';

let a: LogbookDB;
let b: LogbookDB;
beforeEach(() => { a = freshDb(); b = freshDb(); });
afterEach(async () => { await dispose(a); await dispose(b); });

const DAY = '2026-07-01';
const T0 = Date.UTC(2026, 6, 1, 10);
const photo = (n: number, hash = `h${n}`) => ({ blob: new Blob([String(n)], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 1, height: 1, hash });
const pause = () => new Promise((r) => setTimeout(r, 5));

/** fake-indexeddb in jsdom does not preserve Blob contents; give every stored photo bytes derived from its id. */
async function loadForExport(db: LogbookDB, tripId: string) {
  const d = await loadTripData(db, tripId);
  return { ...d, photos: d.photos.map((p) => ({ ...p, blob: new Blob([p.id], { type: p.mime }) })) };
}

/** Sends the logbook of `from` to `to` through the real export/import file format. */
async function send(from: LogbookDB, to: LogbookDB, tripId: string, includePhotos = true) {
  const bundle = await importZip(await exportZip(await loadForExport(from, tripId), { includePhotos }));
  return mergeBundle(to, bundle);
}

async function snapshot(db: LogbookDB, tripId: string) {
  const d = await loadTripData(db, tripId);
  return { ...d, photos: d.photos.map((p) => ({ ...p, blob: undefined })) };
}

let boatId: string;

async function twoBoatsSetup() {
  const trip = await createTrip(a, tripInput('Boot', ['B', 'C']));
  boatId = await firstBoat(a, trip.id);
  const crew = (id: string, name: string) => ({ id, tripId: trip.id, name, createdAt: 1, updatedAt: 1, updatedBy: 'x' });
  await a.crewMembers.bulkAdd([crew('c1', 'Ann'), crew('c2', 'Ben')]);
  const e1 = await createEntry(a, trip.id, { boatId, time: T0, tzOffsetMin: 0 });
  await updateEntry(a, e1.id, { text: 'Start' });
  const e2 = await createEntry(a, trip.id, { boatId, time: T0 + 1000, tzOffsetMin: 0 });
  await send(a, b, trip.id);
  await setAuthor(a, trip.id, 'c1');
  await setAuthor(b, trip.id, 'c2');
  return { trip, e1, e2 };
}

describe('two devices edit offline, then exchange files', () => {
  it('both databases end in an identical state', async () => {
    const { trip, e1, e2 } = await twoBoatsSetup();
    // --- offline on A
    const a1 = await createEntry(a, trip.id, { boatId, time: T0 + 2000, tzOffsetMin: 0 });
    await updateEntry(a, e1.id, { text: 'Start (A geändert)' });
    await updateEntry(a, e2.id, { text: 'Hafen (A)' });
    await upsertDayReport(a, trip.id, DAY, { text: 'Bericht von Ann' });
    await addPhotosToDayReport(a, trip.id, DAY, [photo(1, 'same-photo')]);
    await pause();
    // --- offline on B (later): deletes e1, adds own entry, own report section, same photo (other file id)
    const b1 = await createEntry(b, trip.id, { boatId, time: T0 + 3000, tzOffsetMin: 0 });
    await deleteEntry(b, e1.id);
    await upsertDayReport(b, trip.id, DAY, { text: 'Bericht von Ben' });
    const eb = await createEntry(b, trip.id, { boatId, time: T0 + 4000, tzOffsetMin: 0 });
    await addPhotosToEntry(b, eb.id, [photo(2, 'same-photo')]);

    const fromA = await send(a, b, trip.id);
    const fromB = await send(b, a, trip.id);
    expect(fromA).toMatchObject({ tripCreated: false, deleted: 0 });
    expect(fromB.deleted).toBe(1);

    const sa = await snapshot(a, trip.id);
    const sb = await snapshot(b, trip.id);
    expect(sa).toEqual(sb);

    // semantic checks on the merged state
    const texts = (await listEntries(a, trip.id)).map((e) => e.id);
    expect(texts).toEqual(expect.arrayContaining([e2.id, a1.id, b1.id, eb.id]));
    expect(texts).not.toContain(e1.id); // B's later deletion beats A's earlier edit
    expect(sa.entries.find((e) => e.id === e1.id)!.deletedAt).toBeDefined();
    expect((await listEntries(a, trip.id)).find((e) => e.id === e2.id)!.text).toBe('Hafen (A)');
    expect((await listDayReports(a, trip.id)).map((r) => [r.authorId, r.text]))
      .toEqual([['c1', 'Bericht von Ann'], ['c2', 'Bericht von Ben']]);
    expect(sa.photos).toHaveLength(1); // deduplicated onto one id
  });

  it('exchanging the same files again changes nothing (idempotent)', async () => {
    const { trip } = await twoBoatsSetup();
    await createEntry(a, trip.id, { boatId, time: T0 + 2000, tzOffsetMin: 0 });
    await createEntry(b, trip.id, { boatId, time: T0 + 3000, tzOffsetMin: 0 });
    await send(a, b, trip.id);
    await send(b, a, trip.id);
    const before = await snapshot(a, trip.id);
    const again = await send(b, a, trip.id);
    await send(a, b, trip.id);
    expect(again).toMatchObject({ added: 0, updated: 0, deleted: 0, photosAdded: 0 });
    expect(await snapshot(a, trip.id)).toEqual(before);
    expect(await snapshot(b, trip.id)).toEqual(before);
  });

  it('is order independent: a third device gets the same state from either order', async () => {
    const { trip } = await twoBoatsSetup();
    await updateEntry(a, (await listEntries(a, trip.id))[0]!.id, { text: 'A' });
    await createEntry(b, trip.id, { boatId, time: T0 + 3000, tzOffsetMin: 0 });
    const c1 = freshDb();
    const c2 = freshDb();
    try {
      await send(a, c1, trip.id); await send(b, c1, trip.id);
      await send(b, c2, trip.id); await send(a, c2, trip.id);
      expect(await snapshot(c1, trip.id)).toEqual(await snapshot(c2, trip.id));
    } finally {
      await dispose(c1); await dispose(c2);
    }
  });

  it('an export without photos keeps references; a later full export delivers the images', async () => {
    const { trip } = await twoBoatsSetup();
    const eb = await createEntry(b, trip.id, { boatId, time: T0 + 4000, tzOffsetMin: 0 });
    const [p] = await addPhotosToEntry(b, eb.id, [photo(7)]);
    await send(b, a, trip.id, false);
    expect((await listEntries(a, trip.id)).find((e) => e.id === eb.id)!.photoIds).toEqual([p!.id]);
    expect(await a.photos.count()).toBe(0);
    const full = await send(b, a, trip.id, true);
    expect(full.photosAdded).toBe(1);
    expect(await a.photos.get(p!.id)).toBeDefined();
  });
});
