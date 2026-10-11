import Dexie, { add, remove, type EntityTable, type Table } from 'dexie';
import {
  canEditRecord, canManageRealm, canWriteRealm, isSharedRealm, realmPermissions, tiedRealmId, type Me, type PermissionSet,
} from '../domain/access';
import { activeBoats, boatInUse, clampFocus, nextColorIndex } from '../domain/boats';
import { localDate } from '../domain/days';
import { isViewerEmail } from '../domain/homeView';
import { dayReportId, timeOrderedId } from '../domain/ids';
import { mergeRecords, mergeTrip, remapPhotoIds, withoutCloudFields, type MergeStats } from '../domain/merge';
import { assembleTracks, chunkPoints, TRACK_CHUNK_SIZE } from '../domain/tracks';
import type {
  Boat, BoatSelection, CloudFields, CoverFocus, CrewMember, DayReport, ID, LogEntry, Photo, Position, Settings, Track, TrackChunk,
  TrackPoint, TrackRecord, Trip, TripBundle,
} from '../domain/types';
import { rememberDeviceId, storedDeviceId, type LogbookDB } from './db';

/** Thrown when the current user may not do this (not admin, foreign record, membership not effective yet). */
export class NotPermittedError extends Error {
  constructor(what: string) {
    super(`Not permitted: ${what}`);
    this.name = 'NotPermittedError';
  }
}

// ---------- Device ----------

const deviceIds = new WeakMap<LogbookDB, Promise<string>>();

/**
 * Random per-device id (never exported), generated once; stamps `updatedBy` of all writes.
 * Kept in `settings` and in localStorage (a cloud logout clears all tables).
 */
export function getDeviceId(db: LogbookDB): Promise<string> {
  let cached = deviceIds.get(db);
  if (!cached) {
    cached = db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get('deviceId');
      if (typeof row?.value === 'string') {
        rememberDeviceId(row.value);
        return row.value;
      }
      const id = storedDeviceId() ?? crypto.randomUUID();
      await db.settings.put({ key: 'deviceId', value: id });
      rememberDeviceId(id);
      return id;
    });
    deviceIds.set(db, cached);
    cached.catch(() => deviceIds.delete(db));
  }
  return cached;
}

/** Forget the cached device id (after a cloud logout the settings table is empty again). */
export function resetDeviceIdCache(db: LogbookDB): void {
  deviceIds.delete(db);
}

/** Strictly increasing version timestamp for a record. */
function nextAt(previous: number): number {
  return Math.max(Date.now(), previous + 1);
}

async function readMap<T>(db: LogbookDB, key: string): Promise<Record<ID, T>> {
  const row = await db.settings.get(key);
  return typeof row?.value === 'object' && row.value !== null && !Array.isArray(row.value) ? (row.value as Record<ID, T>) : {};
}

async function writeMapEntry<T>(db: LogbookDB, key: string, tripId: ID, value: T | undefined): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const map = { ...(await readMap<T>(db, key)) };
    if (value === undefined) delete map[tripId];
    else map[tripId] = value;
    await db.settings.put({ key, value: map });
  });
}

/** Realm of a stored record, to be carried into every write of its children (never write without realmId). */
function realmOf(rec: CloudFields | undefined): { realmId?: string } {
  return rec?.realmId ? { realmId: rec.realmId } : {};
}

// ---------- Access ----------

/** Tables every write transaction needs for the permission check and the author lookup. */
function guardTables(db: LogbookDB): Table[] {
  return [db.settings, db.trips, db.crewMembers, db.realms, db.members, db.roles];
}

function rw<T>(db: LogbookDB, tables: Table[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...new Set([...tables, ...guardTables(db)])], fn);
}

const PUBLIC_REALM = 'rlm-public';

async function permissionsIn(db: LogbookDB, realmId: string, userId: string): Promise<PermissionSet> {
  const [realm, selfMembers, roleRows] = await Promise.all([
    db.realms.get(realmId),
    db.members.where('[userId+realmId]').equals([userId, realmId]).toArray(),
    db.roles.where('[realmId+name]').between([PUBLIC_REALM, Dexie.minKey], [PUBLIC_REALM, Dexie.maxKey]).toArray(),
  ]);
  const globalRoles = Object.fromEntries(roleRows.map((r) => [r.name, { permissions: r.permissions as PermissionSet }]));
  return realmPermissions({
    realm,
    selfMembers: selfMembers.map((m) => ({
      realmId: m.realmId, ...(m.userId ? { userId: m.userId } : {}), ...(m.roles ? { roles: m.roles } : {}),
      ...(m.accepted ? { accepted: m.accepted } : {}), ...(m.rejected ? { rejected: m.rejected } : {}),
      ...(m.permissions ? { permissions: m.permissions as PermissionSet } : {}),
    })),
    globalRoles,
    userId,
    confirmedRealms: db.serverRealms(),
  });
}

/** What the current user may do in a trip. */
export interface TripAccess extends Me {
  /** May add entries, photos, day report sections, tracks. */
  canWrite: boolean;
}

/**
 * Local mode (not signed in) and trips that are not shared: everything (I am the admin). Shared trips
 * (realm `rlm~<tripId>`): the realm owner is admin; members write once the server confirmed the membership.
 */
export async function tripAccess(db: LogbookDB, tripId: ID): Promise<TripAccess> {
  const user = db.cloudUser();
  if (!user) return { admin: true, canWrite: true };
  // Daheim-Link: reiner Zuschauer, egal was eine Mitgliedschaft hergibt
  if (isViewerEmail(user.email)) return { userId: user.userId, admin: false, canWrite: false, viewer: true };
  const trip = await db.trips.get(tripId);
  if (!trip || !isSharedRealm(trip.realmId)) return { userId: user.userId, admin: true, canWrite: true };
  // just shared by me, the realm row has no owner yet (the server sets it): my own trip
  const realm = await db.realms.get(trip.realmId!);
  if (!realm?.owner && (!trip.owner || trip.owner === 'unauthorized' || trip.owner === user.userId)) {
    return { userId: user.userId, admin: true, canWrite: true };
  }
  const p = await permissionsIn(db, trip.realmId!, user.userId);
  return { userId: user.userId, admin: canManageRealm(p), canWrite: canWriteRealm(p) };
}

