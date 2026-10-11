import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tiedRealmId } from '../domain/access';
import type { LogbookDB } from './db';
import {
  CloudNotSignedInError, adoptOwnTrips, cloudStatus, createHomeView, disableHomeView, getHomeView, inviteToTrip, isDemoEmail,
  leaveTrip, listPeople, login, logout, memberStatus, removePerson, renewHomeView, shareTripToCloud, watchSyncRejections,
} from './cloud';
import { listRescued, resubmitRescued } from './syncRejections';
import { DuplicateEmailError, NotPermittedError, createEntry, createTrip, getDeviceId, getSettings, listCrew, loadTripData } from './repo';
import { boatIds, dispose, firstBoat, freshDb, tripInput } from './test-helpers';

let db: LogbookDB;
const cloud = { login: vi.fn(async () => undefined), logout: vi.fn(async () => undefined), sync: vi.fn(async () => undefined) };

beforeEach(() => {
  db = freshDb();
  Object.defineProperty(db, 'cloudEnabled', { value: true, configurable: true });
  Object.defineProperty(db, 'cloud', { value: cloud, configurable: true });
  vi.clearAllMocks();
});
afterEach(async () => { await dispose(db); });

const signIn = (userId = 'alice', email = 'alice@demo.local') => { db.cloudUser = () => ({ userId, email }); };

describe('cloudStatus', () => {
  it('local mode without cloud url', () => {
    expect(cloudStatus(false, undefined, undefined)).toBe('local');
  });
  it('not signed in', () => {
    expect(cloudStatus(true, { isLoggedIn: false }, undefined)).toBe('signed-out');
  });
  it('maps sync phases', () => {
    const u = { isLoggedIn: true };
    expect(cloudStatus(true, u, { status: 'connected', phase: 'in-sync' })).toBe('in-sync');
    expect(cloudStatus(true, u, { status: 'connected', phase: 'pushing' })).toBe('syncing');
    expect(cloudStatus(true, u, { status: 'connecting', phase: 'initial' })).toBe('syncing');
    expect(cloudStatus(true, u, { status: 'offline', phase: 'offline' })).toBe('offline');
    expect(cloudStatus(true, u, { status: 'error', phase: 'error' })).toBe('error');
    expect(cloudStatus(true, u, { status: 'connected', phase: 'in-sync', license: 'expired' })).toBe('error');
  });
});

describe('login', () => {
  it('uses the e-mail code (OTP) flow for real addresses', async () => {
    await login(db, ' Ann@Example.de ');
    expect(cloud.login).toHaveBeenCalledWith({ email: 'ann@example.de', grant_type: 'otp' });
  });
  it('waits until the database is fully open before logging in (login during the addon start closes the DB)', async () => {
    const calls: string[] = [];
    const open = db.open.bind(db);
    db.open = (async () => { calls.push('open'); return open(); }) as typeof db.open;
    cloud.login.mockImplementationOnce(async () => { calls.push('login'); });
    await login(db, 'a@b.de');
    expect(calls).toEqual(['open', 'login']);
  });
  it('uses demo login for @demo.local test users (E2E, no mail)', async () => {
    expect(isDemoEmail('bob@demo.local')).toBe(true);
    await login(db, 'bob@demo.local');
    expect(cloud.login).toHaveBeenCalledWith({ email: 'bob@demo.local', grant_type: 'demo' });
  });
});

describe('logout', () => {
  it('logs out and keeps the device id (restored after the wipe)', async () => {
    const id = await getDeviceId(db);
    cloud.logout.mockImplementationOnce(async () => { await db.settings.clear(); });
    await logout(db);
    expect(cloud.logout).toHaveBeenCalled();
    expect((await getSettings(db)).deviceId).toBe(id);
    expect((await db.settings.get('deviceId'))?.value).toBe(id);
  });
});

