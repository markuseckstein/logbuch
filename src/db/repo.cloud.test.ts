import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMBER_PERMISSIONS, tiedRealmId } from '../domain/access';
import type { LogbookDB } from './db';
import {
  NotPermittedError, addBoat, addCrewMember, addPhotosToDayReport, addPhotosToEntry, addTrack, appendTrackPoints, canEdit,
  canManageTrip, canWriteTrip, createEntry, createTrip, deleteEntry, deleteTrip, getAuthor, listWritableTripIds,
  loadTripData, mergeBundle, moveTripToRealm, setTripCover, tripAccess, updateEntry, updateTrip, upsertDayReport,
} from './repo';
import { dispose, firstBoat, freshDb, tripInput } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const photo = (n: number) => ({ blob: new Blob([String(n)]), mime: 'image/jpeg', width: 1, height: 1, hash: `h${n}` });

/** Trip of alice with content, moved into its realm (as after sharing). */
async function sharedTrip() {
  const trip = await createTrip(db, { ...tripInput('T', ['Seeschwalbe', 'Möwe']), founder: { name: 'Alice' } });
  const boatId = await firstBoat(db, trip.id);
  const e = await createEntry(db, trip.id, { boatId, time: 1, tzOffsetMin: 0 });
  await addPhotosToEntry(db, e.id, [photo(1)]);
  await upsertDayReport(db, trip.id, '2026-07-01', { text: 'x' });
  await addTrack(db, trip.id, { boatId, name: 'k', source: 'gpx', points: [{ lat: 1, lon: 1 }] });
  const realmId = tiedRealmId(trip.id);
  await moveTripToRealm(db, trip.id, realmId, { name: 'T', represents: 'einen Törn' });
  await db.realms.update(realmId, { owner: 'alice' });
  // records written so far belong to alice (as the server would set them)
  for (const t of [db.trips, db.boats, db.crewMembers, db.entries, db.photos, db.dayReports, db.tracks, db.trackChunks]) {
    await (t as typeof db.entries).toCollection().modify({ owner: 'alice' });
  }
  return { trip, realmId, boatId, aliceEntry: e };
}

async function realmIdsOf(tripId: string): Promise<Set<string | undefined>> {
  const b = await loadTripData(db, tripId);
  return new Set(
    [b.trip, ...b.boats, ...b.crew, ...b.entries, ...b.photos, ...b.dayReports, ...b.tracks, ...b.trackChunks].map((r) => r.realmId),
  );
}

/** Signs in a simulated member (access tables filled like a sync would). */
async function asMember(realmId: string, userId = 'bob', opts: { accepted?: boolean; viaRoleOnly?: boolean } = {}) {
  await db.roles.bulkPut([{ realmId: 'rlm-public', name: 'member', permissions: MEMBER_PERMISSIONS }] as never);
  await db.members.put({
    id: `mmb-${userId}`, realmId, userId, email: `${userId}@demo.local`, roles: ['member'],
    ...(opts.viaRoleOnly ? {} : { permissions: MEMBER_PERMISSIONS }),
    ...(opts.accepted === false ? {} : { accepted: new Date() }),
  } as never);
  db.cloudUser = () => ({ userId, email: `${userId}@demo.local` });
}

/** Records the member created get the member as owner (server/addon would set it). */
async function ownAll(userId: string, ids: { table: typeof db.entries; id: string }[]) {
  for (const { table, id } of ids) await table.update(id, { owner: userId });
}

describe('moveTripToRealm', () => {
  it('moves the trip and every record of it (incl. boats) into the realm and upserts the realm', async () => {
    const { trip, realmId } = await sharedTrip();
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
    expect(await db.realms.get(realmId)).toMatchObject({ realmId, name: 'T', represents: 'einen Törn' });
  });
});

