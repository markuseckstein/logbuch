import Dexie, { add, remove, type EntityTable, type Table } from 'dexie';
import { canManageRealm, canWriteRealm, isSharedRealm, realmPermissions, type PermissionSet } from '../domain/access';
import { localDate } from '../domain/days';
import { dayReportId, timeOrderedId } from '../domain/ids';
import { mergeRecords, mergeTrip, remapPhotoIds, withoutCloudFields, type MergeStats } from '../domain/merge';
import { assembleTracks, chunkPoints, TRACK_CHUNK_SIZE } from '../domain/tracks';
import type {
  CloudFields, CrewDraft, CrewMember, DayReport, Flotilla, ID, LogEntry, Photo, Position, Settings, Track, TrackChunk,
  TrackPoint, TrackRecord, Trip, TripBundle,
} from '../domain/types';
import { rememberDeviceId, storedDeviceId, type LogbookDB } from './db';

export type TripInput = Pick<Trip, 'name' | 'boat'> & { crew: readonly CrewDraft[] } &
  Partial<Pick<Trip, 'startDate' | 'endDate' | 'area' | 'flotilla'>>;

/** Thrown when writing to a trip this device/user may not write (foreign logbook or cloud read-only member). */
export class ReadOnlyTripError extends Error {
  constructor(tripId: ID) {
    super(`Trip is read-only on this device: ${tripId}`);
    this.name = 'ReadOnlyTripError';
  }
}

// ---------- Device, ownership, author ----------

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

async function readList(db: LogbookDB, key: string): Promise<ID[]> {
  const row = await db.settings.get(key);
  return Array.isArray(row?.value) ? (row.value as ID[]) : [];
}

async function readAuthors(db: LogbookDB): Promise<Record<ID, ID>> {
  const row = await db.settings.get('authorByTrip');
  return typeof row?.value === 'object' && row.value !== null ? (row.value as Record<ID, ID>) : {};
}

/** Realm of a stored record, to be carried into every write of its children (never write without realmId). */
function realmOf(rec: CloudFields | undefined): { realmId?: string } {
  return rec?.realmId ? { realmId: rec.realmId } : {};
}

/** Tables every write transaction needs for the permission check. */
function guardTables(db: LogbookDB): Table[] {
  return [db.settings, db.trips, db.realms, db.members, db.roles];
}

function rw<T>(db: LogbookDB, tables: Table[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...tables, ...guardTables(db)], fn);
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

/**
 * May this device write in the trip? Trips shared via Dexie Cloud (realm `rlm~<tripId>`): the server
 * permissions of the signed-in user decide. Otherwise (local mode, private realm): `writableTripIds`.
 */
export async function canWriteTrip(db: LogbookDB, tripId: ID): Promise<boolean> {
  const trip = await db.trips.get(tripId);
  const user = db.cloudUser();
  if (user && trip && isSharedRealm(trip.realmId)) {
    return canWriteRealm(await permissionsIn(db, trip.realmId!, user.userId));
  }
  return (await readList(db, 'writableTripIds')).includes(tripId);
}

/** May invite/remove members and delete the logbook for everybody (skipper / realm owner). */
export async function canManageTrip(db: LogbookDB, tripId: ID): Promise<boolean> {
  const trip = await db.trips.get(tripId);
  const user = db.cloudUser();
  if (user && trip && isSharedRealm(trip.realmId)) {
    return canManageRealm(await permissionsIn(db, trip.realmId!, user.userId));
  }
  return (await readList(db, 'writableTripIds')).includes(tripId);
}

/** Ids of all trips this device may write (UI: badges, read-only banner). */
export async function listWritableTripIds(db: LogbookDB): Promise<ID[]> {
  const out: ID[] = [];
  for (const t of await db.trips.toArray()) if (await canWriteTrip(db, t.id)) out.push(t.id);
  return out;
}

/** Must run inside a transaction that includes the guard tables (see `rw`) or standalone. */
async function assertWritable(db: LogbookDB, tripId: ID): Promise<void> {
  if (!(await canWriteTrip(db, tripId))) throw new ReadOnlyTripError(tripId);
}

async function tripForWrite(db: LogbookDB, tripId: ID): Promise<Trip> {
  await assertWritable(db, tripId);
  const trip = await db.trips.get(tripId);
  if (!trip) throw new Error(`Trip not found: ${tripId}`);
  return trip;
}