/** May add entries etc. in the trip. */
export async function canWriteTrip(db: LogbookDB, tripId: ID): Promise<boolean> {
  return (await tripAccess(db, tripId)).canWrite;
}

/** Admin: boats, invitations, trip data, all records, delete for everybody. */
export async function canManageTrip(db: LogbookDB, tripId: ID): Promise<boolean> {
  return (await tripAccess(db, tripId)).admin;
}

/** Ids of all trips this user may write in (UI: banner while a membership is not effective yet). */
export async function listWritableTripIds(db: LogbookDB): Promise<ID[]> {
  const out: ID[] = [];
  for (const t of await db.trips.toArray()) if (await canWriteTrip(db, t.id)) out.push(t.id);
  return out;
}

async function assertCanWrite(db: LogbookDB, tripId: ID): Promise<TripAccess> {
  const access = await tripAccess(db, tripId);
  if (!access.canWrite) throw new NotPermittedError(`write in trip ${tripId}`);
  return access;
}

async function assertAdmin(db: LogbookDB, tripId: ID): Promise<void> {
  if (!(await tripAccess(db, tripId)).admin) throw new NotPermittedError(`manage trip ${tripId}`);
}

/** Own record (owner) or admin; members additionally need write access to the trip. */
async function assertCanEdit(db: LogbookDB, record: CloudFields & { tripId: ID }): Promise<void> {
  const access = await tripAccess(db, record.tripId);
  if (!access.admin && !access.canWrite) throw new NotPermittedError(`write in trip ${record.tripId}`);
  if (!canEditRecord(record, access)) throw new NotPermittedError('edit a record of somebody else');
}

/** May the current user change/delete this record (UI)? */
export async function canEdit(db: LogbookDB, record: CloudFields & { tripId: ID }): Promise<boolean> {
  try {
    await assertCanEdit(db, record);
    return true;
  } catch {
    return false;
  }
}

async function tripOf(db: LogbookDB, tripId: ID): Promise<Trip> {
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`Trip not found: ${tripId}`);
  return trip;
}

// ---------- Author ----------

/** "Ich bin ...": crew member who writes on this device in that trip (local mode). */
export async function setAuthor(db: LogbookDB, tripId: ID, crewId: ID | undefined): Promise<void> {
  await writeMapEntry(db, 'authorByTrip', tripId, crewId);
}

/**
 * Author on this device: signed in, the active crew member whose e-mail is the signed-in user's (created by the
 * admin when inviting; works on every device of the user); otherwise the local choice ("Ich bin ...").
 */
export async function getAuthor(db: LogbookDB, tripId: ID): Promise<ID | undefined> {
  const crew = (await db.crewMembers.where('tripId').equals(tripId).toArray()).filter((c) => c.deletedAt === undefined);
  const email = db.cloudUser()?.email?.toLowerCase();
  const byAccount = email ? crew.find((c) => c.email?.toLowerCase() === email)?.id : undefined;
  if (byAccount) return byAccount;
  const local = (await readMap<ID>(db, 'authorByTrip'))[tripId];
  return local && crew.some((c) => c.id === local) ? local : undefined;
}

// ---------- Trips ----------

export interface BoatInput {
  name: string;
  model?: string | undefined;
  lengthM?: number | undefined;
  homePort?: string | undefined;
  callSign?: string | undefined;
  mmsi?: string | undefined;
}

export interface TripInput {
  name: string;
  startDate?: string | undefined;
  endDate?: string | undefined;
  area?: string | undefined;
  /** At least one boat. */
  boats: readonly BoatInput[];
  /** The person creating the trip (admin); becomes the author on this device. */
  founder?: { name: string } | undefined;
}

const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function newBoat(trip: Trip, input: BoatInput, colorIndex: number, at: number, device: string): Boat {
  return {
    ...definedOnly(input), name: input.name.trim(), id: crypto.randomUUID(), tripId: trip.id, colorIndex,
    createdAt: at, updatedAt: at, updatedBy: device, ...realmOf(trip),
  };
}

/**
 * Creates a trip with its boats and the founder (admin). Signed in to the cloud, the trip lives in its own
 * realm right away (`rlm~<tripId>`), so people can be invited; otherwise it stays local.
 */
export async function createTrip(db: LogbookDB, input: TripInput): Promise<Trip> {
  if (input.boats.length === 0) throw new Error('A trip needs at least one boat');
  const now = Date.now();
  const device = await getDeviceId(db);
  const user = db.cloudUser();
  const id = crypto.randomUUID();
  return db.transaction('rw', [db.trips, db.boats, db.crewMembers, db.settings, db.realms], async () => {
    const { boats, founder, ...fields } = input;
    const realm = user ? { realmId: tiedRealmId(id) } : {};
    if (user) await db.realms.upsert(realm.realmId!, { name: input.name.trim(), represents: 'einen Törn' });
    await db.trips.add({ ...definedOnly(fields), name: input.name.trim(), id, createdAt: now, updatedAt: now, updatedBy: device, ...realm });
    // the cloud addon assigns realmId/owner on add: read back to hand the realm on to the children
    const trip = (await db.trips.get(id))!;
    const created: Boat[] = [];
    for (const [i, b] of boats.entries()) created.push(newBoat(trip, b, nextColorIndex(created), now + i, device));
    await db.boats.bulkAdd(created);
    if (founder?.name.trim()) {
      const member: CrewMember = {
        id: crypto.randomUUID(), tripId: id, name: founder.name.trim(), role: 'skipper',
        ...(user?.email ? { email: user.email.toLowerCase() } : {}), suggestedBoatId: created[0]!.id,
        createdAt: now, updatedAt: now, updatedBy: device, ...realmOf(trip),
      };
      await db.crewMembers.add(member);
      await setAuthor(db, id, member.id);
    }
    return trip;
  });
}

export async function getTrip(db: LogbookDB, id: ID): Promise<Trip | undefined> {
  return db.trips.get(id);
}

export type TripPatch = Partial<Pick<Trip, 'name' | 'startDate' | 'endDate' | 'area'>>;

export async function updateTrip(db: LogbookDB, id: ID, patch: TripPatch): Promise<Trip> {
  const device = await getDeviceId(db);
  return rw(db, [], async () => {
    await assertAdmin(db, id);
    const existing = await tripOf(db, id);
    const changes: Partial<Trip> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    await db.trips.update(id, changes);
    return { ...existing, ...changes, id };
  });
}

