import Dexie from 'dexie';
import { localDate } from '../domain/days';
import type {
  DayReport, ID, LogEntry, Photo, Position, Settings, Track, TrackPoint, Trip, TripBundle,
} from '../domain/types';
import type { LogbookDB } from './db';

export type TripInput = Pick<Trip, 'name' | 'boat' | 'crew'> &
  Partial<Pick<Trip, 'startDate' | 'endDate' | 'area'>>;

// ---------- Trips ----------

export async function createTrip(db: LogbookDB, input: TripInput): Promise<Trip> {
  const now = Date.now();
  const trip: Trip = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.trips.add(trip);
  return trip;
}

export async function getTrip(db: LogbookDB, id: ID): Promise<Trip | undefined> {
  return db.trips.get(id);
}

export async function updateTrip(
  db: LogbookDB, id: ID, patch: Partial<Omit<Trip, 'id' | 'createdAt'>>,
): Promise<Trip> {
  return db.transaction('rw', db.trips, async () => {
    const existing = await db.trips.get(id);
    if (!existing) throw new Error(`Trip not found: ${id}`);
    const updated: Trip = { ...existing, ...patch, id, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
    await db.trips.put(updated);
    return updated;
  });
}

export async function listTrips(db: LogbookDB): Promise<Trip[]> {
  const all = await db.trips.toArray();
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

async function deleteTripChildren(db: LogbookDB, tripId: ID): Promise<void> {
  await db.entries.where('tripId').equals(tripId).delete();
  await db.photos.where('tripId').equals(tripId).delete();
  await db.dayReports.where('tripId').equals(tripId).delete();
  await db.tracks.where('tripId').equals(tripId).delete();
}

export async function deleteTrip(db: LogbookDB, id: ID): Promise<void> {
  await db.transaction('rw', [db.trips, db.entries, db.photos, db.dayReports, db.tracks, db.settings], async () => {
    await deleteTripChildren(db, id);
    await db.trips.delete(id);
    if ((await getSettings(db)).activeTripId === id) await setActiveTrip(db, undefined);
  });
}

// ---------- Settings ----------

export async function getSettings(db: LogbookDB): Promise<Settings> {
  const [theme, active] = await Promise.all([db.settings.get('theme'), db.settings.get('activeTripId')]);
  const settings: Settings = { theme: (theme?.value as Settings['theme'] | undefined) ?? 'system' };
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
  const now = Date.now();
  const entry: LogEntry = {
    ...input, id: crypto.randomUUID(), tripId, type: 'note', photoIds: [], createdAt: now, updatedAt: now,
  };
  await db.entries.add(entry);
  return entry;
}

export async function listEntries(db: LogbookDB, tripId: ID): Promise<LogEntry[]> {
  return db.entries.where('[tripId+time]').between([tripId, Dexie.minKey], [tripId, Dexie.maxKey]).toArray();
}

export async function updateEntry(
  db: LogbookDB, id: ID, patch: Partial<Omit<LogEntry, 'id' | 'tripId' | 'createdAt' | 'photoIds'>>,
): Promise<LogEntry> {
  return db.transaction('rw', db.entries, async () => {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);
    const updated: LogEntry = { ...existing, ...patch, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
    await db.entries.put(updated);
    return updated;
  });
}

export async function setEntryPosition(db: LogbookDB, id: ID, position: Position | undefined): Promise<LogEntry> {
  return db.transaction('rw', db.entries, async () => {
    const existing = await db.entries.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);
    const updated: LogEntry = { ...existing, position, updatedAt: Math.max(Date.now(), existing.updatedAt + 1) };
    await db.entries.put(updated);
    return updated;
  });
}

export async function deleteEntry(db: LogbookDB, id: ID): Promise<void> {
  await db.transaction('rw', db.entries, db.photos, async () => {
    const entry = await db.entries.get(id);
    if (!entry) return;
    await db.photos.bulkDelete(entry.photoIds);
    await db.entries.delete(id);
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
  return db.transaction('rw', db.entries, db.photos, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    if (entry.photoIds.length >= MAX_PHOTOS_PER_ENTRY) throw new MaxPhotosError();
    const photo: Photo = { ...input, id: crypto.randomUUID(), tripId: entry.tripId, createdAt: Date.now() };
    await db.photos.add(photo);
    await db.entries.update(entryId, { photoIds: [...entry.photoIds, photo.id], updatedAt: Date.now() });
    return photo;
  });
}

/** Adds several photos atomically (all or none). */
export async function addPhotosToEntry(db: LogbookDB, entryId: ID, inputs: readonly PhotoInput[]): Promise<Photo[]> {
  return db.transaction('rw', db.entries, db.photos, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    if (entry.photoIds.length + inputs.length > MAX_PHOTOS_PER_ENTRY) throw new MaxPhotosError(MAX_PHOTOS_PER_ENTRY);
    const now = Date.now();
    const photos: Photo[] = inputs.map((input, i) => ({
      ...input, id: crypto.randomUUID(), tripId: entry.tripId, createdAt: now + i,
    }));
    await db.photos.bulkAdd(photos);
    await db.entries.update(entryId, {
      photoIds: [...entry.photoIds, ...photos.map((p) => p.id)],
      updatedAt: Math.max(now, entry.updatedAt + 1),
    });
    return photos;
  });
}

export async function addPhotosToDayReport(
  db: LogbookDB, tripId: ID, date: string, inputs: readonly PhotoInput[],
): Promise<Photo[]> {
  return db.transaction('rw', db.dayReports, db.photos, async () => {
    const report = (await db.dayReports.get([tripId, date])) ?? { tripId, date, text: '', photoIds: [], updatedAt: 0 };
    if (report.photoIds.length + inputs.length > MAX_PHOTOS_PER_DAY_REPORT) {
      throw new MaxPhotosError(MAX_PHOTOS_PER_DAY_REPORT);
    }
    const now = Date.now();
    const photos: Photo[] = inputs.map((input, i) => ({ ...input, id: crypto.randomUUID(), tripId, createdAt: now + i }));
    await db.photos.bulkAdd(photos);
    await db.dayReports.put({
      ...report, photoIds: [...report.photoIds, ...photos.map((p) => p.id)], updatedAt: Math.max(now, report.updatedAt + 1),
    });
    return photos;
  });
}

export async function removePhotoFromDayReport(db: LogbookDB, tripId: ID, date: string, photoId: ID): Promise<void> {
  await db.transaction('rw', db.dayReports, db.photos, async () => {
    const report = await db.dayReports.get([tripId, date]);
    if (!report) throw new Error(`Day report not found: ${date}`);
    await db.photos.delete(photoId);
    await db.dayReports.put({
      ...report, photoIds: report.photoIds.filter((p) => p !== photoId),
      updatedAt: Math.max(Date.now(), report.updatedAt + 1),
    });
  });
}

/** Hashes of all photos attached to entries of that calendar day or to its report. */
export async function dayPhotoHashes(db: LogbookDB, tripId: ID, date: string): Promise<Set<string>> {
  return db.transaction('r', db.entries, db.photos, db.dayReports, async () => {
    const entries = await listEntries(db, tripId);
    const report = await db.dayReports.get([tripId, date]);
    const ids = new Set<ID>(report?.photoIds ?? []);
    for (const e of entries) if (localDate(e.time, e.tzOffsetMin) === date) e.photoIds.forEach((id) => ids.add(id));
    const photos = await db.photos.bulkGet([...ids]);
    const hashes = new Set<string>();
    for (const p of photos) if (p?.hash) hashes.add(p.hash);
    return hashes;
  });
}

export async function removePhotoFromEntry(db: LogbookDB, entryId: ID, photoId: ID): Promise<void> {
  await db.transaction('rw', db.entries, db.photos, async () => {
    const entry = await db.entries.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);
    await db.photos.delete(photoId);
    await db.entries.update(entryId, {
      photoIds: entry.photoIds.filter((p) => p !== photoId),
      updatedAt: Math.max(Date.now(), entry.updatedAt + 1),
    });
  });
}

