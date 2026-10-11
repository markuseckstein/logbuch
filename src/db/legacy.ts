import Dexie from 'dexie';

/** Databases of earlier schemas (no real data existed, no migration). */
export const LEGACY_DB_NAMES = ['logbook', 'logbook-v3'];

/** Removes the databases of earlier schemas once; errors are ignored. */
export async function deleteLegacyDb(): Promise<void> {
  for (const name of LEGACY_DB_NAMES) {
    try {
      await Dexie.delete(name);
    } catch {
      // nothing to clean up or deletion blocked: irrelevant for the new database
    }
  }
}
