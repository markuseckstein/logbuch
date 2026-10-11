import { describe, expect, it } from 'vitest';
import {
  MEMBER_PERMISSIONS, canEditRecord, canManageRealm, canWriteRealm, isSharedRealm, realmPermissions, tiedRealmId,
  tripIdOfRealm,
} from './access';

const roles = {
  admin: { permissions: { manage: '*' as const } },
  member: { permissions: MEMBER_PERMISSIONS },
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
  it('member role can add entries but not manage', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['member'], accepted: 1 }],
    });
    expect(canWriteRealm(p)).toBe(true);
    expect(canManageRealm(p)).toBe(false);
  });
  it('only accepted memberships count (server rejects writes before the acceptance arrived)', () => {
    const input = (m: object) => realmPermissions({
      realm, userId: 'bob', globalRoles: roles, selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['member'], ...m }],
    });
    expect(canWriteRealm(input({ accepted: undefined }))).toBe(false);
    expect(canWriteRealm(input({ accepted: new Date(), rejected: new Date() }))).toBe(false);
    expect(canWriteRealm(input({ accepted: new Date() }))).toBe(true);
  });
  it('membership rights apply only once the server confirmed the realm (listed in the synced realm set)', () => {
    const input = (confirmedRealms: readonly string[] | undefined) => realmPermissions({
      realm, userId: 'bob', globalRoles: roles, confirmedRealms,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['member'], accepted: 1 }],
    });
    expect(canWriteRealm(input(['rlm-public', 'bob']))).toBe(false);
    expect(canWriteRealm(input(['rlm-public', 'bob', 'rlm~t']))).toBe(true);
    // unknown (no cloud sync state, e.g. local tests): the membership rows decide
    expect(canWriteRealm(input(undefined))).toBe(true);
  });
  it('the realm owner writes even before the server knows the new realm (created in the same sync)', () => {
    const p = realmPermissions({ realm, selfMembers: [], globalRoles: roles, userId: 'alice', confirmedRealms: ['alice'] });
    expect(canManageRealm(p)).toBe(true);
  });
  it('readonly role (zero permissions) cannot write', () => {
    const p = realmPermissions({
      realm, userId: 'carol', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'carol', roles: ['readonly'], accepted: 1 }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('memberships of other realms do not count', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~other', userId: 'bob', roles: ['admin'] }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('without a known realm there are no permissions', () => {
    const p = realmPermissions({
      realm: undefined, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['member'] }],
    });
    expect(canWriteRealm(p)).toBe(false);
  });
  it('merges roles with direct member permissions; unknown roles are ignored', () => {
    const p = realmPermissions({
      realm, userId: 'bob', globalRoles: roles,
      selfMembers: [{ realmId: 'rlm~t', userId: 'bob', roles: ['readonly', 'ghost'], permissions: { add: '*' }, accepted: 1 }],
    });
    expect(canWriteRealm(p)).toBe(true);
  });
  it('add: "*" or manage of entries counts as writable', () => {
    expect(canWriteRealm({ add: '*' })).toBe(true);
    expect(canWriteRealm({ manage: ['entries'] })).toBe(true);
    expect(canWriteRealm({ update: '*' })).toBe(false);
  });
});

describe('MEMBER_PERMISSIONS (Törn-Modell v2)', () => {
  it('members only add: own records are theirs (owner rule), no update of foreign ones, no crew/boats/trips', () => {
    expect(MEMBER_PERMISSIONS).toEqual({ add: ['entries', 'photos', 'dayReports', 'tracks', 'trackChunks'] });
    expect(canWriteRealm(MEMBER_PERMISSIONS)).toBe(true);
    expect(canManageRealm(MEMBER_PERMISSIONS)).toBe(false);
  });
});

describe('canEditRecord', () => {
  it('local mode (nobody signed in): everything is editable', () => {
    expect(canEditRecord({ owner: 'alice' }, { admin: false })).toBe(true);
    expect(canEditRecord({}, { admin: false })).toBe(true);
  });
  it('the admin may edit every record', () => {
    expect(canEditRecord({ owner: 'bob' }, { userId: 'alice', admin: true })).toBe(true);
  });
  it('members edit only their own records', () => {
    const me = { userId: 'bob', admin: false };
    expect(canEditRecord({ owner: 'bob' }, me)).toBe(true);
    expect(canEditRecord({ owner: 'alice' }, me)).toBe(false);
  });
  it('records created before the login (not yet synced) belong to this device', () => {
    const me = { userId: 'bob', admin: false };
    expect(canEditRecord({}, me)).toBe(true);
    expect(canEditRecord({ owner: 'unauthorized' }, me)).toBe(true);
  });
});
