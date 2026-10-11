import type Dexie from 'dexie';
import type { DexieCloudOptions } from 'dexie-cloud-addon';

/** Tables that never leave the device (deviceId, authorByTrip, boat selection, theme, activeTripId). */
export const UNSYNCED_TABLES = ['settings'];

export function cloudOptions(databaseUrl: string): DexieCloudOptions {
  return {
    databaseUrl,
    requireAuth: false, // lokaler Modus ohne Login bleibt voll nutzbar
    customLoginGui: true, // eigene deutsche Dialoge (ui/cloud/LoginDialog)
    socialAuth: false, // nur E-Mail-Code
    unsyncedTables: UNSYNCED_TABLES,
    nameSuffix: false, // lokale DB-Name bleibt gleich zwischen lokalem und Cloud-Modus
    tryUseServiceWorker: false, // Phase 1: Sync nur bei offener App (WebSocket)
  };
}

/** Must run right after the schema declaration, before the first query. */
export function configureCloud(db: Dexie, databaseUrl: string): void {
  db.cloud.configure(cloudOptions(databaseUrl));
}
