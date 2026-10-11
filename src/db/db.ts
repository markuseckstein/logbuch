import Dexie, { type EntityTable } from 'dexie';
import dexieCloud from 'dexie-cloud-addon';
import type { CrewMember, DayReport, LogEntry, Photo, TrackChunk, TrackRecord, Trip } from '../domain/types';
import { configureCloud } from './cloudConfig';

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Default database name. Schema "v4" (Dexie Cloud, Stufe 2) starts a fresh database: crew and track points
 * live in their own tables, day reports have a string id. No migration from `logbook`/`logbook-v3`
 * (no real data existed); `legacy.ts` removes them.
 */
export const DEFAULT_DB_NAME = 'logbook-v4';

/** localStorage copy of the device id: a cloud logout clears every table, the device id must survive. */
export const DEVICE_ID_STORAGE_KEY = 'logbuch.deviceId';

/** Signed-in Dexie Cloud user. */
export interface CloudUser {
  userId: string;
  email?: string;
}

export interface DbOptions {
  /** Dexie Cloud database URL; without it the app runs purely locally (no addon). */
  cloudUrl?: string | undefined;
}

/** Synced tables (Dexie Cloud); `settings` stays local (unsyncedTables). */
const STORES = {
  trips: 'id',
  crewMembers: 'id, tripId',
  entries: 'id, tripId, [tripId+time]',
  photos: 'id, tripId, hash',
  dayReports: 'id, tripId',
  tracks: 'id, tripId',
  trackChunks: 'id, trackId, tripId',
  settings: 'key',
};

/**
 * Access-control tables as plain local tables when the cloud addon is not active (same key paths as the
 * addon's own schema). They stay empty in local mode, so permission checks fall back to `writableTripIds`;
 * tests fill them to exercise the cloud permission rules without a server.
 */
const LOCAL_ACCESS_STORES = {
  realms: 'realmId',
  members: 'id, [userId+realmId], [email+realmId], realmId',
  roles: '[realmId+name]',
};

export function storedDeviceId(): string | undefined {
  try {
    return globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function rememberDeviceId(id: string): void {
  try {
    globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, id);
  } catch {
    // private mode / blocked storage: the id still lives in the database
  }
}

export class LogbookDB extends Dexie {
  trips!: EntityTable<Trip, 'id'>;
  crewMembers!: EntityTable<CrewMember, 'id'>;
  entries!: EntityTable<LogEntry, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  /** One section per author: id = dayReportId(tripId, date, authorId). */
  dayReports!: EntityTable<DayReport, 'id'>;
  tracks!: EntityTable<TrackRecord, 'id'>;
  trackChunks!: EntityTable<TrackChunk, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  /** Dexie Cloud addon active (VITE_DEXIE_CLOUD_URL set). */
  readonly cloudEnabled: boolean;

  /** Signed-in cloud user; undefined in local mode or when not logged in. Replaceable in tests. */
  cloudUser: () => CloudUser | undefined = () => undefined;

  /**
   * Realms the server confirmed for this user in the last sync (rights of a membership apply only then);
   * undefined in local mode / before the first sync. Replaceable in tests.
   */
  serverRealms: () => readonly string[] | undefined = () => undefined;

  constructor(name = DEFAULT_DB_NAME, opts: DbOptions = {}) {
    const cloudUrl = opts.cloudUrl?.trim() || undefined;
    super(name, cloudUrl ? { addons: [dexieCloud] } : {});
    this.cloudEnabled = cloudUrl !== undefined;
    this.version(1).stores(cloudUrl ? STORES : { ...STORES, ...LOCAL_ACCESS_STORES });
    // the device id exists from the start, so reads (live queries) never have to create it;
    // a new database is a new device (after a cloud logout the tables are cleared, not re-populated:
    // then getDeviceId restores the id from localStorage)
    this.on('populate', (tx) => {
      const id = crypto.randomUUID();
      rememberDeviceId(id);
      void tx.table('settings').put({ key: 'deviceId', value: id });
    });
    if (cloudUrl) {
      configureCloud(this, cloudUrl);
      this.cloudUser = () => {
        const u = this.cloud.currentUser.value;
        return u.isLoggedIn && u.userId ? { userId: u.userId, ...(u.email ? { email: u.email } : {}) } : undefined;
      };
      this.serverRealms = () => this.cloud.persistedSyncState.value?.realms;
    }
  }
}

export function createDb(name = DEFAULT_DB_NAME, opts: DbOptions = {}): LogbookDB {
  return new LogbookDB(name, opts);
}

export const CLOUD_URL: string | undefined = import.meta.env.VITE_DEXIE_CLOUD_URL || undefined;

export const db: LogbookDB = createDb(DEFAULT_DB_NAME, { cloudUrl: CLOUD_URL });