export async function listTrips(db: LogbookDB): Promise<Trip[]> {
  const all = await db.trips.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

const childTables = (db: LogbookDB) =>
  [db.boats, db.crewMembers, db.entries, db.photos, db.dayReports, db.tracks, db.trackChunks] as Table<{ tripId: ID }>[];

const LOCAL_TRIP_SETTINGS = ['authorByTrip', 'boatSelectionByTrip', 'lastBoatByTrip'];

/**
 * Hard delete of the trip and everything in it. Local mode: only on this device. A trip shared via
 * Dexie Cloud is deleted for everybody (admin only; the realm with its members goes too).
 */
export async function deleteTrip(db: LogbookDB, id: ID): Promise<void> {
  await db.transaction('rw', [...childTables(db), ...guardTables(db)], async () => {
    const trip = await db.trips.get(id);
    if (trip && isSharedRealm(trip.realmId)) await assertAdmin(db, id);
    for (const table of childTables(db)) await table.where('tripId').equals(id).delete();
    await db.trips.delete(id);
    if (trip && isSharedRealm(trip.realmId)) await db.realms.delete(trip.realmId!);
    if ((await db.settings.get('activeTripId'))?.value === id) await setActiveTrip(db, undefined);
    for (const key of LOCAL_TRIP_SETTINGS) await writeMapEntry(db, key, id, undefined);
  });
}

/**
 * Moves the trip and all its records into `realmId` (Dexie Cloud: share the trip). Uses `update`/
 * object-`modify` only (sync-consistent). The realm is upserted (tied realm ids converge across devices).
 */
export async function moveTripToRealm(
  db: LogbookDB, tripId: ID, realmId: string, realm: { name: string; represents: string },
): Promise<void> {
  await db.transaction('rw', [db.trips, db.realms, ...childTables(db)], async () => {
    await tripOf(db, tripId);
    await db.realms.upsert(realmId, realm);
    await db.trips.update(tripId, { realmId });
    for (const table of childTables(db)) await table.where('tripId').equals(tripId).modify({ realmId } as never);
  });
}

// ---------- Boats ----------

/** All boats incl. removed ones (tombstones keep names resolvable). */
export async function listBoats(db: LogbookDB, tripId: ID): Promise<Boat[]> {
  const all = await db.boats.where('tripId').equals(tripId).toArray();
  return all.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** Admin: adds a boat (next free color/shape). */
export async function addBoat(db: LogbookDB, tripId: ID, input: BoatInput): Promise<Boat> {
  if (!input.name.trim()) throw new Error('A boat needs a name');
  const device = await getDeviceId(db);
  return rw(db, [db.boats], async () => {
    await assertAdmin(db, tripId);
    const trip = await tripOf(db, tripId);
    const boat = newBoat(trip, input, nextColorIndex(await listBoats(db, tripId)), Date.now(), device);
    await db.boats.add(boat);
    return boat;
  });
}

export type BoatPatch = Partial<Omit<BoatInput, 'name'>> & { name?: string };

/** Admin: changes boat fields (only the given ones; `undefined` clears an optional field). */
export async function updateBoat(db: LogbookDB, boatId: ID, patch: BoatPatch): Promise<Boat> {
  const device = await getDeviceId(db);
  return rw(db, [db.boats], async () => {
    const boat = await db.boats.get(boatId);
    if (!boat) throw new Error(`Boat not found: ${boatId}`);
    await assertAdmin(db, boat.tripId);
    const changes: Partial<Boat> = { ...patch, updatedAt: nextAt(boat.updatedAt), updatedBy: device };
    if (patch.name !== undefined) changes.name = patch.name.trim();
    await db.boats.update(boatId, changes);
    return { ...boat, ...changes };
  });
}

/** Admin: removes a boat without entries/tracks (tombstone); its crew suggestions are cleared. */
export async function removeBoat(db: LogbookDB, boatId: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.boats, db.entries, db.tracks], async () => {
    const boat = await db.boats.get(boatId);
    if (!boat || boat.deletedAt !== undefined) return;
    await assertAdmin(db, boat.tripId);
    const [entries, tracks, boats] = await Promise.all([
      db.entries.where('tripId').equals(boat.tripId).toArray(),
      db.tracks.where('tripId').equals(boat.tripId).toArray(),
      listBoats(db, boat.tripId),
    ]);
    if (boatInUse(boatId, entries, tracks)) throw new BoatInUseError(boat.name);
    if (activeBoats(boats).length <= 1) throw new LastBoatError();
    const at = nextAt(boat.updatedAt);
    await db.boats.update(boatId, { deletedAt: at, updatedAt: at, updatedBy: device });
    for (const c of await db.crewMembers.where('tripId').equals(boat.tripId).toArray()) {
      if (c.suggestedBoatId === boatId) {
        await db.crewMembers.update(c.id, { suggestedBoatId: undefined, updatedAt: nextAt(c.updatedAt), updatedBy: device });
      }
    }
  });
}

export class BoatInUseError extends Error {
  constructor(name: string) {
    super(`Boat has entries or tracks: ${name}`);
    this.name = 'BoatInUseError';
  }
}

export class LastBoatError extends Error {
  constructor() {
    super('A trip needs at least one boat');
    this.name = 'LastBoatError';
  }
}

// ---------- Crew ----------

