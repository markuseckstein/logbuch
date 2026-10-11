import type { DBRealmMember } from 'dexie-cloud-addon';
import { MEMBER_PERMISSIONS, tiedRealmId, isSharedRealm } from '../domain/access';
import { nameFromEmail } from '../domain/boats';
import { VIEWER_NAME, VIEWER_ROLE, createHomeViewToken, isViewerEmail, viewerEmail, viewerToken } from '../domain/homeView';
import type { CrewMember, ID } from '../domain/types';
import type { LogbookDB } from './db';
import {
  NotPermittedError, addCrewMember, canManageTrip, getAuthor, getDeviceId, listCrew, moveTripToRealm, normalizeEmail, removeCrewMember, resetDeviceIdCache,
  updateCrewMember,
} from './repo';
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

/** Rollen aus roles.json: Admin = Realm-Owner (legt den Törn an), Mitglieder schreiben eigene Einträge. */
export type MemberRole = 'admin' | 'member';

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
 * Törn in seinen Realm bringen (`rlm~<tripId>`): Trip samt Booten, Personen, Einträgen, Fotos, Berichten und
 * Tracks. Idempotent. Kein eigener Mitglieds-Eintrag: der Server legt für den Realm-Owner selbst
 * `mmb-owner-<realmId>` an (Spike 9.7); der Owner ist Admin (`manage: *`).
 */
export async function shareTripToCloud(db: LogbookDB, tripId: ID): Promise<string> {
  requireUser(db);
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`Trip not found: ${tripId}`);
  const realmId = tiedRealmId(tripId);
  if (trip.realmId !== realmId) await moveTripToRealm(db, tripId, realmId, { name: trip.name.trim(), represents: 'einen Törn' });
  return realmId;
}

/**
 * Nach der Anmeldung: eigene, noch lokale bzw. private Törns in ihren Realm bringen, die eigene Person mit dem
 * Konto verknüpfen und vorgemerkte Einladungen senden. Liefert die Zahl der verschobenen Törns.
 */
export async function adoptOwnTrips(db: LogbookDB): Promise<number> {
  const user = requireUser(db);
  let moved = 0;
  for (const trip of await db.trips.toArray()) {
    if (isSharedRealm(trip.realmId)) {
      await sendPendingInvites(db, trip.id);
      continue;
    }
    await shareTripToCloud(db, trip.id);
    moved++;
    const me = await getAuthor(db, trip.id);
    const crew = await listCrew(db, trip.id);
    const mine = crew.find((c) => c.id === me);
    if (mine && !mine.email && user.email && !crew.some((c) => c.email === normalizeEmail(user.email!))) {
      await updateCrewMember(db, mine.id, { email: user.email });
    }
    await sendPendingInvites(db, trip.id);
  }
  return moved;
}

export interface InviteInput {
  email: string;
  /** Anzeigename; fehlt er, wird er aus der E-Mail abgeleitet. */
  name?: string | undefined;
  /** Boot-Vorschlag (nur Vorschlag, keine Berechtigung). */
  suggestedBoatId?: ID | undefined;
}

function memberRow(db: LogbookDB, realmId: string, email: string, name: string): DBRealmMember {
  return {
    ...memberIdFields(db), realmId, email, name, roles: ['member'],
    // Rechte zusätzlich explizit: neu importierte globale Rollen wirken serverseitig verzögert (Spike 9.9)
    permissions: { add: [...(MEMBER_PERMISSIONS.add as string[])] },
    // Keine Dexie-Mail: die Crew tritt über Link/QR-Code bei (`?join=`) und meldet sich mit dieser Adresse an
    invite: false,
  } as DBRealmMember;
}

/**
 * Admin lädt eine Person ein: in einer Transaktion `CrewMember` (Name, E-Mail, Boot-Vorschlag) und – wenn
 * angemeldet – Realm-Mitglied mit Rolle `member`. Nicht angemeldet: nur vorgemerkt (Person ohne Mitglied),
 * `adoptOwnTrips` sendet nach der Anmeldung.
 */