export async function setTripOwnership(db: LogbookDB, tripId: ID, ownership: 'own' | 'foreign'): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const ids = (await readList(db, 'writableTripIds')).filter((id) => id !== tripId);
    if (ownership === 'own') ids.push(tripId);
    await db.settings.put({ key: 'writableTripIds', value: ids });
  });
}

/** "Ich bin ...": crew member who writes on this device in that trip. */
export async function setAuthor(db: LogbookDB, tripId: ID, crewId: ID | undefined): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const authors = { ...(await readAuthors(db)) };
    if (crewId === undefined) delete authors[tripId];
    else authors[tripId] = crewId;
    await db.settings.put({ key: 'authorByTrip', value: authors });
  });
}

/**
 * "Ich bin ..." of this device; in cloud mode without a local choice: the active crew member whose
 * e-mail is the signed-in user's (survives logout/login and works on every device of the user).
 */
export async function getAuthor(db: LogbookDB, tripId: ID): Promise<ID | undefined> {
  const local = (await readAuthors(db))[tripId];
  if (local) return local;
  const email = db.cloudUser()?.email?.toLowerCase();
  if (!email) return undefined;
  const crew = await db.crewMembers.where('tripId').equals(tripId).toArray();
  return crew.find((c) => c.deletedAt === undefined && c.email?.toLowerCase() === email)?.id;
}

// ---------- Trips ----------

export async function createTrip(db: LogbookDB, input: TripInput): Promise<Trip> {
  const now = Date.now();
  const device = await getDeviceId(db);
  const { crew, ...fields } = input;
  const id = crypto.randomUUID();
  return db.transaction('rw', db.trips, db.crewMembers, db.settings, async () => {
    await db.trips.add({ ...fields, id, createdAt: now, updatedAt: now, updatedBy: device });
    // the cloud addon assigns realmId/owner on add: read back to hand the realm on to the crew rows
    const trip = (await db.trips.get(id))!;
    await db.crewMembers.bulkAdd(crew.map((c, i) => newCrewMember(trip, c, now + i, device)));
    await setTripOwnership(db, id, 'own');
    return trip;
  });
}

export async function getTrip(db: LogbookDB, id: ID): Promise<Trip | undefined> {
  return db.trips.get(id);
}

export type TripPatch = Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'realmId' | 'owner'>>;

export async function updateTrip(db: LogbookDB, id: ID, patch: TripPatch): Promise<Trip> {
  const device = await getDeviceId(db);
  return rw(db, [], async () => {
    const existing = await tripForWrite(db, id);
    const changes: Partial<Trip> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    await db.trips.update(id, changes);
    return { ...existing, ...changes, id };
  });
}

/** Creates (`{id,name}`) or leaves (`undefined`) a flotilla of this trip. */
export async function setFlotilla(db: LogbookDB, tripId: ID, flotilla: Flotilla | undefined): Promise<Trip> {
  return updateTrip(db, tripId, { flotilla });
}

