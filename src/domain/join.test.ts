import { describe, expect, it } from 'vitest';
import { buildJoinUrl, decideJoinState, parseJoinEmailParam, parseJoinParam, pickJoinTarget, type JoinInput } from './join';

describe('buildJoinUrl', () => {
  it('joins origin, base path and trip id', () => {
    expect(buildJoinUrl('https://x.github.io', '/logbook/', 't-1')).toBe('https://x.github.io/logbook/?join=t-1');
  });
  it('handles root base and missing slashes', () => {
    expect(buildJoinUrl('http://localhost:4173', '/', 't1')).toBe('http://localhost:4173/?join=t1');
    expect(buildJoinUrl('http://localhost:4173/', '', 't1')).toBe('http://localhost:4173/?join=t1');
  });
  it('encodes the trip id', () => {
    expect(buildJoinUrl('https://a.b', '/', 'a b&c')).toBe('https://a.b/?join=a%20b%26c');
  });
});

describe('parseJoinParam', () => {
  it('reads the join parameter', () => {
    expect(parseJoinParam('?join=t-1')).toBe('t-1');
    expect(parseJoinParam('?x=1&join=a%20b')).toBe('a b');
  });
  it('ignores missing or empty values', () => {
    expect(parseJoinParam('')).toBeUndefined();
    expect(parseJoinParam('?join=')).toBeUndefined();
    expect(parseJoinParam('?x=1')).toBeUndefined();
  });
});

describe('pickJoinTarget', () => {
  const invites = [{ realmId: 'rlm~t1' }, { realmId: 'rlm~t2' }, { realmId: 'other' }];
  it('prefers the trip from the join link', () => {
    expect(pickJoinTarget(invites, 't2')).toBe('t2');
  });
  it('falls back to the first trip invite', () => {
    expect(pickJoinTarget(invites, 'missing')).toBe('t1');
    expect(pickJoinTarget(invites, undefined)).toBe('t1');
  });
  it('is undefined without trip invites', () => {
    expect(pickJoinTarget([{ realmId: 'other' }], 't1')).toBeUndefined();
    expect(pickJoinTarget([], undefined)).toBeUndefined();
  });
});

describe('personal join link', () => {
  it('appends the url-encoded email', () => {
    expect(buildJoinUrl('https://a.b', '/logbook/', 't1', 'bob+x@demo.local')).toBe(
      'https://a.b/logbook/?join=t1&email=bob%2Bx%40demo.local',
    );
  });
  it('omits an empty email', () => {
    expect(buildJoinUrl('https://a.b', '/', 't1', '')).toBe('https://a.b/?join=t1');
  });
  it('parses the email parameter', () => {
    expect(parseJoinEmailParam('?join=t1&email=bob%2Bx%40demo.local')).toBe('bob+x@demo.local');
    expect(parseJoinEmailParam('?join=t1')).toBeUndefined();
    expect(parseJoinEmailParam('?email=')).toBeUndefined();
  });
});

describe('decideJoinState', () => {
  const base: JoinInput = { loggedIn: true, synced: true, settled: false, accepting: false, openInvites: 0, tripIds: [], wantedTripId: undefined };
  it('is signed-out without login', () => {
    expect(decideJoinState({ ...base, loggedIn: false })).toEqual({ kind: 'signed-out' });
  });
  it('accepts open invitations first', () => {
    expect(decideJoinState({ ...base, openInvites: 1 })).toEqual({ kind: 'accepting' });
    expect(decideJoinState({ ...base, accepting: true, tripIds: ['t1'] })).toEqual({ kind: 'accepting' });
  });
  it('re-login: already member without invitation activates the wanted trip', () => {
    expect(decideJoinState({ ...base, tripIds: ['t1', 't2'], wantedTripId: 't2' })).toEqual({ kind: 'activate', tripId: 't2' });
  });
  it('re-login without wanted trip activates the first trip', () => {
    expect(decideJoinState({ ...base, tripIds: ['t1', 't2'] })).toEqual({ kind: 'activate', tripId: 't1' });
  });
  it('waits for a missing wanted trip while syncing or not settled', () => {
    expect(decideJoinState({ ...base, synced: false, tripIds: ['t1'], wantedTripId: 'x' })).toEqual({ kind: 'waiting' });
    expect(decideJoinState({ ...base, tripIds: ['t1'], wantedTripId: 'x' })).toEqual({ kind: 'waiting' });
  });
  it('wanted trip missing but other trip present: switch with notice once settled', () => {
    expect(decideJoinState({ ...base, settled: true, tripIds: ['t1'], wantedTripId: 'x' })).toEqual({
      kind: 'activate',
      tripId: 't1',
      notice: 'not-member',
    });
  });
  it('nothing at all: waiting, then no-invite after sync and wait time', () => {
    expect(decideJoinState(base)).toEqual({ kind: 'waiting' });
    expect(decideJoinState({ ...base, synced: false, settled: true })).toEqual({ kind: 'waiting' });
    expect(decideJoinState({ ...base, settled: true })).toEqual({ kind: 'no-invite' });
    expect(decideJoinState({ ...base, settled: true, wantedTripId: 'x' })).toEqual({ kind: 'no-invite' });
  });
});