export async function setBoatPhoto(db: LogbookDB, tripId: ID, input: PhotoInput): Promise<Photo> {
  return db.transaction('rw', db.trips, db.photos, async () => {
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    if (trip.boat.photoId) await db.photos.delete(trip.boat.photoId);
    const photo: Photo = { ...input, id: crypto.randomUUID(), tripId, createdAt: Date.now() };
    await db.photos.add(photo);
    await db.trips.put({
      ...trip, boat: { ...trip.boat, photoId: photo.id }, updatedAt: Math.max(Date.now(), trip.updatedAt + 1),
    });
    return photo;
  });
}

// ---------- DayReports ----------

export async function getDayReport(db: LogbookDB, tripId: ID, date: string): Promise<DayReport | undefined> {
  return db.dayReports.get([tripId, date]);
}

export async function upsertDayReport(
  db: LogbookDB, tripId: ID, date: string, input: { title?: string; text: string },
): Promise<DayReport> {
  return db.transaction('rw', db.dayReports, async () => {
    const existing = await db.dayReports.get([tripId, date]);
    const report: DayReport = { tripId, date, ...input, photoIds: existing?.photoIds ?? [], updatedAt: Date.now() };
    await db.dayReports.put(report);
    return report;
  });
}

export async function listDayReports(db: LogbookDB, tripId: ID): Promise<DayReport[]> {
  return db.dayReports.where('tripId').equals(tripId).sortBy('date');
}

