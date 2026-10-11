import type { DBRealmMember } from 'dexie-cloud-addon';
import { tiedRealmId, isSharedRealm } from '../domain/access';
import type { ID } from '../domain/types';
import type { LogbookDB } from './db';
import { getDeviceId, moveTripToRealm, resetDeviceIdCache } from './repo';
import { MAX_AUTO_ATTEMPTS, listRescued, recordSyncExchange, resubmitRescued, wrapSyncFetch } from './syncRejections';

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
  // Spike: ein Login während der Startphase des Addons (db.on.ready) schließt die Datenbank dauerhaft.
  await db.open();
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
 * Fotos, Berichten und Tracks hineinverschieben. Idempotent. Kein eigener Mitglieds-Eintrag: der Server
 * legt für den Realm-Owner selbst `mmb-owner-<realmId>` an (Spike 2026-10-11); der Owner hat `manage: *`.
 */
export async function shareTripToCloud(db: LogbookDB, tripId: ID): Promise<string> {
  requireUser(db);
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`Trip not found: ${tripId}`);
  const realmId = tiedRealmId(tripId);
  await moveTripToRealm(db, tripId, realmId, { name: trip.boat.name.trim() || trip.name, represents: 'ein Bordbuch' });
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
  const realm = await db.realms.get(trip.realmId!);
  const rolesOf = (m: DBRealmMember): string[] =>
    m.roles?.length ? m.roles : m.userId && m.userId === realm?.owner ? ['skipper'] : [];
  const rows = await db.members.where('realmId').equals(trip.realmId!).toArray();
  const rank = (m: DBRealmMember): number => (rolesOf(m).includes('skipper') ? 0 : rolesOf(m).includes('crew') ? 1 : 2);
  return rows
    .filter((m): m is DBRealmMember & { id: string } => typeof m.id === 'string')
    .sort((a, b) => rank(a) - rank(b) || (a.email ?? '').localeCompare(b.email ?? ''))
    .map((m) => ({
      id: m.id,
      ...(m.email ? { email: m.email } : {}),
      ...(m.name ? { name: m.name } : {}),
      roles: rolesOf(m),
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

export interface RejectionWatchOptions {
  /** Erste Prüfung nach einer Ablehnung (ms); danach Backoff in `resubmitRescued`. */
  retryDelayMs?: number;
}

/**
 * Vom Server abgelehnte Änderungen nicht verlieren: liest jede Sync-Antwort mit, sichert abgelehnte
 * Datensätze und schreibt sie erneut, sobald die Rechte wirken (z. B. frisch angenommene Mitgliedschaft,
 * die der Server noch nicht überall berücksichtigt). Liefert eine Funktion zum Beenden.
 */
export function watchSyncRejections(db: LogbookDB, opts: RejectionWatchOptions = {}): () => void {
  if (!db.cloudEnabled) return () => undefined;
  const databaseUrl = db.cloud.options?.databaseUrl;
  if (!databaseUrl) return () => undefined;
  const delay = opts.retryDelayMs ?? 2500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const retry = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await resubmitRescued(db);
      const pending = (await listRescued(db)).filter((i) => i.state === 'pending' && i.attempts < MAX_AUTO_ATTEMPTS);
      if (pending.length > 0) schedule();
    } catch {
      // nächster Versuch beim nächsten Sync
    } finally {
      running = false;
    }
  };
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void retry();
    }, delay);
  };

  const original = globalThis.fetch;
  const wrapped = wrapSyncFetch(original.bind(globalThis), databaseUrl, async (req, res) => {
    const r = await recordSyncExchange(db, req, res);
    if (r.rejected > 0) {
      console.warn(`Dexie Cloud: ${r.rejected} Änderung(en) abgelehnt – lokal gesichert, erneuter Versuch folgt`);
      schedule();
    }
  });
  globalThis.fetch = wrapped;
  // jede neue Server-Bestätigung (Realms, Mitgliedschaften) kann ein Logbuch beschreibbar machen
  const sub = db.cloud.persistedSyncState.subscribe(() => void retry());
  return () => {
    sub.unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
  };
}