describe('shareTripToCloud', () => {
  it('requires a signed-in user', async () => {
    const trip = await createTrip(db, tripInput('T'));
    await expect(shareTripToCloud(db, trip.id)).rejects.toBeInstanceOf(CloudNotSignedInError);
  });
  it('moves a local trip into its tied realm named after the trip (no own member row: the server adds the owner)', async () => {
    const trip = await createTrip(db, tripInput('Sommer', ['Seeschwalbe']));
    await createEntry(db, trip.id, { boatId: await firstBoat(db, trip.id), time: 1, tzOffsetMin: 0 });
    signIn();
    const realmId = await shareTripToCloud(db, trip.id);
    expect(realmId).toBe(tiedRealmId(trip.id));
    const b = await loadTripData(db, trip.id);
    expect([b.trip, ...b.boats, ...b.entries].every((r) => r.realmId === realmId)).toBe(true);
    expect(await db.realms.get(realmId)).toMatchObject({ name: 'Sommer' });
    expect(await db.members.count()).toBe(0);
  });
});

describe('adoptOwnTrips (after login)', () => {
  it('shares local trips, links my person with the account and sends invitations noted before the login', async () => {
    const trip = await createTrip(db, { ...tripInput('T', ['A', 'B']), founder: { name: 'Alice' } });
    const [, b] = await boatIds(db, trip.id);
    await inviteToTrip(db, trip.id, { email: 'bob@demo.local', suggestedBoatId: b });
    expect(await db.members.count()).toBe(0); // not signed in: only noted
    expect((await listPeople(db, trip.id)).map((p) => [p.name, p.status, p.admin])).toEqual([
      ['Alice', 'accepted', true], ['Bob', 'pending', false],
    ]);
    signIn();
    expect(await adoptOwnTrips(db)).toBe(1);
    await ownRealm(trip.id);
    const realmId = tiedRealmId(trip.id);
    expect((await db.trips.get(trip.id))!.realmId).toBe(realmId);
    expect((await listCrew(db, trip.id))[0]).toMatchObject({ name: 'Alice', email: 'alice@demo.local' });
    const rows = (await db.members.where('realmId').equals(realmId).toArray()).filter((m) => m.email);
    expect(rows.map((m) => [m.email, m.roles, m.permissions])).toEqual([
      ['bob@demo.local', ['member'], { add: ['entries', 'photos', 'dayReports', 'tracks', 'trackChunks'] }],
    ]);
    expect(await adoptOwnTrips(db)).toBe(0); // idempotent
    expect(await db.members.where('realmId').equals(realmId).count()).toBe(2);
  });
});

/** As the server would: the realm owner becomes a member and owns the trip. */
async function ownRealm(tripId: string, owner = 'alice') {
  const realmId = tiedRealmId(tripId);
  await db.realms.update(realmId, { owner });
  await db.trips.update(tripId, { owner });
  await db.members.put({ id: `mmb-owner-${realmId}`, realmId, userId: owner, accepted: new Date() } as never);
}

