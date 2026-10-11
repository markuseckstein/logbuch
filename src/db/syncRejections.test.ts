import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tiedRealmId } from '../domain/access';
import type { LogbookDB } from './db';
import { createEntry, createTrip, moveTripToRealm, setTripOwnership, updateEntry } from './repo';
import {
  discardRescued, listRescued, recordSyncExchange, resubmitRescued, wrapSyncFetch,
} from './syncRejections';
import { dispose, freshDb } from './test-helpers';

let db: LogbookDB;
beforeEach(() => { db = freshDb(); });
afterEach(async () => { await dispose(db); });

const DENIED = 'User bob is not authorized to add entries in realm rlm~t';

const req = (table: string, muts: object[]) => JSON.stringify({ changes: [{ table, muts }] });
const res = (rejections: object[]) => JSON.stringify({ changes: [], rejections });

async function tripWithEntry() {
  const trip = await createTrip(db, { name: 'T', boat: { name: 'B' }, crew: [] });
  const e = await updateEntry(db, (await createEntry(db, trip.id, { time: 1, tzOffsetMin: 0 })).id, { text: 'Bob übernimmt' });
  return { trip, e };
}

describe('recordSyncExchange', () => {
  it('keeps a copy of rejected rows (taken before the addon rolls them back)', async () => {
    const { e } = await tripWithEntry();
    const r = await recordSyncExchange(db, req('entries', [{ type: 'insert', keys: [e.id], txid: 't1' }]),
      res([{ name: 'PermissionsDeniedError', message: DENIED, txid: 't1' }]), 1000);
    expect(r).toEqual({ rejected: 1, confirmed: 0 });
    const [item] = await listRescued(db);
    expect(item).toMatchObject({ table: 'entries', key: e.id, type: 'insert', reason: DENIED, at: 1000, attempts: 1, state: 'pending' });
    expect(item!.row).toMatchObject({ id: e.id, text: 'Bob übernimmt' });
  });
  it('ignores accepted exchanges, access tables and rejected deletes (nothing to lose)', async () => {
    const { e } = await tripWithEntry();
    await recordSyncExchange(db, req('entries', [{ type: 'insert', keys: [e.id], txid: 't1' }]), res([]));
    await recordSyncExchange(db, req('members', [{ type: 'update', keys: ['m1'], txid: 't2' }]), res([{ message: 'x', txid: 't2' }]));
    await recordSyncExchange(db, req('entries', [{ type: 'delete', keys: [e.id], txid: 't3' }]), res([{ message: 'x', txid: 't3' }]));
    expect(await listRescued(db)).toEqual([]);
  });
  it('tolerates unreadable bodies', async () => {
    await expect(recordSyncExchange(db, undefined, 'garbage')).resolves.toEqual({ rejected: 0, confirmed: 0 });
  });
  it('a second rejection counts the attempt and keeps the copy if the row is gone locally', async () => {
    const { e } = await tripWithEntry();
    const body = req('entries', [{ type: 'insert', keys: [e.id], txid: 't1' }]);
    await recordSyncExchange(db, body, res([{ message: DENIED, txid: 't1' }]), 1000);
    await db.entries.delete(e.id); // rollback by the addon
    await recordSyncExchange(db, body, res([{ message: DENIED, txid: 't1' }]), 2000);
    const [item] = await listRescued(db);
    expect(item).toMatchObject({ attempts: 2, at: 2000 });
    expect(item!.row).toMatchObject({ text: 'Bob übernimmt' });
  });
  it('a re-sent change that the server accepted is confirmed and removed', async () => {
    const { trip, e } = await tripWithEntry();
    await recordSyncExchange(db, req('entries', [{ type: 'insert', keys: [e.id], txid: 't1' }]), res([{ message: DENIED, txid: 't1' }]), 0);
    await db.entries.delete(e.id);
    await setTripOwnership(db, trip.id, 'own');
    expect(await resubmitRescued(db, { now: 10_000 })).toBe(1);
    // still waiting for the server: not confirmed yet
    expect((await listRescued(db))[0]).toMatchObject({ state: 'resent' });
    const r = await recordSyncExchange(db, req('entries', [{ type: 'upsert', keys: [e.id], txid: 't9' }]), res([]));
    expect(r.confirmed).toBe(1);
    expect(await listRescued(db)).toEqual([]);
  });
});