export async function inviteToTrip(db: LogbookDB, tripId: ID, input: InviteInput): Promise<CrewMember> {
  const email = normalizeEmail(input.email);
  const name = input.name?.trim() || nameFromEmail(email);
  const user = db.cloudUser();
  const realmId = user ? await shareTripToCloud(db, tripId) : undefined;
  return db.transaction('rw', [db.settings, db.trips, db.crewMembers, db.realms, db.members, db.roles], async () => {
    const member = await addCrewMember(db, tripId, { name, email, suggestedBoatId: input.suggestedBoatId });
    if (realmId && !(await db.members.where('[email+realmId]').equals([email, realmId]).first())) {
      await db.members.add(memberRow(db, realmId, email, name));
    }
    return member;
  });
}

/** Für alle Personen mit E-Mail ohne Realm-Mitglied (vorgemerkt) die Einladung anlegen. */
export async function sendPendingInvites(db: LogbookDB, tripId: ID): Promise<number> {
  const user = requireUser(db);
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId) || !(await canManageTrip(db, tripId))) return 0;
  const realmId = trip.realmId!;
  return db.transaction('rw', [db.crewMembers, db.members], async () => {
    let n = 0;
    for (const c of await db.crewMembers.where('tripId').equals(tripId).toArray()) {
      if (c.deletedAt !== undefined || !c.email || c.email === normalizeEmail(user.email ?? '')) continue;
      if (await db.members.where('[email+realmId]').equals([c.email, realmId]).first()) continue;
      await db.members.add(memberRow(db, realmId, c.email, c.name));
      n++;
    }
    return n;
  });
}

export type MemberStatus = 'pending' | 'invited' | 'accepted' | 'rejected';

export function memberStatus(m: { accepted?: Date | undefined; rejected?: Date | undefined }): Exclude<MemberStatus, 'pending'> {
  if (m.rejected) return 'rejected';
  if (m.accepted) return 'accepted';
  return 'invited';
}

/** Eine Person des Törns mit ihrem Einladungsstand (Mitgliederliste). */
export interface PersonInfo {
  crewId: ID;
  name: string;
  email?: string;
  suggestedBoatId?: ID;
  admin: boolean;
  /** pending = vorgemerkt (noch kein Realm-Mitglied, z. B. vor der Anmeldung). */
  status: MemberStatus;
  memberId?: string;
  /** Das bin ich. */
  self: boolean;
}

/** Personen des Törns (ohne entfernte), Admin zuerst. */
export async function listPeople(db: LogbookDB, tripId: ID): Promise<PersonInfo[]> {
  const trip = await db.trips.get(tripId);
  if (!trip) return [];
  const user = db.cloudUser();
  const shared = isSharedRealm(trip.realmId);
  const realm = shared ? await db.realms.get(trip.realmId!) : undefined;
  const rows = shared ? await db.members.where('realmId').equals(trip.realmId!).toArray() : [];
  const ownerId = realm?.owner ?? trip.owner;
  const me = await getAuthor(db, tripId);
  const people = (await listCrew(db, tripId)).filter((c) => c.deletedAt === undefined).map((c): PersonInfo => {
    const row = c.email ? rows.find((m) => m.email === c.email) : undefined;
    const isOwner = !!c.email && (c.email === ownerId || (!!user && c.email === normalizeEmail(user.email ?? '') && ownerId === user.userId));
    const admin = shared ? isOwner : c.role === 'skipper';
    // Admin und Personen ohne E-Mail (lokal) haben keine offene Einladung
    const status: MemberStatus = admin || !c.email ? 'accepted' : row ? memberStatus(row) : 'pending';
    return {
      crewId: c.id, name: c.name, ...(c.email ? { email: c.email } : {}),
      ...(c.suggestedBoatId ? { suggestedBoatId: c.suggestedBoatId } : {}), admin, status,
      ...(row?.id ? { memberId: row.id } : {}), self: c.id === me,
    };
  });
  return people.sort((a, b) => Number(b.admin) - Number(a.admin));
}

/** Admin: Person entfernen – Person (Tombstone) und Realm-Mitglied in einer Transaktion. */
export async function removePerson(db: LogbookDB, crewId: ID): Promise<void> {
  await db.transaction('rw', [db.settings, db.trips, db.crewMembers, db.realms, db.members, db.roles], async () => {
    const c = await db.crewMembers.get(crewId);
    if (!c) return;
    await removeCrewMember(db, crewId);
    const trip = await db.trips.get(c.tripId);
    if (c.email && trip && isSharedRealm(trip.realmId)) {
      await db.members.where('[email+realmId]').equals([c.email, trip.realmId!]).delete();
    }
  });
}

