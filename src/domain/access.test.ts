import { describe, expect, it } from 'vitest';
import { canManageRealm, canWriteRealm, isSharedRealm, realmPermissions, tiedRealmId, tripIdOfRealm } from './access';

const roles = {
  skipper: { permissions: { manage: '*' as const } },
  crew: {
    permissions: {
      add: ['crewMembers', 'entries', 'photos', 'dayReports', 'tracks', 'trackChunks'],
      update: { trips: '*' as const, entries: '*' as const },
    },
  },
  readonly: { permissions: {} },
};

describe('realm ids', () => {
  it('ties a realm to a trip id like Dexie Cloud getTiedRealmId', () => {
    expect(tiedRealmId('abc')).toBe('rlm~abc');
    expect(tripIdOfRealm('rlm~abc')).toBe('abc');
    expect(tripIdOfRealm('usr-1')).toBeUndefined();
  });
  it('only tied realms count as shared (private realm = user id, local = undefined/unauthorized)', () => {
    expect(isSharedRealm('rlm~abc')).toBe(true);
    expect(isSharedRealm('alice@demo.local')).toBe(false);
    expect(isSharedRealm('unauthorized')).toBe(false);
    expect(isSharedRealm(undefined)).toBe(false);
  });
});

describe('realmPermissions', () => {
  const realm = { realmId: 'rlm~t', owner: 'alice' };
  it('the realm owner may manage everything', () => {
    const p = realmPermissions({ realm, selfMembers: [], globalRoles: roles, userId: 'alice' });
    expect(canManageRealm(p)).toBe(true);
    expect(canWriteRealm(p)).toBe(true);
  });
  it('crew role can write entries but not manage', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['crew'] }],
    });
    expect(canWriteRealm(p)).toBe(true);
    expect(canManageRealm(p)).toBe(false);
  });
  it('readonly role (zero permissions) cannot write', () => {
    const p = realmPermissions({
      realm, userId: 'carol', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'carol', roles: ['readonly'] }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('memberships of other realms do not count', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~other', userId: 'bob', roles: ['skipper'] }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('without a known realm there are no permissions', () => {
    const p = realmPermissions({
      realm: undefined, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['crew'] }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('merges roles with direct member permissions; unknown roles are ignored', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['readonly', 'ghost'], permissions: { add: '*' } }],
    });
    expect(canWriteRealm(p)).toBe(true);
  });
  it('add: "*" or manage of entries counts as writable', () => {
    expect(canWriteRealm({ add: '*' })).toBe(true);
    expect(canWriteRealm({ manage: ['entries'] })).toBe(true);
    expect(canWriteRealm({ update: '*' })).toBe(false);
  });
});