describe('resubmitRescued', () => {
  async function rejectedEntry(at = 0) {
    const t = await tripWithEntry();
    await recordSyncExchange(db, req('entries', [{ type: 'insert', keys: [t.e.id], txid: 't1' }]), res([{ message: DENIED, txid: 't1' }]), at);
    await db.entries.delete(t.e.id); // the addon's rollback
    return t;
  }

  it('restores a rolled-back entry as soon as the trip is writable again', async () => {
    const { trip, e } = await rejectedEntry();
    await setTripOwnership(db, trip.id, 'foreign');
    expect(await resubmitRescued(db, { now: 60_000 })).toBe(0);
    expect(await db.entries.get(e.id)).toBeUndefined();
    await setTripOwnership(db, trip.id, 'own');
    expect(await resubmitRescued(db, { now: 60_000 })).toBe(1);
    expect(await db.entries.get(e.id)).toMatchObject({ id: e.id, text: 'Bob übernimmt' });
  });
  it('waits for the shared realm to be confirmed by the server (membership rights in effect)', async () => {
    const { trip, e } = await rejectedEntry();
    const realmId = tiedRealmId(trip.id);
    await moveTripToRealm(db, trip.id, realmId, { name: 'B', represents: 'x' });
    await db.realms.update(realmId, { owner: 'alice' });
    await db.roles.put({ realmId: 'rlm-public', name: 'crew', permissions: { add: ['entries'] } } as never);
    await db.members.put({ id: 'm', realmId, userId: 'bob', roles: ['crew'], accepted: new Date() } as never);
    db.cloudUser = () => ({ userId: 'bob' });
    db.serverRealms = () => ['bob'];
    expect(await resubmitRescued(db, { now: 60_000 })).toBe(0);
    db.serverRealms = () => ['bob', realmId];
    expect(await resubmitRescued(db, { now: 60_000 })).toBe(1);
    expect(await db.entries.get(e.id)).toMatchObject({ realmId });
  });
  it('backs off between automatic attempts and stops after a few; a manual retry forces it', async () => {
    await rejectedEntry(0);
    expect(await resubmitRescued(db, { now: 500 })).toBe(0); // too early
    expect(await resubmitRescued(db, { now: 2_000 })).toBe(1);
    const body = req('entries', [{ type: 'upsert', keys: [(await listRescued(db))[0]!.key], txid: 'x' }]);
    for (const at of [3_000, 10_000]) await recordSyncExchange(db, body, res([{ message: DENIED, txid: 'x' }]), at);
    expect((await listRescued(db))[0]).toMatchObject({ attempts: 3, state: 'pending' });
    expect(await resubmitRescued(db, { now: 1e9 })).toBe(0); // gave up automatically
    expect(await resubmitRescued(db, { now: 1e9, force: true })).toBe(1);
  });
  it('re-applies only the rejected fields of an update to the current row', async () => {
    const { e } = await tripWithEntry();
    await updateEntry(db, e.id, { text: 'neu' });
    await recordSyncExchange(db, req('entries', [{ type: 'update', keys: [e.id], changeSpecs: [{ text: 'neu' }], txid: 't' }]),
      res([{ message: DENIED, txid: 't' }]), 0);
    await db.entries.update(e.id, { text: 'Bob übernimmt', tempC: 20 }); // server version came back + other change
    expect(await resubmitRescued(db, { now: 60_000 })).toBe(1);
    expect(await db.entries.get(e.id)).toMatchObject({ text: 'neu', tempC: 20 });
  });
});

describe('discardRescued', () => {
  it('drops the kept copies', async () => {
    const { e } = await tripWithEntry();
    await recordSyncExchange(db, req('entries', [{ type: 'insert', keys: [e.id], txid: 't1' }]), res([{ message: DENIED, txid: 't1' }]));
    await discardRescued(db);
    expect(await listRescued(db)).toEqual([]);
  });
});

describe('wrapSyncFetch', () => {
  const URL_ = 'https://x.dexie.cloud';
  it('hands request and response body of POST /sync to the observer before returning the response', async () => {
    const calls: string[] = [];
    const inner = vi.fn(async () => new Response('{"rejections":[]}', { status: 200 }));
    const f = wrapSyncFetch(inner, URL_, async (reqBody, resBody) => { calls.push(`${reqBody}|${resBody}`); });
    const r = await f(`${URL_}/sync`, { method: 'post', body: '{"changes":[]}' });
    expect(calls).toEqual(['{"changes":[]}|{"rejections":[]}']);
    expect(await r.text()).toBe('{"rejections":[]}'); // body still readable for the addon
  });
  it('leaves other requests and failed responses alone; observer errors never break the sync', async () => {
    const seen = vi.fn(async () => { throw new Error('boom'); });
    const ok = wrapSyncFetch(async () => new Response('x'), URL_, seen);
    await ok(`${URL_}/token`, { method: 'post', body: '{}' });
    await ok('https://elsewhere/sync', { method: 'post', body: '{}' });
    expect(seen).not.toHaveBeenCalled();
    const bad = wrapSyncFetch(async () => new Response('err', { status: 500 }), URL_, seen);
    expect((await bad(`${URL_}/sync`, { body: '{}' })).status).toBe(500);
    expect(seen).not.toHaveBeenCalled();
    const throwing = wrapSyncFetch(async () => new Response('{}'), URL_, seen);
    await expect(throwing(`${URL_}/sync`, { body: '{}' })).resolves.toBeInstanceOf(Response);
  });
});