async function allCrew(db: LogbookDB, tripId: ID): Promise<CrewMember[]> {
  const all = await db.crewMembers.where('tripId').equals(tripId).toArray();
  return all.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** All crew members incl. tombstones (names stay resolvable for author labels). */
export async function listCrew(db: LogbookDB, tripId: ID): Promise<CrewMember[]> {
  return allCrew(db, tripId);
}

export interface CrewInput {
  name: string;
  email?: string | undefined;
  suggestedBoatId?: ID | undefined;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Already in the trip: ${email}`);
    this.name = 'DuplicateEmailError';
  }
}

/**
 * Admin: adds a person (invitation intent). Must run inside a transaction with `rw` tables or standalone;
 * used by `inviteToTrip` (db/cloud.ts) together with the realm member in one transaction.
 */
export async function addCrewMember(db: LogbookDB, tripId: ID, input: CrewInput): Promise<CrewMember> {
  const device = await getDeviceId(db);
  return rw(db, [], async () => {
    await assertAdmin(db, tripId);
    const trip = await tripOf(db, tripId);
    const email = input.email ? normalizeEmail(input.email) : undefined;
    const crew = await allCrew(db, tripId);
    const existing = email ? crew.find((c) => c.email === email) : undefined;
    const now = Date.now();
    if (existing) {
      if (existing.deletedAt === undefined) throw new DuplicateEmailError(email!);
      // re-invited after removal: revive the person (same id keeps old entries attributed)
      const revived: Partial<CrewMember> = {
        name: input.name.trim(), suggestedBoatId: input.suggestedBoatId, deletedAt: undefined,
        updatedAt: nextAt(existing.updatedAt), updatedBy: device,
      };
      await db.crewMembers.update(existing.id, revived);
      return { ...existing, ...revived } as CrewMember;
    }
    const member: CrewMember = {
      id: crypto.randomUUID(), tripId, name: input.name.trim(), ...(email ? { email } : {}),
      ...(input.suggestedBoatId ? { suggestedBoatId: input.suggestedBoatId } : {}),
      createdAt: now, updatedAt: now, updatedBy: device, ...realmOf(trip),
    };
    await db.crewMembers.add(member);
    return member;
  });
}

/** Admin: name / boat suggestion of a person. */
export async function updateCrewMember(
  db: LogbookDB, crewId: ID, patch: Partial<Pick<CrewMember, 'name' | 'suggestedBoatId' | 'role' | 'email'>>,
): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [], async () => {
    const member = await db.crewMembers.get(crewId);
    if (!member) throw new Error(`Crew member not found: ${crewId}`);
    await assertAdmin(db, member.tripId);
    const changes: Partial<CrewMember> = { ...patch, updatedAt: nextAt(member.updatedAt), updatedBy: device };
    if (patch.email !== undefined) changes.email = normalizeEmail(patch.email) || undefined;
    await db.crewMembers.update(crewId, changes);
  });
}

/** Admin: removes a person (tombstone; the name stays for author labels). */
export async function removeCrewMember(db: LogbookDB, crewId: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [], async () => {
    const member = await db.crewMembers.get(crewId);
    if (!member || member.deletedAt !== undefined) return;
    await assertAdmin(db, member.tripId);
    const at = nextAt(member.updatedAt);
    await db.crewMembers.update(crewId, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

// ---------- Settings ----------

export async function getSettings(db: LogbookDB): Promise<Settings> {
  const [deviceRow, theme, active, authorByTrip, boatSelectionByTrip, lastBoatByTrip] = await Promise.all([
    db.settings.get('deviceId'), db.settings.get('theme'), db.settings.get('activeTripId'),
    readMap<ID>(db, 'authorByTrip'), readMap<BoatSelection>(db, 'boatSelectionByTrip'), readMap<ID>(db, 'lastBoatByTrip'),
  ]);
  const settings: Settings = {
    theme: (theme?.value as Settings['theme'] | undefined) ?? 'system',
    deviceId: typeof deviceRow?.value === 'string' ? deviceRow.value : (storedDeviceId() ?? ''),
    authorByTrip, boatSelectionByTrip, lastBoatByTrip,
  };
  if (typeof active?.value === 'string') settings.activeTripId = active.value;
  return settings;
}

export async function setActiveTrip(db: LogbookDB, id: ID | undefined): Promise<void> {
  if (id === undefined) await db.settings.delete('activeTripId');
  else await db.settings.put({ key: 'activeTripId', value: id });
}

export async function setTheme(db: LogbookDB, theme: Settings['theme']): Promise<void> {
  await db.settings.put({ key: 'theme', value: theme });
}

/** Boot-Schalter of this device (local, never synced/exported). */
export async function setBoatSelection(db: LogbookDB, tripId: ID, selection: BoatSelection | undefined): Promise<void> {
  await writeMapEntry(db, 'boatSelectionByTrip', tripId, selection);
}

/** Boat last chosen for an entry on this device (preselection when the switch shows "all"). */
export async function setLastBoat(db: LogbookDB, tripId: ID, boatId: ID | undefined): Promise<void> {
  await writeMapEntry(db, 'lastBoatByTrip', tripId, boatId);
}

// ---------- Entries ----------

export interface EntryInput {
  boatId: ID;
  time: number;
  tzOffsetMin: number;
  position?: Position;
}

async function assertBoatOf(db: LogbookDB, tripId: ID, boatId: ID): Promise<void> {
  const boat = await db.boats.get(boatId);
  if (!boat || boat.tripId !== tripId || boat.deletedAt !== undefined) throw new Error(`Boat not in trip: ${boatId}`);
}

export async function createEntry(db: LogbookDB, tripId: ID, input: EntryInput): Promise<LogEntry> {
  const device = await getDeviceId(db);
  return rw(db, [db.entries, db.boats], async () => {
    await assertCanWrite(db, tripId);
    const trip = await tripOf(db, tripId);
    await assertBoatOf(db, tripId, input.boatId);
    const authorId = await getAuthor(db, tripId);
    const now = Date.now();
    const entry: LogEntry = {
      ...input, id: crypto.randomUUID(), tripId, type: 'note', photoIds: [],
      ...(authorId ? { authorId } : {}), createdAt: now, updatedAt: now, updatedBy: device, ...realmOf(trip),
    };
    await db.entries.add(entry);
    await setLastBoat(db, tripId, input.boatId);
    return entry;
  });
}

/** All entries incl. tombstones (export / merge). */
async function allEntries(db: LogbookDB, tripId: ID): Promise<LogEntry[]> {
  return db.entries.where('[tripId+time]').between([tripId, Dexie.minKey], [tripId, Dexie.maxKey]).toArray();
}

export async function listEntries(db: LogbookDB, tripId: ID): Promise<LogEntry[]> {
  return (await allEntries(db, tripId)).filter((e) => e.deletedAt === undefined);
}

async function patchEntry(db: LogbookDB, id: ID, patch: Partial<LogEntry>): Promise<LogEntry> {
  const device = await getDeviceId(db);
  return rw(db, [db.entries, db.boats], async () => {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);
    await assertCanEdit(db, existing);
    if (patch.boatId !== undefined && patch.boatId !== existing.boatId) await assertBoatOf(db, existing.tripId, patch.boatId);
    const changes: Partial<LogEntry> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    await db.entries.update(id, changes);
    return { ...existing, ...changes };
  });
}

export type EntryPatch = Partial<
  Omit<LogEntry, 'id' | 'tripId' | 'createdAt' | 'photoIds' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'realmId' | 'owner'>
>;

export async function updateEntry(db: LogbookDB, id: ID, patch: EntryPatch): Promise<LogEntry> {
  return patchEntry(db, id, patch);
}

export async function setEntryPosition(db: LogbookDB, id: ID, position: Position | undefined): Promise<LogEntry> {
  return patchEntry(db, id, { position });
}

/**
 * Photo rows this user may hard-delete. In the cloud only the creator (owner) may; others' photos stay
 * as orphans (harmless, `photoIds` no longer reference them) so the whole transaction is never rejected.
 */
async function deletablePhotoIds(db: LogbookDB, ids: readonly ID[]): Promise<ID[]> {
  if (!db.cloudEnabled) return [...ids];
  const me = db.cloudUser()?.userId ?? 'unauthorized';
  const rows = await db.photos.bulkGet([...ids]);
  return rows.filter((p): p is Photo => !!p && (!p.owner || p.owner === me)).map((p) => p.id);
}

/** Tombstone: the entry stays (so the deletion merges), lists hide it; its photo files are removed. */
export async function deleteEntry(db: LogbookDB, id: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.entries, db.photos], async () => {
    const entry = await db.entries.get(id);
    if (!entry || entry.deletedAt !== undefined) return;
    await assertCanEdit(db, entry);
    await db.photos.bulkDelete(await deletablePhotoIds(db, entry.photoIds));
    const at = nextAt(entry.updatedAt);
    await db.entries.update(id, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

// ---------- Photos ----------

export const MAX_PHOTOS_PER_ENTRY = 5;
export const MAX_PHOTOS_PER_DAY_REPORT = 15;

export class MaxPhotosError extends Error {
  constructor(max = MAX_PHOTOS_PER_ENTRY) {
    super(`At most ${max} photos allowed`);
    this.name = 'MaxPhotosError';
  }
}

export async function getPhoto(db: LogbookDB, id: ID): Promise<Photo | undefined> {
  return db.photos.get(id);
}

export interface PhotoInput {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  hash?: string;
}

/** Photo ids sort by creation time: Dexie's array `add()` keeps `photoIds` sorted, i.e. chronological. */
function newPhotos(trip: Trip, inputs: readonly PhotoInput[]): Photo[] {
  const now = Date.now();
  return inputs.map((input, i) => ({
    ...input, id: timeOrderedId(now + i), tripId: trip.id, createdAt: now + i, ...realmOf(trip),
  }));
}

export async function addPhotoToEntry(db: LogbookDB, entryId: ID, input: PhotoInput): Promise<Photo> {
  const [photo] = await addPhotosToEntry(db, entryId, [input]);
  return photo!;
}

/*
 * Dexie Cloud (Spike 2026-10-11): an array operation (`add()`/`remove()`) in the same transaction as writes
 * to another table makes the server silently drop the other writes (photo rows vanished, no rejection).
 * Therefore photo rows and `photoIds` changes run in two transactions; at worst a photo row stays orphaned.
 */

/** Adds several photos (rows all or none); then `photoIds` grows via Dexie's sync-consistent `add()`. */
export async function addPhotosToEntry(db: LogbookDB, entryId: ID, inputs: readonly PhotoInput[]): Promise<Photo[]> {
  const device = await getDeviceId(db);
  const photos = await rw(db, [db.entries, db.photos], async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await assertCanEdit(db, entry);
    const trip = await tripOf(db, entry.tripId);
    if (entry.photoIds.length + inputs.length > MAX_PHOTOS_PER_ENTRY) throw new MaxPhotosError(MAX_PHOTOS_PER_ENTRY);
    const created = newPhotos(trip, inputs);
    await db.photos.bulkAdd(created);
    return created;
  });
  await db.transaction('rw', db.entries, async () => {
    const entry = await db.entries.get(entryId);
    await db.entries.update(entryId, {
      photoIds: add(photos.map((p) => p.id)), updatedAt: nextAt(entry?.updatedAt ?? 0), updatedBy: device,
    });
  });
  return photos;
}

export async function removePhotoFromEntry(db: LogbookDB, entryId: ID, photoId: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.entries], async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await assertCanEdit(db, entry);
    await db.entries.update(entryId, { photoIds: remove([photoId]), updatedAt: nextAt(entry.updatedAt), updatedBy: device });
  });
  await deletePhotoRows(db, [photoId]);
}

/** Separate transaction (see note above): removes photo rows this user may delete. */
async function deletePhotoRows(db: LogbookDB, ids: readonly ID[]): Promise<void> {
  await db.transaction('rw', db.photos, async () => {
    await db.photos.bulkDelete(await deletablePhotoIds(db, ids));
  });
}

/** Admin: sets (replaces) the cover picture of the trip; the focus is reset to the center. */
export async function setTripCover(db: LogbookDB, tripId: ID, input: PhotoInput): Promise<Photo> {
  const device = await getDeviceId(db);
  return rw(db, [db.photos], async () => {
    await assertAdmin(db, tripId);
    const trip = await tripOf(db, tripId);
    if (trip.coverPhotoId) await db.photos.bulkDelete(await deletablePhotoIds(db, [trip.coverPhotoId]));
    const [photo] = newPhotos(trip, [input]);
    await db.photos.add(photo!);
    await db.trips.update(tripId, {
      coverPhotoId: photo!.id, coverFocus: undefined, updatedAt: nextAt(trip.updatedAt), updatedBy: device,
    });
    return photo!;
  });
}

/** Admin: focus point of the cover (percent, clamped to 0..100). */
export async function setTripCoverFocus(db: LogbookDB, tripId: ID, focus: CoverFocus): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [], async () => {
    await assertAdmin(db, tripId);
    const trip = await tripOf(db, tripId);
    await db.trips.update(tripId, {
      coverFocus: clampFocus(focus), updatedAt: nextAt(trip.updatedAt), updatedBy: device,
    });
  });
}

/** Admin: removes the cover picture. */
export async function removeTripCover(db: LogbookDB, tripId: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.photos], async () => {
    await assertAdmin(db, tripId);
    const trip = await tripOf(db, tripId);
    if (!trip.coverPhotoId) return;
    await db.photos.bulkDelete(await deletablePhotoIds(db, [trip.coverPhotoId]));
    await db.trips.update(tripId, {
      coverPhotoId: undefined, coverFocus: undefined, updatedAt: nextAt(trip.updatedAt), updatedBy: device,
    });
  });
}

/** Admin: replaces the boat photo. */
export async function setBoatPhoto(db: LogbookDB, boatId: ID, input: PhotoInput): Promise<Photo> {
  const device = await getDeviceId(db);
  return rw(db, [db.boats, db.photos], async () => {
    const boat = await db.boats.get(boatId);
    if (!boat) throw new Error(`Boat not found: ${boatId}`);
    await assertAdmin(db, boat.tripId);
    const trip = await tripOf(db, boat.tripId);
    if (boat.photoId) await db.photos.bulkDelete(await deletablePhotoIds(db, [boat.photoId]));
    const [photo] = newPhotos(trip, [input]);
    await db.photos.add(photo!);
    await db.boats.update(boatId, { photoId: photo!.id, updatedAt: nextAt(boat.updatedAt), updatedBy: device });
    return photo!;
  });
}

async function sectionsOfDay(db: LogbookDB, tripId: ID, date: string): Promise<DayReport[]> {
  return db.dayReports.where('tripId').equals(tripId).filter((r) => r.date === date && r.deletedAt === undefined).toArray();
}

/** Hashes of all photos attached to entries of that calendar day or to any section of its report. */
export async function dayPhotoHashes(db: LogbookDB, tripId: ID, date: string): Promise<Set<string>> {
  return db.transaction('r', db.entries, db.photos, db.dayReports, async () => {
    const entries = await listEntries(db, tripId);
    const ids = new Set<ID>();
    for (const r of await sectionsOfDay(db, tripId, date)) r.photoIds.forEach((id) => ids.add(id));
    for (const e of entries) if (localDate(e.time, e.tzOffsetMin) === date) e.photoIds.forEach((id) => ids.add(id));
    const photos = await db.photos.bulkGet([...ids]);
    const hashes = new Set<string>();
    for (const p of photos) if (p?.hash) hashes.add(p.hash);
    return hashes;
  });
}

// ---------- DayReports (one section per author) ----------

async function resolveAuthor(db: LogbookDB, tripId: ID, authorId: ID | undefined): Promise<ID> {
  return authorId ?? (await getAuthor(db, tripId)) ?? '';
}

/**
 * Write check for a section: the existing record decides (own or admin); a new section of somebody else
 * may only be started by the admin.
 */
async function assertSectionWritable(db: LogbookDB, tripId: ID, author: ID, existing: DayReport | undefined): Promise<void> {
  if (existing) return assertCanEdit(db, existing);
  const access = await assertCanWrite(db, tripId);
  if (!access.admin && author !== ((await getAuthor(db, tripId)) ?? '')) {
    throw new NotPermittedError('write the day report of somebody else');
  }
}

/** Adds photos to a section (default: own) of that day; the 15-photo limit counts over all sections. */
export async function addPhotosToDayReport(
  db: LogbookDB, tripId: ID, date: string, inputs: readonly PhotoInput[], authorId?: ID,
): Promise<Photo[]> {
  const device = await getDeviceId(db);
  const { photos, id, existing } = await rw(db, [db.dayReports, db.photos], async () => {
    const trip = await tripOf(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const reportId = dayReportId(tripId, date, author);
    const report = await db.dayReports.get(reportId);
    await assertSectionWritable(db, tripId, author, report);
    const dayCount = (await sectionsOfDay(db, tripId, date)).reduce((n, r) => n + r.photoIds.length, 0);
    if (dayCount + inputs.length > MAX_PHOTOS_PER_DAY_REPORT) throw new MaxPhotosError(MAX_PHOTOS_PER_DAY_REPORT);
    const created = newPhotos(trip, inputs);
    await db.photos.bulkAdd(created);
    if (!report) {
      // new section: plain array (no array operation), may share the transaction with the photo rows
      await db.dayReports.add({
        id: reportId, tripId, date, authorId: author, text: '', photoIds: created.map((p) => p.id),
        updatedAt: Date.now(), updatedBy: device, ...realmOf(trip),
      });
    }
    return { photos: created, id: reportId, existing: report };
  });
  if (existing) {
    await db.transaction('rw', db.dayReports, async () => {
      await db.dayReports.update(id, {
        photoIds: add(photos.map((p) => p.id)), deletedAt: undefined, updatedAt: nextAt(existing.updatedAt), updatedBy: device,
      });
    });
  }
  return photos;
}

export async function removePhotoFromDayReport(
  db: LogbookDB, tripId: ID, date: string, photoId: ID, authorId?: ID,
): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.dayReports], async () => {
    const id = dayReportId(tripId, date, await resolveAuthor(db, tripId, authorId));
    const report = await db.dayReports.get(id);
    if (!report) throw new Error(`Day report not found: ${date}`);
    await assertCanEdit(db, report);
    await db.dayReports.update(id, { photoIds: remove([photoId]), updatedAt: nextAt(report.updatedAt), updatedBy: device });
  });
  await deletePhotoRows(db, [photoId]);
}

/** One section per author; `authorId` defaults to the current author of this device ('' if none). */
export async function getDayReport(
  db: LogbookDB, tripId: ID, date: string, authorId?: ID,
): Promise<DayReport | undefined> {
  const author = await resolveAuthor(db, tripId, authorId);
  const r = await db.dayReports.get(dayReportId(tripId, date, author));
  return r?.deletedAt === undefined ? r : undefined;
}

export async function upsertDayReport(
  db: LogbookDB, tripId: ID, date: string, input: { title?: string; text: string }, authorId?: ID,
): Promise<DayReport> {
  const device = await getDeviceId(db);
  return rw(db, [db.dayReports], async () => {
    const trip = await tripOf(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const id = dayReportId(tripId, date, author);
    const existing = await db.dayReports.get(id);
    await assertSectionWritable(db, tripId, author, existing);
    if (!existing) {
      const report: DayReport = {
        id, tripId, date, authorId: author, ...input, photoIds: [], updatedAt: Date.now(), updatedBy: device, ...realmOf(trip),
      };
      await db.dayReports.add(report);
      return report;
    }
    const at = nextAt(existing.updatedAt);
    await db.dayReports.update(id, { title: input.title, text: input.text, deletedAt: undefined, updatedAt: at, updatedBy: device });
    const merged: DayReport = { ...existing, text: input.text, updatedAt: at, updatedBy: device };
    delete merged.deletedAt;
    if (input.title !== undefined) merged.title = input.title;
    else delete merged.title;
    return merged;
  });
}

/** Tombstones a section of that day (default: own; its photo files are removed). */
export async function deleteDayReport(db: LogbookDB, tripId: ID, date: string, authorId?: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.dayReports, db.photos], async () => {
    const id = dayReportId(tripId, date, await resolveAuthor(db, tripId, authorId));
    const r = await db.dayReports.get(id);
    if (!r || r.deletedAt !== undefined) return;
    await assertCanEdit(db, r);
    await db.photos.bulkDelete(await deletablePhotoIds(db, r.photoIds));
    const at = nextAt(r.updatedAt);
    await db.dayReports.update(id, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

async function allDayReports(db: LogbookDB, tripId: ID): Promise<DayReport[]> {
  const all = await db.dayReports.where('tripId').equals(tripId).toArray();
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt || a.authorId.localeCompare(b.authorId));
}

/** All sections (every author) of the trip, sorted by date, then time of writing. */
export async function listDayReports(db: LogbookDB, tripId: ID): Promise<DayReport[]> {
  return (await allDayReports(db, tripId)).filter((r) => r.deletedAt === undefined);
}

// ---------- Tracks (record + point chunks) ----------

function chunkRecords(
  track: TrackRecord, parts: readonly TrackPoint[][], firstSeq: number, device: string, at: number,
): TrackChunk[] {
  return parts.map((points, i) => ({
    id: crypto.randomUUID(), tripId: track.tripId, trackId: track.id, seq: firstSeq + i, points,
    updatedAt: at, updatedBy: device, ...realmOf(track),
  }));
}

export interface TrackInput {
  boatId: ID;
  name: string;
  source: Track['source'];
  points: TrackPoint[];
}

export async function addTrack(db: LogbookDB, tripId: ID, input: TrackInput): Promise<Track> {
  const device = await getDeviceId(db);
  return rw(db, [db.tracks, db.trackChunks, db.boats], async () => {
    await assertCanWrite(db, tripId);
    const trip = await tripOf(db, tripId);
    await assertBoatOf(db, tripId, input.boatId);
    const now = Date.now();
    const { points, ...meta } = input;
    const record: TrackRecord = {
      ...meta, id: crypto.randomUUID(), tripId, createdAt: now, updatedAt: now, updatedBy: device, ...realmOf(trip),
    };
    await db.tracks.add(record);
    await db.trackChunks.bulkAdd(chunkRecords(record, chunkPoints(points), 0, device, now));
    return { ...record, points: [...points] };
  });
}

async function allTrackRecords(db: LogbookDB, tripId: ID): Promise<TrackRecord[]> {
  return db.tracks.where('tripId').equals(tripId).sortBy('createdAt');
}

export async function listTracks(db: LogbookDB, tripId: ID): Promise<Track[]> {
  const records = (await allTrackRecords(db, tripId)).filter((t) => t.deletedAt === undefined);
  if (records.length === 0) return [];
  return assembleTracks(records, await db.trackChunks.where('tripId').equals(tripId).toArray());
}

export async function getTrack(db: LogbookDB, id: ID): Promise<Track | undefined> {
  const record = await db.tracks.get(id);
  if (!record) return undefined;
  return assembleTracks([record], await db.trackChunks.where('trackId').equals(id).toArray())[0];
}

export async function deleteTrack(db: LogbookDB, id: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.tracks], async () => {
    const track = await db.tracks.get(id);
    if (!track || track.deletedAt !== undefined) return;
    await assertCanEdit(db, track);
    const at = nextAt(track.updatedAt);
    await db.tracks.update(id, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

/**
 * Appends to this device's newest chunk of the track (single writer, no conflicts) or starts a new
 * chunk once it is full. The track record itself is not touched.
 */
export async function appendTrackPoints(db: LogbookDB, trackId: ID, points: TrackPoint[]): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.tracks, db.trackChunks], async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    await assertCanEdit(db, track);
    if (points.length === 0) return;
    const chunks = await db.trackChunks.where('trackId').equals(trackId).toArray();
    const maxSeq = chunks.reduce((m, c) => Math.max(m, c.seq), -1);
    const mine = chunks
      .filter((c) => c.updatedBy === device && c.deletedAt === undefined)
      .sort((a, b) => b.seq - a.seq)[0];
    let rest = points;
    if (mine && mine.seq === maxSeq && mine.points.length < TRACK_CHUNK_SIZE) {
      const room = TRACK_CHUNK_SIZE - mine.points.length;
      await db.trackChunks.update(mine.id, {
        points: [...mine.points, ...rest.slice(0, room)], updatedAt: nextAt(mine.updatedAt), updatedBy: device,
      });
      rest = rest.slice(room);
    }
    if (rest.length > 0) await db.trackChunks.bulkAdd(chunkRecords(track, chunkPoints(rest), maxSeq + 1, device, Date.now()));
  });
}

// ---------- Bulk (import / export) ----------

export type { TripBundle };

/** Everything of the trip incl. tombstones (the unit of export). */
export async function loadTripData(db: LogbookDB, tripId: ID): Promise<TripBundle> {
  return db.transaction('r', [db.trips, ...childTables(db)], async () => {
    const trip = await tripOf(db, tripId);
    const chunks = await db.trackChunks.where('tripId').equals(tripId).toArray();
    return {
      trip,
      boats: await listBoats(db, tripId),
      crew: await allCrew(db, tripId),
      entries: await allEntries(db, tripId),
      photos: await db.photos.where('tripId').equals(tripId).sortBy('createdAt'),
      dayReports: await allDayReports(db, tripId),
      tracks: await allTrackRecords(db, tripId),
      trackChunks: chunks.sort((a, b) => a.trackId.localeCompare(b.trackId) || a.seq - b.seq || a.id.localeCompare(b.id)),
      missingPhotos: [],
    };
  });
}

export interface MergeSummary extends MergeStats {
  tripId: ID;
  /** The trip was unknown on this device and has been created. */
  tripCreated: boolean;
  photosAdded: number;
}

function applyPut<T extends { id: ID }>(local: readonly T[], toPut: readonly T[]): T[] {
  const map = new Map(local.map((r) => [r.id, r]));
  for (const r of toPut) map.set(r.id, r);
  return [...map.values()];
}

const CLOUD_KEYS = new Set(['id', 'realmId', 'owner']);

/** Field patch that turns `mine` into `next` (removed fields become undefined); cloud fields untouched. */
function patchOf<T extends object>(mine: T, next: T): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (!CLOUD_KEYS.has(k)) patch[k] = v;
  for (const k of Object.keys(mine)) if (!CLOUD_KEYS.has(k) && !(k in patch)) patch[k] = undefined;
  return patch;
}

/**
 * Writes merged records: known ones are patched via `update()` (sync-consistent, keeps realmId/owner),
 * unknown ones are added into the realm of the local trip. Incoming realmId/owner are ignored.
 */
async function writeMerged<T extends CloudFields & { id: ID }>(
  table: EntityTable<T, 'id'>, local: ReadonlyMap<ID, T>, records: readonly T[], realm: { realmId?: string },
): Promise<void> {
  const fresh: T[] = [];
  for (const rec of records) {
    const clean = withoutCloudFields(rec) as T;
    const mine = local.get(rec.id);
    if (mine) await table.update(rec.id as never, patchOf(mine, clean) as never);
    else fresh.push({ ...clean, ...realm });
  }
  if (fresh.length > 0) await table.bulkAdd(fresh as never);
}

const byId = <T extends { id: ID }>(rows: readonly T[]): Map<ID, T> => new Map(rows.map((r) => [r.id, r]));

/**
 * Import (restore / file exchange, fallback to the cloud): per-record last-writer-wins (tombstones included),
 * photo dedup per day by hash. An unknown trip is created; a known one is merged (in the cloud only by its
 * admin). All records go into the realm of the local trip. Runs in one transaction; idempotent.
 */
export async function mergeBundle(db: LogbookDB, bundle: TripBundle): Promise<MergeSummary> {
  const tripId = bundle.trip.id;
  return rw(db, childTables(db), async () => {
    const localTrip = await db.trips.get(tripId);
    if (localTrip && isSharedRealm(localTrip.realmId)) await assertAdmin(db, tripId);
    const [lBoats, lCrew, lEntries, lReports, lTracks, lChunks] = localTrip
      ? await Promise.all([
        listBoats(db, tripId), allCrew(db, tripId), allEntries(db, tripId), allDayReports(db, tripId),
        allTrackRecords(db, tripId), db.trackChunks.where('tripId').equals(tripId).toArray(),
      ])
      : [[], [], [], [], [], []];
    const localPhotos = await db.photos.where('tripId').equals(tripId).toArray();
    const localPhotoMeta = localPhotos.map((p) => (p.hash ? { id: p.id, hash: p.hash } : { id: p.id }));
    const localPhotoIds = new Set(localPhotoMeta.map((p) => p.id));

    let trip: Trip;
    if (localTrip) {
      trip = mergeTrip(localTrip, bundle.trip);
      if (JSON.stringify(trip) !== JSON.stringify(localTrip)) await db.trips.update(tripId, patchOf(localTrip, trip) as never);
    } else {
      await db.trips.add(withoutCloudFields(bundle.trip) as Trip);
      trip = (await db.trips.get(tripId))!;
    }
    const realm = realmOf(trip);

    const mb = mergeRecords(lBoats, bundle.boats);
    const mc = mergeRecords(lCrew, bundle.crew);
    const me = mergeRecords(lEntries, bundle.entries);
    const mr = mergeRecords(lReports, bundle.dayReports);
    const mt = mergeRecords(lTracks, bundle.tracks);
    const mk = mergeRecords(lChunks, bundle.trackChunks);

    const entries = applyPut(lEntries, me.toPut);
    const dayReports = applyPut(lReports, mr.toPut);
    const boats = applyPut(lBoats, mb.toPut);
    const remapped = remapPhotoIds({
      entries, dayReports,
      photos: [...localPhotoMeta, ...bundle.photos, ...bundle.missingPhotos],
    });

    // Photo rows: insert unknown ones; collapse duplicates onto the canonical id.
    const incoming = new Map(bundle.photos.filter((p) => !localPhotoIds.has(p.id)).map((p) => [p.id, p]));
    const referenced = new Set<ID>([
      ...boats.flatMap((b) => (b.photoId ? [b.photoId] : [])), ...(trip.coverPhotoId ? [trip.coverPhotoId] : []),
    ]);
    for (const r of [...remapped.entries, ...remapped.dayReports]) r.photoIds.forEach((id) => referenced.add(id));
    const localDeletes: ID[] = [];
    for (const [dup, canon] of Object.entries(remapped.remap)) {
      const row = incoming.get(dup) ?? (await db.photos.get(dup));
      if (row && !incoming.has(canon) && !localPhotoIds.has(canon)) incoming.set(canon, { ...row, id: canon });
      if (referenced.has(dup)) continue; // still used elsewhere (other day, boat photo): keep
      incoming.delete(dup);
      if (localPhotoIds.has(dup)) localDeletes.push(dup);
    }

    const unchanged = new Set<unknown>([...lEntries, ...lReports]);
    await writeMerged(db.boats, byId(lBoats), mb.toPut, realm);
    await writeMerged(db.crewMembers, byId(lCrew), mc.toPut, realm);
    await writeMerged(db.entries, byId(lEntries), remapped.entries.filter((e) => !unchanged.has(e)), realm);
    await writeMerged(db.dayReports, byId(lReports), remapped.dayReports.filter((r) => !unchanged.has(r)), realm);
    await writeMerged(db.tracks, byId(lTracks), mt.toPut, realm);
    await writeMerged(db.trackChunks, byId(lChunks), mk.toPut, realm);
    await db.photos.bulkDelete(await deletablePhotoIds(db, localDeletes));
    await db.photos.bulkAdd([...incoming.values()].map((p) => ({ ...(withoutCloudFields(p) as Photo), ...realm })));

    return {
      tripId,
      tripCreated: !localTrip,
      added: me.stats.added + mr.stats.added + mt.stats.added,
      updated: me.stats.updated + mr.stats.updated + mt.stats.updated,
      deleted: me.stats.deleted + mr.stats.deleted + mt.stats.deleted,
      photosAdded: incoming.size,
    };
  });
}
