import Dexie, { type EntityTable } from 'dexie';
import type { DayReport, ID, LogEntry, Photo, Track, Trip } from '../domain/types';

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Default database name. Schema "v3" (Flottille) starts a fresh database: there is no migration
 * from the pre-Flottille databases named `logbook` (no real data existed); those are left untouched.
 */
export const DEFAULT_DB_NAME = 'logbook-v3';

export class LogbookDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>;
  entries!: EntityTable<LogEntry, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  /** One section per author: key [tripId+date+authorId]. */
  dayReports!: Dexie.Table<DayReport, [ID, string, ID]>;
  tracks!: EntityTable<Track, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = DEFAULT_DB_NAME) {
    super(name);
    this.version(1).stores({
      trips: 'id',
      entries: 'id, tripId, [tripId+time]',
      photos: 'id, tripId, hash',
      dayReports: '[tripId+date+authorId], tripId',
      tracks: 'id, tripId',
      settings: 'key',
    });
    // the device id exists from the start, so reads (live queries) never have to create it
    this.on('populate', (tx) => {
      void tx.table('settings').put({ key: 'deviceId', value: crypto.randomUUID() });
    });
  }
}

export function createDb(name = DEFAULT_DB_NAME): LogbookDB {
  return new LogbookDB(name);
}

export const db: LogbookDB = createDb();