describe('people and invitations', () => {
  async function shared() {
    signIn();
    const trip = await createTrip(db, { ...tripInput('T', ['A', 'B']), founder: { name: 'Alice' } });
    await ownRealm(trip.id);
    return trip;
  }
  it('invites with person + realm member (role member, explicit rights) in one go; nobody gets a Dexie mail (invite: false)', async () => {
    const trip = await shared();
    const [, b] = await boatIds(db, trip.id);
    await inviteToTrip(db, trip.id, { email: 'Bob@Demo.Local', suggestedBoatId: b });
    await inviteToTrip(db, trip.id, { email: 'carol.k@example.de', name: 'Carol' });
    const people = await listPeople(db, trip.id);
    expect(people.map((p) => [p.name, p.email, p.status, p.admin, p.suggestedBoatId])).toEqual([
      ['Alice', 'alice@demo.local', 'accepted', true, (await boatIds(db, trip.id))[0]],
      ['Bob', 'bob@demo.local', 'invited', false, b],
      ['Carol', 'carol.k@example.de', 'invited', false, undefined],
    ]);
    expect(people[0]!.self).toBe(true);
    const rows = await db.members.where('realmId').equals(tiedRealmId(trip.id)).toArray();
    expect(rows.find((m) => m.email === 'carol.k@example.de')!.invite).toBe(false);
    expect(rows.find((m) => m.email === 'bob@demo.local')).toMatchObject({ invite: false, roles: ['member'], name: 'Bob' });
  });
  it('a failing person write rolls back the realm member too (one transaction)', async () => {
    const trip = await shared();
    await inviteToTrip(db, trip.id, { email: 'bob@demo.local' });
    await expect(inviteToTrip(db, trip.id, { email: 'bob@demo.local' })).rejects.toBeInstanceOf(DuplicateEmailError);
    expect(await db.members.where('email').equals('bob@demo.local').count()).toBe(1);
  });
  it('status follows the realm member (accepted / rejected)', async () => {
    const trip = await shared();
    await inviteToTrip(db, trip.id, { email: 'bob@demo.local' });
    await db.members.where('email').equals('bob@demo.local').modify({ accepted: new Date() });
    expect((await listPeople(db, trip.id))[1]!.status).toBe('accepted');
    await db.members.where('email').equals('bob@demo.local').modify({ rejected: new Date() });
    expect((await listPeople(db, trip.id))[1]!.status).toBe('rejected');
  });
  it('removePerson tombstones the person and deletes the membership', async () => {
    const trip = await shared();
    const bob = await inviteToTrip(db, trip.id, { email: 'bob@demo.local' });
    await removePerson(db, bob.id);
    expect((await listPeople(db, trip.id)).map((p) => p.name)).toEqual(['Alice']);
    expect(await db.members.where('email').equals('bob@demo.local').count()).toBe(0);
  });
  it('leaveTrip removes my own membership only', async () => {
    const trip = await shared();
    await inviteToTrip(db, trip.id, { email: 'bob@demo.local' });
    await db.members.filter((m) => m.email === 'bob@demo.local').modify({ userId: 'bob' });
    signIn('bob', 'bob@demo.local');
    await leaveTrip(db, trip.id);
    expect(await db.members.where('email').equals('bob@demo.local').count()).toBe(0);
    expect(await db.members.count()).toBe(1);
  });
});

describe('Daheim-Link (viewer account)', () => {
  async function shared() {
    signIn();
    const trip = await createTrip(db, { ...tripInput('T', ['A']), founder: { name: 'Alice' } });
    await ownRealm(trip.id);
    return trip;
  }
  const viewerRows = async (tripId: string) =>
    (await db.members.where('realmId').equals(tiedRealmId(tripId)).toArray()).filter((m) => m.email?.startsWith('daheim-'));

  it('admin creates a realm member daheim-<token>@demo.local, role viewer, no rights, no mail – but no person', async () => {
    const trip = await shared();
    expect(await getHomeView(db, trip.id)).toBeUndefined();
    const token = await createHomeView(db, trip.id);
    expect(token).toMatch(/^[a-z2-7]{26}$/);
    const rows = await viewerRows(trip.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: `daheim-${token}@demo.local`, name: 'Daheim', roles: ['viewer'], permissions: {}, invite: false,
    });
    expect((await listCrew(db, trip.id)).map((c) => c.name)).toEqual(['Alice']);
    expect((await listPeople(db, trip.id)).map((p) => p.name)).toEqual(['Alice']);
    expect(await getHomeView(db, trip.id)).toEqual({ token, email: `daheim-${token}@demo.local`, opened: false });
    // idempotent: a second call keeps the link
    expect(await createHomeView(db, trip.id)).toBe(token);
    expect(await viewerRows(trip.id)).toHaveLength(1);
  });

  it('opened once the viewer accepted the membership (automatically on first open)', async () => {
    const trip = await shared();
    const token = await createHomeView(db, trip.id);
    await db.members.where('email').equals(`daheim-${token}@demo.local`).modify({ accepted: new Date() });
    expect((await getHomeView(db, trip.id))?.opened).toBe(true);
  });

  it('renew replaces the member (old link dead), disable removes it', async () => {
    const trip = await shared();
    const old = await createHomeView(db, trip.id);
    const fresh = await renewHomeView(db, trip.id);
    expect(fresh).not.toBe(old);
    expect((await viewerRows(trip.id)).map((m) => m.email)).toEqual([`daheim-${fresh}@demo.local`]);
    await disableHomeView(db, trip.id);
    expect(await viewerRows(trip.id)).toEqual([]);
    expect(await getHomeView(db, trip.id)).toBeUndefined();
    expect((await listPeople(db, trip.id)).map((p) => p.name)).toEqual(['Alice']);
  });

  it('only the admin of a shared trip', async () => {
    const trip = await createTrip(db, tripInput('T', ['A']));
    await expect(createHomeView(db, trip.id)).rejects.toBeInstanceOf(CloudNotSignedInError);
    const s = await shared();
    await db.realms.update(tiedRealmId(s.id), { owner: 'carol' });
    await db.trips.update(s.id, { owner: 'carol' });
    await expect(createHomeView(db, s.id)).rejects.toBeInstanceOf(NotPermittedError);
    await expect(renewHomeView(db, s.id)).rejects.toBeInstanceOf(NotPermittedError);
    await expect(disableHomeView(db, s.id)).rejects.toBeInstanceOf(NotPermittedError);
  });
});

