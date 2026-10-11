import Dexie from 'dexie';
import { localDate } from '../domain/days';
import { dayReportKey, mergeRecords, mergeTrip, remapPhotoIds, type MergeStats } from '../domain/merge';
import type {
  CrewMember, DayReport, Flotilla, ID, LogEntry, Photo, Position, Settings, Track, TrackPoint, Trip, TripBundle,
} from '../domain/types';
import type { LogbookDB } from './db';

export type TripInput = Pick<Trip, 'name' | 'boat' | 'crew'> &
  Partial<Pick<Trip, 'startDate' | 'endDate' | 'area' | 'flotilla'>>;

/** Thrown when writing to a trip that is not in `Settings.writableTripIds` (foreign logbook). */
export class ReadOnlyTripError extends Error {
  constructor(tripId: ID) {
    super(`Trip is read-only on this device: ${tripId}`);
    this.name = 'ReadOnlyTripError';
  }
}

// ---------- Device, ownership, author ----------

const deviceIds = new WeakMap<LogbookDB, Promise<string>>();

/** Random per-device id (never exported), generated once; stamps `updatedBy` of all writes. */
export function getDeviceId(db: LogbookDB): Promise<string> {
  let cached = deviceIds.get(db);
  if (!cached) {
    cached = db.transaction('rw', db.settings, async () => {
      const row = await db.settings.get('deviceId');
      if (typeof row?.value === 'string') return row.value;
      const id = crypto.randomUUID();
      await db.settings.put({ key: 'deviceId', value: id });
      return id;
    });
    deviceIds.set(db, cached);
    cached.catch(() => deviceIds.delete(db));
  }
  return cached;
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

/** Must run inside a transaction that includes `db.settings` (or standalone). */
async function assertWritable(db: LogbookDB, tripId: ID): Promise<void> {
  if (!(await readList(db, 'writableTripIds')).includes(tripId)) throw new ReadOnlyTripError(tripId);
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

export async function getAuthor(db: LogbookDB, tripId: ID): Promise<ID | undefined> {
  return (await readAuthors(db))[tripId];
}

// ---------- Trips ----------

function stampCrew(crew: readonly CrewMember[], at: number, by: string): CrewMember[] {
  return crew.map((c) => ({ ...c, updatedAt: c.updatedAt ?? at, updatedBy: c.updatedBy ?? by }));
}

export async function createTrip(db: LogbookDB, input: TripInput): Promise<Trip> {
  const now = Date.now();
  const device = await getDeviceId(db);
  const trip: Trip = {
    ...input, crew: stampCrew(input.crew, now, device), id: crypto.randomUUID(),
    createdAt: now, updatedAt: now, updatedBy: device,
  };
  await db.transaction('rw', db.trips, db.settings, async () => {
    await db.trips.add(trip);
    await setTripOwnership(db, trip.id, 'own');
  });
  return trip;
}

export async function getTrip(db: LogbookDB, id: ID): Promise<Trip | undefined> {
  return db.trips.get(id);
}

/** Applies a new crew list: changed members get a new version, removed ones become tombstones. */
function applyCrew(existing: readonly CrewMember[], next: readonly CrewMember[], device: string): CrewMember[] {
  const prev = new Map(existing.map((c) => [c.id, c]));
  const out: CrewMember[] = [];
  for (const m of next) {
    const p = prev.get(m.id);
    if (m.deletedAt !== undefined) {
      out.push(p ?? m); // tombstones are only created by removal
    } else if (p && p.deletedAt === undefined && p.name === m.name && p.role === m.role) {
      out.push(p);
    } else {
      out.push({
        id: m.id, name: m.name, ...(m.role ? { role: m.role } : {}),
        updatedAt: nextAt(p?.updatedAt ?? 0), updatedBy: device,
      });
    }
  }
  for (const p of existing) {
    if (next.some((m) => m.id === p.id)) continue;
    const at = nextAt(p.updatedAt ?? 0);
    out.push(p.deletedAt !== undefined ? p : { ...p, deletedAt: at, updatedAt: at, updatedBy: device });
  }
  return out;
}

export type TripPatch = Partial<Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'deletedAt'>>;

export async function updateTrip(db: LogbookDB, id: ID, patch: TripPatch): Promise<Trip> {
  const device = await getDeviceId(db);
  return db.transaction('rw', db.trips, db.settings, async () => {
    await assertWritable(db, id);
    const existing = await db.trips.get(id);
    if (!existing) throw new Error(`Trip not found: ${id}`);
    const changes: Partial<Trip> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    if (patch.crew) changes.crew = applyCrew(existing.crew, patch.crew, device);
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

async function deleteTripChildren(db: LogbookDB, tripId: ID): Promise<void> {
  await db.entries.where('tripId').equals(tripId).delete();
  await db.photos.where('tripId').equals(tripId).delete();
  await db.dayReports.where('tripId').equals(tripId).delete();
  await db.tracks.where('tripId').equals(tripId).delete();
}

/** Hard delete, only on this device (no tombstone, nothing is propagated by merges). */
export async function deleteTrip(db: LogbookDB, id: ID): Promise<void> {
  await db.transaction('rw', [db.trips, db.entries, db.photos, db.dayReports, db.tracks, db.settings], async () => {
    await deleteTripChildren(db, id);
    await db.trips.delete(id);
    if ((await db.settings.get('activeTripId'))?.value === id) await setActiveTrip(db, undefined);
    await setTripOwnership(db, id, 'foreign');
    await setAuthor(db, id, undefined);
  });
}

// ---------- Settings ----------

export async function getSettings(db: LogbookDB): Promise<Settings> {
  const [deviceRow, theme, active, writableTripIds, authorByTrip] = await Promise.all([
    db.settings.get('deviceId'), db.settings.get('theme'), db.settings.get('activeTripId'), readList(db, 'writableTripIds'), readAuthors(db),
  ]);
  const settings: Settings = {
    theme: (theme?.value as Settings['theme'] | undefined) ?? 'system',
    deviceId: typeof deviceRow?.value === 'string' ? deviceRow.value : '', writableTripIds, authorByTrip,
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
  return db.transaction('rw', db.entries, db.settings, async () => {
    await assertWritable(db, tripId);
    const authorId = await getAuthor(db, tripId);
    const now = Date.now();
    const entry: LogEntry = {
      ...input, id: crypto.randomUUID(), tripId, type: 'note', photoIds: [],
      ...(authorId ? { authorId } : {}), createdAt: now, updatedAt: now, updatedBy: device,
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
  return db.transaction('rw', db.entries, db.settings, async () => {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);
    await assertWritable(db, existing.tripId);
    const changes: Partial<LogEntry> = { ...patch, updatedAt: nextAt(existing.updatedAt), updatedBy: device };
    await db.entries.update(id, changes);
    return { ...existing, ...changes };
  });
}

export async function updateEntry(
  db: LogbookDB, id: ID, patch: Partial<Omit<LogEntry, 'id' | 'tripId' | 'createdAt' | 'photoIds' | 'updatedAt' | 'updatedBy' | 'deletedAt'>>,
): Promise<LogEntry> {
  return patchEntry(db, id, patch);
}

export async function setEntryPosition(db: LogbookDB, id: ID, position: Position | undefined): Promise<LogEntry> {
  return patchEntry(db, id, { position });
}

/** Tombstone: the entry stays (so the deletion merges), lists hide it; its photo files are removed. */
export async function deleteEntry(db: LogbookDB, id: ID): Promise<void> {
  const device = await getDeviceId(db);
  await db.transaction('rw', db.entries, db.photos, db.settings, async () => {
    const entry = await db.entries.get(id);
    if (!entry || entry.deletedAt !== undefined) return;
    await assertWritable(db, entry.tripId);
    await db.photos.bulkDelete(entry.photoIds);
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

export async function addPhotoToEntry(db: LogbookDB, entryId: ID, input: PhotoInput): Promise<Photo> {
  const [photo] = await addPhotosToEntry(db, entryId, [input]);
  return photo!;
}

/** Adds several photos atomically (all or none). */
export async function addPhotosToEntry(db: LogbookDB, entryId: ID, inputs: readonly PhotoInput[]): Promise<Photo[]> {
  const device = await getDeviceId(db);
  return db.transaction('rw', db.entries, db.photos, db.settings, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await assertWritable(db, entry.tripId);
    if (entry.photoIds.length + inputs.length > MAX_PHOTOS_PER_ENTRY) throw new MaxPhotosError(MAX_PHOTOS_PER_ENTRY);
    const now = Date.now();
    const photos: Photo[] = inputs.map((input, i) => ({
      ...input, id: crypto.randomUUID(), tripId: entry.tripId, createdAt: now + i,
    }));
    await db.photos.bulkAdd(photos);
    await db.entries.update(entryId, {
      photoIds: [...entry.photoIds, ...photos.map((p) => p.id)], updatedAt: nextAt(entry.updatedAt), updatedBy: device,
    });
    return photos;
  });
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
  return db.transaction('rw', db.dayReports, db.photos, db.settings, async () => {
    await assertWritable(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const dayCount = (await sectionsOfDay(db, tripId, date)).reduce((n, r) => n + r.photoIds.length, 0);
    if (dayCount + inputs.length > MAX_PHOTOS_PER_DAY_REPORT) throw new MaxPhotosError(MAX_PHOTOS_PER_DAY_REPORT);
    const report = await db.dayReports.get([tripId, date, author]);
    const now = Date.now();
    const photos: Photo[] = inputs.map((input, i) => ({ ...input, id: crypto.randomUUID(), tripId, createdAt: now + i }));
    await db.photos.bulkAdd(photos);
    const ids = photos.map((p) => p.id);
    if (report) {
      await db.dayReports.update([tripId, date, author], {
        photoIds: [...report.photoIds, ...ids], deletedAt: undefined, updatedAt: nextAt(report.updatedAt), updatedBy: device,
      });
    } else {
      await db.dayReports.add({ tripId, date, authorId: author, text: '', photoIds: ids, updatedAt: now, updatedBy: device });
    }
    return photos;
  });
}

export async function removePhotoFromDayReport(
  db: LogbookDB, tripId: ID, date: string, photoId: ID, authorId?: ID,
): Promise<void> {
  const device = await getDeviceId(db);
  await db.transaction('rw', db.dayReports, db.photos, db.settings, async () => {
    await assertWritable(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const report = await db.dayReports.get([tripId, date, author]);
    if (!report) throw new Error(`Day report not found: ${date}`);
    await db.photos.delete(photoId);
    await db.dayReports.update([tripId, date, author], {
      photoIds: report.photoIds.filter((p) => p !== photoId), updatedAt: nextAt(report.updatedAt), updatedBy: device,
    });
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
  await db.transaction('rw', db.entries, db.photos, db.settings, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await assertWritable(db, entry.tripId);
    await db.photos.delete(photoId);
    await db.entries.update(entryId, {
      photoIds: entry.photoIds.filter((p) => p !== photoId), updatedAt: nextAt(entry.updatedAt), updatedBy: device,
    });
  });
}

export async function setBoatPhoto(db: LogbookDB, tripId: ID, input: PhotoInput): Promise<Photo> {
  const device = await getDeviceId(db);
  return db.transaction('rw', db.trips, db.photos, db.settings, async () => {
    await assertWritable(db, tripId);
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    if (trip.boat.photoId) await db.photos.delete(trip.boat.photoId);
    const photo: Photo = { ...input, id: crypto.randomUUID(), tripId, createdAt: Date.now() };
    await db.photos.add(photo);
    await db.trips.update(tripId, { boat: { ...trip.boat, photoId: photo.id }, updatedAt: nextAt(trip.updatedAt), updatedBy: device });
    return photo;
  });
}

// ---------- DayReports ----------

/** One section per author; `authorId` defaults to the current author of this device ('' if none). */
export async function getDayReport(
  db: LogbookDB, tripId: ID, date: string, authorId?: ID,
): Promise<DayReport | undefined> {
  const author = await resolveAuthor(db, tripId, authorId);
  const r = await db.dayReports.get([tripId, date, author]);
  return r?.deletedAt === undefined ? r : undefined;
}

export async function upsertDayReport(
  db: LogbookDB, tripId: ID, date: string, input: { title?: string; text: string }, authorId?: ID,
): Promise<DayReport> {
  const device = await getDeviceId(db);
  return db.transaction('rw', db.dayReports, db.settings, async () => {
    await assertWritable(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const existing = await db.dayReports.get([tripId, date, author]);
    if (!existing) {
      const report: DayReport = {
        tripId, date, authorId: author, ...input, photoIds: [], updatedAt: Date.now(), updatedBy: device,
      };
      await db.dayReports.add(report);
      return report;
    }
    const at = nextAt(existing.updatedAt);
    await db.dayReports.update([tripId, date, author], {
      title: input.title, text: input.text, deletedAt: undefined, updatedAt: at, updatedBy: device,
    });
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
  await db.transaction('rw', db.dayReports, db.photos, db.settings, async () => {
    await assertWritable(db, tripId);
    const author = await resolveAuthor(db, tripId, authorId);
    const r = await db.dayReports.get([tripId, date, author]);
    if (!r || r.deletedAt !== undefined) return;
    await db.photos.bulkDelete(r.photoIds);
    const at = nextAt(r.updatedAt);
    await db.dayReports.update([tripId, date, author], { deletedAt: at, updatedAt: at, updatedBy: device });
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

// ---------- Tracks ----------

export async function addTrack(
  db: LogbookDB, tripId: ID, input: { name: string; source: Track['source']; points: TrackPoint[] },
): Promise<Track> {
  const device = await getDeviceId(db);
  return db.transaction('rw', db.tracks, db.settings, async () => {
    await assertWritable(db, tripId);
    const now = Date.now();
    const track: Track = { ...input, id: crypto.randomUUID(), tripId, createdAt: now, updatedAt: now, updatedBy: device };
    await db.tracks.add(track);
    return track;
  });
}

async function allTracks(db: LogbookDB, tripId: ID): Promise<Track[]> {
  return db.tracks.where('tripId').equals(tripId).sortBy('createdAt');
}

export async function listTracks(db: LogbookDB, tripId: ID): Promise<Track[]> {
  return (await allTracks(db, tripId)).filter((t) => t.deletedAt === undefined);
}

export async function deleteTrack(db: LogbookDB, id: ID): Promise<void> {
  const device = await getDeviceId(db);
  await db.transaction('rw', db.tracks, db.settings, async () => {
    const track = await db.tracks.get(id);
    if (!track || track.deletedAt !== undefined) return;
    await assertWritable(db, track.tripId);
    const at = nextAt(track.updatedAt);
    await db.tracks.update(id, { deletedAt: at, updatedAt: at, updatedBy: device });
  });
}

export async function appendTrackPoints(db: LogbookDB, trackId: ID, points: TrackPoint[]): Promise<void> {
  const device = await getDeviceId(db);
  await db.transaction('rw', db.tracks, db.settings, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    await assertWritable(db, track.tripId);
    await db.tracks.update(trackId, { points: [...track.points, ...points], updatedAt: nextAt(track.updatedAt), updatedBy: device });
  });
}

// ---------- Bulk (import / export) ----------

export type { TripBundle };

const ALL_TABLES = (db: LogbookDB) => [db.trips, db.entries, db.photos, db.dayReports, db.tracks, db.settings];

/** Everything of the trip incl. tombstones (the unit of export). */
export async function loadTripData(db: LogbookDB, tripId: ID): Promise<TripBundle> {
  return db.transaction('r', [db.trips, db.entries, db.photos, db.dayReports, db.tracks], async () => {
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    return {
      trip,
      entries: await allEntries(db, tripId),
      photos: await db.photos.where('tripId').equals(tripId).sortBy('createdAt'),
      dayReports: await allDayReports(db, tripId),
      tracks: await allTracks(db, tripId),
      missingPhotos: [],
    };
  });
}

/** Replaces the whole trip with the bundle ("ersetzen"). A previously unknown trip becomes writable unless `foreign`. */
export async function replaceTripData(
  db: LogbookDB, bundle: TripBundle, opts: { ownership?: 'own' | 'foreign' } = {},
): Promise<void> {
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const known = await db.trips.get(bundle.trip.id);
    await deleteTripChildren(db, bundle.trip.id);
    await db.trips.put(bundle.trip);
    await db.entries.bulkPut(bundle.entries);
    await db.photos.bulkPut(bundle.photos);
    await db.dayReports.bulkPut(bundle.dayReports);
    await db.tracks.bulkPut(bundle.tracks);
    if (!known && (opts.ownership ?? 'own') === 'own') await setTripOwnership(db, bundle.trip.id, 'own');
  });
}

export interface MergeSummary extends MergeStats {
  tripId: ID;
  /** The trip was unknown on this device and has been created. */
  tripCreated: boolean;
  photosAdded: number;
}

function applyPut<T>(local: readonly T[], toPut: readonly T[], keyOf: (r: T) => string): T[] {
  const map = new Map(local.map((r) => [keyOf(r), r]));
  for (const r of toPut) map.set(keyOf(r), r);
  return [...map.values()];
}

/**
 * Merge-import: per-record last-writer-wins (tombstones included), photo dedup per day by hash.
 * Unknown trips are created (`ownership` decides writable vs. read-only), known trips keep theirs.
 * Runs in one transaction; idempotent.
 */
export async function mergeBundle(
  db: LogbookDB, bundle: TripBundle, opts: { ownership: 'own' | 'foreign' },
): Promise<MergeSummary> {
  const tripId = bundle.trip.id;
  return db.transaction('rw', ALL_TABLES(db), async () => {
    const localTrip = await db.trips.get(tripId);
    const [lEntries, lReports, lTracks] = localTrip
      ? await Promise.all([allEntries(db, tripId), allDayReports(db, tripId), allTracks(db, tripId)])
      : [[], [], []];
    const localPhotoMeta: { id: ID; hash?: string }[] = [];
    await db.photos.where('tripId').equals(tripId).each((p) => {
      localPhotoMeta.push(p.hash ? { id: p.id, hash: p.hash } : { id: p.id });
    });
    const localPhotoIds = new Set(localPhotoMeta.map((p) => p.id));

    const trip = localTrip ? mergeTrip(localTrip, bundle.trip) : bundle.trip;
    const me = mergeRecords(lEntries, bundle.entries);
    const mr = mergeRecords(lReports, bundle.dayReports, dayReportKey);
    const mt = mergeRecords(lTracks, bundle.tracks);

    const entries = applyPut(lEntries, me.toPut, (e) => e.id);
    const dayReports = applyPut(lReports, mr.toPut, dayReportKey);
    const remapped = remapPhotoIds({
      entries, dayReports,
      photos: [...localPhotoMeta, ...bundle.photos, ...(bundle.missingPhotos)],
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

    const localSet = new Set<unknown>([...lEntries, ...lReports]);
    await db.trips.put(trip);
    await db.entries.bulkPut(remapped.entries.filter((e) => !localSet.has(e)));
    await db.dayReports.bulkPut(remapped.dayReports.filter((r) => !localSet.has(r)));
    await db.tracks.bulkPut(mt.toPut);
    await db.photos.bulkDelete(localDeletes);
    await db.photos.bulkPut([...incoming.values()]);
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
