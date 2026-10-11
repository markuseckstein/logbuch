import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoinParam, pickJoinTarget } from './join';

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