describe('memberStatus', () => {
  it('invited / accepted / rejected', () => {
    expect(memberStatus({})).toBe('invited');
    expect(memberStatus({ accepted: new Date() })).toBe('accepted');
    expect(memberStatus({ rejected: new Date() })).toBe('rejected');
  });
});

describe('watchSyncRejections', () => {
  const URL_ = 'https://x.dexie.cloud';
  let listeners: ((v: unknown) => void)[];
  beforeEach(() => {
    listeners = [];
    Object.defineProperty(db, 'cloud', {
      configurable: true,
      value: {
        ...cloud,
        options: { databaseUrl: URL_ },
        persistedSyncState: {
          subscribe: (fn: (v: unknown) => void) => { listeners.push(fn); return { unsubscribe: () => { listeners = listeners.filter((l) => l !== fn); } }; },
        },
      },
    });
  });

  it('records rejections of /sync responses and restores the rejected entry once the trip is writable', async () => {
    const trip = await createTrip(db, tripInput('T'));
    const e = await createEntry(db, trip.id, { boatId: await firstBoat(db, trip.id), time: 1, tzOffsetMin: 0 });
    await db.entries.update(e.id, { text: 'weg?' });
    const original = globalThis.fetch;
    const body = JSON.stringify({ changes: [], rejections: [{ name: 'PermissionsDeniedError', message: 'not authorized to add entries', txid: 't' }] });
    const mock = vi.fn(async () => new Response(body)) as typeof fetch;
    globalThis.fetch = mock;
    const stop = watchSyncRejections(db, { retryDelayMs: 0 });
    try {
      await fetch(`${URL_}/sync`, { method: 'post', body: JSON.stringify({ changes: [{ table: 'entries', muts: [{ type: 'insert', keys: [e.id], txid: 't' }] }] }) });
      expect(await listRescued(db)).toHaveLength(1);
      await db.entries.delete(e.id); // rollback by the addon
      await resubmitRescued(db, { force: true });
      expect(await db.entries.get(e.id)).toMatchObject({ text: 'weg?' });
    } finally {
      stop();
    }
    expect(globalThis.fetch).toBe(mock); // wrapper removed again
    expect(listeners).toHaveLength(0);
    globalThis.fetch = original;
  });

  it('does nothing in local mode', () => {
    Object.defineProperty(db, 'cloudEnabled', { value: false, configurable: true });
    const before = globalThis.fetch;
    watchSyncRejections(db)();
    expect(globalThis.fetch).toBe(before);
  });
});
