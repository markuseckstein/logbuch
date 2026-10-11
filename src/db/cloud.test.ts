import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tiedRealmId } from '../domain/access';
import type { LogbookDB } from './db';
import {
  CloudNotSignedInError, cloudStatus, inviteMember, isDemoEmail, leaveTrip, listMembers, login, logout, memberStatus,
  removeMember, shareTripToCloud,
} from './cloud';
import { createEntry, createTrip, getDeviceId, getSettings, loadTripData } from './repo';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
const cloud = { login: vi.fn(async () => undefined), logout: vi.fn(async () => undefined), sync: vi.fn(async () => undefined) };

beforeEach(() => {
  db = freshDb();
  Object.defineProperty(db, 'cloudEnabled', { value: true });
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
    const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
    await expect(shareTripToCloud(db, trip.id)).rejects.toBeInstanceOf(CloudNotSignedInError);
  });
  it('moves the trip into its tied realm and names the realm after the boat (no own member row: the server adds the owner)', async () => {
    signIn();
    const trip = await createTrip(db, { name: 'T', boat: { name: 'Seeschwalbe' }, crew: [] });
    await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 });
    const realmId = await shareTripToCloud(db, trip.id);
    expect(realmId).toBe(tiedRealmId(trip.id));
    const b = await loadTripData(db, trip.id);
    expect([b.trip, ...b.entries].every((r) => r.realmId === realmId)).toBe(true);
    expect(await db.realms.get(realmId)).toMatchObject({ name: 'Seeschwalbe' });
    expect(await db.members.count()).toBe(0);
  });
  it('lists the realm owner (server-created member without roles) as skipper', async () => {
    signIn();
    const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
    const realmId = await shareTripToCloud(db, trip.id);
    await db.realms.update(realmId, { owner: 'alice' });
    await db.members.add({ id: `mmb-owner-${realmId}`, realmId, userId: 'alice', accepted: new Date() } as never);
    expect(await listMembers(db, trip.id)).toMatchObject([{ roles: ['skipper'], status: 'accepted', self: true }]);
  });
});

describe('members', () => {
  async function shared() {
    signIn();
    const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
    const realmId = await shareTripToCloud(db, trip.id);
    // wie der Server: Realm-Owner wird Mitglied
    await db.realms.update(realmId, { owner: 'alice' });
    await db.members.add({ id: `mmb-owner-${realmId}`, realmId, userId: 'alice', email: 'alice@demo.local', accepted: new Date() } as never);
    return trip;
  }
  it('invites crew (writes along) and other boats (read only) into the realm of the trip', async () => {
    const trip = await shared();
    await inviteMember(db, trip.id, { email: 'Bob@Demo.Local', role: 'crew', name: 'Bob' });
    await inviteMember(db, trip.id, { email: 'carol@example.de', role: 'readonly' });
    const members = await listMembers(db, trip.id);
    expect(members.map((m) => [m.email, m.roles, m.status])).toEqual([
      ['alice@demo.local', ['skipper'], 'accepted'],
      ['bob@demo.local', ['crew'], 'invited'],
      ['carol@example.de', ['readonly'], 'invited'],
    ]);
    const rows = await db.members.where('realmId').equals(tiedRealmId(trip.id)).toArray();
    // real addresses get the invitation mail, demo users do not
    expect(rows.find((m) => m.email === 'carol@example.de')!.invite).toBe(true);
    expect(rows.find((m) => m.email === 'bob@demo.local')!.invite).toBe(false);
  });
  it('rejects inviting into a trip that is not in the cloud', async () => {
    signIn();
    const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
    await expect(inviteMember(db, trip.id, { email: 'b@x.de', role: 'crew' })).rejects.toThrow();
  });
  it('removeMember deletes the membership', async () => {
    const trip = await shared();
    await inviteMember(db, trip.id, { email: 'bob@demo.local', role: 'crew' });
    const bob = (await listMembers(db, trip.id)).find((m) => m.email === 'bob@demo.local')!;
    await removeMember(db, bob.id);
    expect((await listMembers(db, trip.id)).map((m) => m.email)).toEqual(['alice@demo.local']);
  });
  it('leaveTrip removes my own membership only', async () => {
    const trip = await shared();
    await inviteMember(db, trip.id, { email: 'bob@demo.local', role: 'crew' });
    await db.members.filter((m) => m.email === 'bob@demo.local').modify({ userId: 'bob' });
    signIn('bob', 'bob@demo.local');
    await leaveTrip(db, trip.id);
    expect((await listMembers(db, trip.id)).map((m) => m.email)).toEqual(['alice@demo.local']);
  });
});

describe('memberStatus', () => {
  it('invited / accepted / rejected', () => {
    expect(memberStatus({})).toBe('invited');
    expect(memberStatus({ accepted: new Date() })).toBe('accepted');
    expect(memberStatus({ rejected: new Date() })).toBe('rejected');
  });
});