// ---------- Tracks ----------

export async function addTrack(
  db: LogbookDB, tripId: ID, input: { name: string; source: Track['source']; points: TrackPoint[] },
): Promise<Track> {
  const track: Track = { ...input, id: crypto.randomUUID(), tripId, createdAt: Date.now() };
  await db.tracks.add(track);
  return track;
}

export async function listTracks(db: LogbookDB, tripId: ID): Promise<Track[]> {
  return db.tracks.where('tripId').equals(tripId).sortBy('createdAt');
}

export async function deleteTrack(db: LogbookDB, id: ID): Promise<void> {
  await db.tracks.delete(id);
}

export async function appendTrackPoints(db: LogbookDB, trackId: ID, points: TrackPoint[]): Promise<void> {
  await db.transaction('rw', db.tracks, async () => {
    const track = await db.tracks.get(trackId);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    await db.tracks.update(trackId, { points: [...track.points, ...points] });
  });
}

// ---------- Bulk (import / export) ----------

export type { TripBundle };

export async function loadTripData(db: LogbookDB, tripId: ID): Promise<TripBundle> {
  return db.transaction('r', [db.trips, db.entries, db.photos, db.dayReports, db.tracks], async () => {
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error(`Trip not found: ${tripId}`);
    return {
      trip,
      entries: await listEntries(db, tripId),
      photos: await db.photos.where('tripId').equals(tripId).sortBy('createdAt'),
      dayReports: await listDayReports(db, tripId),
      tracks: await listTracks(db, tripId),
    };
  });
}

export async function replaceTripData(db: LogbookDB, bundle: TripBundle): Promise<void> {
  await db.transaction('rw', [db.trips, db.entries, db.photos, db.dayReports, db.tracks], async () => {
    await deleteTripChildren(db, bundle.trip.id);
    await db.trips.put(bundle.trip);
    await db.entries.bulkPut(bundle.entries);
    await db.photos.bulkPut(bundle.photos);
    await db.dayReports.bulkPut(bundle.dayReports);
    await db.tracks.bulkPut(bundle.tracks);
  });
}