describe('createTrip while signed in', () => {
  it('puts the trip, its boats and the founder (linked by e-mail) into the tied realm right away', async () => {
    db.cloudUser = () => ({ userId: 'alice', email: 'Alice@Demo.local' });
    const trip = await createTrip(db, { ...tripInput('T', ['A']), founder: { name: 'Alice' } });
    expect(await realmIdsOf(trip.id)).toEqual(new Set([tiedRealmId(trip.id)]));
    expect(await db.realms.get(tiedRealmId(trip.id))).toMatchObject({ name: 'T' });
    expect((await loadTripData(db, trip.id)).crew[0]).toMatchObject({ email: 'alice@demo.local' });
  });
});

describe('new records inherit the realm of their trip', () => {
  it('boats, entries, photos, day reports, crew, tracks, chunks and the cover written later carry realmId', async () => {
    const { trip, realmId, boatId } = await sharedTrip();
    db.cloudUser = () => ({ userId: 'alice', email: 'alice@demo.local' });
    const e = await createEntry(db, trip.id, { boatId, time: 2, tzOffsetMin: 0 });
    await addPhotosToEntry(db, e.id, [photo(2)]);
    await addPhotosToDayReport(db, trip.id, '2026-07-02', [photo(3)]);
    await addCrewMember(db, trip.id, { name: 'Neu', email: 'neu@x.de' });
    await addBoat(db, trip.id, { name: 'Dritte' });
    await setTripCover(db, trip.id, photo(4));
    const k = await addTrack(db, trip.id, { boatId, name: 'l', source: 'live', points: [] });
    await appendTrackPoints(db, k.id, [{ lat: 2, lon: 2 }]);
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
  });
});