// ---------- Daheim-Link (Zuschauer ohne Anmeldung, docs/toern-modell.md) ----------

export interface HomeViewInfo {
  token: string;
  /** Demo-Konto des Zuschauers: daheim-<token>@demo.local. */
  email: string;
  /** Der Link wurde geöffnet (Mitgliedschaft automatisch angenommen) – dann ist er auch freigeschaltet. */
  opened: boolean;
}

/**
 * Der aktuelle Daheim-Link eines Törns. Der Token steckt in der E-Mail des Zuschauer-Mitglieds; Mitglieder des
 * Realms sehen die Mitgliederzeilen ebenfalls (also auch den Link) – akzeptiert, Weiterleiten ist ohnehin erlaubt.
 */
export async function getHomeView(db: LogbookDB, tripId: ID): Promise<HomeViewInfo | undefined> {
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId)) return undefined;
  const rows = (await db.members.where('realmId').equals(trip.realmId!).toArray()).filter((m) => isViewerEmail(m.email));
  const row = rows[0];
  const token = viewerToken(row?.email);
  if (!row || !token) return undefined;
  return { token, email: viewerEmail(token), opened: !!row.accepted };
}

async function assertHomeViewAdmin(db: LogbookDB, tripId: ID): Promise<string> {
  requireUser(db);
  const realmId = await shareTripToCloud(db, tripId);
  if (!(await canManageTrip(db, tripId))) throw new NotPermittedError(`manage home view of ${tripId}`);
  return realmId;
}

function viewerRow(db: LogbookDB, realmId: string, token: string): DBRealmMember {
  return {
    ...memberIdFields(db), realmId, email: viewerEmail(token), name: VIEWER_NAME, roles: [VIEWER_ROLE],
    // ausdrücklich keine Rechte (wie bei member zusätzlich am Mitglied, Spike 9.9); keine Dexie-Mail
    permissions: {},
    invite: false,
  } as DBRealmMember;
}

const randomBytes = (b: Uint8Array<ArrayBuffer>): Uint8Array => crypto.getRandomValues(b);

async function replaceViewer(db: LogbookDB, realmId: string, token: string | undefined): Promise<void> {
  await db.transaction('rw', [db.members], async () => {
    await db.members.where('realmId').equals(realmId).filter((m) => isViewerEmail(m.email)).delete();
    if (token) await db.members.add(viewerRow(db, realmId, token));
  });
}

/**
 * Admin: Daheim-Link anlegen – Realm-Mitglied `daheim-<token>@demo.local` mit Rolle `viewer` ohne Rechte, keine
 * Person (CrewMember). Besteht schon einer, bleibt er. Das Demo-Konto selbst legt `npm run viewer:create` an.
 */
export async function createHomeView(db: LogbookDB, tripId: ID): Promise<string> {
  const realmId = await assertHomeViewAdmin(db, tripId);
  const existing = await getHomeView(db, tripId);
  if (existing) return existing.token;
  const token = createHomeViewToken(randomBytes);
  await replaceViewer(db, realmId, token);
  return token;
}

/** Admin: neuer Link; das alte Zuschauer-Mitglied wird entfernt (alter Link zeigt danach nichts mehr). */
export async function renewHomeView(db: LogbookDB, tripId: ID): Promise<string> {
  const realmId = await assertHomeViewAdmin(db, tripId);
  const token = createHomeViewToken(randomBytes);
  await replaceViewer(db, realmId, token);
  return token;
}

/** Admin: Daheim-Link abschalten. */
export async function disableHomeView(db: LogbookDB, tripId: ID): Promise<void> {
  const realmId = await assertHomeViewAdmin(db, tripId);
  await replaceViewer(db, realmId, undefined);
}

async function sharedRealmOf(db: LogbookDB, tripId: ID): Promise<string> {
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId)) throw new Error('Der Törn ist nicht in der Cloud.');
  return trip.realmId!;
}

/** Eigene Mitgliedschaft beenden: der Törn synchronisiert danach nicht mehr auf meine Geräte. */
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
