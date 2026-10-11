/**
 * Schreibrechte in Dexie-Cloud-Realms, rein berechnet aus lokal synchronisierten Tabellen
 * (realms, members, roles). Spiegelt die Logik von dexie-cloud-addon (getPermissionsLookupObservable,
 * PermissionChecker), damit Repo und UI dieselbe, synchron prüfbare Regel nutzen.
 */

export type TableList = '*' | string[];

export interface PermissionSet {
  add?: TableList;
  update?: '*' | Record<string, TableList>;
  manage?: TableList;
}

export interface RealmLike {
  realmId: string;
  owner?: string;
}

export interface MemberLike {
  realmId: string;
  userId?: string;
  roles?: string[];
  permissions?: PermissionSet;
}

export interface RealmAccessInput {
  /** Realm-Zeile (fehlt sie lokal, gibt es keine Rechte). */
  realm: RealmLike | undefined;
  /** Mitgliedschaften des angemeldeten Nutzers (members mit userId = Nutzer). */
  selfMembers: readonly MemberLike[];
  /** Globale Rollen (Realm 'rlm-public') nach Name. */
  globalRoles: Readonly<Record<string, { permissions: PermissionSet }>>;
  userId: string;
}

const TIED_PREFIX = 'rlm~';

/** Wie `getTiedRealmId` aus dexie-cloud-addon: ein Realm je Boot-Logbuch, auf allen Geräten gleich. */
export function tiedRealmId(tripId: string): string {
  return TIED_PREFIX + tripId;
}

export function tripIdOfRealm(realmId: string): string | undefined {
  return realmId.startsWith(TIED_PREFIX) ? realmId.slice(TIED_PREFIX.length) : undefined;
}

/** In der Cloud geteilt (Boots-Realm) – im Gegensatz zu lokal/privat. */
export function isSharedRealm(realmId: string | undefined): boolean {
  return realmId !== undefined && realmId.startsWith(TIED_PREFIX);
}

function mergeLists(a: TableList | undefined, b: TableList | undefined): TableList | undefined {
  if (a === '*' || b === '*') return '*';
  if (!a) return b;
  if (!b) return a;
  return [...new Set([...a, ...b])];
}

function mergeSets(sets: readonly PermissionSet[]): PermissionSet {
  const out: PermissionSet = {};
  for (const s of sets) {
    const add = mergeLists(out.add, s.add);
    if (add) out.add = add;
    const manage = mergeLists(out.manage, s.manage);
    if (manage) out.manage = manage;
    if (s.update) {
      if (out.update === '*' || s.update === '*') out.update = '*';
      else {
        const u: Record<string, TableList> = { ...(out.update ?? {}) };
        for (const [table, props] of Object.entries(s.update)) u[table] = mergeLists(u[table], props) ?? props;
        out.update = u;
      }
    }
  }
  return out;
}

export function realmPermissions({ realm, selfMembers, globalRoles, userId }: RealmAccessInput): PermissionSet {
  if (!realm) return {};
  if (realm.owner === userId) return { manage: '*' };
  const mine = selfMembers.filter((m) => m.realmId === realm.realmId && (m.userId === undefined || m.userId === userId));
  const sets: PermissionSet[] = [];
  for (const m of mine) {
    if (m.permissions) sets.push(m.permissions);
    for (const role of m.roles ?? []) {
      const r = globalRoles[role];
      if (r) sets.push(r.permissions);
    }
  }
  return mergeSets(sets);
}

const includes = (list: TableList | undefined, table: string): boolean =>
  list === '*' || (Array.isArray(list) && list.includes(table));

/** Darf Einträge anlegen = schreibt im Logbuch mit (Crew, Skipper). */
export function canWriteRealm(p: PermissionSet): boolean {
  return includes(p.manage, 'entries') || includes(p.add, 'entries');
}

/** Darf alles, auch Mitglieder einladen/entfernen (Skipper bzw. Realm-Besitzer). */
export function canManageRealm(p: PermissionSet): boolean {
  return p.manage === '*';
}