export async function listTrips(db: LogbookDB): Promise<Trip[]> {
  const all = await db.trips.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listFlotillaTrips(db: LogbookDB, flotillaId: ID): Promise<Trip[]> {
  return (await listTrips(db)).filter((t) => t.flotilla?.id === flotillaId);
}

const childTables = (db: LogbookDB) =>
  [db.crewMembers, db.entries, db.photos, db.dayReports, db.tracks, db.trackChunks] as Table<{ tripId: ID }>[];

async function deleteTripChildren(db: LogbookDB, tripId: ID): Promise<void> {
  for (const table of childTables(db)) await table.where('tripId').equals(tripId).delete();
}

/**
 * Hard delete of the trip and everything in it. Local mode: only on this device. A trip shared via
 * Dexie Cloud is deleted for everybody (needs manage rights; the realm with its members goes too).
 */
export async function deleteTrip(db: LogbookDB, id: ID): Promise<void> {
  await db.transaction('rw', [...childTables(db), db.trips, db.settings, db.realms], async () => {
    const trip = await db.trips.get(id);
    await deleteTripChildren(db, id);
    await db.trips.delete(id);
    if (trip && isSharedRealm(trip.realmId)) await db.realms.delete(trip.realmId!);
    if ((await db.settings.get('activeTripId'))?.value === id) await setActiveTrip(db, undefined);
    await setTripOwnership(db, id, 'foreign');
    await setAuthor(db, id, undefined);
  });
}

/**
 * Moves the trip and all its records into `realmId` (Dexie Cloud: share the logbook). Uses `update`/
 * object-`modify` only (sync-consistent). The realm is upserted (tied realm ids converge across devices).
 */
export async function moveTripToRealm(
  db: LogbookDB, tripId: ID, realmId: string, realm: { name: string; represents: string },
): Promise<void> {
  await db.transaction('rw', [db.trips, db.realms, ...childTables(db)], async () => {
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    await db.realms.upsert(realmId, realm);
    await db.trips.update(tripId, { realmId });
    for (const table of childTables(db)) await table.where('tripId').equals(tripId).modify({ realmId } as never);
  });
}

// ---------- Crew ----------

function newCrewMember(trip: Trip, draft: CrewDraft, at: number, device: string): CrewMember {
  return {
    id: draft.id, tripId: trip.id, name: draft.name, ...(draft.role ? { role: draft.role } : {}),
    createdAt: at, updatedAt: at, updatedBy: device, ...realmOf(trip),
  };
}

async function allCrew(db: LogbookDB, tripId: ID): Promise<CrewMember[]> {
  const all = await db.crewMembers.where('tripId').equals(tripId).toArray();
  return all.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** All crew members incl. tombstones (names stay resolvable for author labels). */
export async function listCrew(db: LogbookDB, tripId: ID): Promise<CrewMember[]> {
  return allCrew(db, tripId);
}

/**
 * Applies an edited crew list: new members are added, changed ones patched (name/role), removed ones
 * become tombstones, re-added ones are revived. Each member is its own record (no conflicts between devices).
 */
export async function saveCrew(db: LogbookDB, tripId: ID, next: readonly CrewDraft[]): Promise<CrewMember[]> {
  const device = await getDeviceId(db);
  return rw(db, [db.crewMembers], async () => {
    const trip = await tripForWrite(db, tripId);
    const existing = new Map((await allCrew(db, tripId)).map((c) => [c.id, c]));
    const now = Date.now();
    let i = 0;
    for (const d of next) {
      const p = existing.get(d.id);
      if (!p) {
        await db.crewMembers.add(newCrewMember(trip, d, now + i++, device));
      } else if (p.deletedAt !== undefined || p.name !== d.name || p.role !== d.role) {
        await db.crewMembers.update(d.id, {
          name: d.name, role: d.role, deletedAt: undefined, updatedAt: nextAt(p.updatedAt), updatedBy: device,
        });
      }
    }
    for (const p of existing.values()) {
      if (p.deletedAt !== undefined || next.some((d) => d.id === p.id)) continue;
      const at = nextAt(p.updatedAt);
      await db.crewMembers.update(p.id, { deletedAt: at, updatedAt: at, updatedBy: device });
    }
    return allCrew(db, tripId);
  });
}

/** Links a crew member with a cloud account (e-mail) – "Ich bin ..." across devices. Unlinks others with that e-mail. */
export async function linkCrewEmail(db: LogbookDB, crewId: ID, email: string | undefined): Promise<void> {
  const device = await getDeviceId(db);
  const normalized = email?.trim().toLowerCase() || undefined;
  await rw(db, [db.crewMembers], async () => {
    const member = await db.crewMembers.get(crewId);
    if (!member) throw new Error(`Crew member not found: ${crewId}`);
    await assertWritable(db, member.tripId);
    if (normalized) {
      for (const other of await db.crewMembers.where('tripId').equals(member.tripId).toArray()) {
        if (other.id !== crewId && other.email === normalized) {
          await db.crewMembers.update(other.id, { email: undefined, updatedAt: nextAt(other.updatedAt), updatedBy: device });
        }
      }
    }
    await db.crewMembers.update(crewId, { email: normalized, updatedAt: nextAt(member.updatedAt), updatedBy: device });
  });
}

// ---------- Settings ----------

export async function getSettings(db: LogbookDB): Promise<Settings> {
  const [deviceRow, theme, active, writableTripIds, authorByTrip] = await Promise.all([
    db.settings.get('deviceId'), db.settings.get('theme'), db.settings.get('activeTripId'), readList(db, 'writableTripIds'), readAuthors(db),
  ]);
  const settings: Settings = {
    theme: (theme?.value as Settings['theme'] | undefined) ?? 'system',
    deviceId: typeof deviceRow?.value === 'string' ? deviceRow.value : (storedDeviceId() ?? ''), writableTripIds, authorByTrip,
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

// ---------- Entries ----------

export interface EntryInput {
  time: number;
  tzOffsetMin: number;
  position?: Position;
}

export async function createEntry(db: LogbookDB, tripId: ID, input: EntryInput): Promise<LogEntry> {
  const device = await getDeviceId(db);
  return rw(db, [db.entries, db.crewMembers], async () => {
    const trip = await tripForWrite(db, tripId);
    const authorId = await getAuthor(db, tripId);
    const now = Date.now();
    const entry: LogEntry = {
      ...input, id: crypto.randomUUID(), tripId, type: 'note', photoIds: [],
      ...(authorId ? { authorId } : {}), createdAt: now, updatedAt: now, updatedBy: device, ...realmOf(trip),
    };
    await db.entries.add(entry);
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
  return rw(db, [db.entries], async () => {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);
    await assertWritable(db, existing.tripId);
    const changes: Partial<LogEntry> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    await db.entries.update(id, changes);
    return { ...existing, ...changes };
  });
}

export async function updateEntry(
  db: LogbookDB, id: ID,
  patch: Partial<Omit<LogEntry, 'id' | 'tripId' | 'createdAt' | 'photoIds' | 'updatedAt' | 'updatedBy' | 'deletedAt' | 'realmId' | 'owner'>>,
): Promise<LogEntry> {
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
    await assertWritable(db, entry.tripId);
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
    const trip = await tripForWrite(db, entry.tripId);
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

async function sectionsOfDay(db: LogbookDB, tripId: ID, date: string): Promise<DayReport[]> {
  return db.dayReports.where('tripId').equals(tripId).filter((r) => r.date === date && r.deletedAt === undefined).toArray();
}

async function resolveAuthor(db: LogbookDB, tripId: ID, authorId: ID | undefined): Promise<ID> {
  return authorId ?? (await getAuthor(db, tripId)) ?? '';
}

/** Adds photos to the own section (current author) of that day; the 15-photo limit counts over all sections. */
export async function addPhotosToDayReport(
  db: LogbookDB, tripId: ID, date: string, inputs: readonly PhotoInput[], authorId?: ID,
): Promise<Photo[]> {
  const device = await getDeviceId(db);
  const { photos, id, existing } = await rw(db, [db.dayReports, db.photos, db.crewMembers], async () => {
    const trip = await tripForWrite(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const dayCount = (await sectionsOfDay(db, tripId, date)).reduce((n, r) => n + r.photoIds.length, 0);
    if (dayCount + inputs.length > MAX_PHOTOS_PER_DAY_REPORT) throw new MaxPhotosError(MAX_PHOTOS_PER_DAY_REPORT);
    const reportId = dayReportId(tripId, date, author);
    const report = await db.dayReports.get(reportId);
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
  await rw(db, [db.dayReports, db.crewMembers], async () => {
    await assertWritable(db, tripId);
    const id = dayReportId(tripId, date, await resolveAuthor(db, tripId, authorId));
    const report = await db.dayReports.get(id);
    if (!report) throw new Error(`Day report not found: ${date}`);
    await db.dayReports.update(id, { photoIds: remove([photoId]), updatedAt: nextAt(report.updatedAt), updatedBy: device });
  });
  await deletePhotoRows(db, [photoId]);
}

/** Separate transaction (see note above): removes photo rows this user may delete. */
async function deletePhotoRows(db: LogbookDB, ids: readonly ID[]): Promise<void> {
  await db.transaction('rw', db.photos, async () => {
    await db.photos.bulkDelete(await deletablePhotoIds(db, ids));
  });
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

export async function removePhotoFromEntry(db: LogbookDB, entryId: ID, photoId: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.entries], async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await assertWritable(db, entry.tripId);
    await db.entries.update(entryId, { photoIds: remove([photoId]), updatedAt: nextAt(entry.updatedAt), updatedBy: device });
  });
  await deletePhotoRows(db, [photoId]);
}

export async function setBoatPhoto(db: LogbookDB, tripId: ID, input: PhotoInput): Promise<Photo> {
  const device = await getDeviceId(db);
  return rw(db, [db.photos], async () => {
    const trip = await tripForWrite(db, tripId);
    if (trip.boat.photoId) await db.photos.bulkDelete(await deletablePhotoIds(db, [trip.boat.photoId]));
    const [photo] = newPhotos(trip, [input]);
    await db.photos.add(photo!);
    // key path update: only boat.photoId changes, parallel edits of other boat fields survive
    await db.trips.update(tripId, { 'boat.photoId': photo!.id, updatedAt: nextAt(trip.updatedAt), updatedBy: device });
    return photo!;
  });
}

// ---------- DayReports ----------

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
  return rw(db, [db.dayReports, db.crewMembers], async () => {
    const trip = await tripForWrite(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const id = dayReportId(tripId, date, author);
    const existing = await db.dayReports.get(id);
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

/** Tombstones the own section of that day (its photo files are removed). */
export async function deleteDayReport(db: LogbookDB, tripId: ID, date: string, authorId?: ID): Promise<void> {
  const device = await getDeviceId(db);
  await rw(db, [db.dayReports, db.photos, db.crewMembers], async () => {
    await assertWritable(db, tripId);
    const id = dayReportId(tripId, date, await resolveAuthor(db, tripId, authorId));
    const r = await db.dayReports.get(id);
    if (!r || r.deletedAt !== undefined) return;
    await db.photos.bulkDelete(await deletablePhotoIds(db, r.photoIds));
    const at = nextAt(r.updatedAt);
    await db.dayReports.update(id, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

async function allDayReports(db: LogbookDB, tripId: ID): Promise<DayReport[]> {
  const all = await db.dayReports.where('tripId').equals(tripId).toArray();
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.authorId.localeCompare(b.authorId));
}

/** All sections (every author) of the trip, sorted by date, then author. */
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

export async function addTrack(
  db: LogbookDB, tripId: ID, input: { name: string; source: Track['source']; points: TrackPoint[] },
): Promise<Track> {
  const device = await getDeviceId(db);
  return rw(db, [db.tracks, db.trackChunks], async () => {
    const trip = await tripForWrite(db, tripId);
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
    await assertWritable(db, track.tripId);
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
    await assertWritable(db, track.tripId);
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
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    const chunks = await db.trackChunks.where('tripId').equals(tripId).toArray();
    return {
      trip,
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
 * Merge-import (Datei-Austausch, Fallback zur Cloud): per-record last-writer-wins (tombstones included),
 * photo dedup per day by hash. Unknown trips are created (`ownership` decides writable vs. read-only),
 * known trips keep theirs. All records go into the realm of the local trip. Runs in one transaction; idempotent.
 */
export async function mergeBundle(
  db: LogbookDB, bundle: TripBundle, opts: { ownership: 'own' | 'foreign' },
): Promise<MergeSummary> {
  const tripId = bundle.trip.id;
  return rw(db, childTables(db), async () => {
    const localTrip = await db.trips.get(tripId);
    // a logbook synced via the cloud only takes file imports from users who may write in it
    if (localTrip && isSharedRealm(localTrip.realmId)) await assertWritable(db, tripId);
    const [lCrew, lEntries, lReports, lTracks, lChunks] = localTrip
      ? await Promise.all([
        allCrew(db, tripId), allEntries(db, tripId), allDayReports(db, tripId), allTrackRecords(db, tripId),
        db.trackChunks.where('tripId').equals(tripId).toArray(),
      ])
      : [[], [], [], [], []];
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

    const mc = mergeRecords(lCrew, bundle.crew);
    const me = mergeRecords(lEntries, bundle.entries);
    const mr = mergeRecords(lReports, bundle.dayReports);
    const mt = mergeRecords(lTracks, bundle.tracks);
    const mk = mergeRecords(lChunks, bundle.trackChunks);

    const entries = applyPut(lEntries, me.toPut);
    const dayReports = applyPut(lReports, mr.toPut);
    const remapped = remapPhotoIds({
      entries, dayReports,
      photos: [...localPhotoMeta, ...bundle.photos, ...bundle.missingPhotos],
    });

    // Photo rows: insert unknown ones; collapse duplicates onto the canonical id.
    const incoming = new Map(bundle.photos.filter((p) => !localPhotoIds.has(p.id)).map((p) => [p.id, p]));
    const referenced = new Set<ID>(trip.boat.photoId ? [trip.boat.photoId] : []);
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
    await writeMerged(db.crewMembers, byId(lCrew), mc.toPut, realm);
    await writeMerged(db.entries, byId(lEntries), remapped.entries.filter((e) => !unchanged.has(e)), realm);
    await writeMerged(db.dayReports, byId(lReports), remapped.dayReports.filter((r) => !unchanged.has(r)), realm);
    await writeMerged(db.tracks, byId(lTracks), mt.toPut, realm);
    await writeMerged(db.trackChunks, byId(lChunks), mk.toPut, realm);
    await db.photos.bulkDelete(await deletablePhotoIds(db, localDeletes));
    await db.photos.bulkAdd([...incoming.values()].map((p) => ({ ...(withoutCloudFields(p) as Photo), ...realm })));
    if (!localTrip && opts.ownership === 'own') await setTripOwnership(db, tripId, 'own');

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
