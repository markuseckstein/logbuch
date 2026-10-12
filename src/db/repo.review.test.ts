import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogbookDB } from './db';
import {
  addBoat, addPhotosToDayReport, createTrip, deleteDayReport, getDayReport, getPhoto, listDayReports, removeBoat, setBoatPhoto,
  upsertDayReport,
} from './repo';
import { dispose, freshDb, tripInput } from './test-helpers';

let db: LogbookDB;
let tripId: string;
beforeEach(async () => {
  db = freshDb();
  tripId = (await createTrip(db, tripInput('T'))).id;
});
afterEach(async () => { await dispose(db); });

const photo = (s: string) => ({ blob: new Blob([s], { type: 'image/jpeg' }), mime: 'image/jpeg', width: 4, height: 3, hash: s });

describe('day report written again after it was deleted', () => {
  it('does not resurrect the photo ids of the deleted section (their files are gone)', async () => {
    const [old] = await addPhotosToDayReport(db, tripId, '2026-07-01', [photo('a')]);
    await deleteDayReport(db, tripId, '2026-07-01');
    expect(await getPhoto(db, old!.id)).toBeUndefined();
    await upsertDayReport(db, tripId, '2026-07-01', { text: 'neu' });
    expect((await getDayReport(db, tripId, '2026-07-01'))?.photoIds).toEqual([]);
  });

  it('adding photos to a deleted section starts with only the new photos', async () => {
    await addPhotosToDayReport(db, tripId, '2026-07-01', [photo('a'), photo('b')]);
    await deleteDayReport(db, tripId, '2026-07-01');
    const [fresh] = await addPhotosToDayReport(db, tripId, '2026-07-01', [photo('c')]);
    const [report] = await listDayReports(db, tripId);
    expect(report?.photoIds).toEqual([fresh!.id]);
  });
});

describe('removeBoat', () => {
  it('also removes the file of the boat photo (no orphan)', async () => {
    const extra = await addBoat(db, tripId, { name: 'Zweitboot' });
    const p = await setBoatPhoto(db, extra.id, photo('boat'));
    await removeBoat(db, extra.id);
    expect(await getPhoto(db, p.id)).toBeUndefined();
  });
});
