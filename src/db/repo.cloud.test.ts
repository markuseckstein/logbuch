import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tiedRealmId } from '../domain/access';
import type { LogbookDB } from './db';
import {
  ReadOnlyTripError, addPhotosToDayReport, addPhotosToEntry, addTrack, appendTrackPoints, canManageTrip, canWriteTrip,
  createEntry, createTrip, getAuthor, linkCrewEmail, listWritableTripIds, loadTripData, mergeBundle, moveTripToRealm,
  saveCrew, setTripOwnership, upsertDayReport,
} from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const photo = (n: number) => ({ blob: new Blob([String(n)]), mime: 'image/jpeg', width: 1, height: 1, hash: `h${n}` });

async function sharedTrip() {
  const trip = await createTrip(db, { name: 'T', boat: { name: 'Seeschwalbe' }, crew: [{ id: 'c1', name: 'Ann' }] });
  const e = await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 });
  await addPhotosToEntry(db, e.id, [photo(1)]);
  await upsertDayReport(db, trip.id, '2026-07-01', { text: 'x' });
  await addTrack(db, trip.id, { name: 'k', source: 'gpx', points: [{ lat: 1, lon: 1 }] });
  const realmId = tiedRealmId(trip.id);
  await moveTripToRealm(db, trip.id, realmId, { name: 'Seeschwalbe', represents: 'ein Bordbuch' });
  return { trip, realmId };
}

async function realmIdsOf(tripId: string): Promise<Set<string | undefined>> {
  const b = await loadTripData(db, tripId);
  return new Set(
    [b.trip, ...b.crew, ...b.entries, ...b.photos, ...b.dayReports, ...b.tracks, ...b.trackChunks].map((r) => r.realmId),
  );
}

/** Signs in a simulated cloud user with a role in the trip realm (access tables filled like a sync would). */
async function asMember(realmId: string, role: 'crew' | 'readonly' | 'skipper', userId = 'bob') {
  await db.roles.bulkPut([
    { realmId: 'rlm-public', name: 'skipper', permissions: { manage: '*' } },
    { realmId: 'rlm-public', name: 'crew', permissions: { add: ['crewMembers', 'entries', 'photos', 'dayReports', 'tracks', 'trackChunks'], update: '*' } },
    { realmId: 'rlm-public', name: 'readonly', permissions: {} },
  ] as never);
  await db.realms.update(realmId, { owner: 'alice' });
  await db.members.put({ id: `mmb-${userId}`, realmId, userId, email: `${userId}@demo.local`, roles: [role] } as never);
  db.cloudUser = () => ({ userId, email: `${userId}@demo.local` });
}

describe('moveTripToRealm (Logbuch in die Cloud bringen)', () => {
  it('moves the trip and every record of it into the realm and upserts the realm', async () => {
    const { trip, realmId } = await sharedTrip();
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
    expect(await db.realms.get(realmId)).toMatchObject({ realmId, name: 'Seeschwalbe', represents: 'ein Bordbuch' });
  });
  it('leaves other trips alone', async () => {
    const other = await createTrip(db, { name: 'O', boat: { name: 'B' }, crew: [] });
    await sharedTrip();
    expect((await db.trips.get(other.id))!.realmId).toBeUndefined();
  });
});

describe('new records inherit the realm of their trip', () => {
  it('entries, photos, day reports, crew, tracks and chunks written later carry realmId', async () => {
    const { trip, realmId } = await sharedTrip();
    const e = await createEntry(db, trip.id, { time: 2, tzOffsetMin: 0 });
    await addPhotosToEntry(db, e.id, [photo(2)]);
    await addPhotosToDayReport(db, trip.id, '2026-07-02', [photo(3)]);
    await saveCrew(db, trip.id, [{ id: 'c1', name: 'Ann' }, { id: 'c9', name: 'Neu' }]);
    const k = await addTrack(db, trip.id, { name: 'l', source: 'live', points: [] });
    await appendTrackPoints(db, k.id, [{ lat: 2, lon: 2 }]);
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
  });
});

describe('cloud permissions decide for shared trips', () => {
  it('crew member (not in writableTripIds) may write', async () => {
    const { trip, realmId } = await sharedTrip();
    await setTripOwnership(db, trip.id, 'foreign');
    await asMember(realmId, 'crew');
    expect(await canWriteTrip(db, trip.id)).toBe(true);
    expect(await canManageTrip(db, trip.id)).toBe(false);
    await expect(createEntry(db, trip.id, { time: 5, tzOffsetMin: 0 })).resolves.toBeDefined();
  });
  it('readonly member (other boat) may not write even if writableTripIds says so', async () => {
    const { trip, realmId } = await sharedTrip();
    await asMember(realmId, 'readonly', 'carol');
    expect(await canWriteTrip(db, trip.id)).toBe(false);
    expect(await listWritableTripIds(db)).toEqual([]);
    await expect(createEntry(db, trip.id, { time: 5, tzOffsetMin: 0 })).rejects.toBeInstanceOf(ReadOnlyTripError);
    await expect(mergeBundle(db, await loadTripData(db, trip.id), { ownership: 'own' })).rejects.toBeInstanceOf(ReadOnlyTripError);
  });
  it('the realm owner may manage', async () => {
    const { trip, realmId } = await sharedTrip();
    await asMember(realmId, 'readonly', 'carol');
    db.cloudUser = () => ({ userId: 'alice' });
    expect(await canManageTrip(db, trip.id)).toBe(true);
    expect(await canWriteTrip(db, trip.id)).toBe(true);
  });
  it('not shared (private/local realm): writableTripIds stays the rule', async () => {
    const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
    db.cloudUser = () => ({ userId: 'bob' });
    expect(await canWriteTrip(db, trip.id)).toBe(true);
    await setTripOwnership(db, trip.id, 'foreign');
    expect(await canWriteTrip(db, trip.id)).toBe(false);
  });
});

describe('author from the cloud account', () => {
  it('without a local "Ich bin" the crew member linked to the user e-mail is the author', async () => {
    const { trip, realmId } = await sharedTrip();
    await linkCrewEmail(db, 'c1', 'bob@demo.local');
    await asMember(realmId, 'crew');
    expect(await getAuthor(db, trip.id)).toBe('c1');
    expect((await createEntry(db, trip.id, { time: 9, tzOffsetMin: 0 })).authorId).toBe('c1');
  });
});

describe('mergeBundle keeps realms', () => {
  it('records from a file land in the realm of the local trip; incoming realmId/owner are ignored', async () => {
    const { trip, realmId } = await sharedTrip();
    const bundle = await loadTripData(db, trip.id);
    const foreign = { realmId: 'rlm~evil', owner: 'mallory' };
    const e = { ...bundle.entries[0]!, id: 'e-new', ...foreign, updatedAt: Date.now() + 10 };
    const old = { ...bundle.entries[0]!, text: 'geändert', ...foreign, updatedAt: Date.now() + 10 };
    await mergeBundle(db, { ...bundle, trip: { ...bundle.trip, ...foreign }, entries: [old, e] }, { ownership: 'own' });
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
    const after = await loadTripData(db, trip.id);
    expect(after.entries.find((x) => x.id === old.id)!.text).toBe('geändert');
    expect(after.entries.every((x) => x.owner === undefined)).toBe(true);
  });
});