describe('access in a shared trip', () => {
  it('the realm owner is admin and may do everything', async () => {
    const { trip } = await sharedTrip();
    db.cloudUser = () => ({ userId: 'alice' });
    expect(await tripAccess(db, trip.id)).toEqual({ userId: 'alice', admin: true, canWrite: true });
  });

  it('a member writes once the membership is accepted and confirmed by the server, but does not manage', async () => {
    const { trip, realmId, boatId } = await sharedTrip();
    await asMember(realmId);
    db.serverRealms = () => ['rlm-public', 'bob'];
    expect(await canWriteTrip(db, trip.id)).toBe(false);
    await expect(createEntry(db, trip.id, { boatId, time: 5, tzOffsetMin: 0 })).rejects.toBeInstanceOf(NotPermittedError);
    expect(await listWritableTripIds(db)).toEqual([]);
    db.serverRealms = () => ['rlm-public', 'bob', realmId];
    expect(await canWriteTrip(db, trip.id)).toBe(true);
    expect(await canManageTrip(db, trip.id)).toBe(false);
    await expect(createEntry(db, trip.id, { boatId, time: 5, tzOffsetMin: 0 })).resolves.toBeDefined();
  });

  it('the member role alone (without explicit permissions) also counts once known locally', async () => {
    const { trip, realmId } = await sharedTrip();
    await asMember(realmId, 'bob', { viaRoleOnly: true });
    expect(await canWriteTrip(db, trip.id)).toBe(true);
  });

  it('a member edits own entries (incl. boat, photos, tombstone) but not those of others', async () => {
    const { trip, realmId, boatId, aliceEntry } = await sharedTrip();
    await asMember(realmId);
    const mine = await createEntry(db, trip.id, { boatId, time: 5, tzOffsetMin: 0 });
    await ownAll('bob', [{ table: db.entries, id: mine.id }]);
    const [, moewe] = (await loadTripData(db, trip.id)).boats;
    await expect(updateEntry(db, mine.id, { text: 'meins', boatId: moewe!.id })).resolves.toMatchObject({ boatId: moewe!.id });
    await expect(addPhotosToEntry(db, mine.id, [photo(7)])).resolves.toHaveLength(1);
    expect(await canEdit(db, (await db.entries.get(mine.id))!)).toBe(true);
    expect(await canEdit(db, (await db.entries.get(aliceEntry.id))!)).toBe(false);
    await expect(updateEntry(db, aliceEntry.id, { text: 'fremd' })).rejects.toBeInstanceOf(NotPermittedError);
    await expect(deleteEntry(db, aliceEntry.id)).rejects.toBeInstanceOf(NotPermittedError);
    await expect(addPhotosToEntry(db, aliceEntry.id, [photo(8)])).rejects.toBeInstanceOf(NotPermittedError);
    await deleteEntry(db, mine.id);
    expect((await db.entries.get(mine.id))?.deletedAt).toBeDefined();
  });

  it('a member writes only the own day report section; the admin may edit every section', async () => {
    const { trip, realmId } = await sharedTrip();
    const bobCrew = await addCrewMember(db, trip.id, { name: 'Bob', email: 'bob@demo.local' });
    const aliceSection = (await loadTripData(db, trip.id)).dayReports[0]!;
    await asMember(realmId);
    expect(await getAuthor(db, trip.id)).toBe(bobCrew.id);
    const own = await upsertDayReport(db, trip.id, '2026-07-01', { text: 'von Bob' });
    expect(own.authorId).toBe(bobCrew.id);
    await expect(upsertDayReport(db, trip.id, '2026-07-01', { text: 'x' }, aliceSection.authorId)).rejects.toBeInstanceOf(NotPermittedError);
    await expect(upsertDayReport(db, trip.id, '2026-07-02', { text: 'x' }, 'someone')).rejects.toBeInstanceOf(NotPermittedError);
    db.cloudUser = () => ({ userId: 'alice' });
    await expect(upsertDayReport(db, trip.id, '2026-07-01', { text: 'Admin' }, bobCrew.id)).resolves.toMatchObject({ text: 'Admin' });
  });

  it('boats, crew, trip data and the cover are admin-only', async () => {
    const { trip, realmId } = await sharedTrip();
    await asMember(realmId);
    await expect(addBoat(db, trip.id, { name: 'X' })).rejects.toBeInstanceOf(NotPermittedError);
    await expect(addCrewMember(db, trip.id, { name: 'X', email: 'x@y.de' })).rejects.toBeInstanceOf(NotPermittedError);
    await expect(updateTrip(db, trip.id, { name: 'X' })).rejects.toBeInstanceOf(NotPermittedError);
    await expect(setTripCover(db, trip.id, photo(9))).rejects.toBeInstanceOf(NotPermittedError);
    await expect(deleteTrip(db, trip.id)).rejects.toBeInstanceOf(NotPermittedError);
    await expect(mergeBundle(db, await loadTripData(db, trip.id))).rejects.toBeInstanceOf(NotPermittedError);
  });

  it('not shared (private realm) while signed in: I am admin', async () => {
    const trip = await createTrip(db, tripInput('T', ['B']));
    db.cloudUser = () => ({ userId: 'bob' });
    expect(await tripAccess(db, trip.id)).toEqual({ userId: 'bob', admin: true, canWrite: true });
  });

  it('local mode: everything allowed', async () => {
    const trip = await createTrip(db, tripInput('T', ['B']));
    expect(await tripAccess(db, trip.id)).toEqual({ admin: true, canWrite: true });
  });
});

describe('mergeBundle keeps realms', () => {
  it('records from a file land in the realm of the local trip; incoming realmId/owner are ignored', async () => {
    const { trip, realmId } = await sharedTrip();
    db.cloudUser = () => ({ userId: 'alice' });
    const bundle = await loadTripData(db, trip.id);
    const foreign = { realmId: 'rlm~evil', owner: 'mallory' };
    const e = { ...bundle.entries[0]!, id: 'e-new', ...foreign, updatedAt: Date.now() + 10 };
    const old = { ...bundle.entries[0]!, text: 'geändert', ...foreign, updatedAt: Date.now() + 10 };
    await mergeBundle(db, { ...bundle, trip: { ...bundle.trip, ...foreign }, entries: [old, e] });
    expect(await realmIdsOf(trip.id)).toEqual(new Set([realmId]));
    const after = await loadTripData(db, trip.id);
    expect(after.entries.find((x) => x.id === old.id)!.text).toBe('geändert');
    expect(after.entries.find((x) => x.id === 'e-new')!.owner).toBeUndefined();
  });
});
