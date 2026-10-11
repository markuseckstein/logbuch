import Dexie, { type EntityTable } from 'dexie';
import type { DayReport, ID, LogEntry, Photo, Track, Trip } from '../domain/types';

export interface SettingRow {
  key: string;
  value: unknown;
}

export class LogbookDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>;
  entries!: EntityTable<LogEntry, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  dayReports!: Dexie.Table<DayReport, [ID, string]>;
  tracks!: EntityTable<Track, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'logbook') {
    super(name);
    this.version(1).stores({
      trips: 'id',
      entries: 'id, tripId, [tripId+time]',
      photos: 'id, tripId',
      dayReports: '[tripId+date], tripId',
      tracks: 'id, tripId',
      settings: 'key',
    });
    this.version(2)
      .stores({ photos: 'id, tripId, hash' })
      .upgrade((tx) =>
        tx.table('dayReports').toCollection().modify((r: { photoIds?: ID[] }) => {
          r.photoIds ??= [];
        }),
      );
  }
}

export function createDb(name = 'logbook'): LogbookDB {
  return new LogbookDB(name);
}

export const db: LogbookDB = createDb();
