import type { DBRealmMember } from 'dexie-cloud-addon';
import { tiedRealmId, isSharedRealm } from '../domain/access';
import type { ID } from '../domain/types';
import type { LogbookDB } from './db';
import { getDeviceId, moveTripToRealm, resetDeviceIdCache } from './repo';

/**
 * Dexie-Cloud-Funktionen der App (Stufe 2). Konfiguration: `cloudConfig.ts` (aus `db.ts` beim Erzeugen der DB).
 * Rechte und Realm-Umzug liegen im Repo (`canWriteTrip`, `moveTripToRealm`), damit sie auch lokal testbar sind.
 */

export class CloudNotSignedInError extends Error {
  constructor() {
    super('Not signed in to Dexie Cloud');
    this.name = 'CloudNotSignedInError';
  }
}

/** Rollen aus roles.json: Crew schreibt mit, andere Boote der Flottille lesen nur. */
export type InviteRole = 'crew' | 'readonly';
export type MemberRole = InviteRole | 'skipper';

/** Anzeigestatus für Törn-Tab und Topbar. */
export type CloudStatus = 'local' | 'signed-out' | 'syncing' | 'in-sync' | 'offline' | 'error';

export interface SyncStateLike {
  status: string;
  phase: string;
  license?: 'ok' | 'expired' | 'deactivated';
}

export function cloudStatus(
  enabled: boolean, user: { isLoggedIn?: boolean } | undefined, sync: SyncStateLike | undefined,
): CloudStatus {
  if (!enabled) return 'local';
  if (!user?.isLoggedIn) return 'signed-out';
  if (!sync) return 'syncing';
  if (sync.license && sync.license !== 'ok') return 'error';
  if (sync.phase === 'error' || sync.status === 'error') return 'error';
  if (sync.phase === 'offline' || sync.status === 'offline') return 'offline';
  if (sync.phase === 'in-sync') return 'in-sync';
  return 'syncing';
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Test-Nutzer (Demo-Accounts der Cloud-DB): Login ohne E-Mail-Code, Einladung ohne Mail. */
export function isDemoEmail(email: string): boolean {
  return normalizeEmail(email).endsWith('@demo.local');
}

/** Startet die Anmeldung; mit `customLoginGui` fragt das Addon den Code über `db.cloud.userInteraction` ab. */
export async function login(db: LogbookDB, email: string): Promise<void> {
  const e = normalizeEmail(email);
  await db.cloud.login({ email: e, grant_type: isDemoEmail(e) ? 'demo' : 'otp' });
}

/**
 * Abmelden: Dexie Cloud leert dabei alle lokalen Tabellen (Daten bleiben in der Cloud).
 * Die Geräte-ID wird aus localStorage wiederhergestellt.
 */
export async function logout(db: LogbookDB): Promise<void> {
  await db.cloud.logout();
  resetDeviceIdCache(db);
  await getDeviceId(db);
}

function requireUser(db: LogbookDB): { userId: string; email?: string } {
  const user = db.cloudUser();
  if (!user) throw new CloudNotSignedInError();
  return user;
}

/** Member-ID: Dexie Cloud vergibt sie selbst (`@id`, Präfix mmb); ohne Addon (Tests) eine eigene. */
function memberIdFields(db: LogbookDB): { id?: string } {
  return db.cloudEnabled && typeof db.members.newId === 'function' ? {} : { id: `mmb-${crypto.randomUUID()}` };
}

/**
 * „Logbuch in die Cloud bringen“: Realm des Boots anlegen (`rlm~<tripId>`), Trip samt Crew, Einträgen,
 * Fotos, Berichten und Tracks hineinverschieben und mich als Skipper eintragen. Idempotent.
 */
export async function shareTripToCloud(db: LogbookDB, tripId: ID): Promise<string> {
  const user = requireUser(db);
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`Trip not found: ${tripId}`);
  const realmId = tiedRealmId(tripId);
  await moveTripToRealm(db, tripId, realmId, { name: trip.boat.name.trim() || trip.name, represents: 'ein Bordbuch' });
  // Eigene Mitgliedschaft (Skipper) in eigener Transaktion: lehnt der Server sie ab, bleibt der Umzug bestehen.
  await db.transaction('rw', db.members, async () => {
    const mine = await db.members.where('[userId+realmId]').equals([user.userId, realmId]).count();
    if (mine > 0) return;
    await db.members.add({
      ...memberIdFields(db), realmId, userId: user.userId, ...(user.email ? { email: user.email } : {}),
      roles: ['skipper'], accepted: new Date(),
    } as DBRealmMember);
  });
  return realmId;
}

export interface InviteInput {
  email: string;
  role: InviteRole;
  name?: string;
}

async function sharedRealmOf(db: LogbookDB, tripId: ID): Promise<string> {
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId)) throw new Error('Das Logbuch ist noch nicht in der Cloud.');
  return trip.realmId!;
}

/** Lädt per E-Mail in das Logbuch ein (Mail nur für echte Adressen; Demo-Nutzer sehen die Einladung nach dem Login). */
export async function inviteMember(db: LogbookDB, tripId: ID, input: InviteInput): Promise<void> {
  const realmId = await sharedRealmOf(db, tripId);
  const email = normalizeEmail(input.email);
  await db.members.add({
    ...memberIdFields(db), realmId, email, ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    roles: [input.role], invite: !isDemoEmail(email),
  } as DBRealmMember);
}

export type MemberStatus = 'invited' | 'accepted' | 'rejected';

export function memberStatus(m: { accepted?: Date | undefined; rejected?: Date | undefined }): MemberStatus {
  if (m.rejected) return 'rejected';
  if (m.accepted) return 'accepted';
  return 'invited';
}

export interface MemberInfo {
  id: string;
  email?: string;
  name?: string;
  roles: string[];
  status: MemberStatus;
  /** Das bin ich (angemeldeter Nutzer). */
  self: boolean;
}

export async function listMembers(db: LogbookDB, tripId: ID): Promise<MemberInfo[]> {
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId)) return [];
  const user = db.cloudUser();
  const rows = await db.members.where('realmId').equals(trip.realmId!).toArray();
  const rank = (m: DBRealmMember): number => (m.roles?.includes('skipper') ? 0 : m.roles?.includes('crew') ? 1 : 2);
  return rows
    .filter((m): m is DBRealmMember & { id: string } => typeof m.id === 'string')
    .sort((a, b) => rank(a) - rank(b) || (a.email ?? '').localeCompare(b.email ?? ''))
    .map((m) => ({
      id: m.id,
      ...(m.email ? { email: m.email } : {}),
      ...(m.name ? { name: m.name } : {}),
      roles: m.roles ?? [],
      status: memberStatus(m),
      self: !!user && (m.userId === user.userId || (!!user.email && m.email === user.email.toLowerCase())),
    }));
}

/** Mitglied entfernen (nur Skipper; der Server setzt das durch). */
export async function removeMember(db: LogbookDB, memberId: string): Promise<void> {
  await db.members.delete(memberId);
}

/** Eigene Mitgliedschaft beenden: das Logbuch synchronisiert danach nicht mehr auf meine Geräte. */
export async function leaveTrip(db: LogbookDB, tripId: ID): Promise<void> {
  const user = requireUser(db);
  const realmId = await sharedRealmOf(db, tripId);
  await db.members.where('[userId+realmId]').equals([user.userId, realmId]).delete();
}
